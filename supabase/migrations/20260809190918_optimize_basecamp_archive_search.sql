create or replace function private.search_basecamp_archive(
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_page_size integer;
  parsed_query tsquery;
begin
  if char_length(btrim(coalesce(search_query, ''))) not between 1 and 500 then
    raise check_violation using message = 'A search query is required.';
  end if;
  if (
    after_rank is null
    or after_source_updated_at is null
    or after_record_id is null
  ) and not (
    after_rank is null
    and after_source_updated_at is null
    and after_record_id is null
  ) then
    raise check_violation using message = 'All search cursor values are required.';
  end if;

  if target_project_id is null then
    if not private.has_organization_role(
      target_organization_id,
      array['admin', 'manager']::text[]
    ) then
      raise insufficient_privilege using
        message = 'An admin or manager is required for organization-wide search.';
    end if;
  elsif not exists (
    select 1
    from public.projects as project
    where project.id = target_project_id
      and project.organization_id = target_organization_id
      and private.can_access_project(project.id)
  ) then
    raise insufficient_privilege using message = 'Project access is required.';
  end if;

  bounded_page_size := least(greatest(coalesce(page_size, 50), 1), 100);
  parsed_query := websearch_to_tsquery('english'::regconfig, search_query);

  return query
  with ranked as (
    select
      record.id,
      record.run_id,
      record.project_id,
      record.parent_id,
      record.record_type,
      record.title,
      left(coalesce(record.plain_text, ''), 500) as excerpt,
      record.source_updated_at,
      ts_rank_cd(record.search_vector, parsed_query)::real as search_rank
    from public.basecamp_archive_records as record
    join public.basecamp_export_runs as export on export.id = record.run_id
    where export.organization_id = target_organization_id
      and record.search_vector @@ parsed_query
      and (
        target_project_id is null
        or record.project_id = target_project_id
      )
      and (
        target_record_type is null
        or record.record_type = target_record_type
      )
      and (
        source_from is null
        or coalesce(record.source_updated_at, record.source_created_at)
          >= source_from
      )
      and (
        source_to is null
        or coalesce(record.source_updated_at, record.source_created_at)
          <= source_to
      )
  )
  select
    ranked.id,
    ranked.run_id,
    ranked.project_id,
    ranked.parent_id,
    ranked.record_type,
    ranked.title,
    ranked.excerpt,
    ranked.source_updated_at,
    ranked.search_rank
  from ranked
  where search_basecamp_archive.after_rank is null
    or (
      ranked.search_rank,
      coalesce(ranked.source_updated_at, '-infinity'::timestamptz),
      ranked.id
    ) < (
      search_basecamp_archive.after_rank,
      coalesce(
        search_basecamp_archive.after_source_updated_at,
        '-infinity'::timestamptz
      ),
      search_basecamp_archive.after_record_id
    )
  order by
    ranked.search_rank desc,
    coalesce(ranked.source_updated_at, '-infinity'::timestamptz) desc,
    ranked.id desc
  limit bounded_page_size;
end;
$$;
