import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import pLimit from "p-limit";

function canonicalKey(entityType, sourceProjectId, sourceId) {
  return `${entityType}:${sourceProjectId}:${sourceId}`;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    return JSON.stringify(error);
  }
  return String(error);
}

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function isTransientFetchError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "" &&
    (message.includes("fetch failed") ||
      message.includes("abort") ||
      message.includes("timeout"))
  );
}

function fetchWithTimeout(input, init = {}) {
  const timeoutSignal = AbortSignal.timeout(60_000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}

function boundedBatches(rows, maximumRows = 250, maximumBytes = 4 * 1024 * 1024) {
  const batches = [];
  let batch = [];
  let bytes = 2;
  for (const row of rows) {
    const rowBytes = jsonSize(row) + 1;
    if (batch.length && (batch.length >= maximumRows || bytes + rowBytes > maximumBytes)) {
      batches.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(row);
    bytes += rowBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export class BasecampExportRepository {
  constructor({ supabaseUrl, serviceRoleKey }) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    });
    this.blobs = new Map();
    this.existingImportKeys = new Map();
    this.uploadLeaseToken = randomUUID();
  }

  async initializeRun({
    id,
    organizationId,
    accountId,
    archiveName,
    archiveSizeBytes,
    manifestSha256,
    parserVersion,
    exportedAt,
    entryCount,
    bytesTotal,
    manifest,
  }) {
    const run = {
      id,
      organization_id: organizationId,
      account_id: Number(accountId),
      archive_name: archiveName,
      archive_size_bytes: archiveSizeBytes,
      manifest_sha256: manifestSha256,
      parser_version: parserVersion,
      exported_at: exportedAt,
      status: "staging",
      phase: "metadata",
      entry_count_expected: entryCount,
      bytes_total: bytesTotal,
      manifest,
      inventory_completed_at: new Date().toISOString(),
    };
    const { error: insertError } = await this.client
      .from("basecamp_export_runs")
      .insert(run);
    if (insertError && insertError.code !== "23505") throw insertError;
    const { data, error } = await this.client
      .from("basecamp_export_runs")
      .select("id,status")
      .eq("organization_id", organizationId)
      .eq("account_id", Number(accountId))
      .eq("manifest_sha256", manifestSha256)
      .single();
    if (error) throw error;
    if (data.id !== id) {
      throw new Error(
        `Manifest already belongs to run ${data.id}; resume that run instead.`,
      );
    }
    if (data.status === "completed") return data;
    const { error: updateError } = await this.client
      .from("basecamp_export_runs")
      .update({
        archive_name: archiveName,
        archive_size_bytes: archiveSizeBytes,
        parser_version: parserVersion,
        exported_at: exportedAt,
        phase: "metadata",
        entry_count_expected: entryCount,
        bytes_total: bytesTotal,
        manifest,
      })
      .eq("id", id);
    if (updateError) throw updateError;
    return data;
  }

  async selectAll(table, columns, configure = (query) => query) {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const query = configure(
        this.client.from(table).select(columns).range(from, from + pageSize - 1),
      );
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < pageSize) return rows;
    }
  }

  async loadIdentity({ organizationId, accountId, people }) {
    const [profileRows, projectRows] = await Promise.all([
      this.selectAll(
        "profiles",
        "id,email,basecamp_account_id,basecamp_person_id,role,status",
        (query) => query.eq("organization_id", organizationId),
      ),
      this.selectAll(
        "projects",
        "id,basecamp_account_id,basecamp_project_id",
        (query) =>
          query
            .eq("organization_id", organizationId)
            .eq("basecamp_account_id", Number(accountId)),
      ),
    ]);
    const profilesByPerson = new Map(
      profileRows
        .filter(
          (row) =>
            row.basecamp_person_id !== null &&
            Number(row.basecamp_account_id) === Number(accountId),
        )
        .map((row) => [String(row.basecamp_person_id), row]),
    );
    const profilesByEmail = new Map(
      profileRows.map((row) => [String(row.email).toLowerCase(), row]),
    );
    const profileIds = new Map();
    const existingProfileIds = new Set();
    for (const person of people.values()) {
      const email = String(person.email ?? "").toLowerCase();
      const existing =
        profilesByPerson.get(String(person.id)) ||
        (email ? profilesByEmail.get(email) : null);
      if (existing) {
        profileIds.set(String(person.id), existing.id);
        existingProfileIds.add(existing.id);
      }
    }
    const projectIds = new Map(
      projectRows
        .filter((row) => row.basecamp_project_id !== null)
        .map((row) => [String(row.basecamp_project_id), row.id]),
    );
    const existingProjects = new Set(projectIds.keys());
    const projectSourceById = new Map(
      [...projectIds.entries()].map(([sourceId, id]) => [id, sourceId]),
    );
    const canonicalIds = new Map();
    const existingCanonical = new Set();
    const specifications = [
      ["todo_lists", "basecamp_todolist_id"],
      ["todos", "basecamp_todo_id"],
      ["docs", "basecamp_document_id"],
      ["messages", "basecamp_message_id"],
      ["comments", "basecamp_comment_id"],
      ["files", "source_file_id"],
    ];
    await Promise.all(
      specifications.map(async ([entityType, sourceColumn]) => {
        const rows = await this.selectAll(
          entityType,
          `id,project_id,${sourceColumn}`,
          (query) => query.not(sourceColumn, "is", null),
        );
        for (const row of rows) {
          const sourceProjectId = projectSourceById.get(row.project_id);
          if (!sourceProjectId) continue;
          const sourceId = String(row[sourceColumn]);
          const key = canonicalKey(entityType, sourceProjectId, sourceId);
          canonicalIds.set(key, row.id);
          existingCanonical.add(key);
        }
      }),
    );
    return {
      canonicalIds,
      existingCanonical,
      existingProfileIds,
      existingProjects,
      profileIds,
      projectIds,
    };
  }

  async reconcileProfiles(rows, identity) {
    const existing = [];
    const additions = [];
    for (const row of rows) {
      if (identity.existingProfileIds.has(row.id)) existing.push(row);
      else additions.push(row);
    }
    for (const batch of boundedBatches(additions, 100)) {
      const { error } = await this.client.from("profiles").upsert(batch, {
        onConflict: "id",
      });
      if (error) throw error;
    }
    const limit = pLimit(8);
    await Promise.all(
      existing.map((row) =>
        limit(async () => {
          const { error } = await this.client
            .from("profiles")
            .update({
              basecamp_account_id: row.basecamp_account_id,
              basecamp_person_id: row.basecamp_person_id,
              person_type: row.person_type,
              source_payload: row.source_payload,
            })
            .eq("id", row.id)
            .eq("organization_id", row.organization_id);
          if (error) throw error;
        }),
      ),
    );
  }

  async upsertRows(table, rows, onConflict, maximumRows = 250) {
    for (const batch of boundedBatches(rows, maximumRows)) {
      for (let attempt = 0; ; attempt += 1) {
        const { error } = await this.client.from(table).upsert(batch, {
          onConflict,
        });
        if (!error) break;
        if (!isTransientFetchError(error) || attempt >= 4) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 1_000 * 2 ** attempt),
        );
      }
    }
  }

  async writeBatch(kind, rows, identity) {
    if (!rows.length) return;
    if (kind === "profile") {
      await this.reconcileProfiles(rows, identity);
      return;
    }
    const target = {
      archive_record: ["basecamp_archive_records", "id"],
      archive_record_entry: ["basecamp_archive_record_entries", "id"],
      project_status: [
        "basecamp_export_project_status",
        "run_id,project_id",
      ],
      stage: [
        "basecamp_export_stage",
        "run_id,project_id,entity_type,source_key",
      ],
    }[kind];
    if (!target) throw new Error(`Unsupported repository batch: ${kind}`);
    let pendingRows = rows;
    if (["archive_record", "archive_record_entry", "stage"].includes(kind)) {
      const cacheKey =
        kind === "archive_record_entry" ? kind : `${kind}:${rows[0]?.run_id}`;
      let existing = this.existingImportKeys.get(cacheKey);
      if (!existing) {
        let persisted;
        if (kind === "archive_record") {
          persisted = await this.selectAll(
            "basecamp_archive_records",
            "id",
            (query) => query.eq("run_id", rows[0].run_id),
          );
        } else if (kind === "archive_record_entry") {
          persisted = await this.selectAll(
            "basecamp_archive_record_entries",
            "id",
          );
        } else {
          persisted = await this.selectAll(
            "basecamp_export_stage",
            "run_id,project_id,entity_type,source_key",
            (query) => query.eq("run_id", rows[0].run_id),
          );
        }
        existing = new Set(
          persisted.map((row) =>
            kind === "stage"
              ? `${row.project_id}:${row.entity_type}:${row.source_key}`
              : row.id,
          ),
        );
        this.existingImportKeys.set(cacheKey, existing);
      }
      const keyFor = (row) =>
        kind === "stage"
          ? `${row.project_id}:${row.entity_type}:${row.source_key}`
          : row.id;
      pendingRows = rows.filter((row) => !existing.has(keyFor(row)));
      if (kind === "archive_record") {
        const batchIds = new Set(pendingRows.map((row) => row.id));
        pendingRows = pendingRows.map((row) =>
          row.parent_id &&
          !existing.has(row.parent_id) &&
          !batchIds.has(row.parent_id)
            ? {
                ...row,
                parent_id: null,
                metadata: {
                  ...row.metadata,
                  unresolved_parent_record_id: row.parent_id,
                },
              }
            : row,
        );
      }
      await this.upsertRows(target[0], pendingRows, target[1]);
      for (const row of pendingRows) existing.add(keyFor(row));
      return;
    }
    await this.upsertRows(target[0], pendingRows, target[1]);
  }

  async writeArchiveEntries(rows) {
    const runId = rows[0]?.run_id;
    if (!runId) return;
    const existingPaths = new Set();
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.client
        .from("basecamp_archive_entries")
        .select("source_path")
        .eq("run_id", runId)
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      for (const row of data ?? []) existingPaths.add(row.source_path);
      if ((data?.length ?? 0) < pageSize) break;
    }
    const missingRows = rows.filter((row) => !existingPaths.has(row.source_path));
    await this.upsertRows(
      "basecamp_archive_entries",
      missingRows,
      "run_id,source_path",
      100,
    );
  }

  async completeMetadata(runId, report) {
    const { error } = await this.client
      .from("basecamp_export_runs")
      .update({
        status: "ready",
        phase: "ready",
        entry_count_processed: report.entryCount,
        record_count_expected: report.recordCount,
        record_count_processed: report.recordCount,
        blob_count_expected: report.entryCount,
        warning_count: report.warnings.length,
        warnings: report.warnings,
        progress: {
          metadata_counts: report.counts,
          unresolved_references: report.warnings,
        },
      })
      .eq("id", runId);
    if (error) throw error;
  }

  async promoteProject(runId, projectId) {
    const { data, error } = await this.client.rpc(
      "promote_basecamp_export_project_extended",
      {
        run_id: runId,
        project_id: projectId,
      },
    );
    if (error) throw error;
    return data;
  }

  async markProjectFailed(runId, projectId, error) {
    const message = errorMessage(error);
    const { error: updateError } = await this.client
      .from("basecamp_export_project_status")
      .update({
        status: "failed",
        errors: [{ message, at: new Date().toISOString() }],
        summary: { promotion_error: message },
      })
      .eq("run_id", runId)
      .eq("project_id", projectId);
    if (updateError) throw updateError;
  }

  async assertPromotionComplete(runId, { allowPartial = false } = {}) {
    const statuses = await this.listProjectStatuses(runId);
    const incomplete = statuses.filter((status) => status.status !== "promoted");
    if (!allowPartial && (statuses.length === 0 || incomplete.length > 0)) {
      throw new Error(
        `File transfer requires all projects promoted; ${incomplete.length} of ${statuses.length} are incomplete.`,
      );
    }
    return { statuses, incomplete };
  }

  async listProjectStatuses(runId, isReadOnly = null) {
    let query = this.client
      .from("basecamp_export_project_status")
      .select("project_id,source_project_id,is_read_only,status,summary")
      .eq("run_id", runId)
      .order("source_project_id");
    if (isReadOnly !== null) query = query.eq("is_read_only", isReadOnly);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async setRunImporting(runId, phase) {
    const { error } = await this.client
      .from("basecamp_export_runs")
      .update({ status: "importing", phase })
      .eq("id", runId);
    if (error) throw error;
  }

  async getEntryBlobCheckpoint(entryId) {
    const { data, error } = await this.client
      .from("basecamp_archive_entries")
      .select("blob:file_blobs(id,status)")
      .eq("id", entryId)
      .maybeSingle();
    if (error) throw error;
    const blob = Array.isArray(data?.blob) ? data.blob[0] : data?.blob;
    return blob ?? null;
  }

  async claimBlob(row) {
    const { data, error } = await this.client.rpc(
      "claim_basecamp_file_blob",
      {
        target_blob_id: row.id,
        target_organization_id: row.organizationId,
        target_bucket_id: row.bucketId,
        target_object_path: row.objectPath,
        target_sha256: row.sha256,
        target_crc32: row.crc32,
        target_size_bytes: row.sizeBytes,
        target_mime_type: row.mimeType,
        target_lease_token: this.uploadLeaseToken,
      },
    );
    if (error) {
      if (error.code === "55P03") {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return this.claimBlob(row);
      }
      throw error;
    }
    const blob = data?.[0];
    if (!blob) throw new Error("File blob claim returned no row.");
    return this.mapBlob(blob);
  }

  mapBlob(blob) {
    this.blobs.set(blob.id, blob);
    return {
      ...blob,
      upload_url: blob.tus_upload_url,
      upload_offset: blob.tus_offset_bytes,
    };
  }

  async updateBlobProgress(blobId, { uploadUrl, uploadOffset }) {
    const { data, error } = await this.client
      .from("file_blobs")
      .update({
        status: "uploading",
        tus_upload_url: uploadUrl,
        tus_offset_bytes: uploadOffset,
        last_attempt_at: new Date().toISOString(),
        upload_lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      .eq("id", blobId)
      .eq("upload_lease_token", this.uploadLeaseToken)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`Lost the upload lease for blob ${blobId}.`);
  }

  async resetBlobUpload(blobId) {
    const { error } = await this.client
      .from("file_blobs")
      .update({ tus_upload_url: null, tus_offset_bytes: 0, status: "pending" })
      .eq("id", blobId)
      .eq("upload_lease_token", this.uploadLeaseToken);
    if (error) throw error;
  }

  async markBlobReady(blobId, { uploadUrl, uploadOffset }) {
    const { data, error } = await this.client
      .from("file_blobs")
      .update({
        status: "ready",
        tus_upload_url: uploadUrl,
        tus_offset_bytes: uploadOffset,
        verified_at: new Date().toISOString(),
        last_error: null,
        upload_lease_token: null,
        upload_lease_expires_at: null,
      })
      .eq("id", blobId)
      .eq("upload_lease_token", this.uploadLeaseToken)
      .select("id,bucket_id,object_path,size_bytes")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: ready, error: readyError } = await this.client
        .from("file_blobs")
        .select("id,bucket_id,object_path,size_bytes,status")
        .eq("id", blobId)
        .eq("status", "ready")
        .maybeSingle();
      if (readyError) throw readyError;
      if (!ready) throw new Error(`Lost the upload lease for blob ${blobId}.`);
      this.blobs.set(blobId, ready);
      return;
    }
    this.blobs.set(blobId, data);
  }

  async markBlobFailed(blobId, error) {
    const { error: updateError } = await this.client
      .from("file_blobs")
      .update({
        status: "failed",
        last_error: String(error).slice(0, 4000),
        last_attempt_at: new Date().toISOString(),
        upload_lease_token: null,
        upload_lease_expires_at: null,
      })
      .eq("id", blobId)
      .eq("upload_lease_token", this.uploadLeaseToken)
      .neq("status", "ready");
    if (updateError) throw updateError;
  }

  async verifyBlobObject({ bucketId, objectPath, sizeBytes }) {
    const { data, error } = await this.client.storage
      .from(bucketId)
      .info(objectPath);
    if (error || !data) return false;
    return Number(data.metadata?.size ?? data.size) === sizeBytes;
  }

  async linkEntryBlob(entryId, blobId, { sha256, crc32 }) {
    const blob =
      this.blobs.get(blobId) ??
      (
        await this.client
          .from("file_blobs")
          .select("id,bucket_id,object_path,size_bytes")
          .eq("id", blobId)
          .single()
      ).data;
    if (!blob) throw new Error(`Blob ${blobId} was not found after upload.`);
    const { error } = await this.client
      .from("basecamp_archive_entries")
      .update({ blob_id: blobId })
      .eq("id", entryId);
    if (error) throw error;
    const { error: fileError } = await this.client
      .from("files")
      .update({
        blob_id: blobId,
        checksum_sha256: sha256,
        source_checksum_sha256: sha256,
        source_crc32: crc32,
        availability_status: "available",
      })
      .contains("metadata", { archive_entry_id: entryId });
    if (fileError) throw fileError;
  }

  async updateTransferProgress(runId, totals) {
    const { error } = await this.client
      .from("basecamp_export_runs")
      .update({
        phase: "files",
        status: "importing",
        entry_count_processed: totals.processedEntries,
        bytes_hashed: totals.bytesHashed,
        bytes_uploaded: totals.bytesUploaded,
        blob_count_ready: totals.uploadedBlobs + totals.reusedBlobs,
        progress: totals,
      })
      .eq("id", runId);
    if (error) throw error;
  }

  async checkpointRun(runId, phase, progress) {
    const { error } = await this.client
      .from("basecamp_export_runs")
      .update({
        status: "ready",
        phase,
        progress,
      })
      .eq("id", runId);
    if (error) throw error;
  }

  async verifyRun(runId) {
    const count = async (table, configure = (query) => query) => {
      const { count: result, error } = await configure(
        this.client
          .from(table)
          .select("id", { count: "exact", head: true }),
      );
      if (error) throw error;
      return result ?? 0;
    };
    const { data: run, error: runError } = await this.client
      .from("basecamp_export_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (runError) throw runError;
    const [
      entries,
      missingEntryBlobs,
      records,
      recordEntries,
      projectStatuses,
      promotedProjects,
      failedProjects,
      nonReadyBlobs,
      pendingFiles,
    ] = await Promise.all([
      count("basecamp_archive_entries", (query) => query.eq("run_id", runId)),
      count("basecamp_archive_entries", (query) =>
        query.eq("run_id", runId).is("blob_id", null),
      ),
      count("basecamp_archive_records", (query) => query.eq("run_id", runId)),
      (async () => {
        const { count: result, error } = await this.client
          .from("basecamp_archive_record_entries")
          .select(
            "id,record:basecamp_archive_records!inner(run_id)",
            { count: "exact", head: true },
          )
          .eq("record.run_id", runId);
        if (error) throw error;
        return result ?? 0;
      })(),
      count("basecamp_export_project_status", (query) =>
        query.eq("run_id", runId),
      ),
      count("basecamp_export_project_status", (query) =>
        query.eq("run_id", runId).eq("status", "promoted"),
      ),
      count("basecamp_export_project_status", (query) =>
        query.eq("run_id", runId).eq("status", "failed"),
      ),
      (async () => {
        const { count: result, error } = await this.client
          .from("file_blobs")
          .select(
            "id,entries:basecamp_archive_entries!inner(run_id)",
            { count: "exact", head: true },
          )
          .eq("entries.run_id", runId)
          .not("status", "in", "(ready,unverified)");
        if (error) throw error;
        return result ?? 0;
      })(),
      count("files", (query) =>
        query
          .eq("basecamp_export_run_id", runId)
          .neq("availability_status", "available"),
      ),
    ]);
    return {
      run,
      entries,
      missingEntryBlobs,
      records,
      recordEntries,
      projectStatuses,
      promotedProjects,
      failedProjects,
      nonReadyBlobs,
      pendingFiles,
      complete:
        entries === run.entry_count_expected &&
        missingEntryBlobs === 0 &&
        records === run.record_count_expected &&
        recordEntries >= records &&
        projectStatuses ===
          Number(run.manifest?.active_project_count ?? 0) +
            Number(run.manifest?.archived_project_count ?? 0) &&
        promotedProjects === projectStatuses &&
        failedProjects === 0 &&
        nonReadyBlobs === 0 &&
        pendingFiles === 0,
    };
  }

  async completeRun(runId, totals) {
    const entryBlobs = await this.selectAll(
      "basecamp_archive_entries",
      "blob_id",
      (query) => query.eq("run_id", runId).not("blob_id", "is", null),
    );
    const readyBlobCount = new Set(entryBlobs.map((entry) => entry.blob_id)).size;
    const { error } = await this.client
      .from("basecamp_export_runs")
      .update({
        status: "completed",
        phase: "completed",
        entry_count_processed: totals.entries,
        bytes_hashed: totals.bytesHashed,
        bytes_uploaded: totals.bytesUploaded,
        blob_count_expected: readyBlobCount,
        blob_count_ready: readyBlobCount,
        progress: totals,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (error) throw error;
  }

  async failRun(runId, error) {
    const message = errorMessage(error);
    await this.client
      .from("basecamp_export_runs")
      .update({
        status: "failed",
        error_count: 1,
        errors: [{ message, at: new Date().toISOString() }],
      })
      .eq("id", runId);
  }
}
