import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canSendInvoiceEmail,
  sendInvoiceDeliveryEmail,
} from "@/lib/email/invoice-delivery";

describe("invoice delivery email", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("skips delivery when provider is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(canSendInvoiceEmail()).toBe(false);
    await expect(
      sendInvoiceDeliveryEmail({
        invoiceId: "inv-1",
        invoiceNumber: "INV-001",
        recipientEmail: "billing@example.com",
        clientName: "Client",
        total: "$100.00",
        dueDate: "2026-09-01",
      }),
    ).resolves.toMatchObject({ sent: false, skipped: true });
  });

  it("never sends email in test environment", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    expect(canSendInvoiceEmail()).toBe(false);
  });
});
