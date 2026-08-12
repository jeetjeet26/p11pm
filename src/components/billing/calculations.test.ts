import { describe, expect, it } from "vitest";

import {
  agingBucket,
  invoiceAgeInDays,
  invoiceBalance,
} from "@/components/billing/calculations";
import {
  createInvoiceSchema,
  createPaymentSchema,
  createTimeInvoiceSchema,
} from "@/lib/psa/validation";

const id = "00000000-0000-4000-8000-000000000001";

describe("billing display calculations", () => {
  it("uses the stored balance and never shows a negative balance", () => {
    expect(invoiceBalance({ total: 1_000, amountPaid: 250, balanceDue: 700 })).toBe(700);
    expect(invoiceBalance({ total: 100, amountPaid: 125 })).toBe(0);
  });

  it("calculates overdue days from the due date", () => {
    const today = new Date(2026, 7, 11);
    expect(invoiceAgeInDays("2026-08-01", "issued", today)).toBe(10);
    expect(invoiceAgeInDays("2026-08-20", "issued", today)).toBe(0);
    expect(invoiceAgeInDays("2026-07-01", "paid", today)).toBe(0);
  });

  it("places overdue invoices in stable aging buckets", () => {
    expect(agingBucket(0)).toBe("Current");
    expect(agingBucket(30)).toBe("1–30 days");
    expect(agingBucket(31)).toBe("31–60 days");
    expect(agingBucket(91)).toBe("90+ days");
  });
});

describe("billing workflow validation", () => {
  it("accepts credit lines without requiring a client-computed signed total", () => {
    const parsed = createInvoiceSchema.safeParse({
      clientId: id,
      invoiceNumber: "INV-100",
      subject: "Monthly services credit",
      issueDate: "2026-08-11",
      dueDate: "2026-09-10",
      currency: "USD",
      lineItems: [
        {
          itemType: "credit",
          description: "Service adjustment",
          quantity: 1,
          unitPrice: 50,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("validates linked time invoice payloads", () => {
    expect(
      createTimeInvoiceSchema.safeParse({
        clientId: id,
        projectId: "00000000-0000-4000-8000-000000000002",
        invoiceNumber: "INV-101",
        subject: "Approved time",
        issueDate: "2026-08-11",
        dueDate: "2026-09-10",
        timeEntryIds: ["00000000-0000-4000-8000-000000000003"],
        taxTotal: 0,
      }).success,
    ).toBe(true);
  });

  it("supports multiple allocations without over-allocating a payment", () => {
    const base = {
      clientId: id,
      paymentDate: "2026-08-11",
      amount: 300,
      currency: "USD",
      method: "bank_transfer" as const,
    };
    expect(
      createPaymentSchema.safeParse({
        ...base,
        allocations: [
          {
            invoiceId: "00000000-0000-4000-8000-000000000002",
            amount: 100,
          },
          {
            invoiceId: "00000000-0000-4000-8000-000000000003",
            amount: 200,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      createPaymentSchema.safeParse({
        ...base,
        allocations: [
          {
            invoiceId: "00000000-0000-4000-8000-000000000002",
            amount: 301,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
