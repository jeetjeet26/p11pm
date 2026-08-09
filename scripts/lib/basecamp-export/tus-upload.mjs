import { Upload } from "tus-js-client";

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const TUS_RETRY_DELAYS = [0, 3_000, 5_000, 10_000, 20_000, 30_000];

export function directStorageTusEndpoint(supabaseUrl) {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectRef = url.hostname.slice(0, -".supabase.co".length);
    if (projectRef) {
      return `${url.protocol}//${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
    }
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

function shouldRetry(error) {
  const status = error?.originalResponse?.getStatus?.();
  if (status == null || status === 408 || status === 429) return true;
  return status >= 500 && status < 600;
}

export async function uploadStoredEntry({
  archive,
  entry,
  supabaseUrl,
  serviceRoleKey,
  bucketName,
  objectName,
  contentType = "application/octet-stream",
  uploadUrl = null,
  signal,
  onProgress,
  onUploadUrl,
}) {
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for archive uploads.");
  }
  if (signal?.aborted) throw signal.reason ?? new Error("Upload aborted.");

  const stream = await archive.createReadStream(entry);
  return new Promise((resolve, reject) => {
    const upload = new Upload(stream, {
      endpoint: directStorageTusEndpoint(supabaseUrl),
      uploadUrl,
      uploadSize: entry.sizeBytes,
      chunkSize: TUS_CHUNK_SIZE,
      retryDelays: TUS_RETRY_DELAYS,
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: false,
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        "x-upsert": "false",
      },
      metadata: {
        bucketName,
        objectName,
        contentType,
        cacheControl: "31536000",
      },
      onUploadUrlAvailable() {
        onUploadUrl?.(upload.url);
      },
      onProgress(bytesUploaded, bytesTotal) {
        onProgress?.({
          bytesUploaded,
          bytesTotal,
          percentage:
            bytesTotal === 0 ? 100 : Math.round((bytesUploaded / bytesTotal) * 10_000) / 100,
          uploadUrl: upload.url,
        });
      },
      onShouldRetry: shouldRetry,
      onSuccess() {
        cleanup();
        resolve({ uploadUrl: upload.url, sizeBytes: entry.sizeBytes });
      },
      onError(error) {
        cleanup();
        reject(error);
      },
    });

    const abort = () => {
      upload
        .abort(false)
        .catch(() => undefined)
        .finally(() => {
          cleanup();
          reject(signal.reason ?? new Error("Upload aborted."));
        });
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
    upload.start();
  });
}
