-- A target run should reconcile only the domains it requested. Processing all
-- historical staged domains on every run caused repeated quarantine counts and
-- made large activity backfills compete with unrelated billing promotions.
do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  );
  if position(
    'item.entity_type = any(run.requested_entities)' in original_definition
  ) > 0 then
    return;
  end if;

  updated_definition := replace(
    original_definition,
$old$      and source_run.status in ('running', 'partial', 'succeeded')
      and not exists ($old$,
$new$      and source_run.status in ('running', 'partial', 'succeeded')
      and item.entity_type = any(run.requested_entities)
      and not exists ($new$
  );

  if updated_definition = original_definition then
    raise exception 'Could not scope Accelo promotion to requested entities.';
  end if;

  execute updated_definition;
end;
$migration$;
