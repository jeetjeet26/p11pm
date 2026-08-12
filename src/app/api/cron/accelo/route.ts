import { z } from "zod";

import {
  AcceloClient,
  AcceloClientError,
  normalizeDeployment,
} from "@/lib/accelo/client";
import { runAcceloIngestion } from "@/lib/accelo/ingestion";
import { recoverAcceloActivityParents } from "@/lib/accelo/recovery";
import {
  AcceloRepositoryError,
  createRunIdempotencyKey,
  SupabaseAcceloRepository,
} from "@/lib/accelo/repository";
import {
  ACCELO_BUSINESS_RESOURCES,
  acceloBusinessResourceSchema,
} from "@/lib/accelo/types";
import { getAppSupabaseClient } from "@/lib/integrations/supabase";
import { isCronRequestAuthorized } from "@/lib/uploads/cron-auth";

export const maxDuration = 300;

const querySchema = z
  .object({
    mode: z
      .enum(["auto", "inventory", "incremental", "finalize", "promote"])
      .default("auto"),
    scanId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    expectedCount: z.coerce.number().int().nonnegative().optional(),
    resources: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .transform((value) => value.split(","))
      .pipe(
        z
          .array(acceloBusinessResourceSchema)
          .min(1)
          .max(ACCELO_BUSINESS_RESOURCES.length),
      )
      .optional(),
  })
  .strict();

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return Response.json({ error: "Invalid Accelo cron request." }, { status: 400 });
  }

  const database = getAppSupabaseClient();
  if (!database) {
    return Response.json(
      { error: "Accelo ingestion is not configured." },
      { status: 503 },
    );
  }

  const deployment = process.env.ACCELO_DEPLOYMENT?.trim();
  if (!deployment) {
    return Response.json(
      { error: "Accelo ingestion is not configured." },
      { status: 503 },
    );
  }
  let sourceAccount: string;
  try {
    sourceAccount = normalizeDeployment(deployment);
  } catch {
    return Response.json(
      { error: "Accelo ingestion is not configured." },
      { status: 503 },
    );
  }

  const repository = new SupabaseAcceloRepository(database, sourceAccount);
  await repository.reapStaleRuns().catch((error) => {
    console.error("accelo.ingestion", {
      event: "stale_run_reaper_failed",
      errorCode: sanitizedErrorCode(error),
    });
  });
  let targets;
  try {
    targets = await repository.listTargets();
  } catch {
    return Response.json(
      { error: "Accelo ingestion is unavailable." },
      { status: 503 },
    );
  }
  if (!targets.length) {
    return Response.json({ outcome: "idle", targets: 0 });
  }
  if (query.data.mode === "finalize") {
    const resource = query.data.resources?.[0];
    if (
      query.data.resources?.length !== 1 ||
      !resource ||
      !query.data.scanId ||
      query.data.expectedCount === undefined
    ) {
      return Response.json(
        { error: "Finalization requires one resource and scan evidence." },
        { status: 400 },
      );
    }
    const target = targets[0];
    const lease = await repository.startRun({
      target,
      mode: "inventory",
      resources: [resource],
      idempotencyKey: `accelo:finalize:${query.data.scanId.slice(0, 24)}:${new Date().toISOString().slice(0, 16)}`,
    });
    if (!lease) {
      return Response.json({ outcome: "skipped", targets: 1 });
    }
    try {
      await repository.finalizeRun(lease, {
        mode: "inventory",
        records: 0,
        pages: 0,
        quarantined: 0,
        truncated: false,
        resources: [
          {
            resource,
            records: query.data.expectedCount,
            pages: 0,
            quarantined: 0,
            truncated: false,
            complete: true,
            expectedCount: query.data.expectedCount,
            watermark: {
              sourceModifiedAt: null,
              sourceId: null,
              scanId: query.data.scanId,
              nextPage: 0,
              pendingSourceModifiedAt: null,
              pendingSourceId: null,
            },
          },
        ],
      });
      return Response.json({ outcome: "succeeded", targets: 1 });
    } catch (error) {
      const code = sanitizedErrorCode(error);
      await repository.failRun(lease, code).catch(() => undefined);
      return Response.json(
        { outcome: "failed", targets: 1, errorCode: code },
        { status: 503 },
      );
    }
  }

  let client: AcceloClient;
  try {
    client = new AcceloClient();
  } catch {
    return Response.json(
      { error: "Accelo ingestion is not configured." },
      { status: 503 },
    );
  }
  if (query.data.mode === "promote") {
    const resource = query.data.resources?.[0];
    const target = targets[0];
    if (query.data.resources?.length !== 1 || !resource || !target) {
      return Response.json(
        { error: "Promotion requires exactly one resource." },
        { status: 400 },
      );
    }
    const lease = await repository.startRun({
      target,
      mode: "inventory",
      resources: [resource],
      idempotencyKey: `accelo:promote:${resource}:${new Date().toISOString()}`,
    });
    if (!lease) {
      return Response.json({ outcome: "skipped", targets: 1 });
    }
    try {
      let mapped = 0;
      let quarantined = 0;
      const results = await Promise.all(
        Array.from({ length: 2 }, () => repository.promoteRun(lease)),
      );
      for (const result of results) {
        mapped += result.mapped;
        quarantined += result.quarantined;
      }
      const hasMore = results.some((result) => result.hasMore);
      await repository.heartbeat(lease.runId, lease.leaseToken);
      const recovery =
        resource === "activities"
          ? await recoverAcceloActivityParents({
              lease,
              client,
              repository,
            })
          : null;
      await repository.finalizeRun(lease, {
        mode: "inventory",
        records: mapped,
        pages: 0,
        quarantined,
        truncated: true,
        resources: [
          {
            resource,
            records: mapped,
            pages: 0,
            quarantined,
            truncated: true,
            complete: false,
            expectedCount: null,
            watermark: {
              sourceModifiedAt: null,
              sourceId: null,
              scanId: query.data.scanId ?? null,
              nextPage: 0,
              pendingSourceModifiedAt: null,
              pendingSourceId: null,
            },
          },
        ],
      });
      return Response.json({
        outcome: hasMore ? "partial" : "succeeded",
        mapped,
        quarantined,
        hasMore,
        recovery,
      });
    } catch (error) {
      const code = sanitizedErrorCode(error);
      await repository.failRun(lease, code).catch(() => undefined);
      return Response.json(
        { outcome: "failed", errorCode: code },
        { status: 503 },
      );
    }
  }

  const startedAt = Date.now();
  const outcomes: Array<{
    outcome: "succeeded" | "partial" | "failed" | "skipped";
    records: number;
    quarantined: number;
  }> = [];

  for (const target of targets.slice(0, 10)) {
    const remainingMs = 285_000 - (Date.now() - startedAt);
    if (remainingMs < 5_000) break;
    let mode: "inventory" | "incremental";
    let dueInventoryResource:
      | (typeof ACCELO_BUSINESS_RESOURCES)[number]
      | null = null;
    try {
      if (query.data.mode === "auto") {
        dueInventoryResource = await repository.nextInventoryResource(target);
        mode = dueInventoryResource ? "inventory" : "incremental";
      } else {
        mode = query.data.mode;
      }
    } catch {
      outcomes.push({ outcome: "failed", records: 0, quarantined: 0 });
      continue;
    }
    const resources =
      query.data.resources ??
      (mode === "inventory"
        ? dueInventoryResource
          ? [dueInventoryResource]
          : ACCELO_BUSINESS_RESOURCES
        : scheduledIncrementalResources(new Date(startedAt)));
    const isActivityInventory =
      mode === "inventory" &&
      resources.length === 1 &&
      resources[0] === "activities";
    const inventoryMaxRecords = isActivityInventory ? 10_000 : 20_000;
    const inventoryMaxPages = isActivityInventory ? 100 : 200;
    const inventoryMaxDurationMs = isActivityInventory ? 150_000 : 240_000;

    let lease;
    try {
      lease = await repository.startRun({
        target,
        mode,
        resources,
        idempotencyKey: createRunIdempotencyKey(
          mode,
          new Date(startedAt),
          resources,
        ),
      });
    } catch {
      outcomes.push({ outcome: "failed", records: 0, quarantined: 0 });
      console.error("accelo.ingestion", {
        event: "run_failed",
        mode,
        errorCode: "database_start",
      });
      continue;
    }
    if (!lease) {
      outcomes.push({ outcome: "skipped", records: 0, quarantined: 0 });
      continue;
    }

    try {
      const summary = await runAcceloIngestion({
        organizationId: target.organizationId,
        sourceAccountId: target.sourceAccountId,
        runId: lease.runId,
        leaseToken: lease.leaseToken,
        mode,
        client,
        repository,
        resources,
        resourceLimits:
          mode === "inventory"
            ? {
                maxPages: inventoryMaxPages,
                maxRecords: inventoryMaxRecords,
                maxDurationMs: Math.min(
                  inventoryMaxDurationMs,
                  remainingMs - 2_000,
                ),
                pageSize: 100,
              }
            : undefined,
        maxTotalRecords:
          mode === "inventory" ? inventoryMaxRecords : undefined,
        maxTotalPages:
          mode === "inventory" ? inventoryMaxPages : undefined,
        maxDurationMs: Math.min(
          mode === "inventory"
            ? inventoryMaxDurationMs
            : 240_000,
          remainingMs - 2_000,
        ),
      });
      await promoteBatches(repository, lease);
      if (resources.includes("activities")) {
        const recovery = await recoverAcceloActivityParents({
          lease,
          client,
          repository,
        });
        if (recovery.recovered > 0) {
          await promoteBatches(repository, lease);
        }
        console.info("accelo.ingestion", {
          event: "activity_parent_recovery",
          ...recovery,
        });
      }
      await repository.finalizeRun(lease, summary);
      outcomes.push({
        outcome: summary.truncated ? "partial" : "succeeded",
        records: summary.records,
        quarantined: summary.quarantined,
      });
      console.info("accelo.ingestion", {
        event: "run_complete",
        mode,
        outcome: summary.truncated ? "partial" : "succeeded",
        resourceCount: summary.resources.length,
        records: summary.records,
        quarantined: summary.quarantined,
      });
    } catch (error) {
      const code = sanitizedErrorCode(error);
      await repository.failRun(lease, code).catch(() => undefined);
      outcomes.push({ outcome: "failed", records: 0, quarantined: 0 });
      console.error("accelo.ingestion", {
        event: "run_failed",
        mode,
        errorCode: code,
      });
    }
  }

  const failed = outcomes.filter((item) => item.outcome === "failed").length;
  const partial = outcomes.filter((item) => item.outcome === "partial").length;
  return Response.json(
    {
      outcome: failed ? "failed" : partial ? "partial" : "succeeded",
      targets: outcomes.length,
      failed,
      partial,
      records: outcomes.reduce((sum, item) => sum + item.records, 0),
      quarantined: outcomes.reduce(
        (sum, item) => sum + item.quarantined,
        0,
      ),
    },
    { status: failed === outcomes.length && failed > 0 ? 503 : 200 },
  );
}

async function promoteBatches(
  repository: SupabaseAcceloRepository,
  lease: { runId: string; leaseToken: string; status: "running" },
) {
  for (let batch = 0; batch < 20; batch += 1) {
    const promotion = await repository.promoteRun(lease);
    if (!promotion.hasMore) return;
    if (batch === 19) {
      throw new AcceloRepositoryError("finalize", "promotion_incomplete");
    }
    await repository.heartbeat(lease.runId, lease.leaseToken);
  }
}

function sanitizedErrorCode(error: unknown) {
  if (error instanceof AcceloClientError) {
    return `client_${error.code}`;
  }
  if (error instanceof AcceloRepositoryError) {
    return `database_${error.operation}`;
  }
  if (error instanceof z.ZodError) return "validation_failed";
  return "ingestion_failed";
}

function scheduledIncrementalResources(date: Date) {
  const sweepResources = ACCELO_BUSINESS_RESOURCES.filter(
    (resource) => resource !== "affiliations",
  );
  const shard = date.getUTCHours() % 4;
  return [
    "affiliations" as const,
    ...sweepResources.filter((_, index) => index % 4 === shard),
  ];
}
