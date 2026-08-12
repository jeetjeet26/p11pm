-- Close the remaining GET-only Accelo source-data parity gaps. Source
-- exceptions remain pending until an administrator records a disposition.

create or replace function private.accelo_relationship_payload(
  target_entity_type text,
  target_payload jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case target_entity_type
    when 'companies' then jsonb_build_object(
      'owner_source_id', target_payload -> 'owner_source_id'
    )
    when 'affiliations' then jsonb_build_object(
      'company_source_id', target_payload -> 'company_source_id',
      'contact_source_id', target_payload -> 'contact_source_id'
    )
    when 'jobs' then jsonb_build_object(
      'company_source_id', target_payload -> 'company_source_id',
      'manager_source_id', target_payload -> 'manager_source_id',
      'contact_source_ids', coalesce(
        target_payload -> 'contact_source_ids', '[]'::jsonb
      ),
      'affiliation_source_ids', coalesce(
        target_payload -> 'affiliation_source_ids', '[]'::jsonb
      )
    )
    when 'contracts' then jsonb_build_object(
      'company_source_id', target_payload -> 'company_source_id',
      'job_source_id', target_payload -> 'job_source_id'
    )
    when 'contract_periods' then jsonb_build_object(
      'contract_source_id', target_payload -> 'contract_source_id'
    )
    when 'activities' then jsonb_build_object(
      'against_type', target_payload -> 'against_type',
      'against_source_id', target_payload -> 'against_source_id',
      'staff_source_id', target_payload -> 'staff_source_id',
      'contact_source_id', target_payload -> 'contact_source_id',
      'participant_contact_source_ids', coalesce(
        target_payload -> 'participant_contact_source_ids', '[]'::jsonb
      ),
      'participant_affiliation_source_ids', coalesce(
        target_payload -> 'participant_affiliation_source_ids', '[]'::jsonb
      ),
      'contract_period_source_id',
        target_payload -> 'contract_period_source_id'
    )
    when 'invoices' then jsonb_build_object(
      'against_type', target_payload -> 'against_type',
      'against_source_id', target_payload -> 'against_source_id',
      'affiliation_source_id', target_payload -> 'affiliation_source_id'
    )
    when 'payments' then jsonb_build_object(
      'against_source_id', target_payload -> 'against_source_id'
    )
    when 'prospects' then jsonb_build_object(
      'contact_source_id', target_payload -> 'contact_source_id',
      'affiliation_source_id', target_payload -> 'affiliation_source_id',
      'owner_source_id', target_payload -> 'owner_source_id'
    )
    when 'milestones' then jsonb_build_object(
      'job_source_id', target_payload -> 'job_source_id'
    )
    when 'tasks' then jsonb_build_object(
      'job_source_id', target_payload -> 'job_source_id',
      'assigned_staff_source_id',
        target_payload -> 'assigned_staff_source_id'
    )
    when 'issues' then jsonb_build_object(
      'company_source_id', target_payload -> 'company_source_id',
      'contract_source_id', target_payload -> 'contract_source_id',
      'owner_source_id', target_payload -> 'owner_source_id',
      'contact_source_id', target_payload -> 'contact_source_id',
      'affiliation_source_id', target_payload -> 'affiliation_source_id'
    )
    else '{}'::jsonb
  end;
$$;

alter table public.accelo_pull_stage
  add column field_sha256 text generated always as (
    encode(
      extensions.digest(coalesce(normalized_payload, '{}'::jsonb)::text, 'sha256'),
      'hex'
    )
  ) stored,
  add column relationship_sha256 text generated always as (
    encode(
      extensions.digest(
        private.accelo_relationship_payload(
          entity_type, coalesce(normalized_payload, '{}'::jsonb)
        )::text,
        'sha256'
      ),
      'hex'
    )
  ) stored;

alter table public.accelo_unresolved_dependencies
  add column recovery_status text not null default 'pending'
    check (
      recovery_status in (
        'pending', 'claimed', 'retry', 'recovered', 'exhausted', 'unsupported'
      )
    ),
  add column recovery_attempt_count integer not null default 0
    check (recovery_attempt_count between 0 and 3),
  add column recovery_last_attempted_at timestamptz,
  add column recovery_reason_code text
    check (
      recovery_reason_code is null
      or recovery_reason_code ~ '^[a-z][a-z0-9_]{0,99}$'
    );

alter table public.accelo_unresolved_dependencies
  drop constraint accelo_unresolved_resolution_valid;

alter table public.accelo_unresolved_dependencies
  add constraint accelo_unresolved_resolution_valid check (
    (
      resolution_state = 'pending'
      and approved_disposition is null
      and resolved_by is null
      and resolved_at is null
    )
    or (
      resolution_state = 'retry_ready'
      and approved_disposition = 'retry'
      and resolved_at is not null
      and char_length(btrim(resolution_reason)) between 3 and 1000
      and (
        resolved_by is not null
        or (
          resolved_by is null
          and recovery_status = 'recovered'
          and resolution_reason = 'GET-only source parent recovered'
        )
      )
    )
    or (
      resolution_state = 'approved_exclusion'
      and approved_disposition in ('exclude', 'archive')
      and resolved_by is not null
      and resolved_at is not null
      and char_length(btrim(resolution_reason)) between 3 and 1000
    )
    or (
      resolution_state = 'resolved'
      and resolved_at is not null
    )
  );

create table public.accelo_recovery_stage_links (
  unresolved_id uuid not null
    references public.accelo_unresolved_dependencies(id) on delete restrict,
  stage_record_id uuid not null
    references public.accelo_pull_stage(id) on delete restrict,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  run_id uuid not null references public.accelo_pull_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (unresolved_id, stage_record_id),
  unique (organization_id, unresolved_id, stage_record_id)
);

create index accelo_recovery_stage_links_run_idx
  on public.accelo_recovery_stage_links (run_id, stage_record_id);

create table public.accelo_recovery_attempt_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  run_id uuid not null references public.accelo_pull_runs(id) on delete restrict,
  unresolved_id uuid not null
    references public.accelo_unresolved_dependencies(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 3),
  outcome text not null
    check (
      outcome in (
        'claimed', 'parents_staged', 'source_not_found',
        'unsupported_parent', 'source_read_failed'
      )
    ),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object'),
  recorded_at timestamptz not null default now()
);

create index accelo_recovery_attempt_events_unresolved_idx
  on public.accelo_recovery_attempt_events (
    unresolved_id, attempt_number, recorded_at
  );

create table public.accelo_orphan_archive (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  source_account_id text not null,
  unresolved_id uuid not null unique
    references public.accelo_unresolved_dependencies(id) on delete restrict,
  stage_record_id uuid not null
    references public.accelo_pull_stage(id) on delete restrict,
  entity_type text not null,
  source_record_id text not null,
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  normalized_payload jsonb
    check (
      normalized_payload is null
      or jsonb_typeof(normalized_payload) = 'object'
    ),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  field_sha256 text not null check (field_sha256 ~ '^[a-f0-9]{64}$'),
  relationship_sha256 text not null
    check (relationship_sha256 ~ '^[a-f0-9]{64}$'),
  required_parent_identity jsonb not null
    check (jsonb_typeof(required_parent_identity) = 'object'),
  archive_reason_code text not null,
  approval_state text not null default 'pending'
    check (approval_state in ('pending', 'approved')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approval_reason text,
  archived_at timestamptz not null default now(),
  constraint accelo_orphan_archive_approval_valid check (
    (
      approval_state = 'pending'
      and approved_by is null
      and approved_at is null
      and approval_reason is null
    )
    or (
      approval_state = 'approved'
      and approved_by is not null
      and approved_at is not null
      and char_length(btrim(approval_reason)) between 3 and 1000
    )
  )
);

create index accelo_orphan_archive_pending_idx
  on public.accelo_orphan_archive (
    organization_id, source_account_id, entity_type, source_record_id
  )
  where approval_state = 'pending';

create table public.accelo_unresolved_disposition_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  unresolved_id uuid not null
    references public.accelo_unresolved_dependencies(id) on delete restrict,
  disposition text not null check (disposition in ('retry', 'exclude', 'archive')),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  recorded_at timestamptz not null default now()
);

alter table public.projects
  add column accelo_custom_code text,
  add column accelo_contact_source_ids text[] default '{}'::text[];

alter table public.retainer_periods
  add column consumed_minutes integer not null default 0
    check (consumed_minutes between 0 and 10000000),
  add column rollover_value_cents bigint not null default 0
    check (rollover_value_cents >= 0),
  add column overage_minutes integer not null default 0
    check (overage_minutes between 0 and 10000000),
  add column overage_value_cents bigint not null default 0
    check (overage_value_cents >= 0),
  add column currency char(3) not null default 'USD'
    check (currency ~ '^[A-Z]{3}$');

alter table public.client_activities
  add column retainer_period_id uuid;

alter table public.client_activities
  add constraint client_activities_organization_retainer_period_fkey
    foreign key (organization_id, client_id, retainer_period_id)
    references public.retainer_periods(organization_id, client_id, id)
    on delete set null (retainer_period_id);

create index client_activities_retainer_period_idx
  on public.client_activities (retainer_period_id, occurred_at desc, id)
  where retainer_period_id is not null;

alter table public.accelo_pull_reconciliations
  add column latest_unique_staged_count bigint not null default 0
    check (latest_unique_staged_count >= 0),
  add column source_deleted_count bigint not null default 0
    check (source_deleted_count >= 0),
  add column field_hash_mismatch_count bigint not null default 0
    check (field_hash_mismatch_count >= 0),
  add column relationship_mismatch_count bigint not null default 0
    check (relationship_mismatch_count >= 0),
  add column relationship_missing_count bigint not null default 0
    check (relationship_missing_count >= 0),
  add column financial_source jsonb not null default '{}'::jsonb
    check (jsonb_typeof(financial_source) = 'object'),
  add column financial_destination jsonb not null default '{}'::jsonb
    check (jsonb_typeof(financial_destination) = 'object');

create or replace function private.initialize_retainer_periods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(
    current_setting('app.accelo_promotion_run_id', true),
    ''
  ) is null then
    perform private.ensure_retainer_periods(
      new.id,
      greatest(current_date, new.start_date)
    );
  end if;
  return new;
end;
$$;

create or replace function private.prevent_overlapping_agency_periods()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
begin
  if tg_table_name = 'staff_billing_rates' and exists (
    select 1
    from public.staff_billing_rates as rate
    where rate.id <> (row_data ->> 'id')::uuid
      and rate.organization_id = (row_data ->> 'organization_id')::uuid
      and rate.profile_id = (row_data ->> 'profile_id')::uuid
      and rate.client_id is not distinct from
        nullif(row_data ->> 'client_id', '')::uuid
      and rate.project_id is not distinct from
        nullif(row_data ->> 'project_id', '')::uuid
      and daterange(
        rate.effective_from,
        coalesce(rate.effective_to + 1, 'infinity'::date),
        '[)'
      ) && daterange(
        (row_data ->> 'effective_from')::date,
        coalesce(
          (row_data ->> 'effective_to')::date + 1,
          'infinity'::date
        ),
        '[)'
      )
  ) then
    raise exclusion_violation using
      message = 'Billing rate periods cannot overlap.';
  end if;

  if tg_table_name = 'retainer_periods' and exists (
    select 1
    from public.retainer_periods as period
    where period.id <> (row_data ->> 'id')::uuid
      and period.retainer_id = (row_data ->> 'retainer_id')::uuid
      and daterange(period.period_start, period.period_end + 1, '[)') && daterange(
        (row_data ->> 'period_start')::date,
        (row_data ->> 'period_end')::date + 1,
        '[)'
      )
      and period.status <> 'cancelled'
      and row_data ->> 'status' <> 'cancelled'
      and not (
        nullif(row_data ->> 'external_id', '') is not null
        and period.period_start = (row_data ->> 'period_start')::date
        and period.period_end = (row_data ->> 'period_end')::date
      )
  ) then
    raise exclusion_violation using
      message = 'Retainer periods cannot overlap.';
  end if;
  return new;
end;
$$;

create or replace function private.archive_accelo_orphan(
  target_unresolved_id uuid,
  target_reason_code text
)
returns public.accelo_orphan_archive
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  result public.accelo_orphan_archive%rowtype;
begin
  insert into public.accelo_orphan_archive (
    organization_id,
    source_account_id,
    unresolved_id,
    stage_record_id,
    entity_type,
    source_record_id,
    raw_payload,
    normalized_payload,
    payload_sha256,
    field_sha256,
    relationship_sha256,
    required_parent_identity,
    archive_reason_code
  )
  select
    unresolved.organization_id,
    unresolved.source_account_id,
    unresolved.id,
    stage.id,
    unresolved.entity_type,
    unresolved.source_record_id,
    stage.raw_payload,
    stage.normalized_payload,
    stage.payload_sha256,
    stage.field_sha256,
    stage.relationship_sha256,
    unresolved.required_parent_identity,
    target_reason_code
  from public.accelo_unresolved_dependencies as unresolved
  join public.accelo_pull_stage as stage on stage.id = unresolved.stage_record_id
  where unresolved.id = target_unresolved_id
  on conflict (unresolved_id) do nothing;

  select archive.* into result
  from public.accelo_orphan_archive as archive
  where archive.unresolved_id = target_unresolved_id;
  return result;
end;
$$;

create or replace function private.claim_accelo_activity_recoveries(
  target_run_id uuid,
  target_lease_token uuid,
  result_limit integer
)
returns table (
  unresolved_id uuid,
  source_record_id text,
  required_parent_identity jsonb,
  recovery_attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  run public.accelo_pull_runs%rowtype;
begin
  if result_limit not between 1 and 25 then
    raise check_violation using message = 'Invalid Accelo recovery claim limit.';
  end if;
  select item.* into run
  from public.accelo_pull_runs as item
  where item.id = target_run_id
    and item.status = 'running'
    and item.lease_token = target_lease_token
    and item.lease_expires_at > statement_timestamp()
  for update;
  if run.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo recovery requires its active pull lease.';
  end if;

  return query
  with candidates as (
    select unresolved.id
    from public.accelo_unresolved_dependencies as unresolved
    where unresolved.organization_id = run.organization_id
      and unresolved.source_account_id = run.source_account_id
      and unresolved.last_seen_run_id = run.id
      and unresolved.entity_type = 'activities'
      and unresolved.reason_code = 'missing_parent'
      and unresolved.resolution_state = 'pending'
      and unresolved.recovery_attempt_count < 3
      and (
        unresolved.recovery_status in ('pending', 'retry')
        or (
          unresolved.recovery_status = 'claimed'
          and unresolved.recovery_last_attempted_at
            < statement_timestamp() - interval '5 minutes'
        )
      )
    order by unresolved.source_record_id, unresolved.id
    for update skip locked
    limit result_limit
  ),
  claimed as (
    update public.accelo_unresolved_dependencies as unresolved
    set
      recovery_status = 'claimed',
      recovery_attempt_count = unresolved.recovery_attempt_count + 1,
      recovery_last_attempted_at = statement_timestamp(),
      recovery_reason_code = null,
      last_seen_run_id = run.id
    from candidates
    where unresolved.id = candidates.id
    returning
      unresolved.id,
      unresolved.source_record_id,
      unresolved.required_parent_identity,
      unresolved.recovery_attempt_count
  ),
  attempts as (
    insert into public.accelo_recovery_attempt_events (
      organization_id, run_id, unresolved_id, attempt_number, outcome
    )
    select
      run.organization_id, run.id, claimed.id,
      claimed.recovery_attempt_count, 'claimed'
    from claimed
    returning unresolved_id
  )
  select
    claimed.id,
    claimed.source_record_id,
    claimed.required_parent_identity,
    claimed.recovery_attempt_count
  from claimed
  join attempts on attempts.unresolved_id = claimed.id
  order by claimed.source_record_id, claimed.id;
end;
$$;

create or replace function public.claim_accelo_activity_recoveries(
  target_run_id uuid,
  target_lease_token uuid,
  result_limit integer default 25
)
returns table (
  unresolved_id uuid,
  source_record_id text,
  required_parent_identity jsonb,
  recovery_attempt_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.claim_accelo_activity_recoveries(
    target_run_id, target_lease_token, result_limit
  );
$$;

create or replace function private.stage_accelo_recovery_batch(
  target_run_id uuid,
  target_lease_token uuid,
  target_unresolved_id uuid,
  target_records jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run public.accelo_pull_runs%rowtype;
  unresolved public.accelo_unresolved_dependencies%rowtype;
  record jsonb;
  stage_id uuid;
  target_hash text;
  staged_count integer := 0;
begin
  if jsonb_typeof(target_records) <> 'array'
    or jsonb_array_length(target_records) not between 1 and 8
  then
    raise check_violation using
      message = 'Accelo recovery batches must contain 1 to 8 records.';
  end if;
  select item.* into run
  from public.accelo_pull_runs as item
  where item.id = target_run_id
    and item.status = 'running'
    and item.lease_token = target_lease_token
    and item.lease_expires_at > statement_timestamp()
  for update;
  select item.* into unresolved
  from public.accelo_unresolved_dependencies as item
  where item.id = target_unresolved_id
    and item.organization_id = run.organization_id
    and item.source_account_id = run.source_account_id
    and item.last_seen_run_id = run.id
    and item.entity_type = 'activities'
    and item.resolution_state = 'pending'
    and item.recovery_status = 'claimed'
  for update;
  if run.id is null or unresolved.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo recovery claim is missing or no longer active.';
  end if;

  for record in select value from jsonb_array_elements(target_records)
  loop
    if nullif(record ->> 'entity_type', '') is null
      or nullif(record ->> 'source_id', '') is null
      or jsonb_typeof(record -> 'raw_payload') <> 'object'
      or jsonb_typeof(record -> 'normalized_payload') <> 'object'
      or coalesce((record ->> 'transformer_version')::integer, 0)
        not between 1 and 1000000
    then
      raise check_violation using message = 'Invalid Accelo recovery record.';
    end if;
    target_hash := encode(
      extensions.digest((record -> 'raw_payload')::text, 'sha256'),
      'hex'
    );
    insert into public.accelo_pull_stage (
      organization_id, run_id, entity_type, source_record_id,
      source_updated_at, source_deleted, raw_payload, normalized_payload,
      transformer_version
    )
    values (
      run.organization_id,
      run.id,
      record ->> 'entity_type',
      record ->> 'source_id',
      nullif(record ->> 'source_updated_at', '')::timestamptz,
      coalesce((record ->> 'source_deleted')::boolean, false),
      record -> 'raw_payload',
      record -> 'normalized_payload',
      (record ->> 'transformer_version')::integer
    )
    on conflict do nothing
    returning id into stage_id;

    if stage_id is null then
      select stage.id into stage_id
      from public.accelo_pull_stage as stage
      where stage.run_id = run.id
        and stage.entity_type = record ->> 'entity_type'
        and stage.source_record_id = record ->> 'source_id'
        and stage.payload_sha256 = target_hash;
    end if;
    if stage_id is null then
      raise integrity_constraint_violation using
        message = 'Accelo recovery stage identity could not be established.';
    end if;
    insert into public.accelo_recovery_stage_links (
      unresolved_id, stage_record_id, organization_id, run_id
    )
    values (unresolved.id, stage_id, run.organization_id, run.id)
    on conflict do nothing;
    stage_id := null;
    staged_count := staged_count + 1;
  end loop;

  update public.accelo_unresolved_dependencies as item
  set
    recovery_status = 'recovered',
    recovery_reason_code = null,
    resolution_state = 'retry_ready',
    approved_disposition = 'retry',
    resolution_reason = 'GET-only source parent recovered',
    resolved_by = null,
    resolved_at = statement_timestamp()
  where item.id = unresolved.id;

  insert into public.accelo_recovery_attempt_events (
    organization_id, run_id, unresolved_id, attempt_number, outcome, detail
  )
  values (
    run.organization_id,
    run.id,
    unresolved.id,
    unresolved.recovery_attempt_count,
    'parents_staged',
    jsonb_build_object('staged_parent_count', staged_count)
  );
  return staged_count;
end;
$$;

create or replace function public.stage_accelo_recovery_batch(
  target_run_id uuid,
  target_lease_token uuid,
  target_unresolved_id uuid,
  target_records jsonb
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.stage_accelo_recovery_batch(
    target_run_id, target_lease_token, target_unresolved_id, target_records
  );
$$;

create or replace function private.record_accelo_recovery_failure(
  target_run_id uuid,
  target_lease_token uuid,
  target_unresolved_id uuid,
  target_reason_code text,
  target_terminal boolean
)
returns public.accelo_unresolved_dependencies
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run public.accelo_pull_runs%rowtype;
  result public.accelo_unresolved_dependencies%rowtype;
  final_status text;
begin
  if target_reason_code not in (
    'source_not_found', 'unsupported_parent', 'source_read_failed'
  ) then
    raise check_violation using message = 'Invalid Accelo recovery failure.';
  end if;
  select item.* into run
  from public.accelo_pull_runs as item
  where item.id = target_run_id
    and item.status = 'running'
    and item.lease_token = target_lease_token
    and item.lease_expires_at > statement_timestamp();
  select item.* into result
  from public.accelo_unresolved_dependencies as item
  where item.id = target_unresolved_id
    and item.organization_id = run.organization_id
    and item.source_account_id = run.source_account_id
    and item.recovery_status = 'claimed'
  for update;
  if run.id is null or result.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo recovery claim is missing or no longer active.';
  end if;

  final_status := case
    when target_reason_code = 'unsupported_parent' then 'unsupported'
    when target_terminal or result.recovery_attempt_count >= 3 then 'exhausted'
    else 'retry'
  end;
  update public.accelo_unresolved_dependencies as unresolved
  set
    recovery_status = final_status,
    recovery_reason_code = target_reason_code,
    recovery_last_attempted_at = statement_timestamp()
  where unresolved.id = result.id
  returning unresolved.* into result;

  insert into public.accelo_recovery_attempt_events (
    organization_id, run_id, unresolved_id, attempt_number, outcome
  )
  values (
    run.organization_id, run.id, result.id,
    result.recovery_attempt_count, target_reason_code
  );
  if final_status in ('exhausted', 'unsupported') then
    perform private.archive_accelo_orphan(result.id, target_reason_code);
  end if;
  return result;
end;
$$;

create or replace function public.record_accelo_recovery_failure(
  target_run_id uuid,
  target_lease_token uuid,
  target_unresolved_id uuid,
  target_reason_code text,
  target_terminal boolean default false
)
returns public.accelo_unresolved_dependencies
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_accelo_recovery_failure(
    target_run_id,
    target_lease_token,
    target_unresolved_id,
    target_reason_code,
    target_terminal
  );
$$;

create or replace function private.accelo_participant_contact_ids(
  target_organization_id uuid,
  target_source_account_id text,
  target_contact_source_ids jsonb,
  target_affiliation_source_ids jsonb
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with source_ids as (
    select 'contacts'::text as entity_type, value as source_record_id
    from jsonb_array_elements_text(
      coalesce(target_contact_source_ids, '[]'::jsonb)
    )
    union
    select 'affiliations'::text, value
    from jsonb_array_elements_text(
      coalesce(target_affiliation_source_ids, '[]'::jsonb)
    )
  ),
  destinations as (
    select case source.entity_type
      when 'contacts' then mapping.destination_record_id::uuid
      else affiliation.contact_id
    end as contact_id
    from source_ids as source
    join public.source_records as mapping
      on mapping.organization_id = target_organization_id
      and mapping.provider = 'accelo'
      and mapping.source_account_id = target_source_account_id
      and mapping.source_entity_type = source.entity_type
      and mapping.source_record_id = source.source_record_id
      and not mapping.source_deleted
    left join public.client_contacts as affiliation
      on source.entity_type = 'affiliations'
      and affiliation.id = mapping.destination_record_id::uuid
  )
  select coalesce(
    array_agg(distinct contact_id order by contact_id)
      filter (where contact_id is not null),
    '{}'::uuid[]
  )
  from destinations;
$$;

create or replace function private.accelo_required_parent_identity(
  target_entity_type text,
  target_payload jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case target_entity_type
    when 'affiliations' then jsonb_build_object(
      'one_of', jsonb_build_array(
        jsonb_build_object(
          'entity_type', 'companies',
          'source_record_id', target_payload ->> 'company_source_id'
        ),
        jsonb_build_object(
          'entity_type', 'contacts',
          'source_record_id', target_payload ->> 'contact_source_id'
        )
      )
    )
    when 'jobs' then jsonb_build_object(
      'entity_type', 'companies',
      'source_record_id', target_payload ->> 'company_source_id'
    )
    when 'contracts' then jsonb_build_object(
      'entity_type', 'companies',
      'source_record_id', target_payload ->> 'company_source_id'
    )
    when 'contract_periods' then jsonb_build_object(
      'entity_type', 'contracts',
      'source_record_id', target_payload ->> 'contract_source_id'
    )
    when 'activities' then jsonb_build_object(
      'entity_type', target_payload ->> 'against_type',
      'source_record_id', target_payload ->> 'against_source_id'
    )
    when 'invoices' then jsonb_build_object(
      'entity_type', target_payload ->> 'against_type',
      'source_record_id', target_payload ->> 'against_source_id'
    )
    when 'payments' then jsonb_build_object(
      'entity_type', 'invoices',
      'source_record_id', target_payload ->> 'against_source_id'
    )
    when 'prospects' then jsonb_build_object(
      'entity_type', 'contacts',
      'source_record_id', target_payload ->> 'contact_source_id'
    )
    when 'milestones' then jsonb_build_object(
      'entity_type', 'jobs',
      'source_record_id', target_payload ->> 'job_source_id'
    )
    when 'tasks' then jsonb_build_object(
      'entity_type', 'jobs',
      'source_record_id', target_payload ->> 'job_source_id'
    )
    when 'issues' then jsonb_build_object(
      'entity_type', 'companies',
      'source_record_id', target_payload ->> 'company_source_id'
    )
    else '{}'::jsonb
  end;
$$;

create or replace function private.accelo_destination_exists(
  target_table text,
  target_record_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result boolean;
begin
  if target_table not in (
    'clients', 'contacts', 'profiles', 'client_contacts', 'projects',
    'retainers', 'retainer_periods', 'client_activities', 'invoices',
    'payments', 'prospects', 'milestones', 'todos'
  ) then
    return false;
  end if;
  execute format(
    'select exists (select 1 from public.%I where id = $1::uuid)',
    target_table
  )
  into result
  using target_record_id;
  return result;
exception
  when invalid_text_representation then
    return false;
end;
$$;

create or replace function private.set_accelo_unresolved_disposition(
  target_unresolved_id uuid,
  target_disposition text,
  target_actor_id uuid,
  target_reason text
)
returns public.accelo_unresolved_dependencies
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.accelo_unresolved_dependencies%rowtype;
begin
  if target_disposition not in ('retry', 'exclude', 'archive')
    or char_length(btrim(target_reason)) not between 3 and 1000
  then
    raise check_violation using message = 'Invalid unresolved dependency disposition.';
  end if;
  select unresolved.* into result
  from public.accelo_unresolved_dependencies as unresolved
  where unresolved.id = target_unresolved_id
  for update;
  if result.id is null then
    raise no_data_found using message = 'Accelo unresolved dependency not found.';
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = target_actor_id
      and profile.organization_id = result.organization_id
      and profile.role = 'admin'
      and profile.status = 'active'
  ) then
    raise insufficient_privilege using message = 'Active administrator required.';
  end if;

  if target_disposition = 'archive' then
    perform private.archive_accelo_orphan(result.id, 'administrator_archive');
    update public.accelo_orphan_archive as archive
    set
      approval_state = 'approved',
      approved_by = target_actor_id,
      approved_at = statement_timestamp(),
      approval_reason = btrim(target_reason)
    where archive.unresolved_id = result.id
      and archive.approval_state = 'pending';
  end if;

  update public.accelo_unresolved_dependencies as unresolved
  set
    resolution_state = case
      when target_disposition = 'retry' then 'retry_ready'
      else 'approved_exclusion'
    end,
    approved_disposition = target_disposition,
    resolution_reason = btrim(target_reason),
    resolved_by = target_actor_id,
    resolved_at = statement_timestamp(),
    recovery_status = case
      when target_disposition = 'retry' then 'retry'
      else unresolved.recovery_status
    end
  where unresolved.id = result.id
  returning unresolved.* into result;

  insert into public.accelo_unresolved_disposition_events (
    organization_id, unresolved_id, disposition, actor_id, reason
  )
  values (
    result.organization_id, result.id, target_disposition,
    target_actor_id, btrim(target_reason)
  );
  return result;
end;
$$;

do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  );
  updated_definition := original_definition;

  updated_definition := replace(
    updated_definition,
    $old$      and item.entity_type = any(run.requested_entities)
      and item.normalized_payload is not null$old$,
    $new$      and (
        item.entity_type = any(run.requested_entities)
        or exists (
          select 1
          from public.accelo_recovery_stage_links as recovery_link
          where recovery_link.stage_record_id = item.id
            and recovery_link.run_id = run.id
        )
      )
      and item.normalized_payload is not null$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$          'milestones', 'tasks', 'contracts', 'activities', 'invoices',$old$,
    $new$          'milestones', 'tasks', 'contracts', 'contract_periods',
          'activities', 'invoices',$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$          'companies', 'contacts', 'staff', 'affiliations', 'jobs',$old$,
    $new$          'staff', 'companies', 'contacts', 'affiliations', 'jobs',$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$  retainer_id uuid;
  invoice_id uuid;$old$,
    $new$  retainer_id uuid;
  retainer_period_id uuid;
  invoice_id uuid;
  participant_contact_ids uuid[];$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$      retainer_id := null;
      invoice_id := null;$old$,
    $new$      retainer_id := null;
      retainer_period_id := null;
      invoice_id := null;
      participant_contact_ids := '{}'::uuid[];$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$        when 'companies' then
          insert into public.clients (
            organization_id, name, status, phone, website, billing_address,
            default_currency, external_id, source_updated_at, source_payload
          )$old$,
    $new$        when 'companies' then
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'owner_source_id', 'profiles'
          );
          insert into public.clients (
            organization_id, name, status, phone, website, billing_address,
            default_currency, account_owner_id, external_id,
            source_updated_at, source_payload
          )$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            coalesce(payload -> 'billing_address', '{}'::jsonb),
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            stage.source_record_id,$old$,
    $new$            coalesce(payload -> 'billing_address', '{}'::jsonb),
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            profile_id, stage.source_record_id,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            billing_address = excluded.billing_address,
            source_updated_at = excluded.source_updated_at,$old$,
    $new$            billing_address = excluded.billing_address,
            default_currency = excluded.default_currency,
            account_owner_id = excluded.account_owner_id,
            source_updated_at = excluded.source_updated_at,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            hourly_rate_cents, commercial_currency, accelo_job_id,
            source_updated_at, source_payload$old$,
    $new$            hourly_rate_cents, commercial_currency, accelo_job_id,
            accelo_custom_code, accelo_contact_source_ids,
            source_updated_at, source_payload$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            'USD',
            coalesce(payload ->> 'billing_type', 'time_and_materials'),
            nullif(payload ->> 'hourly_rate_cents', '')::bigint,
            'USD',
            stage.source_record_id,
            stage.source_updated_at,$old$,
    $new$            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            coalesce(payload ->> 'billing_type', 'time_and_materials'),
            nullif(payload ->> 'hourly_rate_cents', '')::bigint,
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            stage.source_record_id,
            nullif(payload ->> 'code', ''),
            coalesce(
              array(
                select jsonb_array_elements_text(
                  coalesce(payload -> 'contact_source_ids', '[]'::jsonb)
                )
              ),
              '{}'::text[]
            ),
            stage.source_updated_at,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            hourly_rate_cents = excluded.hourly_rate_cents,
            source_updated_at = excluded.source_updated_at,$old$,
    $new$            hourly_rate_cents = excluded.hourly_rate_cents,
            currency = excluded.currency,
            commercial_currency = excluded.commercial_currency,
            accelo_custom_code = excluded.accelo_custom_code,
            accelo_contact_source_ids = excluded.accelo_contact_source_ids,
            source_updated_at = excluded.source_updated_at,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            updated_at = now()
          returning id into destination_id;

        when 'contracts' then$old$,
    $new$            updated_at = now()
          returning id into destination_id;
          for contact_id in
            select distinct candidate.contact_id
            from (
              select mapping.destination_record_id::uuid as contact_id
              from jsonb_array_elements_text(
                coalesce(payload -> 'contact_source_ids', '[]'::jsonb)
              ) as source(source_id)
              join public.source_records as mapping
                on mapping.organization_id = run.organization_id
                and mapping.provider = 'accelo'
                and mapping.source_account_id = run.source_account_id
                and mapping.source_entity_type = 'contacts'
                and mapping.source_record_id = source.source_id
                and not mapping.source_deleted
              union
              select affiliation.contact_id
              from jsonb_array_elements_text(
                coalesce(payload -> 'affiliation_source_ids', '[]'::jsonb)
              ) as source(source_id)
              join public.source_records as mapping
                on mapping.organization_id = run.organization_id
                and mapping.provider = 'accelo'
                and mapping.source_account_id = run.source_account_id
                and mapping.source_entity_type = 'affiliations'
                and mapping.source_record_id = source.source_id
                and not mapping.source_deleted
              join public.client_contacts as affiliation
                on affiliation.id = mapping.destination_record_id::uuid
            ) as candidate
            where candidate.contact_id is not null
          loop
            insert into public.project_contacts (
              organization_id, project_id, contact_id, role
            )
            values (
              run.organization_id, destination_id, contact_id, 'Accelo contact'
            )
            on conflict (project_id, contact_id) do nothing;
          end loop;

        when 'contracts' then$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            overage_rate_cents = excluded.overage_rate_cents,
            contract_type = excluded.contract_type,$old$,
    $new$            overage_rate_cents = excluded.overage_rate_cents,
            currency = excluded.currency,
            contract_type = excluded.contract_type,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$          perform private.ensure_retainer_periods(destination_id, current_date);
          update public.retainer_periods as period
          set
            allowance_type = coalesce(
              payload ->> 'allowance_type',
              period.allowance_type
            ),
            included_value_cents = coalesce(
              nullif(payload ->> 'allowance_value_cents', '')::bigint,
              period.included_value_cents,
              period.fee_cents
            ),
            source_updated_at = stage.source_updated_at,
            source_payload = jsonb_build_object(
              'contract_source_id',
              stage.source_record_id,
              'period_template_source_id',
              payload ->> 'period_template_source_id',
              'generated_from_contract_template',
              true
            )
          where period.retainer_id = destination_id;
          project_id := private.accelo_destination_uuid($old$,
    $new$          project_id := private.accelo_destination_uuid($new$
  );

  updated_definition := replace(
    updated_definition,
    $old$        when 'activities' then
          profile_id := private.accelo_destination_uuid($old$,
    $new$        when 'contract_periods' then
          retainer_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contracts',
            payload ->> 'contract_source_id', 'retainers'
          );
          select item.client_id into client_id
          from public.retainers as item where item.id = retainer_id;
          if retainer_id is null or client_id is null then
            raise foreign_key_violation using
              message = 'contract_period_contract_missing';
          end if;
          insert into public.retainer_periods (
            organization_id, client_id, retainer_id, period_start, period_end,
            included_minutes, rollover_minutes, fee_cents, status, closed_at,
            external_id, allowance_type, included_value_cents,
            consumed_value_cents, consumed_minutes, rollover_value_cents,
            overage_minutes, overage_value_cents, currency, template_revision,
            source_updated_at, source_payload
          )
          values (
            run.organization_id, client_id, retainer_id,
            (payload ->> 'period_start')::date,
            (payload ->> 'period_end')::date,
            coalesce((payload ->> 'included_minutes')::integer, 0),
            coalesce((payload ->> 'rollover_minutes')::integer, 0),
            coalesce((payload ->> 'fee_cents')::bigint, 0),
            coalesce(payload ->> 'status', 'open'),
            case when payload ->> 'status' = 'closed'
              then coalesce(
                nullif(payload ->> 'closed_at', '')::timestamptz,
                (payload ->> 'period_end')::date::timestamptz
              )
              else null
            end,
            stage.source_record_id,
            coalesce(payload ->> 'allowance_type', 'fixed_value'),
            nullif(payload ->> 'included_value_cents', '')::bigint,
            coalesce((payload ->> 'consumed_value_cents')::bigint, 0),
            coalesce((payload ->> 'consumed_minutes')::integer, 0),
            coalesce((payload ->> 'rollover_value_cents')::bigint, 0),
            coalesce((payload ->> 'overage_minutes')::integer, 0),
            coalesce((payload ->> 'overage_value_cents')::bigint, 0),
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            coalesce((payload ->> 'template_revision')::integer, 1),
            stage.source_updated_at, stage.raw_payload
          )
          on conflict on constraint
            retainer_periods_retainer_id_period_start_period_end_key
          do update set
            external_id = excluded.external_id,
            included_minutes = excluded.included_minutes,
            rollover_minutes = excluded.rollover_minutes,
            fee_cents = excluded.fee_cents,
            status = excluded.status,
            closed_at = excluded.closed_at,
            allowance_type = excluded.allowance_type,
            included_value_cents = excluded.included_value_cents,
            consumed_value_cents = excluded.consumed_value_cents,
            consumed_minutes = excluded.consumed_minutes,
            rollover_value_cents = excluded.rollover_value_cents,
            overage_minutes = excluded.overage_minutes,
            overage_value_cents = excluded.overage_value_cents,
            currency = excluded.currency,
            template_revision = excluded.template_revision,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload,
            updated_at = now()
          returning id into destination_id;

        when 'activities' then
          profile_id := private.accelo_destination_uuid($new$
  );

  updated_definition := replace(
    updated_definition,
    $old$          if client_id is null then
            raise foreign_key_violation using message = 'activity_client_missing';
          end if;
          insert into public.client_activities (
            organization_id, client_id, project_id, activity_type, subject,
            body, occurred_at, duration_minutes, external_id, source,
            source_updated_at, source_payload
          )$old$,
    $new$          if client_id is null then
            raise foreign_key_violation using message = 'activity_client_missing';
          end if;
          retainer_period_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contract_periods',
            payload ->> 'contract_period_source_id', 'retainer_periods'
          );
          contact_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contacts',
            payload ->> 'contact_source_id', 'contacts'
          );
          participant_contact_ids := private.accelo_participant_contact_ids(
            run.organization_id,
            run.source_account_id,
            payload -> 'participant_contact_source_ids',
            payload -> 'participant_affiliation_source_ids'
          );
          if contact_id is not null
            and not contact_id = any(participant_contact_ids)
          then
            participant_contact_ids :=
              array_append(participant_contact_ids, contact_id);
          end if;
          insert into public.client_activities (
            organization_id, client_id, project_id, contact_id,
            retainer_period_id, activity_type, subject, body, occurred_at,
            duration_minutes, direction, participant_contact_ids,
            external_id, source, source_updated_at, source_payload
          )$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            run.organization_id, client_id, project_id,
            coalesce(payload ->> 'activity_type', 'note'),$old$,
    $new$            run.organization_id, client_id, project_id, contact_id,
            retainer_period_id,
            coalesce(payload ->> 'activity_type', 'note'),$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            nullif(payload ->> 'duration_minutes', '')::integer,
            stage.source_record_id, 'accelo', stage.source_updated_at,$old$,
    $new$            nullif(payload ->> 'duration_minutes', '')::integer,
            coalesce(payload ->> 'direction', 'internal'),
            participant_contact_ids,
            stage.source_record_id, 'accelo', stage.source_updated_at,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            client_id = excluded.client_id,
            project_id = excluded.project_id,
            activity_type = excluded.activity_type,$old$,
    $new$            client_id = excluded.client_id,
            project_id = excluded.project_id,
            contact_id = excluded.contact_id,
            retainer_period_id = excluded.retainer_period_id,
            activity_type = excluded.activity_type,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            duration_minutes = excluded.duration_minutes,
            source_updated_at = excluded.source_updated_at,$old$,
    $new$            duration_minutes = excluded.duration_minutes,
            direction = excluded.direction,
            participant_contact_ids = excluded.participant_contact_ids,
            source_updated_at = excluded.source_updated_at,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$              organization_id, client_id, project_id, profile_id, entry_date,
              minutes, description, billable, status, billing_rate_cents,$old$,
    $new$              organization_id, client_id, project_id, profile_id,
              retainer_period_id, entry_date, minutes, description, billable,
              status, billing_rate_cents,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$              run.organization_id, client_id, project_id, profile_id,
              activity_entry_date,$old$,
    $new$              run.organization_id, client_id, project_id, profile_id,
              retainer_period_id, activity_entry_date,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$              'approved', rate_cents, cost_rate_cents, 'USD',$old$,
    $new$              'approved', rate_cents, cost_rate_cents,
              coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            coalesce(payload ->> 'currency', 'USD')::char(3),
            next_action,$old$,
    $new$            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            next_action,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            value_cents = excluded.value_cents,
            next_action = excluded.next_action,$old$,
    $new$            value_cents = excluded.value_cents,
            currency = excluded.currency,
            next_action = excluded.next_action,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            issued_at = excluded.issued_at,
            due_date = excluded.due_date,
            subtotal_cents = excluded.subtotal_cents,$old$,
    $new$            issued_at = excluded.issued_at,
            due_date = excluded.due_date,
            currency = excluded.currency,
            subtotal_cents = excluded.subtotal_cents,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            amount_cents = excluded.amount_cents,
            payment_date = excluded.payment_date,$old$,
    $new$            amount_cents = excluded.amount_cents,
            currency = excluded.currency,
            payment_date = excluded.payment_date,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$          if client_id is null then
            raise foreign_key_violation using message = 'issue_company_missing';
          end if;
          select item.id into project_id$old$,
    $new$          if client_id is null then
            raise foreign_key_violation using message = 'issue_company_missing';
          end if;
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'owner_source_id', 'profiles'
          );
          contact_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contacts',
            payload ->> 'contact_source_id', 'contacts'
          );
          select item.id into project_id$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$              'completed',
              'internal',$old$,
    $new$              case when payload ->> 'status' = 'done'
                then 'completed' else 'active' end,
              'internal',$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$              'Historical Accelo support issues. All imported issues are closed.'$old$,
    $new$              'Accelo support issues with source-faithful open and closed state.'$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            due_at, completed_at, accelo_issue_id, sync_status, last_synced_at,
            accelo_payload, source_updated_at, operational_state$old$,
    $new$            due_at, completed_at, assigned_to, accelo_issue_id,
            sync_status, last_synced_at, accelo_payload, source_updated_at,
            operational_state$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            coalesce(
              nullif(payload ->> 'completed_at', '')::timestamptz,
              now()
            ),
            stage.source_record_id, 'synced', now(), stage.raw_payload,
            stage.source_updated_at, 'historical'$old$,
    $new$            case when payload ->> 'status' = 'done'
              then coalesce(
                nullif(payload ->> 'completed_at', '')::timestamptz,
                now()
              )
              else null
            end,
            profile_id, stage.source_record_id, 'synced', now(),
            stage.raw_payload, stage.source_updated_at,
            case when payload ->> 'status' = 'done'
              then 'historical' else 'active' end$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            title = excluded.title,
            description = excluded.description,
            priority = excluded.priority,$old$,
    $new$            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            priority = excluded.priority,
            assigned_to = excluded.assigned_to,$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$            source_updated_at = excluded.source_updated_at,
            updated_at = now()
          returning id into destination_id;

        else
          raise feature_not_supported using message = 'unsupported_entity';$old$,
    $new$            source_updated_at = excluded.source_updated_at,
            operational_state = excluded.operational_state,
            updated_at = now()
          returning id into destination_id;

        else
          raise feature_not_supported using message = 'unsupported_entity';$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$          when 'contracts' then 'retainers'
          when 'activities' then 'client_activities'$old$,
    $new$          when 'contracts' then 'retainers'
          when 'contract_periods' then 'retainer_periods'
          when 'activities' then 'client_activities'$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$          'stage_record_id', stage.id,
          'transformer_version', stage.transformer_version
        )$old$,
    $new$          'stage_record_id', stage.id,
          'transformer_version', stage.transformer_version,
          'field_sha256', stage.field_sha256,
          'relationship_sha256', stage.relationship_sha256,
          'source_deleted', stage.source_deleted
        )$new$
  );

  if updated_definition = original_definition
    or position('contract_periods' in updated_definition) = 0
    or position('accelo_recovery_stage_links' in updated_definition) = 0
    or position('participant_contact_ids' in updated_definition) = 0
    or position('field_sha256' in updated_definition) = 0
  then
    raise exception 'Could not close Accelo promotion source parity.';
  end if;
  execute updated_definition;
end;
$migration$;

create or replace function private.get_accelo_pending_report(
  target_organization_id uuid,
  target_source_account_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with pending as (
    select
      unresolved.id,
      unresolved.entity_type,
      unresolved.source_record_id,
      unresolved.reason_code,
      unresolved.reason_detail,
      unresolved.required_parent_identity,
      unresolved.resolution_state,
      unresolved.recovery_status,
      unresolved.recovery_attempt_count,
      unresolved.recovery_reason_code,
      unresolved.first_seen_at,
      unresolved.last_attempted_at,
      archive.id as archive_id,
      archive.approval_state as archive_approval_state,
      archive.payload_sha256,
      archive.field_sha256,
      archive.relationship_sha256
    from public.accelo_unresolved_dependencies as unresolved
    left join public.accelo_orphan_archive as archive
      on archive.unresolved_id = unresolved.id
    where unresolved.organization_id = target_organization_id
      and unresolved.source_account_id = target_source_account_id
      and unresolved.resolution_state in ('pending', 'retry_ready')
    order by
      unresolved.entity_type,
      unresolved.source_record_id,
      unresolved.id
  ),
  totals as (
    select
      count(*)::bigint as pending_count,
      count(*) filter (
        where recovery_status in ('exhausted', 'unsupported')
      )::bigint as requires_disposition_count,
      count(*) filter (
        where archive_id is not null
          and archive_approval_state = 'pending'
      )::bigint as pending_archive_approval_count
    from pending
  )
  select jsonb_build_object(
    'organization_id', target_organization_id,
    'source_account_id', target_source_account_id,
    'pending_count', totals.pending_count,
    'requires_disposition_count', totals.requires_disposition_count,
    'pending_archive_approval_count', totals.pending_archive_approval_count,
    'records', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pending.id,
          'entity_type', pending.entity_type,
          'source_record_id', pending.source_record_id,
          'reason_code', pending.reason_code,
          'reason_detail', pending.reason_detail,
          'required_parent_identity', pending.required_parent_identity,
          'resolution_state', pending.resolution_state,
          'recovery_status', pending.recovery_status,
          'recovery_attempt_count', pending.recovery_attempt_count,
          'recovery_reason_code', pending.recovery_reason_code,
          'first_seen_at', pending.first_seen_at,
          'last_attempted_at', pending.last_attempted_at,
          'archive', case when pending.archive_id is null then null else
            jsonb_build_object(
              'id', pending.archive_id,
              'approval_state', pending.archive_approval_state,
              'payload_sha256', pending.payload_sha256,
              'field_sha256', pending.field_sha256,
              'relationship_sha256', pending.relationship_sha256
            )
          end
        )
        order by
          pending.entity_type,
          pending.source_record_id,
          pending.id
      )
      from pending
    ), '[]'::jsonb)
  )
  from totals;
$$;

create or replace function public.get_accelo_pending_report(
  target_organization_id uuid,
  target_source_account_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_accelo_pending_report(
    target_organization_id, target_source_account_id
  );
$$;

create or replace function private.guard_accelo_orphan_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise object_not_in_prerequisite_state using
      message = 'Accelo orphan archives cannot be deleted.';
  end if;
  if (
    new.organization_id,
    new.source_account_id,
    new.unresolved_id,
    new.stage_record_id,
    new.entity_type,
    new.source_record_id,
    new.raw_payload,
    new.normalized_payload,
    new.payload_sha256,
    new.field_sha256,
    new.relationship_sha256,
    new.required_parent_identity,
    new.archive_reason_code,
    new.archived_at
  ) is distinct from (
    old.organization_id,
    old.source_account_id,
    old.unresolved_id,
    old.stage_record_id,
    old.entity_type,
    old.source_record_id,
    old.raw_payload,
    old.normalized_payload,
    old.payload_sha256,
    old.field_sha256,
    old.relationship_sha256,
    old.required_parent_identity,
    old.archive_reason_code,
    old.archived_at
  ) or old.approval_state = 'approved'
  then
    raise object_not_in_prerequisite_state using
      message = 'Accelo orphan archive evidence is immutable.';
  end if;
  return new;
end;
$$;

create trigger guard_accelo_orphan_archive
  before update or delete on public.accelo_orphan_archive
  for each row execute function private.guard_accelo_orphan_archive();

create trigger guard_accelo_recovery_stage_links
  before update or delete on public.accelo_recovery_stage_links
  for each row execute function private.guard_accelo_append_only_audit();
create trigger guard_accelo_recovery_attempt_events
  before update or delete on public.accelo_recovery_attempt_events
  for each row execute function private.guard_accelo_append_only_audit();
create trigger guard_accelo_unresolved_disposition_events
  before update or delete on public.accelo_unresolved_disposition_events
  for each row execute function private.guard_accelo_append_only_audit();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accelo_recovery_stage_links',
    'accelo_recovery_attempt_events',
    'accelo_orphan_archive',
    'accelo_unresolved_disposition_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'revoke all on public.%I from public, anon, authenticated',
      table_name
    );
    execute format('grant select on public.%I to authenticated', table_name);
    execute format(
      'grant select, insert, update, delete on public.%I to service_role',
      table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated
       using ((select private.has_organization_role(
         organization_id, array[''admin'', ''manager'']::text[]
       )))',
      'Managers can read ' || table_name,
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.claim_accelo_activity_recoveries(uuid,uuid,integer)',
    'public.stage_accelo_recovery_batch(uuid,uuid,uuid,jsonb)',
    'public.record_accelo_recovery_failure(uuid,uuid,uuid,text,boolean)',
    'public.get_accelo_pending_report(uuid,text)'
  ]
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      function_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_signature
    );
  end loop;
end;
$$;

revoke all on function private.accelo_relationship_payload(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.accelo_relationship_payload(text, jsonb)
  to authenticated, service_role;
revoke all on function private.archive_accelo_orphan(uuid, text)
  from public, anon, authenticated;
revoke all on function private.claim_accelo_activity_recoveries(
  uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function private.stage_accelo_recovery_batch(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function private.record_accelo_recovery_failure(
  uuid, uuid, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function private.claim_accelo_activity_recoveries(
  uuid, uuid, integer
) to service_role;
grant execute on function private.stage_accelo_recovery_batch(
  uuid, uuid, uuid, jsonb
) to service_role;
grant execute on function private.record_accelo_recovery_failure(
  uuid, uuid, uuid, text, boolean
) to service_role;
revoke all on function private.accelo_participant_contact_ids(
  uuid, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function private.get_accelo_pending_report(uuid, text)
  from public, anon, authenticated;
revoke all on function private.guard_accelo_orphan_archive()
  from public, anon, authenticated;

do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.guard_accelo_native_write()'::regprocedure
  );
  updated_definition := replace(
    original_definition,
    $old$      and target_entity_type = any(run.requested_entities)
  ) then$old$,
    $new$      and (
        target_entity_type = any(run.requested_entities)
        or exists (
          select 1
          from public.accelo_recovery_stage_links as recovery_link
          where recovery_link.run_id = run.id
            and recovery_link.stage_record_id = nullif(
              current_setting('app.accelo_promotion_stage_id', true),
              ''
            )::uuid
        )
      )
  ) then$new$
  );
  if updated_definition = original_definition
    or position('accelo_recovery_stage_links' in updated_definition) = 0
  then
    raise exception 'Could not authorize bounded Accelo recovery promotion.';
  end if;
  execute updated_definition;
end;
$migration$;

create trigger guard_accelo_authority_retainer_periods
  before insert or update or delete on public.retainer_periods
  for each row execute function private.guard_accelo_native_write(
    'contract_periods'
  );

create trigger journal_accelo_promotion_retainer_periods
  after insert or update or delete on public.retainer_periods
  for each row execute function private.journal_accelo_promotion(
    'contract_periods'
  );

create or replace function private.accelo_financial_aggregates(
  target_run_id uuid,
  target_entity_type text,
  target_scan_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target_run as (
    select run.*
    from public.accelo_pull_runs as run
    where run.id = target_run_id
  ),
  latest as (
    select distinct on (stage.source_record_id)
      stage.source_record_id,
      stage.normalized_payload
    from public.accelo_pull_stage as stage
    join target_run as run on true
    where stage.entity_type = target_entity_type
      and not stage.source_deleted
      and private.accelo_stage_in_scan(
        stage.run_id, target_entity_type, target_scan_id, run.id
      )
    order by
      stage.source_record_id,
      stage.source_updated_at desc nulls last,
      stage.transformer_version desc,
      stage.staged_at desc,
      stage.id desc
  ),
  mapped_source as (
    select
      latest.source_record_id,
      latest.normalized_payload,
      mapping.destination_record_id::uuid as destination_record_id
    from latest
    join target_run as run on true
    join public.source_records as mapping
      on mapping.organization_id = run.organization_id
      and mapping.provider = 'accelo'
      and mapping.source_account_id = run.source_account_id
      and mapping.source_entity_type = target_entity_type
      and mapping.source_record_id = latest.source_record_id
      and not mapping.source_deleted
  ),
  source_rows as (
    select
      coalesce(
        nullif(normalized_payload ->> 'currency', ''),
        'USD'
      ) as currency,
      case target_entity_type
        when 'contracts' then
          coalesce((normalized_payload ->> 'fee_cents')::bigint, 0)
        when 'contract_periods' then
          coalesce((normalized_payload ->> 'fee_cents')::bigint, 0)
        when 'invoices' then
          coalesce((normalized_payload ->> 'amount_cents')::bigint, 0)
        when 'payments' then
          coalesce((normalized_payload ->> 'amount_cents')::bigint, 0)
        when 'prospects' then
          coalesce((normalized_payload ->> 'value_cents')::bigint, 0)
        when 'activities' then round(
          coalesce((normalized_payload ->> 'billable_seconds')::numeric, 0)
          * coalesce((normalized_payload ->> 'billing_rate_cents')::numeric, 0)
          / 3600
        )::bigint
        else 0
      end as fee_cents,
      case target_entity_type
        when 'contracts' then coalesce(
          (normalized_payload ->> 'allowance_value_cents')::bigint, 0
        )
        when 'contract_periods' then coalesce(
          (normalized_payload ->> 'included_value_cents')::bigint, 0
        )
        else 0
      end as allowance_cents,
      case when target_entity_type = 'contract_periods' then coalesce(
        (normalized_payload ->> 'consumed_value_cents')::bigint, 0
      ) else 0 end as consumption_cents,
      case when target_entity_type = 'contract_periods' then coalesce(
        (normalized_payload ->> 'rollover_value_cents')::bigint, 0
      ) else 0 end as rollover_cents,
      case when target_entity_type = 'contract_periods' then coalesce(
        (normalized_payload ->> 'overage_value_cents')::bigint, 0
      ) else 0 end as overage_cents
    from mapped_source
  ),
  destination_rows as (
    select
      retainer.currency::text as currency,
      retainer.fee_cents,
      coalesce(retainer.allowance_value_cents, 0) as allowance_cents,
      0::bigint as consumption_cents,
      0::bigint as rollover_cents,
      0::bigint as overage_cents
    from mapped_source
    join public.retainers as retainer
      on target_entity_type = 'contracts'
      and retainer.id = mapped_source.destination_record_id
    union all
    select
      period.currency::text,
      period.fee_cents,
      coalesce(period.included_value_cents, 0),
      period.consumed_value_cents,
      period.rollover_value_cents,
      period.overage_value_cents
    from mapped_source
    join public.retainer_periods as period
      on target_entity_type = 'contract_periods'
      and period.id = mapped_source.destination_record_id
    union all
    select
      invoice.currency::text,
      invoice.total_cents,
      0, 0, 0, 0
    from mapped_source
    join public.invoices as invoice
      on target_entity_type = 'invoices'
      and invoice.id = mapped_source.destination_record_id
    union all
    select
      payment.currency::text,
      payment.amount_cents,
      0, 0, 0, 0
    from mapped_source
    join public.payments as payment
      on target_entity_type = 'payments'
      and payment.id = mapped_source.destination_record_id
    union all
    select
      prospect.currency::text,
      prospect.value_cents,
      0, 0, 0, 0
    from mapped_source
    join public.prospects as prospect
      on target_entity_type = 'prospects'
      and prospect.id = mapped_source.destination_record_id
    union all
    select
      entry.currency::text,
      entry.billable_amount_cents,
      0, 0, 0, 0
    from mapped_source
    join target_run as run on true
    join public.time_entries as entry
      on target_entity_type = 'activities'
      and entry.organization_id = run.organization_id
      and entry.external_id = mapped_source.source_record_id
  ),
  source_totals as (
    select
      currency,
      sum(fee_cents)::bigint as fee_cents,
      sum(allowance_cents)::bigint as allowance_cents,
      sum(consumption_cents)::bigint as consumption_cents,
      sum(rollover_cents)::bigint as rollover_cents,
      sum(overage_cents)::bigint as overage_cents
    from source_rows
    group by currency
  ),
  destination_totals as (
    select
      currency,
      sum(fee_cents)::bigint as fee_cents,
      sum(allowance_cents)::bigint as allowance_cents,
      sum(consumption_cents)::bigint as consumption_cents,
      sum(rollover_cents)::bigint as rollover_cents,
      sum(overage_cents)::bigint as overage_cents
    from destination_rows
    group by currency
  )
  select jsonb_build_object(
    'source', coalesce((
      select jsonb_object_agg(
        currency,
        jsonb_build_object(
          'fee_cents', fee_cents,
          'allowance_cents', allowance_cents,
          'consumption_cents', consumption_cents,
          'rollover_cents', rollover_cents,
          'overage_cents', overage_cents
        )
        order by currency
      )
      from source_totals
    ), '{}'::jsonb),
    'destination', coalesce((
      select jsonb_object_agg(
        currency,
        jsonb_build_object(
          'fee_cents', fee_cents,
          'allowance_cents', allowance_cents,
          'consumption_cents', consumption_cents,
          'rollover_cents', rollover_cents,
          'overage_cents', overage_cents
        )
        order by currency
      )
      from destination_totals
    ), '{}'::jsonb)
  );
$$;

create or replace function private.refresh_accelo_reconciliation_evidence(
  target_run_id uuid,
  target_entity_type text,
  target_expected_count bigint,
  target_scan_id text
)
returns public.accelo_pull_reconciliations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run public.accelo_pull_runs%rowtype;
  result public.accelo_pull_reconciliations%rowtype;
  latest_count bigint;
  deleted_count bigint;
  mapped_total bigint;
  destination_total bigint;
  approved_total bigint;
  pending_total bigint;
  invalid_total bigint;
  field_mismatch_total bigint;
  relationship_mismatch_total bigint;
  finances jsonb;
  finances_required boolean;
  evidence_status text;
begin
  select item.* into run
  from public.accelo_pull_runs as item
  where item.id = target_run_id;
  if run.id is null then
    raise no_data_found using message = 'Accelo reconciliation run not found.';
  end if;

  with latest as (
    select distinct on (stage.source_record_id)
      stage.*
    from public.accelo_pull_stage as stage
    where stage.entity_type = target_entity_type
      and private.accelo_stage_in_scan(
        stage.run_id, target_entity_type, target_scan_id, run.id
      )
    order by
      stage.source_record_id,
      stage.source_updated_at desc nulls last,
      stage.transformer_version desc,
      stage.staged_at desc,
      stage.id desc
  )
  select
    count(*)::bigint,
    count(*) filter (where latest.source_deleted)::bigint
  into latest_count, deleted_count
  from latest;

  with latest as (
    select distinct on (stage.source_record_id)
      stage.*
    from public.accelo_pull_stage as stage
    where stage.entity_type = target_entity_type
      and private.accelo_stage_in_scan(
        stage.run_id, target_entity_type, target_scan_id, run.id
      )
    order by
      stage.source_record_id,
      stage.source_updated_at desc nulls last,
      stage.transformer_version desc,
      stage.staged_at desc,
      stage.id desc
  )
  update public.source_records as mapping
  set
    source_deleted = true,
    retired_at = coalesce(mapping.retired_at, statement_timestamp()),
    last_seen_run_id = run.id,
    last_seen_at = statement_timestamp(),
    metadata = mapping.metadata || jsonb_build_object(
      'source_deleted', true,
      'source_retired_at', statement_timestamp(),
      'retired_by_explicit_source_record', true
    )
  from latest
  where latest.source_deleted
    and mapping.organization_id = run.organization_id
    and mapping.provider = 'accelo'
    and mapping.source_account_id = run.source_account_id
    and mapping.source_entity_type = target_entity_type
    and mapping.source_record_id = latest.source_record_id;

  with latest as (
    select distinct on (stage.source_record_id)
      stage.*
    from public.accelo_pull_stage as stage
    where stage.entity_type = target_entity_type
      and not stage.source_deleted
      and private.accelo_stage_in_scan(
        stage.run_id, target_entity_type, target_scan_id, run.id
      )
    order by
      stage.source_record_id,
      stage.source_updated_at desc nulls last,
      stage.transformer_version desc,
      stage.staged_at desc,
      stage.id desc
  ),
  mapped as (
    select latest.*, mapping.*
    from latest
    join public.source_records as mapping
      on mapping.organization_id = run.organization_id
      and mapping.provider = 'accelo'
      and mapping.source_account_id = run.source_account_id
      and mapping.source_entity_type = target_entity_type
      and mapping.source_record_id = latest.source_record_id
      and not mapping.source_deleted
  )
  select
    count(*)::bigint,
    count(*) filter (
      where private.accelo_destination_exists(
        mapped.destination_table, mapped.destination_record_id
      )
    )::bigint,
    count(*) filter (
      where mapped.metadata ? 'field_sha256'
        and mapped.metadata ->> 'field_sha256'
        is distinct from mapped.field_sha256
    )::bigint,
    count(*) filter (
      where mapped.metadata ? 'relationship_sha256'
        and mapped.metadata ->> 'relationship_sha256'
        is distinct from mapped.relationship_sha256
    )::bigint
  into
    mapped_total,
    destination_total,
    field_mismatch_total,
    relationship_mismatch_total
  from mapped;

  select count(*)::bigint into approved_total
  from public.accelo_unresolved_dependencies as unresolved
  join public.accelo_pull_stage as stage
    on stage.id = unresolved.stage_record_id
  where unresolved.organization_id = run.organization_id
    and unresolved.source_account_id = run.source_account_id
    and unresolved.entity_type = target_entity_type
    and unresolved.resolution_state = 'approved_exclusion'
    and unresolved.approved_disposition in ('exclude', 'archive')
    and private.accelo_stage_in_scan(
      stage.run_id, target_entity_type, target_scan_id, run.id
    );

  select count(*)::bigint into pending_total
  from public.accelo_unresolved_dependencies as unresolved
  join public.accelo_pull_stage as stage
    on stage.id = unresolved.stage_record_id
  where unresolved.organization_id = run.organization_id
    and unresolved.source_account_id = run.source_account_id
    and unresolved.entity_type = target_entity_type
    and unresolved.resolution_state in ('pending', 'retry_ready')
    and private.accelo_stage_in_scan(
      stage.run_id, target_entity_type, target_scan_id, run.id
    );

  select count(distinct quarantine.source_record_id)::bigint
    into invalid_total
  from public.accelo_pull_quarantine as quarantine
  where quarantine.run_id = run.id
    and quarantine.entity_type = target_entity_type
    and quarantine.stage_record_id is null;

  finances := private.accelo_financial_aggregates(
    run.id, target_entity_type, target_scan_id
  );
  finances_required := target_entity_type in (
    'contracts', 'contract_periods', 'activities',
    'invoices', 'payments', 'prospects'
  );
  evidence_status := case
    when target_expected_count is null then 'mismatch'
    when target_expected_count
      <> latest_count + invalid_total then 'mismatch'
    when target_expected_count
      <> mapped_total + approved_total + deleted_count + invalid_total
      then 'mismatch'
    when destination_total <> mapped_total then 'mismatch'
    when pending_total > 0 then 'mismatch'
    when field_mismatch_total > 0 or relationship_mismatch_total > 0
      then 'mismatch'
    when finances_required
      and finances -> 'source' is distinct from finances -> 'destination'
      then 'mismatch'
    else 'matched'
  end;

  update public.accelo_pull_reconciliations as reconciliation
  set
    expected_count = target_expected_count,
    staged_count = latest_count,
    latest_unique_staged_count = latest_count,
    source_deleted_count = deleted_count,
    quarantined_count = pending_total + invalid_total,
    mapped_count = mapped_total,
    approved_exclusion_count = approved_total,
    destination_count = destination_total,
    destination_missing_count = greatest(mapped_total - destination_total, 0),
    field_hash_mismatch_count = field_mismatch_total,
    relationship_mismatch_count = relationship_mismatch_total,
    relationship_missing_count = pending_total,
    financial_source = finances -> 'source',
    financial_destination = finances -> 'destination',
    status = evidence_status,
    details = jsonb_build_object(
      'equations', jsonb_build_array(
        'expected=latest_unique_staged+invalid_archive',
        'expected=mapped+approved_exclusions+source_deleted+invalid_archive',
        'mapped=destinations'
      ),
      'latest_unique_staged', latest_count,
      'invalid_archive', invalid_total,
      'mapped', mapped_total,
      'destinations', destination_total,
      'approved_exclusions', approved_total,
      'source_deleted', deleted_count,
      'pending', pending_total,
      'field_hash_mismatches', field_mismatch_total,
      'relationship_hash_mismatches', relationship_mismatch_total,
      'financials', finances
    ),
    reconciled_at = statement_timestamp()
  where reconciliation.run_id = run.id
    and reconciliation.entity_type = target_entity_type
  returning reconciliation.* into result;
  return result;
end;
$$;

do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.finalize_accelo_pull_run(uuid,uuid,jsonb,jsonb)'::regprocedure
  );
  updated_definition := replace(
    original_definition,
    $old$    if reconciliation_status = 'mismatch' then
      final_status := 'partial';$old$,
    $new$    perform private.refresh_accelo_reconciliation_evidence(
      result.id, entity_name, expected_total, scan_id
    );
    select reconciliation.status into reconciliation_status
    from public.accelo_pull_reconciliations as reconciliation
    where reconciliation.run_id = result.id
      and reconciliation.entity_type = entity_name;

    if reconciliation_status = 'mismatch' then
      final_status := 'partial';$new$
  );
  if updated_definition = original_definition
    or position('refresh_accelo_reconciliation_evidence' in updated_definition) = 0
  then
    raise exception 'Could not attach complete Accelo reconciliation evidence.';
  end if;
  execute updated_definition;
end;
$migration$;

revoke all on function private.accelo_financial_aggregates(uuid, text, text)
  from public, anon, authenticated;
revoke all on function private.refresh_accelo_reconciliation_evidence(
  uuid, text, bigint, text
) from public, anon, authenticated;
