import { describe, expect, it } from "vitest";

import {
  isRetryableSlackError,
  SlackApiError,
} from "@/lib/integrations/slack";
import {
  getDirectStorageEndpoint,
  getSignedStorageEndpoint,
  MAX_UPLOAD_SIZE,
  TUS_CHUNK_SIZE,
  uploadCacheKey,
} from "@/lib/uploads/contracts";
import {
  chatUploadInitiationSchema,
  projectUploadInitiationSchema,
} from "@/lib/uploads/validation";

describe("resumable upload contracts", () => {
  it("uses Supabase's direct storage hostname", () => {
    expect(
      getDirectStorageEndpoint("https://example.supabase.co"),
    ).toBe(
      "https://example.storage.supabase.co/storage/v1/upload/resumable",
    );
  });

  it("keeps local Storage on the local origin", () => {
    expect(
      getDirectStorageEndpoint("http://127.0.0.1:55321"),
    ).toBe("http://127.0.0.1:55321/storage/v1/upload/resumable");
  });

  it("uses the signed TUS endpoint for presigned uploads", () => {
    expect(getSignedStorageEndpoint("https://example.supabase.co")).toBe(
      "https://example.storage.supabase.co/storage/v1/upload/resumable/sign",
    );
  });

  it("pins the required six-megabyte TUS chunks", () => {
    expect(TUS_CHUNK_SIZE).toBe(6 * 1024 * 1024);
  });

  it("accepts 25 MB and rejects one byte more", () => {
    const base = {
      projectId: crypto.randomUUID(),
      fileName: "review.pdf",
      mimeType: "application/pdf",
    };
    expect(
      projectUploadInitiationSchema.safeParse({
        ...base,
        sizeBytes: MAX_UPLOAD_SIZE,
      }).success,
    ).toBe(true);
    expect(
      projectUploadInitiationSchema.safeParse({
        ...base,
        sizeBytes: MAX_UPLOAD_SIZE + 1,
      }).success,
    ).toBe(false);
  });

  it("requires positive chat attachment sizes", () => {
    expect(
      chatUploadInitiationSchema.safeParse({
        conversationId: crypto.randomUUID(),
        fileName: "empty.txt",
        sizeBytes: 0,
      }).success,
    ).toBe(false);
  });

  it("builds stable, target-scoped resume keys", () => {
    const file = {
      name: "review.pdf",
      size: 42,
      type: "application/pdf",
      lastModified: 123,
    } as File;
    expect(uploadCacheKey("project:a", file)).toBe(
      uploadCacheKey("project:a", file),
    );
    expect(uploadCacheKey("project:a", file)).not.toBe(
      uploadCacheKey("project:b", file),
    );
  });
});

describe("Slack delivery classification", () => {
  it("retries rate limits and server failures", () => {
    expect(
      isRetryableSlackError(
        new SlackApiError("limited", 429, "ratelimited", 30),
      ),
    ).toBe(true);
    expect(
      isRetryableSlackError(
        new SlackApiError("unavailable", 503, "service_unavailable"),
      ),
    ).toBe(true);
  });

  it("dead-letters permanent authorization errors", () => {
    expect(
      isRetryableSlackError(
        new SlackApiError("invalid", 200, "invalid_auth"),
      ),
    ).toBe(false);
  });
});
