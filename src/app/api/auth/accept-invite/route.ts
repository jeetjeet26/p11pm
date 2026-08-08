import { createHash } from "node:crypto";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const inviteSchema = z.object({
  token: z.string().min(20),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  fullName: z.string().trim().min(2).max(100),
});

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { error: "Invite acceptance needs SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  const parsed = inviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid invite details." },
      { status: 400 },
    );
  }

  const tokenHash = createHash("sha256")
    .update(parsed.data.token)
    .digest("hex");
  const { data: invite, error: inviteError } = await admin
    .from("invites")
    .select("id,email,expires_at")
    .eq("token_hash", tokenHash)
    .eq("status", "pending")
    .is("accepted_at", null)
    .maybeSingle();

  if (
    inviteError ||
    !invite ||
    new Date(invite.expires_at).getTime() <= Date.now() ||
    invite.email.toLowerCase() !== parsed.data.email
  ) {
    return Response.json(
      { error: "This invite is invalid or expired." },
      { status: 400 },
    );
  }

  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,email")
    .eq("email", parsed.data.email)
    .maybeSingle<{ id: string; email: string }>();
  if (profileError) {
    console.error("Invite profile lookup failed:", profileError);
    return Response.json(
      { error: "Could not prepare this invitation." },
      { status: 500 },
    );
  }

  let existingUser = null;
  if (existingProfile) {
    const {
      data: { user },
    } = await admin.auth.admin.getUserById(existingProfile.id);
    existingUser = user;
  }

  if (existingUser) {
    if (existingUser.email?.toLowerCase() !== parsed.data.email) {
      return Response.json(
        { error: "This invite cannot be matched to an account." },
        { status: 409 },
      );
    }
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        app_metadata: { workspace_invite_id: invite.id },
        email: parsed.data.email,
        id: existingProfile?.id,
        user_metadata: { full_name: parsed.data.fullName },
      });
    if (createError || !created.user) {
      console.error("Passwordless invite account creation failed:", createError);
      return Response.json(
        {
          error:
            "Could not prepare passwordless sign-in. Ask an administrator to verify this account.",
        },
        { status: 409 },
      );
    }
  }

  return Response.json({ ok: true });
}
