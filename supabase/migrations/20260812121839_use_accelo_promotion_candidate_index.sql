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
    'where source_run.organization_id = run.organization_id',
    'where item.organization_id = run.organization_id'
      || E'\n      and source_run.organization_id = run.organization_id'
  );
  updated_definition := replace(
    updated_definition,
    'where newer_run.organization_id = run.organization_id',
    'where newer.organization_id = run.organization_id'
      || E'\n          and newer_run.organization_id = run.organization_id'
  );
  if position('where item.organization_id = run.organization_id' in updated_definition) = 0
     or position('where newer.organization_id = run.organization_id' in updated_definition) = 0
  then
    raise exception 'Unable to apply indexed Accelo candidate filters.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '115s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '118s';
