import { getAppSupabaseClient } from "@/lib/integrations/supabase";
import { runAutomationCycle } from "@/lib/automation/server";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const client = getAppSupabaseClient();
  if (!client) {
    return Response.json({ error: "Database is not configured." }, { status: 503 });
  }
  const now = new Date();
  const [recurringResult, overdueResult, retainerRollResult] = await Promise.all([
    client
      .from("recurring_work_rules")
      .select("*")
      .eq("enabled", true)
      .lte("next_run_at", now.toISOString())
      .order("next_run_at")
      .limit(100),
    client
      .from("todos")
      .select(
        "id,project_id,title,priority,due_at,projects!inner(organization_id),todo_assignees(profile_id)",
      )
      .eq("operational_state", "active")
      .not("status", "in", "(done,cancelled)")
      .lt("due_at", now.toISOString())
      .limit(1_000),
    client.rpc("roll_active_retainer_periods", {
      through_date: now.toISOString().slice(0, 10),
    }),
  ]);
  if (recurringResult.error || overdueResult.error || retainerRollResult.error) {
    console.error(
      "Operations cron read failed:",
      recurringResult.error ?? overdueResult.error ?? retainerRollResult.error,
    );
    return Response.json({ error: "Operations scan failed." }, { status: 500 });
  }

  let created = 0;
  const failures: string[] = [];
  for (const rule of recurringResult.data ?? []) {
    const runKey = `recurring:${rule.id}:${rule.next_run_at}`;
    const dueAt = new Date(
      now.getTime() + Number(rule.due_offset_days ?? 0) * 86_400_000,
    ).toISOString();
    const { error } = await client.rpc("create_project_issue", {
      target_project_id: rule.project_id,
      target_todo_list_id: null,
      target_title: rule.title,
      target_description: rule.description,
      target_assignee_ids: rule.assignee_ids ?? [],
      target_completion_subscriber_ids: [],
      target_due_at: dueAt,
      target_priority: "medium",
      target_issue_type: "task",
      target_labels: ["recurring"],
      target_estimated_minutes: null,
      target_actual_minutes: null,
      requested_actor_id: rule.created_by,
      target_idempotency_key: runKey,
    });
    if (error) {
      failures.push(String(rule.id));
      console.error("Recurring issue creation failed:", error);
      continue;
    }
    const nextRun = advanceCadence(new Date(rule.next_run_at), rule.cadence);
    const { error: updateError } = await client
      .from("recurring_work_rules")
      .update({ next_run_at: nextRun.toISOString(), updated_at: now.toISOString() })
      .eq("id", rule.id)
      .eq("next_run_at", rule.next_run_at);
    if (updateError) {
      failures.push(String(rule.id));
      console.error("Recurring rule advance failed:", updateError);
      continue;
    }
    created += 1;
  }

  const overdueItems = (overdueResult.data ?? []).flatMap((todo) => {
    const project = relation(todo.projects);
    const assignees = Array.isArray(todo.todo_assignees)
      ? todo.todo_assignees
      : [];
    return assignees.map((assignee) => ({
      organization_id: project?.organization_id,
      recipient_id: assignee.profile_id,
      actor_id: null,
      project_id: todo.project_id,
      kind: "overdue",
      title: `Overdue: ${todo.title}`,
      body: `Due ${String(todo.due_at).slice(0, 10)}`,
      href: `/projects/${todo.project_id}/issues/${todo.id}`,
      source_type: "issue",
      source_id: todo.id,
      priority: todo.priority === "urgent" ? "urgent" : "high",
    }));
  }).filter((item) => item.organization_id);
  if (overdueItems.length) {
    const { error } = await client
      .from("workspace_inbox_items")
      .upsert(overdueItems, {
        onConflict: "recipient_id,kind,source_type,source_id",
      });
    if (error) console.error("Overdue inbox upsert failed:", error);
  }

  let automation = { enqueued: 0, succeeded: 0, failed: 0, retrying: 0 };
  try {
    automation = await runAutomationCycle(client);
  } catch (error) {
    console.error("Automation cycle failed:", error);
    failures.push("automation-cycle");
  }
  const deliveryFailures = await materializeDeliveryFailures(client);

  const deadLetters = await client.rpc("list_operator_dead_letters", {
    target_organization_id: null,
  });
  const deadLetterCount =
    (Array.isArray(deadLetters.data?.storage_deletion_outbox)
      ? deadLetters.data.storage_deletion_outbox.length
      : 0) +
    (Array.isArray(deadLetters.data?.slack_notification_outbox)
      ? deadLetters.data.slack_notification_outbox.length
      : 0) +
    (Array.isArray(deadLetters.data?.invoice_deliveries)
      ? deadLetters.data.invoice_deliveries.length
      : 0);
  const healthStatus =
    failures.length > 0 || deadLetterCount > 0 ? "degraded" : "healthy";
  await client.rpc("record_production_health_snapshot", {
    target_scope: "platform",
    target_status: healthStatus,
    target_checks: [
      { key: "recurring_failures", value: failures.length },
      { key: "dead_letters", value: deadLetterCount },
      { key: "delivery_failures", value: deliveryFailures },
    ],
    target_organization_id: null,
    target_metadata: { source: "cron.operations" },
  });

  return Response.json({
    recurringCreated: created,
    recurringFailed: failures.length,
    retainerPeriodsCreated: Number(retainerRollResult.data ?? 0),
    overdueNotified: overdueItems.length,
    automation,
    deliveryFailures,
  });
}

function advanceCadence(value: Date, cadence: string) {
  const next = new Date(value);
  if (cadence === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (cadence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (cadence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 3);
  return next;
}

function relation(value: unknown): Record<string, unknown> | undefined {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : undefined;
}

async function materializeDeliveryFailures(
  client: NonNullable<ReturnType<typeof getAppSupabaseClient>>,
) {
  const [profiles, slack, storage] = await Promise.all([
    client
      .from("profiles")
      .select("id,organization_id")
      .eq("status", "active")
      .in("role", ["admin", "manager"]),
    client
      .from("slack_notification_outbox")
      .select("id,organization_id,status,last_error,updated_at")
      .in("status", ["failed", "dead"])
      .order("updated_at", { ascending: false })
      .limit(200),
    client
      .from("storage_deletion_outbox")
      .select("id,organization_id,status,last_error,updated_at")
      .in("status", ["failed", "dead"])
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);
  const error = profiles.error ?? slack.error ?? storage.error;
  if (error) {
    console.error("Delivery failure materialization failed:", error);
    return 0;
  }
  const recipientsByOrganization = new Map<string, string[]>();
  for (const profile of profiles.data ?? []) {
    recipientsByOrganization.set(profile.organization_id, [
      ...(recipientsByOrganization.get(profile.organization_id) ?? []),
      profile.id,
    ]);
  }
  const rows = [
    ...(slack.data ?? []).flatMap((item) =>
      (recipientsByOrganization.get(item.organization_id) ?? []).map(
        (recipientId) => ({
          organization_id: item.organization_id,
          recipient_id: recipientId,
          actor_id: null,
          project_id: null,
          kind: "delivery_failure",
          title: "Slack delivery needs attention",
          body: item.last_error ?? `Delivery is ${item.status}.`,
          href: "/admin/operations",
          source_type: "slack_notification",
          source_id: item.id,
          priority: item.status === "dead" ? "urgent" : "high",
        }),
      ),
    ),
    ...(storage.data ?? []).flatMap((item) =>
      (recipientsByOrganization.get(item.organization_id) ?? []).map(
        (recipientId) => ({
          organization_id: item.organization_id,
          recipient_id: recipientId,
          actor_id: null,
          project_id: null,
          kind: "delivery_failure",
          title: "Storage delivery cleanup needs attention",
          body: item.last_error ?? `Delivery cleanup is ${item.status}.`,
          href: "/admin/operations",
          source_type: "storage_deletion",
          source_id: item.id,
          priority: item.status === "dead" ? "urgent" : "high",
        }),
      ),
    ),
  ];
  if (!rows.length) return 0;
  const { error: upsertError } = await client
    .from("workspace_inbox_items")
    .upsert(rows, { onConflict: "recipient_id,kind,source_type,source_id" });
  if (upsertError) {
    console.error("Delivery failure inbox upsert failed:", upsertError);
    return 0;
  }
  return rows.length;
}
