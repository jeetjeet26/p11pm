import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const ACCOUNT_ID = 5_548_255;
const BATCH_SIZE = 50;
const DEFAULT_EXPORT_PATH = "data/basecamp/basecamp_export.json";
const dryRun = process.argv.includes("--dry-run");

function stableUuid(scope, value) {
  const bytes = Buffer.from(
    createHash("sha256").update(`${scope}:${value}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function chunks(rows) {
  const result = [];
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    result.push(rows.slice(index, index + BATCH_SIZE));
  }
  return result;
}

async function readAll(
  client,
  table,
  columns,
  equals = {},
  orderColumn = "id",
) {
  const rows = [];
  for (let from = 0; ; from += 1_000) {
    let query = client
      .from(table)
      .select(columns)
      .order(orderColumn)
      .range(from, from + 999);
    for (const [column, value] of Object.entries(equals)) {
      query = query.eq(column, value);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Unable to read ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1_000) break;
  }
  return rows;
}

async function stageBatches(client, runId, entityType, rows, sourceKey) {
  if (dryRun) return;

  const preparedBatches = chunks(rows).map((batch, batchIndex) => {
    const stagedRows = batch.map((payload) => ({
      entity_type: entityType,
      payload,
      run_id: runId,
      source_key: sourceKey(payload),
    }));
    return {
      batchIndex,
      contentSha256: createHash("sha256")
        .update(JSON.stringify(stagedRows))
        .digest("hex"),
      stagedRows,
    };
  });
  const { data: storedCheckpoints, error: checkpointReadError } = await client
    .from("basecamp_import_checkpoints")
    .select("batch_number,row_count,content_sha256")
    .eq("run_id", runId)
    .eq("entity_type", entityType)
    .order("batch_number");
  if (checkpointReadError) throw checkpointReadError;
  const storedStage = await readAll(
    client,
    "basecamp_import_stage",
    "source_key",
    { entity_type: entityType, run_id: runId },
    "source_key",
  );

  let checkpointByBatch = new Map(
    (storedCheckpoints ?? []).map((checkpoint) => [
      checkpoint.batch_number,
      checkpoint,
    ]),
  );
  const expectedSourceKeys = new Set(
    rows.map((payload) => String(sourceKey(payload))),
  );
  const stagedSourceKeys = new Set(
    (storedStage ?? []).map((stage) => stage.source_key),
  );
  const staleCheckpoint = (storedCheckpoints ?? []).some((checkpoint) => {
    const prepared = preparedBatches[checkpoint.batch_number];
    return (
      !prepared ||
      checkpoint.row_count !== prepared.stagedRows.length ||
      checkpoint.content_sha256 !== prepared.contentSha256 ||
      prepared.stagedRows.some(
        (stage) => !stagedSourceKeys.has(String(stage.source_key)),
      )
    );
  });
  const staleStage = [...stagedSourceKeys].some(
    (key) => !expectedSourceKeys.has(key),
  );
  if (staleCheckpoint || staleStage) {
    const { error: stageDeleteError } = await client
      .from("basecamp_import_stage")
      .delete()
      .eq("run_id", runId)
      .eq("entity_type", entityType);
    if (stageDeleteError) throw stageDeleteError;
    const { error: checkpointDeleteError } = await client
      .from("basecamp_import_checkpoints")
      .delete()
      .eq("run_id", runId)
      .eq("entity_type", entityType);
    if (checkpointDeleteError) throw checkpointDeleteError;
    checkpointByBatch = new Map();
  }

  for (const {
    batchIndex,
    contentSha256,
    stagedRows,
  } of preparedBatches) {
    if (checkpointByBatch.has(batchIndex)) {
      continue;
    }

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { error: stageError } = await client
          .from("basecamp_import_stage")
          .upsert(stagedRows, {
            onConflict: "run_id,entity_type,source_key",
          });
        if (stageError) throw stageError;
        const { error: checkpointError } = await client
          .from("basecamp_import_checkpoints")
          .upsert(
            {
              batch_number: batchIndex,
              content_sha256: contentSha256,
              entity_type: entityType,
              row_count: stagedRows.length,
              run_id: runId,
            },
            { onConflict: "run_id,entity_type,batch_number" },
          );
        if (checkpointError) throw checkpointError;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolveDelay) =>
            setTimeout(resolveDelay, attempt * 500),
          );
        }
      }
    }
    if (lastError) {
      const message =
        lastError &&
        typeof lastError === "object" &&
        "message" in lastError
          ? lastError.message
          : String(lastError);
      throw new Error(
        `Unable to stage ${entityType} batch ${batchIndex + 1}: ${message}`,
      );
    }
  }
}

function normalizeEmail(person) {
  const email =
    typeof person.email === "string" ? person.email.trim().toLowerCase() : "";
  return email.includes("@")
    ? email
    : `basecamp-${person.id}@invalid.local`;
}

function isInternalEmail(email) {
  return email.endsWith("@p11.com") || email.endsWith("@p11creative.com");
}

function projectClient(name) {
  const separator = name.indexOf("-");
  if (separator < 1) return null;
  const prefix = name.slice(0, separator).trim();
  const candidate = name.slice(separator + 1).trim();
  return prefix.length <= 12 && candidate ? candidate : null;
}

function slugify(value, suffix) {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "basecamp-document"}-${suffix}`;
}

function uniqueTitle(used, parentId, title, externalId, maxLength) {
  const normalized = title.trim() || `Basecamp ${externalId}`;
  const base = normalized.slice(0, maxLength);
  const key = `${parentId}:${base.toLowerCase()}`;
  if (!used.has(key)) {
    used.add(key);
    return base;
  }
  const suffix = ` (${externalId})`;
  const unique = `${base.slice(0, maxLength - suffix.length)}${suffix}`;
  used.add(`${parentId}:${unique.toLowerCase()}`);
  return unique;
}

function preferPerson(current, candidate) {
  if (!current) return candidate;
  const currentInternal = isInternalEmail(normalizeEmail(current));
  const candidateInternal = isInternalEmail(normalizeEmail(candidate));
  return candidateInternal && !currentInternal ? candidate : current;
}

function validateExport(data) {
  const expected = {
    people: 113,
    projects: 30,
    project_memberships: 487,
    todolists: 142,
    todos: 619,
    documents: 2,
    comments: 56,
    messages: 0,
  };
  for (const [key, count] of Object.entries(expected)) {
    if (!Array.isArray(data[key]) || data[key].length !== count) {
      throw new Error(
        `Basecamp export validation failed for ${key}: expected ${count}, received ${data[key]?.length ?? "missing"}.`,
      );
    }
  }
  const detailedTodoIds = new Set(data.todos.map((todo) => todo.id));
  if (detailedTodoIds.size !== data.todos.length) {
    throw new Error("Basecamp export contains duplicate detailed todo IDs.");
  }
  return expected;
}

function assertUnique(rows, keyOf, label) {
  const seen = new Set();
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) {
      throw new Error(`Prepared ${label} contains duplicate key ${key}.`);
    }
    seen.add(key);
  }
}

function mentionProfileIds(content, profiles) {
  const lowerContent = content.toLowerCase();
  const tokens = new Map();
  for (const profile of profiles) {
    const names = [
      profile.full_name,
      profile.full_name.split(/\s+/)[0],
    ].filter(Boolean);
    for (const name of names) {
      const token = name.toLowerCase();
      if (!tokens.has(token)) tokens.set(token, profile.id);
      else if (tokens.get(token) !== profile.id) tokens.set(token, null);
    }
  }
  return [
    ...new Set(
      [...tokens.entries()].flatMap(([token, profileId]) =>
        profileId && lowerContent.includes(`@${token}`)
          ? [profileId]
          : [],
      ),
    ),
  ];
}

async function main() {
  const exportPath = resolve(
    process.env.BASECAMP_EXPORT_PATH ?? DEFAULT_EXPORT_PATH,
  );
  const parsed = JSON.parse(await readFile(exportPath, "utf8"));
  const expected = validateExport(parsed);
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const organizationId = process.env.BASECAMP_ORGANIZATION_ID?.trim();
  const organizationSlug = process.env.BASECAMP_ORGANIZATION_SLUG?.trim();
  if (!organizationId && !organizationSlug) {
    throw new Error(
      "Set BASECAMP_ORGANIZATION_ID or BASECAMP_ORGANIZATION_SLUG. The importer never guesses an organization.",
    );
  }
  if (!url || !serviceKey) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const client = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  let organizationQuery = client
    .from("organizations")
    .select("id,slug");
  if (organizationId) organizationQuery = organizationQuery.eq("id", organizationId);
  if (organizationSlug) {
    organizationQuery = organizationQuery.eq("slug", organizationSlug);
  }
  const { data: organization, error: organizationError } =
    await organizationQuery.maybeSingle();
  if (organizationError || !organization) {
    throw new Error(
      `Unable to resolve the explicitly mapped Basecamp organization: ${organizationError?.message ?? "no exact match"}`,
    );
  }

  const existingProfiles = await readAll(
    client,
    "profiles",
    "id,organization_id,email,role,status,preferences,basecamp_person_id",
    { organization_id: organization.id },
  );
  const existingByEmail = new Map(
    existingProfiles.map((profile) => [profile.email.toLowerCase(), profile]),
  );
  const existingByBasecampId = new Map(
    existingProfiles
      .filter((profile) => profile.basecamp_person_id)
      .map((profile) => [Number(profile.basecamp_person_id), profile]),
  );
  const usedEmails = new Set(
    existingProfiles.map((profile) => profile.email.toLowerCase()),
  );
  const personByName = new Map();
  for (const person of parsed.people) {
    personByName.set(
      person.name,
      preferPerson(personByName.get(person.name), person),
    );
  }

  const referencedNames = new Set();
  for (const todo of parsed.todos) {
    for (const assignee of todo.assignees ?? []) referencedNames.add(assignee);
  }
  for (const document of parsed.documents) referencedNames.add(document.creator);
  for (const comment of parsed.comments) referencedNames.add(comment.creator);

  const profileRows = [];
  const profileIdByBasecampId = new Map();
  const profileIdByName = new Map();
  for (const person of parsed.people) {
    const sourceEmail = normalizeEmail(person);
    const existing =
      existingByBasecampId.get(Number(person.id)) ??
      existingByEmail.get(sourceEmail);
    let email = existing?.email?.toLowerCase() ?? sourceEmail;
    if (!existing && usedEmails.has(email)) {
      email = `basecamp-${person.id}@invalid.local`;
    }
    usedEmails.add(email);
    const id = existing?.id ?? stableUuid("basecamp-person", person.id);
    const internal = isInternalEmail(sourceEmail);
    const row = {
      basecamp_account_id: ACCOUNT_ID,
      basecamp_person_id: person.id,
      company_name: internal ? "P11 Creative" : null,
      email,
      full_name: person.name.trim() || `Basecamp person ${person.id}`,
      id,
      organization_id: organization.id,
      person_type: internal ? "employee" : person.email ? "client" : "integration",
      preferences: {
        ...(existing?.preferences ?? {}),
        basecamp: {
          account_id: ACCOUNT_ID,
          person_id: person.id,
        },
        is_internal: internal,
      },
      role:
        sourceEmail === "jesse@p11.com"
          ? "admin"
          : existing?.role ?? (internal ? "member" : "viewer"),
      source_payload: person,
      status: existing?.status ?? (internal ? "active" : "deactivated"),
      title: person.title?.trim() || null,
    };
    profileRows.push(row);
    profileIdByBasecampId.set(Number(person.id), id);
    profileIdByName.set(
      person.name,
      profileIdByName.get(person.name) &&
        !internal
        ? profileIdByName.get(person.name)
        : id,
    );
  }

  for (const name of referencedNames) {
    if (!name || profileIdByName.has(name)) continue;
    const id = stableUuid("basecamp-unresolved-name", name);
    profileRows.push({
      basecamp_account_id: ACCOUNT_ID,
      basecamp_person_id: null,
      company_name: null,
      email: `basecamp-name-${createHash("sha256").update(name).digest("hex").slice(0, 16)}@invalid.local`,
      full_name: name,
      id,
      organization_id: organization.id,
      person_type: "unresolved_export_identity",
      preferences: {
        basecamp: { account_id: ACCOUNT_ID, unresolved_name: name },
        is_internal: false,
      },
      role: "viewer",
      source_payload: { name, inferred_from_export_reference: true },
      status: "deactivated",
      title: null,
    });
    profileIdByName.set(name, id);
  }

  const projectRows = [];
  const projectIdByBasecampId = new Map();
  const colorClasses = [
    "bg-sky-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
  ];
  for (const [index, project] of parsed.projects.entries()) {
    const id = stableUuid("basecamp-project", project.id);
    projectIdByBasecampId.set(Number(project.id), id);
    projectRows.push({
      archived_at:
        project.status === "archived"
          ? `${project.updated_at}T23:59:59.000Z`
          : null,
      basecamp_account_id: ACCOUNT_ID,
      basecamp_payload: project,
      basecamp_project_id: project.id,
      client_name: projectClient(project.name),
      code: `BC-${project.id}`.slice(0, 32),
      created_at: `${project.created_at}T12:00:00.000Z`,
      description: project.description?.trim() || null,
      id,
      metadata: {
        basecamp_app_url: project.app_url,
        basecamp_tools: project.tools,
        color: colorClasses[index % colorClasses.length],
        source: "basecamp",
      },
      name: project.name.trim().slice(0, 160),
      organization_id: organization.id,
      status: project.status === "archived" ? "completed" : "active",
      updated_at: `${project.updated_at}T12:00:00.000Z`,
    });
  }

  const profileByBasecampId = new Map(
    parsed.people.map((person) => [
      Number(person.id),
      profileIdByBasecampId.get(Number(person.id)),
    ]),
  );
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const projectMemberRows = parsed.project_memberships.flatMap((membership) => {
    const projectId = projectIdByBasecampId.get(Number(membership.project_id));
    const profileId = profileByBasecampId.get(Number(membership.person_id));
    if (!projectId || !profileId) return [];
    return [
      {
        profile_id: profileId,
        project_id: projectId,
        role: profileById.get(profileId)?.preferences?.is_internal
          ? "member"
          : "client",
        source: "basecamp",
        source_payload: membership,
      },
    ];
  });

  const listTitleKeys = new Set();
  const todoListRows = [];
  const todoListIdByBasecampId = new Map();
  const exportedTodoCountByList = new Map();
  for (const todo of parsed.todos) {
    const key = Number(todo.todolist_id);
    exportedTodoCountByList.set(
      key,
      (exportedTodoCountByList.get(key) ?? 0) + 1,
    );
  }
  const listPositionByProject = new Map();
  for (const list of parsed.todolists) {
    const projectId = projectIdByBasecampId.get(Number(list.project_id));
    if (!projectId) continue;
    const id = stableUuid("basecamp-todolist", list.id);
    todoListIdByBasecampId.set(Number(list.id), id);
    const detailedCount = exportedTodoCountByList.get(Number(list.id)) ?? 0;
    const missingDetailCount = Math.max(0, list.total_count - detailedCount);
    const position = listPositionByProject.get(projectId) ?? 0;
    listPositionByProject.set(projectId, position + 1);
    todoListRows.push({
      basecamp_payload: {
        ...list,
        detailed_todos_exported: detailedCount,
        detailed_todos_missing: missingDetailCount,
      },
      basecamp_todolist_id: list.id,
      description: missingDetailCount
        ? `${list.completed_count}/${list.total_count} complete in Basecamp. ${missingDetailCount} item details were unavailable in the source export.`
        : `${list.completed_count}/${list.total_count} complete in Basecamp.`,
      id,
      is_archived: false,
      position,
      project_id: projectId,
      title: uniqueTitle(
        listTitleKeys,
        projectId,
        list.name,
        list.id,
        120,
      ),
    });
  }

  const todoRows = [];
  const todoIdByBasecampId = new Map();
  const todoAssigneeRows = [];
  const todoPositionByList = new Map();
  for (const todo of parsed.todos) {
    const projectId = projectIdByBasecampId.get(Number(todo.project_id));
    const listId = todoListIdByBasecampId.get(Number(todo.todolist_id));
    if (!projectId || !listId) continue;
    const id = stableUuid("basecamp-todo", todo.id);
    todoIdByBasecampId.set(Number(todo.id), id);
    const assigneeIds = [
      ...new Set(
        (todo.assignees ?? [])
          .map((name) => profileIdByName.get(name))
          .filter(Boolean),
      ),
    ];
    const position = todoPositionByList.get(listId) ?? 0;
    todoPositionByList.set(listId, position + 1);
    todoRows.push({
      assigned_to: assigneeIds[0] ?? null,
      basecamp_payload: todo,
      basecamp_todo_id: todo.id,
      completed_at: null,
      due_at: todo.due_on ? `${todo.due_on}T12:00:00.000Z` : null,
      id,
      position,
      priority: "medium",
      project_id: projectId,
      status: todo.completed ? "done" : "todo",
      sync_status: "not_synced",
      title: todo.title.trim().slice(0, 300),
      todo_list_id: listId,
    });
    for (const [index, profileId] of assigneeIds.entries()) {
      todoAssigneeRows.push({
        assigned_by: null,
        profile_id: profileId,
        source: "basecamp",
        source_payload: {
          assignee_name: todo.assignees[index] ?? null,
          basecamp_todo_id: todo.id,
        },
        todo_id: id,
      });
    }
  }

  const docRows = [];
  const docIdByBasecampId = new Map();
  for (const document of parsed.documents) {
    const projectId = projectIdByBasecampId.get(Number(document.project_id));
    if (!projectId) continue;
    const id = stableUuid("basecamp-document", document.id);
    docIdByBasecampId.set(Number(document.id), id);
    docRows.push({
      basecamp_document_id: document.id,
      basecamp_payload: document,
      content: {
        body: document.content,
        source: "basecamp",
        type: "basecamp_document",
      },
      created_at: `${document.created_at}T12:00:00.000Z`,
      created_by: profileIdByName.get(document.creator) ?? null,
      id,
      plain_text: document.content,
      project_id: projectId,
      published_at: `${document.created_at}T12:00:00.000Z`,
      slug: slugify(document.title, document.id),
      status: "published",
      title: document.title.trim().slice(0, 200),
      updated_at: `${document.updated_at}T12:00:00.000Z`,
      updated_by: profileIdByName.get(document.creator) ?? null,
      version: 1,
    });
  }

  const commentRows = [];
  const commentMentionRows = [];
  for (const comment of parsed.comments) {
    const projectId = projectIdByBasecampId.get(Number(comment.project_id));
    if (!projectId || !comment.content?.trim()) continue;
    const id = stableUuid("basecamp-comment", comment.comment_id);
    commentRows.push({
      author_id: profileIdByName.get(comment.creator) ?? null,
      basecamp_comment_id: comment.comment_id,
      basecamp_payload: comment,
      basecamp_recording_id: comment.recording_id,
      body: comment.content,
      created_at: `${comment.created_at}T12:00:00.000Z`,
      doc_id:
        comment.recording_type === "document"
          ? docIdByBasecampId.get(Number(comment.recording_id)) ?? null
          : null,
      id,
      metadata: {
        basecamp_recording_title: comment.recording_title ?? null,
        basecamp_recording_type: comment.recording_type,
        source: "basecamp",
      },
      project_id: projectId,
      todo_id:
        comment.recording_type === "todo"
          ? todoIdByBasecampId.get(Number(comment.recording_id)) ?? null
          : null,
      updated_at: `${comment.created_at}T12:00:00.000Z`,
    });
    for (const profileId of mentionProfileIds(comment.content, profileRows)) {
      commentMentionRows.push({
        comment_id: id,
        profile_id: profileId,
      });
    }
  }

  const totalCount = parsed.todolists.reduce(
    (sum, list) => sum + list.total_count,
    0,
  );
  const coverage = {
    comments_exported: parsed.comments.length,
    detailed_todos_exported: parsed.todos.length,
    detailed_todos_missing: Math.max(0, totalCount - parsed.todos.length),
    documents_exported: parsed.documents.length,
    memberships_exported: parsed.project_memberships.length,
    messages_exported: parsed.messages.length,
    people_exported: parsed.people.length,
    projects_exported: parsed.projects.length,
    todo_lists_exported: parsed.todolists.length,
    total_todos_from_list_counters: totalCount,
  };
  if (
    coverage.detailed_todos_exported !== 619 ||
    coverage.total_todos_from_list_counters !== 2483 ||
    coverage.detailed_todos_missing !== 1864
  ) {
    throw new Error(
      `Basecamp todo coverage changed: expected 619/2483 with 1864 unavailable details, received ${coverage.detailed_todos_exported}/${coverage.total_todos_from_list_counters}.`,
    );
  }

  assertUnique(profileRows, (row) => row.id, "profile IDs");
  assertUnique(profileRows, (row) => row.email, "profile emails");
  assertUnique(projectRows, (row) => row.id, "project IDs");
  assertUnique(projectRows, (row) => row.code, "project codes");
  assertUnique(
    projectMemberRows,
    (row) => `${row.project_id}:${row.profile_id}`,
    "project memberships",
  );
  assertUnique(todoListRows, (row) => row.id, "todo-list IDs");
  assertUnique(
    todoListRows,
    (row) => `${row.project_id}:${row.title.toLowerCase()}`,
    "todo-list titles",
  );
  assertUnique(todoRows, (row) => row.id, "todo IDs");
  assertUnique(
    todoAssigneeRows,
    (row) => `${row.todo_id}:${row.profile_id}`,
    "todo assignees",
  );
  assertUnique(docRows, (row) => row.id, "document IDs");
  assertUnique(commentRows, (row) => row.id, "comment IDs");
  assertUnique(
    commentMentionRows,
    (row) => `${row.comment_id}:${row.profile_id}`,
    "comment mentions",
  );

  const entities = [
    ["profiles", profileRows, (row) => row.id],
    ["projects", projectRows, (row) => row.id],
    [
      "project_members",
      projectMemberRows,
      (row) => `${row.project_id}:${row.profile_id}`,
    ],
    ["todo_lists", todoListRows, (row) => row.id],
    ["todos", todoRows, (row) => row.id],
    [
      "todo_assignees",
      todoAssigneeRows,
      (row) => `${row.todo_id}:${row.profile_id}`,
    ],
    ["docs", docRows, (row) => row.id],
    ["comments", commentRows, (row) => row.id],
    [
      "comment_mentions",
      commentMentionRows,
      (row) => `${row.comment_id}:${row.profile_id}`,
    ],
  ];
  const manifest = Object.fromEntries(
    entities.map(([entityType, rows]) => [entityType, rows.length]),
  );
  const requestedRunId =
    process.env.BASECAMP_IMPORT_RUN_ID?.trim() ??
    process.argv
      .find((argument) => argument.startsWith("--run-id="))
      ?.slice("--run-id=".length);
  const runId = requestedRunId || randomUUID();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      runId,
    )
  ) {
    throw new Error("BASECAMP_IMPORT_RUN_ID/--run-id must be a UUID.");
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        exportPath,
        organization: {
          id: organization.id,
          slug: organization.slug,
        },
        runId,
        expected,
        manifest,
        coverage,
        warning:
          "Only 619 of 2483 Basecamp todos have source detail. The remaining 1864 are reported but never synthesized.",
      },
      null,
      2,
    ),
  );

  if (dryRun) return;

  const { data: existingRun, error: existingRunError } = await client
    .from("basecamp_import_runs")
    .select("id,organization_id,status,summary")
    .eq("id", runId)
    .maybeSingle();
  if (existingRunError) throw existingRunError;
  if (
    existingRun &&
    (existingRun.organization_id !== organization.id ||
      existingRun.status === "succeeded")
  ) {
    if (existingRun.status === "succeeded") {
      console.log(JSON.stringify(existingRun.summary, null, 2));
      return;
    }
    throw new Error("The requested import run belongs to another organization.");
  }

  const runRecord = {
    account_id: ACCOUNT_ID,
    coverage,
    error_message: null,
    export_date: parsed._meta.export_date,
    id: runId,
    known_gaps: parsed._meta.known_gaps,
    manifest,
    organization_id: organization.id,
    source: parsed._meta.source,
    status: "staging",
  };
  const runWrite = existingRun
    ? await client.from("basecamp_import_runs").update(runRecord).eq("id", runId)
    : await client.from("basecamp_import_runs").insert(runRecord);
  if (runWrite.error) {
    throw new Error(`Unable to initialize import run: ${runWrite.error.message}`);
  }

  try {
    for (const [entityType, rows, sourceKey] of entities) {
      await stageBatches(client, runId, entityType, rows, sourceKey);
    }
    const { data: finalResult, error: finalError } = await client.rpc(
      "finalize_basecamp_import",
      { target_run_id: runId },
    );
    if (finalError) throw finalError;
    console.log(JSON.stringify(finalResult, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client
      .from("basecamp_import_runs")
      .update({ error_message: message, status: "failed" })
      .eq("id", runId);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
