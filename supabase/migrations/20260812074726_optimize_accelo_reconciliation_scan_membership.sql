-- Resolve scan membership once per entity instead of running a correlated
-- checkpoint lookup for every staged record in every reconciliation query.
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.finalize_accelo_pull_run(uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into definition;

  if position('scan_run_ids uuid[]' in definition) > 0 then
    return;
  end if;

  updated_definition := replace(
    definition,
    E'  scan_id text;\n  reconciliation_status text;',
    E'  scan_id text;\n  scan_run_ids uuid[];\n  reconciliation_status text;'
  );
  updated_definition := replace(
    updated_definition,
    E'    )::bigint;\n\n    select count(*)::bigint into staged_total',
    E'    )::bigint;\n    select coalesce(\n'
      || E'      array_agg(distinct checkpoint.run_id),\n'
      || E'      array[result.id]\n'
      || E'    ) into scan_run_ids\n'
      || E'    from public.accelo_pull_checkpoints as checkpoint\n'
      || E'    where checkpoint.organization_id = result.organization_id\n'
      || E'      and checkpoint.source_account_id = result.source_account_id\n'
      || E'      and checkpoint.entity_type = entity_name\n'
      || E'      and (\n'
      || E'        (scan_id is not null and checkpoint.cursor ->> ''scanId'' = scan_id)\n'
      || E'        or (scan_id is null and checkpoint.run_id = result.id)\n'
      || E'      );\n\n'
      || E'    select count(*)::bigint into staged_total'
  );
  updated_definition := replace(
    updated_definition,
    E'private.accelo_stage_in_scan(\n'
      || E'          stage.run_id, entity_name, scan_id, result.id\n'
      || E'        )',
    'stage.run_id = any(scan_run_ids)'
  );
  updated_definition := replace(
    updated_definition,
    E'private.accelo_stage_in_scan(\n'
      || E'        stage.run_id, entity_name, scan_id, result.id\n'
      || E'      )',
    'stage.run_id = any(scan_run_ids)'
  );

  if position('scan_run_ids uuid[]' in updated_definition) = 0 then
    raise exception 'Unable to optimize Accelo reconciliation scan membership.';
  end if;

  execute updated_definition;
end;
$migration$;

alter function private.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '90s';
