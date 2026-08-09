import path from "node:path";

import { lookup as mimeLookup } from "mime-types";

import { sourceUuid, stableUuid } from "./identity.mjs";
import {
  parseOfficialPage,
  parsePeoplePage,
  parseReferencedPeople,
} from "./parser.mjs";

const PARSEABLE_PAGE_KINDS = new Set([
  "campfire",
  "card",
  "card_column",
  "card_table",
  "dropbox_file",
  "external_service_file",
  "forward_inbox",
  "forwarded_email",
  "message",
  "message_board",
  "questionnaire",
  "schedule",
  "schedule_entry",
  "todo",
  "todo_list",
  "todo_set",
  "vault_record",
]);

function normalizedEmail(person, accountId) {
  const email = String(person.email ?? "").trim().toLowerCase();
  return email.includes("@")
    ? email
    : `basecamp-${accountId}-${person.id}@invalid.local`;
}

function projectClient(name) {
  const separator = name.indexOf("-");
  if (separator < 1) return null;
  const prefix = name.slice(0, separator).trim();
  const candidate = name.slice(separator + 1).trim();
  return prefix.length <= 12 && candidate ? candidate : null;
}

function clipped(value, maximum, fallback = "") {
  const normalized = String(value ?? "").trim() || fallback;
  return normalized.slice(0, maximum);
}

function slug(value, fallback) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 180).replace(/-+$/g, "");
}

function canonicalIdentityKey(entityType, sourceProjectId, sourceId) {
  return `${entityType}:${sourceProjectId}:${sourceId}`;
}

function canonicalId({
  identity,
  organizationId,
  accountId,
  entityType,
  sourceProjectId,
  sourceId,
}) {
  const key = canonicalIdentityKey(entityType, sourceProjectId, sourceId);
  return (
    identity.canonicalIds?.get(key) ??
    sourceUuid({
      organizationId,
      accountId,
      entityType,
      sourceId: `${sourceProjectId}:${sourceId}`,
    })
  );
}

function profileId(identity, organizationId, accountId, sourceId) {
  return (
    identity.profileIds?.get(String(sourceId)) ??
    sourceUuid({
      organizationId,
      accountId,
      entityType: "profile",
      sourceId,
    })
  );
}

function hasExistingCanonical(identity, entityType, sourceProjectId, sourceId) {
  return Boolean(
    identity.existingCanonical?.has(
      canonicalIdentityKey(entityType, sourceProjectId, sourceId),
    ),
  );
}

function recordId(runId, sourceProjectId, record, occurrenceDate = null) {
  const identity = record.recordingId
    ? `recording:${record.recordingId}:${occurrenceDate ?? ""}`
    : `source:${record.sourcePath}:${record.recordType}:${record.ordinal ?? 0}`;
  return stableUuid("basecamp-archive-record", runId, sourceProjectId, identity);
}

function parentRecordId(runId, sourceProjectId, record, occurrenceDate) {
  if (
    !record.parentRecordingId ||
    !["comment", "campfire_line"].includes(record.recordType)
  ) {
    return null;
  }
  return stableUuid(
    "basecamp-archive-record",
    runId,
    sourceProjectId,
    `recording:${record.parentRecordingId}:${occurrenceDate ?? ""}`,
  );
}

function recordRow({
  runId,
  projectId,
  sourceProjectId,
  record,
  occurrenceDate,
  exportedAt,
}) {
  const id = recordId(runId, sourceProjectId, record, occurrenceDate);
  const sourceLocator = `${record.sourcePath}#${
    record.recordingId ?? record.syntheticKey ?? `${record.recordType}:${record.ordinal ?? 0}`
  }`;
  return {
    id,
    run_id: runId,
    project_id: projectId,
    parent_id: parentRecordId(
      runId,
      sourceProjectId,
      record,
      record.recordType === "comment" || record.recordType === "campfire_line"
        ? occurrenceDate
        : null,
    ),
    record_type: record.recordType,
    native_recording_id: record.recordingId
      ? Number(record.recordingId)
      : null,
    native_creator_id: record.creatorId ? Number(record.creatorId) : null,
    source_locator: sourceLocator,
    source_path: record.sourcePath,
    title: record.title,
    sanitized_html: record.bodyHtml,
    plain_text: record.bodyText,
    source_created_at: record.sourceCreatedAt,
    source_updated_at: record.sourceUpdatedAt,
    source_exported_at: exportedAt,
    source_status: record.status,
    metadata: {
      ...(record.metadata ?? {}),
      assignee_ids: record.assigneeIds ?? [],
      child_links: record.children ?? [],
      completed_at: record.completedAt,
      due_on: record.dueOn,
      parent_archive_path: record.parentArchivePath ?? null,
      synthetic_key: record.syntheticKey ?? null,
      source_ordinal: record.ordinal ?? 0,
    },
  };
}

function archiveLinkRow({
  runId,
  recordId: targetRecordId,
  entryId,
  role,
  ordinal,
  sourceLocator,
}) {
  return {
    id: stableUuid(
      "basecamp-record-entry",
      runId,
      targetRecordId,
      role,
      ordinal,
      sourceLocator,
    ),
    record_id: targetRecordId,
    entry_id: entryId,
    reference_role: role,
    ordinal,
    source_locator: `${sourceLocator}#${role}:${ordinal}`,
  };
}

function canonicalEntityType(record, parentTarget = null) {
  if (record.recordType === "todo_list") return "todo_lists";
  if (record.recordType === "todo") return "todos";
  if (record.recordType === "message") return "messages";
  if (record.recordType === "document") return "docs";
  if (record.recordType === "comment" && parentTarget) return "comments";
  if (record.recordType === "campfire_line") return "chat_messages";
  return null;
}

function canonicalPayload({
  runId,
  identity,
  organizationId,
  accountId,
  projectId,
  sourceProjectId,
  archiveRecord,
  record,
  occurrenceDate,
  exportedAt,
  parentTarget,
}) {
  const entityType = canonicalEntityType(record, parentTarget);
  if (!entityType) return null;
  const nativeId =
    record.recordingId ??
    record.syntheticKey ??
    `${record.sourcePath}:${record.ordinal ?? 0}`;
  const canonicalSourceId = occurrenceDate
    ? `${nativeId}:${occurrenceDate}`
    : nativeId;
  const id = canonicalId({
    identity,
    organizationId,
    accountId,
    entityType,
    sourceProjectId,
    sourceId: canonicalSourceId,
  });
  const creatorId = record.creatorId
    ? profileId(identity, organizationId, accountId, record.creatorId)
    : null;
  const importedPayload = {
    archive_record_id: archiveRecord.id,
    html: record.bodyHtml,
    metadata: record.metadata ?? {},
    occurrence_date: occurrenceDate,
    source_status: record.status,
  };
  const sourceCreatedAt = record.sourceCreatedAt ?? exportedAt;
  const sourceUpdatedAt = record.sourceUpdatedAt ?? sourceCreatedAt;
  let payload;
  if (entityType === "todo_lists") {
    payload = {
      id,
      project_id: projectId,
      title: clipped(record.title, 120, "Basecamp to-do list"),
      description: record.bodyText || null,
      position: record.ordinal ?? 0,
      is_archived: record.status === "completed",
      created_by: creatorId,
      basecamp_todolist_id: record.recordingId
        ? Number(record.recordingId)
        : null,
      basecamp_payload: importedPayload,
      source_created_at: record.sourceCreatedAt,
      source_updated_at: record.sourceUpdatedAt,
      source_exported_at: exportedAt,
      source_path: record.sourcePath,
      created_at: sourceCreatedAt,
      updated_at: sourceUpdatedAt,
    };
  } else if (entityType === "todos") {
    const parentSourceId =
      record.metadata?.parent_entry_kind === "todo_set"
        ? `unfiled:${record.parentRecordingId}`
        : record.parentRecordingId;
    payload = {
      id,
      project_id: projectId,
      todo_list_id: canonicalId({
        identity,
        organizationId,
        accountId,
        entityType: "todo_lists",
        sourceProjectId,
        sourceId: parentSourceId,
      }),
      title: clipped(record.title, 300, "Basecamp to-do"),
      description: record.bodyText || null,
      status: record.completedAt || record.status === "completed" ? "done" : "todo",
      priority: "medium",
      assigned_to: record.assigneeIds?.[0]
        ? profileId(
            identity,
            organizationId,
            accountId,
            record.assigneeIds[0],
          )
        : null,
      created_by: creatorId,
      due_at: record.dueOn,
      completed_at: record.completedAt,
      position: record.ordinal ?? 0,
      labels: [],
      basecamp_todo_id: Number(record.recordingId),
      basecamp_creator_id: record.creatorId ? Number(record.creatorId) : null,
      basecamp_payload: importedPayload,
      source_created_at: record.sourceCreatedAt,
      source_updated_at: record.sourceUpdatedAt,
      source_exported_at: exportedAt,
      source_path: record.sourcePath,
      created_at: sourceCreatedAt,
      updated_at: sourceUpdatedAt,
    };
  } else if (entityType === "messages") {
    payload = {
      id,
      project_id: projectId,
      sender_id: creatorId,
      direction: "internal",
      channel: "internal",
      subject: clipped(record.title, 300) || null,
      body: record.bodyText || record.title || "Basecamp message",
      status: "sent",
      external_id: `basecamp:${accountId}:${record.recordingId}`,
      recipient_emails: [],
      sent_at: record.sourceCreatedAt,
      metadata: importedPayload,
      basecamp_message_id: Number(record.recordingId),
      basecamp_creator_id: record.creatorId ? Number(record.creatorId) : null,
      basecamp_payload: importedPayload,
      source_created_at: record.sourceCreatedAt,
      source_updated_at: record.sourceUpdatedAt,
      source_exported_at: exportedAt,
      source_path: record.sourcePath,
      created_at: sourceCreatedAt,
      updated_at: sourceUpdatedAt,
    };
  } else if (entityType === "docs") {
    payload = {
      id,
      project_id: projectId,
      title: clipped(record.title, 200, "Basecamp document"),
      slug: slug(
        `${record.title}-${record.recordingId}`,
        `basecamp-${record.recordingId}`,
      ),
      content: { html: record.bodyHtml },
      plain_text: record.bodyText,
      status: "published",
      version: 1,
      created_by: creatorId,
      updated_by: creatorId,
      published_at: sourceCreatedAt,
      basecamp_document_id: Number(record.recordingId),
      basecamp_payload: importedPayload,
      source_created_at: record.sourceCreatedAt,
      source_updated_at: record.sourceUpdatedAt,
      source_exported_at: exportedAt,
      source_path: record.sourcePath,
      created_at: sourceCreatedAt,
      updated_at: sourceUpdatedAt,
    };
  } else if (entityType === "comments") {
    payload = {
      id,
      project_id: projectId,
      todo_id: parentTarget.entityType === "todos" ? parentTarget.id : null,
      doc_id: parentTarget.entityType === "docs" ? parentTarget.id : null,
      parent_comment_id:
        parentTarget.entityType === "comments" ? parentTarget.id : null,
      author_id: creatorId,
      body: record.bodyText || record.title || "Basecamp comment",
      is_edited: false,
      metadata: {
        ...importedPayload,
        message_id:
          parentTarget.entityType === "messages" ? parentTarget.id : null,
      },
      basecamp_comment_id: Number(record.recordingId),
      basecamp_recording_id: Number(record.parentRecordingId),
      basecamp_creator_id: record.creatorId ? Number(record.creatorId) : null,
      basecamp_payload: importedPayload,
      source_created_at: record.sourceCreatedAt,
      source_updated_at: record.sourceUpdatedAt,
      source_exported_at: exportedAt,
      source_path: record.sourcePath,
      created_at: sourceCreatedAt,
      updated_at: sourceUpdatedAt,
    };
  } else {
    payload = {
      id,
      project_id: projectId,
      conversation_id: stableUuid(
        "basecamp-campfire-conversation",
        organizationId,
        accountId,
        sourceProjectId,
        record.parentRecordingId,
      ),
      profile_id: creatorId,
      role: "user",
      content: record.bodyText || "Basecamp campfire message",
      tool_calls: [],
      metadata: importedPayload,
      basecamp_account_id: Number(accountId),
      basecamp_chat_id: Number(record.parentRecordingId),
      basecamp_message_id: record.recordingId
        ? Number(record.recordingId)
        : null,
      basecamp_creator_id: record.creatorId ? Number(record.creatorId) : null,
      source_locator: archiveRecord.source_locator,
      source_path: record.sourcePath,
      source_ordinal: record.ordinal ?? 0,
      source_created_at: record.sourceCreatedAt,
      source_updated_at: record.sourceUpdatedAt,
      source_exported_at: exportedAt,
      basecamp_payload: importedPayload,
      created_at: sourceCreatedAt,
      updated_at: sourceUpdatedAt,
    };
  }
  if (
    hasExistingCanonical(
      identity,
      entityType,
      sourceProjectId,
      canonicalSourceId,
    )
  ) {
    payload._conflict = {
      strategy: "preserve_local",
      reason: "Existing canonical Basecamp row may contain local edits.",
    };
  }
  return {
    run_id: runId,
    project_id: projectId,
    entity_type: entityType,
    source_key: String(canonicalSourceId),
    payload,
  };
}

class BatchEmitter {
  constructor(onBatch, batchSize) {
    this.onBatch = onBatch;
    this.batchSize = batchSize;
    this.buffers = new Map();
    this.counts = {};
  }

  async add(kind, row) {
    const buffer = this.buffers.get(kind) ?? [];
    if (
      kind === "archive_record_entry" &&
      buffer.length + 1 >= this.batchSize
    ) {
      await this.flush("archive_record");
    }
    buffer.push(row);
    this.buffers.set(kind, buffer);
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    if (buffer.length >= this.batchSize) {
      await this.flush(kind);
    }
  }

  async flush(kind) {
    const rows = this.buffers.get(kind);
    if (!rows?.length) return;
    this.buffers.set(kind, []);
    await this.onBatch(kind, rows);
  }

  async flushAll() {
    for (const kind of this.buffers.keys()) {
      await this.flush(kind);
    }
  }
}

function mergePerson(people, candidate) {
  const current = people.get(candidate.id);
  const candidateIsPlaceholder = candidate.name.startsWith("Basecamp person ");
  const currentIsPlaceholder = current?.name.startsWith("Basecamp person ");
  if (!current || (currentIsPlaceholder && !candidateIsPlaceholder)) {
    people.set(candidate.id, candidate);
    return;
  }
  if (!current.email && candidate.email) {
    people.set(candidate.id, { ...current, email: candidate.email });
  }
}

function entryOrder(entry) {
  const rank = {
    people: 1,
    todo_set: 10,
    message_board: 10,
    card_table: 10,
    forward_inbox: 10,
    schedule: 10,
    todo_list: 20,
    card_column: 20,
    todo: 30,
    card: 30,
    message: 30,
    forwarded_email: 30,
    schedule_entry: 30,
  }[entry.entryKind];
  return rank ?? (PARSEABLE_PAGE_KINDS.has(entry.entryKind) ? 25 : 0);
}

export async function collectBasecampPeople({ archive, projectFilter = null }) {
  const people = new Map();
  for (const entry of archive.entries) {
    if (entry.entryKind === "avatar" && entry.sourceId) {
      mergePerson(people, {
        id: entry.sourceId,
        name: `Basecamp person ${entry.sourceId}`,
        email: null,
        metadata: "",
      });
    }
    if (
      entry.projectId &&
      projectFilter &&
      entry.projectId !== projectFilter
    ) {
      continue;
    }
    if (
      entry.entryKind !== "people" &&
      !PARSEABLE_PAGE_KINDS.has(entry.entryKind)
    ) {
      continue;
    }
    const html = (
      await archive.readBuffer(entry, 32 * 1024 * 1024)
    ).toString("utf8");
    if (entry.entryKind === "people") {
      for (const person of parsePeoplePage(html)) mergePerson(people, person);
    }
    for (const person of parseReferencedPeople(html)) mergePerson(people, person);
  }
  return people;
}

export async function scanBasecampMetadata({
  archive,
  exportIndex,
  runId,
  organizationId,
  projectFilter = null,
  projectLimit = null,
  batchSize = 250,
  identity = {},
  peopleCatalog = null,
  onBatch = async () => undefined,
}) {
  const accountId = exportIndex.accountId;
  const emitter = new BatchEmitter(onBatch, batchSize);
  const unresolved = new Set();
  const orphanCanonicalRecords = [];
  const fallbackTodoLists = new Set();
  const people = peopleCatalog ? new Map(peopleCatalog) : new Map();
  const memberships = new Map();
  const stageCounts = new Map();
  const canonicalTargets = new Map();
  const todoListTitles = new Set();
  const entriesByPath = new Map(
    archive.entries.map((entry) => [
      entry.fileName,
      {
        ...entry,
        id: stableUuid("basecamp-archive-entry", runId, entry.fileName),
      },
    ]),
  );
  const selectedProjects = exportIndex.projects
    .filter((project) => !projectFilter || project.projectId === projectFilter)
    .slice(0, projectLimit ?? undefined);
  if (projectFilter && selectedProjects.length !== 1) {
    throw new Error(`Basecamp project ${projectFilter} is absent from the export.`);
  }
  const projectsBySourceId = new Map(
    selectedProjects.map((project) => [
      project.projectId,
      {
        ...project,
        id:
          identity.projectIds?.get(project.projectId) ??
          sourceUuid({
            organizationId,
            accountId,
            entityType: "projects",
            sourceId: project.projectId,
          }),
      },
    ]),
  );

  async function addStage(row) {
    const key = `${row.project_id}:${row.entity_type}`;
    stageCounts.set(key, (stageCounts.get(key) ?? 0) + 1);
    await emitter.add("stage", row);
  }

  for (const project of projectsBySourceId.values()) {
    await emitter.add("project_status", {
      run_id: runId,
      project_id: project.id,
      source_project_id: Number(project.projectId),
      is_read_only: project.status === "archived",
      status: "staging",
      expected_counts: {},
      staged_counts: {},
      summary: { source_status: project.status },
    });
  }
  await emitter.flush("project_status");

  for (const project of projectsBySourceId.values()) {
    const payload = {
      id: project.id,
      organization_id: organizationId,
      name: clipped(project.name, 160, `Basecamp ${project.projectId}`),
      code: `BC-${project.projectId}`.slice(0, 32),
      client_name: projectClient(project.name),
      description: "Imported from the official Basecamp full export.",
      status: project.status === "active" ? "active" : "completed",
      priority: "medium",
      currency: "USD",
      metadata: { source_system: "basecamp" },
      archived_at:
        project.status === "archived" ? exportIndex.exportedAt : null,
      basecamp_account_id: Number(accountId),
      basecamp_project_id: Number(project.projectId),
      basecamp_payload: {
        archive_status: project.status,
        export_run_id: runId,
      },
      is_read_only: project.status === "archived",
      source_exported_at: exportIndex.exportedAt,
      imported_at: exportIndex.exportedAt,
      created_at: exportIndex.exportedAt,
      updated_at: exportIndex.exportedAt,
    };
    if (identity.existingProjects?.has(project.projectId)) {
      payload._conflict = {
        strategy: "preserve_local",
        reason: "Existing project matched by Basecamp project ID.",
      };
    }
    await addStage({
      run_id: runId,
      project_id: project.id,
      entity_type: "projects",
      source_key: project.projectId,
      payload,
    });
  }

  const selectedEntries = archive.entries
    .filter((entry) => !entry.projectId || projectsBySourceId.has(entry.projectId))
    .map((entry, index) => ({ ...entry, manifestOrdinal: index }))
    .toSorted(
      (left, right) =>
        entryOrder(left) - entryOrder(right) ||
        left.fileName.localeCompare(right.fileName),
    );
  for (const entry of selectedEntries) {
    if (entry.entryKind === "avatar" && entry.sourceId && !peopleCatalog) {
      mergePerson(people, {
        id: entry.sourceId,
        name: `Basecamp person ${entry.sourceId}`,
        email: null,
        metadata: "",
      });
    }

    if (entry.entryKind === "attachment" && entry.projectId) {
      const project = projectsBySourceId.get(entry.projectId);
      if (project?.status === "active") {
        const sourceFileId = entry.sourceId ?? entry.fileName;
        const logicalFileId = canonicalId({
          identity,
          organizationId,
          accountId,
          entityType: "files",
          sourceProjectId: entry.projectId,
          sourceId: sourceFileId,
        });
        const payload = {
          id: logicalFileId,
          project_id: project.id,
          blob_id: null,
          bucket_id: null,
          object_path: null,
          file_name: clipped(entry.originalName, 1024, "Basecamp file"),
          mime_type:
            mimeLookup(path.posix.extname(entry.originalName)) ||
            "application/octet-stream",
          size_bytes: entry.sizeBytes,
          checksum_sha256: null,
          metadata: {
            archive_entry_id: entriesByPath.get(entry.fileName).id,
          },
          source_system: "basecamp",
          source_account_id: String(accountId),
          source_file_id: String(sourceFileId),
          source_path: entry.fileName,
          source_crc32: entry.crc32,
          source_payload: {
            archive_entry_id: entriesByPath.get(entry.fileName).id,
          },
          availability_status: "pending",
          listing_position: entry.manifestOrdinal,
          basecamp_account_id: Number(accountId),
          basecamp_upload_id: entry.sourceId ? Number(entry.sourceId) : null,
          source_exported_at: exportIndex.exportedAt,
          created_at: exportIndex.exportedAt,
          updated_at: exportIndex.exportedAt,
        };
        if (
          hasExistingCanonical(
            identity,
            "files",
            entry.projectId,
            sourceFileId,
          )
        ) {
          payload._conflict = {
            strategy: "preserve_local",
            reason: "Existing logical file matched by Basecamp upload ID.",
          };
        }
        await addStage({
          run_id: runId,
          project_id: project.id,
          entity_type: "files",
          source_key: entry.fileName,
          payload,
        });
      }
    }

    if (entry.entryKind === "people") {
      const html = (await archive.readBuffer(entry)).toString("utf8");
      const projectPeople = parsePeoplePage(html);
      for (const person of projectPeople) {
        if (!peopleCatalog) mergePerson(people, person);
        const project = projectsBySourceId.get(entry.projectId);
        if (project?.status === "active") {
          memberships.set(`${entry.projectId}:${person.id}`, {
            project,
            personId: person.id,
          });
        }
      }
      if (!peopleCatalog) {
        for (const person of parseReferencedPeople(html)) {
          mergePerson(people, person);
        }
      }
      continue;
    }

    if (!PARSEABLE_PAGE_KINDS.has(entry.entryKind)) continue;
    const html = (await archive.readBuffer(entry, 32 * 1024 * 1024)).toString(
      "utf8",
    );
    if (!peopleCatalog) {
      for (const person of parseReferencedPeople(html)) mergePerson(people, person);
    }
    const parsed = parseOfficialPage(entry, html, {
      entryIdForPath(targetPath) {
        const target = entriesByPath.get(targetPath);
        if (!target) unresolved.add(`${entry.fileName} -> ${targetPath}`);
        return target?.id;
      },
    });
    const project = projectsBySourceId.get(entry.projectId);
    if (!project) continue;
    const records = [
      parsed.record,
      ...parsed.comments,
      ...parsed.campfireLines,
    ];

    for (const record of records) {
      const archiveRecord = recordRow({
        runId,
        projectId: project.id,
        sourceProjectId: entry.projectId,
        record,
        occurrenceDate: entry.occurrenceDate,
        exportedAt: exportIndex.exportedAt,
      });
      await emitter.add("archive_record", archiveRecord);
      const sourceEntry = entriesByPath.get(entry.fileName);
      await emitter.add(
        "archive_record_entry",
        archiveLinkRow({
          runId,
          recordId: archiveRecord.id,
          entryId: sourceEntry.id,
          role: "source_html",
          ordinal: 0,
          sourceLocator: entry.fileName,
        }),
      );

      const parentTarget = record.parentRecordingId
        ? canonicalTargets.get(
            `${entry.projectId}:${record.parentRecordingId}`,
          ) ?? null
        : null;
      let canonical = null;
      if (project.status === "active") {
        if (
          record.recordType === "todo" &&
          record.metadata?.parent_entry_kind === "todo_set" &&
          record.parentRecordingId
        ) {
          const fallbackSourceId = `unfiled:${record.parentRecordingId}`;
          const fallbackKey = `${entry.projectId}:${fallbackSourceId}`;
          if (!fallbackTodoLists.has(fallbackKey)) {
            fallbackTodoLists.add(fallbackKey);
            await addStage({
              run_id: runId,
              project_id: project.id,
              entity_type: "todo_lists",
              source_key: fallbackSourceId,
              payload: {
                id: canonicalId({
                  identity,
                  organizationId,
                  accountId,
                  entityType: "todo_lists",
                  sourceProjectId: entry.projectId,
                  sourceId: fallbackSourceId,
                }),
                project_id: project.id,
                title: "Unfiled Basecamp todos",
                description:
                  "Synthetic list for todos exported directly under a Basecamp todo set.",
                position: 0,
                is_archived: false,
                basecamp_todolist_id: null,
                basecamp_payload: {
                  synthetic: true,
                  source_todo_set_id: record.parentRecordingId,
                },
                source_exported_at: exportIndex.exportedAt,
                created_at: exportIndex.exportedAt,
                updated_at: exportIndex.exportedAt,
              },
            });
          }
        }
        let canonicalRecord = record;
        if (record.recordType === "todo_list") {
          const baseTitle = clipped(
            record.title,
            120,
            "Basecamp to-do list",
          );
          const titleKey = `${project.id}:${baseTitle}`;
          const uniqueTitle = todoListTitles.has(titleKey)
            ? clipped(
                `${baseTitle} · ${record.recordingId ?? archiveRecord.id}`,
                120,
              )
            : baseTitle;
          todoListTitles.add(titleKey);
          todoListTitles.add(`${project.id}:${uniqueTitle}`);
          canonicalRecord = { ...record, title: uniqueTitle };
        }
        canonical = canonicalPayload({
          runId,
          identity,
          organizationId,
          accountId,
          projectId: project.id,
          sourceProjectId: entry.projectId,
          archiveRecord,
          record: canonicalRecord,
          occurrenceDate: entry.occurrenceDate,
          exportedAt: exportIndex.exportedAt,
          parentTarget,
        });
        if (record.recordType === "todo" && !record.parentRecordingId) {
          orphanCanonicalRecords.push(
            `${entry.fileName}:todos:${record.recordingId}`,
          );
        }
        if (canonical) {
          await addStage(canonical);
          if (record.recordingId) {
            canonicalTargets.set(`${entry.projectId}:${record.recordingId}`, {
              entityType: canonical.entity_type,
              id: canonical.payload.id,
            });
          }
          if (canonical.entity_type === "todos") {
            for (const assigneeId of record.assigneeIds ?? []) {
              const targetProfileId = profileId(
                identity,
                organizationId,
                accountId,
                assigneeId,
              );
              await addStage({
                run_id: runId,
                project_id: project.id,
                entity_type: "todo_assignees",
                source_key: `${canonical.payload.id}:${targetProfileId}`,
                payload: {
                  todo_id: canonical.payload.id,
                  profile_id: targetProfileId,
                  source: "basecamp",
                  source_payload: { source_person_id: assigneeId },
                  _conflict: {
                    strategy: "preserve_local",
                    reason: "Preserve any existing assignment metadata.",
                  },
                },
              });
            }
          }
        }
      }

      for (const reference of record.references ?? []) {
        const target = entriesByPath.get(reference.archivePath);
        if (!target) {
          unresolved.add(`${entry.fileName} -> ${reference.archivePath}`);
          continue;
        }
        await emitter.add(
          "archive_record_entry",
          archiveLinkRow({
            runId,
            recordId: archiveRecord.id,
            entryId: target.id,
            role: reference.kind,
            ordinal: reference.ordinal,
            sourceLocator: reference.archivePath,
          }),
        );
        if (project.status !== "active" || target.entryKind !== "attachment") {
          continue;
        }
        const sourceFileId = target.sourceId ?? target.fileName;
        const fileId = canonicalId({
          identity,
          organizationId,
          accountId,
          entityType: "files",
          sourceProjectId: entry.projectId,
          sourceId: sourceFileId,
        });
        const targetColumn = {
          todos: "todo_id",
          comments: "comment_id",
          docs: "doc_id",
          messages: "message_id",
          chat_messages: "chat_message_id",
        }[canonical?.entity_type];
        await addStage({
          run_id: runId,
          project_id: project.id,
          entity_type: "file_references",
          source_key: `${archiveRecord.id}:${reference.kind}:${reference.ordinal}:${target.fileName}`,
          payload: {
            id: stableUuid(
              "basecamp-file-reference",
              runId,
              archiveRecord.id,
              reference.kind,
              reference.ordinal,
              target.fileName,
            ),
            project_id: project.id,
            file_id: fileId,
            todo_id: targetColumn === "todo_id" ? canonical.payload.id : null,
            comment_id:
              targetColumn === "comment_id" ? canonical.payload.id : null,
            doc_id: targetColumn === "doc_id" ? canonical.payload.id : null,
            message_id:
              targetColumn === "message_id" ? canonical.payload.id : null,
            chat_message_id:
              targetColumn === "chat_message_id" ? canonical.payload.id : null,
            archive_record_id: targetColumn ? null : archiveRecord.id,
            reference_role: reference.kind,
            ordinal: reference.ordinal,
            payload: {
              source_locator: reference.archivePath,
              title: reference.title,
            },
          },
        });
      }
    }
  }

  for (const person of people.values()) {
    await emitter.add("profile", {
      id: profileId(identity, organizationId, accountId, person.id),
      organization_id: organizationId,
      email: normalizedEmail(person, accountId),
      full_name: clipped(person.name, 200, `Basecamp person ${person.id}`),
      role: "viewer",
      status: "deactivated",
      basecamp_account_id: Number(accountId),
      basecamp_person_id: Number(person.id),
      person_type: "Person",
      source_payload: {
        metadata: person.metadata,
        imported_from_official_export: true,
      },
    });
  }

  for (const membership of memberships.values()) {
    const targetProfileId = profileId(
      identity,
      organizationId,
      accountId,
      membership.personId,
    );
    await addStage({
      run_id: runId,
      project_id: membership.project.id,
      entity_type: "project_members",
      source_key: membership.personId,
      payload: {
        project_id: membership.project.id,
        profile_id: targetProfileId,
        role: "member",
        source: "basecamp",
        source_payload: { source_person_id: membership.personId },
        _conflict: {
          strategy: "preserve_local",
          reason: "Preserve existing project membership roles.",
        },
      },
    });
  }

  await emitter.flushAll();
  for (const project of projectsBySourceId.values()) {
    const expectedCounts = Object.fromEntries(
      [...stageCounts.entries()]
        .filter(([key]) => key.startsWith(`${project.id}:`))
        .map(([key, count]) => [key.slice(project.id.length + 1), count]),
    );
    await emitter.add("project_status", {
      run_id: runId,
      project_id: project.id,
      source_project_id: Number(project.projectId),
      is_read_only: project.status === "archived",
      status: "ready",
      expected_counts: expectedCounts,
      staged_counts: expectedCounts,
      summary: { source_status: project.status },
    });
  }
  await emitter.flushAll();
  return {
    counts: {
      ...emitter.counts,
      project_status: selectedProjects.length,
    },
    people: people.size,
    orphanCanonicalRecords,
    unresolvedReferences: [...unresolved].sort(),
    selectedProjects: selectedProjects.length,
    stageCounts: Object.fromEntries(stageCounts),
  };
}
