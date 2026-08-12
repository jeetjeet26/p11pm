import "server-only";

import { AcceloClientError, type AcceloClient } from "@/lib/accelo/client";
import {
  ACCELO_TRANSFORMER_VERSION,
  extractSourceModifiedAt,
  isSourceDeleted,
} from "@/lib/accelo/ingestion";
import type {
  AcceloRunLease,
  SupabaseAcceloRepository,
} from "@/lib/accelo/repository";
import {
  fieldsForAcceloResource,
  normalizeAcceloRecord,
} from "@/lib/accelo/transform";
import type { AcceloBusinessResource } from "@/lib/accelo/types";

const MAX_RECOVERY_RECORDS = 50;
const MAX_RECORDS_PER_ORPHAN = 8;

type RecoveryRepository = Pick<
  SupabaseAcceloRepository,
  "claimActivityRecoveries" | "stageRecoveryBatch" | "recordRecoveryFailure"
>;

interface RecoveryReference {
  resource: AcceloBusinessResource;
  sourceId: string;
}

export interface AcceloRecoverySummary {
  claimed: number;
  recovered: number;
  pending: number;
  stagedParents: number;
}

export async function recoverAcceloActivityParents(input: {
  lease: AcceloRunLease;
  client: Pick<AcceloClient, "getRecord">;
  repository: RecoveryRepository;
}): Promise<AcceloRecoverySummary> {
  const candidates = await input.repository.claimActivityRecoveries(input.lease);
  let recovered = 0;
  let pending = 0;
  let stagedParents = 0;

  for (const candidate of candidates) {
    if (stagedParents >= MAX_RECOVERY_RECORDS) {
      pending += 1;
      continue;
    }
    const root = recoveryReference(candidate.requiredParentIdentity);
    if (!root) {
      await input.repository.recordRecoveryFailure(
        input.lease,
        candidate.unresolvedId,
        "unsupported_parent",
        true,
      );
      pending += 1;
      continue;
    }

    try {
      const records = await fetchRecoveryGraph(input.client, root);
      if (stagedParents + records.length > MAX_RECOVERY_RECORDS) {
        await input.repository.recordRecoveryFailure(
          input.lease,
          candidate.unresolvedId,
          "source_read_failed",
          false,
        );
        pending += 1;
        continue;
      }
      await input.repository.stageRecoveryBatch(
        input.lease,
        candidate.unresolvedId,
        records,
      );
      stagedParents += records.length;
      recovered += 1;
    } catch (error) {
      const notFound = error instanceof AcceloClientError && error.status === 404;
      await input.repository.recordRecoveryFailure(
        input.lease,
        candidate.unresolvedId,
        notFound ? "source_not_found" : "source_read_failed",
        notFound || candidate.recoveryAttemptCount >= 3,
      );
      pending += 1;
    }
  }

  return {
    claimed: candidates.length,
    recovered,
    pending,
    stagedParents,
  };
}

async function fetchRecoveryGraph(
  client: Pick<AcceloClient, "getRecord">,
  root: RecoveryReference,
) {
  const pending: RecoveryReference[] = [root];
  const seen = new Set<string>();
  const records: Array<{
    resource: AcceloBusinessResource;
    sourceId: string;
    sourceModifiedAt: string | null;
    sourceDeleted: boolean;
    payload: Record<string, unknown>;
    normalizedPayload: Record<string, unknown>;
    transformerVersion: number;
  }> = [];

  while (pending.length) {
    const reference = pending.shift();
    if (!reference) break;
    const key = `${reference.resource}:${reference.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (records.length >= MAX_RECORDS_PER_ORPHAN) {
      throw new AcceloClientError(
        "Accelo parent recovery graph exceeded its bound.",
        "invalid_response",
      );
    }

    const payload = await client.getRecord(
      reference.resource,
      reference.sourceId,
      { fields: fieldsForAcceloResource(reference.resource) },
    );
    const normalizedPayload = normalizeAcceloRecord(reference.resource, payload);
    records.push({
      resource: reference.resource,
      sourceId: String(payload.id),
      sourceModifiedAt: extractSourceModifiedAt(payload),
      sourceDeleted: isSourceDeleted(payload),
      payload,
      normalizedPayload,
      transformerVersion: ACCELO_TRANSFORMER_VERSION,
    });
    pending.push(...recoveryDependencies(reference.resource, normalizedPayload));
  }

  return records.sort(
    (left, right) =>
      recoveryOrder(left.resource) - recoveryOrder(right.resource) ||
      left.sourceId.localeCompare(right.sourceId),
  );
}

function recoveryReference(
  identity: Record<string, unknown>,
): RecoveryReference | null {
  const entityType = String(identity.entity_type ?? "").trim().toLowerCase();
  const sourceId = String(identity.source_record_id ?? "").trim();
  const resource = resourceForRelationship(entityType);
  return resource && sourceId ? { resource, sourceId: pathId(sourceId) } : null;
}

function recoveryDependencies(
  resource: AcceloBusinessResource,
  payload: Record<string, unknown>,
): RecoveryReference[] {
  const references: Array<[string, unknown]> = [];
  if (resource === "jobs" || resource === "contracts" || resource === "issues") {
    references.push(["companies", payload.company_source_id]);
  } else if (resource === "contract_periods") {
    references.push(["contracts", payload.contract_source_id]);
  } else if (resource === "affiliations") {
    references.push(
      ["companies", payload.company_source_id],
      ["contacts", payload.contact_source_id],
    );
  } else if (resource === "milestones" || resource === "tasks") {
    references.push(["jobs", payload.job_source_id]);
  } else if (resource === "payments") {
    references.push(["invoices", payload.against_source_id]);
  } else if (resource === "invoices") {
    references.push([
      String(payload.against_type ?? ""),
      payload.against_source_id,
    ]);
  }
  return references.flatMap(([entityType, sourceId]) => {
    const resource = resourceForRelationship(entityType);
    const id = String(sourceId ?? "").trim();
    return resource && id ? [{ resource, sourceId: pathId(id) }] : [];
  });
}

function resourceForRelationship(
  input: string,
): AcceloBusinessResource | null {
  const normalized = input.trim().toLowerCase().replaceAll("-", "_");
  const resources: Record<string, AcceloBusinessResource> = {
    company: "companies",
    companies: "companies",
    contact: "contacts",
    contacts: "contacts",
    affiliation: "affiliations",
    affiliations: "affiliations",
    job: "jobs",
    jobs: "jobs",
    contract: "contracts",
    contracts: "contracts",
    contract_period: "contract_periods",
    contract_periods: "contract_periods",
    milestone: "milestones",
    milestones: "milestones",
    task: "tasks",
    tasks: "tasks",
    issue: "issues",
    issues: "issues",
    account_invoice: "invoices",
    invoice: "invoices",
    invoices: "invoices",
    payment: "payments",
    payments: "payments",
  };
  return resources[normalized] ?? null;
}

function recoveryOrder(resource: AcceloBusinessResource) {
  return [
    "companies",
    "contacts",
    "staff",
    "affiliations",
    "jobs",
    "contracts",
    "contract_periods",
    "milestones",
    "tasks",
    "issues",
    "prospects",
    "invoices",
    "payments",
    "activities",
  ].indexOf(resource);
}

function pathId(value: string) {
  return value.includes("/")
    ? (value.split("/").filter(Boolean).at(-1) ?? value)
    : value;
}
