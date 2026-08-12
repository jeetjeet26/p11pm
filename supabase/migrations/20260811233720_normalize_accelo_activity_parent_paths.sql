-- Older Accelo activity pages expose relationship identifiers as paths such as
-- "affiliations/1279". Normalize the transient promotion payload so both old
-- staged rows and newly transformed rows resolve through the same crosswalk.
do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  );
  if position(
    $marker$payload ->> 'against_source_id' like '%/%'$marker$
      in original_definition
  ) > 0 then
    return;
  end if;

  updated_definition := replace(
    original_definition,
$old$    if payload is null or stage.source_deleted then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    select state.state into authority_state$old$,
$new$    if payload is null or stage.source_deleted then
      skipped_count := skipped_count + 1;
      continue;
    end if;
    if stage.entity_type = 'activities'
      and payload ->> 'against_source_id' like '%/%'
    then
      payload := jsonb_set(
        payload,
        '{against_source_id}',
        to_jsonb(regexp_replace(payload ->> 'against_source_id', '^.*/', ''))
      );
    end if;

    select state.state into authority_state$new$
  );

  if updated_definition = original_definition then
    raise exception 'Could not normalize Accelo activity parent paths.';
  end if;

  execute updated_definition;
end;
$migration$;
