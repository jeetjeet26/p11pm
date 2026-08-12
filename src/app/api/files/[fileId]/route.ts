import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { databaseError, requireFileAuth } from "@/lib/files/server";
import { fileMutationSchema } from "@/lib/files/validation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const { data, error } = await supabase.rpc(
    "resolve_workspace_file_download",
    {
      target_file_id: fileId,
    },
  );
  if (error) {
    console.error("Read project file failed:", error);
    return Response.json({ error: "Could not read the file." }, { status: 500 });
  }
  const target = data?.[0];
  if (!target) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { error: "File delivery is not configured." },
      { status: 503 },
    );
  }
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const { data: signed, error: signedError } = await admin.storage
    .from(target.bucket_id)
    .createSignedUrl(
      target.object_path,
      60,
      preview ? undefined : { download: target.file_name },
    );
  if (signedError) {
    console.error("Sign project file download failed:", signedError);
    return Response.json(
      { error: "Could not download the file." },
      { status: 500 },
    );
  }

  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "private, no-store",
      location: signed.signedUrl,
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  if (auth.role === "viewer") {
    return Response.json({ error: "Read-only workspace access." }, { status: 403 });
  }
  const parsed = fileMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid file action." }, { status: 400 });
  }
  const { fileId } = await params;
  const action = parsed.data;

  if (action.action === "favorite") {
    if (action.favorite) {
      const { data: file } = await auth.client
        .from("files")
        .select("file_name,project_id,folder_id")
        .eq("id", fileId)
        .single();
      if (!file) {
        return Response.json({ error: "File not found." }, { status: 404 });
      }
      const { error } = await auth.client.from("file_favorites").insert({
        profile_id: auth.userId,
        file_id: fileId,
      });
      if (error && error.code !== "23505") return databaseError(error);
      await auth.client.from("saved_workspace_items").upsert(
        {
          organization_id: auth.organizationId,
          owner_id: auth.userId,
          project_id: file.project_id,
          source_type: "file",
          source_id: fileId,
          title: file.file_name,
          href: `/files?file=${fileId}${file.folder_id ? `&folderId=${file.folder_id}` : ""}`,
        },
        { onConflict: "owner_id,source_type,source_id" },
      );
    } else {
      const { error } = await auth.client
        .from("file_favorites")
        .delete()
        .eq("profile_id", auth.userId)
        .eq("file_id", fileId);
      if (error) return databaseError(error);
      await auth.client
        .from("saved_workspace_items")
        .delete()
        .eq("owner_id", auth.userId)
        .eq("source_type", "file")
        .eq("source_id", fileId);
    }
    return new Response(null, { status: 204 });
  }

  let updates: Record<string, unknown>;
  if (action.action === "rename") {
    updates = { file_name: action.name };
  } else if (action.action === "move") {
    if (!action.folderId) {
      updates = { folder_id: null, project_id: null, client_id: null };
    } else {
      const { data: folder } = await auth.client
        .from("file_folders")
        .select("project_id,client_id")
        .eq("id", action.folderId)
        .single();
      if (!folder) {
        return Response.json(
          { error: "Destination folder not found." },
          { status: 404 },
        );
      }
      updates = {
        folder_id: action.folderId,
        project_id: folder.project_id,
        client_id: folder.client_id,
      };
    }
  } else if (action.action === "trash") {
    updates = { trashed_at: new Date().toISOString(), trashed_by: auth.userId };
  } else {
    updates = { trashed_at: null, trashed_by: null };
  }

  const { data, error } = await auth.client
    .from("files")
    .update(updates)
    .eq("id", fileId)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error);
  if (!data) return Response.json({ error: "File not found." }, { status: 404 });
  return Response.json({ id: data.id });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  const { fileId } = await params;
  const permanent = new URL(request.url).searchParams.get("permanent") === "1";
  if (!permanent) {
    const { error } = await auth.client
      .from("files")
      .update({
        trashed_at: new Date().toISOString(),
        trashed_by: auth.userId,
      })
      .eq("id", fileId);
    if (error) return databaseError(error);
    return new Response(null, { status: 204 });
  }
  if (!["admin", "manager"].includes(auth.role)) {
    return Response.json(
      { error: "Manager access is required for permanent deletion." },
      { status: 403 },
    );
  }
  const { error } = await auth.client
    .from("files")
    .delete()
    .eq("id", fileId)
    .not("trashed_at", "is", null);
  if (error) {
    console.error("Queue project file deletion failed:", error);
    return Response.json(
      { error: "Could not remove the file." },
      { status: 500 },
    );
  }

  return new Response(null, { status: 204 });
}
