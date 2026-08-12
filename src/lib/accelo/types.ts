import { z } from "zod";

export const ACCELO_BUSINESS_RESOURCES = [
  "companies",
  "contacts",
  "affiliations",
  "staff",
  "jobs",
  "milestones",
  "tasks",
  "contracts",
  "contract_periods",
  "activities",
  "invoices",
  "payments",
  "prospects",
  "issues",
] as const;

export const acceloBusinessResourceSchema = z.enum(ACCELO_BUSINESS_RESOURCES);
export type AcceloBusinessResource = z.infer<
  typeof acceloBusinessResourceSchema
>;

// Accelo only grants some deployment features (notably contracts/retainers)
// through its aggregate read scope. The client still enforces a strict GET-only
// resource allowlist, so this broad token cannot be used for writes or arbitrary
// endpoints.
export const ACCELO_READ_ONLY_SCOPE = "read(all)";

export const acceloRawRecordSchema = z.record(z.string(), z.unknown());

export const acceloRecordSchema = z
  .record(z.string(), z.unknown())
  .superRefine((record, context) => {
    if (
      (typeof record.id !== "string" && typeof record.id !== "number") ||
      String(record.id).trim().length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Accelo record is missing an id.",
      });
    }
  });

const responseMetaSchema = z
  .object({
    more: z.boolean().optional(),
    page: z.coerce.number().int().nonnegative().optional(),
    pages: z.coerce.number().int().nonnegative().optional(),
    total: z.coerce.number().int().nonnegative().optional(),
  })
  .passthrough();

export const acceloCollectionSchema = z
  .object({
    response: z.array(z.unknown()),
    meta: responseMetaSchema.optional(),
  })
  .passthrough();

export interface AcceloPage {
  records: Record<string, unknown>[];
  hasMore: boolean;
  page: number;
  total: number | null;
}

export interface AcceloPageRequest {
  page?: number;
  pageSize?: number;
  fields?: string;
  filters?: string;
}

export interface AcceloRecordRequest {
  fields?: string;
}

export interface AcceloPaginationLimits {
  maxPages: number;
  maxRecords: number;
  maxDurationMs: number;
  pageSize: number;
}

export const DEFAULT_ACCELO_LIMITS: AcceloPaginationLimits = {
  maxPages: 50,
  maxRecords: 5_000,
  maxDurationMs: 240_000,
  pageSize: 100,
};

export type AcceloSyncMode = "inventory" | "incremental";

export interface AcceloWatermark {
  sourceModifiedAt: string | null;
  sourceId: string | null;
  nextPage: number;
  scanId?: string | null;
  pendingSourceModifiedAt?: string | null;
  pendingSourceId?: string | null;
}

export interface AcceloResourceSummary {
  resource: AcceloBusinessResource;
  pages: number;
  records: number;
  quarantined: number;
  truncated: boolean;
  complete: boolean;
  expectedCount: number | null;
  watermark: AcceloWatermark;
}
