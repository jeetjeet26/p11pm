-- Keep pull-run creation constant-time. Source mapping changes are already
-- recorded by journal_accelo_source_mapping during promotion, so copying every
-- historical mapping into each run context is redundant and eventually times
-- out as the imported dataset grows.
create or replace function private.capture_accelo_promotion_run_context(
  target_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_run public.accelo_pull_runs%rowtype;
begin
  select run.* into source_run
  from public.accelo_pull_runs as run
  where run.id = target_run_id;
  if source_run.id is null then
    return;
  end if;

  insert into public.accelo_promotion_run_context (
    run_id,
    organization_id,
    authority_snapshot,
    schedule_snapshot,
    source_mapping_snapshot
  )
  values (
    source_run.id,
    source_run.organization_id,
    coalesce((
      select jsonb_agg(to_jsonb(authority))
      from public.integration_authority_states as authority
      where authority.organization_id = source_run.organization_id
        and authority.provider = 'accelo'
    ), '[]'::jsonb),
    coalesce((
      select to_jsonb(settings)
      from public.integration_settings as settings
      where settings.organization_id = source_run.organization_id
        and settings.provider = 'accelo'
    ), '{}'::jsonb),
    '[]'::jsonb
  )
  on conflict (run_id) do nothing;
end;
$$;

revoke all on function private.capture_accelo_promotion_run_context(uuid)
  from public, anon, authenticated;
