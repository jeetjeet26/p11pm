import "server-only";

import type {
  ArchiveIndexData,
  ArchiveProjectData,
} from "@/lib/archive-data/contracts";
import {
  mapArchiveCounts,
  mapArchiveFile,
  mapArchiveProgress,
  mapArchiveProject,
  mapArchiveRecord,
} from "@/lib/archive-data/mappers";
import { getViewer } from "@/lib/auth/viewer";
import { asRecord, asRows, asString } from "@/lib/project-data/mappers";
import { createClient } from "@/lib/supabase/server";

const EMPTY_COUNTS = {
  recordCount: 0,
  entryCount: 0,
  importedFileCount: 0,
  recordTypes: {},
  entryClassifications: {},
};

interface ArchiveFilters {
  query?: string;
  recordType?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function archiveContext() {
  const [viewer, supabase] = await Promise.all([getViewer(), createClient()]);
  if (!viewer || !supabase) return null;
  return { viewer, supabase };
}

export async function getArchiveIndexData(
  filters: ArchiveFilters = {},
): Promise<ArchiveIndexData> {
  const context = await archiveContext();
  if (!context) return { projects: [], results: [] };
  const { viewer, supabase } = context;
  const projectsRequest = supabase.rpc("list_basecamp_archive_projects", {
    organization_id: viewer.organization.id,
    run_id: null,
    after_project_name: null,
    after_project_id: null,
    page_size: 100,
  });
  const progressRequest = supabase
    .from("basecamp_export_runs")
    .select(
      "id,phase,status,exported_at,entry_count_processed,entry_count_expected,record_count_processed,record_count_expected,blob_count_ready,blob_count_expected,bytes_uploaded,bytes_total",
    )
    .eq("organization_id", viewer.organization.id)
    .order("exported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const searchRequest = filters.query?.trim()
    ? supabase.rpc("search_basecamp_archive", {
        target_organization_id: viewer.organization.id,
        search_query: filters.query.trim(),
        target_project_id: null,
        target_record_type:
          filters.recordType && filters.recordType !== "all"
            ? filters.recordType
            : null,
        source_from: filters.dateFrom
          ? `${filters.dateFrom}T00:00:00.000Z`
          : null,
        source_to: filters.dateTo
          ? `${filters.dateTo}T23:59:59.999Z`
          : null,
        after_rank: null,
        after_source_updated_at: null,
        after_record_id: null,
        page_size: 50,
      })
    : Promise.resolve({ data: [], error: null });
  const [projects, progress, search] = await Promise.all([
    projectsRequest,
    progressRequest,
    searchRequest,
  ]);
  if (projects.error) throw projects.error;
  if (progress.error) throw progress.error;
  if (search.error) throw search.error;
  return {
    projects: asRows(projects.data).map(mapArchiveProject),
    results: asRows(search.data).map(mapArchiveRecord),
    progress: progress.data ? mapArchiveProgress(progress.data) : undefined,
  };
}

export async function getArchiveProjectData(
  projectId: string,
  filters: ArchiveFilters = {},
): Promise<ArchiveProjectData | null> {
  const context = await archiveContext();
  if (!context) return null;
  const { viewer, supabase } = context;
  const projectRequest = supabase
    .from("projects")
    .select("id,name,status,is_read_only,organization_id")
    .eq("id", projectId)
    .eq("organization_id", viewer.organization.id)
    .maybeSingle();
  const countsRequest = supabase.rpc("get_basecamp_project_archive_counts", {
    project_id: projectId,
    run_id: null,
  });
  const recordsRequest = filters.query?.trim()
    ? supabase.rpc("search_basecamp_archive", {
        target_organization_id: viewer.organization.id,
        search_query: filters.query.trim(),
        target_project_id: projectId,
        target_record_type:
          filters.recordType && filters.recordType !== "all"
            ? filters.recordType
            : null,
        source_from: filters.dateFrom
          ? `${filters.dateFrom}T00:00:00.000Z`
          : null,
        source_to: filters.dateTo
          ? `${filters.dateTo}T23:59:59.999Z`
          : null,
        after_rank: null,
        after_source_updated_at: null,
        after_record_id: null,
        page_size: 50,
      })
    : supabase.rpc("list_basecamp_archive_records", {
        target_project_id: projectId,
        target_record_type:
          filters.recordType && filters.recordType !== "all"
            ? filters.recordType
            : null,
        target_parent_id: null,
        source_from: filters.dateFrom
          ? `${filters.dateFrom}T00:00:00.000Z`
          : null,
        source_to: filters.dateTo
          ? `${filters.dateTo}T23:59:59.999Z`
          : null,
        after_source_updated_at: null,
        after_record_id: null,
        page_size: 50,
      });
  const filesRequest = supabase.rpc("list_imported_project_files", {
    project_id: projectId,
    after_listing_position: null,
    after_file_id: null,
    page_size: 50,
  });
  const [project, counts, records, files] = await Promise.all([
    projectRequest,
    countsRequest,
    recordsRequest,
    filesRequest,
  ]);
  if (project.error) throw project.error;
  if (counts.error) throw counts.error;
  if (records.error) throw records.error;
  if (files.error) throw files.error;
  if (!project.data) return null;
  const projectRow = asRecord(project.data);
  return {
    project: {
      id: asString(projectRow.id),
      name: asString(projectRow.name, "Basecamp project"),
      status: asString(projectRow.status),
      isReadOnly: projectRow.is_read_only === true,
    },
    counts: counts.data?.[0]
      ? mapArchiveCounts(counts.data[0])
      : EMPTY_COUNTS,
    records: asRows(records.data).map(mapArchiveRecord),
    files: asRows(files.data).map(mapArchiveFile),
  };
}
