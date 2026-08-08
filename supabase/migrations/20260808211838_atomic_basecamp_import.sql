-- Staged Basecamp snapshot imports. Uploading batches is resumable; the final
-- merge and coverage bookkeeping happen in one database transaction.

create table public.basecamp_import_runs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id bigint not null,
  source text not null,
  export_date date not null,
  status text not null default 'staging'
    check (status in ('staging', 'finalizing', 'succeeded', 'failed')),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  coverage jsonb not null check (jsonb_typeof(coverage) = 'object'),
  known_gaps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(known_gaps) = 'array'),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  error_message text,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index basecamp_import_runs_org_started_idx
  on public.basecamp_import_runs (organization_id, started_at desc);

create table public.basecamp_import_stage (
  run_id uuid not null references public.basecamp_import_runs(id) on delete cascade,
  entity_type text not null check (
    entity_type in (
      'profiles',
      'projects',
      'project_members',
      'todo_lists',
      'todos',
      'todo_assignees',
      'docs',
      'comments',
      'comment_mentions'
    )
  ),
  source_key text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  staged_at timestamptz not null default now(),
  primary key (run_id, entity_type, source_key)
);

create index basecamp_import_stage_run_entity_idx
  on public.basecamp_import_stage (run_id, entity_type);

create table public.basecamp_import_checkpoints (
  run_id uuid not null references public.basecamp_import_runs(id) on delete cascade,
  entity_type text not null,
  batch_number integer not null check (batch_number >= 0),
  row_count integer not null check (row_count >= 0),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null default now(),
  primary key (run_id, entity_type, batch_number)
);

create trigger set_basecamp_import_runs_updated_at
  before update on public.basecamp_import_runs
  for each row execute function private.set_updated_at();

alter table public.basecamp_import_runs enable row level security;
alter table public.basecamp_import_stage enable row level security;
alter table public.basecamp_import_checkpoints enable row level security;

revoke all on
  public.basecamp_import_runs,
  public.basecamp_import_stage,
  public.basecamp_import_checkpoints
from public, anon, authenticated;
grant select, insert, update, delete on
  public.basecamp_import_runs,
  public.basecamp_import_stage,
  public.basecamp_import_checkpoints
to service_role;

create or replace function public.finalize_basecamp_import(
  target_run_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  import_run public.basecamp_import_runs%rowtype;
  manifest_entry record;
  staged_count bigint;
  result jsonb;
begin
  select run.*
  into import_run
  from public.basecamp_import_runs as run
  where run.id = target_run_id
  for update;

  if not found then
    raise no_data_found using message = 'Basecamp import run not found.';
  end if;
  if import_run.status = 'succeeded' then
    return import_run.summary;
  end if;
  if import_run.status <> 'staging' then
    raise object_not_in_prerequisite_state using
      message = 'Basecamp import run is not ready to finalize.';
  end if;

  if (import_run.coverage ->> 'detailed_todos_exported')::integer <> 619
    or (import_run.coverage ->> 'total_todos_from_list_counters')::integer <> 2483
    or (import_run.coverage ->> 'detailed_todos_missing')::integer <> 1864
  then
    raise check_violation using
      message = 'Basecamp coverage must preserve the known 619/2483 todo gap.';
  end if;

  for manifest_entry in
    select entry.key as entity_type, entry.value::integer as expected_count
    from jsonb_each_text(import_run.manifest) as entry
  loop
    select count(*)
    into staged_count
    from public.basecamp_import_stage as stage
    where stage.run_id = target_run_id
      and stage.entity_type = manifest_entry.entity_type;
    if staged_count <> manifest_entry.expected_count then
      raise check_violation using message = format(
        'Incomplete Basecamp staging for %s: expected %s, found %s.',
        manifest_entry.entity_type,
        manifest_entry.expected_count,
        staged_count
      );
    end if;
  end loop;

  update public.basecamp_import_runs
  set status = 'finalizing', error_message = null
  where id = target_run_id;

  insert into public.profiles (
    id,
    organization_id,
    email,
    full_name,
    title,
    role,
    status,
    preferences,
    basecamp_account_id,
    basecamp_person_id,
    person_type,
    company_name,
    source_payload
  )
  select
    source.id,
    source.organization_id,
    source.email,
    source.full_name,
    source.title,
    source.role,
    source.status,
    source.preferences,
    source.basecamp_account_id,
    source.basecamp_person_id,
    source.person_type,
    source.company_name,
    source.source_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    id uuid,
    organization_id uuid,
    email text,
    full_name text,
    title text,
    role text,
    status text,
    preferences jsonb,
    basecamp_account_id bigint,
    basecamp_person_id bigint,
    person_type text,
    company_name text,
    source_payload jsonb
  )
  where stage.run_id = target_run_id
    and stage.entity_type = 'profiles'
    and source.organization_id = import_run.organization_id
  on conflict (id) do update
  set
    organization_id = excluded.organization_id,
    email = excluded.email,
    full_name = excluded.full_name,
    title = excluded.title,
    role = excluded.role,
    status = excluded.status,
    preferences = excluded.preferences,
    basecamp_account_id = excluded.basecamp_account_id,
    basecamp_person_id = excluded.basecamp_person_id,
    person_type = excluded.person_type,
    company_name = excluded.company_name,
    source_payload = excluded.source_payload
  where (
    profiles.organization_id,
    profiles.email,
    profiles.full_name,
    profiles.title,
    profiles.role,
    profiles.status,
    profiles.preferences,
    profiles.basecamp_account_id,
    profiles.basecamp_person_id,
    profiles.person_type,
    profiles.company_name,
    profiles.source_payload
  ) is distinct from (
    excluded.organization_id,
    excluded.email,
    excluded.full_name,
    excluded.title,
    excluded.role,
    excluded.status,
    excluded.preferences,
    excluded.basecamp_account_id,
    excluded.basecamp_person_id,
    excluded.person_type,
    excluded.company_name,
    excluded.source_payload
  );

  if (
    select count(*)
    from public.basecamp_import_stage as stage
    where stage.run_id = target_run_id
      and stage.entity_type = 'profiles'
      and (stage.payload ->> 'organization_id')::uuid
        <> import_run.organization_id
  ) > 0 then
    raise check_violation using
      message = 'A staged profile maps to another organization.';
  end if;

  insert into public.projects (
    id,
    organization_id,
    name,
    code,
    client_name,
    description,
    status,
    metadata,
    archived_at,
    created_at,
    updated_at,
    basecamp_account_id,
    basecamp_project_id,
    basecamp_payload
  )
  select
    source.id,
    source.organization_id,
    source.name,
    source.code,
    source.client_name,
    source.description,
    source.status,
    source.metadata,
    source.archived_at,
    source.created_at,
    source.updated_at,
    source.basecamp_account_id,
    source.basecamp_project_id,
    source.basecamp_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    id uuid,
    organization_id uuid,
    name text,
    code text,
    client_name text,
    description text,
    status text,
    metadata jsonb,
    archived_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    basecamp_account_id bigint,
    basecamp_project_id bigint,
    basecamp_payload jsonb
  )
  where stage.run_id = target_run_id
    and stage.entity_type = 'projects'
    and source.organization_id = import_run.organization_id
  on conflict (id) do update
  set
    organization_id = excluded.organization_id,
    name = excluded.name,
    code = excluded.code,
    client_name = excluded.client_name,
    description = excluded.description,
    status = excluded.status,
    metadata = excluded.metadata,
    archived_at = excluded.archived_at,
    basecamp_account_id = excluded.basecamp_account_id,
    basecamp_project_id = excluded.basecamp_project_id,
    basecamp_payload = excluded.basecamp_payload
  where (
    projects.organization_id,
    projects.name,
    projects.code,
    projects.client_name,
    projects.description,
    projects.status,
    projects.metadata,
    projects.archived_at,
    projects.basecamp_account_id,
    projects.basecamp_project_id,
    projects.basecamp_payload
  ) is distinct from (
    excluded.organization_id,
    excluded.name,
    excluded.code,
    excluded.client_name,
    excluded.description,
    excluded.status,
    excluded.metadata,
    excluded.archived_at,
    excluded.basecamp_account_id,
    excluded.basecamp_project_id,
    excluded.basecamp_payload
  );

  if (
    select count(*)
    from public.basecamp_import_stage as stage
    where stage.run_id = target_run_id
      and stage.entity_type = 'projects'
      and (stage.payload ->> 'organization_id')::uuid
        <> import_run.organization_id
  ) > 0 then
    raise check_violation using
      message = 'A staged project maps to another organization.';
  end if;

  insert into public.project_members (
    project_id,
    profile_id,
    role,
    source,
    source_payload
  )
  select
    source.project_id,
    source.profile_id,
    source.role,
    source.source,
    source.source_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    project_id uuid,
    profile_id uuid,
    role text,
    source text,
    source_payload jsonb
  )
  join public.projects as project
    on project.id = source.project_id
    and project.organization_id = import_run.organization_id
  join public.profiles as profile
    on profile.id = source.profile_id
    and profile.organization_id = import_run.organization_id
  where stage.run_id = target_run_id
    and stage.entity_type = 'project_members'
  on conflict (project_id, profile_id) do update
  set
    role = excluded.role,
    source = excluded.source,
    source_payload = excluded.source_payload
  where (
    project_members.role,
    project_members.source,
    project_members.source_payload
  ) is distinct from (
    excluded.role,
    excluded.source,
    excluded.source_payload
  );

  insert into public.todo_lists (
    id,
    project_id,
    title,
    description,
    position,
    is_archived,
    basecamp_todolist_id,
    basecamp_payload
  )
  select
    source.id,
    source.project_id,
    source.title,
    source.description,
    source.position,
    source.is_archived,
    source.basecamp_todolist_id,
    source.basecamp_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    id uuid,
    project_id uuid,
    title text,
    description text,
    position integer,
    is_archived boolean,
    basecamp_todolist_id bigint,
    basecamp_payload jsonb
  )
  join public.projects as project
    on project.id = source.project_id
    and project.organization_id = import_run.organization_id
  where stage.run_id = target_run_id
    and stage.entity_type = 'todo_lists'
  on conflict (id) do update
  set
    project_id = excluded.project_id,
    title = excluded.title,
    description = excluded.description,
    position = excluded.position,
    is_archived = excluded.is_archived,
    basecamp_todolist_id = excluded.basecamp_todolist_id,
    basecamp_payload = excluded.basecamp_payload
  where (
    todo_lists.project_id,
    todo_lists.title,
    todo_lists.description,
    todo_lists.position,
    todo_lists.is_archived,
    todo_lists.basecamp_todolist_id,
    todo_lists.basecamp_payload
  ) is distinct from (
    excluded.project_id,
    excluded.title,
    excluded.description,
    excluded.position,
    excluded.is_archived,
    excluded.basecamp_todolist_id,
    excluded.basecamp_payload
  );

  insert into public.todos (
    id,
    project_id,
    todo_list_id,
    title,
    assigned_to,
    due_at,
    status,
    priority,
    position,
    sync_status,
    basecamp_todo_id,
    basecamp_payload
  )
  select
    source.id,
    source.project_id,
    source.todo_list_id,
    source.title,
    source.assigned_to,
    source.due_at,
    source.status,
    source.priority,
    source.position,
    source.sync_status,
    source.basecamp_todo_id,
    source.basecamp_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    id uuid,
    project_id uuid,
    todo_list_id uuid,
    title text,
    assigned_to uuid,
    due_at timestamptz,
    status text,
    priority text,
    position integer,
    sync_status text,
    basecamp_todo_id bigint,
    basecamp_payload jsonb
  )
  join public.projects as project
    on project.id = source.project_id
    and project.organization_id = import_run.organization_id
  join public.todo_lists as list
    on list.id = source.todo_list_id
    and list.project_id = source.project_id
  where stage.run_id = target_run_id
    and stage.entity_type = 'todos'
  on conflict (id) do update
  set
    project_id = excluded.project_id,
    todo_list_id = excluded.todo_list_id,
    title = excluded.title,
    assigned_to = excluded.assigned_to,
    due_at = excluded.due_at,
    status = excluded.status,
    priority = excluded.priority,
    position = excluded.position,
    sync_status = excluded.sync_status,
    basecamp_todo_id = excluded.basecamp_todo_id,
    basecamp_payload = excluded.basecamp_payload
  where (
    todos.project_id,
    todos.todo_list_id,
    todos.title,
    todos.assigned_to,
    todos.due_at,
    todos.status,
    todos.priority,
    todos.position,
    todos.sync_status,
    todos.basecamp_todo_id,
    todos.basecamp_payload
  ) is distinct from (
    excluded.project_id,
    excluded.todo_list_id,
    excluded.title,
    excluded.assigned_to,
    excluded.due_at,
    excluded.status,
    excluded.priority,
    excluded.position,
    excluded.sync_status,
    excluded.basecamp_todo_id,
    excluded.basecamp_payload
  );

  insert into public.todo_assignees (
    todo_id,
    profile_id,
    assigned_by,
    source,
    source_payload
  )
  select
    source.todo_id,
    source.profile_id,
    source.assigned_by,
    source.source,
    source.source_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    todo_id uuid,
    profile_id uuid,
    assigned_by uuid,
    source text,
    source_payload jsonb
  )
  join public.todos as todo on todo.id = source.todo_id
  join public.projects as project
    on project.id = todo.project_id
    and project.organization_id = import_run.organization_id
  join public.profiles as profile
    on profile.id = source.profile_id
    and profile.organization_id = import_run.organization_id
  where stage.run_id = target_run_id
    and stage.entity_type = 'todo_assignees'
  on conflict (todo_id, profile_id) do update
  set
    assigned_by = excluded.assigned_by,
    source = excluded.source,
    source_payload = excluded.source_payload
  where (
    todo_assignees.assigned_by,
    todo_assignees.source,
    todo_assignees.source_payload
  ) is distinct from (
    excluded.assigned_by,
    excluded.source,
    excluded.source_payload
  );

  insert into public.docs (
    id,
    project_id,
    title,
    slug,
    content,
    plain_text,
    status,
    version,
    created_by,
    updated_by,
    published_at,
    created_at,
    updated_at,
    basecamp_document_id,
    basecamp_payload
  )
  select
    source.id,
    source.project_id,
    source.title,
    source.slug,
    source.content,
    source.plain_text,
    source.status,
    source.version,
    source.created_by,
    source.updated_by,
    source.published_at,
    source.created_at,
    source.updated_at,
    source.basecamp_document_id,
    source.basecamp_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    id uuid,
    project_id uuid,
    title text,
    slug text,
    content jsonb,
    plain_text text,
    status text,
    version integer,
    created_by uuid,
    updated_by uuid,
    published_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    basecamp_document_id bigint,
    basecamp_payload jsonb
  )
  join public.projects as project
    on project.id = source.project_id
    and project.organization_id = import_run.organization_id
  where stage.run_id = target_run_id
    and stage.entity_type = 'docs'
  on conflict (id) do update
  set
    project_id = excluded.project_id,
    title = excluded.title,
    slug = excluded.slug,
    content = excluded.content,
    plain_text = excluded.plain_text,
    status = excluded.status,
    version = excluded.version,
    created_by = excluded.created_by,
    updated_by = excluded.updated_by,
    published_at = excluded.published_at,
    basecamp_document_id = excluded.basecamp_document_id,
    basecamp_payload = excluded.basecamp_payload
  where (
    docs.project_id,
    docs.title,
    docs.slug,
    docs.content,
    docs.plain_text,
    docs.status,
    docs.version,
    docs.created_by,
    docs.updated_by,
    docs.published_at,
    docs.basecamp_document_id,
    docs.basecamp_payload
  ) is distinct from (
    excluded.project_id,
    excluded.title,
    excluded.slug,
    excluded.content,
    excluded.plain_text,
    excluded.status,
    excluded.version,
    excluded.created_by,
    excluded.updated_by,
    excluded.published_at,
    excluded.basecamp_document_id,
    excluded.basecamp_payload
  );

  insert into public.comments (
    id,
    project_id,
    todo_id,
    doc_id,
    author_id,
    body,
    metadata,
    created_at,
    updated_at,
    basecamp_comment_id,
    basecamp_recording_id,
    basecamp_payload
  )
  select
    source.id,
    source.project_id,
    source.todo_id,
    source.doc_id,
    source.author_id,
    source.body,
    source.metadata,
    source.created_at,
    source.updated_at,
    source.basecamp_comment_id,
    source.basecamp_recording_id,
    source.basecamp_payload
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    id uuid,
    project_id uuid,
    todo_id uuid,
    doc_id uuid,
    author_id uuid,
    body text,
    metadata jsonb,
    created_at timestamptz,
    updated_at timestamptz,
    basecamp_comment_id bigint,
    basecamp_recording_id bigint,
    basecamp_payload jsonb
  )
  join public.projects as project
    on project.id = source.project_id
    and project.organization_id = import_run.organization_id
  where stage.run_id = target_run_id
    and stage.entity_type = 'comments'
  on conflict (id) do update
  set
    project_id = excluded.project_id,
    todo_id = excluded.todo_id,
    doc_id = excluded.doc_id,
    author_id = excluded.author_id,
    body = excluded.body,
    metadata = excluded.metadata,
    basecamp_comment_id = excluded.basecamp_comment_id,
    basecamp_recording_id = excluded.basecamp_recording_id,
    basecamp_payload = excluded.basecamp_payload
  where (
    comments.project_id,
    comments.todo_id,
    comments.doc_id,
    comments.author_id,
    comments.body,
    comments.metadata,
    comments.basecamp_comment_id,
    comments.basecamp_recording_id,
    comments.basecamp_payload
  ) is distinct from (
    excluded.project_id,
    excluded.todo_id,
    excluded.doc_id,
    excluded.author_id,
    excluded.body,
    excluded.metadata,
    excluded.basecamp_comment_id,
    excluded.basecamp_recording_id,
    excluded.basecamp_payload
  );

  insert into public.comment_mentions (comment_id, profile_id)
  select source.comment_id, source.profile_id
  from public.basecamp_import_stage as stage
  cross join lateral jsonb_to_record(stage.payload) as source(
    comment_id uuid,
    profile_id uuid
  )
  join public.comments as comment on comment.id = source.comment_id
  join public.projects as project
    on project.id = comment.project_id
    and project.organization_id = import_run.organization_id
  join public.profiles as profile
    on profile.id = source.profile_id
    and profile.organization_id = import_run.organization_id
  where stage.run_id = target_run_id
    and stage.entity_type = 'comment_mentions'
  on conflict (comment_id, profile_id) do nothing;

  insert into public.integration_settings (
    organization_id,
    provider,
    enabled,
    settings,
    last_synced_at,
    last_error
  )
  values (
    import_run.organization_id,
    'basecamp',
    false,
    jsonb_build_object(
      'account_id', import_run.account_id,
      'coverage', import_run.coverage,
      'export_date', import_run.export_date,
      'known_gaps', import_run.known_gaps,
      'mode', 'staged_snapshot',
      'run_id', import_run.id,
      'source', import_run.source
    ),
    now(),
    null
  )
  on conflict (organization_id, provider) do update
  set
    enabled = excluded.enabled,
    settings = excluded.settings,
    last_synced_at = excluded.last_synced_at,
    last_error = excluded.last_error
  where (
    integration_settings.enabled,
    integration_settings.settings,
    integration_settings.last_error
  ) is distinct from (
    excluded.enabled,
    excluded.settings,
    excluded.last_error
  );

  update public.organizations as organization
  set settings = jsonb_set(
    organization.settings,
    '{basecamp_import}',
    jsonb_build_object(
      'account_id', import_run.account_id,
      'coverage', import_run.coverage,
      'export_date', import_run.export_date,
      'known_gaps', import_run.known_gaps,
      'mode', 'staged_snapshot',
      'run_id', import_run.id,
      'source', import_run.source
    ),
    true
  )
  where organization.id = import_run.organization_id;

  result := jsonb_build_object(
    'run_id', import_run.id,
    'organization_id', import_run.organization_id,
    'account_id', import_run.account_id,
    'coverage', import_run.coverage,
    'manifest', import_run.manifest,
    'status', 'succeeded'
  );

  update public.basecamp_import_runs
  set
    status = 'succeeded',
    summary = result,
    finalized_at = now(),
    error_message = null
  where id = target_run_id;

  return result;
end;
$$;

revoke all on function public.finalize_basecamp_import(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_basecamp_import(uuid)
  to service_role;
