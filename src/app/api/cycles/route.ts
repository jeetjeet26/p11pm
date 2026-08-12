import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const statusSchema = z.enum(["planned", "active", "completed", "cancelled"]);
const createSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(5_000).nullable().optional(),
    startsOn: z.string().date(),
    endsOn: z.string().date(),
    status: statusSchema.default("planned"),
  })
  .refine((value) => value.endsOn >= value.startsOn, {
    message: "Cycle end must be on or after its start.",
  });
const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  goal: z.string().trim().max(5_000).nullable().optional(),
  startsOn: z.string().date().optional(),
  endsOn: z.string().date().optional(),
  status: statusSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return Response.json({ error: "Invalid project." }, { status: 400 });
  }
  const context = await contextFor(false);
  if (!context.ok) return context.response;
  const { data, error } = await context.client
    .from("project_cycles")
    .select("*,issues:todos(id,status,estimated_minutes,actual_minutes,risk_level)")
    .eq("project_id", projectId)
    .eq("organization_id", context.viewer.organization.id)
    .order("position")
    .order("starts_on");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({
    cycles: (data ?? []).map((cycle) => ({
      ...cycle,
      progress: issueProgress(cycle.issues ?? []),
      at_risk_issue_count: (cycle.issues ?? []).filter(
        (issue: { risk_level: string | null; status: string }) =>
          issue.risk_level === "high" || issue.status === "blocked",
      ).length,
    })),
  });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const context = await contextFor(true);
  if (!context.ok) return context.response;
  const { data: project } = await context.client
    .from("projects")
    .select("id")
    .eq("id", parsed.data.projectId)
    .eq("organization_id", context.viewer.organization.id)
    .maybeSingle();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const { data: last } = await context.client
    .from("project_cycles")
    .select("position")
    .eq("project_id", parsed.data.projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await context.client
    .from("project_cycles")
    .insert({
      organization_id: context.viewer.organization.id,
      project_id: parsed.data.projectId,
      name: parsed.data.name,
      goal: parsed.data.goal ?? null,
      starts_on: parsed.data.startsOn,
      ends_on: parsed.data.endsOn,
      status: parsed.data.status,
      position: (last?.position ?? -1) + 1,
      completed_at: parsed.data.status === "completed" ? new Date().toISOString() : null,
      created_by: context.viewer.profile.id,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ cycle: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const context = await contextFor(true);
  if (!context.ok) return context.response;
  const input = parsed.data;
  const { data, error } = await context.client
    .from("project_cycles")
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.startsOn !== undefined ? { starts_on: input.startsOn } : {}),
      ...(input.endsOn !== undefined ? { ends_on: input.endsOn } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.status !== undefined
        ? {
            status: input.status,
            completed_at: input.status === "completed" ? new Date().toISOString() : null,
          }
        : {}),
    })
    .eq("id", input.id)
    .eq("organization_id", context.viewer.organization.id)
    .select()
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Cycle not found." }, { status: 404 });
  return Response.json({ cycle: data });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid cycle." }, { status: 400 });
  }
  const context = await contextFor(true);
  if (!context.ok) return context.response;
  const { error } = await context.client
    .from("project_cycles")
    .delete()
    .eq("id", id)
    .eq("organization_id", context.viewer.organization.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return new Response(null, { status: 204 });
}

async function contextFor(managerRequired: boolean) {
  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (managerRequired && viewer.role !== "admin" && viewer.role !== "manager") {
    return {
      ok: false as const,
      response: Response.json({ error: "Manager access required." }, { status: 403 }),
    };
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

function issueProgress(
  issues: Array<{ status: string; estimated_minutes: number | null; actual_minutes: number | null }>,
) {
  if (!issues.length) return 0;
  const estimate = issues.reduce((sum, issue) => sum + (issue.estimated_minutes ?? 0), 0);
  if (!estimate) {
    return Math.round(
      (issues.filter((issue) => issue.status === "done" || issue.status === "cancelled").length /
        issues.length) *
        100,
    );
  }
  return Math.round(
    (issues.reduce(
      (sum, issue) =>
        sum +
        (issue.status === "done" || issue.status === "cancelled"
          ? issue.estimated_minutes ?? 0
          : Math.min(issue.actual_minutes ?? 0, issue.estimated_minutes ?? 0)),
      0,
    ) /
      estimate) *
      100,
  );
}
