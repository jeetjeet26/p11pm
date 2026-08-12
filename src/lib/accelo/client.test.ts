import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AcceloClient,
  AcceloClientError,
  normalizeDeployment,
  parseRetryAfter,
} from "@/lib/accelo/client";
import { ACCELO_READ_ONLY_SCOPE } from "@/lib/accelo/types";

const credentials = {
  deployment: "example",
  clientId: "client",
  clientSecret: "secret",
};

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("AcceloClient", () => {
  it("uses POST only for OAuth and GET for allowlisted resources", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      });
      if (String(input).includes("/oauth2/")) {
        return json({ access_token: "token", expires_in: 900 });
      }
      return json({
        response: [{ id: "company-1", date_modified: 1_700_000_000 }],
        meta: { more: false },
      });
    });
    const client = new AcceloClient({
      ...credentials,
      fetchImpl: fetchImpl as typeof fetch,
      telemetry: vi.fn(),
    });

    const page = await client.getPage("companies");

    expect(page.records).toHaveLength(1);
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    expect(new URLSearchParams(requests[0]?.body).get("scope")).toBe(
      ACCELO_READ_ONLY_SCOPE,
    );
    expect(requests[1]?.url).toContain("/api/v0/companies");
  });

  it("honors Retry-After and retries only bounded transient responses", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 900 }))
      .mockResolvedValueOnce(
        json({ error: "limited" }, { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(
        json({ response: [{ id: 1 }], meta: { more: false } }),
      );
    const client = new AcceloClient({
      ...credentials,
      fetchImpl,
      sleep,
      random: () => 0,
      telemetry: vi.fn(),
    });

    await expect(client.getPage("contacts")).resolves.toMatchObject({
      hasMore: false,
    });
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects resources and query keys outside the read allowlist", async () => {
    const client = new AcceloClient({
      ...credentials,
      fetchImpl: vi.fn(),
      telemetry: vi.fn(),
    });

    await expect(
      client.get("companies", { method: "DELETE" } as never),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(client.get("users" as never)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("rejects malformed collection records at runtime", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 900 }))
      .mockResolvedValueOnce(json({ response: ["not-an-object"] }));
    const client = new AcceloClient({
      ...credentials,
      fetchImpl,
      telemetry: vi.fn(),
    });

    await expect(client.getPage("jobs")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("uses a bounded GET for targeted source-record recovery", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 900 }))
      .mockResolvedValueOnce(
        json({ response: { id: "job-1", title: "Recovered job" } }),
      );
    const client = new AcceloClient({
      ...credentials,
      fetchImpl,
      telemetry: vi.fn(),
    });

    await expect(
      client.getRecord("jobs", "job-1", { fields: "_ALL,company()" }),
    ).resolves.toMatchObject({ id: "job-1" });
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      "/api/v0/jobs/job-1",
    );
    await expect(client.getRecord("jobs", "../unsafe")).rejects.toBeDefined();
  });

  it("enumerates contract periods through their parent contract endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 900 }))
      .mockResolvedValueOnce(
        json({ response: [{ id: "contract-1" }], meta: { more: true } }),
      )
      .mockResolvedValueOnce(
        json({
          response: { periods: [{ id: "period-1" }] },
          meta: { more: false },
        }),
      );
    const client = new AcceloClient({
      ...credentials,
      fetchImpl,
      telemetry: vi.fn(),
    });

    await expect(client.getPage("contract_periods")).resolves.toMatchObject({
      records: [
        {
          id: "period-1",
          contract_id: "contract-1",
          contract: { id: "contract-1" },
        },
      ],
      hasMore: true,
      total: null,
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      "/api/v0/contracts?_limit=100",
    );
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain(
      "/api/v0/contracts/contract-1/periods",
    );
  });
});

describe("Accelo client helpers", () => {
  it("normalizes only safe deployment subdomains", () => {
    expect(normalizeDeployment("https://example.api.accelo.com/path")).toBe(
      "example",
    );
    expect(() => normalizeDeployment("example/other")).toThrow(
      AcceloClientError,
    );
  });

  it("bounds Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfter("1.5")).toBe(1_500);
    expect(
      parseRetryAfter("Tue, 11 Aug 2026 20:00:10 GMT", () =>
        Date.parse("2026-08-11T20:00:00Z"),
      ),
    ).toBe(10_000);
    expect(parseRetryAfter("999")).toBe(30_000);
    expect(parseRetryAfter("invalid")).toBeNull();
  });
});
