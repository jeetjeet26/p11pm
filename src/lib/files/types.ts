export type FileWorkspaceView =
  | "all"
  | "recent"
  | "shared"
  | "favorites"
  | "trash";

export interface FileFolder {
  id: string;
  organizationId: string;
  parentId: string | null;
  projectId: string | null;
  clientId: string | null;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  favorite: boolean;
}

export interface WorkspaceFile {
  id: string;
  organizationId: string;
  folderId: string | null;
  projectId: string | null;
  clientId: string | null;
  name: string;
  description: string | null;
  mimeType: string | null;
  sizeBytes: number;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  favorite: boolean;
}

export interface FileBreadcrumb {
  id: string;
  name: string;
}

export interface FileWorkspacePayload {
  folders: FileFolder[];
  files: WorkspaceFile[];
  breadcrumbs: FileBreadcrumb[];
  currentFolder: FileFolder | null;
  view: FileWorkspaceView;
  nextCursor: string | null;
}

export interface FileComment {
  id: string;
  fileId: string;
  parentId: string | null;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersion {
  id: string;
  fileId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdBy: string | null;
  createdAt: string;
  current: boolean;
}

export interface FileShare {
  id: string;
  fileId: string | null;
  folderId: string | null;
  profileId: string | null;
  guestEmail: string | null;
  permission: "view" | "comment" | "edit";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function previewKind(mimeType: string | null) {
  if (!mimeType) return "download" as const;
  if (mimeType === "image/svg+xml") return "svg" as const;
  if (mimeType.startsWith("image/")) {
    return "image" as const;
  }
  if (mimeType === "application/pdf") return "pdf" as const;
  if (mimeType.startsWith("video/")) return "video" as const;
  if (mimeType.startsWith("audio/")) return "audio" as const;
  if (
    mimeType.startsWith("text/") &&
    !["text/html", "text/xml", "text/javascript", "text/css"].includes(mimeType)
  ) {
    return "text" as const;
  }
  return "download" as const;
}
