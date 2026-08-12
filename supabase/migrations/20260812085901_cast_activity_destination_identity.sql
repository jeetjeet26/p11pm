do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.finalize_accelo_pull_run(uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into definition;
  updated_definition := replace(
    definition,
    'destination.id = mapping.destination_record_id',
    'destination.id = mapping.destination_record_id::uuid'
  );
  if updated_definition = definition
     and position(
       'destination.id = mapping.destination_record_id::uuid'
       in definition
     ) = 0
  then
    raise exception 'Unable to cast activity destination identity.';
  end if;
  if updated_definition <> definition then
    execute updated_definition;
  end if;
end;
$migration$;

alter function private.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '240s';
