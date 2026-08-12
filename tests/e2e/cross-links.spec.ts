import { expect, test } from "@playwright/test";

const hasAuthenticatedState = Boolean(
  process.env.PLAYWRIGHT_STORAGE_STATE_PATH,
);

test.describe("workspace cross-links", () => {
  test.skip(
    !hasAuthenticatedState,
    "Cross-link E2E requires an authenticated chat-enabled profile.",
  );

  test("chat exposes the work picker and project Campfire is retired", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByRole("button", { name: "Link work" })).toBeVisible();
    await page.getByRole("button", { name: "Link work" }).click();
    await expect(page.getByRole("combobox", { name: "Search work" })).toBeVisible();

    await page.goto("/projects");
    const projectLink = page.locator('a[href^="/projects/"]').first();
    await expect(projectLink).toBeVisible();
    await projectLink.click();
    await expect(page.getByRole("tab", { name: "Messages" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveCount(0);
  });
});
