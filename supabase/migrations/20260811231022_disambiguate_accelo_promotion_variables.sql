-- The promotion function intentionally uses local variables named after
-- destination columns. Add the PL/pgSQL compiler directive to the deployed
-- function body so large backfills do not fail with SQLSTATE 42702.
do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  );
  if position('#variable_conflict use_variable' in original_definition) > 0 then
    return;
  end if;

  updated_definition := replace(
    original_definition,
    E'AS $function$\ndeclare',
    E'AS $function$\n#variable_conflict use_variable\ndeclare'
  );

  if updated_definition = original_definition then
    raise exception 'Could not add variable conflict directive to promotion function.';
  end if;

  execute updated_definition;
end;
$migration$;
