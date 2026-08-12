import { z } from "zod";

import { getPsaContext, psaDatabaseError, psaValidationError } from "@/lib/psa/server";

const collectionsSchema = z.object({
  invoiceId: z.string().uuid(),
  collectionOwnerId: z.string().uuid().nullable().optional(),
  promisedPaymentDate: z.string().nullable().optional(),
  collectionNotes: z.string().max(2000).nullable().optional(),
  collectionPromiseNotes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(request: Request) {
  const parsed = collectionsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message ?? "Invalid collections update.");
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  const { data, error } = await auth.client
    .from("invoices")
    .update({
      collection_owner_id: input.collectionOwnerId ?? null,
      promised_payment_date: input.promisedPaymentDate ?? null,
      collection_notes: input.collectionNotes ?? null,
      collection_promise_notes: input.collectionPromiseNotes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.invoiceId)
    .eq("organization_id", auth.organizationId)
    .select("*")
    .single();
  if (error) return psaDatabaseError("update invoice collections", error);
  return Response.json({ invoice: data });
}

export async function GET() {
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await auth.client
    .from("invoices")
    .select(
      "id,invoice_number,status,due_date,balance_cents,currency,promised_payment_date,collection_notes,collection_promise_notes,collection_owner_id,client:clients(name)",
    )
    .eq("organization_id", auth.organizationId)
    .in("status", ["issued", "partially_paid", "overdue"])
    .gt("balance_cents", 0)
    .order("due_date", { ascending: true })
    .limit(200);
  if (error) return psaDatabaseError("load collections queue", error);
  return Response.json({
    invoices: data ?? [],
    overdueCount: (data ?? []).filter(
      (invoice) => invoice.due_date && invoice.due_date < today,
    ).length,
  });
}
