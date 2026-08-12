import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ViewerContext } from "@/lib/auth/viewer";

type InboxSeed = {
  organization_id: string;
  recipient_id: string;
  actor_id: null;
  project_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  href: string;
  source_type: string;
  source_id: string;
  priority: "low" | "normal" | "high" | "urgent";
};

export async function materializeViewerAttention(
  client: SupabaseClient,
  viewer: ViewerContext,
) {
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const sixMonths = new Date(now.getTime() + 180 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const organizationId = viewer.organization.id;
  const recipientId = viewer.user.id;

  const queries = [
    client
      .from("support_tickets")
      .select(
        "todo_id,first_response_due_at,resolution_due_at,todos!inner(title,priority,status,assigned_to,project_id),clients(name)",
      )
      .eq("todos.assigned_to", recipientId)
      .not("todos.status", "in", "(done,cancelled)")
      .limit(200),
    viewer.capabilities.timeApprove
      ? client
          .from("time_entries")
          .select("id,project_id,entry_date,minutes,description,projects(name)")
          .eq("organization_id", organizationId)
          .eq("status", "submitted")
          .order("entry_date")
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("issue_blockers")
      .select("id,project_id,title,reason,status,expected_resolution_at,projects(name)")
      .eq("organization_id", organizationId)
      .eq("owner_id", recipientId)
      .in("status", ["open", "watching"])
      .limit(200),
    viewer.capabilities.pipelineWrite || viewer.capabilities.commercialRead
      ? client
          .from("prospects")
          .select("id,title,next_action,next_action_at,client:clients(name)")
          .eq("organization_id", organizationId)
          .eq("owner_id", recipientId)
          .not("stage", "in", "(won,lost)")
          .not("next_action_at", "is", null)
          .lte("next_action_at", sevenDays)
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    viewer.capabilities.commercialRead
      ? client
          .from("retainers")
          .select("id,name,end_date,renewal_days,auto_renew,client:clients(name,account_owner_id)")
          .eq("organization_id", organizationId)
          .not("status", "in", "(completed,cancelled)")
          .not("end_date", "is", null)
          .lte("end_date", sixMonths)
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    viewer.capabilities.commercialRead
      ? client
          .from("invoices")
          .select(
            "id,invoice_number,promised_payment_date,balance_cents,status,collection_owner_id,client:clients(name)",
          )
          .eq("organization_id", organizationId)
          .eq("collection_owner_id", recipientId)
          .not("promised_payment_date", "is", null)
          .lte("promised_payment_date", sevenDays.slice(0, 10))
          .in("status", ["issued", "partially_paid", "overdue"])
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    viewer.capabilities.commercialWrite
      ? client.rpc("get_billing_workbench", {
          through_date: now.toISOString().slice(0, 10),
        })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("messages")
      .select("id,project_id,subject,body,updated_at,projects(name)")
      .eq("status", "failed")
      .limit(100),
  ] as const;

  const [
    support,
    time,
    blockers,
    prospects,
    retainers,
    promises,
    billing,
    delivery,
  ] = await Promise.all(queries);

  for (const result of [
    support,
    time,
    blockers,
    prospects,
    retainers,
    promises,
    billing,
    delivery,
  ]) {
    if (result.error) {
      console.warn("Optional inbox attention source unavailable:", result.error);
    }
  }

  const seeds: InboxSeed[] = [];
  for (const item of support.data ?? []) {
    const todo = relation(item.todos);
    const account = relation(item.clients);
    if (!todo) continue;
    const breached = [item.first_response_due_at, item.resolution_due_at]
      .filter(Boolean)
      .some((value) => new Date(String(value)).getTime() < now.getTime());
    seeds.push(seed(viewer, {
      projectId: nullableString(todo.project_id),
      kind: "support_ticket",
      title: String(todo.title),
      body: `${account?.name ?? "Client"} · ${
        breached ? "SLA attention required" : "Assigned support request"
      }`,
      href: `/support/${item.todo_id}`,
      sourceType: "support_ticket",
      sourceId: item.todo_id,
      priority: breached ? "urgent" : priority(String(todo.priority)),
    }));
  }
  for (const item of time.data ?? []) {
    const project = relation(item.projects);
    seeds.push(seed(viewer, {
      projectId: item.project_id,
      kind: "time_approval",
      title: `Approve time: ${item.description}`,
      body: `${project?.name ?? "Project"} · ${item.minutes} minutes on ${item.entry_date}`,
      href: "/time?status=submitted",
      sourceType: "time_entry",
      sourceId: item.id,
      priority: "high",
    }));
  }
  for (const item of blockers.data ?? []) {
    const project = relation(item.projects);
    const overdue = Boolean(
      item.expected_resolution_at &&
        new Date(item.expected_resolution_at).getTime() < now.getTime(),
    );
    seeds.push(seed(viewer, {
      projectId: item.project_id,
      kind: "blocker",
      title: item.title,
      body: `${project?.name ?? "Project"}${item.reason ? ` · ${item.reason}` : ""}`,
      href: `/projects/${item.project_id}?tab=planning`,
      sourceType: "issue_blocker",
      sourceId: item.id,
      priority: overdue ? "urgent" : "high",
    }));
  }
  for (const item of prospects.data ?? []) {
    const account = relation(item.client);
    const overdue =
      Boolean(item.next_action_at) &&
      new Date(String(item.next_action_at)).getTime() < now.getTime();
    seeds.push(seed(viewer, {
      projectId: null,
      kind: "prospect_next_action",
      title: item.next_action || `Follow up: ${item.title}`,
      body: `${account?.name ?? "Prospect"} · ${item.title}`,
      href: `/clients/prospects/${item.id}`,
      sourceType: "prospect",
      sourceId: item.id,
      priority: overdue ? "urgent" : "high",
    }));
  }
  for (const item of retainers.data ?? []) {
    const account = relation(item.client);
    if (
      viewer.role !== "admin" &&
      viewer.role !== "manager" &&
      account?.account_owner_id !== recipientId
    ) {
      continue;
    }
    const end = new Date(`${item.end_date}T00:00:00Z`);
    const noticeDays = Number(item.renewal_days ?? 30);
    if (end.getTime() - now.getTime() > noticeDays * 86_400_000) continue;
    seeds.push(seed(viewer, {
      projectId: null,
      kind: "renewal",
      title: `Renewal: ${item.name}`,
      body: `${account?.name ?? "Client"} · ends ${item.end_date}${
        item.auto_renew ? " · auto-renew enabled" : ""
      }`,
      href: `/retainers/${item.id}`,
      sourceType: "retainer",
      sourceId: item.id,
      priority: "high",
    }));
  }
  for (const item of promises.data ?? []) {
    const account = relation(item.client);
    const missed =
      Boolean(item.promised_payment_date) &&
      String(item.promised_payment_date) < now.toISOString().slice(0, 10);
    seeds.push(seed(viewer, {
      projectId: null,
      kind: "collection_promise",
      title: `${missed ? "Missed" : "Upcoming"} payment promise: ${item.invoice_number}`,
      body: `${account?.name ?? "Client"} · ${money(item.balance_cents)} outstanding`,
      href: `/billing/${item.id}`,
      sourceType: "invoice",
      sourceId: item.id,
      priority: missed ? "urgent" : "high",
    }));
  }
  for (const item of billing.data ?? []) {
    seeds.push(seed(viewer, {
      projectId: nullableString(item.project_id),
      kind: "bill_ready",
      title: `Ready to bill: ${item.client_name}`,
      body: `${item.project_name ?? "Client work"} · ${money(item.amount_cents)}`,
      href: "/billing",
      sourceType: item.source_type,
      sourceId: item.source_id,
      priority: "normal",
    }));
  }
  for (const item of delivery.data ?? []) {
    const project = relation(item.projects);
    seeds.push(seed(viewer, {
      projectId: item.project_id,
      kind: "delivery_failure",
      title: item.subject || "Message delivery failed",
      body: `${project?.name ?? "Project"} · ${excerpt(item.body)}`,
      href: `/projects/${item.project_id}?tab=messages&message=${item.id}`,
      sourceType: "message",
      sourceId: item.id,
      priority: "urgent",
    }));
  }

  if (!seeds.length) return 0;
  const { error } = await client.from("workspace_inbox_items").upsert(seeds, {
    onConflict: "recipient_id,kind,source_type,source_id",
  });
  if (error) {
    console.warn("Materialize inbox attention failed:", error);
    return 0;
  }
  return seeds.length;
}

function seed(
  viewer: ViewerContext,
  item: {
    projectId: string | null;
    kind: string;
    title: string;
    body: string | null;
    href: string;
    sourceType: string;
    sourceId: string;
    priority: "low" | "normal" | "high" | "urgent";
  },
): InboxSeed {
  return {
    organization_id: viewer.organization.id,
    recipient_id: viewer.user.id,
    actor_id: null,
    project_id: item.projectId,
    kind: item.kind,
    title: item.title.slice(0, 240),
    body: item.body,
    href: item.href,
    source_type: item.sourceType,
    source_id: String(item.sourceId),
    priority: item.priority,
  };
}

function relation(value: unknown): Record<string, unknown> | undefined {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : undefined;
}

function priority(value: string): InboxSeed["priority"] {
  return value === "urgent" || value === "high" || value === "low"
    ? value
    : "normal";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
}

function excerpt(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 100 ? `${text.slice(0, 97)}…` : text;
}
