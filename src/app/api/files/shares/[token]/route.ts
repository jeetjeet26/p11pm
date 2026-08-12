import {
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  enforceShareRateLimit,
  markShareAccessSuccess,
  recordShareDownloadAudit,
} from "@/lib/production/share-access";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function passwordMatches(password: string, encoded: string) {
  const [salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function resolveShare(token: string, password?: string, request?: Request) {
  const admin = createAdminClient();
  if (!admin) {
    return { error: "File delivery is not configured.", status: 503 } as const;
  }

  if (request) {
    const rateLimit = await enforceShareRateLimit(request, token);
    if (!rateLimit.allowed) {
      return {
        error: "Too many attempts. Try again later.",
        status: 429,
        rateLimited: true,
      } as const;
    }
  }

  const { data: share } = await admin
    .from("file_shares")
    .select("id,organization_id,file_id,password_hash,expires_at,revoked_at")
    .eq("token_hash", tokenHash(token))
    .maybeSingle();
  if (
    !share?.file_id ||
    share.revoked_at ||
    (share.expires_at && new Date(share.expires_at) <= new Date())
  ) {
    if (request && share?.organization_id && share.file_id) {
      await recordShareDownloadAudit({
        organizationId: share.organization_id,
        fileId: share.file_id,
        shareId: share.id,
        request,
        outcome: "denied",
      });
    }
    return { error: "This share is unavailable.", status: 404 } as const;
  }
  if (
    share.password_hash &&
    (!password || !passwordMatches(password, share.password_hash))
  ) {
    if (request) {
      await recordShareDownloadAudit({
        organizationId: share.organization_id,
        fileId: share.file_id,
        shareId: share.id,
        request,
        outcome: "denied",
        metadata: { reason: "invalid_password" },
      });
    }
    return { error: "A valid password is required.", status: 401 } as const;
  }

  const { data: scan } = await admin
    .from("file_scan_results")
    .select("scan_status")
    .eq("file_id", share.file_id)
    .maybeSingle();
  if (scan?.scan_status === "infected" || scan?.scan_status === "quarantined") {
    if (request) {
      await recordShareDownloadAudit({
        organizationId: share.organization_id,
        fileId: share.file_id,
        shareId: share.id,
        request,
        outcome: "denied",
        metadata: { reason: "quarantined", scan_status: scan.scan_status },
      });
    }
    return { error: "This file is unavailable.", status: 403 } as const;
  }

  const { data: file } = await admin
    .from("files")
    .select("bucket_id,object_path,file_name,mime_type,trashed_at")
    .eq("id", share.file_id)
    .maybeSingle();
  if (!file?.bucket_id || !file.object_path || file.trashed_at) {
    if (request) {
      await recordShareDownloadAudit({
        organizationId: share.organization_id,
        fileId: share.file_id,
        shareId: share.id,
        request,
        outcome: "denied",
      });
    }
    return { error: "This file is unavailable.", status: 404 } as const;
  }
  return { admin, file, share } as const;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const password = new URL(request.url).searchParams.get("password") ?? undefined;
  const result = await resolveShare(token, password, request);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  const { data, error } = await result.admin.storage
    .from(result.file.bucket_id)
    .createSignedUrl(result.file.object_path, 60, {
      download: result.file.file_name,
    });
  if (error) {
    return Response.json({ error: "Could not deliver the file." }, { status: 500 });
  }
  await markShareAccessSuccess(request, token);
  await recordShareDownloadAudit({
    organizationId: result.share.organization_id,
    fileId: result.share.file_id,
    shareId: result.share.id,
    request,
    outcome: "delivered",
  });
  return Response.json({
    fileName: result.file.file_name,
    mimeType: result.file.mime_type,
    url: data.signedUrl,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  const password = typeof body?.password === "string" ? body.password : undefined;
  const { token } = await context.params;
  const result = await resolveShare(token, password, request);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  const { data, error } = await result.admin.storage
    .from(result.file.bucket_id)
    .createSignedUrl(result.file.object_path, 60, {
      download: result.file.file_name,
    });
  if (error) {
    return Response.json({ error: "Could not deliver the file." }, { status: 500 });
  }
  await markShareAccessSuccess(request, token);
  await recordShareDownloadAudit({
    organizationId: result.share.organization_id,
    fileId: result.share.file_id,
    shareId: result.share.id,
    request,
    outcome: "delivered",
  });
  return Response.json({
    fileName: result.file.file_name,
    mimeType: result.file.mime_type,
    url: data.signedUrl,
  });
}
