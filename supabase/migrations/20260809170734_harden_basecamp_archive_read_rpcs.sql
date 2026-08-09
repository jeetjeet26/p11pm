alter function public.list_basecamp_archive_projects(
  uuid,
  uuid,
  text,
  uuid,
  integer
) set schema private;

alter function public.search_basecamp_archive(
  uuid,
  text,
  uuid,
  text,
  real,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) set schema private;

alter function public.list_basecamp_archive_records(
  uuid,
  text,
  uuid,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) set schema private;

alter function public.get_basecamp_project_archive_counts(uuid, uuid)
  set schema private;

revoke all on function private.list_basecamp_archive_projects(
  uuid,
  uuid,
  text,
  uuid,
  integer
) from public, anon;
revoke all on function private.search_basecamp_archive(
  uuid,
  text,
  uuid,
  text,
  real,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) from public, anon;
revoke all on function private.list_basecamp_archive_records(
  uuid,
  text,
  uuid,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) from public, anon;
revoke all on function private.get_basecamp_project_archive_counts(uuid, uuid)
  from public, anon;

grant execute on function private.list_basecamp_archive_projects(
  uuid,
  uuid,
  text,
  uuid,
  integer
) to authenticated, service_role;
grant execute on function private.search_basecamp_archive(
  uuid,
  text,
  uuid,
  text,
  real,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) to authenticated, service_role;
grant execute on function private.list_basecamp_archive_records(
  uuid,
  text,
  uuid,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) to authenticated, service_role;
grant execute on function private.get_basecamp_project_archive_counts(uuid, uuid)
  to authenticated, service_role;

create function public.list_basecamp_archive_projects(
  organization_id uuid,
  run_id uuid default null,
  after_project_name text default null,
  after_project_id uuid default null,
  page_size integer default 50
)
returns table (
  project_id uuid,
  project_name text,
  project_status text,
  is_read_only boolean,
  export_run_id uuid,
  exported_at timestamptz,
  record_count bigint,
  entry_count bigint,
  file_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.list_basecamp_archive_projects($1, $2, $3, $4, $5);
$$;

create function public.search_basecamp_archive(
  target_organization_id uuid,
  search_query text,
  target_project_id uuid default null,
  target_record_type text default null,
  after_rank real default null,
  after_source_updated_at timestamptz default null,
  after_record_id uuid default null,
  page_size integer default 50,
  source_from timestamptz default null,
  source_to timestamptz default null
)
returns table (
  record_id uuid,
  export_run_id uuid,
  project_id uuid,
  parent_id uuid,
  record_type text,
  title text,
  plain_text_excerpt text,
  source_updated_at timestamptz,
  rank real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.search_basecamp_archive(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
  );
$$;

create function public.list_basecamp_archive_records(
  target_project_id uuid,
  target_record_type text default null,
  target_parent_id uuid default null,
  after_source_updated_at timestamptz default null,
  after_record_id uuid default null,
  page_size integer default 50,
  source_from timestamptz default null,
  source_to timestamptz default null
)
returns table (
  record_id uuid,
  export_run_id uuid,
  parent_id uuid,
  record_type text,
  native_recording_id bigint,
  title text,
  sanitized_html text,
  plain_text text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_status text,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.list_basecamp_archive_records(
    $1, $2, $3, $4, $5, $6, $7, $8
  );
$$;

create function public.get_basecamp_project_archive_counts(
  project_id uuid,
  run_id uuid default null
)
returns table (
  export_run_id uuid,
  record_count bigint,
  entry_count bigint,
  imported_file_count bigint,
  record_types jsonb,
  entry_classifications jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_basecamp_project_archive_counts($1, $2);
$$;

revoke all on function public.list_basecamp_archive_projects(
  uuid,
  uuid,
  text,
  uuid,
  integer
) from public, anon;
revoke all on function public.search_basecamp_archive(
  uuid,
  text,
  uuid,
  text,
  real,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) from public, anon;
revoke all on function public.list_basecamp_archive_records(
  uuid,
  text,
  uuid,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) from public, anon;
revoke all on function public.get_basecamp_project_archive_counts(uuid, uuid)
  from public, anon;

grant execute on function public.list_basecamp_archive_projects(
  uuid,
  uuid,
  text,
  uuid,
  integer
) to authenticated, service_role;
grant execute on function public.search_basecamp_archive(
  uuid,
  text,
  uuid,
  text,
  real,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) to authenticated, service_role;
grant execute on function public.list_basecamp_archive_records(
  uuid,
  text,
  uuid,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) to authenticated, service_role;
grant execute on function public.get_basecamp_project_archive_counts(uuid, uuid)
  to authenticated, service_role;
