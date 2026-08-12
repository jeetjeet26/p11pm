import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { materializeViewerAttention } from "@/lib/inbox/server";
import { createClient } from "@/lib/supabase/server";

const updateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["read", "acknowledge", "complete", "snooze", "reopen"]),
  snoozedUntil: z.iso.datetime().optional(),
});

export async function GET(request: Request) {
  const auth = await authenticated();
  if (!auth.ok) return auth.response;
  const { client, userId, viewer } = auth;
  await materializeViewerAttention(client, viewer);
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  if (new URL(request.url).searchParams.get("count") === "1") {
    const [stored, chat, assignments, support] = await Promise.all([
      client
        .from("workspace_inbox_items")
        .select("id,source_type,source_id")
        .eq("recipient_id", userId)
        .is("completed_at", null)
        .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`)
        .limit(1_000),
      client
        .from("workspace_chat_conversation_projection")
        .select("conversation_id", { count: "exact", head: true })
        .eq("profile_id", userId)
        .gt("unread_count", 0),
      client
        .from("todo_assignees")
        .select("todo_id,todos!inner(id)")
        .eq("profile_id", userId)
        .not("todos.status", "in", "(done,cancelled)")
        .lte("todos.due_at", soon)
        .limit(1_000),
      client
        .from("support_tickets")
        .select("todo_id,todos!inner(id,assigned_to,status)")
        .eq("todos.assigned_to", userId)
        .not("todos.status", "in", "(done,cancelled)")
        .limit(1_000),
    ]);
    const workIds = new Set([
      ...(assignments.data ?? []).map((item) => item.todo_id),
      ...(support.data ?? [])
        .map((item) => item.todo_id)
        .filter(
          (id) =>
            !(stored.data ?? []).some(
              (item) =>
                item.source_type === "support_ticket" && item.source_id === id,
            ),
        ),
    ]);
    return Response.json({
      counts: {
        open:
          (stored.data?.length ?? 0) +
          (chat.count ?? 0) +
          workIds.size,
      },
    });
  }

  const [stored, assignments, conversations, support] = await Promise.all([
    client
      .from("workspace_inbox_items")
      .select("*")
      .eq("recipient_id", userId)
      .or(`snoozed_until.is.null,snoozed_until.lte.${now.toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("todo_assignees")
      .select(
        "todo_id,todos!inner(id,project_id,title,status,priority,due_at,updated_at,projects(name,code))",
      )
      .eq("profile_id", userId)
      .not("todos.status", "in", "(done,cancelled)")
      .lte("todos.due_at", soon)
      .limit(100),
    client
      .from("workspace_chat_conversation_projection")
      .select(
        "conversation_id,name,kind,last_message_body,last_message_at,unread_count",
      )
      .eq("profile_id", userId)
      .gt("unread_count", 0)
      .order("last_message_at", { ascending: false })
      .limit(50),
    client
      .from("support_tickets")
      .select(
        "todo_id,opened_at,first_response_due_at,resolution_due_at,todos!inner(id,title,status,priority,assigned_to,updated_at),clients(name)",
      )
      .eq("todos.assigned_to", userId)
      .not("todos.status", "in", "(done,cancelled)")
      .order("opened_at", { ascending: true })
      .limit(100),
  ]);

  if (stored.error) {
    console.error("Load inbox failed:", stored.error);
    return Response.json({ error: "Unable to load inbox." }, { status: 500 });
  }
  if (assignments.error) console.warn("Inbox assignments unavailable:", assignments.error);
  if (conversations.error) console.warn("Inbox chat unread unavailable:", conversations.error);
  if (support.error) console.warn("Inbox support unavailable:", support.error);

  const persisted = (stored.data ?? []).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    href: item.href,
    projectId: item.project_id,
    priority: item.priority,
    readAt: item.read_at,
    acknowledgedAt: item.acknowledged_at,
    completedAt: item.completed_at,
    snoozedUntil: item.snoozed_until,
    createdAt: item.created_at,
    source: "persisted" as const,
    sourceType: item.source_type,
    sourceId: item.source_id,
  }));
  const persistedSupportIds = new Set(
    persisted
      .filter((item) => item.sourceType === "support_ticket")
      .map((item) => item.sourceId),
  );
  const supportIds = new Set((support.data ?? []).map((item) => item.todo_id));
  const dueItems = (assignments.data ?? []).flatMap((assignment) => {
    const todo = relation(assignment.todos);
    if (!todo || supportIds.has(String(todo.id))) return [];
    const dueAt = typeof todo.due_at === "string" ? todo.due_at : undefined;
    const overdue = Boolean(dueAt && new Date(dueAt) < now);
    const project = relation(todo.projects);
    return [
      {
        id: `assignment:${todo.id}`,
        kind: overdue ? "overdue" : "due",
        title: todo.title,
        body: `${project?.name ?? "Project"} · ${overdue ? "Overdue" : "Due soon"}`,
        href: `/projects/${todo.project_id}/issues/${todo.id}`,
        projectId: todo.project_id,
        priority: overdue ? "high" : todo.priority,
        createdAt: todo.updated_at,
        source: "attention" as const,
      },
    ];
  });
  const unreadItems = (conversations.data ?? []).map((conversation) => ({
    id: `chat:${conversation.conversation_id}`,
    kind: "thread_reply",
    title: `${conversation.name ?? "Conversation"} · ${conversation.unread_count} unread`,
    body: conversation.last_message_body,
    href: `/chat/${conversation.conversation_id}`,
    priority: "normal",
    createdAt: conversation.last_message_at ?? now.toISOString(),
    source: "chat" as const,
  }));
  const supportItems = (support.data ?? []).flatMap((item) => {
    if (persistedSupportIds.has(item.todo_id)) return [];
    const todo = relation(item.todos);
    if (!todo) return [];
    const clientRecord = relation(item.clients);
    const nowMs = now.getTime();
    const responseDue = item.first_response_due_at
      ? new Date(item.first_response_due_at).getTime()
      : Number.POSITIVE_INFINITY;
    const resolutionDue = item.resolution_due_at
      ? new Date(item.resolution_due_at).getTime()
      : Number.POSITIVE_INFINITY;
    const breached = responseDue < nowMs || resolutionDue < nowMs;
    return [{
      id: `support:${item.todo_id}`,
      kind: breached ? "support_sla_breach" : "support_ticket",
      title: String(todo.title),
      body: `${clientRecord?.name ?? "Client"} · ${breached ? "SLA attention required" : "Assigned support request"}`,
      href: `/support/${item.todo_id}`,
      priority: breached ? "urgent" : String(todo.priority),
      createdAt: String(todo.updated_at ?? item.opened_at),
      source: "support" as const,
    }];
  });

  const items = [...persisted, ...supportItems, ...dueItems, ...unreadItems].sort(
    (left, right) =>
      priorityRank(right.priority) - priorityRank(left.priority) ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  return Response.json({
    items,
    counts: {
      open: items.filter((item) => !("completedAt" in item) || !item.completedAt)
        .length,
      unread: persisted.filter((item) => !item.readAt && !item.completedAt).length,
      urgent: items.filter((item) => item.priority === "urgent").length,
      chat: unreadItems.length,
    },
  });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid inbox update." }, { status: 400 });
  }
  const auth = await authenticated();
  if (!auth.ok) return auth.response;
  const timestamp = new Date().toISOString();
  const changes =
    parsed.data.action === "read"
      ? { read_at: timestamp }
      : parsed.data.action === "acknowledge"
        ? { acknowledged_at: timestamp, read_at: timestamp }
        : parsed.data.action === "complete"
          ? { completed_at: timestamp, read_at: timestamp }
          : parsed.data.action === "reopen"
            ? { completed_at: null, snoozed_until: null }
            : {
                snoozed_until:
                  parsed.data.snoozedUntil ??
                  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                read_at: timestamp,
              };
  if (
    parsed.data.action === "snooze" &&
    parsed.data.snoozedUntil &&
    new Date(parsed.data.snoozedUntil).getTime() <= Date.now()
  ) {
    return Response.json(
      { error: "Snooze time must be in the future." },
      { status: 400 },
    );
  }
  const { data, error } = await auth.client
    .from("workspace_inbox_items")
    .update({ ...changes, updated_at: timestamp })
    .eq("id", parsed.data.id)
    .eq("recipient_id", auth.userId)
    .select()
    .single();
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ item: data });
}

async function authenticated() {
  const client = await createClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const viewer = await getViewer();
  if (!viewer || viewer.user.id !== user.id) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const, client, userId: user.id, viewer };
}

function relation(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object"
      ? (value[0] as Record<string, unknown>)
      : undefined;
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function priorityRank(value: unknown) {
  return { urgent: 4, high: 3, medium: 2, normal: 2, low: 1 }[
    String(value) as "urgent"
  ] ?? 0;
}
