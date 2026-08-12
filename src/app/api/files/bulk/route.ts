import { databaseError, requireFileAuth } from "@/lib/files/server";
import { bulkMutationSchema } from "@/lib/files/validation";

export async function POST(request: Request) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  if (auth.role === "viewer") {
    return Response.json({ error: "Read-only workspace access." }, { status: 403 });
  }
  const parsed = bulkMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid bulk action." }, { status: 400 });
  }
  const { action, fileIds, folderIds } = parsed.data;
  if (!fileIds.length && !folderIds.length) {
    return Response.json({ error: "Select at least one item." }, { status: 400 });
  }

  let fileUpdates: Record<string, unknown>;
  let folderUpdates: Record<string, unknown>;
  if (action === "trash") {
    const now = new Date().toISOString();
    fileUpdates = { trashed_at: now, trashed_by: auth.userId };
    folderUpdates = {
      trashed_at: now,
      trashed_by: auth.userId,
      updated_by: auth.userId,
    };
  } else if (action === "restore") {
    fileUpdates = { trashed_at: null, trashed_by: null };
    folderUpdates = {
      trashed_at: null,
      trashed_by: null,
      updated_by: auth.userId,
    };
  } else {
    const destinationId = parsed.data.destinationFolderId ?? null;
    let projectId: string | null = null;
    let clientId: string | null = null;
    if (destinationId) {
      const { data: destination } = await auth.client
        .from("file_folders")
        .select("project_id,client_id")
        .eq("id", destinationId)
        .single();
      if (!destination) {
        return Response.json(
          { error: "Destination folder not found." },
          { status: 404 },
        );
      }
      projectId = destination.project_id;
      clientId = destination.client_id;
    }
    fileUpdates = {
      folder_id: destinationId,
      project_id: projectId,
      client_id: clientId,
    };
    folderUpdates = {
      parent_id: destinationId,
      project_id: projectId,
      client_id: clientId,
      updated_by: auth.userId,
    };
  }

  const operations = [];
  if (fileIds.length) {
    operations.push(
      auth.client.from("files").update(fileUpdates).in("id", fileIds),
    );
  }
  if (folderIds.length) {
    operations.push(
      auth.client.from("file_folders").update(folderUpdates).in("id", folderIds),
    );
  }
  const results = await Promise.all(operations);
  const error = results.find((result) => result.error)?.error;
  if (error) return databaseError(error);
  return Response.json({
    updatedFiles: fileIds.length,
    updatedFolders: folderIds.length,
  });
}
