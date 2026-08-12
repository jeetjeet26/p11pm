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

  it("keeps only bounded operational dimensions", () => {
    const span = {
      name: "accelo sync",
      attributes: {
        "app.provider": "accelo",
        "app.entity": "invoice",
        "app.run_kind": "scheduled",
        "app.outcome": "partial",
        "app.retry_category": "rate_limit",
        "app.entity.id": "private-entity-id",
        "app.provider_account": "private-account",
      },
      events: [],
      links: [],
    } as unknown as ReadableSpan;

    new SafeAttributeSpanProcessor().onEnd(span);

    expect(span.attributes).toEqual({
      "app.provider": "accelo",
      "app.entity": "invoice",
      "app.run_kind": "scheduled",
      "app.outcome": "partial",
      "app.retry_category": "rate_limit",
    });
  });

  it("drops high-cardinality values from operational dimensions", () => {
    const span = {
      name: "provider sync",
      attributes: {
        "app.provider": "customer-specific-provider",
        "app.entity": "invoice-12345",
        "app.run_kind": "run-2026-08-11",
        "app.outcome": "failed-for-customer",
        "app.retry_category": "private@example.com",
      },
      events: [],
      links: [],
    } as unknown as ReadableSpan;

    new SafeAttributeSpanProcessor().onEnd(span);

    expect(span.attributes).toEqual({});
  });
});
