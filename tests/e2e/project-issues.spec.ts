import { expect, type Page, test } from "@playwright/test";

const hasAuthenticatedState = Boolean(
  process.env.PLAYWRIGHT_STORAGE_STATE_PATH,
);

test.describe("project issue workflows", () => {
  test.skip(
    !hasAuthenticatedState && Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "Remote QA requires PLAYWRIGHT_STORAGE_STATE_PATH.",
  );

  test.beforeEach(async ({ page }) => {
    if (!hasAuthenticatedState) {
      const demo = await page.request.post("/api/auth/demo?next=/projects");
      expect(demo.ok()).toBeTruthy();
    }
    await installDeterministicIssueDataset(page);
  });

  test("issue APIs enforce bounded pagination and update versions", async ({
    page,
  }) => {
    const oversizedPage = await page.request.get(
      "/api/todos?projectId=aster-house&limit=101",
    );
    expect(oversizedPage.status()).toBe(400);

    const invalidUpdate = await page.request.patch("/api/todos", {
      data: {
        id: "issue-001",
        status: "completed",
        expectedVersion: 0,
      },
    });
    expect(invalidUpdate.status()).toBe(400);

    const missingDetail = await page.request.get("/api/todos/missing-issue");
    expect(missingDetail.status()).toBe(404);
  });

  test("a whole row opens a stable URL while completion stays independent", async ({
    page,
  }) => {
    const projectPath = await openFirstProject(page);
    const firstRow = page.locator('[data-issue-id="issue-001"]');
    await expect(firstRow).toBeVisible();
    await firstRow.scrollIntoViewIfNeeded();
    const workspaceHandle = await page
      .getByTestId("issue-workspace")
      .elementHandle();
    expect(workspaceHandle).not.toBeNull();

    const rowBounds = await firstRow.boundingBox();
    expect(rowBounds).not.toBeNull();
    await page.mouse.click(
      rowBounds!.x + rowBounds!.width / 2,
      rowBounds!.y + rowBounds!.height / 2,
    );
    await expect(page).toHaveURL(/\/issues\/issue-001(?:\?|$)/);
    const detailLoading = page
      .locator('[role="status"]:visible')
      .filter({ hasText: "Loading latest details…" });
    await expect(detailLoading).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Deterministic issue 1" }).first(),
    ).toBeVisible();
    await expect(detailLoading).toBeHidden();
    expect(await workspaceHandle!.evaluate((element) => element.isConnected)).toBe(
      true,
    );

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${escapeRegex(projectPath)}(?:\\?|$)`));
    await expect(firstRow).toBeVisible();

    const urlBeforeCompletion = page.url();
    await firstRow.getByRole("checkbox").click();
    await expect(page).toHaveURL(urlBeforeCompletion);

    const rowForty = page.locator('[data-issue-id="issue-040"]');
    await rowForty.scrollIntoViewIfNeeded();
    const savedScroll = await page.evaluate(() => window.scrollY);
    await rowForty.getByRole("link").click();
    await expect(page).toHaveURL(/\/issues\/issue-040(?:\?|$)/);
    await page.goBack();
    await expect(rowForty).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(Math.max(0, savedScroll - 120));

    const secondLink = page
      .locator('[data-issue-id="issue-002"]')
      .getByRole("link");
    await secondLink.focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\/issues\/issue-002(?:\?|$)/);
    await page.goBack();
    const thirdLink = page
      .locator('[data-issue-id="issue-003"]')
      .getByRole("link");
    await thirdLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/issues\/issue-003(?:\?|$)/);
  });

  test("pagination reaches issue 101 and keeps filters without duplicates", async ({
    page,
  }) => {
    await openFirstProject(page);
    const search = page.getByRole("textbox", { name: "Search issues" });
    await search.fill("Deterministic");
    await expect(page).toHaveURL(/q=Deterministic/);
    await page.getByRole("button", { name: "Load more issues" }).click();

    await expect(page.locator('[data-issue-id="issue-101"]')).toBeVisible();
    await expect(page.locator("[data-issue-id]")).toHaveCount(150);
    await expect(page).toHaveURL(/q=Deterministic/);
    const ids = await page
      .locator("[data-issue-id]")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-issue-id")));
    expect(new Set(ids).size).toBe(150);

    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("combobox", { name: "Issue list" }).click();
    await expect(page.getByRole("option", { name: "List 101" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("long details have a bounded independent scroll region", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop detail scroll regression.");
    await openFirstProject(page);
    await page.locator('[data-issue-id="issue-001"]').getByRole("link").click();
    const scrollRegion = page.getByTestId("issue-detail-scroll").first();
    await expect(scrollRegion).toBeVisible();
    await expect(page.getByText("Final deterministic comment")).toBeVisible();
    const dimensions = await scrollRegion.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    await scrollRegion.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.getByText("Final deterministic comment")).toBeVisible();
  });

  test("the issue navigator remains usable at 200 percent zoom", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop zoom regression.");
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFirstProject(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    const rowLink = page
      .locator('[data-issue-id="issue-001"]')
      .getByRole("link");
    await expect(rowLink).toBeVisible();
    await rowLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/issues\/issue-001(?:\?|$)/);
  });

  test("mobile opens details in the viewport instead of below the backlog", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "Mobile placement regression.",
    );
    await openFirstProject(page);
    const row = page.locator('[data-issue-id="issue-001"]');
    const rowBounds = await row.boundingBox();
    expect(rowBounds?.height).toBeGreaterThanOrEqual(48);
    await row.getByRole("link").click();

    const dialog = page.getByRole("dialog", { name: "Issue details" });
    await expect(dialog).toBeVisible();
    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds?.y).toBeLessThanOrEqual(1);
    await expect(
      dialog.getByRole("heading", { name: "Deterministic issue 1" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close issue" }).click();
    await expect(dialog).toBeHidden();
  });
});

async function openFirstProject(page: Page) {
  await page.goto("/projects");
  const projectLink = page.locator('a[href^="/projects/"]').first();
  await expect(projectLink).toBeVisible();
  const href = await projectLink.getAttribute("href");
  if (!href) throw new Error("No project link was available for issue QA.");
  await page.goto(href);
  await expect(page.getByRole("tab", { name: "Issues" })).toBeVisible();
  return href;
}

async function installDeterministicIssueDataset(page: Page) {
  const lists = Array.from({ length: 105 }, (_, index) => ({
    id: `list-${String(index + 1).padStart(3, "0")}`,
    projectId: "runtime-project",
    name: `List ${index + 1}`,
    position: index,
  }));
  const issues = Array.from({ length: 150 }, (_, index) => {
    const number = index + 1;
    return {
      id: `issue-${String(number).padStart(3, "0")}`,
      projectId: "runtime-project",
      listId: lists[index % lists.length].id,
      issueKey: `QA-${number}`,
      issueNumber: number,
      issueType: "task",
      rank: number * 1024,
      operationalState: "active",
      title: `Deterministic issue ${number}`,
      description:
        number === 1
          ? "A deliberately long issue used to verify bounded detail scrolling."
          : `Deterministic detail for issue ${number}.`,
      assigneeId: undefined,
      assigneeIds: [],
      completionSubscriberIds: [],
      dueDate: "2030-08-20",
      status:
        number % 11 === 0
          ? "blocked"
          : number % 4 === 0
            ? "in_progress"
            : "open",
      priority: number % 9 === 0 ? "high" : "normal",
      updatedAt: "2026-08-09T12:00:00.000Z",
      version: 1,
    };
  });

  await page.route("**/api/todos/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const issueId = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").at(-1) ?? "",
    );
    const issue = issues.find((item) => item.id === issueId);
    if (!issue) {
      await route.fulfill({ status: 404, json: { error: "Issue not found." } });
      return;
    }
    const comments = Array.from({ length: 80 }, (_, index) => ({
      id: `comment-${index + 1}`,
      todoId: issue.id,
      authorId: "profile-qa",
      body:
        index === 79
          ? "Final deterministic comment"
          : `Deterministic comment ${index + 1}: ${"context ".repeat(8)}`,
      createdAt: `2026-08-09T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
      mentionedProfileIds: [],
      attachments: [],
    }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      json: {
        detail: {
          todo: issue,
          subtasks: [],
          comments,
          transitions: [
            {
              id: "transition-1",
              fromStatus: "open",
              toStatus: issue.status,
              createdAt: "2026-08-09T12:00:00.000Z",
            },
          ],
        },
      },
    });
  });

  await page.route("**/api/todos?**", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      const issue = issues.find((item) => item.id === payload.id) ?? issues[0];
      await route.fulfill({
        json: { todo: { ...issue, ...payload, version: 2 } },
      });
      return;
    }
    if (request.method() !== "GET") {
      await route.continue();
      return;
    }
    const cursor = new URL(request.url()).searchParams.get("cursor");
    const pageItems = cursor ? issues.slice(75) : issues.slice(0, 75);
    await route.fulfill({
      json: {
        todoLists: lists,
        todos: pageItems,
        todoSubtasks: [],
        todoComments: [],
        hasMore: !cursor,
        nextCursor: cursor ? null : "page-2",
        totalCount: issues.length,
        demoMode: false,
      },
    });
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
