import { expect, test } from "@playwright/test";

const authenticated = Boolean(process.env.PLAYWRIGHT_STORAGE_STATE_PATH);

test.describe("ledger billing workflows", () => {
  test.skip(!authenticated, "Ledger billing requires an authenticated workspace.");

  test("billing and reports surfaces load", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Billing" }).first()).toBeVisible();
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Export operations CSV" })).toBeVisible();
  });
});
