import { getViewer } from "@/lib/auth/viewer";
import {
  getAcceloReadOnlyStatus,
  normalizeDeployment,
} from "@/lib/accelo/client";
import {
  ACCELO_BUSINESS_RESOURCES,
  ACCELO_READ_ONLY_SCOPE,
  acceloBusinessResourceSchema,
} from "@/lib/accelo/types";
import { getAppSupabaseClient } from "@/lib/integrations/supabase";
import { z } from "zod";

interface PullRun {
  id: string;
  status: string;
  requested_entities: string[];
  records_scanned: number;
  records_staged: number;
  records_quarantined: number;
  records_mapped: number;
  error_message: string | null;
  summary: unknown;
  heartbeat_at: string | null;
  started_at: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable_shadow") }),
  z.object({ action: z.literal("disable_schedule") }),
  z.object({
    action: z.literal("transition"),
    entityType: acceloBusinessResourceSchema,
    expectedState: z.enum([
      "disabled",
      "shadow",
      "importing",
      "accelo_authoritative",
      "final_delta",
      "supabase_authoritative",
      "audit_only",
    ]),
    targetState: z.enum([
      "disabled",
      "shadow",
      "importing",
      "accelo_authoritative",
      "final_delta",
      "supabase_authoritative",
      "audit_only",
    ]),
    note: z.string().trim().min(3).max(500),
    evidenceRunId: z.string().uuid().nullable().default(null),
  }),
  z.object({
    action: z.literal("resolve_dependency"),
    unresolvedId: z.string().uuid(),
    disposition: z.enum(["retry", "exclude", "archive"]),
    reason: z.string().trim().min(3).max(1_000),
  }),
  z.object({
    action: z.literal("rollback"),
    runId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1_000),
  }),
]);

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (viewer.role !== "admin" && viewer.role !== "manager") {
    return Response.json({ error: "Manager access required." }, { status: 403 });
  }

  const client = getAppSupabaseClient();
  if (!client) {
    return Response.json(
      { error: "Operational database access is not configured." },
      { status: 503 },
    );
  }

  const [
    settingResult,
    runsResult,
    checkpointsResult,
    unresolvedResult,
    reconciliationsResult,
    authorityResult,
    liveResult,
  ] = await Promise.all([
    client
      .from("integration_settings")
      .select(
        "enabled,settings,vault_secret_id,last_synced_at,last_error,updated_at",
      )
      .eq("organization_id", viewer.organization.id)
      .eq("provider", "accelo")
      .maybeSingle(),
    client
      .from("accelo_pull_runs")
      .select(
        "id,status,requested_entities,records_scanned,records_staged,records_quarantined,records_mapped,error_message,summary,heartbeat_at,started_at,finalized_at,created_at,updated_at",
      )
      .eq("organization_id", viewer.organization.id)
      .order("created_at", { ascending: false })
      .limit(100),
    client
      .from("accelo_pull_checkpoints")
      .select("entity_type,high_watermark,record_count,completed_at")
      .eq("organization_id", viewer.organization.id)
      .order("completed_at", { ascending: false })
      .limit(1_000),
    client
      .from("accelo_unresolved_dependencies")
      .select(
        "id,entity_type,source_record_id,reason_code,resolution_state,approved_disposition,attempt_count,required_parent_identity,last_attempted_at,recovery_status,recovery_attempt_count,recovery_reason_code,recovery_last_attempted_at",
        { count: "exact" },
      )
      .eq("organization_id", viewer.organization.id)
      .in("resolution_state", ["pending", "retry_ready"])
      .order("last_attempted_at", { ascending: false })
      .limit(500),
    client
      .from("accelo_pull_reconciliations")
      .select(
        "entity_type,expected_count,staged_count,latest_unique_staged_count,source_deleted_count,quarantined_count,mapped_count,approved_exclusion_count,destination_count,destination_missing_count,field_hash_mismatch_count,relationship_mismatch_count,relationship_missing_count,financial_source,financial_destination,inserted_count,updated_count,unchanged_count,status,details,reconciled_at,updated_at",
      )
      .eq("organization_id", viewer.organization.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    client
      .from("integration_authority_states")
      .select(
        "entity_type,state,previous_state,transition_run_id,transition_note,transitioned_by,transitioned_at",
      )
      .eq("organization_id", viewer.organization.id)
      .eq("provider", "accelo")
      .order("entity_type")
      .limit(100),
    getAcceloReadOnlyStatus()
      .then(() => ({ connected: true as const, error: null }))
      .catch(() => ({ connected: false as const, error: "connection_failed" })),
  ]);

  const queryError =
    settingResult.error ??
    runsResult.error ??
    checkpointsResult.error ??
    unresolvedResult.error ??
    reconciliationsResult.error ??
    authorityResult.error;
  if (queryError) {
    console.error("Accelo health query failed:", queryError);
    return Response.json(
      { error: "Accelo operational health is temporarily unavailable." },
      { status: 503 },
    );
  }

  const setting = settingResult.data;
  const runs = (runsResult.data ?? []) as PullRun[];
  const latestRun = runs[0];
  const heartbeatAt = latestTimestamp([
    setting?.last_synced_at,
    latestRun?.heartbeat_at,
    latestRun?.finalized_at,
    latestRun?.updated_at,
  ]);
  const credentialConfigured = Boolean(
    setting?.vault_secret_id ||
      (process.env.ACCELO_DEPLOYMENT &&
        process.env.ACCELO_CLIENT_ID &&
        process.env.ACCELO_CLIENT_SECRET),
  );
  const enabled = Boolean(setting?.enabled);
  const checkpoints = checkpointsResult.data ?? [];
  const reconciliations = reconciliationsResult.data ?? [];
  const currentReconciliations = Array.from(
    new Map(
      reconciliations.map((item) => [item.entity_type, item]),
    ).values(),
  );
  const mismatches = currentReconciliations.filter(
    (item) => item.status === "mismatch",
  );
  const driftByEntity = countBy(mismatches.map((item) => item.entity_type));
  const quarantinedRecords = unresolvedResult.count ?? 0;
  const freshness = ACCELO_BUSINESS_RESOURCES.map((resource) => {
    const checkpoint = checkpoints.find((item) => item.entity_type === resource);
    const syncedAt = checkpoint?.high_watermark ?? checkpoint?.completed_at ?? null;
    const ageMinutes = syncedAt
      ? Math.max(
          0,
          Math.round((Date.now() - new Date(syncedAt).getTime()) / 60_000),
        )
      : null;
    return {
      resource,
      syncedAt,
      ageMinutes,
      status:
        ageMinutes === null
          ? ("unknown" as const)
          : ageMinutes <= 360
            ? ("fresh" as const)
            : ageMinutes <= 1_440
              ? ("stale" as const)
              : ("overdue" as const),
      count: checkpoint?.record_count ?? null,
    };
  });
  const latestError = sanitizeProviderError(
    setting?.last_error ?? latestRun?.error_message,
  );
  let pendingReport: unknown = null;
  const deployment = process.env.ACCELO_DEPLOYMENT?.trim();
  if (deployment) {
    try {
      const { data, error } = await client.rpc("get_accelo_pending_report", {
        target_organization_id: viewer.organization.id,
        target_source_account_id: normalizeDeployment(deployment),
      });
      if (!error) pendingReport = data;
    } catch {
      pendingReport = null;
    }
  }
  const health = healthState({
    configured: credentialConfigured,
    enabled,
    heartbeatAt,
    latestRunStatus: latestRun?.status,
    quarantinedRecords,
    unresolvedDrift: mismatches.length,
  });

  return Response.json({
    provider: "accelo",
    configured: credentialConfigured,
    enabled,
    live: liveResult.connected,
    health,
    mode: "read-only",
    scope: ACCELO_READ_ONLY_SCOPE,
    resources: freshness,
    heartbeat: {
      at: heartbeatAt,
      ageMinutes: heartbeatAt
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(heartbeatAt).getTime()) / 60_000),
          )
        : null,
    },
    authority: {
      state:
        authorityResult.data?.length === 1
          ? authorityState(authorityResult.data[0].state)
          : "per-entity",
      entities: authorityResult.data ?? [],
      providerWritesAllowed: false,
      configuredWriteMode: false,
    },
    counts: {
      runs: runs.length,
      scanned: runs.reduce((sum, run) => sum + run.records_scanned, 0),
      created: runs.reduce((sum, run) => sum + run.records_mapped, 0),
      updated: reconciliations.reduce(
        (sum, item) => sum + Number(item.updated_count),
        0,
      ),
      failed: quarantinedRecords,
    },
    quarantines: {
      records: quarantinedRecords,
      latestAt: unresolvedResult.data?.[0]?.last_attempted_at ?? null,
      unresolved: unresolvedResult.data ?? [],
      deterministicReport: pendingReport,
    },
    drift: {
      unresolved: mismatches.length,
      byEntity: driftByEntity,
      oldestAt: latestTimestamp(
        mismatches.map((item) => item.reconciled_at ?? item.updated_at),
      ),
    },
    latestRuns: runs.slice(0, 10).map((run) => ({
      id: run.id,
      kind: run.requested_entities.join(","),
      direction: "pull",
      status: run.status,
      scanned: run.records_scanned,
      changed: run.records_mapped,
      failed: run.records_quarantined,
      startedAt: run.started_at,
      completedAt: run.finalized_at,
      error: sanitizeProviderError(run.error_message),
    })),
    error: latestError,
  });
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return Response.json(
      { error: "Administrator access is required for cutover controls." },
      { status: 403 },
    );
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid Accelo action." },
      { status: 400 },
    );
  }
  const client = getAppSupabaseClient();
  if (!client) {
    return Response.json(
      { error: "Operational database access is not configured." },
      { status: 503 },
    );
  }
  const deployment = process.env.ACCELO_DEPLOYMENT?.trim();
  if (!deployment) {
    return Response.json({ error: "Accelo is not configured." }, { status: 503 });
  }
  let sourceAccount: string;
  try {
    sourceAccount = normalizeDeployment(deployment);
  } catch {
    return Response.json({ error: "Accelo is not configured." }, { status: 503 });
  }

  if (parsed.data.action === "disable_schedule") {
    const { error } = await client
      .from("integration_settings")
      .update({ enabled: false, updated_by: viewer.user.id })
      .eq("organization_id", viewer.organization.id)
      .eq("provider", "accelo");
    if (error) return Response.json({ error: "Could not disable Accelo polling." }, { status: 400 });
    return Response.json({ ok: true });
  }

  if (parsed.data.action === "enable_shadow") {
    const { error } = await client.rpc("configure_accelo_shadow", {
      target_organization_id: viewer.organization.id,
      target_source_account_id: sourceAccount,
      target_entities: ACCELO_BUSINESS_RESOURCES,
      target_actor_id: viewer.user.id,
      target_reason: "Initial read-only shadow inventory",
    });
    if (error) {
      return Response.json({ error: "Could not enable Accelo shadow mode." }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  if (parsed.data.action === "resolve_dependency") {
    const { error } = await client.rpc("set_accelo_unresolved_disposition", {
      target_unresolved_id: parsed.data.unresolvedId,
      target_disposition: parsed.data.disposition,
      target_actor_id: viewer.user.id,
      target_reason: parsed.data.reason,
    });
    if (error) {
      return Response.json(
        { error: "Could not update the unresolved dependency." },
        { status: 400 },
      );
    }
    return Response.json({ ok: true });
  }

  if (parsed.data.action === "rollback") {
    const { data, error } = await client.rpc("rollback_accelo_promotion_run", {
      target_run_id: parsed.data.runId,
      target_actor_id: viewer.user.id,
      target_reason: parsed.data.reason,
    });
    if (error) {
      return Response.json(
        { error: "Rollback stopped because its safety checks failed." },
        { status: 409 },
      );
    }
    return Response.json({ ok: true, rollback: data });
  }

  const { error } = await client.rpc("set_integration_authority_state", {
    target_organization_id: viewer.organization.id,
    target_source_account_id: sourceAccount,
    target_entity_type: parsed.data.entityType,
    expected_state: parsed.data.expectedState,
    target_state: parsed.data.targetState,
    target_run_id: parsed.data.evidenceRunId,
    target_note: parsed.data.note,
    target_actor_id: viewer.user.id,
  });
  if (error) {
    return Response.json(
      { error: "Authority transition failed its expected-state guard." },
      { status: error.code === "40001" ? 409 : 400 },
    );
  }
  return Response.json({ ok: true });
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .filter((value) => Number.isFinite(new Date(value).getTime()))
    .sort(
      (left, right) =>
        new Date(right).getTime() - new Date(left).getTime(),
    );
  return valid[0] ?? null;
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = /^[a-z][a-z0-9_-]{0,63}$/i.test(value) ? value : "other";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function authorityState(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return /^[a-z0-9-]{1,80}$/.test(normalized)
    ? normalized
    : "unknown";
}

function healthState({
  configured,
  enabled,
  heartbeatAt,
  latestRunStatus,
  quarantinedRecords,
  unresolvedDrift,
}: {
  configured: boolean;
  enabled: boolean;
  heartbeatAt: string | null;
  latestRunStatus?: string;
  quarantinedRecords: number;
  unresolvedDrift: number;
}) {
  if (!configured) return "unconfigured";
  if (!enabled) return "disabled";
  if (!heartbeatAt) return "unknown";
  const ageMinutes =
    (Date.now() - new Date(heartbeatAt).getTime()) / 60_000;
  if (
    latestRunStatus === "failed" ||
    quarantinedRecords > 0 ||
    unresolvedDrift > 0
  ) {
    return "degraded";
  }
  if (ageMinutes > 1_440) return "stale";
  return "healthy";
}

export function sanitizeProviderError(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.toLowerCase();
  if (/(401|403|auth|credential|oauth|token)/.test(normalized)) {
    return "Provider authentication failed.";
  }
  if (/(429|rate.?limit|throttl)/.test(normalized)) {
    return "Provider rate limit reached.";
  }
  if (/(timeout|timed out|network|fetch)/.test(normalized)) {
    return "Provider connection timed out.";
  }
  if (/(valid|schema|malformed|parse)/.test(normalized)) {
    return "Provider data validation failed.";
  }
  return "Provider synchronization failed.";
}
