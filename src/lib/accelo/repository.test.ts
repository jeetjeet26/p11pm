import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRunIdempotencyKey,
  SupabaseAcceloRepository,
} from "@/lib/accelo/repository";

function queryResult(data: unknown, error: unknown = null) {
  const calls: Array<[string, ...unknown[]]> = [];
  const query = {
    select: (...args: unknown[]) => {
      calls.push(["select", ...args]);
      return query;
    },
    eq: (...args: unknown[]) => {
      calls.push(["eq", ...args]);
      return query;
    },
    order: (...args: unknown[]) => {
      calls.push(["order", ...args]);
      return query;
    },
    limit: (...args: unknown[]) => {
      calls.push(["limit", ...args]);
      return query;
    },
    maybeSingle: async () => ({ data, error }),
    then: (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
    ) => resolve({ data, error }),
  };
  return { query, calls };
}

describe("SupabaseAcceloRepository", () => {
  it("enumerates targets exclusively from the enabled schedule flag", async () => {
    const scheduled = queryResult([
      {
        organization_id: "00000000-0000-4000-8000-000000000001",
        settings: { source_account_id: "account-a" },
      },
    ]);
    const from = vi.fn(() => scheduled.query);
    const repository = new SupabaseAcceloRepository(
      { from } as never,
      "fallback",
    );

    await expect(repository.listTargets()).resolves.toEqual([
      {
        organizationId: "00000000-0000-4000-8000-000000000001",
        sourceAccountId: "account-a",
      },
    ]);
    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("integration_settings");
    expect(scheduled.calls).toContainEqual(["eq", "enabled", true]);
  });

  it("scopes checkpoints by organization, account, and entity", async () => {
    const checkpoint = queryResult(null);
    const repository = new SupabaseAcceloRepository(
      { from: vi.fn(() => checkpoint.query) } as never,
      "fallback",
    );

    await repository.getCheckpoint(
      "00000000-0000-4000-8000-000000000001",
      "account-a",
      "companies",
    );

    expect(checkpoint.calls).toContainEqual([
      "eq",
      "source_account_id",
      "account-a",
    ]);
    expect(checkpoint.calls).toContainEqual(["eq", "entity_type", "companies"]);
  });

  it("continues bounded promotion only when the database reports more work", async () => {
    const rpc = vi.fn(async () => ({
      data: { mapped: 500, quarantined: 0, skipped: 0, has_more: true },
      error: null,
    }));
    const repository = new SupabaseAcceloRepository(
      { rpc } as never,
      "fallback",
    );

    await expect(
      repository.promoteRun({
        runId: "00000000-0000-4000-8000-000000000001",
        leaseToken: "00000000-0000-4000-8000-000000000002",
        status: "running",
      }),
    ).resolves.toMatchObject({ mapped: 500, hasMore: true });
  });

  it("chunks aggregated source pages to the database batch limit", async () => {
    const rpc = vi.fn(async (operation: string, parameters?: unknown) => {
      void operation;
      void parameters;
      return { data: null, error: null };
    });
    const repository = new SupabaseAcceloRepository(
      { rpc } as never,
      "fallback",
    );
    const records = Array.from({ length: 201 }, (_, index) => ({
      sourceId: `period-${index}`,
      sourceModifiedAt: null,
      sourceDeleted: false,
      payload: { id: `period-${index}` },
      normalizedPayload: { source_id: `period-${index}` },
      payloadHash: String(index).padStart(64, "0"),
      transformerVersion: 3,
    }));

    await repository.stagePage({
      organizationId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      leaseToken: "00000000-0000-4000-8000-000000000003",
      resource: "contract_periods",
      page: 0,
      records,
      quarantines: [],
      checkpoint: {
        sourceModifiedAt: null,
        sourceId: null,
        scanId: "scan",
        nextPage: 1,
        pendingSourceModifiedAt: null,
        pendingSourceId: null,
      },
    });

    const stageCalls = rpc.mock.calls.filter(
      ([operation]) => operation === "stage_accelo_pull_batch",
    );
    expect(stageCalls).toHaveLength(3);
    expect(
      stageCalls.map(([, parameters]) =>
        (parameters as { target_records: unknown[] }).target_records.length,
      ),
    ).toEqual([100, 100, 1]);
  });

  it("selects the oldest account-scoped domain for anti-entropy inventory", async () => {
    const inventories = queryResult([
      {
        requested_entities: ["companies"],
        finalized_at: new Date().toISOString(),
      },
    ]);
    const repository = new SupabaseAcceloRepository(
      { from: vi.fn(() => inventories.query) } as never,
      "fallback",
    );

    await expect(
      repository.nextInventoryResource({
        organizationId: "00000000-0000-4000-8000-000000000001",
        sourceAccountId: "account-a",
      }),
    ).resolves.toBe("activities");
    expect(inventories.calls).toContainEqual([
      "eq",
      "source_account_id",
      "account-a",
    ]);
  });
});

describe("createRunIdempotencyKey", () => {
  it("uses resumable minute buckets for every pull mode", () => {
    const date = new Date("2026-08-11T20:34:56.000Z");
    expect(createRunIdempotencyKey("inventory", date, ["companies"])).toContain(
      "2026-08-11T20:34",
    );
    expect(
      createRunIdempotencyKey("incremental", date, ["companies"]),
    ).toContain("2026-08-11T20:34");
  });
});
