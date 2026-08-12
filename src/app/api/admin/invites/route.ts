import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: z.enum(["admin", "manager", "member", "viewer"]).default("member"),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["resend", "revoke"]),
});

export async function GET() {
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.client
    .from("invites")
    .select("id,email,role,status,expires_at,accepted_at,created_at")
    .eq("organization_id", auth.organizationId)
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ invites: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid invitation." },
      { status: 400 },
    );
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await auth.client
    .from("invites")
    .insert({
      organization_id: auth.organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
      token_hash: tokenHash,
      invited_by: auth.userId,
    })
    .select("id,email,role,status,expires_at,created_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json(
    { invite: data, inviteUrl: inviteUrl(request, token) },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid invitation update." }, { status: 400 });
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  if (parsed.data.action === "revoke") {
    const { error } = await auth.client
      .from("invites")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .eq("organization_id", auth.organizationId)
      .eq("status", "pending");
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ revoked: true });
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await auth.client
    .from("invites")
    .update({
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .eq("organization_id", auth.organizationId)
    .eq("status", "pending")
    .select("id,email,role,status,expires_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ invite: data, inviteUrl: inviteUrl(request, token) });
}

function inviteUrl(request: Request, token: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return `${origin.replace(/\/$/, "")}/invite?token=${encodeURIComponent(token)}`;
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
  };
}
