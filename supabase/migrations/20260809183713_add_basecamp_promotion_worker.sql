create extension if not exists pg_cron;

create function private.promote_failed_basecamp_export_projects(target_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = 0
as $$
declare
  target_project_id uuid;
  failure_message text;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('basecamp-promotion-worker:' || target_run_id::text, 0)
  ) then
    return;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  update public.basecamp_export_runs
  set status = 'importing', phase = 'promotion_worker'
  where id = target_run_id
    and status <> 'completed';

  for target_project_id in
    select project_id
    from public.basecamp_export_project_status
    where run_id = target_run_id
      and status = 'failed'
    order by project_id
  loop
    begin
      update public.basecamp_export_project_status
      set
        status = 'ready',
        errors = '[]'::jsonb,
        summary = summary - 'promotion_error'
      where run_id = target_run_id
        and project_id = target_project_id;

      perform public.promote_basecamp_export_project(
        target_run_id,
        target_project_id
      );
    exception
      when others then
        get stacked diagnostics failure_message = message_text;
        update public.basecamp_export_project_status
        set
          status = 'failed',
          errors = coalesce(errors, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'at', statement_timestamp(),
              'message', failure_message
            )
          ),
          summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
            'promotion_error',
            failure_message
          )
        where run_id = target_run_id
          and project_id = target_project_id;
    end;
  end loop;

  if not exists (
    select 1
    from public.basecamp_export_project_status
    where run_id = target_run_id
      and status <> 'promoted'
  ) then
    update public.basecamp_export_runs
    set status = 'ready', phase = 'promoted'
    where id = target_run_id;
  end if;
end;
$$;

revoke all on function private.promote_failed_basecamp_export_projects(uuid)
  from public, anon, authenticated, service_role;
