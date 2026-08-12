import { describe, expect, it } from "vitest";

import { formatFileSize, previewKind } from "@/lib/files/types";

describe("file workspace helpers", () => {
  it("formats file sizes for dense file listings", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("selects a safe renderer for each previewable content type", () => {
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("image/svg+xml")).toBe("svg");
    expect(previewKind("text/plain")).toBe("text");
    expect(previewKind("text/html")).toBe("download");
    expect(previewKind("application/octet-stream")).toBe("download");
  });
});
