do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.map_source_record(uuid,text,text,text,text,text,text,text,uuid,timestamptz,text,boolean,jsonb)'::regprocedure
  ) into definition;
  updated_definition := replace(
    definition,
    'metadata = coalesce(target_metadata, mapping.metadata)',
    'metadata = mapping.metadata || coalesce(target_metadata, ''{}''::jsonb)'
  );
  if updated_definition = definition
     and position(
       'metadata = mapping.metadata || coalesce(target_metadata'
       in definition
     ) = 0
  then
    raise exception 'Unable to preserve source mapping version metadata.';
  end if;
  if updated_definition <> definition then
    execute updated_definition;
  end if;
end;
$migration$;
