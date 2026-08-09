-- Official Basecamp full-export archive, deduplicated physical blobs, logical
-- files, and service-only import staging. Existing snapshot-import tables and
-- their finalizer are intentionally left unchanged.

alter table public.projects
  add column is_read_only boolean not null default false;

drop index public.profiles_basecamp_person_unique_idx;
create unique index profiles_basecamp_person_unique_idx
  on public.profiles (
    organization_id,
    basecamp_account_id,
    basecamp_person_id
  )
  where basecamp_account_id is not null
    and basecamp_person_id is not null;

drop index public.projects_basecamp_project_unique_idx;
create unique index projects_basecamp_project_unique_idx
  on public.projects (
    organization_id,
    basecamp_account_id,
    basecamp_project_id
  )
  where basecamp_account_id is not null
    and basecamp_project_id is not null;

create index projects_org_read_only_name_idx
  on public.projects (organization_id, is_read_only, lower(name), id);

create table public.basecamp_export_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  account_id bigint not null check (account_id > 0),
  archive_name text not null check (
    char_length(btrim(archive_name)) between 1 and 1024
  ),
  archive_size_bytes bigint not null check (archive_size_bytes > 0),
  manifest_sha256 text not null check (
    manifest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  archive_sha256 text check (
    archive_sha256 is null or archive_sha256 ~ '^[a-f0-9]{64}$'
  ),
  parser_version text not null check (
    char_length(btrim(parser_version)) between 1 and 120
  ),
  exported_at timestamptz not null,
  status text not null default 'inventory' check (
    status in (
      'inventory',
      'staging',
      'ready',
      'importing',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  phase text not null default 'inventory' check (
    char_length(btrim(phase)) between 1 and 120
  ),
  entry_count_expected bigint not null default 0
    check (entry_count_expected >= 0),
  entry_count_processed bigint not null default 0
    check (entry_count_processed >= 0),
  record_count_expected bigint not null default 0
    check (record_count_expected >= 0),
  record_count_processed bigint not null default 0
    check (record_count_processed >= 0),
  blob_count_expected bigint not null default 0
    check (blob_count_expected >= 0),
  blob_count_ready bigint not null default 0
    check (blob_count_ready >= 0),
  bytes_total bigint not null default 0 check (bytes_total >= 0),
  bytes_hashed bigint not null default 0 check (bytes_hashed >= 0),
  bytes_uploaded bigint not null default 0 check (bytes_uploaded >= 0),
  warning_count bigint not null default 0 check (warning_count >= 0),
  error_count bigint not null default 0 check (error_count >= 0),
  manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manifest) = 'object'),
  progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(progress) = 'object'),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(errors) = 'array'),
  started_at timestamptz not null default now(),
  inventory_completed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint basecamp_export_runs_progress_valid check (
    entry_count_processed <= entry_count_expected
    and record_count_processed <= record_count_expected
    and blob_count_ready <= blob_count_expected
    and bytes_hashed <= bytes_total
    and bytes_uploaded <= bytes_total
  ),
  constraint basecamp_export_runs_identity_unique
    unique (organization_id, account_id, manifest_sha256)
);

create index basecamp_export_runs_org_started_idx
  on public.basecamp_export_runs (organization_id, started_at desc, id desc);
create index basecamp_export_runs_active_idx
  on public.basecamp_export_runs (status, updated_at, id)
  where status in ('inventory', 'staging', 'ready', 'importing', 'failed');

create table public.file_blobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  bucket_id text not null default 'project-files'
    check (bucket_id = 'project-files'),
  object_path text not null check (
    char_length(btrim(object_path)) between 1 and 1024
    and object_path !~ '(^|/)\.\.(/|$)'
  ),
  sha256 text check (
    sha256 is null or sha256 ~ '^[a-f0-9]{64}$'
  ),
  crc32 text check (
    crc32 is null or crc32 ~ '^[a-f0-9]{8}$'
  ),
  size_bytes bigint not null check (size_bytes >= 0),
  mime_type text check (
    mime_type is null or char_length(mime_type) between 1 and 255
  ),
  status text not null default 'pending' check (
    status in (
      'pending',
      'uploading',
      'ready',
      'unverified',
      'failed',
      'missing',
      'deleting'
    )
  ),
  tus_upload_url text,
  tus_offset_bytes bigint not null default 0 check (tus_offset_bytes >= 0),
  upload_lease_token uuid,
  upload_lease_expires_at timestamptz,
  upload_attempt_count integer not null default 0
    check (upload_attempt_count >= 0),
  last_error text,
  upload_started_at timestamptz,
  last_attempt_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_blobs_tus_offset_valid check (
    tus_offset_bytes <= size_bytes
  ),
  constraint file_blobs_ready_valid check (
    status <> 'ready' or (sha256 is not null and verified_at is not null)
  ),
  constraint file_blobs_bucket_path_unique unique (bucket_id, object_path)
);

create unique index file_blobs_ready_content_unique_idx
  on public.file_blobs (organization_id, sha256, size_bytes)
  where status = 'ready' and sha256 is not null;
create index file_blobs_org_status_updated_idx
  on public.file_blobs (organization_id, status, updated_at, id);
create index file_blobs_upload_resume_idx
  on public.file_blobs (status, last_attempt_at, id)
  where status in ('pending', 'uploading', 'failed');

create table public.basecamp_archive_entries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.basecamp_export_runs(id) on delete cascade,
  project_id uuid,
  entry_type text not null check (
    char_length(btrim(entry_type)) between 1 and 120
  ),
  classification text not null check (
    char_length(btrim(classification)) between 1 and 120
  ),
  source_id text,
  source_parent_id text,
  source_path text not null check (
    char_length(btrim(source_path)) between 1 and 4096
    and source_path !~ '^/'
    and source_path !~ '(^|/)\.\.(/|$)'
  ),
  file_name text not null check (
    char_length(btrim(file_name)) between 1 and 1024
  ),
  crc32 text not null check (crc32 ~ '^[a-f0-9]{8}$'),
  compressed_size_bytes bigint not null
    check (compressed_size_bytes >= 0),
  uncompressed_size_bytes bigint not null
    check (uncompressed_size_bytes >= 0),
  local_header_offset bigint check (local_header_offset is null or local_header_offset >= 0),
  data_offset bigint check (data_offset is null or data_offset >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_modified_at timestamptz,
  blob_id uuid references public.file_blobs(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint basecamp_archive_entries_run_path_unique
    unique (run_id, source_path)
);

create index basecamp_archive_entries_project_type_path_idx
  on public.basecamp_archive_entries (
    project_id,
    entry_type,
    source_path,
    id
  );
create index basecamp_archive_entries_run_classification_idx
  on public.basecamp_archive_entries (run_id, classification, id);
create index basecamp_archive_entries_blob_idx
  on public.basecamp_archive_entries (blob_id)
  where blob_id is not null;

create table public.basecamp_archive_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.basecamp_export_runs(id) on delete cascade,
  project_id uuid,
  parent_id uuid
    references public.basecamp_archive_records(id) on delete cascade,
  record_type text not null check (
    char_length(btrim(record_type)) between 1 and 120
  ),
  native_recording_id bigint,
  native_creator_id bigint,
  source_locator text not null check (
    char_length(btrim(source_locator)) between 1 and 4096
  ),
  source_path text not null check (
    char_length(btrim(source_path)) between 1 and 4096
    and source_path !~ '^/'
    and source_path !~ '(^|/)\.\.(/|$)'
  ),
  title text,
  sanitized_html text,
  plain_text text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_exported_at timestamptz,
  source_status text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  search_vector tsvector generated always as (
    to_tsvector(
      'english'::regconfig,
      coalesce(title, '') || ' ' || coalesce(plain_text, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint basecamp_archive_records_run_locator_unique
    unique (run_id, source_locator)
);

create index basecamp_archive_records_project_type_time_idx
  on public.basecamp_archive_records (
    project_id,
    record_type,
    source_updated_at desc,
    id desc
  );
create index basecamp_archive_records_project_time_idx
  on public.basecamp_archive_records (
    project_id,
    source_updated_at desc,
    id desc
  );
create index basecamp_archive_records_run_root_time_idx
  on public.basecamp_archive_records (
    run_id,
    record_type,
    source_updated_at desc,
    id desc
  )
  where project_id is null;
create index basecamp_archive_records_parent_time_idx
  on public.basecamp_archive_records (
    parent_id,
    source_created_at,
    id
  )
  where parent_id is not null;
create index basecamp_archive_records_search_idx
  on public.basecamp_archive_records using gin (search_vector);

create table public.basecamp_archive_record_entries (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null
    references public.basecamp_archive_records(id) on delete cascade,
  entry_id uuid not null
    references public.basecamp_archive_entries(id) on delete cascade,
  reference_role text not null check (
    char_length(btrim(reference_role)) between 1 and 120
  ),
  ordinal integer not null default 0 check (ordinal >= 0),
  source_locator text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create unique index basecamp_record_entries_source_locator_unique_idx
  on public.basecamp_archive_record_entries (record_id, source_locator)
  where source_locator is not null;
create index basecamp_record_entries_record_order_idx
  on public.basecamp_archive_record_entries (
    record_id,
    reference_role,
    ordinal,
    id
  );
create index basecamp_record_entries_entry_idx
  on public.basecamp_archive_record_entries (entry_id, id);

alter table public.projects
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_path text,
  add column imported_at timestamptz;

alter table public.project_members
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column imported_at timestamptz;

alter table public.todo_lists
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_path text,
  add column imported_at timestamptz;

alter table public.todos
  add column due_on date,
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column basecamp_creator_id bigint,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_path text,
  add column imported_at timestamptz;

create index todos_project_due_on_idx
  on public.todos (project_id, due_on, id)
  where due_on is not null;

alter table public.todo_assignees
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column imported_at timestamptz;

alter table public.todo_completion_subscribers
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column imported_at timestamptz;

alter table public.todo_subtasks
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_path text,
  add column imported_at timestamptz;

alter table public.docs
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_path text,
  add column imported_at timestamptz;

alter table public.messages
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column basecamp_creator_id bigint,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_path text,
  add column imported_at timestamptz;

alter table public.comments
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column basecamp_creator_id bigint,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_path text,
  add column imported_at timestamptz;

alter table public.chat_messages
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column basecamp_account_id bigint,
  add column basecamp_chat_id bigint,
  add column basecamp_message_id bigint,
  add column basecamp_creator_id bigint,
  add column source_locator text,
  add column source_path text,
  add column source_ordinal integer check (
    source_ordinal is null or source_ordinal >= 0
  ),
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object'),
  add column imported_at timestamptz;

create unique index chat_messages_basecamp_locator_unique_idx
  on public.chat_messages (project_id, source_locator)
  where project_id is not null and source_locator is not null;
create index chat_messages_basecamp_chat_time_idx
  on public.chat_messages (
    project_id,
    basecamp_chat_id,
    source_created_at,
    source_ordinal,
    id
  )
  where basecamp_chat_id is not null;

alter table public.files
  add column blob_id uuid
    references public.file_blobs(id) on delete restrict,
  add column source_system text,
  add column source_account_id text,
  add column source_file_id text,
  add column source_path text,
  add column source_uploader_id text,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_exported_at timestamptz,
  add column source_checksum_sha256 text check (
    source_checksum_sha256 is null
    or source_checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add column source_crc32 text check (
    source_crc32 is null or source_crc32 ~ '^[a-f0-9]{8}$'
  ),
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object'),
  add column availability_status text not null default 'available' check (
    availability_status in (
      'pending',
      'available',
      'missing',
      'failed',
      'deleted'
    )
  ),
  add column listing_position bigint,
  add column basecamp_account_id bigint,
  add column basecamp_upload_id bigint,
  add column basecamp_export_run_id uuid
    references public.basecamp_export_runs(id) on delete set null,
  add column imported_at timestamptz;

insert into public.file_blobs (
  organization_id,
  bucket_id,
  object_path,
  sha256,
  size_bytes,
  mime_type,
  status,
  verified_at,
  created_at,
  updated_at
)
select
  project.organization_id,
  file.bucket_id,
  file.object_path,
  file.checksum_sha256,
  file.size_bytes,
  file.mime_type,
  case when file.checksum_sha256 is null then 'unverified' else 'ready' end,
  case when file.checksum_sha256 is null then null else file.updated_at end,
  file.created_at,
  file.updated_at
from public.files as file
join public.projects as project on project.id = file.project_id
on conflict (bucket_id, object_path) do nothing;

update public.files as file
set blob_id = blob.id
from public.file_blobs as blob
where blob.bucket_id = file.bucket_id
  and blob.object_path = file.object_path
  and file.blob_id is null;

alter table public.files
  alter column bucket_id drop not null,
  alter column object_path drop not null,
  drop constraint files_bucket_id_object_path_key,
  add constraint files_physical_target_pair_check check (
    (bucket_id is null) = (object_path is null)
  ),
  add constraint files_blob_or_physical_target_check check (
    blob_id is not null
    or (bucket_id is not null and object_path is not null)
    or (
      source_system is not null
      and availability_status in ('pending', 'missing', 'failed', 'deleted')
    )
  );

create unique index files_native_object_path_unique_idx
  on public.files (bucket_id, object_path)
  where source_system is null and bucket_id is not null;
create unique index files_source_identity_unique_idx
  on public.files (
    project_id,
    source_system,
    source_account_id,
    source_file_id
  )
  where source_system is not null
    and source_account_id is not null
    and source_file_id is not null;
create unique index files_basecamp_upload_unique_idx
  on public.files (project_id, basecamp_account_id, basecamp_upload_id)
  where basecamp_account_id is not null and basecamp_upload_id is not null;
create index files_blob_idx on public.files (blob_id);
create index files_project_listing_idx
  on public.files (
    project_id,
    availability_status,
    listing_position,
    id
  );
create index files_project_source_time_idx
  on public.files (
    project_id,
    source_updated_at desc,
    id desc
  );
create index files_uploader_created_idx
  on public.files (uploaded_by, created_at desc, id desc)
  where uploaded_by is not null;

create table public.file_references (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  todo_id uuid references public.todos(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  doc_id uuid references public.docs(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  chat_message_id uuid references public.chat_messages(id) on delete cascade,
  archive_record_id uuid
    references public.basecamp_archive_records(id) on delete cascade,
  reference_role text not null default 'attachment' check (
    char_length(btrim(reference_role)) between 1 and 120
  ),
  ordinal integer not null default 0 check (ordinal >= 0),
  title text,
  caption text,
  alt_text text,
  source_locator text,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint file_references_exactly_one_target check (
    num_nonnulls(
      todo_id,
      comment_id,
      doc_id,
      message_id,
      chat_message_id,
      archive_record_id
    ) = 1
  )
);

create unique index file_references_source_locator_unique_idx
  on public.file_references (file_id, source_locator)
  where source_locator is not null;
create index file_references_project_target_idx
  on public.file_references (project_id, reference_role, ordinal, id);
create index file_references_file_idx
  on public.file_references (file_id, id);
create index file_references_todo_idx
  on public.file_references (todo_id, ordinal, id)
  where todo_id is not null;
create index file_references_comment_idx
  on public.file_references (comment_id, ordinal, id)
  where comment_id is not null;
create index file_references_doc_idx
  on public.file_references (doc_id, ordinal, id)
  where doc_id is not null;
create index file_references_message_idx
  on public.file_references (message_id, ordinal, id)
  where message_id is not null;
create index file_references_chat_idx
  on public.file_references (chat_message_id, ordinal, id)
  where chat_message_id is not null;
create index file_references_archive_record_idx
  on public.file_references (archive_record_id, ordinal, id)
  where archive_record_id is not null;

create table public.basecamp_export_stage (
  run_id uuid not null
    references public.basecamp_export_runs(id) on delete cascade,
  project_id uuid not null,
  entity_type text not null check (
    entity_type in (
      'projects',
      'project_members',
      'todo_lists',
      'todos',
      'todo_assignees',
      'todo_completion_subscribers',
      'todo_subtasks',
      'docs',
      'messages',
      'comments',
      'chat_messages',
      'files',
      'file_references'
    )
  ),
  source_key text not null check (
    char_length(btrim(source_key)) between 1 and 4096
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  staged_at timestamptz not null default now(),
  primary key (run_id, project_id, entity_type, source_key)
);

create index basecamp_export_stage_project_entity_idx
  on public.basecamp_export_stage (run_id, project_id, entity_type, source_key);

create table public.basecamp_export_project_status (
  run_id uuid not null
    references public.basecamp_export_runs(id) on delete cascade,
  project_id uuid not null,
  source_project_id bigint,
  is_read_only boolean not null default false,
  status text not null default 'staging' check (
    status in (
      'staging',
      'ready',
      'validating',
      'promoting',
      'promoted',
      'failed'
    )
  ),
  expected_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(expected_counts) = 'object'),
  staged_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(staged_counts) = 'object'),
  promoted_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(promoted_counts) = 'object'),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(errors) = 'array'),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  validated_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, project_id)
);

create index basecamp_export_project_status_run_state_idx
  on public.basecamp_export_project_status (
    run_id,
    status,
    updated_at,
    project_id
  );

create table public.basecamp_export_preimages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.basecamp_export_runs(id) on delete cascade,
  project_id uuid not null,
  entity_type text not null,
  source_key text not null,
  operation text not null check (
    operation in ('insert', 'update', 'conflict')
  ),
  entity_id text,
  preimage jsonb,
  staged_payload jsonb not null check (
    jsonb_typeof(staged_payload) = 'object'
  ),
  captured_at timestamptz not null default now(),
  constraint basecamp_export_preimages_stage_unique
    unique (run_id, project_id, entity_type, source_key)
);

create index basecamp_export_preimages_project_idx
  on public.basecamp_export_preimages (
    run_id,
    project_id,
    entity_type,
    captured_at,
    id
  );

create table public.basecamp_export_conflicts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.basecamp_export_runs(id) on delete cascade,
  project_id uuid not null,
  entity_type text not null,
  source_key text not null,
  entity_id text,
  local_row jsonb not null check (jsonb_typeof(local_row) = 'object'),
  staged_payload jsonb not null check (
    jsonb_typeof(staged_payload) = 'object'
  ),
  conflict jsonb not null check (jsonb_typeof(conflict) = 'object'),
  resolution text not null default 'preserve_local' check (
    resolution in (
      'preserve_local',
      'use_import',
      'merged',
      'ignored'
    )
  ),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint basecamp_export_conflicts_stage_unique
    unique (run_id, project_id, entity_type, source_key)
);

create index basecamp_export_conflicts_open_idx
  on public.basecamp_export_conflicts (
    run_id,
    project_id,
    created_at,
    id
  )
  where resolved_at is null;

create trigger set_basecamp_export_runs_updated_at
  before update on public.basecamp_export_runs
  for each row execute function private.set_updated_at();
create trigger set_file_blobs_updated_at
  before update on public.file_blobs
  for each row execute function private.set_updated_at();
create trigger set_basecamp_archive_entries_updated_at
  before update on public.basecamp_archive_entries
  for each row execute function private.set_updated_at();
create trigger set_basecamp_archive_records_updated_at
  before update on public.basecamp_archive_records
  for each row execute function private.set_updated_at();
create trigger set_basecamp_export_project_status_updated_at
  before update on public.basecamp_export_project_status
  for each row execute function private.set_updated_at();

create or replace function private.can_access_basecamp_archive_row(
  target_run_id uuid,
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_project_id is not null
      then private.can_access_project(target_project_id)
    else exists (
      select 1
      from public.basecamp_export_runs as run
      where run.id = target_run_id
        and private.has_organization_role(
          run.organization_id,
          array['admin', 'manager']::text[]
        )
    )
  end;
$$;

revoke all on function private.can_access_basecamp_archive_row(uuid, uuid)
  from public;
grant execute on function private.can_access_basecamp_archive_row(uuid, uuid)
  to authenticated, service_role;

create or replace function private.validate_basecamp_archive_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_organization_id uuid;
  blob_organization_id uuid;
  blob_status text;
begin
  select run.organization_id
  into run_organization_id
  from public.basecamp_export_runs as run
  where run.id = new.run_id;

  if run_organization_id is null then
    raise foreign_key_violation using
      message = 'Basecamp export run does not exist.';
  end if;

  if new.project_id is not null and exists (
    select 1
    from public.projects as project
    where project.id = new.project_id
      and project.organization_id <> run_organization_id
  ) then
    raise check_violation using
      message = 'Archive entry project must belong to the export organization.';
  end if;

  if new.blob_id is not null then
    select blob.organization_id, blob.status
    into blob_organization_id, blob_status
    from public.file_blobs as blob
    where blob.id = new.blob_id
    for key share;

    if blob_organization_id is distinct from run_organization_id then
      raise check_violation using
        message = 'Archive entry blob must belong to the export organization.';
    end if;
    if blob_status = 'deleting' then
      raise object_not_in_prerequisite_state using
        message = 'A blob pending deletion cannot receive new references.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.validate_basecamp_archive_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_organization_id uuid;
  parent_run_id uuid;
  parent_project_id uuid;
begin
  select run.organization_id
  into run_organization_id
  from public.basecamp_export_runs as run
  where run.id = new.run_id;

  if run_organization_id is null then
    raise foreign_key_violation using
      message = 'Basecamp export run does not exist.';
  end if;

  if new.project_id is not null and exists (
    select 1
    from public.projects as project
    where project.id = new.project_id
      and project.organization_id <> run_organization_id
  ) then
    raise check_violation using
      message = 'Archive record project must belong to the export organization.';
  end if;

  if new.parent_id is not null then
    select parent.run_id, parent.project_id
    into parent_run_id, parent_project_id
    from public.basecamp_archive_records as parent
    where parent.id = new.parent_id;

    if parent_run_id is distinct from new.run_id
      or parent_project_id is distinct from new.project_id
    then
      raise check_violation using
        message = 'Archive record parent must remain in the same run and project.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.validate_basecamp_record_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_run_id uuid;
  record_project_id uuid;
  entry_run_id uuid;
  entry_project_id uuid;
begin
  select record.run_id, record.project_id
  into record_run_id, record_project_id
  from public.basecamp_archive_records as record
  where record.id = new.record_id;

  select entry.run_id, entry.project_id
  into entry_run_id, entry_project_id
  from public.basecamp_archive_entries as entry
  where entry.id = new.entry_id;

  if record_run_id is distinct from entry_run_id
    or (
      entry_project_id is not null
      and record_project_id is distinct from entry_project_id
    )
  then
    raise check_violation using
      message = 'Archive record references must remain in the same run and project.';
  end if;

  return new;
end;
$$;

create or replace function private.ensure_file_blob_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  file_organization_id uuid;
  blob public.file_blobs%rowtype;
  run_organization_id uuid;
begin
  select project.organization_id
  into file_organization_id
  from public.projects as project
  where project.id = new.project_id;

  if file_organization_id is null then
    raise foreign_key_violation using message = 'File project does not exist.';
  end if;

  if new.basecamp_export_run_id is not null then
    select run.organization_id
    into run_organization_id
    from public.basecamp_export_runs as run
    where run.id = new.basecamp_export_run_id;

    if run_organization_id is distinct from file_organization_id then
      raise check_violation using
        message = 'Logical file import run must match its organization.';
    end if;
    new.imported_at := coalesce(new.imported_at, now());
  end if;

  if new.blob_id is null then
    if new.bucket_id is null or new.object_path is null then
      if new.source_system is null
        or new.availability_status = 'available'
      then
        raise check_violation using
          message = 'An available logical file requires a physical target.';
      end if;
      return new;
    end if;

    insert into public.file_blobs (
      organization_id,
      bucket_id,
      object_path,
      sha256,
      size_bytes,
      mime_type,
      status,
      verified_at
    )
    values (
      file_organization_id,
      new.bucket_id,
      new.object_path,
      new.checksum_sha256,
      new.size_bytes,
      new.mime_type,
      case when new.checksum_sha256 is null then 'unverified' else 'ready' end,
      case when new.checksum_sha256 is null then null else now() end
    )
    on conflict (bucket_id, object_path) do update
    set object_path = excluded.object_path
    returning * into blob;

    new.blob_id := blob.id;
  else
    select candidate.*
    into blob
    from public.file_blobs as candidate
    where candidate.id = new.blob_id
    for key share;

    if not found then
      raise foreign_key_violation using message = 'File blob does not exist.';
    end if;
  end if;

  if blob.organization_id <> file_organization_id then
    raise check_violation using
      message = 'Logical file and blob must belong to the same organization.';
  end if;
  if blob.status = 'deleting' then
    raise object_not_in_prerequisite_state using
      message = 'A blob pending deletion cannot receive new references.';
  end if;
  if new.bucket_id is not null and (
    new.bucket_id <> blob.bucket_id
    or new.object_path is distinct from blob.object_path
  ) then
    raise check_violation using
      message = 'Logical file physical fields must match its blob.';
  end if;
  if new.size_bytes <> blob.size_bytes then
    raise check_violation using
      message = 'Logical file size must match its blob.';
  end if;

  return new;
end;
$$;

create or replace function private.validate_file_reference_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  file_project_id uuid;
  target_project_id uuid;
begin
  select file.project_id
  into file_project_id
  from public.files as file
  where file.id = new.file_id;

  if file_project_id is null or file_project_id <> new.project_id then
    raise check_violation using
      message = 'File reference project must match its logical file.';
  end if;

  if new.todo_id is not null then
    select todo.project_id into target_project_id
    from public.todos as todo where todo.id = new.todo_id;
  elsif new.comment_id is not null then
    select comment.project_id into target_project_id
    from public.comments as comment where comment.id = new.comment_id;
  elsif new.doc_id is not null then
    select doc.project_id into target_project_id
    from public.docs as doc where doc.id = new.doc_id;
  elsif new.message_id is not null then
    select message.project_id into target_project_id
    from public.messages as message where message.id = new.message_id;
  elsif new.chat_message_id is not null then
    select message.project_id into target_project_id
    from public.chat_messages as message where message.id = new.chat_message_id;
  elsif new.archive_record_id is not null then
    select record.project_id into target_project_id
    from public.basecamp_archive_records as record
    where record.id = new.archive_record_id;
  end if;

  if target_project_id is null or target_project_id <> new.project_id then
    raise check_violation using
      message = 'File reference target must belong to the logical file project.';
  end if;

  return new;
end;
$$;

create or replace function private.require_staging_basecamp_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_run_id uuid;
  changed_project_id uuid;
begin
  changed_run_id := case when tg_op = 'DELETE' then old.run_id else new.run_id end;
  changed_project_id :=
    case when tg_op = 'DELETE' then old.project_id else new.project_id end;

  perform 1
  from public.basecamp_export_runs as run
  join public.basecamp_export_project_status as project_status
    on project_status.run_id = run.id
   and project_status.project_id = changed_project_id
  where run.id = changed_run_id
    and run.status in ('inventory', 'staging')
    and project_status.status = 'staging'
  for key share of run, project_status;

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'Basecamp export staging is immutable after it becomes ready.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.mark_basecamp_import_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.basecamp_import_mode', true), '') <> 'on' then
    return new;
  end if;

  new.imported_at := coalesce(new.imported_at, statement_timestamp());
  if tg_op = 'INSERT' then
    new.created_at := statement_timestamp();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_basecamp_archive_entry() from public;
revoke all on function private.validate_basecamp_archive_record() from public;
revoke all on function private.validate_basecamp_record_entry() from public;
revoke all on function private.ensure_file_blob_consistency() from public;
revoke all on function private.validate_file_reference_project() from public;
revoke all on function private.require_staging_basecamp_export() from public;
revoke all on function private.mark_basecamp_import_timestamp() from public;

create trigger validate_basecamp_archive_entry
  before insert or update on public.basecamp_archive_entries
  for each row execute function private.validate_basecamp_archive_entry();
create trigger validate_basecamp_archive_record
  before insert or update on public.basecamp_archive_records
  for each row execute function private.validate_basecamp_archive_record();
create trigger validate_basecamp_record_entry
  before insert or update on public.basecamp_archive_record_entries
  for each row execute function private.validate_basecamp_record_entry();
create trigger a_ensure_file_blob_consistency
  before insert or update of
    project_id,
    blob_id,
    bucket_id,
    object_path,
    size_bytes,
    checksum_sha256,
    basecamp_export_run_id
  on public.files
  for each row execute function private.ensure_file_blob_consistency();
create trigger validate_file_reference_project
  before insert or update on public.file_references
  for each row execute function private.validate_file_reference_project();
create trigger require_staging_basecamp_export
  before insert or update or delete on public.basecamp_export_stage
  for each row execute function private.require_staging_basecamp_export();

create trigger mark_imported_docs_timestamp
  before insert or update on public.docs
  for each row execute function private.mark_basecamp_import_timestamp();
create trigger mark_imported_messages_timestamp
  before insert or update on public.messages
  for each row execute function private.mark_basecamp_import_timestamp();
create trigger mark_imported_comments_timestamp
  before insert or update on public.comments
  for each row execute function private.mark_basecamp_import_timestamp();
create trigger mark_imported_files_timestamp
  before insert or update on public.files
  for each row execute function private.mark_basecamp_import_timestamp();

create or replace function private.project_id_for_scoped_row(
  target_table text,
  row_data jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  case target_table
    when 'projects' then
      result := nullif(row_data ->> 'id', '')::uuid;
    when 'todo_assignees', 'todo_completion_subscribers', 'todo_subtasks' then
      select todo.project_id
      into result
      from public.todos as todo
      where todo.id = nullif(row_data ->> 'todo_id', '')::uuid;
    when 'comment_mentions', 'comment_attachments' then
      select comment.project_id
      into result
      from public.comments as comment
      where comment.id = nullif(row_data ->> 'comment_id', '')::uuid;
    else
      result := nullif(row_data ->> 'project_id', '')::uuid;
  end case;

  return result;
end;
$$;

create or replace function private.enforce_project_read_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_data jsonb;
  new_data jsonb;
  old_project_id uuid;
  new_project_id uuid;
begin
  if (select auth.role()) is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  old_data := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_data := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  if tg_table_name = 'projects' then
    if tg_op = 'INSERT' and coalesce((new_data ->> 'is_read_only')::boolean, false) then
      raise insufficient_privilege using
        message = 'Archived projects can only be created by the importer.';
    end if;
    if tg_op <> 'INSERT'
      and coalesce((old_data ->> 'is_read_only')::boolean, false)
    then
      raise insufficient_privilege using
        message = 'Archived projects are read-only.';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if old_data is not null then
    old_project_id := private.project_id_for_scoped_row(
      tg_table_name,
      old_data
    );
  end if;
  if new_data is not null then
    new_project_id := private.project_id_for_scoped_row(
      tg_table_name,
      new_data
    );
  end if;

  if exists (
    select 1
    from public.projects as project
    where project.id in (old_project_id, new_project_id)
      and project.is_read_only
  ) then
    raise insufficient_privilege using
      message = 'Archived projects are read-only.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.project_id_for_scoped_row(text, jsonb)
  from public;
revoke all on function private.enforce_project_read_only() from public;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects',
    'project_members',
    'todo_lists',
    'todos',
    'todo_assignees',
    'todo_completion_subscribers',
    'todo_subtasks',
    'docs',
    'messages',
    'comments',
    'comment_mentions',
    'comment_attachments',
    'files',
    'file_references',
    'chat_messages',
    'milestones',
    'activity_events',
    'accelo_sync_runs',
    'sync_conflicts',
    'upload_reservations'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I
       for each row execute function private.enforce_project_read_only()',
      'block_read_only_' || table_name,
      table_name
    );
  end loop;
end;
$$;

alter table public.basecamp_export_runs enable row level security;
alter table public.file_blobs enable row level security;
alter table public.basecamp_archive_entries enable row level security;
alter table public.basecamp_archive_records enable row level security;
alter table public.basecamp_archive_record_entries enable row level security;
alter table public.file_references enable row level security;
alter table public.basecamp_export_stage enable row level security;
alter table public.basecamp_export_project_status enable row level security;
alter table public.basecamp_export_preimages enable row level security;
alter table public.basecamp_export_conflicts enable row level security;

revoke all on
  public.basecamp_export_runs,
  public.file_blobs,
  public.basecamp_archive_entries,
  public.basecamp_archive_records,
  public.basecamp_archive_record_entries,
  public.file_references,
  public.basecamp_export_stage,
  public.basecamp_export_project_status,
  public.basecamp_export_preimages,
  public.basecamp_export_conflicts
from public, anon, authenticated;

grant all on
  public.basecamp_export_runs,
  public.file_blobs,
  public.basecamp_archive_entries,
  public.basecamp_archive_records,
  public.basecamp_archive_record_entries,
  public.file_references,
  public.basecamp_export_stage,
  public.basecamp_export_project_status,
  public.basecamp_export_preimages,
  public.basecamp_export_conflicts
to service_role;

grant select on
  public.basecamp_export_runs,
  public.basecamp_archive_entries,
  public.basecamp_archive_records,
  public.basecamp_archive_record_entries,
  public.file_references
to authenticated;

grant insert, update, delete on public.file_references to authenticated;

create policy "Managers can read Basecamp export runs"
on public.basecamp_export_runs
for select
to authenticated
using (
  (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);

create policy "Authorized users can read Basecamp archive entries"
on public.basecamp_archive_entries
for select
to authenticated
using (
  (select private.can_access_basecamp_archive_row(run_id, project_id))
);

create policy "Authorized users can read Basecamp archive records"
on public.basecamp_archive_records
for select
to authenticated
using (
  (select private.can_access_basecamp_archive_row(run_id, project_id))
);

create policy "Authorized users can read Basecamp record entries"
on public.basecamp_archive_record_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.basecamp_archive_records as record
    where record.id = record_id
      and private.can_access_basecamp_archive_row(
        record.run_id,
        record.project_id
      )
  )
);

create policy "Project members can read file references"
on public.file_references
for select
to authenticated
using ((select private.can_access_project(project_id)));

create policy "Project members can create file references"
on public.file_references
for insert
to authenticated
with check ((select private.can_access_project(project_id)));

create policy "Project members can update file references"
on public.file_references
for update
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Project members can delete file references"
on public.file_references
for delete
to authenticated
using ((select private.can_access_project(project_id)));

-- Keep native file routes compatible while withholding physical blob identity,
-- hashes, source checksums, and raw source payloads from direct client reads.
revoke select on public.files from authenticated;
grant select (
  id,
  project_id,
  uploaded_by,
  bucket_id,
  object_path,
  file_name,
  mime_type,
  size_bytes,
  metadata,
  created_at,
  updated_at,
  source_system,
  source_account_id,
  source_file_id,
  source_path,
  source_uploader_id,
  source_created_at,
  source_updated_at,
  source_exported_at,
  availability_status,
  listing_position,
  basecamp_account_id,
  basecamp_upload_id,
  basecamp_export_run_id,
  imported_at
) on public.files to authenticated;

create or replace function private.in_basecamp_import_mode()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.basecamp_import_mode', true), '') = 'on';
$$;

revoke all on function private.in_basecamp_import_mode() from public;

create or replace function private.capture_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  activity_project_id uuid;
  activity_organization_id uuid;
  activity_entity_id uuid;
  activity_label text;
begin
  if private.in_basecamp_import_mode() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  activity_entity_id := nullif(row_data ->> 'id', '')::uuid;

  if tg_table_name = 'projects' then
    activity_project_id := activity_entity_id;
    activity_organization_id := nullif(row_data ->> 'organization_id', '')::uuid;
  else
    activity_project_id := nullif(row_data ->> 'project_id', '')::uuid;
    activity_organization_id := nullif(row_data ->> 'organization_id', '')::uuid;
  end if;

  if activity_project_id is not null then
    select project.organization_id
    into activity_organization_id
    from public.projects as project
    where project.id = activity_project_id;

    if not found then
      activity_project_id := null;
    end if;
  end if;

  activity_label := left(
    coalesce(
      nullif(row_data ->> 'title', ''),
      nullif(row_data ->> 'name', ''),
      nullif(row_data ->> 'file_name', ''),
      nullif(row_data ->> 'subject', '')
    ),
    160
  );

  insert into public.activity_events (
    organization_id,
    project_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    summary,
    metadata
  )
  values (
    activity_organization_id,
    activity_project_id,
    (select auth.uid()),
    tg_argv[0],
    activity_entity_id,
    lower(tg_op),
    activity_label,
    jsonb_build_object('table', tg_table_name)
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.queue_todo_completion_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscriber record;
begin
  if private.in_basecamp_import_mode()
    or new.status <> 'done'
    or old.status = 'done'
    or new.completed_at is null
  then
    return new;
  end if;

  for subscriber in
    select distinct nullif(btrim(profile.preferences ->> 'slack_user_id'), '')
      as channel
    from public.todo_completion_subscribers as subscription
    join public.profiles as profile
      on profile.id = subscription.profile_id
     and profile.status = 'active'
    where subscription.todo_id = new.id
      and subscription.profile_id is distinct from new.completed_by
      and nullif(btrim(profile.preferences ->> 'slack_user_id'), '') is not null
  loop
    insert into public.slack_notification_outbox (
      event_type,
      channel,
      payload,
      idempotency_key
    )
    values (
      'todo.completed',
      subscriber.channel,
      jsonb_build_object(
        'text', 'Completed: ' || new.title,
        'metadata', jsonb_build_object(
          'todoId', new.id,
          'projectId', new.project_id
        )
      ),
      format(
        'todo.completed:%s:%s:%s',
        new.id,
        new.version,
        subscriber.channel
      )
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  return new;
end;
$$;

create or replace function private.queue_todo_comment_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscriber record;
  todo_title text;
begin
  if private.in_basecamp_import_mode()
    or new.todo_id is null
    or new.created_at < statement_timestamp() - interval '5 minutes'
  then
    return new;
  end if;

  select todo.title
  into todo_title
  from public.todos as todo
  where todo.id = new.todo_id
    and todo.project_id = new.project_id;

  if todo_title is null then
    return new;
  end if;

  for subscriber in
    select distinct nullif(btrim(profile.preferences ->> 'slack_user_id'), '')
      as channel
    from public.todo_completion_subscribers as subscription
    join public.profiles as profile
      on profile.id = subscription.profile_id
     and profile.status = 'active'
    where subscription.todo_id = new.todo_id
      and subscription.profile_id is distinct from new.author_id
      and nullif(btrim(profile.preferences ->> 'slack_user_id'), '') is not null
  loop
    insert into public.slack_notification_outbox (
      event_type,
      channel,
      payload,
      idempotency_key
    )
    values (
      'todo.comment.created',
      subscriber.channel,
      jsonb_build_object(
        'text',
        format(
          'New comment on %s: %s',
          todo_title,
          left(regexp_replace(new.body, '\s+', ' ', 'g'), 180)
        ),
        'metadata', jsonb_build_object(
          'commentId', new.id,
          'todoId', new.todo_id,
          'projectId', new.project_id
        )
      ),
      format(
        'todo.comment.created:%s:%s',
        new.id,
        subscriber.channel
      )
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  return new;
end;
$$;

create or replace function private.enqueue_slack_notification(
  notification_event_type text,
  notification_channel text,
  notification_text text,
  notification_blocks jsonb default null,
  notification_thread_ts text default null,
  notification_idempotency_key text default null,
  notification_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  result_payload jsonb;
begin
  if private.in_basecamp_import_mode() then
    return null;
  end if;
  if not (select private.is_internal_user()) then
    raise insufficient_privilege using message = 'An active account is required.';
  end if;
  if char_length(btrim(coalesce(notification_event_type, ''))) not between 1 and 120 then
    raise check_violation using message = 'A notification event type is required.';
  end if;
  if char_length(btrim(coalesce(notification_channel, ''))) not between 1 and 255 then
    raise check_violation using message = 'A Slack channel is required.';
  end if;
  if char_length(btrim(coalesce(notification_text, ''))) not between 1 and 40000 then
    raise check_violation using message = 'Slack notification text is required.';
  end if;
  if notification_blocks is not null
    and jsonb_typeof(notification_blocks) <> 'array'
  then
    raise check_violation using message = 'Slack blocks must be an array.';
  end if;

  result_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'text', notification_text,
      'blocks', notification_blocks,
      'threadTs', nullif(btrim(notification_thread_ts), ''),
      'metadata', coalesce(notification_metadata, '{}'::jsonb)
    )
  );

  insert into public.slack_notification_outbox (
    event_type,
    channel,
    payload,
    idempotency_key
  )
  values (
    notification_event_type,
    notification_channel,
    result_payload,
    nullif(btrim(notification_idempotency_key), '')
  )
  on conflict (idempotency_key) do update
  set idempotency_key = excluded.idempotency_key
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function private.can_access_upload_project(
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    where project.id = target_project_id
      and not project.is_read_only
      and private.can_access_project(project.id)
  );
$$;

revoke all on function private.can_access_upload_project(uuid) from public;
grant execute on function private.can_access_upload_project(uuid)
  to authenticated, service_role;

create or replace function private.enqueue_storage_deletion(
  target_bucket_id text,
  target_object_path text,
  deletion_reason text,
  deletion_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
begin
  if target_bucket_id not in ('project-files', 'workspace-chat-files') then
    raise check_violation using message = 'Unsupported storage bucket.';
  end if;

  if target_bucket_id = 'project-files' and exists (
    select 1
    from public.file_blobs as blob
    where blob.bucket_id = target_bucket_id
      and blob.object_path = target_object_path
      and (
        exists (
          select 1 from public.files as file
          where file.blob_id = blob.id
        )
        or exists (
          select 1 from public.basecamp_archive_entries as entry
          where entry.blob_id = blob.id
        )
      )
  ) then
    update public.storage_deletion_outbox as deletion
    set
      status = 'completed',
      completed_at = now(),
      locked_at = null,
      locked_until = null,
      lock_token = null,
      last_error = null,
      metadata = deletion.metadata || jsonb_build_object(
        'cancelledBecauseReferenced', true
      )
    where deletion.bucket_id = target_bucket_id
      and deletion.object_path = target_object_path
    returning deletion.id into result_id;

    update public.storage_reconciliation_issues as issue
    set resolved_at = now(), last_seen_at = now()
    where issue.issue_type = 'orphan_object'
      and issue.bucket_id = target_bucket_id
      and issue.object_path = target_object_path
      and issue.resolved_at is null;

    return result_id;
  end if;

  insert into public.storage_deletion_outbox (
    bucket_id,
    object_path,
    reason,
    metadata
  )
  values (
    target_bucket_id,
    target_object_path,
    left(deletion_reason, 120),
    coalesce(deletion_metadata, '{}'::jsonb)
  )
  on conflict (bucket_id, object_path) do update
  set
    reason = excluded.reason,
    metadata = public.storage_deletion_outbox.metadata || excluded.metadata,
    status = case
      when public.storage_deletion_outbox.status = 'completed' then 'pending'
      else public.storage_deletion_outbox.status
    end,
    available_at = case
      when public.storage_deletion_outbox.status = 'completed' then now()
      else public.storage_deletion_outbox.available_at
    end,
    completed_at = case
      when public.storage_deletion_outbox.status = 'completed' then null
      else public.storage_deletion_outbox.completed_at
    end
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function private.enqueue_unreferenced_file_blob(
  target_blob_id uuid,
  deletion_reason text,
  deletion_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  blob public.file_blobs%rowtype;
begin
  if target_blob_id is null then
    return null;
  end if;

  select candidate.*
  into blob
  from public.file_blobs as candidate
  where candidate.id = target_blob_id
  for update;

  if not found
    or exists (select 1 from public.files as file where file.blob_id = blob.id)
    or exists (
      select 1
      from public.basecamp_archive_entries as entry
      where entry.blob_id = blob.id
    )
  then
    return null;
  end if;

  update public.file_blobs
  set status = 'deleting', last_error = null
  where id = blob.id
    and status <> 'deleting';

  return private.enqueue_storage_deletion(
    blob.bucket_id,
    blob.object_path,
    deletion_reason,
    coalesce(deletion_metadata, '{}'::jsonb)
      || jsonb_build_object('blobId', blob.id)
  );
end;
$$;

create or replace function private.queue_unreferenced_file_blob()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_blob_id uuid;
  prior_row jsonb;
begin
  prior_row := to_jsonb(old);
  prior_blob_id := old.blob_id;

  if tg_table_name = 'files' then
    update public.upload_reservations as reservation
    set
      status = 'failed',
      resource_id = null,
      finalized_at = null,
      failure_reason = 'finalized_metadata_deleted'
    where reservation.resource_id = old.id
      and reservation.target_kind = 'project_file'
      and reservation.status = 'finalized';
  end if;

  if prior_blob_id is not null
    and (
      tg_op = 'DELETE'
      or prior_blob_id is distinct from new.blob_id
    )
  then
    perform private.enqueue_unreferenced_file_blob(
      prior_blob_id,
      tg_table_name || '_blob_unreferenced',
      jsonb_build_object(
        'resourceId', old.id,
        'sourceTable', tg_table_name
      )
    );
  elsif prior_blob_id is null
    and tg_table_name = 'files'
    and tg_op = 'DELETE'
    and nullif(prior_row ->> 'bucket_id', '') is not null
    and nullif(prior_row ->> 'object_path', '') is not null
  then
    perform private.enqueue_storage_deletion(
      prior_row ->> 'bucket_id',
      prior_row ->> 'object_path',
      'legacy_project_file_metadata_deleted',
      jsonb_build_object('resourceId', old.id)
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.enqueue_unreferenced_file_blob(uuid, text, jsonb)
  from public;
revoke all on function private.queue_unreferenced_file_blob() from public;

drop trigger if exists queue_deleted_project_file_object on public.files;
create trigger queue_unreferenced_project_file_blob
  after delete or update of blob_id on public.files
  for each row execute function private.queue_unreferenced_file_blob();
create trigger queue_unreferenced_archive_entry_blob
  after delete or update of blob_id on public.basecamp_archive_entries
  for each row execute function private.queue_unreferenced_file_blob();

create or replace function private.ack_storage_deletion(
  deletion_id uuid,
  deletion_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion public.storage_deletion_outbox;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  update public.storage_deletion_outbox
  set
    status = 'completed',
    completed_at = now(),
    locked_at = null,
    locked_until = null,
    lock_token = null,
    last_error = null
  where id = deletion_id
    and lock_token = deletion_lock_token
    and status = 'processing'
  returning * into deletion;

  if not found then
    return false;
  end if;

  update public.storage_reconciliation_issues
  set resolved_at = now(), last_seen_at = now()
  where bucket_id = deletion.bucket_id
    and object_path = deletion.object_path
    and resolved_at is null;

  delete from public.file_blobs as blob
  where blob.bucket_id = deletion.bucket_id
    and blob.object_path = deletion.object_path
    and blob.status = 'deleting'
    and not exists (
      select 1 from public.files as file where file.blob_id = blob.id
    )
    and not exists (
      select 1
      from public.basecamp_archive_entries as entry
      where entry.blob_id = blob.id
    );

  return true;
end;
$$;

revoke all on function private.ack_storage_deletion(uuid, uuid) from public;
grant execute on function private.ack_storage_deletion(uuid, uuid)
  to service_role;

create or replace function private.can_read_project_blob(
  target_bucket_id text,
  target_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.file_blobs as blob
    where blob.bucket_id = target_bucket_id
      and blob.object_path = target_object_path
      and blob.status in ('ready', 'unverified')
      and (
        exists (
          select 1
          from public.files as file
          where file.blob_id = blob.id
            and file.availability_status = 'available'
            and private.can_access_project(file.project_id)
        )
        or exists (
          select 1
          from public.basecamp_archive_entries as entry
          where entry.blob_id = blob.id
            and private.can_access_basecamp_archive_row(
              entry.run_id,
              entry.project_id
            )
        )
      )
  );
$$;

revoke all on function private.can_read_project_blob(text, text) from public;
grant execute on function private.can_read_project_blob(text, text)
  to authenticated, service_role;

drop policy if exists "Project members can read finalized project files"
  on storage.objects;
create policy "Authorized users can read project blobs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-files'
  and (select private.can_read_project_blob(bucket_id, name))
);

-- Full exports use resumable uploads up to 4 GiB. Interactive reservations
-- remain capped at 25 MiB by upload_reservations and its RPC validation.
update storage.buckets
set file_size_limit = 4294967296
where id = 'project-files';

create or replace function private.run_operations_cleanup(
  requested_batch_size integer default 250,
  dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_size integer := least(
    greatest(coalesce(requested_batch_size, 250), 1),
    1000
  );
  activity_count integer := 0;
  sync_run_count integer := 0;
  sync_conflict_count integer := 0;
  expired_invite_count integer := 0;
  accepted_invite_count integer := 0;
  expired_reservation_count integer := 0;
  pending_attachment_count integer := 0;
  chat_message_count integer := 0;
  project_message_count integer := 0;
  project_comment_count integer := 0;
  project_doc_count integer := 0;
  project_file_count integer := 0;
  orphan_object_count integer := 0;
  missing_object_count integer := 0;
  candidate record;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  if dry_run then
    select count(*) into activity_count from (
      select id from public.activity_events
      where created_at < now() - interval '365 days'
      order by created_at, id limit batch_size
    ) as candidates;
    select count(*) into sync_run_count from (
      select id from public.accelo_sync_runs
      where created_at < now() - interval '90 days'
      order by created_at, id limit batch_size
    ) as candidates;
    select count(*) into sync_conflict_count from (
      select id from public.sync_conflicts
      where resolution <> 'unresolved'
        and coalesce(resolved_at, updated_at) < now() - interval '90 days'
      order by coalesce(resolved_at, updated_at), id limit batch_size
    ) as candidates;
    select count(*) into expired_invite_count from (
      select id from public.invites
      where status in ('expired', 'revoked')
        and updated_at < now() - interval '90 days'
      order by updated_at, id limit batch_size
    ) as candidates;
    select count(*) into accepted_invite_count from (
      select id from public.invites
      where status = 'accepted'
        and coalesce(accepted_at, updated_at) < now() - interval '365 days'
      order by coalesce(accepted_at, updated_at), id limit batch_size
    ) as candidates;
    select count(*) into expired_reservation_count from (
      select id from public.upload_reservations
      where status = 'pending' and expires_at <= now()
      order by expires_at, id limit batch_size
    ) as candidates;
    select count(*) into pending_attachment_count from (
      select id from public.workspace_message_attachments
      where message_id is null
        and created_at < now() - interval '24 hours'
      order by created_at, id limit batch_size
    ) as candidates;
  else
    with candidates as (
      select id from public.activity_events
      where created_at < now() - interval '365 days'
      order by created_at, id
      for update skip locked limit batch_size
    )
    delete from public.activity_events as target
    using candidates
    where target.id = candidates.id;
    get diagnostics activity_count = row_count;

    with candidates as (
      select id from public.accelo_sync_runs
      where created_at < now() - interval '90 days'
      order by created_at, id
      for update skip locked limit batch_size
    )
    delete from public.accelo_sync_runs as target
    using candidates
    where target.id = candidates.id;
    get diagnostics sync_run_count = row_count;

    with candidates as (
      select id from public.sync_conflicts
      where resolution <> 'unresolved'
        and coalesce(resolved_at, updated_at) < now() - interval '90 days'
      order by coalesce(resolved_at, updated_at), id
      for update skip locked limit batch_size
    )
    delete from public.sync_conflicts as target
    using candidates
    where target.id = candidates.id;
    get diagnostics sync_conflict_count = row_count;

    with candidates as (
      select id from public.invites
      where status in ('expired', 'revoked')
        and updated_at < now() - interval '90 days'
      order by updated_at, id
      for update skip locked limit batch_size
    )
    delete from public.invites as target
    using candidates
    where target.id = candidates.id;
    get diagnostics expired_invite_count = row_count;

    with candidates as (
      select id from public.invites
      where status = 'accepted'
        and coalesce(accepted_at, updated_at) < now() - interval '365 days'
      order by coalesce(accepted_at, updated_at), id
      for update skip locked limit batch_size
    )
    delete from public.invites as target
    using candidates
    where target.id = candidates.id;
    get diagnostics accepted_invite_count = row_count;

    for candidate in
      with candidates as (
        select id from public.upload_reservations
        where status = 'pending' and expires_at <= now()
        order by expires_at, id
        for update skip locked limit batch_size
      )
      update public.upload_reservations as reservation
      set status = 'failed', failure_reason = 'reservation_expired'
      from candidates
      where reservation.id = candidates.id
      returning reservation.*
    loop
      expired_reservation_count := expired_reservation_count + 1;
      perform private.enqueue_storage_deletion(
        candidate.bucket_id,
        candidate.object_path,
        'expired_upload_reservation',
        jsonb_build_object('reservationId', candidate.id)
      );
    end loop;

    with candidates as (
      select id from public.workspace_message_attachments
      where message_id is null
        and created_at < now() - interval '24 hours'
      order by created_at, id
      for update skip locked limit batch_size
    )
    delete from public.workspace_message_attachments as target
    using candidates
    where target.id = candidates.id;
    get diagnostics pending_attachment_count = row_count;
  end if;

  if dry_run then
    select count(*) into chat_message_count from (
      select message.id
      from public.workspace_messages as message
      join public.workspace_conversations as conversation
        on conversation.id = message.conversation_id
      join public.organizations as organization
        on organization.id = conversation.organization_id
      where not private.has_legal_hold(organization.settings)
        and message.created_at < now() - make_interval(
          days => private.retention_days(
            organization.settings,
            'chat_retention_days',
            1095
          )
        )
      order by message.created_at, message.id limit batch_size
    ) as candidates;
  else
    with candidates as (
      select message.id
      from public.workspace_messages as message
      join public.workspace_conversations as conversation
        on conversation.id = message.conversation_id
      join public.organizations as organization
        on organization.id = conversation.organization_id
      where not private.has_legal_hold(organization.settings)
        and message.created_at < now() - make_interval(
          days => private.retention_days(
            organization.settings,
            'chat_retention_days',
            1095
          )
        )
      order by message.created_at, message.id
      for update of message skip locked limit batch_size
    )
    delete from public.workspace_messages as target
    using candidates
    where target.id = candidates.id;
    get diagnostics chat_message_count = row_count;
  end if;

  if dry_run then
    select count(*) into project_message_count from (
      select item.id
      from public.messages as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      limit batch_size
    ) as candidates;
    select count(*) into project_comment_count from (
      select item.id
      from public.comments as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      limit batch_size
    ) as candidates;
    select count(*) into project_doc_count from (
      select item.id
      from public.docs as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      limit batch_size
    ) as candidates;
    select count(*) into project_file_count from (
      select item.id
      from public.files as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      limit batch_size
    ) as candidates;
  else
    with candidates as (
      select item.id
      from public.messages as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      for update of item skip locked limit batch_size
    )
    delete from public.messages as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_message_count = row_count;

    with candidates as (
      select item.id
      from public.comments as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      for update of item skip locked limit batch_size
    )
    delete from public.comments as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_comment_count = row_count;

    with candidates as (
      select item.id
      from public.docs as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      for update of item skip locked limit batch_size
    )
    delete from public.docs as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_doc_count = row_count;

    with candidates as (
      select item.id
      from public.files as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and coalesce(item.imported_at, item.created_at) < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by coalesce(item.imported_at, item.created_at), item.id
      for update of item skip locked limit batch_size
    )
    delete from public.files as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_file_count = row_count;
  end if;

  select count(*) into orphan_object_count
  from (
    select object.id
    from storage.objects as object
    where object.bucket_id in ('project-files', 'workspace-chat-files')
      and object.created_at < now() - interval '24 hours'
      and not exists (
        select 1
        from public.file_blobs as blob
        where blob.bucket_id = object.bucket_id
          and blob.object_path = object.name
      )
      and not exists (
        select 1
        from public.workspace_message_attachments as attachment
        where attachment.bucket_id = object.bucket_id
          and attachment.object_path = object.name
      )
      and not exists (
        select 1
        from public.upload_reservations as reservation
        where reservation.bucket_id = object.bucket_id
          and reservation.object_path = object.name
          and reservation.status = 'pending'
          and reservation.expires_at > now()
      )
    order by object.created_at, object.id
    limit batch_size
  ) as candidates;

  if not dry_run then
    for candidate in
      select object.bucket_id, object.name as object_path
      from storage.objects as object
      where object.bucket_id in ('project-files', 'workspace-chat-files')
        and object.created_at < now() - interval '24 hours'
        and not exists (
          select 1
          from public.file_blobs as blob
          where blob.bucket_id = object.bucket_id
            and blob.object_path = object.name
        )
        and not exists (
          select 1
          from public.workspace_message_attachments as attachment
          where attachment.bucket_id = object.bucket_id
            and attachment.object_path = object.name
        )
        and not exists (
          select 1
          from public.upload_reservations as reservation
          where reservation.bucket_id = object.bucket_id
            and reservation.object_path = object.name
            and reservation.status = 'pending'
            and reservation.expires_at > now()
        )
      order by object.created_at, object.id
      limit batch_size
    loop
      insert into public.storage_reconciliation_issues (
        issue_type,
        bucket_id,
        object_path
      )
      values ('orphan_object', candidate.bucket_id, candidate.object_path)
      on conflict (issue_type, bucket_id, object_path) do update
      set last_seen_at = now(), resolved_at = null;
      perform private.enqueue_storage_deletion(
        candidate.bucket_id,
        candidate.object_path,
        'orphan_storage_object',
        '{}'::jsonb
      );
    end loop;
  end if;

  select count(*) into missing_object_count
  from (
    select blob.id
    from public.file_blobs as blob
    where blob.status in ('ready', 'unverified')
      and not exists (
        select 1
        from storage.objects as object
        where object.bucket_id = blob.bucket_id
          and object.name = blob.object_path
      )
    union all
    select attachment.id
    from public.workspace_message_attachments as attachment
    where not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = attachment.bucket_id
        and object.name = attachment.object_path
    )
    limit batch_size
  ) as candidates;

  if not dry_run then
    with candidates as (
      select blob.id, blob.bucket_id, blob.object_path
      from public.file_blobs as blob
      where blob.status in ('ready', 'unverified')
        and not exists (
          select 1
          from storage.objects as object
          where object.bucket_id = blob.bucket_id
            and object.name = blob.object_path
        )
      order by blob.created_at, blob.id
      for update of blob skip locked
      limit batch_size
    ),
    marked as (
      update public.file_blobs as blob
      set status = 'missing', last_error = 'storage_object_missing'
      from candidates
      where blob.id = candidates.id
      returning blob.id, blob.bucket_id, blob.object_path
    )
    insert into public.storage_reconciliation_issues (
      issue_type,
      bucket_id,
      object_path,
      metadata
    )
    select
      'missing_object',
      marked.bucket_id,
      marked.object_path,
      jsonb_build_object('blobId', marked.id, 'targetKind', 'file_blob')
    from marked
    on conflict (issue_type, bucket_id, object_path) do update
    set
      last_seen_at = now(),
      resolved_at = null,
      metadata = excluded.metadata;

    insert into public.storage_reconciliation_issues (
      issue_type,
      bucket_id,
      object_path,
      metadata
    )
    select
      'missing_object',
      attachment.bucket_id,
      attachment.object_path,
      jsonb_build_object(
        'resourceId',
        attachment.id,
        'targetKind',
        'chat_attachment'
      )
    from public.workspace_message_attachments as attachment
    where not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = attachment.bucket_id
        and object.name = attachment.object_path
    )
    order by attachment.created_at, attachment.id
    limit batch_size
    on conflict (issue_type, bucket_id, object_path) do update
    set
      last_seen_at = now(),
      resolved_at = null,
      metadata = excluded.metadata;
  end if;

  return jsonb_build_object(
    'dryRun', dry_run,
    'batchSize', batch_size,
    'retention', jsonb_build_object(
      'activity365Days', activity_count,
      'syncRuns90Days', sync_run_count,
      'resolvedSyncConflicts90Days', sync_conflict_count,
      'expiredRevokedInvites90Days', expired_invite_count,
      'acceptedInvites365Days', accepted_invite_count,
      'pendingUploads24Hours', expired_reservation_count,
      'pendingChatAttachments24Hours', pending_attachment_count,
      'chatContent1095Days', chat_message_count,
      'projectMessages1095Days', project_message_count,
      'projectComments1095Days', project_comment_count,
      'projectDocs1095Days', project_doc_count,
      'projectFiles1095Days', project_file_count
    ),
    'reconciliation', jsonb_build_object(
      'orphanObjects', orphan_object_count,
      'missingObjects', missing_object_count
    )
  );
end;
$$;

revoke all on function private.run_operations_cleanup(integer, boolean)
  from public;
grant execute on function private.run_operations_cleanup(integer, boolean)
  to service_role;
