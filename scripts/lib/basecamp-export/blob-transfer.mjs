import path from "node:path";

import { lookup as mimeLookup } from "mime-types";
import pLimit from "p-limit";

import { contentObjectPath, stableUuid } from "./identity.mjs";
import { uploadStoredEntry } from "./tus-upload.mjs";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function responseStatus(error) {
  return error?.originalResponse?.getStatus?.() ?? null;
}

function mimeType(entry) {
  return mimeLookup(path.posix.extname(entry.originalName ?? entry.fileName)) || "application/octet-stream";
}

function progressWriter(repository, blobId) {
  let lastBytes = 0;
  let lastAt = 0;
  let chain = Promise.resolve();
  return {
    write(progress, force = false) {
      const now = Date.now();
      if (
        !force &&
        progress.bytesUploaded - lastBytes < 6 * 1024 * 1024 &&
        now - lastAt < 5_000
      ) {
        return;
      }
      lastBytes = progress.bytesUploaded;
      lastAt = now;
      chain = chain.then(() =>
        repository.updateBlobProgress(blobId, {
          uploadUrl: progress.uploadUrl,
          uploadOffset: progress.bytesUploaded,
        }),
      );
    },
    async settle() {
      await chain;
    },
  };
}

export async function transferArchiveEntries({
  archive,
  entries,
  entryIdForPath,
  repository,
  runId,
  organizationId,
  supabaseUrl,
  serviceRoleKey,
  bucketName = "project-files",
  concurrency = 2,
  resume = true,
  signal,
  onEntryComplete,
}) {
  const limit = pLimit(concurrency);
  const inFlightBlobs = new Map();
  const totals = {
    entries: entries.length,
    processedEntries: 0,
    uploadedBlobs: 0,
    reusedBlobs: 0,
    skippedEntries: 0,
    bytesHashed: 0,
    bytesUploaded: 0,
  };

  const processBlob = async (entry, digest) => {
    const key = `${digest.sha256}:${entry.sizeBytes}`;
    const existingPromise = inFlightBlobs.get(key);
    if (existingPromise) {
      totals.reusedBlobs += 1;
      return existingPromise;
    }

    const work = (async () => {
      const objectPath = contentObjectPath(organizationId, digest.sha256);
      const blobId = stableUuid(
        "basecamp-file-blob",
        organizationId,
        digest.sha256,
        entry.sizeBytes,
      );
      const claimed = await repository.claimBlob({
        id: blobId,
        organizationId,
        runId,
        bucketId: bucketName,
        objectPath,
        sha256: digest.sha256,
        crc32: digest.crc32,
        sizeBytes: entry.sizeBytes,
        mimeType: mimeType(entry),
      });
      if (claimed.status === "ready") {
        totals.reusedBlobs += 1;
        return { id: claimed.id ?? blobId, uploaded: false };
      }

      const activeBlobId = claimed.id ?? blobId;
      const writer = progressWriter(repository, activeBlobId);
      try {
        let currentUploadUrl = resume ? claimed.upload_url ?? null : null;
        const upload = (uploadUrl) =>
          uploadStoredEntry({
            archive,
            entry,
            supabaseUrl,
            serviceRoleKey,
            bucketName,
            objectName: objectPath,
            contentType: mimeType(entry),
            uploadUrl,
            signal,
            onUploadUrl(nextUploadUrl) {
              currentUploadUrl = nextUploadUrl;
              writer.write(
                {
                  bytesUploaded: uploadUrl ? claimed.upload_offset ?? 0 : 0,
                  uploadUrl: nextUploadUrl,
                },
                true,
              );
            },
            onProgress(progress) {
              writer.write(progress);
            },
          });
        let result;
        for (let attempt = 0; ; attempt += 1) {
          try {
            result = await upload(currentUploadUrl);
            break;
          } catch (error) {
            const status = responseStatus(error);
            if (status === 404 || status === 410) {
              if (currentUploadUrl) {
                await repository.resetBlobUpload(activeBlobId);
                currentUploadUrl = null;
              }
              if (attempt < 5) {
                await new Promise((resolve) =>
                  setTimeout(resolve, 1_000 * 2 ** attempt),
                );
                continue;
              }
            }
            if (status === 409) {
              if (
                await repository.verifyBlobObject?.({
                  bucketId: bucketName,
                  objectPath,
                  sizeBytes: entry.sizeBytes,
                })
              ) {
                result = { uploadUrl: currentUploadUrl };
                break;
              }
              if (currentUploadUrl && attempt < 5) {
                await new Promise((resolve) =>
                  setTimeout(resolve, 1_000 * 2 ** attempt),
                );
                continue;
              }
            }
            if (
              attempt < 5 &&
              (status === 429 || (status !== null && status >= 500))
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, 1_000 * 2 ** attempt),
              );
              continue;
            }
            throw error;
          }
        }
        writer.write(
          {
            bytesUploaded: entry.sizeBytes,
            uploadUrl: result.uploadUrl,
          },
          true,
        );
        await writer.settle();
        await repository.markBlobReady(activeBlobId, {
          uploadUrl: result.uploadUrl,
          uploadOffset: entry.sizeBytes,
        });
        totals.uploadedBlobs += 1;
        totals.bytesUploaded += entry.sizeBytes;
        return { id: activeBlobId, uploaded: true };
      } catch (error) {
        await writer.settle();
        await repository.markBlobFailed(activeBlobId, errorMessage(error));
        throw error;
      }
    })();

    inFlightBlobs.set(key, work);
    try {
      return await work;
    } finally {
      inFlightBlobs.delete(key);
    }
  };

  await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        if (signal?.aborted) throw signal.reason ?? new Error("Import aborted.");
        const entryId = entryIdForPath(entry.fileName);
        const checkpoint = resume
          ? await repository.getEntryBlobCheckpoint(entryId)
          : null;
        if (checkpoint?.status === "ready") {
          totals.processedEntries += 1;
          totals.skippedEntries += 1;
          await onEntryComplete?.({
            entry,
            status: "skipped",
            totals: { ...totals },
          });
          return;
        }

        const digest = await archive.verifyAndHash(entry);
        totals.bytesHashed += digest.bytesRead;
        const blob = await processBlob(entry, digest);
        await repository.linkEntryBlob(entryId, blob.id, {
          sha256: digest.sha256,
          crc32: digest.crc32,
        });
        totals.processedEntries += 1;
        await onEntryComplete?.({
          entry,
          status: blob.uploaded ? "uploaded" : "deduplicated",
          totals: { ...totals },
        });
      }),
    ),
  );

  return totals;
}
