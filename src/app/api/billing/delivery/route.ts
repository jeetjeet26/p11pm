import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  canSendInvoiceEmail,
  sendInvoiceDeliveryEmail,
} from "@/lib/email/invoice-delivery";
import { getPsaContext, psaDatabaseError, psaValidationError } from "@/lib/psa/server";

const queueSchema = z.object({
  invoiceId: z.string().uuid(),
  recipientEmail: z.string().email(),
  deliveryMethod: z.enum(["email", "portal", "manual"]).default("email"),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

export async function POST(request: Request) {
  const parsed = queueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message ?? "Invalid delivery request.");
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  const idempotencyKey = input.idempotencyKey ?? `delivery:${input.invoiceId}:${input.recipientEmail}`;

  const { data: delivery, error } = await auth.client.rpc("queue_invoice_delivery", {
    target_invoice_id: input.invoiceId,
    target_recipient_email: input.recipientEmail,
    target_delivery_method: input.deliveryMethod,
    target_idempotency_key: idempotencyKey,
  });
  if (error) return psaDatabaseError("queue invoice delivery", error);

  if (input.deliveryMethod === "email" && canSendInvoiceEmail()) {
    const { data: invoice, error: invoiceError } = await auth.client
      .from("invoices")
      .select("id,invoice_number,due_date,total_cents,currency,client:clients(name)")
      .eq("id", input.invoiceId)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();
    if (invoiceError) return psaDatabaseError("load invoice for delivery", invoiceError);
    if (invoice) {
      const client = Array.isArray(invoice.client) ? invoice.client[0] : invoice.client;
      const result = await sendInvoiceDeliveryEmail({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        recipientEmail: input.recipientEmail,
        clientName: client?.name ?? "Client",
        total: new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: invoice.currency,
        }).format(Number(invoice.total_cents) / 100),
        dueDate: invoice.due_date ?? "",
      });
      await auth.client.rpc("mark_invoice_delivery_attempt", {
        target_delivery_id: (delivery as { id: string }).id,
        target_status: result.sent ? "sent" : "failed",
        target_provider: result.provider ?? null,
        target_provider_message_id: result.messageId ?? null,
        target_response: result,
        target_error_message: result.error ?? null,
      });
    }
  }

  return Response.json({ delivery }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = z
    .object({
      deliveryId: z.string().uuid(),
      status: z.enum(["queued", "sent", "failed", "cancelled"]),
      errorMessage: z.string().optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message ?? "Invalid delivery update.");
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const { error } = await auth.client.rpc("mark_invoice_delivery_attempt", {
    target_delivery_id: parsed.data.deliveryId,
    target_status: parsed.data.status,
    target_provider: "manual",
    target_provider_message_id: randomUUID(),
    target_response: {},
    target_error_message: parsed.data.errorMessage ?? null,
  });
  if (error) return psaDatabaseError("update invoice delivery", error);
  return Response.json({ ok: true });
}
