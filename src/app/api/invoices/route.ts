import {
  invoiceUpdateRow,
  invoiceWriteRow,
  mapPsaRow,
  toCents,
} from "@/lib/psa/mappers";
import {
  createPsaRouteHandlers,
  getPsaContext,
  psaDatabaseError,
  psaValidationError,
} from "@/lib/psa/server";
import {
  createInvoiceSchema,
  createTimeInvoiceSchema,
  invoiceQuerySchema,
  updateInvoiceSchema,
} from "@/lib/psa/validation";

const handlers = createPsaRouteHandlers({
  table: "invoices",
  responseKey: "invoices",
  querySchema: invoiceQuerySchema,
  createSchema: createInvoiceSchema,
  updateSchema: updateInvoiceSchema,
  select: "*,invoice_line_items(*)",
  searchColumn: "invoice_number",
  orderColumn: "issue_date",
  fromColumn: "issue_date",
  toColumn: "issue_date",
  filters: {
    id: "id",
    clientId: "client_id",
    status: "status",
  },
  mapCreate: (input) => invoiceWriteRow(input),
  mapUpdate: (input) => invoiceUpdateRow(input),
  createDefaults: (_input, context) => ({ created_by: context.userId }),
});

export const GET = handlers.GET;

export async function PATCH(request: Request) {
  const parsed = updateInvoiceSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message);
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  if (input.status === "issued") {
    if (Object.keys(input).some((key) => key !== "id" && key !== "status")) {
      return psaValidationError("Save invoice changes before issuing it.");
    }
    const { data, error } = await auth.client.rpc("issue_invoice", {
      target_invoice_id: input.id,
    });
    if (error) return psaDatabaseError("issue invoice", error);
    return Response.json({
      invoice: mapPsaRow(data as Record<string, unknown>),
    });
  }

  const update = invoiceUpdateRow(input);
  if (input.status === "void") update.voided_at = new Date().toISOString();
  if (!Object.keys(update).length) {
    return psaValidationError("Provide at least one field to update.");
  }
  if (input.status !== "void") {
    const { data: existing, error: existingError } = await auth.client
      .from("invoices")
      .select("status")
      .eq("id", input.id)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();
    if (existingError) return psaDatabaseError("load invoice", existingError);
    if (!existing) {
      return Response.json({ error: "Invoice not found." }, { status: 404 });
    }
    if (existing.status !== "draft") {
      return psaValidationError("Only draft invoices can be edited.");
    }
  }
  const { data, error } = await auth.client
    .from("invoices")
    .update(update)
    .eq("id", input.id)
    .eq("organization_id", auth.organizationId)
    .select("*,invoice_line_items(*)")
    .maybeSingle();
  if (error) return psaDatabaseError("update invoice", error);
  if (!data) {
    return Response.json({ error: "Invoice not found." }, { status: 404 });
  }
  return Response.json({
    invoice: mapPsaRow(data as Record<string, unknown>),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const timeInvoice = createTimeInvoiceSchema.safeParse(body);
  if (timeInvoice.success) {
    const auth = await getPsaContext();
    if (!auth.ok) return auth.response;
    const input = timeInvoice.data;
    const { data, error } = await auth.client.rpc(
      "create_invoice_from_time_entries",
      {
        target_client_id: input.clientId,
        target_project_id: input.projectId ?? null,
        target_invoice_number: input.invoiceNumber,
        target_issue_date: input.issueDate,
        target_due_date: input.dueDate,
        target_time_entry_ids: input.timeEntryIds,
        target_tax_cents: toCents(input.taxTotal),
      },
    );
    if (error) return psaDatabaseError("create invoice from time", error);
    const invoice = data as Record<string, unknown>;
    if (invoice.id && input.subject) {
      const { data: updated, error: updateError } = await auth.client
        .from("invoices")
        .update({ subject: input.subject })
        .eq("id", String(invoice.id))
        .eq("organization_id", auth.organizationId)
        .select("*")
        .single();
      if (updateError) return psaDatabaseError("set invoice subject", updateError);
      return Response.json(
        { invoice: mapPsaRow(updated as Record<string, unknown>) },
        { status: 201 },
      );
    }
    return Response.json(
      { invoice: mapPsaRow(invoice) },
      { status: 201 },
    );
  }

  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message);
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  if (!input.lineItems?.length) {
    return psaValidationError("At least one invoice line is required.");
  }
  const { data, error } = await auth.client.rpc("create_detailed_invoice", {
    target_client_id: input.clientId,
    target_project_id: input.projectId ?? null,
    target_invoice_number: input.invoiceNumber,
    target_subject: input.subject,
    target_attention_to: input.attentionTo ?? null,
    target_billing_address: input.billingAddress ?? {},
    target_issue_date: input.issueDate,
    target_due_date: input.dueDate,
    target_service_period_start: input.servicePeriodStart ?? null,
    target_service_period_end: input.servicePeriodEnd ?? null,
    target_currency: input.currency,
    target_line_items: input.lineItems.map((line) => ({
      project_id: line.projectId ?? input.projectId ?? null,
      retainer_id: line.retainerId ?? null,
      retainer_period_id: line.retainerPeriodId ?? null,
      item_type: line.itemType,
      description: line.description,
      details: line.details ?? null,
      service_period_start:
        line.servicePeriodStart ?? input.servicePeriodStart ?? null,
      service_period_end:
        line.servicePeriodEnd ?? input.servicePeriodEnd ?? null,
      quantity: line.quantity,
      unit_amount_cents:
        line.itemType === "credit"
          ? -toCents(line.unitPrice)
          : toCents(line.unitPrice),
    })),
    target_tax_cents: toCents(input.taxTotal),
    target_notes: input.notes ?? null,
    target_payment_instructions: input.paymentInstructions ?? null,
    target_payment_terms: input.paymentTerms ?? null,
  });
  if (error) return psaDatabaseError("create invoice", error);
  return Response.json(
    { invoice: mapPsaRow(data as Record<string, unknown>) },
    { status: 201 },
  );
}
