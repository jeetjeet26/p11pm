import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { getAppSupabaseClient } from "@/lib/integrations/supabase";

export type ProductionAuditCategory =
  | "privileged"
  | "finance"
  | "authority"
  | "export"
  | "share"
  | "operator";

export interface ProductionAuditInput {
  organizationId: string;
  actionCategory: ProductionAuditCategory;
  actionType: string;
  entityType: string;
  entityId?: string | null;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
  actorId?: string | null;
  requestCorrelationId?: string;
}

export function stableJsonHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}

export function correlationIdFromRequest(request: Request) {
  return (
    request.headers.get("x-request-id") ??
    request.headers.get("x-correlation-id") ??
    randomUUID()
  );
}

export async function recordProductionAudit(input: ProductionAuditInput) {
  const client = getAppSupabaseClient();
  if (!client) return null;

  const beforeState = input.beforeState ?? {};
  const afterState = input.afterState ?? {};
  const correlationId = input.requestCorrelationId ?? randomUUID();

  const { data, error } = await client.rpc("record_production_audit", {
    target_organization_id: input.organizationId,
    target_action_category: input.actionCategory,
    target_action_type: input.actionType,
    target_entity_type: input.entityType,
    target_entity_id: input.entityId ?? null,
    target_before_state: beforeState,
    target_after_state: afterState,
    target_request_correlation_id: correlationId,
    target_metadata: input.metadata ?? {},
    target_idempotency_key: input.idempotencyKey ?? null,
    target_actor_id: input.actorId ?? null,
  });

  if (error) {
    console.error("Production audit recording failed:", error);
    return null;
  }

  return data;
}

export function hashClientMetadata(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return {
    ipHash: createHash("sha256").update(ip).digest("hex"),
    userAgentHash: createHash("sha256").update(userAgent).digest("hex"),
  };
}
