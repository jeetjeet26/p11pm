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
    E'      item.staged_at,\n      item.id\n    limit 100',
    E'      item.staged_at,\n      item.id\n'
      || E'    for update of item skip locked\n'
      || E'    limit 100'
  );
  if updated_definition = definition
     or position('for update of item skip locked' in updated_definition) = 0
  then
    raise exception 'Unable to lock Accelo promotion candidates.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '115s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '118s';
