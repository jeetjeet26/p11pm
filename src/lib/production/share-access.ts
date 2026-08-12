import "server-only";

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import { getAppSupabaseClient } from "@/lib/integrations/supabase";

import { hashClientMetadata } from "./audit";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function enforceShareRateLimit(request: Request, shareToken: string) {
  const client = getAppSupabaseClient();
  if (!client) {
    return { allowed: true as const };
  }
  const { ipHash } = hashClientMetadata(request);
  const { data, error } = await client.rpc("check_file_share_rate_limit", {
    target_token_hash: tokenHash(shareToken),
    target_ip_hash: ipHash,
  });
  if (error) {
    console.error("Share rate limit check failed:", error);
    return { allowed: true as const };
  }
  const payload = data as {
    allowed?: boolean;
    reason?: string | null;
    blocked_until?: string | null;
  };
  if (payload.allowed === false) {
    return {
      allowed: false as const,
      reason: payload.reason ?? "rate_limited",
      blockedUntil: payload.blocked_until ?? null,
    };
  }
  return { allowed: true as const };
}

export async function markShareAccessSuccess(request: Request, shareToken: string) {
  const client = getAppSupabaseClient();
  if (!client) return;
  const { ipHash } = hashClientMetadata(request);
  const { error } = await client.rpc("mark_file_share_access_success", {
    target_token_hash: tokenHash(shareToken),
    target_ip_hash: ipHash,
  });
  if (error) console.error("Share access success marker failed:", error);
}

export async function recordShareDownloadAudit(input: {
  organizationId: string;
  fileId: string;
  shareId: string | null;
  request: Request;
  outcome: "delivered" | "denied" | "rate_limited";
  metadata?: Record<string, unknown>;
}) {
  const client = getAppSupabaseClient();
  if (!client) return null;
  const { ipHash, userAgentHash } = hashClientMetadata(input.request);
  const correlationId =
    input.request.headers.get("x-request-id") ??
    input.request.headers.get("x-correlation-id") ??
    randomUUID();
  const { data, error } = await client.rpc("record_file_download_audit", {
    target_organization_id: input.organizationId,
    target_file_id: input.fileId,
    target_share_id: input.shareId,
    target_actor_id: null,
    target_access_channel: "share",
    target_ip_hash: ipHash,
    target_user_agent_hash: userAgentHash,
    target_request_correlation_id: correlationId,
    target_outcome: input.outcome,
    target_metadata: input.metadata ?? {},
  });
  if (error) {
    console.error("Share download audit failed:", error);
    return null;
  }
  return data;
}
