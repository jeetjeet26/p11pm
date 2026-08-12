create or replace function private.stage_accelo_pull_batch(
  target_run_id uuid,
  target_lease_token uuid,
  target_entity_type text,
  target_records jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  input_count integer;
  inserted_count integer;
begin
  if jsonb_typeof(target_records) <> 'array'
    or jsonb_array_length(target_records) not between 1 and 100
  then
    raise check_violation using
      message = 'Accelo staging batches must contain 1 to 100 records.';
  end if;
  select run.organization_id into target_organization_id
  from public.accelo_pull_runs as run
  where run.id = target_run_id
    and run.status = 'running'
    and run.lease_token = target_lease_token
    and run.lease_expires_at > statement_timestamp()
  for key share;
  if target_organization_id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo pull lease is missing, expired, or owned elsewhere.';
  end if;

  input_count := jsonb_array_length(target_records);
  insert into public.accelo_pull_stage (
    organization_id,
    run_id,
    entity_type,
    source_record_id,
    source_updated_at,
    source_deleted,
    raw_payload,
    normalized_payload
  )
  select
    target_organization_id,
    target_run_id,
    target_entity_type,
    record ->> 'source_id',
    nullif(record ->> 'source_updated_at', '')::timestamptz,
    coalesce((record ->> 'source_deleted')::boolean, false),
    record -> 'raw_payload',
    record -> 'normalized_payload'
  from jsonb_array_elements(target_records) as item(record)
  where jsonb_typeof(record -> 'raw_payload') = 'object'
    and jsonb_typeof(record -> 'normalized_payload') = 'object'
    and nullif(record ->> 'source_id', '') is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;

  update public.accelo_pull_runs
  set
    records_scanned = records_scanned + input_count,
    records_staged = records_staged + inserted_count
  where id = target_run_id;
  return inserted_count;
end;
$$;
