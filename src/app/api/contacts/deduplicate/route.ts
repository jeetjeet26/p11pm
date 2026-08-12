import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const mergeSchema = z.object({
  targetContactId: z.string().uuid(),
  duplicateContactId: z.string().uuid(),
});

export async function GET() {
  const auth = await context();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase
    .from("contacts")
    .select("id,first_name,last_name,email,status,updated_at,client_contacts(client_id)")
    .eq("organization_id", auth.organizationId)
    .not("email", "is", null)
    .order("email")
    .limit(1_000);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  const grouped = new Map<string, typeof data>();
  for (const contact of data ?? []) {
    const email = contact.email?.trim().toLowerCase();
    if (!email) continue;
    grouped.set(email, [...(grouped.get(email) ?? []), contact]);
  }
  return Response.json({
    duplicates: [...grouped.entries()]
      .filter(([, contacts]) => contacts.length > 1)
      .map(([email, contacts]) => ({ email, contacts })),
  });
}

export async function POST(request: Request) {
  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid contact merge." }, { status: 400 });
  }
  const auth = await context();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase.rpc("merge_workspace_contacts", {
    target_contact_id: parsed.data.targetContactId,
    duplicate_contact_id: parsed.data.duplicateContactId,
  });
  if (error) {
    return Response.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }
  return Response.json({ contact: data });
}

async function context() {
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
        { error: "Commercial management access required." },
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
