import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export async function runAutomationCycle(
  client: SupabaseClient,
  options: { organizationId?: string; limit?: number } = {},
) {
  let rulesQuery = client
    .from("automation_rules")
    .select("*")
    .eq("enabled", true)
    .order("created_at")
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 200));
  if (options.organizationId) {
    rulesQuery = rulesQuery.eq("organization_id", options.organizationId);
  }
  const { data: rules, error: rulesError } = await rulesQuery;
  if (rulesError) throw rulesError;

  let enqueued = 0;
  for (const rule of (rules ?? []) as Row[]) {
    const candidates = await candidatesForRule(client, rule);
    if (!candidates.length) continue;
    const { data, error } = await client
      .from("automation_rule_runs")
      .upsert(
        candidates.map((candidate) => ({
          organization_id: rule.organization_id,
          rule_id: rule.id,
          event_key: candidate.eventKey,
          trigger_source_type: candidate.sourceType,
          trigger_source_id: candidate.sourceId,
          input: candidate.input,
          requested_by: null,
        })),
        {
          onConflict: "rule_id,event_key",
          ignoreDuplicates: true,
        },
      )
      .select("id");
    if (error) throw error;
    enqueued += data?.length ?? 0;
  }

  let runsQuery = client
    .from("automation_rule_runs")
    .select("*,rule:automation_rules(*)")
    .in("status", ["pending", "retry"])
    .lte("available_at", new Date().toISOString())
    .order("available_at")
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 200));
  if (options.organizationId) {
    runsQuery = runsQuery.eq("organization_id", options.organizationId);
  }
  const { data: runs, error: runsError } = await runsQuery;
  if (runsError) throw runsError;

  let succeeded = 0;
  let failed = 0;
  let retrying = 0;
  for (const sourceRun of (runs ?? []) as Row[]) {
    const rule = relation(sourceRun.rule);
    if (!rule) continue;
    const attempt = Number(sourceRun.attempt_count ?? 0) + 1;
    const { data: claimed, error: claimError } = await client
      .from("automation_rule_runs")
      .update({
        status: "running",
        attempt_count: attempt,
        started_at: new Date().toISOString(),
        completed_at: null,
        last_error: null,
      })
      .eq("id", String(sourceRun.id))
      .in("status", ["pending", "retry"])
      .select("*")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    await client.from("automation_run_attempts").insert({
      organization_id: sourceRun.organization_id,
      run_id: sourceRun.id,
      attempt_number: attempt,
      status: "running",
    });
    try {
      const output = await executeAction(client, claimed as Row, rule);
      const completedAt = new Date().toISOString();
      const { error } = await client
        .from("automation_rule_runs")
        .update({
          status: "succeeded",
          output,
          completed_at: completedAt,
        })
        .eq("id", String(sourceRun.id))
        .eq("status", "running");
      if (error) throw error;
      await client.from("automation_run_attempts").insert({
        organization_id: sourceRun.organization_id,
        run_id: sourceRun.id,
        attempt_number: attempt,
        status: "succeeded",
        output,
        completed_at: completedAt,
      });
      succeeded += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Automation action failed.";
      const maxAttempts = Number(sourceRun.max_attempts ?? 3);
      const willRetry = attempt < maxAttempts;
      const completedAt = new Date().toISOString();
      await client
        .from("automation_rule_runs")
        .update({
          status: willRetry ? "retry" : "failed",
          last_error: message.slice(0, 2_000),
          available_at: new Date(
            Date.now() + Math.min(60, 2 ** attempt) * 60_000,
          ).toISOString(),
          completed_at: willRetry ? null : completedAt,
        })
        .eq("id", String(sourceRun.id));
      await client.from("automation_run_attempts").insert({
        organization_id: sourceRun.organization_id,
        run_id: sourceRun.id,
        attempt_number: attempt,
        status: "failed",
        error: message.slice(0, 2_000),
        completed_at: completedAt,
      });
      if (willRetry) retrying += 1;
      else failed += 1;
    }
  }
  return { enqueued, succeeded, failed, retrying };
}

async function candidatesForRule(client: SupabaseClient, rule: Row) {
  const trigger = String(rule.trigger_type);
  const config = object(rule.trigger_config);
  const projectId = nullableString(rule.project_id);
  const organizationId = String(rule.organization_id);
  const now = new Date();

  if (trigger === "approval_completed") {
    let query = client
      .from("work_approvals")
      .select("id,project_id,title,status,reviewer_id,responded_at")
      .eq("organization_id", organizationId)
      .neq("status", "pending")
      .not("responded_at", "is", null)
      .order("responded_at", { ascending: false })
      .limit(500);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((approval) => ({
      eventKey: `approval_completed:${approval.id}:${approval.status}:${approval.responded_at}`,
      sourceType: "approval",
      sourceId: approval.id,
      input: {
        projectId: approval.project_id,
        targetId: approval.id,
        title: approval.title,
        status: approval.status,
        recipientIds: [approval.reviewer_id].filter(Boolean),
      },
    }));
  }

  let query = client
    .from("todos")
    .select(
      "id,project_id,title,status,priority,due_at,updated_at,created_at,version,assigned_to,todo_assignees(profile_id),projects!inner(organization_id,owner_id)",
    )
    .eq("projects.organization_id", organizationId)
    .not("status", "in", "(done,cancelled)")
    .order("updated_at", { ascending: false })
    .limit(1_000);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).flatMap((todo) => {
    const project = relation(todo.projects);
    const assigneeIds = (Array.isArray(todo.todo_assignees)
      ? todo.todo_assignees
      : []
    )
      .map((item) => nullableString(item.profile_id))
      .filter((item): item is string => Boolean(item))
      .sort();
    const input = {
      projectId: todo.project_id,
      targetId: todo.id,
      title: todo.title,
      status: todo.status,
      priority: todo.priority,
      dueAt: todo.due_at,
      recipientIds:
        assigneeIds.length > 0
          ? assigneeIds
          : [todo.assigned_to, project?.owner_id].filter(Boolean),
    };
    const due = todo.due_at ? new Date(todo.due_at) : null;
    if (trigger === "issue_created") {
      return [{
        eventKey: `issue_created:${todo.id}`,
        sourceType: "issue",
        sourceId: todo.id,
        input,
      }];
    }
    if (trigger === "status_changed") {
      const targetStatus = nullableString(config.status);
      if (targetStatus && targetStatus !== todo.status) return [];
      return [{
        eventKey: `status_changed:${todo.id}:${todo.version}:${todo.status}`,
        sourceType: "issue",
        sourceId: todo.id,
        input,
      }];
    }
    if (trigger === "assignment_changed") {
      return [{
        eventKey: `assignment_changed:${todo.id}:${assigneeIds.join(",") || "unassigned"}`,
        sourceType: "issue",
        sourceId: todo.id,
        input,
      }];
    }
    if (trigger === "due_soon") {
      const days = boundedNumber(config.days, 3, 1, 30);
      if (
        !due ||
        due < now ||
        due.getTime() > now.getTime() + days * 86_400_000
      ) {
        return [];
      }
      return [{
        eventKey: `due_soon:${todo.id}:${todo.due_at}`,
        sourceType: "issue",
        sourceId: todo.id,
        input,
      }];
    }
    if (trigger === "overdue") {
      if (!due || due >= now) return [];
      return [{
        eventKey: `overdue:${todo.id}:${todo.due_at}`,
        sourceType: "issue",
        sourceId: todo.id,
        input,
      }];
    }
    if (trigger === "stale") {
      const days = boundedNumber(config.days, 14, 1, 365);
      const updated = new Date(todo.updated_at);
      if (updated.getTime() > now.getTime() - days * 86_400_000) return [];
      return [{
        eventKey: `stale:${todo.id}:${todo.updated_at}`,
        sourceType: "issue",
        sourceId: todo.id,
        input,
      }];
    }
    return [];
  });
}

async function executeAction(client: SupabaseClient, run: Row, rule: Row) {
  const input = object(run.input);
  const config = object(rule.action_config);
  const projectId =
    nullableString(config.projectId) ??
    nullableString(input.projectId) ??
    nullableString(rule.project_id);
  const targetId = nullableString(input.targetId);
  const actorId = String(rule.created_by);
  const action = String(rule.action_type);

  if (action === "notify") {
    const recipients = stringArray(config.recipientIds).length
      ? stringArray(config.recipientIds)
      : stringArray(input.recipientIds);
    if (!recipients.length) recipients.push(actorId);
    const { error } = await client.from("workspace_inbox_items").upsert(
      recipients.map((recipientId) => ({
        organization_id: rule.organization_id,
        recipient_id: recipientId,
        actor_id: actorId,
        project_id: projectId,
        kind: "automation",
        title: nullableString(config.title) ?? String(rule.name),
        body:
          nullableString(config.body) ??
          `Automation matched ${String(input.title ?? run.trigger_source_type ?? "work")}.`,
        href:
          nullableString(config.href) ??
          (projectId && targetId
            ? `/projects/${projectId}/issues/${targetId}`
            : projectId
              ? `/projects/${projectId}`
              : "/roadmap"),
        source_type: "automation_run",
        source_id: run.id,
        priority: normalizePriority(config.priority),
      })),
      { onConflict: "recipient_id,kind,source_type,source_id" },
    );
    if (error) throw error;
    return { notified: recipients.length };
  }

  if (!projectId) throw new Error("Automation action requires a project.");
  if (action === "create_follow_up") {
    const { data, error } = await client.rpc("create_project_issue", {
      target_project_id: projectId,
      target_todo_list_id: null,
      target_title:
        nullableString(config.title) ?? `Follow up: ${String(input.title ?? rule.name)}`,
      target_description: nullableString(config.description),
      target_assignee_ids: stringArray(config.assigneeIds),
      target_completion_subscriber_ids: [],
      target_due_at:
        nullableString(config.dueAt) ??
        new Date(Date.now() + 3 * 86_400_000).toISOString(),
      target_priority: normalizeIssuePriority(config.priority),
      target_issue_type: "task",
      target_labels: ["automation"],
      target_estimated_minutes: null,
      target_actual_minutes: null,
      requested_actor_id: actorId,
      target_idempotency_key: `automation:${String(run.id)}`,
    });
    if (error) throw error;
    return { issueId: relation(data)?.id ?? (data as Row | null)?.id ?? null };
  }
  if (action === "request_approval") {
    const reviewerId = nullableString(config.reviewerId);
    if (!reviewerId) throw new Error("Approval automation needs a reviewer.");
    const { data, error } = await client
      .from("work_approvals")
      .upsert(
        {
          organization_id: rule.organization_id,
          project_id: projectId,
          title: nullableString(config.title) ?? String(rule.name),
          description: nullableString(config.description),
          subject_type: targetId ? "issue" : "project",
          subject_id: targetId ?? projectId,
          requested_by: actorId,
          reviewer_id: reviewerId,
          due_at: nullableString(config.dueAt),
          automation_run_id: run.id,
        },
        { onConflict: "automation_run_id" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return { approvalId: data.id };
  }
  if (action === "post_update") {
    const { data, error } = await client
      .from("messages")
      .upsert(
        {
          project_id: projectId,
          sender_id: actorId,
          direction: "internal",
          channel: "internal",
          subject: nullableString(config.subject) ?? String(rule.name),
          body:
            nullableString(config.body) ??
            `Automation matched ${String(input.title ?? "project work")}.`,
          status: "sent",
          external_id: `automation:${String(run.id)}`,
          sent_at: new Date().toISOString(),
          metadata: { automationRunId: run.id },
        },
        { onConflict: "channel,external_id" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return { messageId: data.id };
  }
  if (!targetId) throw new Error("Automation action requires an issue target.");
  if (action === "assign") {
    const profileId = nullableString(config.profileId);
    if (!profileId) throw new Error("Assignment automation needs a person.");
    const { error } = await client.from("todo_assignees").upsert({
      todo_id: targetId,
      profile_id: profileId,
      assigned_by: actorId,
    });
    if (error) throw error;
    return { assignedTo: profileId };
  }
  if (action === "change_status") {
    const status = nullableString(config.status);
    if (!status) throw new Error("Status automation needs a target status.");
    const { error } = await client
      .from("todos")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", targetId)
      .eq("project_id", projectId);
    if (error) throw error;
    return { status };
  }
  throw new Error(`Unsupported automation action: ${action}`);
}

function relation(value: unknown): Row | undefined {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? (row as Row) : undefined;
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item))
    : [];
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function normalizePriority(value: unknown) {
  return value === "urgent" || value === "high" || value === "low"
    ? value
    : "normal";
}

function normalizeIssuePriority(value: unknown) {
  return value === "urgent" || value === "high" || value === "low"
    ? value
    : "medium";
}
