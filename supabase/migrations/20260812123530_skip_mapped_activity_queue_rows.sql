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
$old$      and (
        activity_queue.stage_record_id is not null
        or not exists (
        select 1
        from public.source_records as mapping$old$,
$new$      and not exists (
        select 1
        from public.source_records as mapping$new$
  );
  updated_definition := replace(
    updated_definition,
$old$          )
      ))
    order by$old$,
$new$          )
      )
    order by$new$
  );
  if position(
    'activity_queue.stage_record_id is not null'
    in updated_definition
  ) = 0
     or updated_definition = definition
  then
    raise exception 'Unable to skip mapped activity queue rows.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '115s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '118s';
