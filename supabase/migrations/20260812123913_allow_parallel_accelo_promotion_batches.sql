-- Candidate rows are protected with FOR UPDATE SKIP LOCKED. Avoid locking the
-- shared run row so several bounded batches can safely use the same lease.
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
    E'    and item.lease_expires_at > statement_timestamp()\n  for update;\n'
      || E'  if run.id is null then',
    E'    and item.lease_expires_at > statement_timestamp();\n'
      || E'  if run.id is null then'
  );
  if updated_definition = definition then
    raise exception 'Unable to enable parallel Accelo promotion batches.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '115s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '118s';
