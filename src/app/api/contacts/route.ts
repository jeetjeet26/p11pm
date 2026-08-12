import { contactWriteRow, mapPsaRow } from "@/lib/psa/mappers";
import {
  createPsaRouteHandlers,
  getPsaContext,
  psaDatabaseError,
  psaValidationError,
} from "@/lib/psa/server";
import {
  contactQuerySchema,
  createContactSchema,
  updateContactSchema,
} from "@/lib/psa/validation";

const handlers = createPsaRouteHandlers({
  table: "contacts",
  responseKey: "contacts",
  querySchema: contactQuerySchema,
  createSchema: createContactSchema,
  updateSchema: updateContactSchema,
  select: "*,client_contacts(client_id,role,is_primary)",
  searchColumn: "last_name",
  orderColumn: "last_name",
  filters: {
    id: "id",
    status: "status",
    clientId: "client_contacts.client_id",
  },
  mapCreate: (input) => contactWriteRow(input),
  mapUpdate: (input) => contactWriteRow(input),
  createDefaults: (_input, context) => ({ created_by: context.userId }),
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;

export async function POST(request: Request) {
  const parsed = createContactSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message);
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;

  const { clientId, role, isPrimary, reuseExisting } = parsed.data;
  if (parsed.data.email && reuseExisting !== false) {
    const { data: matches, error: matchError } = await auth.client
      .from("contacts")
      .select("*")
      .eq("organization_id", auth.organizationId)
      .eq("email", parsed.data.email.toLowerCase())
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(2);
    if (matchError) return psaDatabaseError("check contact duplicates", matchError);
    const existing = matches?.[0];
    if (existing) {
      if (clientId) {
        const { error: linkError } = await auth.client
          .from("client_contacts")
          .upsert(
            {
              organization_id: auth.organizationId,
              client_id: clientId,
              contact_id: existing.id,
              role: role ?? null,
              is_primary: isPrimary ?? false,
            },
            { onConflict: "client_id,contact_id" },
          );
        if (linkError) return psaDatabaseError("link existing contact", linkError);
      }
      return Response.json(
        { contact: mapPsaRow(existing), reused: true },
        { status: 200 },
      );
    }
  }
  const { data, error } = await auth.client
    .from("contacts")
    .insert({
      organization_id: auth.organizationId,
      created_by: auth.userId,
      ...contactWriteRow(parsed.data),
    })
    .select("*")
    .single();
  if (error) return psaDatabaseError("create contact", error);

  if (clientId) {
    const { error: linkError } = await auth.client.from("client_contacts").insert({
      organization_id: auth.organizationId,
      client_id: clientId,
      contact_id: data.id,
      role: role ?? null,
      is_primary: isPrimary ?? false,
    });
    if (linkError) {
      await auth.client
        .from("contacts")
        .delete()
        .eq("id", data.id)
        .eq("organization_id", auth.organizationId);
      return psaDatabaseError("link contact to client", linkError);
    }
  }
  return Response.json({ contact: mapPsaRow(data) }, { status: 201 });
}
