export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "void";

export interface InvoiceAmounts {
  total: number;
  amountPaid: number;
  balanceDue?: number | null;
}

export function invoiceBalance(invoice: InvoiceAmounts) {
  return Math.max(
    0,
    invoice.balanceDue ?? invoice.total - invoice.amountPaid,
  );
}

export function invoiceAgeInDays(
  dueDate: string | null,
  status: InvoiceStatus,
  today = new Date(),
) {
  if (!dueDate || status === "paid" || status === "void") return 0;
  const due = new Date(`${dueDate}T00:00:00`);
  const current = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.max(
    0,
    Math.floor((current.getTime() - due.getTime()) / 86_400_000),
  );
}

export function agingBucket(days: number) {
  if (days <= 0) return "Current";
  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "90+ days";
}

export function formatMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
