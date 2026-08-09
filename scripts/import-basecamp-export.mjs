#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { config as loadDotenv } from "dotenv";

import { StoredZipArchive } from "./lib/basecamp-export/archive.mjs";
import { transferArchiveEntries } from "./lib/basecamp-export/blob-transfer.mjs";
import { sourceUuid, stableUuid } from "./lib/basecamp-export/identity.mjs";
import {
  buildInventory,
  validateProductionInventory,
} from "./lib/basecamp-export/inventory.mjs";
import {
  collectBasecampPeople,
  scanBasecampMetadata,
} from "./lib/basecamp-export/metadata.mjs";
import { parseExportIndex } from "./lib/basecamp-export/parser.mjs";
import { BasecampExportRepository } from "./lib/basecamp-export/repository.mjs";
import {
  importerStatePaths,
  writeJsonAtomic,
} from "./lib/basecamp-export/state.mjs";

const DEFAULT_ARCHIVE_PATH =
  "/Users/jasjitgill/Downloads/Basecamp-export-p11-08- 7-2026.zip";
const PHASES = new Set(["inventory", "metadata", "promote", "files", "verify", "all"]);

for (const environmentPath of [".env.production.local", ".env.local", ".env"]) {
  if (existsSync(environmentPath)) {
    loadDotenv({ path: environmentPath, override: false, quiet: true });
  }
}

function usage() {
  return `
Usage:
  npm run import:basecamp-export -- --phase=inventory [options]

Options:
  --archive=<path>          Zip64 Basecamp export path
  --phase=<phase>           inventory|metadata|promote|files|verify|all
  --project=<basecamp-id>   Limit work to one source project
  --run-id=<uuid>           Resume a specific remote run
  --organization-id=<uuid>  Target P11 organization
  --concurrency=<1-8>       Concurrent blob uploads (default: 2)
  --limit=<count>           Canary limit for entries or projects
  --resume                  Resume checkpoints (default)
  --no-resume               Ignore resumable upload URLs
  --dry-run                 Parse and report without remote writes
  --strict                  Require the known 66,918-entry production inventory
  --allow-production        Required for remote mutations
  --help                    Show this help
`.trim();
}

function valueArgument(argumentsList, name) {
  const prefix = `--${name}=`;
  return argumentsList.find((argument) => argument.startsWith(prefix))?.slice(
    prefix.length,
  );
}

function parsePositiveInteger(value, name, { maximum } = {}) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum && parsed > maximum)) {
    throw new Error(
      `--${name} must be a positive integer${maximum ? ` no greater than ${maximum}` : ""}.`,
    );
  }
  return parsed;
}

export function parseArguments(argumentsList) {
  if (argumentsList.includes("--help")) return { help: true };
  const phase = valueArgument(argumentsList, "phase") ?? "inventory";
  if (!PHASES.has(phase)) {
    throw new Error(`Unknown phase ${JSON.stringify(phase)}.`);
  }
  const concurrency =
    parsePositiveInteger(valueArgument(argumentsList, "concurrency"), "concurrency", {
      maximum: 8,
    }) ?? 2;
  const limit = parsePositiveInteger(valueArgument(argumentsList, "limit"), "limit");

  return {
    help: false,
    archivePath: path.resolve(
      valueArgument(argumentsList, "archive") ??
        process.env.BASECAMP_EXPORT_PATH ??
        DEFAULT_ARCHIVE_PATH,
    ),
    phase,
    projectId:
      valueArgument(argumentsList, "project") ??
      process.env.BASECAMP_SOURCE_PROJECT_ID ??
      null,
    requestedRunId:
      valueArgument(argumentsList, "run-id") ??
      process.env.BASECAMP_EXPORT_RUN_ID ??
      null,
    organizationId:
      valueArgument(argumentsList, "organization-id") ??
      process.env.BASECAMP_ORGANIZATION_ID?.trim() ??
      null,
    concurrency,
    limit,
    resume: !argumentsList.includes("--no-resume"),
    dryRun: argumentsList.includes("--dry-run"),
    strict: argumentsList.includes("--strict"),
    allowProduction: argumentsList.includes("--allow-production"),
  };
}

function manifestRows(archive, runId, projectIds = new Map()) {
  return archive.entries.map((entry) => ({
    id: stableUuid("basecamp-archive-entry", runId, entry.fileName),
    run_id: runId,
    project_id: entry.projectId ? projectIds.get(entry.projectId) ?? null : null,
    entry_type: entry.entryKind,
    classification:
      entry.projectStatus ?? (entry.projectId ? "project" : "shared"),
    source_id: entry.sourceId,
    source_parent_id: null,
    source_path: entry.fileName,
    file_name: entry.originalName,
    crc32: entry.crc32,
    compressed_size_bytes: entry.compressedSize,
    uncompressed_size_bytes: entry.sizeBytes,
    local_header_offset: entry.relativeOffsetOfLocalHeader,
    data_offset: null,
    metadata: {
      general_purpose_bit_flag: entry.generalPurposeBitFlag,
      occurrence_date: entry.occurrenceDate,
      source_project_id: entry.projectId,
      source_project_status: entry.projectStatus,
    },
  }));
}

function assertRemoteSafety(options) {
  if (options.phase === "inventory" || options.dryRun) return;
  if (!options.allowProduction) {
    throw new Error(
      "Remote mutation requires --allow-production. Run --phase=inventory --strict first.",
    );
  }
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRoleKey || !options.organizationId) {
    throw new Error(
      "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, and BASECAMP_ORGANIZATION_ID.",
    );
  }
  if (!url.includes("dojycqqnvmnjatdkiswz")) {
    throw new Error(
      "Refusing to mutate an unexpected Supabase project. Expected dojycqqnvmnjatdkiswz.",
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  assertRemoteSafety(options);
  if (!existsSync(options.archivePath)) {
    throw new Error(`Basecamp archive not found: ${options.archivePath}`);
  }

  const archive = await StoredZipArchive.open(options.archivePath);
  try {
    const indexEntry = archive.entries.find(
      (entry) => entry.entryKind === "export_index",
    );
    if (!indexEntry) throw new Error("The Basecamp export index is missing.");
    const exportIndex = parseExportIndex(
      (await archive.readBuffer(indexEntry)).toString("utf8"),
      indexEntry.fileName,
    );
    if (!exportIndex.accountId) {
      throw new Error("The Basecamp account ID is missing from the export index.");
    }
    const inventory = await buildInventory(archive, exportIndex);
    if (options.strict) validateProductionInventory(inventory);

    const computedRunId = stableUuid(
      "basecamp-export-run",
      options.organizationId ?? "unscoped",
      exportIndex.accountId,
      inventory.manifestSha256,
    );
    const runId = options.requestedRunId ?? computedRunId;
    const statePaths = importerStatePaths(runId);
    await writeJsonAtomic(statePaths.inventory, { runId, ...inventory });
    await writeJsonAtomic(statePaths.manifest, {
      runId,
      parserVersion: "basecamp-export-v1",
      accountId: exportIndex.accountId,
      exportedAt: exportIndex.exportedAt,
      projects: exportIndex.projects,
      entries: manifestRows(archive, runId),
    });

    console.log(
      JSON.stringify(
        {
          runId,
          phase: options.phase,
          dryRun: options.dryRun,
          archiveSizeBytes: inventory.archiveSizeBytes,
          uncompressedBytes: inventory.uncompressedBytes,
          entries: inventory.entryCount,
          officialPages: inventory.officialPageCount,
          activeProjects: inventory.activeProjectCount,
          archivedProjects: inventory.archivedProjectCount,
          unclassified: inventory.unclassified.length,
          manifestSha256: inventory.manifestSha256,
          stateDirectory: statePaths.directory,
        },
        null,
        2,
      ),
    );

    if (options.dryRun && options.phase !== "inventory") {
      if (!options.organizationId) {
        throw new Error(
          "--organization-id (or BASECAMP_ORGANIZATION_ID) is required for stable metadata identities.",
        );
      }
      const metadataReport = await scanBasecampMetadata({
        archive,
        exportIndex,
        runId,
        organizationId: options.organizationId,
        projectFilter: options.projectId,
        projectLimit: options.limit,
      });
      await writeJsonAtomic(statePaths.report, {
        runId,
        phase: "metadata",
        ...metadataReport,
      });
      console.log(
        JSON.stringify(
          {
            counts: metadataReport.counts,
            people: metadataReport.people,
            orphanCanonicalRecords:
              metadataReport.orphanCanonicalRecords,
            unresolvedReferences: metadataReport.unresolvedReferences,
            selectedProjects: metadataReport.selectedProjects,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (options.phase === "inventory") return;

    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const repository = new BasecampExportRepository({
      supabaseUrl,
      serviceRoleKey,
    });
    const needsMetadata =
      options.phase === "metadata" || options.phase === "all";
    let identity = null;

    if (needsMetadata) {
      const people = await collectBasecampPeople({
        archive,
        projectFilter: options.projectId,
      });
      identity = await repository.loadIdentity({
        organizationId: options.organizationId,
        accountId: exportIndex.accountId,
        people,
      });
      for (const project of exportIndex.projects) {
        if (!identity.projectIds.has(project.projectId)) {
          identity.projectIds.set(
            project.projectId,
            sourceUuid({
              organizationId: options.organizationId,
              accountId: exportIndex.accountId,
              entityType: "projects",
              sourceId: project.projectId,
            }),
          );
        }
      }
      await repository.initializeRun({
        id: runId,
        organizationId: options.organizationId,
        accountId: exportIndex.accountId,
        archiveName: path.basename(options.archivePath),
        archiveSizeBytes: inventory.archiveSizeBytes,
        manifestSha256: inventory.manifestSha256,
        parserVersion: "basecamp-export-v1",
        exportedAt: exportIndex.exportedAt,
        entryCount: inventory.entryCount,
        bytesTotal: inventory.uncompressedBytes,
        manifest: {
          active_project_count: inventory.activeProjectCount,
          archived_project_count: inventory.archivedProjectCount,
          official_page_count: inventory.officialPageCount,
        },
      });
      const remoteManifest = manifestRows(archive, runId, identity.projectIds);
      await repository.writeArchiveEntries(remoteManifest);
      await writeJsonAtomic(statePaths.manifest, {
        runId,
        parserVersion: "basecamp-export-v1",
        accountId: exportIndex.accountId,
        exportedAt: exportIndex.exportedAt,
        projects: exportIndex.projects,
        entries: remoteManifest,
      });
      const metadataReport = await scanBasecampMetadata({
        archive,
        exportIndex,
        runId,
        organizationId: options.organizationId,
        projectFilter: options.projectId,
        identity,
        peopleCatalog: people,
        onBatch: (kind, rows) =>
          repository.writeBatch(kind, rows, identity),
      });
      await repository.completeMetadata(runId, {
        counts: metadataReport.counts,
        entryCount: inventory.entryCount,
        recordCount: metadataReport.counts.archive_record ?? 0,
        warnings: metadataReport.unresolvedReferences,
      });
      await writeJsonAtomic(statePaths.report, {
        runId,
        phase: "metadata",
        ...metadataReport,
      });
      console.log(
        JSON.stringify(
          {
            phase: "metadata",
            records: metadataReport.counts.archive_record ?? 0,
            projectStatusRows: metadataReport.counts.project_status ?? 0,
            profiles: metadataReport.people,
            warnings: metadataReport.unresolvedReferences,
          },
          null,
          2,
        ),
      );
      if (options.phase === "metadata") return;
    }

    if (options.phase === "promote" || options.phase === "all") {
      await repository.setRunImporting(runId, "promote");
      let statuses = await repository.listProjectStatuses(runId);
      if (options.projectId) {
        statuses = statuses.filter(
          (status) => String(status.source_project_id) === options.projectId,
        );
      }
      if (options.limit) statuses = statuses.slice(0, options.limit);
      const failures = [];
      for (const [index, status] of statuses.entries()) {
        try {
          const result = await repository.promoteProject(
            runId,
            status.project_id,
          );
          console.log(
            JSON.stringify({
              phase: "promote",
              project: index + 1,
              projects: statuses.length,
              sourceProjectId: status.source_project_id,
              result,
            }),
          );
        } catch (error) {
          await repository.markProjectFailed(runId, status.project_id, error);
          failures.push({
            projectId: status.project_id,
            sourceProjectId: status.source_project_id,
            error:
              error instanceof Error
                ? error.message
                : error && typeof error === "object"
                  ? JSON.stringify(error)
                  : String(error),
          });
          console.error(JSON.stringify(failures.at(-1)));
        }
      }
      if (failures.length) {
        await repository.failRun(
          runId,
          new Error(`${failures.length} project promotions failed.`),
        );
        throw new Error(
          `${failures.length} Basecamp projects failed transactional promotion.`,
        );
      }
      if (options.phase === "promote") {
        await repository.checkpointRun(runId, "promoted", {
          promoted_projects: statuses.length,
        });
        return;
      }
    }

    if (options.phase === "files" || options.phase === "all") {
      await repository.assertPromotionComplete(runId, {
        allowPartial: Boolean(options.projectId || options.limit),
      });
      await repository.setRunImporting(runId, "files");
      let entries = archive.entries;
      if (options.projectId) {
        entries = entries.filter(
          (entry) => entry.projectId === options.projectId,
        );
      }
      if (options.limit) entries = entries.slice(0, options.limit);
      let lastCheckpoint = 0;
      const totals = await transferArchiveEntries({
        archive,
        entries,
        entryIdForPath: (sourcePath) =>
          stableUuid("basecamp-archive-entry", runId, sourcePath),
        repository,
        runId,
        organizationId: options.organizationId,
        supabaseUrl,
        serviceRoleKey,
        concurrency: options.concurrency,
        resume: options.resume,
        async onEntryComplete({ entry, status, totals: progress }) {
          if (
            progress.processedEntries - lastCheckpoint >= 25 ||
            progress.processedEntries === progress.entries
          ) {
            lastCheckpoint = progress.processedEntries;
            await repository.updateTransferProgress(runId, progress);
            console.log(
              JSON.stringify({
                phase: "files",
                status,
                entry: entry.fileName,
                processed: progress.processedEntries,
                entries: progress.entries,
                bytesHashed: progress.bytesHashed,
                bytesUploaded: progress.bytesUploaded,
              }),
            );
          }
        },
      });
      await repository.checkpointRun(
        runId,
        options.projectId || options.limit
          ? "canary_files_complete"
          : "files_complete",
        totals,
      );
      await writeJsonAtomic(statePaths.report, {
        runId,
        phase: "files",
        totals,
      });
      if (options.phase === "files") return;
    }

    if (options.phase === "verify" || options.phase === "all") {
      const verification = await repository.verifyRun(runId);
      await writeJsonAtomic(statePaths.report, {
        runId,
        phase: "verify",
        verification,
      });
      console.log(JSON.stringify({ phase: "verify", ...verification }, null, 2));
      if (!options.projectId && !options.limit) {
        if (!verification.complete) {
          throw new Error("Full Basecamp verification did not pass.");
        }
        await repository.completeRun(runId, {
          entries: verification.entries,
          bytesHashed: verification.run.bytes_hashed,
          bytesUploaded: verification.run.bytes_uploaded,
          uploadedBlobs: verification.run.blob_count_ready,
        });
      }
    }
  } finally {
    await archive.close();
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
