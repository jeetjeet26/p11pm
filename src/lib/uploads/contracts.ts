export const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const UPLOAD_RETRY_DELAYS = [0, 3_000, 5_000, 10_000, 20_000];

export type UploadTargetKind = "project_file" | "chat_attachment";
export type UploadReservationStatus = "pending" | "finalized" | "failed";

export interface UploadResource {
  id: string;
  [key: string]: unknown;
}

export interface UploadReservation<TResource extends UploadResource = UploadResource> {
  id: string;
  targetKind: UploadTargetKind;
  bucketName: "project-files" | "workspace-chat-files";
  objectName: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  progressBytes: number;
  status: UploadReservationStatus;
  failureReason?: string;
  expiresAt: string;
  resource?: TResource;
  finalizeError?: string;
}

export interface SignedTusUpload {
  endpoint: string;
  token: string;
  bucketName: UploadReservation["bucketName"];
  objectName: string;
  chunkSize: typeof TUS_CHUNK_SIZE;
  expiresInSeconds: number;
}

export interface UploadSession<TResource extends UploadResource = UploadResource> {
  reservation: UploadReservation<TResource>;
  upload?: SignedTusUpload;
}

export interface UploadProgress {
  bytesUploaded: number;
  bytesTotal: number;
  percentage: number;
}

export interface ResumableUploadOptions {
  onProgress?: (progress: UploadProgress) => void;
}

export function getDirectStorageEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectRef = url.hostname.slice(
      0,
      -".supabase.co".length,
    );
    if (projectRef) {
      return `${url.protocol}//${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
    }
  }

  return `${url.origin}/storage/v1/upload/resumable`;
}

export function uploadCacheKey(
  target: string,
  file: Pick<File, "name" | "size" | "type" | "lastModified">,
) {
  return [
    "p11-upload",
    target,
    file.name,
    file.size,
    file.type,
    file.lastModified,
  ].join(":");
}
