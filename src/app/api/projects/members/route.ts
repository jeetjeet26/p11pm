import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  projectId: z.string().uuid(),
  members: z
    .array(
      z.object({
        profileId: z.string().uuid(),
        role: z.enum(["lead", "member", "reviewer", "client"]),
        allocationPercent: z.number().int().min(0).max(100).nullable().optional(),
      }),
    )
    .max(500),
});

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  const parsedId = z.string().uuid().safeParse(projectId);
  if (!parsedId.success) {
    return Response.json({ error: "Invalid project." }, { status: 400 });
  }
  const context = await managerContext();
  if (!context.ok) return context.response;
  const { data: project } = await context.client
    .from("projects")
    .select("id")
    .eq("id", parsedId.data)
    .eq("organization_id", context.viewer.organization.id)
    .maybeSingle();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const [profilesResult, membersResult, allocationsResult] = await Promise.all([
    context.client
      .from("profiles")
      .select("id,full_name,title,weekly_capacity_minutes,status")
      .eq("organization_id", context.viewer.organization.id)
      .eq("status", "active")
      .order("full_name"),
    context.client
      .from("project_members")
      .select("profile_id,role,allocation_percent")
      .eq("project_id", parsedId.data),
    context.client
      .from("project_members")
      .select("profile_id,allocation_percent,project:projects!inner(status,organization_id)")
      .eq("project.organization_id", context.viewer.organization.id)
      .in("project.status", ["planning", "active", "on_hold"]),
  ]);
  const firstError =
    profilesResult.error ?? membersResult.error ?? allocationsResult.error;
  if (firstError) return Response.json({ error: firstError.message }, { status: 400 });
  const totals = new Map<string, number>();
  for (const allocation of allocationsResult.data ?? []) {
    totals.set(
      allocation.profile_id,
      (totals.get(allocation.profile_id) ?? 0) + (allocation.allocation_percent ?? 0),
    );
  }
  const memberMap = new Map(
    (membersResult.data ?? []).map((member) => [member.profile_id, member]),
  );
  return Response.json({
    members: (profilesResult.data ?? []).map((profile) => {
      const member = memberMap.get(profile.id);
      const totalAllocationPercent = totals.get(profile.id) ?? 0;
      return {
        profileId: profile.id,
        name: profile.full_name,
        title: profile.title,
        weeklyCapacityMinutes: profile.weekly_capacity_minutes,
        role: member?.role ?? "member",
        allocationPercent: member?.allocation_percent ?? null,
        currentAllocationPercent: member?.allocation_percent ?? 0,
        selected: Boolean(member),
        totalAllocationPercent,
        allocatedMinutes: Math.round(
          (profile.weekly_capacity_minutes * totalAllocationPercent) / 100,
        ),
        capacityState:
          totalAllocationPercent > 100
            ? "over"
            : totalAllocationPercent >= 85
              ? "near"
              : "available",
      };
    }),
  });
}

export async function PUT(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid project members." },
      { status: 400 },
    );
  }
  const context = await managerContext();
  if (!context.ok) return context.response;
  const { viewer, client } = context;
  const { data: project } = await client
    .from("projects")
    .select("id")
    .eq("id", parsed.data.projectId)
    .eq("organization_id", viewer.organization.id)
    .single();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const requestedIds = [...new Set(parsed.data.members.map((member) => member.profileId))];
  if (requestedIds.length) {
    const { data: profiles, error: profilesError } = await client
      .from("profiles")
      .select("id")
      .eq("organization_id", viewer.organization.id)
      .eq("status", "active")
      .in("id", requestedIds);
    if (profilesError) return Response.json({ error: profilesError.message }, { status: 400 });
    if ((profiles ?? []).length !== requestedIds.length) {
      return Response.json(
        { error: "Every project member must be active in this organization." },
        { status: 400 },
      );
    }
  }

  const rows = parsed.data.members.map((member) => ({
    project_id: parsed.data.projectId,
    profile_id: member.profileId,
    role: member.role,
    allocation_percent: member.allocationPercent ?? null,
  }));
  if (rows.length) {
    const { error } = await client
      .from("project_members")
      .upsert(rows, { onConflict: "project_id,profile_id" });
    if (error) return Response.json({ error: error.message }, { status: 400 });
  }
  const retainedIds = rows.map((row) => row.profile_id);
  let deleteQuery = client
    .from("project_members")
    .delete()
    .eq("project_id", parsed.data.projectId);
  if (retainedIds.length) {
    deleteQuery = deleteQuery.not("profile_id", "in", `(${retainedIds.join(",")})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 400 });
  }
  return Response.json({ members: rows });
}

async function managerContext() {
  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (viewer.role !== "admin" && viewer.role !== "manager") {
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
