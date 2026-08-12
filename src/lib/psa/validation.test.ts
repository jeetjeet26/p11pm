import { describe, expect, it } from "vitest";

import {
  createClientSchema,
  createInvoiceSchema,
  createRetainerSchema,
  createTimeEntrySchema,
  timeEntryQuerySchema,
  updatePaymentSchema,
} from "@/lib/psa/validation";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("PSA validation", () => {
  it("normalizes client defaults and rejects unbounded fields", () => {
    expect(createClientSchema.parse({ name: "Acme" })).toMatchObject({
      name: "Acme",
      status: "active",
    });
    expect(
      createClientSchema.safeParse({ name: "Acme", organizationId: id }).success,
    ).toBe(false);
  });

  it("enforces retainer and invoice date ordering", () => {
    expect(
      createRetainerSchema.safeParse({
        clientId: id,
        name: "Support",
        billingModel: "fixed_fee",
        cadence: "monthly",
        startDate: "2026-08-10",
        endDate: "2026-08-09",
      }).success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({
        clientId: id,
        invoiceNumber: "INV-1",
        issueDate: "2026-08-10",
        dueDate: "2026-08-09",
      }).success,
    ).toBe(false);
  });

  it("accepts form-compatible retainer values", () => {
    expect(
      createRetainerSchema.parse({
        clientId: id,
        name: "Managed support",
        allowanceHours: "40",
        hourlyRate: "125",
        startDate: "2026-08-11",
      }),
    ).toMatchObject({
      allowanceHours: 40,
      hourlyRate: 125,
      status: "draft",
      cadence: "monthly",
    });
  });

  it("bounds time entries and coerces list filters", () => {
    expect(
      createTimeEntrySchema.safeParse({
        clientId: id,
        entryDate: "2026-08-11",
        durationMinutes: 1_441,
      }).success,
    ).toBe(false);
    expect(
      timeEntryQuerySchema.parse({
        limit: "25",
        offset: "10",
        billable: "false",
      }),
    ).toMatchObject({ limit: 25, offset: 10, billable: false });
  });

  it("requires an identifier for payment updates", () => {
    expect(updatePaymentSchema.safeParse({ amount: 100 }).success).toBe(false);
    expect(updatePaymentSchema.safeParse({ id, amount: 100 }).success).toBe(true);
  });
});
