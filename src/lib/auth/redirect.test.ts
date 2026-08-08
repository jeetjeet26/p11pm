import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps local application paths", () => {
    expect(safeNextPath("/projects/123?tab=todos")).toBe(
      "/projects/123?tab=todos",
    );
  });

  it.each([
    null,
    "",
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/projects\u0000/123",
  ])("rejects an unsafe redirect value", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("supports an explicit fallback", () => {
    expect(safeNextPath(undefined, "/login")).toBe("/login");
  });
});
