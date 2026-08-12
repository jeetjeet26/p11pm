import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildIncrementalFilters,
  extractSourceModifiedAt,
  hashPayload,
  runAcceloIngestion,
  type AcceloIngestionRepository,
  type AcceloStagePage,
} from "@/lib/accelo/ingestion";
import type { AcceloWatermark } from "@/lib/accelo/types";

const emptyCheckpoint: AcceloWatermark = {
  sourceModifiedAt: null,
  sourceId: null,
  nextPage: 0,
};

function repository(checkpoint = emptyCheckpoint) {
  const pages: AcceloStagePage[] = [];
  const value: AcceloIngestionRepository = {
    getCheckpoint: vi.fn(async () => checkpoint),
    stagePage: vi.fn(async (page) => {
      pages.push(page);
    }),
    heartbeat: vi.fn(async () => undefined),
  };
  return { value, pages };
}

describe("runAcceloIngestion", () => {
  it("stages valid records, quarantines invalid records, and checkpoints pages", async () => {
    const storage = repository();
    const getPage = vi
      .fn()
      .mockResolvedValueOnce({
        records: [
          { id: "1", date_modified: 1_700_000_000, name: "One" },
          { name: "Missing id" },
        ],
        hasMore: true,
        page: 0,
        total: 3,
      })
      .mockResolvedValueOnce({
        records: [{ id: "2", date_modified: 1_700_000_100, name: "Two" }],
        hasMore: false,
        page: 1,
        total: 3,
      });

    const result = await runAcceloIngestion({
      organizationId: "00000000-0000-4000-8000-000000000001",
      sourceAccountId: "account-1",
      runId: "00000000-0000-4000-8000-000000000002",
      leaseToken: "00000000-0000-4000-8000-000000000003",
      mode: "inventory",
      client: { getPage },
      repository: storage.value,
      resources: ["companies"],
    });

    expect(result).toMatchObject({
      records: 3,
      pages: 2,
      quarantined: 1,
      truncated: false,
      resources: [{ complete: true, expectedCount: 3 }],
    });
    expect(storage.pages).toHaveLength(2);
    expect(storage.pages[0]?.records).toHaveLength(1);
    expect(storage.pages[0]?.quarantines[0]?.reasonCode).toBe(
      "invalid_record",
    );
    expect(storage.pages[0]?.checkpoint.nextPage).toBe(1);
    expect(storage.pages[1]?.checkpoint).toMatchObject({
      sourceModifiedAt: "2023-11-14T22:15:00.000Z",
      sourceId: "2",
      nextPage: 0,
    });
    expect(storage.value.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("stops at hard record caps and leaves a resumable page cursor", async () => {
    const storage = repository();
    const getPage = vi.fn(async (_resource, request) => ({
      records: Array.from({ length: request.pageSize }, (_, index) => ({
        id: String(index),
      })),
      hasMore: true,
      page: request.page,
      total: 10,
    }));

    const result = await runAcceloIngestion({
      organizationId: "00000000-0000-4000-8000-000000000001",
      sourceAccountId: "account-1",
      runId: "00000000-0000-4000-8000-000000000002",
      leaseToken: "00000000-0000-4000-8000-000000000003",
      mode: "inventory",
      client: { getPage },
      repository: storage.value,
      resources: ["activities"],
      resourceLimits: {
        maxPages: 10,
        maxRecords: 3,
        maxDurationMs: 10_000,
        pageSize: 2,
      },
      maxTotalRecords: 3,
      maxTotalPages: 10,
      maxDurationMs: 10_000,
    });

    expect(result).toMatchObject({
      records: 3,
      pages: 2,
      truncated: true,
    });
    expect(storage.pages.at(-1)?.checkpoint.nextPage).toBe(2);
  });

  it("uses the committed watermark with overlap while resuming a scan", async () => {
    const checkpoint: AcceloWatermark = {
      sourceModifiedAt: "2026-08-11T20:00:00.000Z",
      sourceId: "old",
      nextPage: 4,
      scanId: "scan-account-affiliations",
      pendingSourceModifiedAt: "2026-08-11T20:10:00.000Z",
      pendingSourceId: "pending",
    };
    const storage = repository(checkpoint);
    const getPage = vi.fn(async () => ({
      records: [],
      hasMore: false,
      page: 4,
      total: 0,
    }));

    await runAcceloIngestion({
      organizationId: "00000000-0000-4000-8000-000000000001",
      sourceAccountId: "account-1",
      runId: "00000000-0000-4000-8000-000000000002",
      leaseToken: "00000000-0000-4000-8000-000000000003",
      mode: "incremental",
      client: { getPage },
      repository: storage.value,
      resources: ["affiliations"],
    });

    expect(getPage).toHaveBeenCalledWith(
      "affiliations",
      expect.objectContaining({
        page: 4,
        filters: "date_modified_after(1786477500),order_by_asc(date_modified)",
      }),
    );
    expect(storage.pages[0]?.checkpoint).toMatchObject({
      sourceModifiedAt: "2026-08-11T20:10:00.000Z",
      sourceId: "pending",
      scanId: "scan-account-affiliations",
      nextPage: 0,
    });
  });

  it("stages explicit source retirement metadata without dropping the record", async () => {
    const storage = repository();
    const getPage = vi.fn(async () => ({
      records: [
        {
          id: "period-retired",
          contract: { id: "contract-1" },
          standing: "retired",
          date_modified: 1_786_480_000,
        },
      ],
      hasMore: false,
      page: 0,
      total: 1,
    }));

    await runAcceloIngestion({
      organizationId: "00000000-0000-4000-8000-000000000001",
      sourceAccountId: "account-1",
      runId: "00000000-0000-4000-8000-000000000002",
      leaseToken: "00000000-0000-4000-8000-000000000003",
      mode: "inventory",
      client: { getPage },
      repository: storage.value,
      resources: ["contract_periods"],
    });

    expect(storage.pages[0]?.records[0]).toMatchObject({
      sourceId: "period-retired",
      sourceDeleted: true,
    });
  });
});

describe("Accelo ingestion helpers", () => {
  it("normalizes source dates and produces stable payload hashes", () => {
    expect(extractSourceModifiedAt({ date_modified: "1700000000" })).toBe(
      "2023-11-14T22:13:20.000Z",
    );
    expect(hashPayload({ b: 2, a: 1 })).toBe(hashPayload({ a: 1, b: 2 }));
  });

  it("omits modified filters for resources without reliable deltas", () => {
    expect(
      buildIncrementalFilters(
        { modifiedField: null, overlapSeconds: 0 },
        {
          sourceModifiedAt: "2026-08-11T20:00:00.000Z",
          sourceId: "1",
          nextPage: 0,
        },
      ),
    ).toBeUndefined();
  });
});
