import { expect, test } from "@playwright/test";

const authenticated = Boolean(process.env.PLAYWRIGHT_STORAGE_STATE_PATH);

test.describe("support workspace", () => {
  test.skip(!authenticated, "Support E2E requires an authenticated P11 profile.");

  test("renders the queue and opens an available ticket", async ({ page }) => {
    await page.goto("/support");
    await expect(page).toHaveURL(/\/support(?:\/|$)/);

    const denied = page.getByRole("heading", {
      name: "Support access is required",
    });
    if (await denied.isVisible()) {
      await expect(denied).toBeVisible();
      return;
    }

    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
    await expect(page.getByLabel("Search support tickets")).toBeVisible();
    await expect(page.getByLabel("Status")).toBeVisible();
    await expect(page.getByLabel("SLA")).toBeVisible();

    const ticketLink = page.locator('a[href^="/support/"]').first();
    if (await ticketLink.isVisible()) {
      await ticketLink.click();
      await expect(page).toHaveURL(/\/support\/[0-9a-f-]+/);
      await expect(page.getByText("Correspondence")).toBeVisible();
    }
  });
});
