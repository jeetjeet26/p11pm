import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { getProjectTodosData } from "@/lib/data";
import { isDemoModeAllowed } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

const createTodoSchema = z.object({
  projectId: z.string().uuid().or(z.string().min(2)),
  listId: z.string().uuid().or(z.string().min(2)).nullable().optional(),
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().max(4000).optional(),
  assigneeId: z.string().optional(),
  assigneeIds: z.array(z.string().min(1)).max(50).default([]),
  completionSubscriberIds: z.array(z.string().min(1)).max(50).default([]),
  dueDate: z.string().date().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

const updateTodoSchema = z
  .object({
    id: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    status: z.enum(["open", "in_progress", "blocked", "completed"]).optional(),
    title: z.string().trim().min(2).max(240).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    dueDate: z.string().date().nullable().optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    assigneeIds: z.array(z.string().min(1)).max(50).optional(),
    completionSubscriberIds: z.array(z.string().min(1)).max(50).optional(),
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
  projectId: z.string().min(1),
});

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
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    return Response.json(await getProjectTodosData(parsed.data.projectId));
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
          updated_at: new Date().toISOString(),
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
  const { data, error } = await supabase.rpc("create_project_todo", {
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
      in_progress: "in_progress",
      blocked: "blocked",
      completed: "done",
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
