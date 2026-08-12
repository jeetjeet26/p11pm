import { createHash, randomBytes, scryptSync } from "node:crypto";

import { databaseError, requireFileAuth } from "@/lib/files/server";
import { shareCreateSchema } from "@/lib/files/validation";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${digest}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  const { fileId } = await params;
  const { data, error } = await auth.client
    .from("file_shares")
    .select(
      "id,file_id,folder_id,shared_with_profile_id,guest_email,permission,expires_at,revoked_at,created_at",
    )
    .eq("file_id", fileId)
    .order("created_at", { ascending: false });
  if (error) return databaseError(error);
  return Response.json({ shares: data ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  if (auth.role === "viewer") {
    return Response.json({ error: "Read-only workspace access." }, { status: 403 });
  }
  const parsed = shareCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid share." },
      { status: 400 },
    );
  }
  const { fileId } = await params;
  const { data: file } = await auth.client
    .from("files")
    .select("organization_id")
    .eq("id", fileId)
    .single();
  if (!file) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }

  const external = Boolean(parsed.data.guestEmail);
  const rawToken = external ? randomBytes(32).toString("base64url") : null;
  const { data, error } = await auth.client
    .from("file_shares")
    .insert({
      organization_id: file.organization_id,
      file_id: fileId,
      shared_with_profile_id: parsed.data.profileId ?? null,
      guest_email: parsed.data.guestEmail ?? null,
      token_hash: rawToken ? hashToken(rawToken) : null,
      permission: parsed.data.permission,
      password_hash: parsed.data.password
        ? hashPassword(parsed.data.password)
        : null,
      expires_at: parsed.data.expiresAt ?? null,
      created_by: auth.userId,
    })
    .select(
      "id,file_id,folder_id,shared_with_profile_id,guest_email,permission,expires_at,created_at",
    )
    .single();
  if (error) return databaseError(error);
  return Response.json(
    {
      share: data,
      shareUrl: rawToken ? `/share/files/${rawToken}` : null,
    },
    { status: 201 },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  const shareId = new URL(request.url).searchParams.get("shareId");
  if (!shareId) {
    return Response.json({ error: "Share is required." }, { status: 400 });
  }
  const { fileId } = await params;
  const { error } = await auth.client
    .from("file_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId)
    .eq("file_id", fileId);
  if (error) return databaseError(error);
  return new Response(null, { status: 204 });
}
