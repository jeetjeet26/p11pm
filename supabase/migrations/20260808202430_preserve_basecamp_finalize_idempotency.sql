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
  existing_status text;
  existing_summary jsonb;
begin
  select run.status, run.summary
  into existing_status, existing_summary
  from public.basecamp_import_runs as run
  where run.id = target_run_id;
  if existing_status = 'succeeded' then
    return existing_summary;
  end if;

  perform private.validate_basecamp_import_stage(target_run_id);
  return private.merge_basecamp_import(target_run_id);
end;
$$;

revoke all on function public.finalize_basecamp_import(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_basecamp_import(uuid)
  to service_role;
