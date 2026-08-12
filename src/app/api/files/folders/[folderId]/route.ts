import { databaseError, requireFileAuth } from "@/lib/files/server";
import { folderMutationSchema } from "@/lib/files/validation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  if (auth.role === "viewer") {
    return Response.json({ error: "Read-only workspace access." }, { status: 403 });
  }
  const parsed = folderMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid folder action." }, { status: 400 });
  }
  const { folderId } = await params;
  const action = parsed.data;

  if (action.action === "favorite") {
    if (action.favorite) {
      const { data: folder } = await auth.client
        .from("file_folders")
        .select("name,project_id")
        .eq("id", folderId)
        .single();
      if (!folder) {
        return Response.json({ error: "Folder not found." }, { status: 404 });
      }
      const { error } = await auth.client.from("file_favorites").insert({
        profile_id: auth.userId,
        folder_id: folderId,
      });
      if (error && error.code !== "23505") return databaseError(error);
      await auth.client.from("saved_workspace_items").upsert(
        {
          organization_id: auth.organizationId,
          owner_id: auth.userId,
          project_id: folder.project_id,
          source_type: "file_folder",
          source_id: folderId,
          title: folder.name,
          href: `/files?folderId=${folderId}`,
        },
        { onConflict: "owner_id,source_type,source_id" },
      );
    } else {
      const { error } = await auth.client
        .from("file_favorites")
        .delete()
        .eq("profile_id", auth.userId)
        .eq("folder_id", folderId);
      if (error) return databaseError(error);
      await auth.client
        .from("saved_workspace_items")
        .delete()
        .eq("owner_id", auth.userId)
        .eq("source_type", "file_folder")
        .eq("source_id", folderId);
    }
    return new Response(null, { status: 204 });
  }

  let updates: Record<string, unknown>;
  if (action.action === "rename") {
    updates = { name: action.name };
  } else if (action.action === "move") {
    let projectId: string | null = null;
    let clientId: string | null = null;
    if (action.parentId) {
      const { data: parent } = await auth.client
        .from("file_folders")
        .select("project_id,client_id")
        .eq("id", action.parentId)
        .single();
      if (!parent) {
        return Response.json(
          { error: "Destination folder not found." },
          { status: 404 },
        );
      }
      projectId = parent.project_id;
      clientId = parent.client_id;
    }
    updates = {
      parent_id: action.parentId,
      project_id: projectId,
      client_id: clientId,
    };
  } else if (action.action === "trash") {
    updates = { trashed_at: new Date().toISOString(), trashed_by: auth.userId };
  } else {
    updates = { trashed_at: null, trashed_by: null };
  }
  updates.updated_by = auth.userId;

  const { data, error } = await auth.client
    .from("file_folders")
    .update(updates)
    .eq("id", folderId)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error);
  if (!data) return Response.json({ error: "Folder not found." }, { status: 404 });
  return Response.json({ id: data.id });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  if (!["admin", "manager"].includes(auth.role)) {
    return Response.json(
      { error: "Manager access is required." },
      { status: 403 },
    );
  }
  const { folderId } = await params;
  const [{ count: folderCount }, { count: fileCount }] = await Promise.all([
    auth.client
      .from("file_folders")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", folderId),
    auth.client
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("folder_id", folderId),
  ]);
  if ((folderCount ?? 0) + (fileCount ?? 0) > 0) {
    return Response.json(
      { error: "Empty the folder before permanently deleting it." },
      { status: 409 },
    );
  }
  const { error } = await auth.client
    .from("file_folders")
    .delete()
    .eq("id", folderId)
    .not("trashed_at", "is", null);
  if (error) return databaseError(error);
  return new Response(null, { status: 204 });
}
