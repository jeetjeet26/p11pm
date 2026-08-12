-- A complete shadow scan must prove destination parity without rewriting every
-- source mapping or executing one dynamic existence query per activity.
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.finalize_accelo_pull_run(uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into definition;

  if position('join public.client_activities as destination' in definition) > 0 then
    return;
  end if;

  updated_definition := replace(
    definition,
$old$    update public.source_records as mapping
    set
      last_seen_run_id = result.id,
      last_seen_at = statement_timestamp(),
      source_deleted = false,
      retired_at = null
    from (
      select distinct stage.source_record_id
      from public.accelo_pull_stage as stage
      where stage.entity_type = entity_name
        and stage.run_id = any(scan_run_ids)
    ) as seen
    where mapping.organization_id = result.organization_id
      and mapping.provider = 'accelo'
      and mapping.source_account_id = result.source_account_id
      and mapping.source_entity_type = entity_name
      and mapping.source_record_id = seen.source_record_id;$old$,
$new$    if exists (
      select 1
      from public.integration_authority_states as authority
      where authority.organization_id = result.organization_id
        and authority.provider = 'accelo'
        and authority.source_account_id = result.source_account_id
        and authority.entity_type = entity_name
        and authority.state in (
          'importing',
          'accelo_authoritative',
          'final_delta',
          'supabase_authoritative'
        )
    ) then
      update public.source_records as mapping
      set
        last_seen_run_id = result.id,
        last_seen_at = statement_timestamp(),
        source_deleted = false,
        retired_at = null
      from (
        select distinct stage.source_record_id
        from public.accelo_pull_stage as stage
        where stage.entity_type = entity_name
          and stage.run_id = any(scan_run_ids)
      ) as seen
      where mapping.organization_id = result.organization_id
        and mapping.provider = 'accelo'
        and mapping.source_account_id = result.source_account_id
        and mapping.source_entity_type = entity_name
        and mapping.source_record_id = seen.source_record_id;
    end if;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$    select count(*)::bigint into destination_total
    from (
      select distinct mapping.id
      from public.accelo_pull_stage as stage
      join public.source_records as mapping
        on mapping.organization_id = result.organization_id
        and mapping.provider = 'accelo'
        and mapping.source_account_id = result.source_account_id
        and mapping.source_entity_type = stage.entity_type
        and mapping.source_record_id = stage.source_record_id
        and not mapping.source_deleted
      where stage.entity_type = entity_name
        and stage.run_id = any(scan_run_ids)
        and private.accelo_destination_exists(
          mapping.destination_table,
          mapping.destination_record_id
        )
    ) as destinations;$old$,
$new$    if entity_name = 'activities' then
      select count(distinct mapping.id)::bigint into destination_total
      from public.accelo_pull_stage as stage
      join public.source_records as mapping
        on mapping.organization_id = result.organization_id
        and mapping.provider = 'accelo'
        and mapping.source_account_id = result.source_account_id
        and mapping.source_entity_type = stage.entity_type
        and mapping.source_record_id = stage.source_record_id
        and not mapping.source_deleted
      join public.client_activities as destination
        on mapping.destination_table = 'client_activities'
        and destination.id = mapping.destination_record_id::uuid
      where stage.entity_type = entity_name
        and stage.run_id = any(scan_run_ids);
    else
      select count(*)::bigint into destination_total
      from (
        select distinct mapping.id
        from public.accelo_pull_stage as stage
        join public.source_records as mapping
          on mapping.organization_id = result.organization_id
          and mapping.provider = 'accelo'
          and mapping.source_account_id = result.source_account_id
          and mapping.source_entity_type = stage.entity_type
          and mapping.source_record_id = stage.source_record_id
          and not mapping.source_deleted
        where stage.entity_type = entity_name
          and stage.run_id = any(scan_run_ids)
          and private.accelo_destination_exists(
            mapping.destination_table,
            mapping.destination_record_id
          )
      ) as destinations;
    end if;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$    records_mapped = (
      select count(*)::bigint
      from public.source_records
      where last_seen_run_id = result.id
    ),$old$,
$new$    records_mapped = (
      select coalesce(sum(reconciliation.mapped_count), 0)::bigint
      from public.accelo_pull_reconciliations as reconciliation
      where reconciliation.run_id = result.id
    ),$new$
  );

  if position('join public.client_activities as destination' in updated_definition) = 0 then
    raise exception 'Unable to optimize shadow activity reconciliation.';
  end if;

  execute updated_definition;
end;
$migration$;

alter function private.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '240s';
alter function public.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '245s';
