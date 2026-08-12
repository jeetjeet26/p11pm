-- Accelo does not consistently return meta.total. A completed, non-truncated
-- inventory still has an exact source count: the distinct records staged
-- across its scan. Use that count instead of forcing every such scan to remain
-- a reconciliation mismatch.
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
    'expected_total := case when result.full_snapshot then null else staged_total end;',
    'expected_total := staged_total;'
  );

  if updated_definition <> definition then
    execute updated_definition;
  end if;
end;
$migration$;

alter function private.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '90s';

-- The public recovery wrappers are invoker-security and therefore require the
-- service worker to execute their private implementations.
grant execute on function private.claim_accelo_activity_recoveries(
  uuid, uuid, integer
) to service_role;
grant execute on function private.stage_accelo_recovery_batch(
  uuid, uuid, uuid, jsonb
) to service_role;
grant execute on function private.record_accelo_recovery_failure(
  uuid, uuid, uuid, text, boolean
) to service_role;
