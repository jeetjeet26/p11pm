import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  correlationIdFromRequest,
  recordProductionAudit,
} from "@/lib/production/audit";

const payloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_token"),
    name: z.string().trim().min(3).max(120),
    scopes: z
      .array(z.enum(["projects:read", "issues:read", "issues:write", "chat:read"]))
      .min(1)
      .max(10),
    expiresAt: z.iso.datetime().optional(),
  }),
  z.object({
    action: z.literal("revoke_token"),
    tokenId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("grant_guest"),
    projectId: z.string().uuid(),
    profileId: z.string().uuid(),
    accessRole: z.enum(["viewer", "commenter", "reviewer"]),
    canAccessChat: z.boolean().default(false),
    expiresAt: z.iso.datetime().optional(),
  }),
  z.object({
    action: z.literal("revoke_guest"),
    grantId: z.string().uuid(),
  }),
]);

export async function GET() {
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const [tokens, guests, projects, profiles] = await Promise.all([
    auth.client
      .from("integration_api_tokens")
      .select("id,name,token_prefix,scopes,last_used_at,expires_at,revoked_at,created_at")
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false }),
    auth.client
      .from("guest_project_access")
      .select(
        "id,project_id,profile_id,access_role,can_access_chat,expires_at,created_at,projects(name),profiles(full_name,email)",
      )
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false }),
    auth.client
      .from("projects")
      .select("id,name,code")
      .eq("organization_id", auth.organizationId)
      .order("name"),
    auth.client
      .from("profiles")
      .select("id,full_name,email,role")
      .eq("organization_id", auth.organizationId)
      .eq("status", "active")
      .order("full_name"),
  ]);
  const error = tokens.error ?? guests.error ?? projects.error ?? profiles.error;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({
    tokens: tokens.data ?? [],
    guests: guests.data ?? [],
    projects: projects.data ?? [],
    profiles: profiles.data ?? [],
    viewer: {
      role: auth.role,
      canManageTokens: auth.role === "admin",
      canManageGuests: true,
    },
    integrations: [
      {
        name: "Slack",
        configured: Boolean(
          process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET,
        ),
      },
      {
        name: "AI Gateway",
        configured: Boolean(
          process.env.AI_GATEWAY_API_KEY ||
            process.env.VERCEL_OIDC_TOKEN ||
            process.env.VERCEL,
        ),
      },
      {
        name: "MCP",
        configured: Boolean(process.env.MCP_API_KEY),
      },
    ],
  });
}

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid admin operation." },
      { status: 400 },
    );
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  const correlationId = correlationIdFromRequest(request);

  if (
    (input.action === "create_token" || input.action === "revoke_token") &&
    auth.role !== "admin"
  ) {
    return Response.json(
      { error: "Administrator access is required for API token changes." },
      { status: 403 },
    );
  }

  if (input.action === "create_token") {
    const secret = randomBytes(32).toString("base64url");
    const rawToken = `p11_${secret}`;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const { data, error } = await auth.client
      .from("integration_api_tokens")
      .insert({
        organization_id: auth.organizationId,
        name: input.name,
        token_prefix: rawToken.slice(0, 12),
        token_hash: tokenHash,
        scopes: [...new Set(input.scopes)],
        expires_at: input.expiresAt ?? null,
        created_by: auth.userId,
      })
      .select("id,name,token_prefix,scopes,expires_at,created_at")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordProductionAudit({
      organizationId: auth.organizationId,
      actionCategory: "privileged",
      actionType: "create_integration_token",
      entityType: "integration_api_token",
      entityId: data.id,
      afterState: { name: data.name, scopes: data.scopes },
      actorId: auth.userId,
      requestCorrelationId: correlationId,
      idempotencyKey: `token-create:${data.id}`,
    });
    return Response.json({ item: data, token: rawToken }, { status: 201 });
  }

  if (input.action === "revoke_token") {
    const { error } = await auth.client
      .from("integration_api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", input.tokenId)
      .eq("organization_id", auth.organizationId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordProductionAudit({
      organizationId: auth.organizationId,
      actionCategory: "privileged",
      actionType: "revoke_integration_token",
      entityType: "integration_api_token",
      entityId: input.tokenId,
      afterState: { revoked: true },
      actorId: auth.userId,
      requestCorrelationId: correlationId,
      idempotencyKey: `token-revoke:${input.tokenId}`,
    });
    return Response.json({ revoked: true });
  }

  if (input.action === "grant_guest") {
    const { data, error } = await auth.client
      .from("guest_project_access")
      .upsert(
        {
          organization_id: auth.organizationId,
          project_id: input.projectId,
          profile_id: input.profileId,
          access_role: input.accessRole,
          can_access_chat: input.canAccessChat,
          expires_at: input.expiresAt ?? null,
          granted_by: auth.userId,
        },
        { onConflict: "project_id,profile_id" },
      )
      .select()
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordProductionAudit({
      organizationId: auth.organizationId,
      actionCategory: "privileged",
      actionType: "grant_guest_access",
      entityType: "guest_project_access",
      entityId: data.id,
      afterState: {
        project_id: input.projectId,
        profile_id: input.profileId,
        access_role: input.accessRole,
      },
      actorId: auth.userId,
      requestCorrelationId: correlationId,
      idempotencyKey: `guest-grant:${data.id}`,
    });
    return Response.json({ item: data }, { status: 201 });
  }

  const { error } = await auth.client
    .from("guest_project_access")
    .delete()
    .eq("id", input.grantId)
    .eq("organization_id", auth.organizationId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await recordProductionAudit({
    organizationId: auth.organizationId,
    actionCategory: "privileged",
    actionType: "revoke_guest_access",
    entityType: "guest_project_access",
    entityId: input.grantId,
    afterState: { revoked: true },
    actorId: auth.userId,
    requestCorrelationId: correlationId,
    idempotencyKey: `guest-revoke:${input.grantId}`,
  });
  return Response.json({ revoked: true });
}

async function managerContext() {
  const client = await createClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: profile } = await client
    .from("profiles")
    .select("organization_id,role")
    .eq("id", user.id)
    .eq("status", "active")
    .single();
  if (
    !profile?.organization_id ||
    !["admin", "manager"].includes(String(profile.role))
  ) {
    return {
      ok: false as const,
      response: Response.json({ error: "Manager access required." }, { status: 403 }),
    };
  }
  return {
    ok: true as const,
    client,
    userId: user.id,
    organizationId: profile.organization_id,
    role: String(profile.role) as "admin" | "manager",
  };
}
