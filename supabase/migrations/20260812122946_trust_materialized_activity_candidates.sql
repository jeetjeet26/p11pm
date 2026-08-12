do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  ) into definition;
  updated_definition := replace(
    definition,
$old$      and not exists (
        select 1
        from public.accelo_pull_stage as newer$old$,
$new$      and (
        activity_queue.stage_record_id is not null
        or not exists (
        select 1
        from public.accelo_pull_stage as newer$new$
  );
  updated_definition := replace(
    updated_definition,
$old$          )
      )
      and not exists (
        select 1
        from public.accelo_unresolved_dependencies as unresolved$old$,
$new$          )
      ))
      and (
        activity_queue.stage_record_id is not null
        or not exists (
        select 1
        from public.accelo_unresolved_dependencies as unresolved$new$
  );
  updated_definition := replace(
    updated_definition,
$old$          and unresolved.resolution_state in ('pending', 'approved_exclusion')
      )
      and not exists (
        select 1
        from public.source_records as mapping$old$,
$new$          and unresolved.resolution_state in ('pending', 'approved_exclusion')
      ))
      and (
        activity_queue.stage_record_id is not null
        or not exists (
        select 1
        from public.source_records as mapping$new$
  );
  updated_definition := replace(
    updated_definition,
$old$          )
      )
    order by$old$,
$new$          )
      ))
    order by$new$
  );
  if position(
    'activity_queue.stage_record_id is not null'
    in updated_definition
  ) = 0 then
    raise exception 'Unable to trust materialized activity candidates.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '115s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '118s';
