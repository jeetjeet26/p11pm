-- Make the GET-only Accelo migration bridge fail closed, versioned, resumable,
-- reconcilable, and reversible without changing anything in Accelo.

alter table public.accelo_pull_stage
  add column transformer_version integer not null default 1
  check (transformer_version between 1 and 1000000);

alter table public.accelo_pull_checkpoints
  add column source_account_id text;

alter table public.accelo_pull_checkpoints
  disable trigger guard_accelo_pull_checkpoint_append;

update public.accelo_pull_checkpoints as checkpoint
set source_account_id = run.source_account_id
from public.accelo_pull_runs as run
where run.id = checkpoint.run_id;

alter table public.accelo_pull_checkpoints
  enable trigger guard_accelo_pull_checkpoint_append;

alter table public.accelo_pull_checkpoints
  alter column source_account_id set not null;

create index accelo_pull_checkpoints_account_cursor_idx
  on public.accelo_pull_checkpoints (
    organization_id,
    source_account_id,
    entity_type,
    completed_at desc,
    id desc
  );

alter table public.accelo_pull_reconciliations
  add column approved_exclusion_count bigint not null default 0
    check (approved_exclusion_count >= 0),
  add column destination_count bigint not null default 0
    check (destination_count >= 0),
  add column destination_missing_count bigint not null default 0
    check (destination_missing_count >= 0);

create table public.accelo_unresolved_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  source_account_id text not null
    check (char_length(btrim(source_account_id)) between 1 and 200),
  entity_type text not null
    check (entity_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  source_record_id text not null
    check (char_length(btrim(source_record_id)) between 1 and 500),
  stage_record_id uuid not null,
  transformer_version integer not null
    check (transformer_version between 1 and 1000000),
  child_identity jsonb not null check (jsonb_typeof(child_identity) = 'object'),
  required_parent_identity jsonb not null
    check (jsonb_typeof(required_parent_identity) = 'object'),
  reason_code text not null
    check (reason_code ~ '^[a-z][a-z0-9_]{0,99}$'),
  reason_detail text,
  attempt_count integer not null default 1
    check (attempt_count between 1 and 1000),
  resolution_state text not null default 'pending'
    check (
      resolution_state in (
        'pending', 'retry_ready', 'resolved', 'approved_exclusion'
      )
    ),
  approved_disposition text
    check (approved_disposition in ('retry', 'exclude', 'archive')),
  resolution_reason text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  first_seen_run_id uuid not null
    references public.accelo_pull_runs(id) on delete restrict,
  last_seen_run_id uuid not null
    references public.accelo_pull_runs(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (stage_record_id),
  foreign key (organization_id, stage_record_id)
    references public.accelo_pull_stage(organization_id, id) on delete restrict,
  constraint accelo_unresolved_resolution_valid check (
    (
      resolution_state = 'pending'
      and approved_disposition is null
      and resolved_by is null
      and resolved_at is null
    )
    or (
      resolution_state = 'retry_ready'
      and approved_disposition = 'retry'
      and resolved_by is not null
      and resolved_at is not null
      and char_length(btrim(resolution_reason)) between 3 and 1000
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
  )
);

create index accelo_unresolved_current_idx
  on public.accelo_unresolved_dependencies (
    organization_id,
    source_account_id,
    resolution_state,
    entity_type,
    updated_at desc
  )
  where resolution_state in ('pending', 'retry_ready');

create table public.accelo_authority_transition_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  source_account_id text not null,
  entity_type text not null,
  previous_state text not null,
  target_state text not null,
  evidence_run_id uuid references public.accelo_pull_runs(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  transitioned_at timestamptz not null default now()
);

create index accelo_authority_transition_events_idx
  on public.accelo_authority_transition_events (
    organization_id, source_account_id, entity_type, transitioned_at desc
  );

create table public.accelo_promotion_journal (
  sequence_id bigint generated always as identity primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  run_id uuid not null references public.accelo_pull_runs(id) on delete restrict,
  entity_type text not null,
  source_record_id text,
  destination_table text not null,
  destination_record_id uuid not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  before_image jsonb,
  after_image jsonb,
  recorded_at timestamptz not null default now(),
  constraint accelo_promotion_journal_images_valid check (
    (operation = 'insert' and before_image is null and after_image is not null)
    or (operation = 'update' and before_image is not null and after_image is not null)
    or (operation = 'delete' and before_image is not null and after_image is null)
  )
);

create index accelo_promotion_journal_run_sequence_idx
  on public.accelo_promotion_journal (run_id, sequence_id desc);

create table public.accelo_rollback_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  run_id uuid not null references public.accelo_pull_runs(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  status text not null check (status in ('running', 'succeeded', 'conflicted')),
  restored_count bigint not null default 0 check (restored_count >= 0),
  conflict_count bigint not null default 0 check (conflict_count >= 0),
  conflicts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(conflicts) = 'array'),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function private.guard_accelo_append_only_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise object_not_in_prerequisite_state using
    message = 'Accelo authority, promotion, and rollback audit rows are append-only.';
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
    'retainers', 'client_activities', 'invoices', 'payments', 'prospects',
    'milestones', 'todos'
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

create or replace function private.accelo_stage_in_scan(
  target_stage_run_id uuid,
  target_entity_type text,
  target_scan_id text,
  target_fallback_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when nullif(target_scan_id, '') is null
      then target_stage_run_id = target_fallback_run_id
    else exists (
      select 1
      from public.accelo_pull_checkpoints as checkpoint
      where checkpoint.run_id = target_stage_run_id
        and checkpoint.entity_type = target_entity_type
        and checkpoint.cursor ->> 'scanId' = target_scan_id
    )
  end;
$$;

create or replace function private.finalize_accelo_pull_run(
  target_run_id uuid,
  target_lease_token uuid,
  target_end_cursor jsonb,
  target_summary jsonb
)
returns public.accelo_pull_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.accelo_pull_runs%rowtype;
  entity_name text;
  expected_total bigint;
  staged_total bigint;
  mapped_total bigint;
  approved_total bigint;
  destination_total bigint;
  pending_total bigint;
  scan_id text;
  scan_run_ids uuid[];
  reconciliation_status text;
  final_status text := 'succeeded';
  all_complete boolean := true;
begin
  select run.* into result
  from public.accelo_pull_runs as run
  where run.id = target_run_id
  for update;

  if result.id is null then
    raise no_data_found using message = 'Accelo pull run not found.';
  end if;
  if result.status in ('succeeded', 'partial') then
    return result;
  end if;
  if result.status <> 'running'
    or result.lease_token <> target_lease_token
    or result.lease_expires_at <= statement_timestamp()
  then
    raise object_not_in_prerequisite_state using
      message = 'Accelo pull finalization requires its active lease.';
  end if;
  if jsonb_typeof(coalesce(target_summary, '{}'::jsonb)) <> 'object'
    or (
      target_end_cursor is not null
      and jsonb_typeof(target_end_cursor) <> 'object'
    )
  then
    raise check_violation using message = 'Invalid Accelo finalization payload.';
  end if;

  foreach entity_name in array result.requested_entities
  loop
    scan_id := nullif(
      target_summary #>> array['resources', entity_name, 'scan_id'],
      ''
    );
    expected_total := nullif(
      target_summary #>> array['resources', entity_name, 'expected_count'],
      ''
    )::bigint;
    select coalesce(
      array_agg(distinct checkpoint.run_id),
      array[result.id]
    ) into scan_run_ids
    from public.accelo_pull_checkpoints as checkpoint
    where checkpoint.organization_id = result.organization_id
      and checkpoint.source_account_id = result.source_account_id
      and checkpoint.entity_type = entity_name
      and (
        (
          scan_id is not null
          and checkpoint.cursor ->> 'scanId' = scan_id
        )
        or (scan_id is null and checkpoint.run_id = result.id)
      );

    select count(*)::bigint into staged_total
    from (
      select distinct stage.source_record_id
      from public.accelo_pull_stage as stage
      where stage.entity_type = entity_name
        and stage.run_id = any(scan_run_ids)
    ) as staged;

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

    -- Seeing an unchanged source version still advances its account-scoped
    -- identity across every bounded run that belongs to this scan.
    if exists (
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
    end if;

    select count(*)::bigint into mapped_total
    from (
      select distinct stage.source_record_id
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
    ) as mapped;

    select count(distinct unresolved.source_record_id)::bigint
      into approved_total
    from public.accelo_unresolved_dependencies as unresolved
    join public.accelo_pull_stage as stage
      on stage.id = unresolved.stage_record_id
    where unresolved.organization_id = result.organization_id
      and unresolved.source_account_id = result.source_account_id
      and unresolved.entity_type = entity_name
      and stage.run_id = any(scan_run_ids)
      and unresolved.resolution_state = 'approved_exclusion'
      and unresolved.approved_disposition in ('exclude', 'archive');

    if entity_name = 'activities' then
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
    end if;

    select count(*)::bigint into pending_total
    from public.accelo_unresolved_dependencies as unresolved
    join public.accelo_pull_stage as stage
      on stage.id = unresolved.stage_record_id
    where unresolved.resolution_state in ('pending', 'retry_ready')
      and unresolved.entity_type = entity_name
      and stage.run_id = any(scan_run_ids);

    if expected_total is null then
      expected_total := staged_total;
    end if;
    reconciliation_status := case
      when coalesce((target_summary ->> 'truncated')::boolean, false)
        then 'mismatch'
      when result.full_snapshot and not coalesce(
        (
          target_summary #>>
            array['resources', entity_name, 'complete']
        )::boolean,
        false
      ) then 'mismatch'
      when expected_total is null then 'mismatch'
      when expected_total <> mapped_total + approved_total then 'mismatch'
      when destination_total <> mapped_total then 'mismatch'
      when pending_total > 0 then 'mismatch'
      else 'matched'
    end;

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
      pending_total,
      mapped_total,
      approved_total,
      destination_total,
      greatest(mapped_total - destination_total, 0),
      reconciliation_status,
      jsonb_build_object(
        'equation', 'expected=mapped+approved_exclusions',
        'pending_dependencies', pending_total,
        'complete_snapshot', result.full_snapshot and coalesce(
          (
            target_summary #>>
              array['resources', entity_name, 'complete']
          )::boolean,
          false
        )
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

    if reconciliation_status = 'mismatch' then
      final_status := 'partial';
      all_complete := false;
    end if;
  end loop;

  -- Source absence is a retirement signal only after a complete, fully matched
  -- inventory. Incremental and truncated runs can never retire identities.
  if result.full_snapshot and all_complete then
    update public.source_records as mapping
    set
      source_deleted = true,
      retired_at = coalesce(mapping.retired_at, statement_timestamp()),
      metadata = mapping.metadata || jsonb_build_object(
        'retired_by_inventory_run_id', result.id
      )
    where mapping.organization_id = result.organization_id
      and mapping.provider = 'accelo'
      and mapping.source_account_id = result.source_account_id
      and mapping.source_entity_type = any(result.requested_entities)
      and not mapping.source_deleted
      and not exists (
        select 1
        from public.accelo_pull_stage as stage
        where stage.entity_type = mapping.source_entity_type
          and stage.source_record_id = mapping.source_record_id
          and private.accelo_stage_in_scan(
            stage.run_id,
            mapping.source_entity_type,
            target_summary #>> array[
              'resources', mapping.source_entity_type, 'scan_id'
            ],
            result.id
          )
      );
  end if;

  update public.accelo_pull_runs as run
  set
    status = final_status,
    end_cursor = target_end_cursor,
    records_staged = (
      select count(*)::bigint
      from public.accelo_pull_stage
      where run_id = result.id
    ),
    records_quarantined = (
      select count(*)::bigint
      from public.accelo_unresolved_dependencies as unresolved
      where unresolved.last_seen_run_id = result.id
        and unresolved.resolution_state in ('pending', 'retry_ready')
    ),
    records_mapped = (
      select coalesce(sum(reconciliation.mapped_count), 0)::bigint
      from public.accelo_pull_reconciliations as reconciliation
      where reconciliation.run_id = result.id
    ),
    summary = coalesce(target_summary, '{}'::jsonb),
    finalized_at = statement_timestamp()
  where run.id = result.id
  returning run.* into result;
  return result;
end;
$$;

create or replace function private.reap_stale_accelo_pull_runs()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reaped integer;
begin
  update public.accelo_pull_runs as run
  set
    status = 'failed',
    error_message = 'stale_lease_reaped',
    finalized_at = statement_timestamp(),
    summary = run.summary || jsonb_build_object(
      'reaped_at', statement_timestamp(),
      'expired_lease_owner', run.lease_owner
    )
  where run.status = 'running'
    and run.lease_expires_at <= statement_timestamp();
  get diagnostics reaped = row_count;
  return reaped;
end;
$$;

create or replace function public.reap_stale_accelo_pull_runs()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reap_stale_accelo_pull_runs();
$$;

revoke all on function public.reap_stale_accelo_pull_runs()
  from public, anon, authenticated;
grant execute on function public.reap_stale_accelo_pull_runs()
  to service_role;

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

-- Harden the already-deployed domain mapper in place so the mapping body remains
-- centralized while candidate selection and failure semantics become safe.
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
$old$  if run.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo pull lease is missing, expired, or owned elsewhere.';
  end if;

  for stage in$old$,
$new$  if run.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo pull lease is missing, expired, or owned elsewhere.';
  end if;
  perform set_config('app.accelo_promotion_run_id', run.id::text, true);

  for stage in$new$
  );

  updated_definition := replace(
    updated_definition,
$old$      and item.entity_type = any(run.requested_entities)
      and not exists (
        select 1
        from public.source_records as mapping
        where mapping.organization_id = run.organization_id
          and mapping.provider = 'accelo'
          and mapping.source_account_id = run.source_account_id
          and mapping.source_entity_type = item.entity_type
          and mapping.source_record_id = item.source_record_id
          and mapping.payload_sha256 = item.payload_sha256
          and not mapping.source_deleted
      )$old$,
$new$      and item.entity_type = any(run.requested_entities)
      and item.normalized_payload is not null
      and not item.source_deleted
      and exists (
        select 1
        from public.integration_authority_states as authority
        where authority.organization_id = run.organization_id
          and authority.provider = 'accelo'
          and authority.source_account_id = run.source_account_id
          and authority.entity_type = item.entity_type
          and authority.state in (
            'importing', 'accelo_authoritative', 'final_delta'
          )
      )
      and not exists (
        select 1
        from public.accelo_pull_stage as newer
        join public.accelo_pull_runs as newer_run on newer_run.id = newer.run_id
        where newer_run.organization_id = run.organization_id
          and newer_run.provider = 'accelo'
          and newer_run.source_account_id = run.source_account_id
          and newer_run.status in ('running', 'partial', 'succeeded')
          and newer.entity_type = item.entity_type
          and newer.source_record_id = item.source_record_id
          and (
            coalesce(newer.source_updated_at, '-infinity'::timestamptz),
            newer.transformer_version,
            newer.staged_at,
            newer.id
          ) > (
            coalesce(item.source_updated_at, '-infinity'::timestamptz),
            item.transformer_version,
            item.staged_at,
            item.id
          )
      )
      and not exists (
        select 1
        from public.accelo_unresolved_dependencies as unresolved
        where unresolved.stage_record_id = item.id
          and unresolved.resolution_state in ('pending', 'approved_exclusion')
      )
      and not exists (
        select 1
        from public.source_records as mapping
        where mapping.organization_id = run.organization_id
          and mapping.provider = 'accelo'
          and mapping.source_account_id = run.source_account_id
          and mapping.source_entity_type = item.entity_type
          and mapping.source_record_id = item.source_record_id
          and not mapping.source_deleted
          and (
            (
              mapping.payload_sha256 = item.payload_sha256
              and coalesce(
                (mapping.metadata ->> 'transformer_version')::integer,
                1
              ) >= item.transformer_version
            )
            or mapping.source_updated_at > item.source_updated_at
            or (
              mapping.source_updated_at is not null
              and item.source_updated_at is null
            )
          )
      )$new$
  );

  updated_definition := replace(
    updated_definition,
$old$      item.staged_at,
      item.id
  loop
    payload := stage.normalized_payload;$old$,
$new$      item.staged_at,
      item.id
    limit 500
  loop
    perform set_config('app.accelo_promotion_stage_id', stage.id::text, true);
    payload := stage.normalized_payload;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$    if authority_state in ('disabled', 'supabase_authoritative', 'audit_only') then
      skipped_count := skipped_count + 1;
      continue;
    end if;$old$,
$new$    if authority_state is null
      or authority_state not in (
        'importing', 'accelo_authoritative', 'final_delta'
      )
    then
      skipped_count := skipped_count + 1;
      continue;
    end if;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$        jsonb_build_object('stage_record_id', stage.id)
      );$old$,
$new$        jsonb_build_object(
          'stage_record_id', stage.id,
          'transformer_version', stage.transformer_version
        )
      );$new$
  );

  updated_definition := replace(
    updated_definition,
$old$      mapped_count := mapped_count + 1;
    exception$old$,
$new$      update public.accelo_unresolved_dependencies as unresolved
      set
        resolution_state = 'resolved',
        resolved_at = statement_timestamp(),
        last_seen_run_id = run.id
      where unresolved.stage_record_id = stage.id
        and unresolved.resolution_state = 'retry_ready';
      mapped_count := mapped_count + 1;
    exception$new$
  );

  updated_definition := replace(
    updated_definition,
$old$    exception
      when others then
        insert into public.accelo_pull_quarantine (
          organization_id, run_id, stage_record_id, entity_type,
          source_record_id, reason_code, reason_detail, raw_payload
        )
        values (
          run.organization_id, run.id, stage.id, stage.entity_type,
          stage.source_record_id, 'promotion_failed',
          sqlstate || ':' || sqlerrm, stage.raw_payload
        )
        on conflict do nothing;
        quarantined_count := quarantined_count + 1;
    end;$old$,
$new$    exception
      when others then
        insert into public.accelo_unresolved_dependencies (
          organization_id,
          source_account_id,
          entity_type,
          source_record_id,
          stage_record_id,
          transformer_version,
          child_identity,
          required_parent_identity,
          reason_code,
          reason_detail,
          first_seen_run_id,
          last_seen_run_id
        )
        values (
          run.organization_id,
          run.source_account_id,
          stage.entity_type,
          stage.source_record_id,
          stage.id,
          stage.transformer_version,
          jsonb_build_object(
            'entity_type', stage.entity_type,
            'source_record_id', stage.source_record_id
          ),
          private.accelo_required_parent_identity(stage.entity_type, payload),
          case
            when sqlstate = '23503' then 'missing_parent'
            else 'promotion_failed'
          end,
          left(sqlstate || ':' || sqlerrm, 2000),
          run.id,
          run.id
        )
        on conflict (stage_record_id) do update
        set
          attempt_count = least(
            public.accelo_unresolved_dependencies.attempt_count + 1,
            1000
          ),
          resolution_state = 'pending',
          approved_disposition = null,
          resolution_reason = null,
          resolved_by = null,
          resolved_at = null,
          reason_detail = excluded.reason_detail,
          last_seen_run_id = excluded.last_seen_run_id,
          last_attempted_at = statement_timestamp();

        insert into public.accelo_pull_quarantine (
          organization_id, run_id, stage_record_id, entity_type,
          source_record_id, reason_code, reason_detail, raw_payload
        )
        values (
          run.organization_id, run.id, stage.id, stage.entity_type,
          stage.source_record_id, 'promotion_failed',
          left(sqlstate || ':' || sqlerrm, 2000), stage.raw_payload
        )
        on conflict do nothing;
        quarantined_count := quarantined_count + 1;
    end;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$    records_quarantined = records_quarantined + quarantined_count,
    heartbeat_at = statement_timestamp()
  where id = run.id;

  return jsonb_build_object(
    'mapped', mapped_count,
    'quarantined', quarantined_count,
    'skipped', skipped_count
  );$old$,
$new$    records_quarantined = records_quarantined + quarantined_count,
    heartbeat_at = statement_timestamp(),
    lease_expires_at = statement_timestamp() + interval '5 minutes'
  where id = run.id;

  return jsonb_build_object(
    'mapped', mapped_count,
    'quarantined', quarantined_count,
    'skipped', skipped_count,
    'has_more', mapped_count + quarantined_count + skipped_count >= 500
  );$new$
  );

  if updated_definition = original_definition then
    raise exception 'Could not harden Accelo promotion function.';
  end if;
  if position('limit 500' in updated_definition) = 0
    or position('app.accelo_promotion_run_id' in updated_definition) = 0
    or position('accelo_unresolved_dependencies' in updated_definition) = 0
  then
    raise exception 'Accelo promotion hardening was incomplete.';
  end if;
  execute updated_definition;
end;
$migration$;

create trigger guard_accelo_authority_transition_events
  before update or delete on public.accelo_authority_transition_events
  for each row execute function private.guard_accelo_append_only_audit();
create trigger guard_accelo_promotion_journal
  before update or delete on public.accelo_promotion_journal
  for each row execute function private.guard_accelo_append_only_audit();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accelo_unresolved_dependencies',
    'accelo_authority_transition_events',
    'accelo_promotion_journal',
    'accelo_rollback_attempts'
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

create trigger set_accelo_unresolved_dependencies_updated_at
  before update on public.accelo_unresolved_dependencies
  for each row execute function private.set_updated_at();

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

  update public.accelo_unresolved_dependencies as unresolved
  set
    resolution_state = case
      when target_disposition = 'retry' then 'retry_ready'
      else 'approved_exclusion'
    end,
    approved_disposition = target_disposition,
    resolution_reason = btrim(target_reason),
    resolved_by = target_actor_id,
    resolved_at = statement_timestamp()
  where unresolved.id = result.id
  returning unresolved.* into result;
  return result;
end;
$$;

create or replace function public.set_accelo_unresolved_disposition(
  target_unresolved_id uuid,
  target_disposition text,
  target_actor_id uuid,
  target_reason text
)
returns public.accelo_unresolved_dependencies
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_accelo_unresolved_disposition(
    target_unresolved_id,
    target_disposition,
    target_actor_id,
    target_reason
  );
$$;

revoke all on function public.set_accelo_unresolved_disposition(
  uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_accelo_unresolved_disposition(
  uuid, text, uuid, text
) to service_role;

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
    normalized_payload,
    transformer_version
  )
  select
    target_organization_id,
    target_run_id,
    target_entity_type,
    record ->> 'source_id',
    nullif(record ->> 'source_updated_at', '')::timestamptz,
    coalesce((record ->> 'source_deleted')::boolean, false),
    record -> 'raw_payload',
    record -> 'normalized_payload',
    coalesce((record ->> 'transformer_version')::integer, 1)
  from jsonb_array_elements(target_records) as item(record)
  where jsonb_typeof(record -> 'raw_payload') = 'object'
    and jsonb_typeof(record -> 'normalized_payload') = 'object'
    and nullif(record ->> 'source_id', '') is not null
    and coalesce((record ->> 'transformer_version')::integer, 1)
      between 1 and 1000000
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

create or replace function private.record_accelo_pull_checkpoint(
  target_run_id uuid,
  target_lease_token uuid,
  target_entity_type text,
  target_checkpoint_key text,
  target_page_number integer,
  target_cursor jsonb,
  target_high_watermark timestamptz,
  target_record_count integer,
  target_content_sha256 text
)
returns public.accelo_pull_checkpoints
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_source_account_id text;
  result public.accelo_pull_checkpoints%rowtype;
begin
  select run.organization_id, run.source_account_id
    into target_organization_id, target_source_account_id
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

  select checkpoint.* into result
  from public.accelo_pull_checkpoints as checkpoint
  where checkpoint.run_id = target_run_id
    and checkpoint.entity_type = target_entity_type
    and checkpoint.checkpoint_key = target_checkpoint_key;

  if result.id is not null then
    if (
      result.page_number,
      result.cursor,
      result.high_watermark,
      result.record_count,
      result.content_sha256
    ) is distinct from (
      target_page_number,
      coalesce(target_cursor, '{}'::jsonb),
      target_high_watermark,
      target_record_count,
      target_content_sha256
    ) then
      raise unique_violation using
        message = 'Idempotent Accelo checkpoint retry changed checkpoint data.';
    end if;
    return result;
  end if;

  insert into public.accelo_pull_checkpoints (
    organization_id,
    source_account_id,
    run_id,
    entity_type,
    checkpoint_key,
    page_number,
    cursor,
    high_watermark,
    record_count,
    content_sha256
  )
  values (
    target_organization_id,
    target_source_account_id,
    target_run_id,
    target_entity_type,
    target_checkpoint_key,
    target_page_number,
    coalesce(target_cursor, '{}'::jsonb),
    target_high_watermark,
    target_record_count,
    target_content_sha256
  )
  returning * into result;
  return result;
end;
$$;

create or replace function private.accelo_row_organization(
  target_table text,
  target_row jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  if nullif(target_row ->> 'organization_id', '') is not null then
    return (target_row ->> 'organization_id')::uuid;
  end if;
  if target_table in ('todos', 'milestones', 'todo_lists') then
    select project.organization_id into result
    from public.projects as project
    where project.id = (target_row ->> 'project_id')::uuid;
  end if;
  return result;
end;
$$;

create or replace function private.guard_accelo_native_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := case
    when tg_op = 'DELETE' then to_jsonb(old)
    else to_jsonb(new)
  end;
  target_organization_id uuid;
  promotion_run_id uuid;
  rollback_run_id uuid;
  target_entity_type text := tg_argv[0];
begin
  target_organization_id :=
    private.accelo_row_organization(tg_table_name, row_data);
  if target_organization_id is null then
    return coalesce(new, old);
  end if;

  promotion_run_id := nullif(
    current_setting('app.accelo_promotion_run_id', true),
    ''
  )::uuid;
  rollback_run_id := nullif(
    current_setting('app.accelo_rollback_run_id', true),
    ''
  )::uuid;
  if rollback_run_id is not null then
    return coalesce(new, old);
  end if;
  if promotion_run_id is not null and exists (
    select 1
    from public.accelo_pull_runs as active_context
    where active_context.id = promotion_run_id
      and active_context.status = 'running'
      and active_context.lease_expires_at > statement_timestamp()
  ) then
    select stage.entity_type into target_entity_type
    from public.accelo_pull_stage as stage
    where stage.id = nullif(
      current_setting('app.accelo_promotion_stage_id', true),
      ''
    )::uuid;
  else
    promotion_run_id := null;
  end if;
  if promotion_run_id is null
    and tg_table_name = 'todos'
    and nullif(row_data ->> 'accelo_issue_id', '') is not null
  then
    target_entity_type := 'issues';
  end if;
  if promotion_run_id is not null and exists (
    select 1
    from public.accelo_pull_runs as run
    join public.integration_authority_states as authority
      on authority.organization_id = run.organization_id
      and authority.provider = run.provider
      and authority.source_account_id = run.source_account_id
      and authority.entity_type = target_entity_type
      and authority.state in (
        'importing', 'accelo_authoritative', 'final_delta'
      )
    where run.id = promotion_run_id
      and run.organization_id = target_organization_id
      and run.status = 'running'
      and run.lease_expires_at > statement_timestamp()
      and target_entity_type = any(run.requested_entities)
  ) then
    return coalesce(new, old);
  end if;

  if exists (
    select 1
    from public.integration_authority_states as authority
    join public.source_records as mapping
      on mapping.organization_id = authority.organization_id
      and mapping.provider = authority.provider
      and mapping.source_account_id = authority.source_account_id
      and mapping.source_entity_type = authority.entity_type
      and mapping.destination_schema = 'public'
      and mapping.destination_table = tg_table_name
      and mapping.destination_record_id = row_data ->> 'id'
      and not mapping.source_deleted
    where authority.organization_id = target_organization_id
      and authority.provider = 'accelo'
      and authority.entity_type = target_entity_type
      and authority.state in (
        'importing', 'accelo_authoritative', 'final_delta'
      )
  ) then
    raise object_not_in_prerequisite_state using
      message = format(
        'Native %s writes are blocked while Accelo is authoritative.',
        target_entity_type
      );
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function private.journal_accelo_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id uuid := nullif(
    current_setting('app.accelo_promotion_run_id', true),
    ''
  )::uuid;
  row_data jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  target_organization_id uuid;
  source_record text;
  journal_entity_type text := tg_argv[0];
begin
  if run_id is null or nullif(
    current_setting('app.accelo_rollback_run_id', true),
    ''
  ) is not null then
    return coalesce(new, old);
  end if;
  target_organization_id :=
    private.accelo_row_organization(tg_table_name, row_data);
  select stage.source_record_id, stage.entity_type
    into source_record, journal_entity_type
  from public.accelo_pull_stage as stage
  where stage.id = nullif(
    current_setting('app.accelo_promotion_stage_id', true),
    ''
  )::uuid;

  insert into public.accelo_promotion_journal (
    organization_id,
    run_id,
    entity_type,
    source_record_id,
    destination_table,
    destination_record_id,
    operation,
    before_image,
    after_image
  )
  values (
    target_organization_id,
    run_id,
    journal_entity_type,
    source_record,
    tg_table_name,
    (row_data ->> 'id')::uuid,
    lower(tg_op),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select *
    from (values
      ('clients', 'companies'),
      ('contacts', 'contacts'),
      ('profiles', 'staff'),
      ('client_contacts', 'affiliations'),
      ('projects', 'jobs'),
      ('retainers', 'contracts'),
      ('client_activities', 'activities'),
      ('time_entries', 'activities'),
      ('invoices', 'invoices'),
      ('payments', 'payments'),
      ('prospects', 'prospects'),
      ('milestones', 'milestones'),
      ('todos', 'tasks')
    ) as targets(table_name, entity_type)
  loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I
       for each row execute function private.guard_accelo_native_write(%L)',
      'guard_accelo_authority_' || target.table_name,
      target.table_name,
      target.entity_type
    );
    execute format(
      'create trigger %I after insert or update or delete on public.%I
       for each row execute function private.journal_accelo_promotion(%L)',
      'journal_accelo_promotion_' || target.table_name,
      target.table_name,
      target.entity_type
    );
  end loop;
end;
$$;

create or replace function private.set_integration_authority_state(
  target_organization_id uuid,
  target_source_account_id text,
  target_entity_type text,
  expected_state text,
  target_state text,
  target_run_id uuid,
  target_note text,
  target_actor_id uuid
)
returns public.integration_authority_states
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.integration_authority_states%rowtype;
  evidence public.accelo_pull_runs%rowtype;
  evidence_payload jsonb := '{}'::jsonb;
begin
  if char_length(btrim(coalesce(target_note, ''))) not between 3 and 1000 then
    raise check_violation using message = 'Authority transitions require a reason.';
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = target_actor_id
      and profile.organization_id = target_organization_id
      and profile.role = 'admin'
      and profile.status = 'active'
  ) then
    raise insufficient_privilege using message = 'Active administrator required.';
  end if;

  insert into public.integration_authority_states (
    organization_id, source_account_id, entity_type
  )
  values (
    target_organization_id, btrim(target_source_account_id), target_entity_type
  )
  on conflict (
    organization_id, provider, source_account_id, entity_type
  ) do nothing;

  select authority.* into result
  from public.integration_authority_states as authority
  where authority.organization_id = target_organization_id
    and authority.provider = 'accelo'
    and authority.source_account_id = btrim(target_source_account_id)
    and authority.entity_type = target_entity_type
  for update;

  if result.state = target_state then
    return result;
  end if;
  if result.state is distinct from expected_state then
    raise serialization_failure using
      message = format(
        'Integration authority is %s, not expected state %s.',
        result.state,
        expected_state
      );
  end if;
  if not (
    (result.state = 'disabled' and target_state in ('shadow', 'audit_only'))
    or (
      result.state = 'shadow'
      and target_state in ('disabled', 'importing', 'audit_only')
    )
    or (
      result.state = 'importing'
      and target_state in ('shadow', 'accelo_authoritative', 'audit_only')
    )
    or (
      result.state = 'accelo_authoritative'
      and target_state in ('final_delta', 'audit_only')
    )
    or (
      result.state = 'final_delta'
      and target_state in (
        'accelo_authoritative', 'supabase_authoritative', 'audit_only'
      )
    )
    or (
      result.state = 'supabase_authoritative'
      and target_state = 'audit_only'
    )
    or (
      result.state = 'audit_only'
      and target_state in ('disabled', 'shadow')
    )
  ) then
    raise object_not_in_prerequisite_state using
      message = format(
        'Invalid integration authority transition from %s to %s.',
        result.state,
        target_state
      );
  end if;

  if target_state in (
    'accelo_authoritative', 'final_delta', 'supabase_authoritative'
  ) then
    select run.* into evidence
    from public.accelo_pull_runs as run
    where run.id = target_run_id
      and run.organization_id = target_organization_id
      and run.source_account_id = btrim(target_source_account_id)
      and run.status = 'succeeded'
      and target_entity_type = any(run.requested_entities)
      and run.finalized_at >= statement_timestamp() - interval '6 hours';

    if evidence.id is null
      or exists (
        select 1
        from public.accelo_pull_reconciliations as reconciliation
        where reconciliation.run_id = evidence.id
          and reconciliation.entity_type = target_entity_type
          and (
            reconciliation.status <> 'matched'
            or reconciliation.expected_count
              <> reconciliation.mapped_count
                + reconciliation.approved_exclusion_count
            or reconciliation.destination_missing_count <> 0
          )
      )
      or not exists (
        select 1
        from public.accelo_pull_reconciliations as reconciliation
        where reconciliation.run_id = evidence.id
          and reconciliation.entity_type = target_entity_type
          and reconciliation.status = 'matched'
      )
    then
      raise object_not_in_prerequisite_state using
        message = 'Authority transition evidence is missing, stale, or unreconciled.';
    end if;
    if exists (
      select 1
      from public.accelo_pull_runs as active
      where active.organization_id = target_organization_id
        and active.source_account_id = btrim(target_source_account_id)
        and active.status = 'running'
    ) then
      raise object_not_in_prerequisite_state using
        message = 'Authority cannot transition while an Accelo worker is active.';
    end if;
    evidence_payload := jsonb_build_object(
      'run_id', evidence.id,
      'finalized_at', evidence.finalized_at,
      'full_snapshot', evidence.full_snapshot
    );
  elsif target_run_id is not null then
    raise check_violation using
      message = 'Evidence runs are only accepted for gated transitions.';
  end if;

  update public.integration_authority_states as authority
  set
    state = target_state,
    transition_run_id = target_run_id,
    transition_note = btrim(target_note),
    transitioned_by = target_actor_id
  where authority.id = result.id
  returning authority.* into result;

  insert into public.accelo_authority_transition_events (
    organization_id,
    source_account_id,
    entity_type,
    previous_state,
    target_state,
    evidence_run_id,
    actor_id,
    reason,
    evidence
  )
  values (
    target_organization_id,
    btrim(target_source_account_id),
    target_entity_type,
    expected_state,
    target_state,
    target_run_id,
    target_actor_id,
    btrim(target_note),
    evidence_payload
  );
  return result;
end;
$$;

create or replace function private.configure_accelo_shadow(
  target_organization_id uuid,
  target_source_account_id text,
  target_entities text[],
  target_actor_id uuid,
  target_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  entity_name text;
  configured integer := 0;
  current_state text;
begin
  if cardinality(target_entities) not between 1 and 100 then
    raise check_violation using message = 'Accelo entity list is invalid.';
  end if;
  insert into public.integration_settings (
    organization_id,
    provider,
    enabled,
    settings,
    created_by,
    updated_by
  )
  values (
    target_organization_id,
    'accelo',
    true,
    jsonb_build_object(
      'source_account_id', btrim(target_source_account_id),
      'mode', 'read-only',
      'inventory_interval_hours', 168
    ),
    target_actor_id,
    target_actor_id
  )
  on conflict (organization_id, provider) do update
  set
    enabled = true,
    settings = public.integration_settings.settings || excluded.settings,
    updated_by = excluded.updated_by;

  foreach entity_name in array target_entities
  loop
    select authority.state into current_state
    from public.integration_authority_states as authority
    where authority.organization_id = target_organization_id
      and authority.provider = 'accelo'
      and authority.source_account_id = btrim(target_source_account_id)
      and authority.entity_type = entity_name;
    if current_state is null or current_state = 'disabled' then
      perform private.set_integration_authority_state(
        target_organization_id,
        target_source_account_id,
        entity_name,
        'disabled',
        'shadow',
        null,
        target_reason,
        target_actor_id
      );
      configured := configured + 1;
    elsif current_state <> 'shadow' then
      raise object_not_in_prerequisite_state using
        message = format(
          'Cannot enable shadow while %s is in %s.',
          entity_name,
          current_state
        );
    end if;
  end loop;
  return configured;
end;
$$;

create or replace function public.configure_accelo_shadow(
  target_organization_id uuid,
  target_source_account_id text,
  target_entities text[],
  target_actor_id uuid,
  target_reason text
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.configure_accelo_shadow(
    target_organization_id,
    target_source_account_id,
    target_entities,
    target_actor_id,
    target_reason
  );
$$;

revoke all on function public.configure_accelo_shadow(
  uuid, text, text[], uuid, text
) from public, anon, authenticated;
grant execute on function public.configure_accelo_shadow(
  uuid, text, text[], uuid, text
) to service_role;

create or replace function private.rollback_accelo_promotion_run(
  target_run_id uuid,
  target_actor_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_run public.accelo_pull_runs%rowtype;
  attempt_id uuid;
  journal public.accelo_promotion_journal%rowtype;
  current_image jsonb;
  column_list text;
  restored_list text;
  restored bigint := 0;
  rollback_conflicts jsonb := '[]'::jsonb;
begin
  select run.* into source_run
  from public.accelo_pull_runs as run
  where run.id = target_run_id
    and run.status in ('succeeded', 'partial', 'failed')
  for update;
  if source_run.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Only a finalized Accelo promotion run can be rolled back.';
  end if;
  if char_length(btrim(coalesce(target_reason, ''))) not between 3 and 1000
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = target_actor_id
        and profile.organization_id = source_run.organization_id
        and profile.role = 'admin'
        and profile.status = 'active'
    )
  then
    raise insufficient_privilege using
      message = 'Rollback requires an active administrator and reason.';
  end if;
  if exists (
    select 1
    from public.accelo_pull_runs as active
    where active.organization_id = source_run.organization_id
      and active.status = 'running'
  ) then
    raise object_not_in_prerequisite_state using
      message = 'Rollback cannot run while an Accelo worker is active.';
  end if;

  insert into public.accelo_rollback_attempts (
    organization_id, run_id, actor_id, reason, status
  )
  values (
    source_run.organization_id,
    source_run.id,
    target_actor_id,
    btrim(target_reason),
    'running'
  )
  returning id into attempt_id;
  perform set_config('app.accelo_rollback_run_id', source_run.id::text, true);

  for journal in
    select entry.*
    from public.accelo_promotion_journal as entry
    where entry.run_id = source_run.id
    order by entry.sequence_id desc
  loop
    execute format(
      'select to_jsonb(row) from public.%I as row where row.id = $1',
      journal.destination_table
    )
    into current_image
    using journal.destination_record_id;

    if current_image is distinct from journal.after_image then
      rollback_conflicts :=
        rollback_conflicts || jsonb_build_array(jsonb_build_object(
        'journal_sequence', journal.sequence_id,
        'destination_table', journal.destination_table,
        'destination_record_id', journal.destination_record_id,
        'reason', 'destination_changed_after_promotion'
      ));
      continue;
    end if;

    if journal.operation = 'insert' then
      execute format(
        'delete from public.%I where id = $1',
        journal.destination_table
      )
      using journal.destination_record_id;
    elsif journal.operation = 'update' then
      select
        string_agg(quote_ident(attribute.attname), ', ' order by attribute.attnum),
        string_agg(
          'restored.' || quote_ident(attribute.attname),
          ', ' order by attribute.attnum
        )
        into column_list, restored_list
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid =
          format('public.%I', journal.destination_table)::regclass
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attname <> 'id'
        and attribute.attgenerated = ''
        and attribute.attidentity = '';
      execute format(
        'update public.%I as destination
         set (%s) = (
           select %s
           from jsonb_populate_record(
             null::public.%I,
             $1
           ) as restored
         )
         where destination.id = $2',
        journal.destination_table,
        column_list,
        restored_list,
        journal.destination_table
      )
      using journal.before_image, journal.destination_record_id;
    else
      rollback_conflicts :=
        rollback_conflicts || jsonb_build_array(jsonb_build_object(
        'journal_sequence', journal.sequence_id,
        'reason', 'delete_restore_requires_manual_review'
      ));
      continue;
    end if;
    restored := restored + 1;
  end loop;

  update public.accelo_rollback_attempts as attempt
  set
    status = case
      when jsonb_array_length(rollback_conflicts) = 0 then 'succeeded'
      else 'conflicted'
    end,
    restored_count = restored,
    conflict_count = jsonb_array_length(rollback_conflicts),
    conflicts = rollback_conflicts,
    completed_at = statement_timestamp()
  where attempt.id = attempt_id;

  return jsonb_build_object(
    'attempt_id', attempt_id,
    'restored', restored,
    'conflicts', jsonb_array_length(rollback_conflicts),
    'status', case
      when jsonb_array_length(rollback_conflicts) = 0 then 'succeeded'
      else 'conflicted'
    end
  );
end;
$$;

create or replace function public.rollback_accelo_promotion_run(
  target_run_id uuid,
  target_actor_id uuid,
  target_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.rollback_accelo_promotion_run(
    target_run_id,
    target_actor_id,
    target_reason
  );
$$;

revoke all on function public.rollback_accelo_promotion_run(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.rollback_accelo_promotion_run(uuid, uuid, text)
  to service_role;

revoke all on function private.guard_accelo_native_write()
  from public, anon, authenticated;
revoke all on function private.journal_accelo_promotion()
  from public, anon, authenticated;
revoke all on function private.guard_accelo_append_only_audit()
  from public, anon, authenticated;

create or replace function private.guard_accelo_source_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_updated_at < old.source_updated_at
    or (
      old.source_updated_at is not null
      and new.source_updated_at is null
    )
    or (
      new.source_updated_at = old.source_updated_at
      and coalesce((new.metadata ->> 'transformer_version')::integer, 1)
        < coalesce((old.metadata ->> 'transformer_version')::integer, 1)
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'Stale Accelo source versions cannot replace newer mappings.';
  end if;
  return new;
end;
$$;

create trigger guard_accelo_source_version
  before update on public.source_records
  for each row execute function private.guard_accelo_source_version();

revoke all on function private.guard_accelo_source_version()
  from public, anon, authenticated;
