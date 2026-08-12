import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(10_000).optional(),
  dueDate: z.string().date().nullable().optional(),
  ownerId: z.string().uuid().optional(),
  status: z
    .enum(["upcoming", "in_progress", "completed", "missed", "cancelled"])
    .default("upcoming"),
  riskLevel: z.enum(["none", "low", "medium", "high"]).default("none"),
  riskReason: z.string().trim().max(2_000).nullable().optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  status: z
    .enum(["upcoming", "in_progress", "completed", "missed", "cancelled"])
    .optional(),
  position: z.number().int().min(0).optional(),
  riskLevel: z.enum(["none", "low", "medium", "high"]).optional(),
  riskReason: z.string().trim().max(2_000).nullable().optional(),
});

const reorderSchema = z.object({
  projectId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()).min(1).max(500),
});

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return Response.json({ error: "Invalid project." }, { status: 400 });
  }
  const auth = await authenticated(false);
  if (!auth.ok) return auth.response;
  const { data: project } = await auth.client
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organization_id", auth.viewer.organization.id)
    .maybeSingle();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const { data, error } = await auth.client
    .from("milestones")
    .select("*,issues:todos(id,status,estimated_minutes,actual_minutes,risk_level)")
    .eq("project_id", projectId)
    .order("position")
    .order("due_date");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({
    milestones: (data ?? []).map((milestone) => ({
      ...milestone,
      progress: progress(milestone.issues ?? []),
      at_risk_issue_count: (milestone.issues ?? []).filter(
        (issue: { risk_level: string | null; status: string }) =>
          issue.risk_level === "high" || issue.status === "blocked",
      ).length,
    })),
  });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const auth = await authenticated(true);
  if (!auth.ok) return auth.response;
  const { data: project } = await auth.client
    .from("projects")
    .select("id")
    .eq("id", parsed.data.projectId)
    .eq("organization_id", auth.viewer.organization.id)
    .maybeSingle();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const { data: last } = await auth.client
    .from("milestones")
    .select("position")
    .eq("project_id", parsed.data.projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await auth.client
    .from("milestones")
    .insert({
      project_id: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      due_date: parsed.data.dueDate ?? null,
      owner_id: parsed.data.ownerId ?? null,
      status: parsed.data.status,
      position: (last?.position ?? -1) + 1,
      risk_level: parsed.data.riskLevel,
      risk_reason: parsed.data.riskReason ?? null,
      completed_at:
        parsed.data.status === "completed" ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ milestone: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const reorder = reorderSchema.safeParse(body);
  if (reorder.success) {
    const auth = await authenticated(true);
    if (!auth.ok) return auth.response;
    const { data: project } = await auth.client
      .from("projects")
      .select("id")
      .eq("id", reorder.data.projectId)
      .eq("organization_id", auth.viewer.organization.id)
      .maybeSingle();
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const results = await Promise.all(
      reorder.data.orderedIds.map((id, position) =>
        auth.client
          .from("milestones")
          .update({ position })
          .eq("id", id)
          .eq("project_id", reorder.data.projectId),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ reordered: reorder.data.orderedIds.length });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const auth = await authenticated(true);
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  const { data, error } = await auth.client
    .from("milestones")
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
      ...(input.ownerId !== undefined ? { owner_id: input.ownerId } : {}),
      ...(input.status !== undefined
        ? {
            status: input.status,
            completed_at:
              input.status === "completed" ? new Date().toISOString() : null,
          }
        : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.riskLevel !== undefined ? { risk_level: input.riskLevel } : {}),
      ...(input.riskReason !== undefined ? { risk_reason: input.riskReason } : {}),
    })
    .eq("id", input.id)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ milestone: data });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid milestone." }, { status: 400 });
  }
  const auth = await authenticated(true);
  if (!auth.ok) return auth.response;
  const { data: milestone } = await auth.client
    .from("milestones")
    .select("project:projects!inner(organization_id)")
    .eq("id", id)
    .maybeSingle();
  const project = Array.isArray(milestone?.project)
    ? milestone.project[0]
    : milestone?.project;
  if (!project || project.organization_id !== auth.viewer.organization.id) {
    return Response.json({ error: "Milestone not found." }, { status: 404 });
  }
  const { error } = await auth.client.from("milestones").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return new Response(null, { status: 204 });
}

async function authenticated(managerRequired: boolean) {
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
  const viewer = await getViewer();
  if (!viewer) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (
    managerRequired &&
    viewer.role !== "admin" &&
    viewer.role !== "manager"
  ) {
    return {
      ok: false as const,
      response: Response.json({ error: "Manager access required." }, { status: 403 }),
    };
  }
  return { ok: true as const, client, viewer };
}

function progress(
  issues: Array<{ status: string; estimated_minutes: number | null; actual_minutes: number | null }>,
) {
  if (!issues.length) return 0;
  const estimated = issues.reduce((sum, issue) => sum + (issue.estimated_minutes ?? 0), 0);
  if (estimated > 0) {
    const completed = issues.reduce(
      (sum, issue) =>
        sum +
        (issue.status === "done" || issue.status === "cancelled"
          ? issue.estimated_minutes ?? 0
          : Math.min(issue.actual_minutes ?? 0, issue.estimated_minutes ?? 0)),
      0,
    );
    return Math.round((completed / estimated) * 100);
  }
  return Math.round(
    (issues.filter((issue) => issue.status === "done" || issue.status === "cancelled").length /
      issues.length) *
      100,
  );
}
