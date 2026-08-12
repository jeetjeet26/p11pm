import { randomUUID } from "node:crypto";

import { mapPsaRow, paymentUpdateRow, toCents } from "@/lib/psa/mappers";
import {
  createPsaRouteHandlers,
  getPsaContext,
  psaDatabaseError,
  psaValidationError,
} from "@/lib/psa/server";
import {
  createPaymentSchema,
  paymentQuerySchema,
  updatePaymentSchema,
} from "@/lib/psa/validation";

const handlers = createPsaRouteHandlers({
  table: "payments",
  responseKey: "payments",
  querySchema: paymentQuerySchema,
  createSchema: createPaymentSchema,
  updateSchema: updatePaymentSchema,
  select: "*,payment_allocations(*)",
  searchColumn: "reference",
  orderColumn: "payment_date",
  fromColumn: "payment_date",
  toColumn: "payment_date",
  filters: {
    id: "id",
    clientId: "client_id",
    invoiceId: "payment_allocations.invoice_id",
  },
  mapUpdate: (input) => paymentUpdateRow(input),
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;

export async function POST(request: Request) {
  const parsed = createPaymentSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message);
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  const invoiceId = input.invoiceId ?? input.allocations?.[0]?.invoiceId;
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  if (input.allocations && input.allocations.length > 1) {
    const invoiceIds = input.allocations.map((allocation) => allocation.invoiceId);
    const { data: invoices, error: invoiceError } = await auth.client
      .from("invoices")
      .select("id,client_id,currency,status,balance_cents")
      .eq("organization_id", auth.organizationId)
      .in("id", invoiceIds);
    if (invoiceError) return psaDatabaseError("validate payment invoices", invoiceError);
    if (
      invoices?.length !== invoiceIds.length ||
      invoices.some(
        (invoice) =>
          invoice.client_id !== input.clientId ||
          invoice.currency !== input.currency ||
          invoice.status === "draft" ||
          invoice.status === "void",
      )
    ) {
      return psaValidationError(
        "All allocations must target open invoices for this client and currency.",
      );
    }
    const allocationByInvoice = new Map(
      input.allocations.map((allocation) => [allocation.invoiceId, allocation.amount]),
    );
    if (
      invoices.some(
        (invoice) =>
          (allocationByInvoice.get(invoice.id) ?? 0) >
          Number(invoice.balance_cents) / 100,
      )
    ) {
      return psaValidationError("An allocation exceeds an invoice balance.");
    }
    const totalAllocated = input.allocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    const { data: payment, error: paymentError } = await auth.client.rpc(
      "allocate_payment_multi",
      {
        target_client_id: input.clientId,
        target_payment_date: input.paymentDate,
        target_method: input.method,
        target_reference: input.reference ?? null,
        target_idempotency_key: idempotencyKey,
        target_currency: input.currency,
        target_allocations: input.allocations.map((allocation) => ({
          invoice_id: allocation.invoiceId,
          amount_cents: toCents(allocation.amount),
        })),
      },
    );
    if (paymentError) return psaDatabaseError("allocate client payment", paymentError);
    if (
      Math.abs(totalAllocated - input.amount) > 0.009 &&
      input.allocations.length > 1
    ) {
      return psaValidationError("Multi-invoice payment amount must equal allocation totals.");
    }
    const paymentRow = payment as Record<string, unknown>;
    if (input.notes && paymentRow.id) {
      await auth.client
        .from("payments")
        .update({ notes: input.notes })
        .eq("id", String(paymentRow.id))
        .eq("organization_id", auth.organizationId);
      paymentRow.notes = input.notes;
    }
    return Response.json({ payment: mapPsaRow(paymentRow) }, { status: 201 });
  }

  if (invoiceId) {
    const { data, error } = await auth.client.rpc("record_client_payment", {
      target_client_id: input.clientId,
      target_invoice_id: invoiceId,
      target_amount_cents: toCents(input.amount),
      target_payment_date: input.paymentDate,
      target_method: input.method,
      target_reference: input.reference ?? null,
      target_idempotency_key: idempotencyKey,
    });
    if (error) return psaDatabaseError("record client payment", error);
    const payment = data as Record<string, unknown>;
    if (input.notes && payment.id) {
      await auth.client
        .from("payments")
        .update({ notes: input.notes })
        .eq("id", String(payment.id))
        .eq("organization_id", auth.organizationId);
      payment.notes = input.notes;
    }
    return Response.json(
      { payment: mapPsaRow(payment) },
      { status: 201 },
    );
  }

  const { data, error } = await auth.client
    .from("payments")
    .insert({
      organization_id: auth.organizationId,
      client_id: input.clientId,
      amount_cents: toCents(input.amount),
      currency: input.currency,
      payment_date: input.paymentDate,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      idempotency_key: idempotencyKey,
      received_by: auth.userId,
    })
    .select("*")
    .single();
  if (error) return psaDatabaseError("record client payment", error);
  return Response.json(
    { payment: mapPsaRow(data as Record<string, unknown>) },
    { status: 201 },
  );
}
