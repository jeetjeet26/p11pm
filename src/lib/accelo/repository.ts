import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  AcceloIngestionRepository,
  AcceloIngestionSummary,
  AcceloStagePage,
} from "@/lib/accelo/ingestion";
import { ACCELO_TRANSFORMER_VERSION } from "@/lib/accelo/ingestion";
import {
  ACCELO_BUSINESS_RESOURCES,
  acceloBusinessResourceSchema,
  type AcceloBusinessResource,
  type AcceloSyncMode,
  type AcceloWatermark,
} from "@/lib/accelo/types";

const uuidSchema = z.string().uuid();
const sourceAccountSchema = z.string().trim().min(1).max(200);

const targetRowSchema = z
  .object({
    organization_id: uuidSchema,
    settings: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

const runRowSchema = z
  .object({
    id: uuidSchema,
    lease_token: uuidSchema.nullable(),
    lease_owner: z.string().nullable(),
    status: z.enum([
      "queued",
      "running",
      "finalizing",
      "succeeded",
      "partial",
      "failed",
      "cancelled",
    ]),
  })
  .passthrough();

const checkpointRowSchema = z
  .object({
    cursor: z.record(z.string(), z.unknown()),
    high_watermark: z.string().nullable(),
    page_number: z.number().int().nonnegative().nullable(),
  })
  .passthrough();

const recoveryCandidateSchema = z.object({
  unresolved_id: uuidSchema,
  source_record_id: z.string().min(1).max(500),
  required_parent_identity: z.record(z.string(), z.unknown()),
  recovery_attempt_count: z.number().int().min(1).max(3),
});

export interface AcceloIngestionTarget {
  organizationId: string;
  sourceAccountId: string;
}

export interface AcceloRunLease {
  runId: string;
  leaseToken: string;
  status: "running";
}

export class AcceloRepositoryError extends Error {
  constructor(
    readonly operation:
      | "targets"
      | "start"
      | "checkpoint"
      | "stage"
      | "quarantine"
      | "heartbeat"
      | "finalize"
      | "reaper"
      | "recovery",
    readonly databaseCode: string | null = null,
  ) {
    super("Accelo ingestion storage failed.");
    this.name = "AcceloRepositoryError";
  }
}

export class SupabaseAcceloRepository implements AcceloIngestionRepository {
  private readonly leaseOwner = `vercel-accelo-${randomUUID()}`;

  constructor(
    private readonly client: SupabaseClient,
    private readonly sourceAccountFallback: string,
    private readonly leaseSeconds = 300,
  ) {}

  async listTargets(): Promise<AcceloIngestionTarget[]> {
    const settingsResult = await this.client
      .from("integration_settings")
      .select("organization_id,settings")
      .eq("provider", "accelo")
      .eq("enabled", true)
      .limit(100);
    if (settingsResult.error) {
      throw repositoryError("targets", settingsResult.error);
    }

    const targets: AcceloIngestionTarget[] = [];
    for (const rawRow of settingsResult.data ?? []) {
      const row = targetRowSchema.safeParse(rawRow);
      if (!row.success) continue;
      const configuredSource =
        row.data.settings?.source_account_id ??
        row.data.settings?.sourceAccountId;
      const sourceAccount = sourceAccountSchema.safeParse(
        configuredSource ?? this.sourceAccountFallback,
      );
      if (!sourceAccount.success) continue;
      targets.push({
        organizationId: row.data.organization_id,
        sourceAccountId: sourceAccount.data,
      });
    }
    return Array.from(
      new Map(
        targets.map((target) => [
          `${target.organizationId}:${target.sourceAccountId}`,
          target,
        ]),
      ).values(),
    );
  }

  async startRun(input: {
    target: AcceloIngestionTarget;
    mode: AcceloSyncMode;
    resources?: readonly AcceloBusinessResource[];
    idempotencyKey: string;
  }): Promise<AcceloRunLease | null> {
    const resources = (input.resources ?? ACCELO_BUSINESS_RESOURCES).map(
      (resource) => acceloBusinessResourceSchema.parse(resource),
    );
    const { data, error } = await this.client.rpc("start_accelo_pull_run", {
      target_organization_id: uuidSchema.parse(input.target.organizationId),
      target_source_account_id: sourceAccountSchema.parse(
        input.target.sourceAccountId,
      ),
      target_idempotency_key: z
        .string()
        .trim()
        .min(8)
        .max(200)
        .parse(input.idempotencyKey),
      target_requested_entities: resources,
      target_full_snapshot: input.mode === "inventory",
      target_manifest: {},
      target_start_cursor: {
        mode: input.mode,
        sourceAccountId: input.target.sourceAccountId,
        transformerVersion: ACCELO_TRANSFORMER_VERSION,
      },
      target_lease_owner: this.leaseOwner,
      target_lease_seconds: this.leaseSeconds,
    });
    if (error) throw repositoryError("start", error);
    const row = runRowSchema.safeParse(Array.isArray(data) ? data[0] : data);
    if (
      !row.success ||
      row.data.status !== "running" ||
      !row.data.lease_token ||
      row.data.lease_owner !== this.leaseOwner
    ) {
      return null;
    }
    return {
      runId: row.data.id,
      leaseToken: row.data.lease_token,
      status: "running",
    };
  }

  async nextInventoryResource(
    target: AcceloIngestionTarget,
    maximumAgeHours = 168,
  ): Promise<AcceloBusinessResource | null> {
    const { data, error } = await this.client
      .from("accelo_pull_runs")
      .select("requested_entities,finalized_at")
      .eq("organization_id", uuidSchema.parse(target.organizationId))
      .eq("source_account_id", sourceAccountSchema.parse(target.sourceAccountId))
      .eq("full_snapshot", true)
      .eq("status", "succeeded")
      .order("finalized_at", { ascending: false })
      .limit(200);
    if (error) throw repositoryError("targets", error);
    const latestByResource = new Map<AcceloBusinessResource, number>();
    for (const rawRun of data ?? []) {
      if (!rawRun || typeof rawRun !== "object") continue;
      const finalizedAt =
        typeof rawRun.finalized_at === "string"
          ? Date.parse(rawRun.finalized_at)
          : Number.NaN;
      if (!Number.isFinite(finalizedAt)) continue;
      const requested = Array.isArray(rawRun.requested_entities)
        ? rawRun.requested_entities
        : [];
      for (const rawResource of requested) {
        const resource = acceloBusinessResourceSchema.safeParse(rawResource);
        if (resource.success && !latestByResource.has(resource.data)) {
          latestByResource.set(resource.data, finalizedAt);
        }
      }
    }
    const staleBefore =
      Date.now() - maximumAgeHours * 60 * 60 * 1_000;
    return (
      [...ACCELO_BUSINESS_RESOURCES]
        .filter(
          (resource) =>
            (latestByResource.get(resource) ?? Number.NEGATIVE_INFINITY) <
            staleBefore,
        )
        .sort(
          (left, right) =>
            (latestByResource.get(left) ?? Number.NEGATIVE_INFINITY) -
              (latestByResource.get(right) ?? Number.NEGATIVE_INFINITY) ||
            left.localeCompare(right),
        )[0] ?? null
    );
  }

  async getCheckpoint(
    organizationId: string,
    sourceAccountId: string,
    resource: AcceloBusinessResource,
  ): Promise<AcceloWatermark> {
    const { data, error } = await this.client
      .from("accelo_pull_checkpoints")
      .select("cursor,high_watermark,page_number")
      .eq("organization_id", uuidSchema.parse(organizationId))
      .eq("source_account_id", sourceAccountSchema.parse(sourceAccountId))
      .eq("entity_type", acceloBusinessResourceSchema.parse(resource))
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw repositoryError("checkpoint", error);
    const row = checkpointRowSchema.safeParse(data);
    if (!row.success) return emptyWatermark();

    return {
      sourceModifiedAt: nullableText(
        row.data.cursor.sourceModifiedAt ?? row.data.high_watermark,
      ),
      sourceId: nullableText(row.data.cursor.sourceId),
      scanId: nullableText(row.data.cursor.scanId),
      nextPage: nonnegativeInteger(
        row.data.cursor.nextPage ?? row.data.page_number,
      ),
      pendingSourceModifiedAt: nullableText(
        row.data.cursor.pendingSourceModifiedAt,
      ),
      pendingSourceId: nullableText(row.data.cursor.pendingSourceId),
    };
  }

  async stagePage(input: AcceloStagePage): Promise<void> {
    for (let offset = 0; offset < input.records.length; offset += 100) {
      const records = input.records.slice(offset, offset + 100);
      const { error } = await this.client.rpc("stage_accelo_pull_batch", {
        target_run_id: uuidSchema.parse(input.runId),
        target_lease_token: uuidSchema.parse(input.leaseToken),
        target_entity_type: acceloBusinessResourceSchema.parse(input.resource),
        target_records: records.map((record) => ({
          source_id: record.sourceId,
          raw_payload: record.payload,
          normalized_payload: record.normalizedPayload,
          source_updated_at: record.sourceModifiedAt,
          source_deleted: record.sourceDeleted,
          transformer_version: record.transformerVersion,
        })),
      });
      if (error) throw repositoryError("stage", error);
    }

    if (input.quarantines.length) {
      const rows = input.quarantines.map((record) => ({
        organization_id: uuidSchema.parse(input.organizationId),
        run_id: uuidSchema.parse(input.runId),
        entity_type: acceloBusinessResourceSchema.parse(input.resource),
        source_record_id: quarantineSourceId(record.payload),
        reason_code: record.reasonCode,
        reason_detail: null,
        raw_payload: asJsonObject(record.payload),
      }));
      const { error } = await this.client
        .from("accelo_pull_quarantine")
        .upsert(rows, {
          onConflict:
            "run_id,entity_type,source_record_id,reason_code,payload_sha256",
          ignoreDuplicates: true,
        });
      if (error) throw repositoryError("quarantine", error);
    }

    const contentHash = createHash("sha256")
      .update(
        [
          ...input.records.map((record) => record.payloadHash),
          ...input.quarantines.map((record) =>
            createHash("sha256")
              .update(JSON.stringify(record.payload))
              .digest("hex"),
          ),
        ]
          .sort()
          .join(":"),
      )
      .digest("hex");
    const { error } = await this.client.rpc(
      "record_accelo_pull_checkpoint",
      {
        target_run_id: uuidSchema.parse(input.runId),
        target_lease_token: uuidSchema.parse(input.leaseToken),
        target_entity_type: acceloBusinessResourceSchema.parse(input.resource),
        target_checkpoint_key: `${input.resource}:page:${input.page}`,
        target_page_number: input.page,
        target_cursor: input.checkpoint,
        target_high_watermark: input.checkpoint.sourceModifiedAt,
        target_record_count:
          input.records.length + input.quarantines.length,
        target_content_sha256: contentHash,
      },
    );
    if (error) throw repositoryError("checkpoint", error);
  }

  async heartbeat(runId: string, leaseToken: string): Promise<void> {
    const { error } = await this.client.rpc("heartbeat_accelo_pull_run", {
      target_run_id: uuidSchema.parse(runId),
      target_lease_token: uuidSchema.parse(leaseToken),
      target_lease_seconds: this.leaseSeconds,
    });
    if (error) throw repositoryError("heartbeat", error);
  }

  async promoteRun(lease: AcceloRunLease): Promise<{
    mapped: number;
    quarantined: number;
    skipped: number;
    hasMore: boolean;
  }> {
    const { data, error } = await this.client.rpc("promote_accelo_pull_run", {
      target_run_id: uuidSchema.parse(lease.runId),
      target_lease_token: uuidSchema.parse(lease.leaseToken),
    });
    if (error) throw repositoryError("finalize", error);
    const result =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    return {
      mapped: nonnegativeInteger(result.mapped),
      quarantined: nonnegativeInteger(result.quarantined),
      skipped: nonnegativeInteger(result.skipped),
      hasMore: result.has_more === true,
    };
  }

  async claimActivityRecoveries(
    lease: AcceloRunLease,
    limit = 25,
  ): Promise<
    Array<{
      unresolvedId: string;
      sourceRecordId: string;
      requiredParentIdentity: Record<string, unknown>;
      recoveryAttemptCount: number;
    }>
  > {
    const { data, error } = await this.client.rpc(
      "claim_accelo_activity_recoveries",
      {
        target_run_id: uuidSchema.parse(lease.runId),
        target_lease_token: uuidSchema.parse(lease.leaseToken),
        result_limit: z.number().int().min(1).max(25).parse(limit),
      },
    );
    if (error) throw repositoryError("recovery", error);
    return z
      .array(recoveryCandidateSchema)
      .parse(data ?? [])
      .map((candidate) => ({
        unresolvedId: candidate.unresolved_id,
        sourceRecordId: candidate.source_record_id,
        requiredParentIdentity: candidate.required_parent_identity,
        recoveryAttemptCount: candidate.recovery_attempt_count,
      }));
  }

  async stageRecoveryBatch(
    lease: AcceloRunLease,
    unresolvedId: string,
    records: Array<{
      resource: AcceloBusinessResource;
      sourceId: string;
      sourceModifiedAt: string | null;
      sourceDeleted: boolean;
      payload: Record<string, unknown>;
      normalizedPayload: Record<string, unknown>;
    }>,
  ): Promise<void> {
    const { error } = await this.client.rpc("stage_accelo_recovery_batch", {
      target_run_id: uuidSchema.parse(lease.runId),
      target_lease_token: uuidSchema.parse(lease.leaseToken),
      target_unresolved_id: uuidSchema.parse(unresolvedId),
      target_records: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .max(8)
        .parse(
          records.map((record) => ({
            entity_type: acceloBusinessResourceSchema.parse(record.resource),
            source_id: record.sourceId,
            source_updated_at: record.sourceModifiedAt,
            source_deleted: record.sourceDeleted,
            raw_payload: record.payload,
            normalized_payload: record.normalizedPayload,
            transformer_version: ACCELO_TRANSFORMER_VERSION,
          })),
        ),
    });
    if (error) throw repositoryError("recovery", error);
  }

  async recordRecoveryFailure(
    lease: AcceloRunLease,
    unresolvedId: string,
    reasonCode: "source_not_found" | "unsupported_parent" | "source_read_failed",
    terminal: boolean,
  ): Promise<void> {
    const { error } = await this.client.rpc("record_accelo_recovery_failure", {
      target_run_id: uuidSchema.parse(lease.runId),
      target_lease_token: uuidSchema.parse(lease.leaseToken),
      target_unresolved_id: uuidSchema.parse(unresolvedId),
      target_reason_code: reasonCode,
      target_terminal: terminal,
    });
    if (error) throw repositoryError("recovery", error);
  }

  async reapStaleRuns(): Promise<number> {
    const { data, error } = await this.client.rpc("reap_stale_accelo_pull_runs");
    if (error) throw repositoryError("reaper", error);
    return nonnegativeInteger(data);
  }

  async finalizeRun(
    lease: AcceloRunLease,
    summary: AcceloIngestionSummary,
  ): Promise<void> {
    const { error } = await this.client.rpc("finalize_accelo_pull_run", {
      target_run_id: uuidSchema.parse(lease.runId),
      target_lease_token: uuidSchema.parse(lease.leaseToken),
      target_end_cursor: summaryCursor(summary),
      target_summary: publicSummary(summary),
    });
    if (error) throw repositoryError("finalize", error);
  }

  async failRun(lease: AcceloRunLease, errorCode: string): Promise<void> {
    const sanitizedCode = z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .catch("ingestion_failed")
      .parse(errorCode);
    const { data, error } = await this.client
      .from("accelo_pull_runs")
      .update({
        status: "failed",
        error_message: sanitizedCode,
        finalized_at: new Date().toISOString(),
      })
      .eq("id", uuidSchema.parse(lease.runId))
      .eq("lease_token", uuidSchema.parse(lease.leaseToken))
      .eq("status", "running")
      .select("id")
      .maybeSingle();
    if (error || !data) {
      throw repositoryError("finalize", error ?? { code: "lease_lost" });
    }
  }
}

export function createRunIdempotencyKey(
  mode: AcceloSyncMode,
  date = new Date(),
  resources: readonly AcceloBusinessResource[] = ACCELO_BUSINESS_RESOURCES,
) {
  const bucket = date.toISOString().slice(0, 16);
  const resourceHash = createHash("sha256")
    .update([...resources].sort().join(","))
    .digest("hex")
    .slice(0, 12);
  return `accelo:${mode}:${bucket}:${resourceHash}`;
}

function repositoryError(
  operation: AcceloRepositoryError["operation"],
  error: { code?: string | null },
) {
  console.error("accelo.repository", {
    operation,
    databaseCode: error.code ?? "unknown",
  });
  return new AcceloRepositoryError(operation, error.code ?? null);
}

function publicSummary(summary: AcceloIngestionSummary) {
  return {
    mode: summary.mode,
    records: summary.records,
    pages: summary.pages,
    quarantined: summary.quarantined,
    truncated: summary.truncated,
    resource_count: summary.resources.length,
    resources: Object.fromEntries(
      summary.resources.map((resource) => [
        resource.resource,
        {
          expected_count: resource.expectedCount,
          complete: resource.complete,
          scan_id: resource.watermark.scanId ?? null,
          records: resource.records,
          quarantined: resource.quarantined,
        },
      ]),
    ),
  };
}

function summaryCursor(summary: AcceloIngestionSummary) {
  return Object.fromEntries(
    summary.resources.map((resource) => [
      resource.resource,
      resource.watermark,
    ]),
  );
}

function quarantineSourceId(payload: unknown) {
  if (payload && typeof payload === "object" && "id" in payload) {
    const id = String((payload as { id?: unknown }).id ?? "").trim();
    if (id) return id.slice(0, 500);
  }
  return `invalid-${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

function asJsonObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : { invalid_payload: true, quarantine_id: randomUUID() };
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function nonnegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function emptyWatermark(): AcceloWatermark {
  return {
    sourceModifiedAt: null,
    sourceId: null,
    scanId: null,
    nextPage: 0,
    pendingSourceModifiedAt: null,
    pendingSourceId: null,
  };
}

