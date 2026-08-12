import "server-only";

export interface InvoiceDeliveryPayload {
  invoiceId: string;
  invoiceNumber: string;
  recipientEmail: string;
  clientName: string;
  total: string;
  dueDate: string;
}

export interface InvoiceDeliveryResult {
  sent: boolean;
  skipped: boolean;
  provider?: string;
  messageId?: string;
  error?: string;
}

export function canSendInvoiceEmail() {
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendInvoiceDeliveryEmail(
  payload: InvoiceDeliveryPayload,
): Promise<InvoiceDeliveryResult> {
  if (!canSendInvoiceEmail()) {
    return {
      sent: false,
      skipped: true,
      error: "Email provider is not configured.",
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.INVOICE_DELIVERY_FROM ?? "billing@example.com",
      to: [payload.recipientEmail],
      subject: `Invoice ${payload.invoiceNumber} from ${payload.clientName}`,
      text: [
        `Invoice ${payload.invoiceNumber} is ready.`,
        `Amount due: ${payload.total}`,
        `Due date: ${payload.dueDate}`,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    return {
      sent: false,
      skipped: false,
      provider: "resend",
      error: errorBody || `Resend request failed with ${response.status}.`,
    };
  }

  const result = (await response.json()) as { id?: string };
  return {
    sent: true,
    skipped: false,
    provider: "resend",
    messageId: result.id,
  };
}
