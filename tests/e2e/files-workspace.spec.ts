import { expect, test } from "@playwright/test";

const hasAuthenticatedState = Boolean(
  process.env.PLAYWRIGHT_STORAGE_STATE_PATH,
);

test.describe("integrated file workspace", () => {
  test.skip(
    !hasAuthenticatedState,
    "File workspace E2E requires an authenticated P11 profile.",
  );

  test("opens the shared hierarchy and exposes safe primary actions", async ({
    page,
  }) => {
    await page.goto("/files");
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Recent" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Shared" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Favorites" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trash" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Folder" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search files" })).toBeVisible();
  });
});
