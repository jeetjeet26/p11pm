import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  FileBreadcrumb,
  FileFolder,
  WorkspaceFile,
} from "@/lib/files/types";
import { createClient } from "@/lib/supabase/server";

export type FileAuth =
  | {
      ok: true;
      client: SupabaseClient;
      userId: string;
      organizationId: string;
      role: "admin" | "manager" | "member" | "viewer";
    }
  | { ok: false; response: Response };

export async function requireFileAuth(): Promise<FileAuth> {
  const client = await createClient();
  if (!client) {
    return {
      ok: false,
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
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: profile, error } = await client
    .from("profiles")
    .select("organization_id,role")
    .eq("id", user.id)
    .eq("status", "active")
    .single();
  if (error || !profile?.organization_id) {
    return {
      ok: false,
      response: Response.json(
        { error: "Workspace membership required." },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    client,
    userId: user.id,
    organizationId: profile.organization_id,
    role: profile.role,
  };
}

export function mapFolder(
  row: Record<string, unknown>,
  favorites: Set<string> = new Set(),
): FileFolder {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    parentId: typeof row.parent_id === "string" ? row.parent_id : null,
    projectId: typeof row.project_id === "string" ? row.project_id : null,
    clientId: typeof row.client_id === "string" ? row.client_id : null,
    name: String(row.name),
    description: typeof row.description === "string" ? row.description : null,
    color: typeof row.color === "string" ? row.color : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    trashedAt: typeof row.trashed_at === "string" ? row.trashed_at : null,
    favorite: favorites.has(String(row.id)),
  };
}

export function mapFile(
  row: Record<string, unknown>,
  favorites: Set<string> = new Set(),
): WorkspaceFile {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    folderId: typeof row.folder_id === "string" ? row.folder_id : null,
    projectId: typeof row.project_id === "string" ? row.project_id : null,
    clientId: typeof row.client_id === "string" ? row.client_id : null,
    name: String(row.file_name),
    description: typeof row.description === "string" ? row.description : null,
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    sizeBytes: Number(row.size_bytes ?? 0),
    versionCount: Number(row.version_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    trashedAt: typeof row.trashed_at === "string" ? row.trashed_at : null,
    favorite: favorites.has(String(row.id)),
  };
}

export async function getBreadcrumbs(
  client: SupabaseClient,
  folderId: string | null,
) {
  const breadcrumbs: FileBreadcrumb[] = [];
  let cursor = folderId;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor) && breadcrumbs.length < 50) {
    visited.add(cursor);
    const { data } = await client
      .from("file_folders")
      .select("id,name,parent_id")
      .eq("id", cursor)
      .maybeSingle();
    if (!data) break;
    breadcrumbs.unshift({ id: data.id, name: data.name });
    cursor = data.parent_id;
  }
  return breadcrumbs;
}

export function databaseError(error: { code?: string; message: string }) {
  if (error.code === "23505") {
    return Response.json(
      { error: "An item with that name already exists here." },
      { status: 409 },
    );
  }
  if (error.code === "42501") {
    return Response.json({ error: "Access denied." }, { status: 403 });
  }
  return Response.json({ error: error.message }, { status: 400 });
}
