import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const linkSchema = z.object({
  retainerId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export async function POST(request: Request) {
  const parsed = linkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid contract project link." }, { status: 400 });
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase
    .from("retainer_projects")
    .upsert(
      {
        organization_id: auth.organizationId,
        retainer_id: parsed.data.retainerId,
        project_id: parsed.data.projectId,
      },
      { onConflict: "retainer_id,project_id" },
    )
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ link: data });
}

export async function DELETE(request: Request) {
  const parsed = linkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid contract project link." }, { status: 400 });
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const { error } = await auth.supabase
    .from("retainer_projects")
    .delete()
    .eq("organization_id", auth.organizationId)
    .eq("retainer_id", parsed.data.retainerId)
    .eq("project_id", parsed.data.projectId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return new Response(null, { status: 204 });
}

async function managerContext() {
  const viewer = await getViewer();
  if (!viewer) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!viewer.capabilities.commercialWrite) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Manager access required." },
        { status: 403 },
      ),
    };
  }
  const supabase = await createClient();
  if (!supabase) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  return { ok: true as const, supabase, organizationId: viewer.organization.id };
}
