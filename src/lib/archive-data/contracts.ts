export interface ArchiveProjectSummary {
  id: string;
  name: string;
  status: string;
  isReadOnly: boolean;
  exportRunId: string;
  exportedAt: string;
  recordCount: number;
  entryCount: number;
  fileCount: number;
}

export interface ArchiveRecord {
  id: string;
  exportRunId: string;
  projectId?: string;
  parentId?: string;
  type: string;
  nativeRecordingId?: string;
  title: string;
  sanitizedHtml: string;
  plainText: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  sourceStatus?: string;
  metadata: Record<string, unknown>;
  rank?: number;
}

export interface ArchiveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  availability: string;
  listingPosition?: number;
  sourceCreatedAt?: string;
  importedAt?: string;
  referenceCount: number;
}

export interface ArchiveRunProgress {
  id: string;
  phase: string;
  status: string;
  exportedAt: string;
  entriesProcessed: number;
  entriesExpected: number;
  recordsProcessed: number;
  recordsExpected: number;
  blobsReady: number;
  blobsExpected: number;
  bytesUploaded: number;
  bytesTotal: number;
}

export interface ArchiveCounts {
  exportRunId?: string;
  recordCount: number;
  entryCount: number;
  importedFileCount: number;
  recordTypes: Record<string, number>;
  entryClassifications: Record<string, number>;
}

export interface ArchiveIndexData {
  projects: ArchiveProjectSummary[];
  results: ArchiveRecord[];
  progress?: ArchiveRunProgress;
}

export interface ArchiveProjectData {
  project: {
    id: string;
    name: string;
    status: string;
    isReadOnly: boolean;
  };
  counts: ArchiveCounts;
  records: ArchiveRecord[];
  files: ArchiveFile[];
}
