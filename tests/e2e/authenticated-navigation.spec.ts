import { expect, test } from "@playwright/test";

const hasAuthenticatedState = Boolean(
  process.env.PLAYWRIGHT_STORAGE_STATE_PATH,
);

test.describe("authenticated workspace navigation", () => {
  test.skip(
    !hasAuthenticatedState,
    "Set PLAYWRIGHT_STORAGE_STATE_PATH to a runtime-only Playwright state file.",
  );

  for (const route of ["/dashboard", "/projects", "/team", "/chat"]) {
    test(`${route} remains available to an authenticated viewer`, async ({
      page,
    }, testInfo) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} response`).toBeLessThan(500);
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

      const timing = await page.evaluate(() => {
        const navigation = performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming | undefined;
        if (!navigation) return null;
        return {
          responseStartMs: Math.round(navigation.responseStart),
          transferBytes: navigation.transferSize,
        };
      });
      await testInfo.attach("navigation-evidence.json", {
        body: JSON.stringify({ route, timing }, null, 2),
        contentType: "application/json",
      });
    });
  }
});
