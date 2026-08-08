"use client";

import {
  completeResumableUpload,
  fetchUploadJson,
} from "@/lib/uploads/client";
import {
  type ResumableUploadOptions,
  type UploadResource,
  type UploadSession,
  uploadCacheKey,
} from "@/lib/uploads/contracts";

export interface ProjectFileUpload extends UploadResource {
  projectId: string;
  title: string;
  kind: "file";
  authorId?: string;
  size: string;
  sizeBytes: number;
  updatedAt: string;
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  options?: ResumableUploadOptions,
) {
  const statusUrl = (reservationId: string) =>
    `/api/files/uploads/${reservationId}`;

  return completeResumableUpload<ProjectFileUpload>({
    cacheTarget: uploadCacheKey(`project:${projectId}`, file),
    file,
    statusUrl,
    options,
    initiate: () =>
      fetchUploadJson<UploadSession<ProjectFileUpload>>("/api/files", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        }),
      }),
    finalize: (reservationId) =>
      fetchUploadJson<UploadSession<ProjectFileUpload>>("/api/files", {
        method: "PUT",
        body: JSON.stringify({ reservationId }),
      }),
  });
}
