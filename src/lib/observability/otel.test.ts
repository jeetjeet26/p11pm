import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";

import { SafeAttributeSpanProcessor } from "./otel";

describe("SafeAttributeSpanProcessor", () => {
  it("removes sensitive attributes and normalizes route names", () => {
    const span = {
      name: "GET /projects/private-project-id",
      attributes: {
        "http.method": "GET",
        "http.target": "/projects/private-project-id?token=secret",
        "next.route": "/projects/private-project-id",
        "tenant.name": "private@example.com",
        "user.id": "private-user-id",
      },
      status: {
        code: 2,
        message: "private@example.com",
      },
      events: [
        {
          name: "exception",
          time: [0, 0],
          attributes: {
            "exception.message": "private@example.com",
          },
        },
      ],
      links: [],
    } as unknown as ReadableSpan;

    new SafeAttributeSpanProcessor().onEnd(span);

    expect(span.name).toBe("GET /projects/[projectId]");
    expect(span.attributes).toEqual({
      "http.method": "GET",
      "next.route": "/projects/[projectId]",
    });
    expect(span.events[0]?.attributes).toEqual({});
    expect(span.status.message).toBeUndefined();
  });

  it("does not leave a full outbound URL in a span name", () => {
    const span = {
      name: "fetch GET https://example.supabase.co/storage/object?id=private",
      attributes: {
        "http.method": "GET",
        "http.url":
          "https://example.supabase.co/storage/object?id=private&token=secret",
      },
      events: [],
      links: [],
    } as unknown as ReadableSpan;

    new SafeAttributeSpanProcessor().onEnd(span);

    expect(span.name).toBe("GET outbound request");
    expect(span.attributes).toEqual({ "http.method": "GET" });
  });
});
