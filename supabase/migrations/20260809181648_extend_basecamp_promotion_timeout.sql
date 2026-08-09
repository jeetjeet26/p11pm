create function public.promote_basecamp_export_project_extended(
  run_id uuid,
  project_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;
  perform pg_catalog.set_config('statement_timeout', '120s', true);
  return public.promote_basecamp_export_project(run_id, project_id);
end;
$$;

revoke all on function public.promote_basecamp_export_project_extended(
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.promote_basecamp_export_project_extended(
  uuid,
  uuid
) to service_role;
