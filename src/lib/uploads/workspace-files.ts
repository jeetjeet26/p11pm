"use client";

import {
  completeResumableUpload,
  fetchUploadJson,
} from "@/lib/uploads/client";
import type { WorkspaceFile } from "@/lib/files/types";
import {
  type ResumableUploadOptions,
  type UploadResource,
  type UploadSession,
  uploadCacheKey,
} from "@/lib/uploads/contracts";

type UploadedWorkspaceFile = UploadResource & {
  folderId: string;
  title: string;
  kind: "file";
  authorId?: string;
  sizeBytes: number;
  updatedAt: string;
};

export async function uploadWorkspaceFile(
  folderId: string,
  file: File,
  options?: ResumableUploadOptions,
) {
  const endpoint = "/api/files/workspace/upload";
  const result = await completeResumableUpload<UploadedWorkspaceFile>({
    cacheTarget: uploadCacheKey(`folder:${folderId}`, file),
    file,
    statusUrl: (reservationId) =>
      `/api/files/uploads/${reservationId}?target=workspace_file`,
    options,
    initiate: () =>
      fetchUploadJson<UploadSession<UploadedWorkspaceFile>>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          folderId,
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        }),
      }),
    finalize: (reservationId) =>
      fetchUploadJson<UploadSession<UploadedWorkspaceFile>>(endpoint, {
        method: "PUT",
        body: JSON.stringify({ reservationId }),
      }),
  });
  return result;
}

export function asWorkspaceFile(
  file: UploadedWorkspaceFile,
  organizationId: string,
): WorkspaceFile {
  return {
    id: file.id,
    organizationId,
    folderId: file.folderId,
    projectId: null,
    clientId: null,
    name: file.title,
    description: null,
    mimeType: null,
    sizeBytes: file.sizeBytes,
    versionCount: 1,
    createdAt: file.updatedAt,
    updatedAt: file.updatedAt,
    trashedAt: null,
    favorite: false,
  };
}
