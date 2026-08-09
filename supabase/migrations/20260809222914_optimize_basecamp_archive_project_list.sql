create or replace function private.list_basecamp_archive_projects(
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_page_size integer;
  can_view_all boolean;
begin
  if not private.has_organization_role(
    organization_id,
    array['admin', 'manager', 'member', 'viewer']::text[]
  ) then
    raise insufficient_privilege using message = 'Organization access is required.';
  end if;
  if (after_project_name is null) <> (after_project_id is null) then
    raise check_violation using message = 'Both project cursor values are required.';
  end if;

  can_view_all := private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  );
  bounded_page_size := least(greatest(coalesce(page_size, 50), 1), 100);

  return query
  select
    project.id,
    project.name,
    project.status,
    project.is_read_only,
    latest_run.id,
    latest_run.exported_at,
    coalesce(record_counts.row_count, 0),
    coalesce(entry_counts.row_count, 0),
    coalesce(file_counts.row_count, 0)
  from public.projects as project
  join lateral (
    select export.id, export.exported_at
    from public.basecamp_export_runs as export
    where export.organization_id = list_basecamp_archive_projects.organization_id
      and (
        list_basecamp_archive_projects.run_id is null
        or export.id = list_basecamp_archive_projects.run_id
      )
      and (
        export.id = project.basecamp_export_run_id
        or exists (
          select 1
          from public.basecamp_archive_records as record
          where record.run_id = export.id
            and record.project_id = project.id
        )
        or exists (
          select 1
          from public.basecamp_archive_entries as entry
          where entry.run_id = export.id
            and entry.project_id = project.id
        )
      )
    order by export.exported_at desc, export.id desc
    limit 1
  ) as latest_run on true
  left join lateral (
    select count(*) as row_count
    from public.basecamp_archive_records as record
    where record.run_id = latest_run.id
      and record.project_id = project.id
  ) as record_counts on true
  left join lateral (
    select count(*) as row_count
    from public.basecamp_archive_entries as entry
    where entry.run_id = latest_run.id
      and entry.project_id = project.id
  ) as entry_counts on true
  left join lateral (
    select count(*) as row_count
    from public.files as file
    where file.project_id = project.id
      and file.basecamp_export_run_id = latest_run.id
  ) as file_counts on true
  where project.organization_id
      = list_basecamp_archive_projects.organization_id
    and (
      can_view_all
      or project.owner_id = auth.uid()
      or exists (
        select 1
        from public.project_members as membership
        where membership.project_id = project.id
          and membership.profile_id = auth.uid()
      )
    )
    and (
      list_basecamp_archive_projects.after_project_name is null
      or (
        lower(project.name),
        project.id
      ) > (
        lower(list_basecamp_archive_projects.after_project_name),
        list_basecamp_archive_projects.after_project_id
      )
    )
  order by lower(project.name), project.id
  limit bounded_page_size;
end;
$$;
