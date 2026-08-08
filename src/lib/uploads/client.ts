"use client";

import { Upload } from "tus-js-client";

import {
  TUS_CHUNK_SIZE,
  UPLOAD_RETRY_DELAYS,
  type ResumableUploadOptions,
  type SignedTusUpload,
  type UploadReservation,
  type UploadResource,
  type UploadSession,
} from "@/lib/uploads/contracts";

type ResumableFlow<TResource extends UploadResource> = {
  cacheTarget: string;
  file: File;
  initiate: () => Promise<UploadSession<TResource>>;
  statusUrl: (reservationId: string) => string;
  finalize: (
    reservationId: string,
  ) => Promise<UploadSession<TResource>>;
  options?: ResumableUploadOptions;
};

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

async function responseJson<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error ?? "The upload request failed.");
  }
  return result;
}

export async function fetchUploadJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  return responseJson<T>(
    await fetch(input, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    }),
  );
}

async function uploadDirectly(
  file: File,
  uploadConfig: SignedTusUpload,
  progressUrl: string,
  options?: ResumableUploadOptions,
) {
  let lastReportedAt = 0;
  let lastReportedBytes = 0;

  function reportProgress(bytesUploaded: number, bytesTotal: number) {
    options?.onProgress?.({
      bytesUploaded,
      bytesTotal,
      percentage:
        bytesTotal > 0
          ? Math.round((bytesUploaded / bytesTotal) * 10_000) / 100
          : 0,
    });

    const now = Date.now();
    const shouldReport =
      bytesUploaded === bytesTotal ||
      now - lastReportedAt >= 1_000 ||
      bytesUploaded - lastReportedBytes >= TUS_CHUNK_SIZE;
    if (!shouldReport) return;

    lastReportedAt = now;
    lastReportedBytes = bytesUploaded;
    void fetch(progressUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytesUploaded }),
    }).catch(() => undefined);
  }

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: uploadConfig.endpoint,
      retryDelays: UPLOAD_RETRY_DELAYS,
      headers: {
        "x-signature": uploadConfig.token,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: uploadConfig.bucketName,
        objectName: uploadConfig.objectName,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: uploadConfig.chunkSize,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError: reject,
      onProgress: reportProgress,
      onSuccess: () => resolve(),
    });

    void upload
      .findPreviousUploads()
      .then(
        (
          previousUploads: Awaited<
            ReturnType<typeof upload.findPreviousUploads>
          >,
        ) => {
          if (previousUploads[0]) {
            upload.resumeFromPreviousUpload(previousUploads[0]);
          }
          upload.start();
        },
      )
      .catch(reject);
  });
}

export async function completeResumableUpload<
  TResource extends UploadResource,
>({
  cacheTarget,
  file,
  initiate,
  statusUrl,
  finalize,
  options,
}: ResumableFlow<TResource>): Promise<TResource> {
  const storage = browserStorage();
  const cachedReservationId = storage?.getItem(cacheTarget);
  let session: UploadSession<TResource> | undefined;

  if (cachedReservationId) {
    try {
      session = await fetchUploadJson<UploadSession<TResource>>(
        statusUrl(cachedReservationId),
      );
      if (session.reservation.status === "failed") {
        storage?.removeItem(cacheTarget);
        session = undefined;
      }
    } catch {
      storage?.removeItem(cacheTarget);
    }
  }

  session ??= await initiate();
  storage?.setItem(cacheTarget, session.reservation.id);

  if (
    session.reservation.status === "finalized" &&
    session.reservation.resource
  ) {
    storage?.removeItem(cacheTarget);
    return session.reservation.resource;
  }
  if (!session.upload) {
    throw new Error(
      session.reservation.failureReason ?? "The upload cannot be resumed.",
    );
  }

  const reservationId = session.reservation.id;
  await uploadDirectly(
    file,
    session.upload,
    statusUrl(reservationId),
    options,
  );
  const finalized = await finalize(reservationId);
  const resource = finalized.reservation.resource;
  if (!resource) {
    throw new Error("The uploaded file metadata was not finalized.");
  }

  storage?.removeItem(cacheTarget);
  return resource;
}

export type { UploadReservation };
