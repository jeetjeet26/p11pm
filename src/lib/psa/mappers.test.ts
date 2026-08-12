import { describe, expect, it } from "vitest";

import {
  clientWriteRow,
  mapPsaRow,
  mapPsaRows,
  retainerWriteRow,
  toDatabaseRow,
  toDatabaseUpdate,
} from "@/lib/psa/mappers";

describe("PSA mappers", () => {
  it("camel-cases rows and compatible nested relations", () => {
    expect(
      mapPsaRow({
        invoice_number: "INV-42",
        amount_paid: "12.50",
        payment_allocations: [
          { invoice_id: "invoice-id", created_at: "2026-08-11T00:00:00Z" },
        ],
      }),
    ).toEqual({
      invoiceNumber: "INV-42",
      amountPaid: "12.50",
      paymentAllocations: [
        { invoiceId: "invoice-id", createdAt: "2026-08-11T00:00:00Z" },
      ],
    });
  });

  it("maps lists without changing scalar values", () => {
    expect(mapPsaRows([{ duration_minutes: 30 }, { billable: false }])).toEqual([
      { durationMinutes: 30 },
      { billable: false },
    ]);
  });

  it("snake-cases validated writes and omits undefined values", () => {
    expect(
      toDatabaseRow({
        clientId: "client-id",
        billingEmail: null,
        ownerId: undefined,
      }),
    ).toEqual({
      client_id: "client-id",
      billing_email: null,
    });
  });

  it("never includes the route identifier in an update", () => {
    expect(
      toDatabaseUpdate({
        id: "row-id",
        dueDate: "2026-09-01",
        notes: null,
      }),
    ).toEqual({ due_date: "2026-09-01", notes: null });
  });

  it("keeps fixed contract value independent from included hours", () => {
    expect(
      retainerWriteRow({
        clientId: "client-id",
        name: "Support",
        allowanceHours: 40,
        hourlyRate: 125,
        value: 5000,
        allowanceType: "fixed_value",
      }),
    ).toMatchObject({
      client_id: "client-id",
      included_minutes: 2_400,
      fee_cents: 500_000,
      overage_rate_cents: 12_500,
      allowance_type: "fixed_value",
    });
  });

  it("maps canonical client ownership and hierarchy columns", () => {
    expect(
      clientWriteRow({
        name: "Acme Holdings",
        ownerId: "owner-id",
        parentClientId: "parent-id",
        industry: "Software",
      }),
    ).toEqual({
      name: "Acme Holdings",
      account_owner_id: "owner-id",
      parent_client_id: "parent-id",
      metadata: { industry: "Software" },
    });
  });

  it("adds money and duration aliases to database responses", () => {
    expect(
      mapPsaRow({
        minutes: 90,
        subtotal_cents: 12_500,
        balance_cents: 2_500,
      }),
    ).toMatchObject({
      durationMinutes: 90,
      subtotal: 125,
      balanceDue: 25,
    });
  });
});
