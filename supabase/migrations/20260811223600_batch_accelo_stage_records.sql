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
  record jsonb;
  staged_count integer := 0;
begin
  if jsonb_typeof(target_records) <> 'array'
    or jsonb_array_length(target_records) not between 1 and 100
  then
    raise check_violation using
      message = 'Accelo staging batches must contain 1 to 100 records.';
  end if;
  for record in
    select value
    from jsonb_array_elements(target_records)
  loop
    perform private.stage_accelo_pull_record(
      target_run_id,
      target_lease_token,
      target_entity_type,
      record ->> 'source_id',
      record -> 'raw_payload',
      record -> 'normalized_payload',
      nullif(record ->> 'source_updated_at', '')::timestamptz,
      coalesce((record ->> 'source_deleted')::boolean, false)
    );
    staged_count := staged_count + 1;
  end loop;
  return staged_count;
end;
$$;

create or replace function public.stage_accelo_pull_batch(
  target_run_id uuid,
  target_lease_token uuid,
  target_entity_type text,
  target_records jsonb
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.stage_accelo_pull_batch(
    target_run_id,
    target_lease_token,
    target_entity_type,
    target_records
  );
$$;

revoke all on function private.stage_accelo_pull_batch(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function private.stage_accelo_pull_batch(
  uuid, uuid, text, jsonb
) to service_role;
revoke all on function public.stage_accelo_pull_batch(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.stage_accelo_pull_batch(
  uuid, uuid, text, jsonb
) to service_role;
