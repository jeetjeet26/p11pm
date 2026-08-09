import { stat } from "node:fs/promises";
import path from "node:path";

import { manifestSha256 } from "./identity.mjs";

const OFFICIAL_PAGE_KINDS = new Set([
  "campfire",
  "card",
  "card_column",
  "card_table",
  "dropbox_file",
  "export_index",
  "external_service_file",
  "forward_inbox",
  "forwarded_email",
  "message",
  "message_board",
  "people",
  "questionnaire",
  "schedule",
  "schedule_entry",
  "todo",
  "todo_list",
  "todo_set",
  "vault_record",
]);

export async function buildInventory(archive, exportIndex) {
  const archiveStat = await stat(archive.archivePath);
  const byKind = {};
  const bytesByKind = {};
  const projectEntryCounts = {};
  let officialPageCount = 0;
  let largestEntry = null;

  for (const entry of archive.entries) {
    byKind[entry.entryKind] = (byKind[entry.entryKind] ?? 0) + 1;
    bytesByKind[entry.entryKind] =
      (bytesByKind[entry.entryKind] ?? 0) + entry.sizeBytes;
    if (entry.projectId) {
      projectEntryCounts[entry.projectId] =
        (projectEntryCounts[entry.projectId] ?? 0) + 1;
    }
    if (OFFICIAL_PAGE_KINDS.has(entry.entryKind)) officialPageCount += 1;
    if (!largestEntry || entry.sizeBytes > largestEntry.sizeBytes) {
      largestEntry = {
        fileName: entry.fileName,
        sizeBytes: entry.sizeBytes,
      };
    }
  }

  const projectIds = new Set(exportIndex.projects.map((project) => project.projectId));
  const unknownProjectIds = Object.keys(projectEntryCounts).filter(
    (projectId) => !projectIds.has(projectId),
  );
  const missingProjectFolders = exportIndex.projects
    .filter((project) => !projectEntryCounts[project.projectId])
    .map((project) => project.projectId);
  const unclassified = archive.entries
    .filter((entry) => entry.entryKind === "unclassified")
    .map((entry) => entry.fileName);

  return {
    archivePath: path.resolve(archive.archivePath),
    archiveSizeBytes: archiveStat.size,
    accountId: exportIndex.accountId,
    exportedAt: exportIndex.exportedAt,
    manifestSha256: manifestSha256(archive.entries),
    entryCount: archive.entries.length,
    uncompressedBytes: archive.entries.reduce(
      (total, entry) => total + entry.sizeBytes,
      0,
    ),
    officialPageCount,
    projectCount: exportIndex.projects.length,
    activeProjectCount: exportIndex.projects.filter(
      (project) => project.status === "active",
    ).length,
    archivedProjectCount: exportIndex.projects.filter(
      (project) => project.status === "archived",
    ).length,
    byKind: Object.fromEntries(Object.entries(byKind).sort()),
    bytesByKind: Object.fromEntries(Object.entries(bytesByKind).sort()),
    largestEntry,
    unclassified,
    unknownProjectIds,
    missingProjectFolders,
  };
}

export function validateProductionInventory(inventory) {
  const failures = [];
  const requireEqual = (label, actual, expected) => {
    if (actual !== expected) {
      failures.push(`${label}: expected ${expected}, found ${actual}`);
    }
  };

  requireEqual("archive entries", inventory.entryCount, 66_918);
  requireEqual("projects", inventory.projectCount, 207);
  requireEqual("active projects", inventory.activeProjectCount, 143);
  requireEqual("archived projects", inventory.archivedProjectCount, 64);
  requireEqual("people pages", inventory.byKind.people, 207);
  requireEqual("todo sets", inventory.byKind.todo_set, 425);
  requireEqual("todo lists", inventory.byKind.todo_list, 1_970);
  requireEqual("todos", inventory.byKind.todo, 7_983);
  requireEqual("message pages", inventory.byKind.message, 213);
  requireEqual("chats", inventory.byKind.campfire, 214);
  if (inventory.unclassified.length > 0) {
    failures.push(`${inventory.unclassified.length} entries are unclassified`);
  }
  if (inventory.unknownProjectIds.length > 0) {
    failures.push(
      `${inventory.unknownProjectIds.length} project folders are absent from the index`,
    );
  }
  if (inventory.missingProjectFolders.length > 0) {
    failures.push(
      `${inventory.missingProjectFolders.length} indexed projects have no folder`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Production inventory validation failed:\n- ${failures.join("\n- ")}`);
  }
}
