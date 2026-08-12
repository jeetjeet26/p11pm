-- Partial inventory runs only need to persist progress. Full financial,
-- relationship, mapping, and destination reconciliation is deferred until the
-- source scan reports complete, avoiding quadratic work as a large scan grows.
do $migration$
declare
  definition text;
  updated_definition text;
  progress_block text := $block$
    -- Bounded inventory pages are progress checkpoints, not reconciliation
    -- boundaries. Defer mapping, destination, and relationship validation
    -- until the scan is complete so each partial run remains constant-time.
    if coalesce((target_summary ->> 'truncated')::boolean, false)
       or not coalesce(
         (
           target_summary #>>
             array['resources', entity_name, 'complete']
         )::boolean,
         false
       )
    then
      expected_total := coalesce(expected_total, staged_total);
      insert into public.accelo_pull_reconciliations (
        organization_id,
        run_id,
        entity_type,
        expected_count,
        staged_count,
        quarantined_count,
        mapped_count,
        approved_exclusion_count,
        destination_count,
        destination_missing_count,
        status,
        details,
        reconciled_at
      )
      values (
        result.organization_id,
        result.id,
        entity_name,
        expected_total,
        staged_total,
        0,
        0,
        0,
        0,
        0,
        'mismatch',
        jsonb_build_object(
          'equation', 'deferred_until_complete_scan',
          'pending_dependencies', 0,
          'complete_snapshot', false
        ),
        statement_timestamp()
      )
      on conflict (run_id, entity_type) do update
      set
        expected_count = excluded.expected_count,
        staged_count = excluded.staged_count,
        quarantined_count = excluded.quarantined_count,
        mapped_count = excluded.mapped_count,
        approved_exclusion_count = excluded.approved_exclusion_count,
        destination_count = excluded.destination_count,
        destination_missing_count = excluded.destination_missing_count,
        status = excluded.status,
        details = excluded.details,
        reconciled_at = excluded.reconciled_at;
      final_status := 'partial';
      all_complete := false;
      continue;
    end if;

$block$;
begin
  select pg_get_functiondef(
    'private.finalize_accelo_pull_run(uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into definition;

  if position('deferred_until_complete_scan' in definition) > 0 then
    return;
  end if;

  updated_definition := replace(
    definition,
    E'    ) as staged;\n\n    -- Seeing an unchanged source version',
    E'    ) as staged;\n\n'
      || progress_block
      || E'    -- Seeing an unchanged source version'
  );

  if position('deferred_until_complete_scan' in updated_definition) = 0 then
    raise exception 'Unable to defer partial Accelo reconciliation.';
  end if;

  execute updated_definition;
end;
$migration$;

alter function private.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '240s';
alter function public.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '245s';
