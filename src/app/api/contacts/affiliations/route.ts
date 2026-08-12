import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const affiliationSchema = z.object({
  clientId: z.string().uuid(),
  contactId: z.string().uuid(),
  role: z.string().trim().max(160).nullable().optional(),
  position: z.string().trim().max(160).nullable().optional(),
  isPrimary: z.boolean().default(false),
  receivesInvoices: z.boolean().default(false),
});

export async function POST(request: Request) {
  const parsed = affiliationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid affiliation." },
      { status: 400 },
    );
  }
  const auth = await commercialContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  if (input.isPrimary) {
    await auth.supabase
      .from("client_contacts")
      .update({ is_primary: false })
      .eq("organization_id", auth.organizationId)
      .eq("client_id", input.clientId);
  }
  const { data, error } = await auth.supabase
    .from("client_contacts")
    .upsert(
      {
        organization_id: auth.organizationId,
        client_id: input.clientId,
        contact_id: input.contactId,
        role: input.role || null,
        position: input.position || null,
        is_primary: input.isPrimary,
        receives_invoices: input.receivesInvoices,
      },
      { onConflict: "client_id,contact_id" },
    )
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ affiliation: data });
}

export async function DELETE(request: Request) {
  const parsed = z
    .object({ id: z.string().uuid() })
    .safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid affiliation." }, { status: 400 });
  }
  const auth = await commercialContext();
  if (!auth.ok) return auth.response;
  const { error } = await auth.supabase
    .from("client_contacts")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organization_id", auth.organizationId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return new Response(null, { status: 204 });
}

async function commercialContext() {
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
