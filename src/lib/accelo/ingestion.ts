import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { AcceloClient } from "@/lib/accelo/client";
import {
  fieldsForAcceloResource,
  normalizeAcceloRecord,
} from "@/lib/accelo/transform";
import {
  ACCELO_BUSINESS_RESOURCES,
  acceloRecordSchema,
  DEFAULT_ACCELO_LIMITS,
  type AcceloBusinessResource,
  type AcceloPaginationLimits,
  type AcceloResourceSummary,
  type AcceloSyncMode,
  type AcceloWatermark,
} from "@/lib/accelo/types";

const MAX_RECORD_BYTES = 2 * 1024 * 1024;
export const ACCELO_TRANSFORMER_VERSION = 3;

const limitsSchema = z
  .object({
    maxPages: z.number().int().min(1).max(200),
    maxRecords: z.number().int().min(1).max(50_000),
    maxDurationMs: z.number().int().min(1_000).max(290_000),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

const runLimitsSchema = z
  .object({
    maxTotalRecords: z.number().int().min(1).max(100_000),
    maxTotalPages: z.number().int().min(1).max(1_000),
    maxDurationMs: z.number().int().min(1_000).max(290_000),
  })
  .strict();

export interface AcceloStageRecord {
  sourceId: string;
  sourceModifiedAt: string | null;
  sourceDeleted: boolean;
  payloadHash: string;
  payload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  transformerVersion: number;
}

export interface AcceloQuarantineRecord {
  reasonCode: "invalid_record" | "record_too_large";
  payload: unknown;
}

export interface AcceloStagePage {
  organizationId: string;
  runId: string;
  leaseToken: string;
  resource: AcceloBusinessResource;
  page: number;
  records: AcceloStageRecord[];
  quarantines: AcceloQuarantineRecord[];
  checkpoint: AcceloWatermark;
}

export interface AcceloIngestionRepository {
  getCheckpoint(
    organizationId: string,
    sourceAccountId: string,
    resource: AcceloBusinessResource,
  ): Promise<AcceloWatermark>;
  stagePage(input: AcceloStagePage): Promise<void>;
  heartbeat(runId: string, leaseToken: string): Promise<void>;
}

export interface RunAcceloIngestionInput {
  organizationId: string;
  sourceAccountId: string;
  runId: string;
  leaseToken: string;
  mode: AcceloSyncMode;
  client: Pick<AcceloClient, "getPage">;
  repository: AcceloIngestionRepository;
  resources?: readonly AcceloBusinessResource[];
  resourceLimits?: Partial<AcceloPaginationLimits>;
  maxTotalRecords?: number;
  maxTotalPages?: number;
  maxDurationMs?: number;
  now?: () => number;
}

export interface AcceloIngestionSummary {
  mode: AcceloSyncMode;
  resources: AcceloResourceSummary[];
  records: number;
  pages: number;
  quarantined: number;
  truncated: boolean;
}

interface ResourcePolicy {
  modifiedField: string | null;
  overlapSeconds: number;
}

const RESOURCE_POLICIES: Record<AcceloBusinessResource, ResourcePolicy> = {
  companies: { modifiedField: "date_modified", overlapSeconds: 900 },
  contacts: { modifiedField: "date_modified", overlapSeconds: 900 },
  affiliations: { modifiedField: "date_modified", overlapSeconds: 900 },
  staff: { modifiedField: "date_modified", overlapSeconds: 900 },
  jobs: { modifiedField: "date_modified", overlapSeconds: 900 },
  milestones: { modifiedField: "date_modified", overlapSeconds: 900 },
  tasks: { modifiedField: "date_modified", overlapSeconds: 900 },
  contracts: { modifiedField: "date_modified", overlapSeconds: 900 },
  contract_periods: { modifiedField: "date_modified", overlapSeconds: 900 },
  activities: { modifiedField: "date_modified", overlapSeconds: 900 },
  invoices: { modifiedField: "date_modified", overlapSeconds: 900 },
  payments: { modifiedField: "date_modified", overlapSeconds: 900 },
  prospects: { modifiedField: "date_modified", overlapSeconds: 900 },
  issues: { modifiedField: "date_modified", overlapSeconds: 900 },
};

export async function runAcceloIngestion(
  input: RunAcceloIngestionInput,
): Promise<AcceloIngestionSummary> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const limits = limitsSchema.parse({
    ...DEFAULT_ACCELO_LIMITS,
    ...input.resourceLimits,
  });
  const runLimits = runLimitsSchema.parse({
    maxTotalRecords: input.maxTotalRecords ?? 10_000,
    maxTotalPages: input.maxTotalPages ?? 150,
    maxDurationMs: input.maxDurationMs ?? 240_000,
  });
  const resources = input.resources ?? ACCELO_BUSINESS_RESOURCES;
  const summaries: AcceloResourceSummary[] = [];
  let totalRecords = 0;
  let totalPages = 0;
  let totalQuarantined = 0;
  let runTruncated = false;

  for (const resource of resources) {
    if (hardRunLimitReached()) {
      runTruncated = true;
      break;
    }
    const initialCheckpoint = normalizeWatermark(
      await input.repository.getCheckpoint(
        input.organizationId,
        input.sourceAccountId,
        resource,
      ),
    );
    const scanId =
      initialCheckpoint.nextPage > 0 && initialCheckpoint.scanId
        ? initialCheckpoint.scanId
        : createHash("sha256")
            .update(
              [
                input.organizationId,
                input.sourceAccountId,
                resource,
                input.mode,
                String(startedAt),
              ].join(":"),
            )
            .digest("hex");
    let checkpoint = initialCheckpoint;
    let page = checkpoint.nextPage;
    let pages = 0;
    let records = 0;
    let quarantined = 0;
    let hasMore = true;
    let resourceTruncated = false;
    let expectedCount: number | null = null;

    while (hasMore) {
      if (
        pages >= limits.maxPages ||
        records >= limits.maxRecords ||
        hardRunLimitReached()
      ) {
        resourceTruncated = true;
        runTruncated = true;
        break;
      }

      const policy = RESOURCE_POLICIES[resource];
      const remainingRecordCapacity = Math.min(
        limits.maxRecords - records,
        runLimits.maxTotalRecords - totalRecords,
      );
      const batchSize =
        resource === "activities" && input.mode === "inventory"
          ? Math.min(
              5,
              limits.maxPages - pages,
              runLimits.maxTotalPages - totalPages,
              Math.max(
                1,
                Math.floor(remainingRecordCapacity / limits.pageSize),
              ),
            )
          : 1;
      const responses = await Promise.all(
        Array.from({ length: batchSize }, (_, offset) =>
          input.client.getPage(resource, {
            page: page + offset,
            pageSize: Math.min(
              limits.pageSize,
              remainingRecordCapacity - offset * limits.pageSize,
            ),
            fields: fieldsForAcceloResource(resource),
            filters:
              input.mode === "incremental"
                ? buildIncrementalFilters(policy, initialCheckpoint)
                : undefined,
          }),
        ),
      );
      const stagedPages: AcceloStagePage[] = [];

      for (const response of responses) {
        if (!hasMore) break;
        pages += 1;
        totalPages += 1;
        expectedCount ??= response.total;

        const staged: AcceloStageRecord[] = [];
        const rejected: AcceloQuarantineRecord[] = [];
        let pending = pendingWatermark(checkpoint);
        for (const rawRecord of response.records) {
          const byteLength = Buffer.byteLength(
            JSON.stringify(rawRecord),
            "utf8",
          );
          if (byteLength > MAX_RECORD_BYTES) {
            rejected.push({
              reasonCode: "record_too_large",
              payload: rawRecord,
            });
            continue;
          }
          const parsed = acceloRecordSchema.safeParse(rawRecord);
          if (!parsed.success) {
            rejected.push({ reasonCode: "invalid_record", payload: rawRecord });
            continue;
          }
          const sourceId = String(parsed.data.id);
          const sourceModifiedAt = extractSourceModifiedAt(parsed.data);
          pending = laterWatermark(pending, {
            sourceModifiedAt,
            sourceId,
            nextPage: 0,
          });
          staged.push({
            sourceId,
            sourceModifiedAt,
            sourceDeleted: isSourceDeleted(parsed.data),
            payloadHash: hashPayload(parsed.data),
            payload: parsed.data,
            normalizedPayload: normalizeAcceloRecord(resource, parsed.data),
            transformerVersion: ACCELO_TRANSFORMER_VERSION,
          });
        }

        hasMore = response.hasMore;
        const nextPage = hasMore ? response.page + 1 : 0;
        checkpoint = hasMore
          ? {
              ...initialCheckpoint,
              scanId,
              nextPage,
              pendingSourceModifiedAt: pending.sourceModifiedAt,
              pendingSourceId: pending.sourceId,
            }
          : {
              sourceModifiedAt: pending.sourceModifiedAt,
              sourceId: pending.sourceId,
              scanId,
              nextPage: 0,
              pendingSourceModifiedAt: null,
              pendingSourceId: null,
            };

        stagedPages.push({
          organizationId: input.organizationId,
          runId: input.runId,
          leaseToken: input.leaseToken,
          resource,
          page: response.page,
          records: staged,
          quarantines: rejected,
          checkpoint,
        });

        const observed = staged.length + rejected.length;
        records += observed;
        quarantined += rejected.length;
        totalRecords += observed;
        totalQuarantined += rejected.length;
        page = nextPage;
      }
      await Promise.all(
        stagedPages.map((stagedPage) =>
          input.repository.stagePage(stagedPage),
        ),
      );
      await input.repository.heartbeat(input.runId, input.leaseToken);
    }

    summaries.push({
      resource,
      pages,
      records,
      quarantined,
      truncated: resourceTruncated,
      complete: !resourceTruncated && !hasMore && checkpoint.nextPage === 0,
      expectedCount,
      watermark: checkpoint,
    });
  }

  return {
    mode: input.mode,
    resources: summaries,
    records: totalRecords,
    pages: totalPages,
    quarantined: totalQuarantined,
    truncated: runTruncated,
  };

  function hardRunLimitReached() {
    return (
      totalRecords >= runLimits.maxTotalRecords ||
      totalPages >= runLimits.maxTotalPages ||
      now() - startedAt >= Math.min(runLimits.maxDurationMs, limits.maxDurationMs)
    );
  }
}

export function buildIncrementalFilters(
  policy: ResourcePolicy,
  checkpoint: AcceloWatermark,
) {
  if (!policy.modifiedField || !checkpoint.sourceModifiedAt) return undefined;
  const timestamp = Date.parse(checkpoint.sourceModifiedAt);
  if (!Number.isFinite(timestamp)) return undefined;
  const after = Math.max(
    0,
    Math.floor(timestamp / 1_000) - policy.overlapSeconds,
  );
  return `${policy.modifiedField}_after(${after}),order_by_asc(${policy.modifiedField})`;
}

export function extractSourceModifiedAt(record: Record<string, unknown>) {
  for (const key of [
    "date_modified",
    "date_updated",
    "updated_at",
    "modified_at",
    "date_logged",
  ]) {
    const normalized = normalizeDate(record[key]);
    if (normalized) return normalized;
  }
  return null;
}

export function isSourceDeleted(record: Record<string, unknown>) {
  const status = String(record.standing ?? record.status ?? "")
    .trim()
    .toLowerCase();
  return (
    record.deleted === true ||
    record.deleted === 1 ||
    record.deleted === "1" ||
    record.is_deleted === true ||
    record.is_deleted === 1 ||
    record.is_deleted === "1" ||
    status === "deleted" ||
    status === "retired"
  );
}

export function hashPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function normalizeWatermark(
  watermark: Partial<AcceloWatermark> | null | undefined,
): AcceloWatermark & {
  scanId: string | null;
  pendingSourceModifiedAt: string | null;
  pendingSourceId: string | null;
} {
  return {
    sourceModifiedAt: watermark?.sourceModifiedAt ?? null,
    sourceId: watermark?.sourceId ?? null,
    scanId:
      typeof watermark?.scanId === "string" && watermark.scanId.trim()
        ? watermark.scanId
        : null,
    nextPage:
      Number.isInteger(watermark?.nextPage) && Number(watermark?.nextPage) >= 0
        ? Number(watermark?.nextPage)
        : 0,
    pendingSourceModifiedAt:
      "pendingSourceModifiedAt" in (watermark ?? {})
        ? String(
            (
              watermark as AcceloWatermark & {
                pendingSourceModifiedAt?: unknown;
              }
            ).pendingSourceModifiedAt ?? "",
          ) || null
        : null,
    pendingSourceId:
      "pendingSourceId" in (watermark ?? {})
        ? String(
            (
              watermark as AcceloWatermark & { pendingSourceId?: unknown }
            ).pendingSourceId ?? "",
          ) || null
        : null,
  };
}

function pendingWatermark(
  checkpoint: AcceloWatermark & {
    pendingSourceModifiedAt?: string | null;
    pendingSourceId?: string | null;
  },
): AcceloWatermark {
  return {
    sourceModifiedAt:
      checkpoint.pendingSourceModifiedAt ?? checkpoint.sourceModifiedAt,
    sourceId: checkpoint.pendingSourceId ?? checkpoint.sourceId,
    nextPage: 0,
  };
}

function laterWatermark(
  left: AcceloWatermark,
  right: AcceloWatermark,
): AcceloWatermark {
  const leftTime = left.sourceModifiedAt
    ? Date.parse(left.sourceModifiedAt)
    : Number.NEGATIVE_INFINITY;
  const rightTime = right.sourceModifiedAt
    ? Date.parse(right.sourceModifiedAt)
    : Number.NEGATIVE_INFINITY;
  if (rightTime > leftTime) return right;
  if (rightTime < leftTime) return left;
  return (right.sourceId ?? "").localeCompare(left.sourceId ?? "") > 0
    ? right
    : left;
}

function normalizeDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d+$/.test(value)) return normalizeDate(Number(value));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
