import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { isDemoModeAllowed } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  todoId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  completed: z.boolean(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

async function isDemo() {
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

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  if (await isDemo()) {
    return Response.json(
      {
        subtask: {
          id: randomUUID(),
          todo_id: parsed.data.todoId,
          title: parsed.data.title,
          position: 0,
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

  const { data, error } = await supabase.rpc("create_project_subtask", {
    target_todo_id: parsed.data.todoId,
    target_title: parsed.data.title,
    requested_actor_id: user.id,
    target_idempotency_key: parsed.data.idempotencyKey ?? randomUUID(),
  });
  if (error) {
    return Response.json(
      { error: error.message },
      { status: rpcErrorStatus(error) },
    );
  }
  return Response.json({ subtask: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  if (await isDemo()) {
    return Response.json({
      subtask: {
        id: parsed.data.id,
        completed_at: parsed.data.completed ? new Date().toISOString() : null,
        completed_by: parsed.data.completed ? "sam" : null,
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

  const { data, error } = await supabase.rpc("update_project_subtask", {
    target_subtask_id: parsed.data.id,
    expected_version: parsed.data.expectedVersion,
    target_completed: parsed.data.completed,
    requested_actor_id: user.id,
    target_idempotency_key: parsed.data.idempotencyKey ?? randomUUID(),
  });
  if (error) {
    return Response.json(
      { error: error.message },
      { status: rpcErrorStatus(error) },
    );
  }
  return Response.json({ subtask: data });
}
