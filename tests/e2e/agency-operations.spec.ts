import { expect, test } from "@playwright/test";

const authenticated = Boolean(process.env.PLAYWRIGHT_STORAGE_STATE_PATH);
const mutationsEnabled =
  authenticated && process.env.PLAYWRIGHT_PSA_MUTATION_TESTS === "1";

test.describe("agency operations", () => {
  test.skip(!authenticated, "Agency operations requires an authenticated workspace.");

  test("core workspaces load from the primary Supabase project", async ({ page }) => {
    for (const [path, heading] of [
      ["/clients", "Clients"],
      ["/retainers", "Retainers"],
      ["/time", "Time"],
      ["/billing", "Billing"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
  });

  test("client to cash workflow remains connected", async ({ page }) => {
    test.skip(
      !mutationsEnabled,
      "Set PLAYWRIGHT_PSA_MUTATION_TESTS=1 against an isolated QA database.",
    );
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const clientResponse = await page.request.post("/api/clients", {
      data: {
        name: `E2E Client ${suffix}`,
        status: "active",
        billingEmail: `billing-${suffix}@example.com`,
      },
    });
    expect(clientResponse.status()).toBe(201);
    const client = (await clientResponse.json()).client as { id: string };

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: `E2E Project ${suffix}`,
        code: `E2E-${suffix}`.replace(/[^A-Z0-9-]/g, "").slice(0, 32),
        clientId: client.id,
        billingType: "time_and_materials",
      },
    });
    expect(projectResponse.status()).toBe(201);
    const project = (await projectResponse.json()).project as { id: string };

    const retainerResponse = await page.request.post("/api/retainers", {
      data: {
        clientId: client.id,
        name: `Monthly services ${suffix}`,
        status: "active",
        cadence: "monthly",
        startDate: new Date().toISOString().slice(0, 10),
        allowanceHours: 20,
        value: 3600,
        hourlyRate: 180,
        currency: "USD",
      },
    });
    expect(retainerResponse.status()).toBe(201);
    const retainer = (await retainerResponse.json()).retainer as { id: string };

    const timeResponse = await page.request.post("/api/time-entries", {
      data: {
        projectId: project.id,
        retainerId: retainer.id,
        entryDate: new Date().toISOString().slice(0, 10),
        durationMinutes: 60,
        description: "E2E operational work",
        billable: true,
        currency: "USD",
      },
    });
    expect(timeResponse.status()).toBe(201);

    const invoiceResponse = await page.request.post("/api/invoices", {
      data: {
        clientId: client.id,
        projectId: project.id,
        invoiceNumber: `E2E-${suffix}`,
        status: "draft",
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: shiftDate(30),
        currency: "USD",
        subtotal: 180,
        taxTotal: 0,
        total: 180,
        lineItems: [
          {
            projectId: project.id,
            description: "Professional services",
            quantity: 1,
            unitPrice: 180,
            lineTotal: 180,
          },
        ],
      },
    });
    expect(invoiceResponse.status()).toBe(201);
    const invoice = (await invoiceResponse.json()).invoice as { id: string };

    expect(
      (
        await page.request.patch("/api/invoices", {
          data: { id: invoice.id, status: "issued" },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await page.request.post("/api/payments", {
          data: {
            clientId: client.id,
            invoiceId: invoice.id,
            paymentDate: new Date().toISOString().slice(0, 10),
            amount: 180,
            currency: "USD",
            method: "bank_transfer",
            idempotencyKey: `e2e-payment-${suffix}`,
          },
        })
      ).status(),
    ).toBe(201);

    await page.goto(`/clients/${client.id}`);
    await expect(
      page.getByRole("heading", { name: `E2E Client ${suffix}` }),
    ).toBeVisible();
  });
});

function shiftDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
