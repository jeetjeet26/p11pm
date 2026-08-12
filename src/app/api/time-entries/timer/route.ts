import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const startSchema = z.object({
  action: z.literal("start"),
  projectId: z.string().uuid(),
  issueId: z.string().uuid().nullable().optional(),
  retainerPeriodId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(1_000),
  billable: z.boolean().default(true),
});
const stopSchema = z.object({
  action: z.literal("stop"),
  timerId: z.string().uuid(),
  stoppedAt: z.string().datetime().optional(),
});
const actionSchema = z.discriminatedUnion("action", [startSchema, stopSchema]);

export async function GET() {
  const context = await authenticated();
  if (!context.ok) return context.response;
  const { data, error } = await context.client
    .from("time_entry_timers")
    .select("*,project:projects(name,time_rounding_minutes),issue:todos(title,issue_number)")
    .eq("profile_id", context.viewer.profile.id)
    .eq("status", "running")
    .maybeSingle();
  if (error) return databaseError(error);
  return Response.json({ timer: data ?? null });
}

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const context = await authenticated();
  if (!context.ok) return context.response;
  if (parsed.data.action === "start") {
    const { data, error } = await context.client.rpc("start_time_timer", {
      target_project_id: parsed.data.projectId,
      target_todo_id: parsed.data.issueId ?? null,
      target_retainer_period_id: parsed.data.retainerPeriodId ?? null,
      target_description: parsed.data.description,
      target_billable: parsed.data.billable,
    });
    if (error) return databaseError(error);
    return Response.json({ timer: data }, { status: 201 });
  }
  const { data, error } = await context.client.rpc("stop_time_timer", {
    target_timer_id: parsed.data.timerId,
    target_stopped_at: parsed.data.stoppedAt ?? new Date().toISOString(),
  });
  if (error) return databaseError(error);
  return Response.json(data);
}

export async function DELETE(request: Request) {
  const timerId = new URL(request.url).searchParams.get("timerId");
  if (!timerId || !z.string().uuid().safeParse(timerId).success) {
    return Response.json({ error: "Invalid timer." }, { status: 400 });
  }
  const context = await authenticated();
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("discard_time_timer", {
    target_timer_id: timerId,
  });
  if (error) return databaseError(error);
  return Response.json({ timer: data });
}

async function authenticated() {
  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const client = await createClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json({ error: "Supabase is not configured." }, { status: 503 }),
    };
  }
  return { ok: true as const, client, viewer };
}

function databaseError(error: { code?: string; message: string }) {
  const status =
    error.code === "42501"
      ? 403
      : error.code === "P0002"
        ? 404
        : error.code === "55006" || error.code === "23505"
          ? 409
          : 400;
  return Response.json({ error: error.message }, { status });
}
