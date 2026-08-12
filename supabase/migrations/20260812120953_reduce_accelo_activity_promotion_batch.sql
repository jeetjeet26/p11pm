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
    E'    limit 500\n  loop',
    E'    limit 100\n  loop'
  );
  if updated_definition = definition
     and position(E'    limit 100\n  loop' in definition) = 0
  then
    raise exception 'Unable to reduce Accelo promotion batch size.';
  end if;
  if updated_definition <> definition then
    execute updated_definition;
  end if;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '90s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '95s';
