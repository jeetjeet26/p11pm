import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { databaseError, requireFileAuth } from "@/lib/files/server";
import { MAX_UPLOAD_SIZE } from "@/lib/uploads/contracts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  const { fileId } = await params;
  const [{ data: file }, { data, error }] = await Promise.all([
    auth.client
      .from("files")
      .select("current_version_id")
      .eq("id", fileId)
      .single(),
    auth.client
      .from("file_versions")
      .select(
        "id,file_id,version_number,file_name,mime_type,size_bytes,created_by,created_at",
      )
      .eq("file_id", fileId)
      .order("version_number", { ascending: false }),
  ]);
  if (error) return databaseError(error);
  return Response.json({
    versions: (data ?? []).map((version) => ({
      id: version.id,
      fileId: version.file_id,
      versionNumber: version.version_number,
      fileName: version.file_name,
      mimeType: version.mime_type,
      sizeBytes: version.size_bytes,
      createdBy: version.created_by,
      createdAt: version.created_at,
      current: version.id === file?.current_version_id,
    })),
  });
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
  const { fileId } = await params;
  const { data: current } = await auth.client
    .from("files")
    .select("id,organization_id,version_count,file_name,blob_id")
    .eq("id", fileId)
    .single();
  if (!current) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }
  const form = await request.formData();
  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size < 1 || upload.size > MAX_UPLOAD_SIZE) {
    return Response.json(
      { error: "Choose a file up to 25 MB." },
      { status: 400 },
    );
  }
  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { error: "File storage is not configured." },
      { status: 503 },
    );
  }
  const safeName =
    upload.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-180) || "file";
  const objectPath = `workspace/${current.organization_id}/${auth.userId}/${randomUUID()}-${safeName}`;
  const { error: storageError } = await admin.storage
    .from("project-files")
    .upload(objectPath, upload, {
      contentType: upload.type || "application/octet-stream",
      upsert: false,
    });
  if (storageError) {
    return Response.json({ error: storageError.message }, { status: 400 });
  }

  const versionNumber = Number(current.version_count ?? 0) + 1;
  const { data: version, error } = await auth.client
    .from("file_versions")
    .insert({
      file_id: fileId,
      version_number: versionNumber,
      bucket_id: "project-files",
      object_path: objectPath,
      file_name: upload.name,
      mime_type: upload.type || null,
      size_bytes: upload.size,
      created_by: auth.userId,
    })
    .select("id,version_number")
    .single();
  if (error || !version) {
    await admin.storage.from("project-files").remove([objectPath]);
    return databaseError(error ?? { message: "Could not save the version." });
  }
  const { error: updateError } = await auth.client
    .from("files")
    .update({
      current_version_id: version.id,
      version_count: version.version_number,
      bucket_id: "project-files",
      object_path: objectPath,
      file_name: upload.name,
      mime_type: upload.type || null,
      size_bytes: upload.size,
      blob_id: null,
    })
    .eq("id", fileId);
  if (updateError) return databaseError(updateError);
  return Response.json({ version }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    versionId?: unknown;
  } | null;
  if (typeof body?.versionId !== "string") {
    return Response.json({ error: "Version is required." }, { status: 400 });
  }
  const { fileId } = await params;
  const { data: version } = await auth.client
    .from("file_versions")
    .select("id,bucket_id,object_path,file_name,mime_type,size_bytes,blob_id")
    .eq("id", body.versionId)
    .eq("file_id", fileId)
    .single();
  if (!version) {
    return Response.json({ error: "Version not found." }, { status: 404 });
  }
  const { error } = await auth.client
    .from("files")
    .update({
      current_version_id: version.id,
      bucket_id: version.bucket_id,
      object_path: version.object_path,
      file_name: version.file_name,
      mime_type: version.mime_type,
      size_bytes: version.size_bytes,
      blob_id: version.blob_id,
    })
    .eq("id", fileId);
  if (error) return databaseError(error);
  return Response.json({ currentVersionId: version.id });
}
