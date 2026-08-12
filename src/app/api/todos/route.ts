import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { decodeIssueCursor, getProjectTodosData } from "@/lib/data";
import { isDemoModeAllowed } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";
import type {
  OperationalState,
  TodoPriority,
  TodoStatus,
} from "@/lib/types";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Invalid identifier.");
const prioritySchema = z.enum(["low", "normal", "medium", "high", "urgent"]);
const issueTypeSchema = z.enum(["task", "story", "bug", "epic"]);
const operationalStateSchema = z.enum(["active", "triage", "historical"]);
const statusSchema = z.enum([
  "open",
  "todo",
  "in_progress",
  "blocked",
  "review",
  "completed",
  "done",
  "cancelled",
]);

const createTodoSchema = z.object({
  projectId: identifierSchema,
  listId: identifierSchema.nullable().optional(),
  title: z.string().trim().min(2).max(300),
  description: z.string().trim().max(10_000).optional(),
  assigneeId: identifierSchema.optional(),
  assigneeIds: z.array(identifierSchema).max(50).default([]),
  completionSubscriberIds: z.array(identifierSchema).max(50).default([]),
  dueDate: z.string().date().optional(),
  priority: prioritySchema.default("medium"),
  issueType: issueTypeSchema.default("task"),
  labels: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
  estimatedMinutes: z.number().int().nonnegative().max(2_147_483_647).optional(),
  actualMinutes: z.number().int().nonnegative().max(2_147_483_647).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

const updateTodoSchema = z
  .object({
    id: identifierSchema,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    status: statusSchema.optional(),
    title: z.string().trim().min(2).max(300).optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    dueDate: z.string().date().nullable().optional(),
    priority: prioritySchema.optional(),
    assigneeIds: z.array(identifierSchema).max(50).optional(),
    completionSubscriberIds: z.array(identifierSchema).max(50).optional(),
    issueType: issueTypeSchema.optional(),
    rank: z.number().int().positive().safe().optional(),
    operationalState: operationalStateSchema.optional(),
    labels: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
    estimatedMinutes: z
      .number()
      .int()
      .nonnegative()
      .max(2_147_483_647)
      .nullable()
      .optional(),
    actualMinutes: z
      .number()
      .int()
      .nonnegative()
      .max(2_147_483_647)
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, field]) =>
          !["id", "expectedVersion", "idempotencyKey"].includes(key) &&
          field !== undefined,
      ),
    "At least one todo field must be updated.",
  );

const querySchema = z.object({
  projectId: identifierSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(8).max(512).optional(),
  q: z.string().trim().max(200).optional(),
  statuses: z.array(z.enum(["all", "open_work", ...statusSchema.options])).max(12),
  priorities: z.array(z.enum(["all", ...prioritySchema.options])).max(6),
  labels: z.array(z.string().trim().min(1).max(50)).max(50),
  assignee: z
    .union([z.literal("all"), z.literal("unassigned"), identifierSchema])
    .optional(),
  due: z
    .enum([
      "all",
      "overdue",
      "due_today",
      "due_soon",
      "no_due_date",
      "has_due_date",
    ])
    .optional(),
  scope: z
    .enum(["current", "all", "active", "triage", "historical"])
    .default("current"),
});

function queryValues(searchParams: URLSearchParams, key: string): string[] {
  return searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeStatuses(values: string[]): TodoStatus[] | undefined {
  if (!values.length || values.includes("all")) return undefined;
  const statuses = new Set<TodoStatus>();
  for (const value of values) {
    if (value === "open_work") {
      statuses.add("open");
      statuses.add("in_progress");
      statuses.add("blocked");
      statuses.add("review");
    } else if (value === "todo") {
      statuses.add("open");
    } else if (value === "done") {
      statuses.add("completed");
    } else {
      statuses.add(value as TodoStatus);
    }
  }
  return [...statuses];
}

function normalizePriorities(values: string[]): TodoPriority[] | undefined {
  if (!values.length || values.includes("all")) return undefined;
  return [
    ...new Set(
      values.map((value) =>
        value === "normal" ? "medium" : (value as TodoPriority),
      ),
    ),
  ];
}

function normalizeScope(
  value: z.infer<typeof querySchema>["scope"],
): OperationalState[] {
  if (value === "current") return ["active", "triage"];
  if (value === "all") return ["active", "triage", "historical"];
  return [value];
}

async function isDemoRequest() {
  return (
    isDemoModeAllowed() &&
    (await cookies()).get("p11-demo")?.value === "true"
  );
}

function rpcErrorStatus(error: { code?: string }): number {
  if (error.code === "40001") return 409;
  if (error.code === "P0002") return 404;
  if (error.code === "42501") return 403;
  return 400;
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    projectId: searchParams.get("projectId"),
    limit: searchParams.get("pageSize") ?? searchParams.get("limit") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    q: searchParams.get("q") ?? searchParams.get("text") ?? undefined,
    statuses: queryValues(searchParams, "status"),
    priorities: queryValues(searchParams, "priority"),
    labels: queryValues(searchParams, "label"),
    assignee:
      searchParams.get("assignee") ??
      searchParams.get("assigneeId") ??
      undefined,
    due:
      searchParams.get("due") ??
      searchParams.get("dueState") ??
      undefined,
    scope:
      searchParams.get("scope") ??
      searchParams.get("operationalScope") ??
      undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const cursor = parsed.data.cursor
    ? decodeIssueCursor(parsed.data.cursor)
    : undefined;
  if (parsed.data.cursor && !cursor) {
    return Response.json({ error: "Invalid issue cursor." }, { status: 400 });
  }
  try {
    return Response.json(
      await getProjectTodosData(parsed.data.projectId, {
        limit: parsed.data.limit,
        cursor,
        filters: {
          statuses: normalizeStatuses(parsed.data.statuses),
          priorities: normalizePriorities(parsed.data.priorities),
          labels: parsed.data.labels.length ? parsed.data.labels : undefined,
          assigneeId:
            parsed.data.assignee &&
            parsed.data.assignee !== "all" &&
            parsed.data.assignee !== "unassigned"
              ? parsed.data.assignee
              : undefined,
          unassigned: parsed.data.assignee === "unassigned",
          dueState:
            parsed.data.due && parsed.data.due !== "all"
              ? parsed.data.due
              : undefined,
          text: parsed.data.q,
          operationalScope: normalizeScope(parsed.data.scope),
        },
      }),
    );
  } catch (error) {
    console.error("Load project todos failed:", error);
    return Response.json({ error: "Unable to load project todos." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const parsed = createTodoSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  if (await isDemoRequest()) {
    const primaryAssignee =
      parsed.data.assigneeIds[0] ?? parsed.data.assigneeId ?? undefined;
    const timestamp = new Date().toISOString();
    const issueNumber = 1;
    return Response.json(
      {
        todo: {
          id: randomUUID(),
          project_id: parsed.data.projectId,
          todo_list_id: parsed.data.listId,
          title: parsed.data.title,
          description: parsed.data.description,
          assigned_to: primaryAssignee,
          assignee_ids:
            parsed.data.assigneeIds.length > 0
              ? parsed.data.assigneeIds
              : primaryAssignee
                ? [primaryAssignee]
                : [],
          completion_subscriber_ids: parsed.data.completionSubscriberIds,
          due_at: parsed.data.dueDate
            ? `${parsed.data.dueDate}T17:00:00.000Z`
            : null,
          status: "todo",
          priority:
            parsed.data.priority === "normal" ? "medium" : parsed.data.priority,
          issue_key: `${parsed.data.projectId.toUpperCase()}-${issueNumber}`,
          issue_number: issueNumber,
          issue_type: parsed.data.issueType,
          rank: 1024,
          operational_state: "active",
          labels: [...new Set(parsed.data.labels)],
          estimated_minutes: parsed.data.estimatedMinutes ?? null,
          actual_minutes: parsed.data.actualMinutes ?? null,
          created_at: timestamp,
          updated_at: timestamp,
          version: 1,
        },
        demo: true,
      },
      { status: 201 },
    );
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const assigneeIds = [
    ...new Set(
      parsed.data.assigneeIds.length
        ? parsed.data.assigneeIds
        : parsed.data.assigneeId
          ? [parsed.data.assigneeId]
          : [],
    ),
  ];
  const { data, error } = await supabase.rpc("create_project_issue", {
    target_project_id: parsed.data.projectId,
    target_todo_list_id: parsed.data.listId ?? null,
    target_title: parsed.data.title,
    target_description: parsed.data.description ?? null,
    target_assignee_ids: assigneeIds,
    target_completion_subscriber_ids: [
      ...new Set(parsed.data.completionSubscriberIds),
    ],
    target_due_at: parsed.data.dueDate
      ? `${parsed.data.dueDate}T17:00:00.000Z`
      : null,
    target_priority:
      parsed.data.priority === "normal" ? "medium" : parsed.data.priority,
    target_issue_type: parsed.data.issueType,
    target_labels: [...new Set(parsed.data.labels)],
    target_estimated_minutes: parsed.data.estimatedMinutes ?? null,
    target_actual_minutes: parsed.data.actualMinutes ?? null,
    requested_actor_id: user.id,
    target_idempotency_key: parsed.data.idempotencyKey ?? randomUUID(),
  });

  if (error) {
    console.error("Create todo failed:", error);
    return Response.json(
      { error: error.message },
      { status: rpcErrorStatus(error) },
    );
  }
  return Response.json({ todo: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateTodoSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  if (await isDemoRequest()) {
    return Response.json({
      todo: {
        ...parsed.data,
        updated_at: new Date().toISOString(),
        version: parsed.data.expectedVersion + 1,
      },
      demo: true,
    });
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const changes: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) {
    changes.status = {
      open: "todo",
      todo: "todo",
      in_progress: "in_progress",
      blocked: "blocked",
      review: "review",
      completed: "done",
      done: "done",
      cancelled: "cancelled",
    }[parsed.data.status];
  }
  if (parsed.data.title !== undefined) changes.title = parsed.data.title;
  if (parsed.data.description !== undefined) {
    changes.description = parsed.data.description;
  }
  if (parsed.data.dueDate !== undefined) {
    changes.due_at = parsed.data.dueDate
      ? `${parsed.data.dueDate}T17:00:00.000Z`
      : null;
  }
  if (parsed.data.priority !== undefined) {
    changes.priority =
      parsed.data.priority === "normal" ? "medium" : parsed.data.priority;
  }
  if (parsed.data.assigneeIds !== undefined) {
    changes.assignee_ids = [...new Set(parsed.data.assigneeIds)];
  }
  if (parsed.data.completionSubscriberIds !== undefined) {
    changes.completion_subscriber_ids = [
      ...new Set(parsed.data.completionSubscriberIds),
    ];
  }
  if (parsed.data.issueType !== undefined) {
    changes.issue_type = parsed.data.issueType;
  }
  if (parsed.data.rank !== undefined) changes.rank = parsed.data.rank;
  if (parsed.data.operationalState !== undefined) {
    changes.operational_state = parsed.data.operationalState;
  }
  if (parsed.data.labels !== undefined) {
    changes.labels = [...new Set(parsed.data.labels)];
  }
  if (parsed.data.estimatedMinutes !== undefined) {
    changes.estimated_minutes = parsed.data.estimatedMinutes;
  }
  if (parsed.data.actualMinutes !== undefined) {
    changes.actual_minutes = parsed.data.actualMinutes;
  }

  const { data, error } = await supabase.rpc("update_project_todo", {
    target_todo_id: parsed.data.id,
    expected_version: parsed.data.expectedVersion,
    changes,
    requested_actor_id: user.id,
    target_idempotency_key: parsed.data.idempotencyKey ?? randomUUID(),
  });
  if (error) {
    console.error("Update todo failed:", error);
    return Response.json(
      { error: error.message },
      { status: rpcErrorStatus(error) },
    );
  }

  return Response.json({ todo: data });
}
