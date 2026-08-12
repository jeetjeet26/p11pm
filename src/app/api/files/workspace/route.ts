import { folderCreateSchema } from "@/lib/files/validation";
import {
  databaseError,
  getBreadcrumbs,
  mapFile,
  mapFolder,
  requireFileAuth,
} from "@/lib/files/server";
import type { FileWorkspaceView } from "@/lib/files/types";

const folderColumns =
  "id,organization_id,parent_id,project_id,client_id,name,description,color,created_at,updated_at,trashed_at";
const fileColumns =
  "id,organization_id,folder_id,project_id,client_id,file_name,description,mime_type,size_bytes,version_count,created_at,updated_at,trashed_at";

export async function GET(request: Request) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId");
  const projectId = url.searchParams.get("projectId");
  const clientId = url.searchParams.get("clientId");
  const query = url.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const requestedView = url.searchParams.get("view") ?? "all";
  const view: FileWorkspaceView = [
    "recent",
    "shared",
    "favorites",
    "trash",
  ].includes(requestedView)
    ? (requestedView as FileWorkspaceView)
    : "all";

  const { data: favoriteRows } = await auth.client
    .from("file_favorites")
    .select("file_id,folder_id")
    .eq("profile_id", auth.userId);
  const favoriteFiles = new Set(
    (favoriteRows ?? []).flatMap((item) => item.file_id ? [item.file_id] : []),
  );
  const favoriteFolders = new Set(
    (favoriteRows ?? []).flatMap((item) => item.folder_id ? [item.folder_id] : []),
  );
  const { data: sharedRows } =
    view === "shared"
      ? await auth.client
          .from("file_shares")
          .select("file_id,folder_id")
          .eq("shared_with_profile_id", auth.userId)
          .is("revoked_at", null)
      : { data: [] };
  const sharedFiles = new Set(
    (sharedRows ?? []).flatMap((item) => item.file_id ? [item.file_id] : []),
  );
  const sharedFolders = new Set(
    (sharedRows ?? []).flatMap((item) => item.folder_id ? [item.folder_id] : []),
  );

  let folderQuery = auth.client
    .from("file_folders")
    .select(folderColumns)
    .eq("organization_id", auth.organizationId)
    .limit(200);
  let fileQuery = auth.client
    .from("files")
    .select(fileColumns)
    .eq("organization_id", auth.organizationId)
    .limit(200);

  if (view === "trash") {
    folderQuery = folderQuery.not("trashed_at", "is", null)
      .order("trashed_at", { ascending: false });
    fileQuery = fileQuery.not("trashed_at", "is", null)
      .order("trashed_at", { ascending: false });
  } else {
    folderQuery = folderQuery.is("trashed_at", null);
    fileQuery = fileQuery.is("trashed_at", null);
    if (view === "recent") {
      folderQuery = folderQuery.order("updated_at", { ascending: false });
      fileQuery = fileQuery.order("updated_at", { ascending: false });
    } else {
      folderQuery = folderQuery.order("name");
      fileQuery = fileQuery.order("file_name");
    }
  }

  if (folderId) {
    folderQuery = folderQuery.eq("parent_id", folderId);
    fileQuery = fileQuery.eq("folder_id", folderId);
  } else if (view === "all") {
    folderQuery = folderQuery.is("parent_id", null);
    fileQuery = fileQuery.is("folder_id", null);
  }
  if (projectId) {
    folderQuery = folderQuery.eq("project_id", projectId);
    fileQuery = fileQuery.eq("project_id", projectId);
  }
  if (clientId) {
    folderQuery = folderQuery.eq("client_id", clientId);
    fileQuery = fileQuery.eq("client_id", clientId);
  }
  if (query) {
    const escaped = query.replaceAll("%", "\\%").replaceAll("_", "\\_");
    folderQuery = folderQuery.ilike("name", `%${escaped}%`);
    fileQuery = fileQuery.ilike("file_name", `%${escaped}%`);
  }
  if (view === "favorites") {
    folderQuery = favoriteFolders.size
      ? folderQuery.in("id", [...favoriteFolders])
      : folderQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
    fileQuery = favoriteFiles.size
      ? fileQuery.in("id", [...favoriteFiles])
      : fileQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
  } else if (view === "shared") {
    folderQuery = sharedFolders.size
      ? folderQuery.in("id", [...sharedFolders])
      : folderQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
    fileQuery = sharedFiles.size
      ? fileQuery.in("id", [...sharedFiles])
      : fileQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
  }

  const [{ data: folders, error: folderError }, { data: files, error: fileError }] =
    await Promise.all([folderQuery, fileQuery]);
  if (folderError) return databaseError(folderError);
  if (fileError) return databaseError(fileError);

  const currentFolder = folderId
    ? (folders ?? []).find((item) => item.id === folderId) ??
      (
        await auth.client
          .from("file_folders")
          .select(folderColumns)
          .eq("id", folderId)
          .maybeSingle()
      ).data
    : null;

  return Response.json({
    folders: (folders ?? []).map((row) =>
      mapFolder(row as Record<string, unknown>, favoriteFolders),
    ),
    files: (files ?? []).map((row) =>
      mapFile(row as Record<string, unknown>, favoriteFiles),
    ),
    breadcrumbs: await getBreadcrumbs(auth.client, folderId),
    currentFolder: currentFolder
      ? mapFolder(currentFolder as Record<string, unknown>, favoriteFolders)
      : null,
    view,
    nextCursor: null,
  });
}

export async function POST(request: Request) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  if (auth.role === "viewer") {
    return Response.json({ error: "Read-only workspace access." }, { status: 403 });
  }
  const parsed = folderCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid folder." },
      { status: 400 },
    );
  }

  let projectId = parsed.data.projectId ?? null;
  let clientId = parsed.data.clientId ?? null;
  if (parsed.data.parentId) {
    const { data: parent } = await auth.client
      .from("file_folders")
      .select("project_id,client_id")
      .eq("id", parsed.data.parentId)
      .single();
    if (!parent) {
      return Response.json({ error: "Parent folder not found." }, { status: 404 });
    }
    projectId = parent.project_id;
    clientId = parent.client_id;
  }

  const { data, error } = await auth.client
    .from("file_folders")
    .insert({
      organization_id: auth.organizationId,
      parent_id: parsed.data.parentId ?? null,
      project_id: projectId,
      client_id: clientId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? null,
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select(folderColumns)
    .single();
  if (error) return databaseError(error);
  return Response.json({ folder: mapFolder(data) }, { status: 201 });
}
