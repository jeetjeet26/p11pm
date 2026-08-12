import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const mutationSchema = z.object({
  projectId: z.string().uuid(),
  contactId: z.string().uuid(),
  role: z.string().trim().max(160).nullable().optional(),
  isPrimary: z.boolean().default(false),
});

export async function POST(request: Request) {
  const parsed = mutationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid stakeholder." },
      { status: 400 },
    );
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const { projectId, contactId, role, isPrimary } = parsed.data;
  if (isPrimary) {
    await auth.supabase
      .from("project_contacts")
      .update({ is_primary: false })
      .eq("organization_id", auth.organizationId)
      .eq("project_id", projectId);
  }
  const { data, error } = await auth.supabase
    .from("project_contacts")
    .upsert(
      {
        organization_id: auth.organizationId,
        project_id: projectId,
        contact_id: contactId,
        role: role || null,
        is_primary: isPrimary,
      },
      { onConflict: "project_id,contact_id" },
    )
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ stakeholder: data });
}

export async function DELETE(request: Request) {
  const parsed = z
    .object({ id: z.string().uuid() })
    .safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid stakeholder." }, { status: 400 });
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const { error } = await auth.supabase
    .from("project_contacts")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organization_id", auth.organizationId);
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
  return {
    ok: true as const,
    supabase,
    organizationId: viewer.organization.id,
  };
}
