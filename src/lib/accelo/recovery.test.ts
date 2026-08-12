import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AcceloClientError } from "@/lib/accelo/client";
import { recoverAcceloActivityParents } from "@/lib/accelo/recovery";

const lease = {
  runId: "00000000-0000-4000-8000-000000000001",
  leaseToken: "00000000-0000-4000-8000-000000000002",
  status: "running" as const,
};

describe("Accelo activity parent recovery", () => {
  it("recovers a bounded parent graph through GET-only source reads", async () => {
    const repository = {
      claimActivityRecoveries: vi.fn(async () => [
        {
          unresolvedId: "00000000-0000-4000-8000-000000000003",
          sourceRecordId: "activity-1",
          requiredParentIdentity: {
            entity_type: "job",
            source_record_id: "job-1",
          },
          recoveryAttemptCount: 1,
        },
      ]),
      stageRecoveryBatch: vi.fn(async () => undefined),
      recordRecoveryFailure: vi.fn(async () => undefined),
    };
    const getRecord = vi.fn(async (resource: string) =>
      resource === "jobs"
        ? {
            id: "job-1",
            title: "Recovered job",
            company: { id: "company-1" },
          }
        : { id: "company-1", name: "Recovered company" },
    );

    await expect(
      recoverAcceloActivityParents({
        lease,
        client: { getRecord } as never,
        repository: repository as never,
      }),
    ).resolves.toEqual({
      claimed: 1,
      recovered: 1,
      pending: 0,
      stagedParents: 2,
    });
    expect(getRecord.mock.calls.map(([resource]) => resource)).toEqual([
      "jobs",
      "companies",
    ]);
    expect(repository.stageRecoveryBatch).toHaveBeenCalledWith(
      lease,
      "00000000-0000-4000-8000-000000000003",
      expect.arrayContaining([
        expect.objectContaining({ resource: "companies" }),
        expect.objectContaining({ resource: "jobs" }),
      ]),
    );
  });

  it("records a lossless pending disposition after bounded source misses", async () => {
    const repository = {
      claimActivityRecoveries: vi.fn(async () => [
        {
          unresolvedId: "00000000-0000-4000-8000-000000000003",
          sourceRecordId: "activity-1",
          requiredParentIdentity: {
            entity_type: "contract",
            source_record_id: "missing-contract",
          },
          recoveryAttemptCount: 3,
        },
      ]),
      stageRecoveryBatch: vi.fn(async () => undefined),
      recordRecoveryFailure: vi.fn(async () => undefined),
    };
    const getRecord = vi.fn(async () => {
      throw new AcceloClientError("missing", "upstream", 404, false);
    });

    await recoverAcceloActivityParents({
      lease,
      client: { getRecord } as never,
      repository: repository as never,
    });

    expect(repository.stageRecoveryBatch).not.toHaveBeenCalled();
    expect(repository.recordRecoveryFailure).toHaveBeenCalledWith(
      lease,
      "00000000-0000-4000-8000-000000000003",
      "source_not_found",
      true,
    );
  });
});
