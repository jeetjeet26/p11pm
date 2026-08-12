#!/usr/bin/env node

import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { config as loadDotenv } from "dotenv";
import { lookup as mimeLookup } from "mime-types";

import { BasecampExportRepository } from "./lib/basecamp-export/repository.mjs";
import { stableUuid } from "./lib/basecamp-export/identity.mjs";
import { uploadStoredEntry } from "./lib/basecamp-export/tus-upload.mjs";

const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";
const DESTINATION_PROJECT_REF = "dojycqqnvmnjatdkiswz";
const DEFAULT_ORGANIZATION_ID = "d4a4ac90-8935-4aa8-b12c-f6b36f47ef05";
const DEFAULT_UPLOADER_ID = "f1aeb75d-9c42-4df3-8f00-d38796c7fbe4";
const BUCKET = "project-files";
const DROPBOX_DOWNLOAD_CHUNK_SIZE = 64 * 1024 * 1024;
const PHASES = new Set(["inventory", "import", "verify", "all"]);
const READ_ONLY_DROPBOX_ENDPOINTS = new Set([
  "team/members/list_v2",
  "team/members/list/continue_v2",
  "users/get_current_account",
  "files/list_folder",
  "files/list_folder/continue",
]);

for (const environmentPath of [
  ".env.dropbox.local",
  ".env.production.local",
  ".env.local",
  ".env",
]) {
  if (existsSync(environmentPath)) {
    loadDotenv({ path: environmentPath, override: false, quiet: true });
  }
}

function valueArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function options() {
  const phase = valueArgument("phase") ?? "inventory";
  if (!PHASES.has(phase)) throw new Error(`Unknown phase ${JSON.stringify(phase)}.`);
  return {
    phase,
    allowProduction: process.argv.includes("--allow-production"),
    limit: positiveInteger(valueArgument("limit"), null),
    concurrency: Math.min(15, positiveInteger(valueArgument("concurrency"), 2)),
    maxFileBytes:
      positiveInteger(valueArgument("max-file-gb"), null) == null
        ? null
        : positiveInteger(valueArgument("max-file-gb"), null) *
          1024 *
          1024 *
          1024,
    organizationId:
      valueArgument("organization-id") ??
      process.env.DROPBOX_ORGANIZATION_ID ??
      DEFAULT_ORGANIZATION_ID,
    uploaderId:
      valueArgument("uploader-id") ??
      process.env.DROPBOX_UPLOADER_ID ??
      DEFAULT_UPLOADER_ID,
    memberEmail:
      valueArgument("member-email") ??
      process.env.DROPBOX_MEMBER_EMAIL ??
      "jesse@p11.com",
    inventoryDirectory:
      valueArgument("inventory-dir") ??
      process.env.DROPBOX_INVENTORY_DIRECTORY ??
      null,
    sourcePath: valueArgument("path") ?? null,
  };
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") return JSON.stringify(error);
  return String(error);
}

async function refreshDropboxAccessToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN?.trim();
  const appKey = process.env.DROPBOX_APP_KEY?.trim();
  if (!refreshToken || !appKey) {
    return process.env.DROPBOX_ACCESS_TOKEN?.trim() ?? "";
  }
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: appKey,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "Dropbox refresh failed.");
  }
  process.env.DROPBOX_ACCESS_TOKEN = payload.access_token;
  process.env.DROPBOX_TOKEN_EXPIRES_AT = String(
    Date.now() + Number(payload.expires_in) * 1_000,
  );
  return payload.access_token;
}

async function dropboxFetch(url, init, label) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      const body = await response.text();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`${label} failed (${response.status}): ${body.slice(0, 500)}`);
      }
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      lastError = new Error(`${label} failed (${response.status}).`);
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.max(retryAfter * 1_000, (attempt + 1) * 1_000)),
      );
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, (attempt + 1) * 1_000),
        );
      }
    }
  }
  throw lastError ?? new Error(`${label} failed.`);
}

function dropboxHeaders(token, pathRoot, selectUser, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...(selectUser ? { "Dropbox-API-Select-User": selectUser } : {}),
    ...(pathRoot
      ? {
          "Dropbox-API-Path-Root": JSON.stringify({
            ".tag": "root",
            root: pathRoot,
          }),
        }
      : {}),
    ...extra,
  };
}

async function dropboxRpc(
  token,
  endpoint,
  body,
  { pathRoot = null, selectUser = null } = {},
) {
  if (!READ_ONLY_DROPBOX_ENDPOINTS.has(endpoint)) {
    throw new Error(`Blocked non-read Dropbox endpoint: ${endpoint}`);
  }
  const response = await dropboxFetch(
    `${DROPBOX_API}/${endpoint}`,
    {
      method: "POST",
      headers: dropboxHeaders(token, pathRoot, selectUser, {
        "content-type": "application/json",
      }),
      body: body == null ? "null" : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    },
    `Dropbox ${endpoint}`,
  );
  return response.json();
}

async function selectTeamMember(token, email) {
  let page = await dropboxRpc(token, "team/members/list_v2", { limit: 1_000 });
  const members = [...page.members];
  while (page.has_more) {
    page = await dropboxRpc(token, "team/members/list/continue_v2", {
      cursor: page.cursor,
    });
    members.push(...page.members);
  }
  const normalizedEmail = email.trim().toLowerCase();
  const member = members.find(
    (candidate) =>
      candidate.profile?.email?.trim().toLowerCase() === normalizedEmail,
  );
  if (!member) {
    throw new Error(`Dropbox team member ${JSON.stringify(email)} was not found.`);
  }
  return member.profile.team_member_id;
}

async function inventoryDropbox(token, memberEmail) {
  const selectedUser = await selectTeamMember(token, memberEmail);
  const account = await dropboxRpc(token, "users/get_current_account", null, {
    selectUser: selectedUser,
  });
  const pathRoot = account.root_info?.root_namespace_id ?? null;
  let page = await dropboxRpc(
    token,
    "files/list_folder",
    {
      path: "",
      recursive: true,
      include_deleted: false,
      include_non_downloadable_files: true,
      limit: 2_000,
    },
    { pathRoot, selectUser: selectedUser },
  );
  const entries = [...page.entries];
  console.log(`Dropbox inventory: ${entries.length} entries received.`);
  while (page.has_more) {
    page = await dropboxRpc(
      token,
      "files/list_folder/continue",
      { cursor: page.cursor },
      { pathRoot, selectUser: selectedUser },
    );
    entries.push(...page.entries);
    console.log(`Dropbox inventory: ${entries.length} entries received.`);
  }

  const folders = entries.filter((entry) => entry[".tag"] === "folder");
  const files = entries.filter((entry) => entry[".tag"] === "file");
  const unsupported = entries.filter(
    (entry) => !["folder", "file"].includes(entry[".tag"]),
  );
  const largestFile = files.reduce(
    (largest, file) =>
      Number(file.size ?? 0) > Number(largest?.size ?? -1) ? file : largest,
    null,
  );
  return {
    account: {
      accountId: account.account_id,
      displayName: account.name?.display_name ?? account.email ?? "Dropbox",
      email: account.email ?? null,
      rootNamespaceId: pathRoot,
      teamMemberId: selectedUser,
    },
    entries,
    summary: {
      folders: folders.length,
      files: files.length,
      downloadableFiles: files.filter((file) => file.is_downloadable !== false).length,
      nonDownloadableFiles: files.filter((file) => file.is_downloadable === false).length,
      unsupportedEntries: unsupported.length,
      bytes: files.reduce((total, file) => total + Number(file.size ?? 0), 0),
      largestFileBytes: Number(largestFile?.size ?? 0),
      largestFilePath: largestFile?.path_display ?? null,
      filesOverCurrentBucketLimit: files.filter(
        (file) => Number(file.size ?? 0) > 4 * 1024 * 1024 * 1024,
      ).length,
    },
  };
}

async function writeInventoryState(inventory, directory) {
  await mkdir(directory, { recursive: true });
  const metadataPath = join(directory, "inventory.json");
  const entriesPath = join(directory, "entries.ndjson");
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      { account: inventory.account, summary: inventory.summary },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const output = createWriteStream(entriesPath, {
    encoding: "utf8",
    flags: "w",
    mode: 0o600,
  });
  try {
    for (const entry of inventory.entries) {
      if (!output.write(`${JSON.stringify(entry)}\n`)) {
        await once(output, "drain");
      }
    }
    await new Promise((resolveFinish, rejectFinish) => {
      output.end(resolveFinish);
      output.once("error", rejectFinish);
    });
  } catch (error) {
    output.destroy();
    throw error;
  }
  return { metadataPath, entriesPath };
}

async function readInventoryState(directory) {
  const metadataPath = join(directory, "inventory.json");
  const entriesPath = join(directory, "entries.ndjson");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const entries = [];
  const lines = createInterface({
    input: createReadStream(entriesPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line) entries.push(JSON.parse(line));
  }
  return { ...metadata, entries };
}

function depth(entry) {
  return (entry.path_lower ?? "").split("/").filter(Boolean).length;
}

function parentPath(entry) {
  const path = entry.path_lower ?? "";
  const parent = dirname(path);
  return parent === "/" || parent === "." ? "" : parent;
}

function safeName(name, fallback) {
  const normalized = String(name ?? "").trim().replaceAll("\0", "");
  return (normalized || fallback).slice(0, 255);
}

async function hashDownload({ token, pathRoot, entry, temporaryPath }) {
  const hash = createHash("sha256");
  let bytes = 0;
  const expectedSize = Number(entry.size);
  await mkdir(dirname(temporaryPath), { recursive: true });
  const output = createWriteStream(temporaryPath, { flags: "wx" });
  try {
    for (let offset = 0; offset < expectedSize; offset += DROPBOX_DOWNLOAD_CHUNK_SIZE) {
      const end = Math.min(expectedSize - 1, offset + DROPBOX_DOWNLOAD_CHUNK_SIZE - 1);
      const expectedChunkSize = end - offset + 1;
      const chunkPath = `${temporaryPath}.${offset}.chunk`;
      let chunkReady = false;
      let lastError;
      for (let attempt = 1; attempt <= 6 && !chunkReady; attempt += 1) {
        await rm(chunkPath, { force: true });
        try {
          const response = await dropboxFetch(
            `${DROPBOX_CONTENT}/files/download`,
            {
              method: "POST",
              headers: dropboxHeaders(
                process.env.DROPBOX_ACCESS_TOKEN?.trim() ?? token,
                pathRoot,
                entry.teamMemberId,
                {
                  "Dropbox-API-Arg": JSON.stringify({
                    path: entry.rev
                      ? `rev:${entry.rev}`
                      : entry.id ?? entry.path_lower,
                  }),
                  range: `bytes=${offset}-${end}`,
                },
              ),
            },
            `Dropbox download ${entry.path_display ?? entry.name}`,
          );
          if (!response.body) {
            throw new Error(`Dropbox returned no body for ${entry.name}.`);
          }
          const chunkOutput = createWriteStream(chunkPath, { flags: "wx" });
          await pipeline(Readable.fromWeb(response.body), chunkOutput);
          const chunkBytes = (await stat(chunkPath)).size;
          if (chunkBytes !== expectedChunkSize) {
            throw new Error(
              `Dropbox range ${offset}-${end} returned ${chunkBytes} bytes; expected ${expectedChunkSize}.`,
            );
          }
          chunkReady = true;
        } catch (error) {
          lastError = error;
          await rm(chunkPath, { force: true });
          if (attempt < 6) {
            await new Promise((resolveDelay) =>
              setTimeout(resolveDelay, attempt * 2_000),
            );
          }
        }
      }
      if (!chunkReady) throw lastError ?? new Error(`Could not download ${entry.name}.`);
      for await (const chunk of createReadStream(chunkPath)) {
        bytes += chunk.length;
        hash.update(chunk);
        if (!output.write(chunk)) await once(output, "drain");
      }
      await rm(chunkPath, { force: true });
    }
    await new Promise((resolveFinish, rejectFinish) => {
      output.end(resolveFinish);
      output.once("error", rejectFinish);
    });
  } catch (error) {
    output.destroy();
    throw error;
  }
  if (bytes !== expectedSize) {
    throw new Error(`Downloaded ${bytes} bytes for ${entry.name}; expected ${expectedSize}.`);
  }
  return { sha256: hash.digest("hex"), sizeBytes: bytes };
}

function storageObjectPath(organizationId, sha256) {
  return `dropbox-blobs/${organizationId}/${sha256.slice(0, 2)}/${sha256}`;
}

async function uploadTemporaryFile({
  repository,
  temporaryPath,
  entry,
  digest,
  organizationId,
  supabaseUrl,
  serviceRoleKey,
}) {
  const objectPath = storageObjectPath(organizationId, digest.sha256);
  const blobId = stableUuid(
    "dropbox-file-blob",
    organizationId,
    digest.sha256,
    digest.sizeBytes,
  );
  const mimeType = mimeLookup(extname(entry.name)) || "application/octet-stream";
  const claimed = await repository.claimBlob({
    id: blobId,
    organizationId,
    bucketId: BUCKET,
    objectPath,
    sha256: digest.sha256,
    crc32: null,
    sizeBytes: digest.sizeBytes,
    mimeType,
  });
  if (claimed.status === "ready") {
    return { blobId: claimed.id ?? blobId, objectPath, mimeType, reused: true };
  }

  const activeBlobId = claimed.id ?? blobId;
  try {
    if (digest.sizeBytes === 0) {
      await repository.uploadEmptyBlob({
        bucketId: BUCKET,
        objectPath,
        mimeType,
      });
      await repository.markBlobReady(activeBlobId, {
        uploadUrl: null,
        uploadOffset: 0,
      });
    } else {
      const archive = {
        createReadStream: async () => createReadStream(temporaryPath),
      };
      let currentUploadUrl = claimed.upload_url ?? null;
      let upload;
      for (let attempt = 0; ; attempt += 1) {
        try {
          upload = await uploadStoredEntry({
            archive,
            entry: { ...entry, sizeBytes: digest.sizeBytes },
            supabaseUrl,
            serviceRoleKey,
            bucketName: BUCKET,
            objectName: objectPath,
            contentType: mimeType,
            uploadUrl: currentUploadUrl,
            onUploadUrl(nextUploadUrl) {
              currentUploadUrl = nextUploadUrl;
            },
          });
          break;
        } catch (error) {
          const status = error?.originalResponse?.getStatus?.() ?? null;
          if ((status === 404 || status === 410) && currentUploadUrl) {
            await repository.resetBlobUpload(activeBlobId);
            currentUploadUrl = null;
          } else if (
            status !== 409 &&
            status !== 429 &&
            !(status !== null && status >= 500) &&
            !/fetch failed|terminated|timeout|socket|econnreset/i.test(
              errorMessage(error),
            )
          ) {
            throw error;
          }
          if (attempt >= 5) throw error;
          await new Promise((resolveDelay) =>
            setTimeout(resolveDelay, Math.min(30_000, 1_000 * 2 ** attempt)),
          );
        }
      }
      await repository.markBlobReady(activeBlobId, {
        uploadUrl: upload.uploadUrl,
        uploadOffset: digest.sizeBytes,
      });
    }
  } catch (error) {
    await repository.markBlobFailed(activeBlobId, errorMessage(error));
    throw error;
  }
  return { blobId: activeBlobId, objectPath, mimeType, reused: false };
}

async function ensureFolder(client, row) {
  const { error } = await client.from("file_folders").upsert(row, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`Could not import folder ${row.name}: ${error.message}`);
}

async function upsertFolderBatch(client, batch) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const { error } = await client.from("file_folders").upsert(batch, {
      onConflict: "id",
      ignoreDuplicates: true,
    });
    if (!error) return;
    lastError = error;
    if (
      error.code ||
      !/fetch failed|timeout|socket|econnreset/i.test(error.message ?? "")
    ) {
      break;
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, Math.min(30_000, attempt * 2_000)),
    );
  }
  throw new Error(`Could not import folder batch: ${lastError?.message ?? lastError}`);
}

async function findExistingGroupBlob(client, organizationId, accountId, entry) {
  if (!entry.content_hash) return null;
  const { data, error } = await client
    .from("files")
    .select(
      "blob_id,object_path,mime_type,size_bytes,checksum_sha256,availability_status",
    )
    .eq("organization_id", organizationId)
    .eq("source_system", "dropbox")
    .eq("source_account_id", accountId)
    .eq("size_bytes", Number(entry.size ?? 0))
    .eq("availability_status", "available")
    .eq("source_payload->>content_hash", entry.content_hash)
    .not("blob_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.blob_id || !data.checksum_sha256) return null;
  return {
    blob: {
      blobId: data.blob_id,
      objectPath: data.object_path,
      mimeType: data.mime_type ?? "application/octet-stream",
      reused: true,
    },
    digest: {
      sha256: data.checksum_sha256,
      sizeBytes: Number(data.size_bytes),
    },
  };
}

async function importLogicalFile({
  client,
  entry,
  account,
  organizationId,
  uploaderId,
  folderId,
  blob,
  digest,
}) {
  const fileId = stableUuid("dropbox-file", organizationId, account.accountId, entry.id);
  const { data: current, error: currentError } = await client
    .from("files")
    .select("id,version_count,source_payload,availability_status")
    .eq("id", fileId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (
    current?.availability_status === "available" &&
    current.source_payload?.rev === entry.rev
  ) {
    return { skipped: true, fileId };
  }

  const versionNumber = current ? Number(current.version_count ?? 0) + 1 : 1;
  const versionId = stableUuid("dropbox-file-version", fileId, entry.rev);
  const versionPath = `dropbox-versions/${organizationId}/${fileId}/${entry.rev}`;
  const importedAt = new Date().toISOString();
  const sourcePayload = {
    id: entry.id,
    rev: entry.rev,
    content_hash: entry.content_hash ?? null,
    path_display: entry.path_display,
    path_lower: entry.path_lower,
    sharing_info: entry.sharing_info ?? null,
  };
  const fileRow = {
    id: fileId,
    organization_id: organizationId,
    project_id: null,
    client_id: null,
    folder_id: folderId,
    uploaded_by: uploaderId,
    blob_id: blob.blobId,
    bucket_id: BUCKET,
    object_path: blob.objectPath,
    file_name: safeName(entry.name, basename(entry.path_display ?? entry.id)),
    mime_type: blob.mimeType,
    size_bytes: digest.sizeBytes,
    checksum_sha256: digest.sha256,
    metadata: { dropbox: sourcePayload },
    source_system: "dropbox",
    source_account_id: account.accountId,
    source_file_id: entry.id,
    source_path: entry.path_display ?? entry.path_lower,
    source_created_at: entry.client_modified ?? null,
    source_updated_at: entry.server_modified ?? null,
    source_checksum_sha256: digest.sha256,
    source_payload: sourcePayload,
    availability_status: "available",
    imported_at: importedAt,
    version_count: current ? current.version_count : 0,
    updated_at: entry.server_modified ?? importedAt,
  };
  const { error: fileError } = await client.from("files").upsert(fileRow, {
    onConflict: "id",
  });
  if (fileError) throw new Error(`Could not import ${entry.name}: ${fileError.message}`);

  const { error: versionError } = await client.from("file_versions").upsert(
    {
      id: versionId,
      file_id: fileId,
      blob_id: blob.blobId,
      version_number: versionNumber,
      bucket_id: BUCKET,
      object_path: versionPath,
      file_name: fileRow.file_name,
      mime_type: blob.mimeType,
      size_bytes: digest.sizeBytes,
      checksum_sha256: digest.sha256,
      created_by: uploaderId,
      metadata: { dropbox: sourcePayload },
      created_at: entry.server_modified ?? importedAt,
    },
    { onConflict: "id" },
  );
  if (versionError) {
    throw new Error(`Could not create a version for ${entry.name}: ${versionError.message}`);
  }
  const { error: finalizeError } = await client
    .from("files")
    .update({
      current_version_id: versionId,
      version_count: versionNumber,
    })
    .eq("id", fileId);
  if (finalizeError) throw finalizeError;
  return { skipped: false, fileId };
}

async function importInventory(inventory, runOptions) {
  if (!runOptions.allowProduction) {
    throw new Error("Import requires --allow-production after reviewing inventory.");
  }
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl.includes(DESTINATION_PROJECT_REF) || !serviceRoleKey) {
    throw new Error(
      `The importer requires service-role credentials for ${DESTINATION_PROJECT_REF}.`,
    );
  }

  const repository = new BasecampExportRepository({ supabaseUrl, serviceRoleKey });
  const client = repository.client;
  const rootId = stableUuid(
    "dropbox-import-root",
    runOptions.organizationId,
    inventory.account.accountId,
  );
  await ensureFolder(client, {
    id: rootId,
    organization_id: runOptions.organizationId,
    parent_id: null,
    project_id: null,
    client_id: null,
    name: safeName(`Dropbox · ${inventory.account.displayName}`, "Dropbox Import"),
    description: `Read-only transfer from Dropbox account ${inventory.account.email ?? inventory.account.accountId}.`,
    created_by: runOptions.uploaderId,
    updated_by: runOptions.uploaderId,
  });

  const downloadableFiles = inventory.entries.filter(
    (entry) =>
      entry[".tag"] === "file" &&
      entry.is_downloadable !== false &&
      (!runOptions.sourcePath ||
        entry.path_display === runOptions.sourcePath ||
        entry.path_lower === runOptions.sourcePath.toLowerCase()),
  );
  const deferredFiles = runOptions.maxFileBytes
    ? downloadableFiles.filter(
        (entry) => Number(entry.size ?? 0) > runOptions.maxFileBytes,
      )
    : [];
  let files = runOptions.maxFileBytes
    ? downloadableFiles.filter(
        (entry) => Number(entry.size ?? 0) <= runOptions.maxFileBytes,
      )
    : downloadableFiles;
  if (runOptions.limit) files = files.slice(0, runOptions.limit);
  const groupsByContent = new Map();
  for (const entry of files) {
    const key = `${entry.content_hash ?? entry.id}:${Number(entry.size ?? 0)}`;
    const group = groupsByContent.get(key);
    if (group) group.push(entry);
    else groupsByContent.set(key, [entry]);
  }
  const fileGroups = [...groupsByContent.values()].sort(
    (left, right) => Number(right[0]?.size ?? 0) - Number(left[0]?.size ?? 0),
  );
  console.log(
    JSON.stringify({
      selectedFiles: files.length,
      uniquePayloads: fileGroups.length,
      deduplicatedTransfers: files.length - fileGroups.length,
      deferredFiles: deferredFiles.length,
      deferredBytes: deferredFiles.reduce(
        (total, entry) => total + Number(entry.size ?? 0),
        0,
      ),
      maxFileBytes: runOptions.maxFileBytes,
    }),
  );
  const includedFolderPaths =
    runOptions.limit || runOptions.sourcePath ? new Set([""]) : null;
  if (includedFolderPaths) {
    for (const file of files) {
      let path = parentPath(file);
      while (path) {
        includedFolderPaths.add(path);
        const parent = dirname(path);
        path = parent === "/" || parent === "." ? "" : parent;
      }
    }
  }
  const folders = inventory.entries
    .filter((entry) => entry[".tag"] === "folder")
    .filter((entry) => !includedFolderPaths || includedFolderPaths.has(entry.path_lower))
    .sort((left, right) => depth(left) - depth(right));
  const folderIds = new Map([["", rootId]]);
  const folderRows = [];
  for (const folder of folders) {
    const id = stableUuid(
      "dropbox-folder",
      runOptions.organizationId,
      inventory.account.accountId,
      folder.id,
    );
    folderRows.push({
      id,
      organization_id: runOptions.organizationId,
      parent_id: folderIds.get(parentPath(folder)) ?? rootId,
      project_id: null,
      client_id: null,
      name: safeName(folder.name, folder.id),
      description: "Imported from Dropbox.",
      created_by: runOptions.uploaderId,
      updated_by: runOptions.uploaderId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    folderIds.set(folder.path_lower, id);
  }
  for (let index = 0; index < folderRows.length; index += 250) {
    const batch = folderRows.slice(index, index + 250);
    await upsertFolderBatch(client, batch);
    console.log(
      `Dropbox folders: ${Math.min(index + batch.length, folderRows.length)}/${folderRows.length}`,
    );
  }
  const temporaryRoot = resolve("data/dropbox-transfer/tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const totals = {
    imported: 0,
    skipped: 0,
    failed: 0,
    deferred: deferredFiles.length,
    deferredBytes: deferredFiles.reduce(
      (total, entry) => total + Number(entry.size ?? 0),
      0,
    ),
    uploadedBytes: 0,
    failures: [],
  };
  let nextIndex = 0;
  let fatalError = null;

  const worker = async () => {
    for (;;) {
      if (fatalError) return;
      const index = nextIndex;
      nextIndex += 1;
      const group = fileGroups[index];
      if (!group) return;
      const entry = group[0];
      const temporaryPath = join(
        temporaryRoot,
        `${stableUuid("dropbox-temp", inventory.account.accountId, entry.id, entry.rev)}.part`,
      );
      let attempt = 0;
      retryGroup: for (;;) {
        try {
        let physical = await findExistingGroupBlob(
          client,
          runOptions.organizationId,
          inventory.account.accountId,
          entry,
        );
        if (!physical) {
          await rm(temporaryPath, { force: true });
          const digest = await hashDownload({
            token: process.env.DROPBOX_ACCESS_TOKEN,
            pathRoot: inventory.account.rootNamespaceId,
            entry: { ...entry, teamMemberId: inventory.account.teamMemberId },
            temporaryPath,
          });
          const blob = await uploadTemporaryFile({
            repository,
            temporaryPath,
            entry,
            digest,
            organizationId: runOptions.organizationId,
            supabaseUrl,
            serviceRoleKey,
          });
          physical = { blob, digest };
          if (!blob.reused) totals.uploadedBytes += digest.sizeBytes;
        }
        for (const logicalEntry of group) {
          const result = await importLogicalFile({
            client,
            entry: logicalEntry,
            account: inventory.account,
            organizationId: runOptions.organizationId,
            uploaderId: runOptions.uploaderId,
            folderId: folderIds.get(parentPath(logicalEntry)) ?? rootId,
            blob: physical.blob,
            digest: physical.digest,
          });
          if (result.skipped) totals.skipped += 1;
          else totals.imported += 1;
        }
        console.log(
          `[${index + 1}/${fileGroups.length}] transferred ${group.length} logical file(s) for ${entry.path_display}`,
        );
          break retryGroup;
        } catch (error) {
          const message = errorMessage(error);
          if (
            /Dropbox .+ failed \(401\)/.test(message) ||
            message.includes("expired_access_token")
          ) {
            fatalError = error;
            throw error;
          }
          attempt += 1;
          if (
            attempt < 4 &&
            /fetch failed|terminated|timeout|socket|econnreset|429|5\d\d/i.test(
              message,
            )
          ) {
            console.error(
              `[${index + 1}/${fileGroups.length}] retry ${attempt}/3 for ${entry.path_display}: ${message}`,
            );
            await new Promise((resolveDelay) =>
              setTimeout(resolveDelay, attempt * 5_000),
            );
            continue retryGroup;
          }
          totals.failed += 1;
          totals.failures.push({
            path: entry.path_display ?? entry.path_lower,
            logicalFiles: group.length,
            error: message,
          });
          console.error(
            `[${index + 1}/${fileGroups.length}] failed ${entry.path_display}: ${message}`,
          );
          break retryGroup;
        } finally {
          await rm(temporaryPath, { force: true });
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: runOptions.concurrency }, () => worker()),
  );
  await rm(temporaryRoot, { recursive: true, force: true });
  return totals;
}

async function verifyInventory(inventory, runOptions) {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const repository = new BasecampExportRepository({ supabaseUrl, serviceRoleKey });
  const expectedFiles = inventory.entries.filter(
    (entry) => entry[".tag"] === "file" && entry.is_downloadable !== false,
  );
  const expectedFolders = inventory.entries.filter(
    (entry) => entry[".tag"] === "folder",
  );
  const fileIds = expectedFiles.map((entry) =>
    stableUuid(
      "dropbox-file",
      runOptions.organizationId,
      inventory.account.accountId,
      entry.id,
    ),
  );
  const folderIds = expectedFolders.map((entry) =>
    stableUuid(
      "dropbox-folder",
      runOptions.organizationId,
      inventory.account.accountId,
      entry.id,
    ),
  );
  const countIds = async (table, ids) => {
    let count = 0;
    for (let index = 0; index < ids.length; index += 500) {
      const { count: batchCount, error } = await repository.client
        .from(table)
        .select("id", { count: "exact", head: true })
        .in("id", ids.slice(index, index + 500));
      if (error) throw error;
      count += batchCount ?? 0;
    }
    return count;
  };
  const [files, folders] = await Promise.all([
    countIds("files", fileIds),
    countIds("file_folders", folderIds),
  ]);
  return {
    expectedFiles: fileIds.length,
    importedFiles: files,
    expectedFolders: folderIds.length,
    importedFolders: folders,
    complete: files === fileIds.length && folders === folderIds.length,
  };
}

async function main() {
  const runOptions = options();
  const token = await refreshDropboxAccessToken();
  if (!token) throw new Error("Set DROPBOX_ACCESS_TOKEN in .env.dropbox.local.");
  if (process.env.DROPBOX_REFRESH_TOKEN) {
    setInterval(() => {
      void refreshDropboxAccessToken().catch((error) => {
        console.error(`Dropbox token refresh failed: ${errorMessage(error)}`);
      });
    }, 3 * 60 * 60 * 1_000).unref();
  }
  let inventory;
  if (runOptions.phase !== "inventory" && runOptions.inventoryDirectory) {
    inventory = await readInventoryState(resolve(runOptions.inventoryDirectory));
    console.log(
      JSON.stringify(
        { account: inventory.account, summary: inventory.summary, reusedInventory: true },
        null,
        2,
      ),
    );
  } else {
    inventory = await inventoryDropbox(token, runOptions.memberEmail);
    const stateDirectory = resolve(
      `data/dropbox-transfer/${inventory.account.accountId}`,
    );
    const state = await writeInventoryState(inventory, stateDirectory);
    console.log(
      JSON.stringify({ account: inventory.account, summary: inventory.summary }, null, 2),
    );
    console.log(`Inventory written to ${state.metadataPath} and ${state.entriesPath}.`);
  }

  if (runOptions.phase === "inventory") return;
  if (runOptions.phase === "import" || runOptions.phase === "all") {
    const result = await importInventory(inventory, runOptions);
    const reportPath = resolve(
      `data/dropbox-transfer/report-${inventory.account.accountId}.json`,
    );
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    });
    console.log(JSON.stringify({ import: result, reportPath }, null, 2));
    if (result.failed > 0) process.exitCode = 1;
  }
  if (runOptions.phase === "verify" || runOptions.phase === "all") {
    const verification = await verifyInventory(inventory, runOptions);
    console.log(JSON.stringify({ verification }, null, 2));
    if (!verification.complete) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
