import { getViewer } from "@/lib/auth/viewer";
import { getAppSupabaseClient } from "@/lib/integrations/supabase";
import {
  correlationIdFromRequest,
  recordProductionAudit,
} from "@/lib/production/audit";
import { z } from "zod";

const uuid = z.string().uuid();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search_audit"),
    actionCategory: z
      .enum(["privileged", "finance", "authority", "export", "share", "operator"])
      .optional(),
    entityType: z.string().trim().min(2).max(64).optional(),
    requestCorrelationId: uuid.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  z.object({
    action: z.literal("list_dead_letters"),
  }),
  z.object({
    action: z.literal("retry_unresolved"),
    unresolvedId: uuid,
    reason: z.string().trim().min(3).max(1_000),
  }),
  z.object({
    action: z.literal("replay_stage"),
    stageId: uuid,
    reason: z.string().trim().min(3).max(1_000),
  }),
  z.object({
    action: z.literal("submit_file_scan"),
    fileId: uuid,
    scanStatus: z.enum(["pending", "clean", "infected", "quarantined", "error"]),
    scannerName: z.string().trim().min(2).max(64).default("interface"),
    signature: z.string().trim().max(500).optional(),
    detail: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal("record_health"),
    scope: z.enum(["platform", "organization"]).default("organization"),
    status: z.enum(["healthy", "degraded", "critical"]),
    checks: z.array(z.record(z.string(), z.unknown())).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal("begin_export"),
    exportKind: z.enum(["full", "accounting"]).default("full"),
  }),
]);

async function operatorContext() {
  const viewer = await getViewer();
  if (!viewer) {
    return {
      ok: false as const,
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }
  if (viewer.role !== "admin" && viewer.role !== "manager") {
    return {
      ok: false as const,
      response: Response.json({ error: "Manager access required." }, { status: 403 }),
    };
  }
  const client = getAppSupabaseClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Operational database access is not configured." },
        { status: 503 },
      ),
    };
  }
  return {
    ok: true as const,
    viewer,
    client,
  };
}

export async function GET() {
  const auth = await operatorContext();
  if (!auth.ok) return auth.response;

  const [deadLetters, health, alerts, unresolved, deliveries] = await Promise.all([
    auth.client.rpc("list_operator_dead_letters", {
      target_organization_id: auth.viewer.organization.id,
    }),
    auth.client
      .from("production_health_snapshots")
      .select("id,scope,status,checks,recorded_at")
      .or(
        `organization_id.is.null,organization_id.eq.${auth.viewer.organization.id}`,
      )
      .order("recorded_at", { ascending: false })
      .limit(5),
    auth.client
      .from("production_alert_events")
      .select("id,alert_key,severity,message,created_at,acknowledged_at")
      .or(
        `organization_id.is.null,organization_id.eq.${auth.viewer.organization.id}`,
      )
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    auth.client
      .from("accelo_unresolved_dependencies")
      .select(
        "id,entity_type,source_record_id,resolution_state,recovery_status,attempt_count,updated_at",
      )
      .eq("organization_id", auth.viewer.organization.id)
      .neq("resolution_state", "resolved")
      .order("updated_at", { ascending: false })
      .limit(50),
    auth.client
      .from("invoice_deliveries")
      .select("id,invoice_id,recipient_email,status,attempt_count,failure_reason,updated_at")
      .eq("organization_id", auth.viewer.organization.id)
      .in("status", ["failed", "queued"])
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  const securityMatrix = await auth.client
    .from("tenant_role_security_matrix")
    .select("table_category,table_name,role,operation,allowed,notes")
    .order("table_category")
    .order("table_name")
    .order("role")
    .order("operation");

  return Response.json({
    deadLetters: deadLetters.data ?? {},
    health: health.data ?? [],
    alerts: alerts.data ?? [],
    unresolved: unresolved.data ?? [],
    deliveries: deliveries.data ?? [],
    securityMatrix: securityMatrix.data ?? [],
  });
}

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid operator payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const auth = await operatorContext();
  if (!auth.ok) return auth.response;

  const correlationId = correlationIdFromRequest(request);

  if (parsed.data.action === "search_audit") {
    const { data, error } = await auth.client.rpc("search_production_audit", {
      target_organization_id: auth.viewer.organization.id,
      target_action_category: parsed.data.actionCategory ?? null,
      target_entity_type: parsed.data.entityType ?? null,
      target_request_correlation_id: parsed.data.requestCorrelationId ?? null,
      target_limit: parsed.data.limit,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ events: data ?? [] });
  }

  if (parsed.data.action === "list_dead_letters") {
    const { data, error } = await auth.client.rpc("list_operator_dead_letters", {
      target_organization_id: auth.viewer.organization.id,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ deadLetters: data });
  }

  if (parsed.data.action === "retry_unresolved") {
    const { data, error } = await auth.client.rpc(
      "retry_accelo_unresolved_dependency",
      {
        target_unresolved_id: parsed.data.unresolvedId,
        target_actor_id: auth.viewer.profile.id,
        target_reason: parsed.data.reason,
      },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordProductionAudit({
      organizationId: auth.viewer.organization.id,
      actionCategory: "operator",
      actionType: "retry_unresolved_api",
      entityType: "accelo_unresolved_dependency",
      entityId: parsed.data.unresolvedId,
      afterState: { result: data },
      actorId: auth.viewer.profile.id,
      requestCorrelationId: correlationId,
      idempotencyKey: `operator-retry:${parsed.data.unresolvedId}`,
    });
    return Response.json({ ok: true, result: data });
  }

  if (parsed.data.action === "replay_stage") {
    const { data, error } = await auth.client.rpc("replay_accelo_stage_record", {
      target_stage_id: parsed.data.stageId,
      target_actor_id: auth.viewer.profile.id,
      target_reason: parsed.data.reason,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, result: data });
  }

  if (parsed.data.action === "submit_file_scan") {
    const { data, error } = await auth.client.rpc("submit_file_scan_result", {
      target_file_id: parsed.data.fileId,
      target_scan_status: parsed.data.scanStatus,
      target_scanner_name: parsed.data.scannerName,
      target_signature: parsed.data.signature ?? null,
      target_detail: parsed.data.detail,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ scan: data });
  }

  if (parsed.data.action === "record_health") {
    const { data, error } = await auth.client.rpc(
      "record_production_health_snapshot",
      {
        target_scope: parsed.data.scope,
        target_status: parsed.data.status,
        target_checks: parsed.data.checks,
        target_organization_id:
          parsed.data.scope === "organization"
            ? auth.viewer.organization.id
            : null,
        target_metadata: parsed.data.metadata,
      },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ snapshot: data });
  }

  if (parsed.data.action === "begin_export") {
    const { data, error } = await auth.client.rpc("begin_organization_export", {
      target_organization_id: auth.viewer.organization.id,
      target_export_kind: parsed.data.exportKind,
      target_requested_by: auth.viewer.profile.id,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ exportRun: data });
  }

  return Response.json({ error: "Unsupported action." }, { status: 400 });
}
