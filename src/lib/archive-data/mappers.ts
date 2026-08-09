import type {
  ArchiveCounts,
  ArchiveFile,
  ArchiveProjectSummary,
  ArchiveRecord,
  ArchiveRunProgress,
} from "@/lib/archive-data/contracts";
import {
  asNumber,
  asRecord,
  asString,
} from "@/lib/project-data/mappers";

function optionalString(value: unknown): string | undefined {
  const result = asString(value);
  return result || undefined;
}

function numberRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, count]) => [
      key,
      asNumber(count),
    ]),
  );
}

export function mapArchiveProject(value: unknown): ArchiveProjectSummary {
  const row = asRecord(value);
  return {
    id: asString(row.project_id),
    name: asString(row.project_name, "Basecamp project"),
    status: asString(row.project_status),
    isReadOnly: row.is_read_only === true,
    exportRunId: asString(row.export_run_id),
    exportedAt: asString(row.exported_at),
    recordCount: asNumber(row.record_count),
    entryCount: asNumber(row.entry_count),
    fileCount: asNumber(row.file_count),
  };
}

export function mapArchiveRecord(value: unknown): ArchiveRecord {
  const row = asRecord(value);
  return {
    id: asString(row.record_id),
    exportRunId: asString(row.export_run_id),
    projectId: optionalString(row.project_id),
    parentId: optionalString(row.parent_id),
    type: asString(row.record_type, "record"),
    nativeRecordingId: optionalString(row.native_recording_id),
    title: asString(row.title, "Untitled Basecamp record"),
    sanitizedHtml: asString(row.sanitized_html),
    plainText: asString(row.plain_text_excerpt) || asString(row.plain_text),
    sourceCreatedAt: optionalString(row.source_created_at),
    sourceUpdatedAt: optionalString(row.source_updated_at),
    sourceStatus: optionalString(row.source_status),
    metadata: asRecord(row.metadata),
    rank:
      typeof row.rank === "number" || typeof row.rank === "string"
        ? asNumber(row.rank)
        : undefined,
  };
}

export function mapArchiveFile(value: unknown): ArchiveFile {
  const row = asRecord(value);
  const listingPosition = asNumber(row.listing_position, Number.NaN);
  return {
    id: asString(row.file_id),
    name: asString(row.file_name, "Basecamp file"),
    mimeType: asString(row.mime_type, "application/octet-stream"),
    sizeBytes: asNumber(row.size_bytes),
    availability: asString(row.availability_status, "pending"),
    listingPosition: Number.isFinite(listingPosition)
      ? listingPosition
      : undefined,
    sourceCreatedAt: optionalString(row.source_created_at),
    importedAt: optionalString(row.imported_at),
    referenceCount: asNumber(row.reference_count),
  };
}

export function mapArchiveProgress(value: unknown): ArchiveRunProgress {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    phase: asString(row.phase),
    status: asString(row.status),
    exportedAt: asString(row.exported_at),
    entriesProcessed: asNumber(row.entry_count_processed),
    entriesExpected: asNumber(row.entry_count_expected),
    recordsProcessed: asNumber(row.record_count_processed),
    recordsExpected: asNumber(row.record_count_expected),
    blobsReady: asNumber(row.blob_count_ready),
    blobsExpected: asNumber(row.blob_count_expected),
    bytesUploaded: asNumber(row.bytes_uploaded),
    bytesTotal: asNumber(row.bytes_total),
  };
}

export function mapArchiveCounts(value: unknown): ArchiveCounts {
  const row = asRecord(value);
  return {
    exportRunId: optionalString(row.export_run_id),
    recordCount: asNumber(row.record_count),
    entryCount: asNumber(row.entry_count),
    importedFileCount: asNumber(row.imported_file_count),
    recordTypes: numberRecord(row.record_types),
    entryClassifications: numberRecord(row.entry_classifications),
  };
}
