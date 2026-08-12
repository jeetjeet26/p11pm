import { expect, test } from "@playwright/test";

const authenticated = Boolean(process.env.PLAYWRIGHT_STORAGE_STATE_PATH);
const mutationsEnabled =
  authenticated && process.env.PLAYWRIGHT_PSA_MUTATION_TESTS === "1";

test.describe("planning staffing and time", () => {
  test.skip(!authenticated, "Planning and time require an authenticated workspace.");

  test("time workspace exposes persistent timer and issue-aware entry controls", async ({
    page,
  }) => {
    await page.goto("/time");
    await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
    await expect(page.getByLabel("Timer project")).toBeVisible();
    await expect(page.getByLabel("Timer description")).toBeVisible();
    await page.getByRole("button", { name: "Add time" }).click();
    await expect(page.getByText("Record the work performed and where it should be billed.")).toBeVisible();
    await expect(page.getByLabel("Issue")).toBeVisible();
  });

  test("milestones and cycles can be created for a native project", async ({ page }) => {
    test.skip(
      !mutationsEnabled,
      "Set PLAYWRIGHT_PSA_MUTATION_TESTS=1 against an isolated QA database.",
    );
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const clientResponse = await page.request.post("/api/clients", {
      data: { name: `Planning Client ${suffix}`, status: "active" },
    });
    expect(clientResponse.status()).toBe(201);
    const client = (await clientResponse.json()).client as { id: string };
    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: `Planning Project ${suffix}`,
        code: `PLAN-${suffix}`.replace(/[^A-Z0-9-]/g, "").slice(0, 32),
        clientId: client.id,
        billingType: "time_and_materials",
      },
    });
    expect(projectResponse.status()).toBe(201);
    const project = (await projectResponse.json()).project as { id: string };

    expect(
      (
        await page.request.post("/api/milestones", {
          data: {
            projectId: project.id,
            name: `Launch ${suffix}`,
            dueDate: shiftDate(14),
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.post("/api/cycles", {
          data: {
            projectId: project.id,
            name: `Sprint ${suffix}`,
            startsOn: shiftDate(0),
            endsOn: shiftDate(7),
          },
        })
      ).status(),
    ).toBe(201);

    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("heading", { name: "Delivery plan" })).toBeVisible();
    await expect(page.getByText(`Launch ${suffix}`)).toBeVisible();
    await expect(page.getByText(`Sprint ${suffix}`)).toBeVisible();
  });
});

function shiftDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
