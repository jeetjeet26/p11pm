import { expect, test } from "@playwright/test";

test("login shell is reachable without credentials", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBeLessThan(500);
  await expect(page).toHaveTitle(/P11 PM/);
  await expect(page.locator("body")).toContainText(/P11 PM|sign in|workspace/i);
});

test("telemetry accepts only normalized, bounded web-vital data", async ({
  request,
}) => {
  const accepted = await request.post("/api/telemetry", {
    data: {
      schemaVersion: "1.0.0",
      name: "LCP",
      value: 1200,
      delta: 1200,
      rating: "good",
      navigationType: "navigate",
      route: "/login",
    },
  });
  expect(accepted.status()).toBe(202);

  const rejected = await request.post("/api/telemetry", {
    data: {
      schemaVersion: "1.0.0",
      name: "LCP",
      value: 1200,
      delta: 1200,
      rating: "good",
      route: "/projects/private-record-id?token=secret",
    },
  });
  expect(rejected.status()).toBe(400);
});

test("local demo can reach the workspace without external secrets", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "Remote deployments do not enable demo mode by default.",
  );

  const demo = await page.request.post("/api/auth/demo?next=/dashboard");
  expect(demo.ok()).toBeTruthy();
  const response = await page.goto("/dashboard");
  expect(response?.status()).toBeLessThan(500);
  await expect(page).toHaveURL(/\/dashboard$/);
});
