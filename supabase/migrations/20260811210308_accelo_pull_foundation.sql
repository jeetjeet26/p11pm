-- Pull-only Accelo ingestion foundation. Source snapshots are append-only;
-- destination identity is provider-qualified and authority changes are explicit.

-- Preserve legacy sync history while making every future legacy run pull-only.
alter table public.accelo_sync_runs
  alter column direction set default 'pull';

alter table public.accelo_sync_runs
  add constraint accelo_sync_runs_future_pull_only
  check (direction = 'pull') not valid;

revoke insert, update, delete on
  public.accelo_sync_runs,
  public.sync_conflicts
from authenticated;

grant select on
  public.accelo_sync_runs,
  public.sync_conflicts
to authenticated;

comment on table public.accelo_sync_runs is
  'Legacy Accelo run history. New rows are pull-only; historical push and bidirectional rows are retained.';
comment on table public.sync_conflicts is
  'Legacy bidirectional conflict history retained for audit; the pull foundation uses quarantine and reconciliation.';

create table public.accelo_pull_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider text not null default 'accelo'
    check (provider = 'accelo'),
  source_account_id text not null
    check (char_length(btrim(source_account_id)) between 1 and 200),
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  direction text generated always as ('pull'::text) stored,
  status text not null default 'queued'
    check (
      status in (
        'queued', 'running', 'finalizing', 'succeeded', 'partial',
        'failed', 'cancelled'
      )
    ),
  full_snapshot boolean not null default false,
  requested_entities text[] not null,
  manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manifest) = 'object'),
  start_cursor jsonb
    check (start_cursor is null or jsonb_typeof(start_cursor) = 'object'),
  end_cursor jsonb
    check (end_cursor is null or jsonb_typeof(end_cursor) = 'object'),
  lease_token uuid,
  lease_owner text
    check (
      lease_owner is null
      or char_length(btrim(lease_owner)) between 1 and 200
    ),
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  records_scanned bigint not null default 0 check (records_scanned >= 0),
  records_staged bigint not null default 0 check (records_staged >= 0),
  records_quarantined bigint not null default 0
    check (records_quarantined >= 0),
  records_mapped bigint not null default 0 check (records_mapped >= 0),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  error_message text,
  started_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, provider, source_account_id, id),
  unique (
    organization_id,
    provider,
    source_account_id,
    idempotency_key
  ),
  constraint accelo_pull_runs_entities_valid check (
    cardinality(requested_entities) between 1 and 100
    and array_position(requested_entities, null) is null
  ),
  constraint accelo_pull_runs_lease_valid check (
    (
      lease_token is null
      and lease_owner is null
      and lease_acquired_at is null
      and lease_expires_at is null
      and heartbeat_at is null
    )
    or (
      lease_token is not null
      and lease_owner is not null
      and lease_acquired_at is not null
      and lease_expires_at is not null
      and heartbeat_at is not null
      and lease_expires_at > lease_acquired_at
    )
  ),
  constraint accelo_pull_runs_running_lease_required check (
    status <> 'running'
    or (
      lease_token is not null
      and lease_expires_at is not null
    )
  ),
  constraint accelo_pull_runs_completion_valid check (
    (
      status in ('succeeded', 'partial', 'failed', 'cancelled')
      and finalized_at is not null
    )
    or (
      status not in ('succeeded', 'partial', 'failed', 'cancelled')
      and finalized_at is null
    )
  )
);

create index accelo_pull_runs_organization_created_idx
  on public.accelo_pull_runs (organization_id, created_at desc, id);
create index accelo_pull_runs_active_lease_idx
  on public.accelo_pull_runs (lease_expires_at, organization_id)
  where status = 'running';
create index accelo_pull_runs_account_status_idx
  on public.accelo_pull_runs (
    organization_id,
    source_account_id,
    status,
    created_at desc
  );

create table public.accelo_pull_stage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  entity_type text not null
    check (entity_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  source_record_id text not null
    check (char_length(btrim(source_record_id)) between 1 and 500),
  source_updated_at timestamptz,
  source_deleted boolean not null default false,
  raw_payload jsonb not null
    check (jsonb_typeof(raw_payload) = 'object'),
  normalized_payload jsonb
    check (
      normalized_payload is null
      or jsonb_typeof(normalized_payload) = 'object'
    ),
  payload_sha256 text generated always as (
    encode(extensions.digest(raw_payload::text, 'sha256'), 'hex')
  ) stored,
  staged_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, run_id, id),
  unique (run_id, entity_type, source_record_id, payload_sha256),
  foreign key (organization_id, run_id)
    references public.accelo_pull_runs(organization_id, id) on delete restrict
);

create index accelo_pull_stage_run_entity_idx
  on public.accelo_pull_stage (
    run_id,
    entity_type,
    source_record_id,
    staged_at
  );
create index accelo_pull_stage_source_updated_idx
  on public.accelo_pull_stage (
    organization_id,
    entity_type,
    source_updated_at,
    source_record_id
  )
  where source_updated_at is not null;

create table public.accelo_pull_checkpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  entity_type text not null
    check (entity_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  checkpoint_key text not null
    check (char_length(btrim(checkpoint_key)) between 1 and 500),
  page_number integer check (page_number is null or page_number >= 0),
  cursor jsonb not null default '{}'::jsonb
    check (jsonb_typeof(cursor) = 'object'),
  high_watermark timestamptz,
  record_count integer not null check (record_count >= 0),
  content_sha256 text not null
    check (content_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (run_id, entity_type, checkpoint_key),
  foreign key (organization_id, run_id)
    references public.accelo_pull_runs(organization_id, id) on delete restrict
);

create index accelo_pull_checkpoints_run_entity_idx
  on public.accelo_pull_checkpoints (
    run_id,
    entity_type,
    completed_at desc
  );

create table public.accelo_pull_quarantine (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  stage_record_id uuid,
  entity_type text not null
    check (entity_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  source_record_id text not null
    check (char_length(btrim(source_record_id)) between 1 and 500),
  reason_code text not null
    check (reason_code ~ '^[a-z][a-z0-9_]{0,99}$'),
  reason_detail text,
  raw_payload jsonb not null
    check (jsonb_typeof(raw_payload) = 'object'),
  payload_sha256 text generated always as (
    encode(extensions.digest(raw_payload::text, 'sha256'), 'hex')
  ) stored,
  quarantined_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (
    run_id,
    entity_type,
    source_record_id,
    reason_code,
    payload_sha256
  ),
  foreign key (organization_id, run_id)
    references public.accelo_pull_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, run_id, stage_record_id)
    references public.accelo_pull_stage(organization_id, run_id, id)
    on delete restrict
);

create index accelo_pull_quarantine_run_reason_idx
  on public.accelo_pull_quarantine (
    run_id,
    entity_type,
    reason_code,
    quarantined_at
  );

create table public.accelo_pull_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  entity_type text not null
    check (entity_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  expected_count bigint check (expected_count is null or expected_count >= 0),
  staged_count bigint not null default 0 check (staged_count >= 0),
  quarantined_count bigint not null default 0
    check (quarantined_count >= 0),
  mapped_count bigint not null default 0 check (mapped_count >= 0),
  inserted_count bigint not null default 0 check (inserted_count >= 0),
  updated_count bigint not null default 0 check (updated_count >= 0),
  unchanged_count bigint not null default 0 check (unchanged_count >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'matched', 'mismatch', 'skipped')),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (run_id, entity_type),
  foreign key (organization_id, run_id)
    references public.accelo_pull_runs(organization_id, id) on delete restrict,
  constraint accelo_pull_reconciliation_status_valid check (
    (status = 'pending' and reconciled_at is null)
    or (status <> 'pending' and reconciled_at is not null)
  )
);

create index accelo_pull_reconciliation_status_idx
  on public.accelo_pull_reconciliations (
    organization_id,
    status,
    updated_at desc
  )
  where status in ('pending', 'mismatch');

-- Generic provider-qualified identity map. Destination keys are text so tables
-- with UUID, integer, text, or composite canonical keys can all participate.
create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider text not null
    check (provider ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  source_account_id text not null
    check (char_length(btrim(source_account_id)) between 1 and 200),
  source_entity_type text not null
    check (source_entity_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  source_record_id text not null
    check (char_length(btrim(source_record_id)) between 1 and 500),
  destination_schema text not null default 'public'
    check (destination_schema ~ '^[a-z_][a-z0-9_]{0,62}$'),
  destination_table text not null
    check (destination_table ~ '^[a-z_][a-z0-9_]{0,62}$'),
  destination_record_id text not null
    check (char_length(btrim(destination_record_id)) between 1 and 500),
  first_seen_run_id uuid,
  last_seen_run_id uuid,
  source_updated_at timestamptz,
  payload_sha256 text
    check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  source_deleted boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  unique (organization_id, id),
  unique (
    organization_id,
    provider,
    source_account_id,
    source_entity_type,
    source_record_id
  ),
  unique (
    organization_id,
    provider,
    source_account_id,
    destination_schema,
    destination_table,
    destination_record_id
  ),
  foreign key (
    organization_id,
    provider,
    source_account_id,
    first_seen_run_id
  ) references public.accelo_pull_runs(
    organization_id,
    provider,
    source_account_id,
    id
  ) on delete restrict,
  foreign key (
    organization_id,
    provider,
    source_account_id,
    last_seen_run_id
  ) references public.accelo_pull_runs(
    organization_id,
    provider,
    source_account_id,
    id
  ) on delete restrict,
  constraint source_records_provider_run_valid check (
    provider = 'accelo'
    or (first_seen_run_id is null and last_seen_run_id is null)
  ),
  constraint source_records_retirement_valid check (
    retired_at is null or source_deleted
  )
);

create index source_records_destination_idx
  on public.source_records (
    organization_id,
    destination_schema,
    destination_table,
    destination_record_id
  );
create index source_records_source_updated_idx
  on public.source_records (
    organization_id,
    provider,
    source_account_id,
    source_entity_type,
    source_updated_at,
    source_record_id
  );
create index source_records_active_source_idx
  on public.source_records (
    organization_id,
    provider,
    source_account_id,
    source_entity_type,
    source_record_id
  )
  where retired_at is null;

create or replace function private.guard_source_record_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise object_not_in_prerequisite_state using
      message = 'Source identity mappings cannot be deleted.';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id,
    new.provider,
    new.source_account_id,
    new.source_entity_type,
    new.source_record_id,
    new.destination_schema,
    new.destination_table,
    new.destination_record_id,
    new.first_seen_run_id,
    new.first_seen_at
  ) is distinct from (
    old.organization_id,
    old.provider,
    old.source_account_id,
    old.source_entity_type,
    old.source_record_id,
    old.destination_schema,
    old.destination_table,
    old.destination_record_id,
    old.first_seen_run_id,
    old.first_seen_at
  ) then
    raise check_violation using
      message = 'Source and destination identity are immutable.';
  end if;
  return new;
end;
$$;

create trigger guard_source_record_identity
  before update or delete on public.source_records
  for each row execute function private.guard_source_record_identity();

create table public.integration_authority_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider text not null default 'accelo'
    check (provider = 'accelo'),
  source_account_id text not null
    check (char_length(btrim(source_account_id)) between 1 and 200),
  entity_type text not null
    check (entity_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  state text not null default 'disabled'
    check (
      state in (
        'disabled',
        'shadow',
        'importing',
        'accelo_authoritative',
        'final_delta',
        'supabase_authoritative',
        'audit_only'
      )
    ),
  previous_state text
    check (
      previous_state is null
      or previous_state in (
        'disabled',
        'shadow',
        'importing',
        'accelo_authoritative',
        'final_delta',
        'supabase_authoritative',
        'audit_only'
      )
    ),
  transition_run_id uuid,
  transition_note text,
  transitioned_by uuid,
  transitioned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (
    organization_id,
    provider,
    source_account_id,
    entity_type
  ),
  foreign key (
    organization_id,
    provider,
    source_account_id,
    transition_run_id
  ) references public.accelo_pull_runs(
    organization_id,
    provider,
    source_account_id,
    id
  ) on delete restrict,
  foreign key (organization_id, transitioned_by)
    references public.profiles(organization_id, id)
    on delete set null (transitioned_by)
);

create index integration_authority_states_state_idx
  on public.integration_authority_states (
    organization_id,
    provider,
    state,
    entity_type
  );

create or replace function private.guard_accelo_pull_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if (
    new.organization_id,
    new.provider,
    new.source_account_id,
    new.idempotency_key,
    new.full_snapshot,
    new.requested_entities,
    new.created_at
  ) is distinct from (
    old.organization_id,
    old.provider,
    old.source_account_id,
    old.idempotency_key,
    old.full_snapshot,
    old.requested_entities,
    old.created_at
  ) then
    raise check_violation using
      message = 'Accelo pull run identity and semantics are immutable.';
  end if;

  if new.status <> old.status and not (
    (old.status = 'queued' and new.status in ('running', 'failed', 'cancelled'))
    or (
      old.status = 'running'
      and new.status in (
        'finalizing', 'succeeded', 'partial', 'failed', 'cancelled'
      )
    )
    or (
      old.status = 'finalizing'
      and new.status in ('succeeded', 'partial', 'failed')
    )
  ) then
    raise object_not_in_prerequisite_state using
      message = 'Invalid Accelo pull run status transition.';
  end if;

  if old.status in ('succeeded', 'partial', 'failed', 'cancelled') then
    raise object_not_in_prerequisite_state using
      message = 'Finalized Accelo pull runs are immutable.';
  end if;

  return new;
end;
$$;

create trigger guard_accelo_pull_run
  before insert or update on public.accelo_pull_runs
  for each row execute function private.guard_accelo_pull_run();

create trigger set_accelo_pull_runs_updated_at
  before update on public.accelo_pull_runs
  for each row execute function private.set_updated_at();

create trigger set_accelo_pull_reconciliations_updated_at
  before update on public.accelo_pull_reconciliations
  for each row execute function private.set_updated_at();

create or replace function private.guard_accelo_pull_append()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_run_id uuid;
  changed_organization_id uuid;
begin
  if tg_op <> 'INSERT' then
    raise object_not_in_prerequisite_state using
      message = 'Accelo raw, stage, checkpoint, and quarantine rows are append-only.';
  end if;

  changed_run_id := new.run_id;
  changed_organization_id := new.organization_id;

  perform 1
  from public.accelo_pull_runs as run
  where run.id = changed_run_id
    and run.organization_id = changed_organization_id
    and run.status = 'running'
    and run.lease_expires_at > statement_timestamp()
  for key share;

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'Accelo stage writes require a running, actively leased pull.';
  end if;

  return new;
end;
$$;

create trigger guard_accelo_pull_stage_append
  before insert or update or delete on public.accelo_pull_stage
  for each row execute function private.guard_accelo_pull_append();
create trigger guard_accelo_pull_checkpoint_append
  before insert or update or delete on public.accelo_pull_checkpoints
  for each row execute function private.guard_accelo_pull_append();
create trigger guard_accelo_pull_quarantine_append
  before insert or update or delete on public.accelo_pull_quarantine
  for each row execute function private.guard_accelo_pull_append();

create or replace function private.guard_integration_authority_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'disabled' or new.previous_state is not null then
      raise object_not_in_prerequisite_state using
        message = 'Integration authority must begin disabled.';
    end if;
    return new;
  end if;

  if (
    new.organization_id,
    new.provider,
    new.source_account_id,
    new.entity_type,
    new.created_at
  ) is distinct from (
    old.organization_id,
    old.provider,
    old.source_account_id,
    old.entity_type,
    old.created_at
  ) then
    raise check_violation using
      message = 'Integration authority identity is immutable.';
  end if;

  if new.state = old.state then
    new.previous_state := old.previous_state;
    new.transitioned_at := old.transitioned_at;
    return new;
  end if;

  if not (
    (old.state = 'disabled' and new.state in ('shadow', 'audit_only'))
    or (
      old.state = 'shadow'
      and new.state in ('disabled', 'importing', 'audit_only')
    )
    or (
      old.state = 'importing'
      and new.state in ('shadow', 'accelo_authoritative', 'audit_only')
    )
    or (
      old.state = 'accelo_authoritative'
      and new.state in ('final_delta', 'audit_only')
    )
    or (
      old.state = 'final_delta'
      and new.state in (
        'accelo_authoritative', 'supabase_authoritative', 'audit_only'
      )
    )
    or (
      old.state = 'supabase_authoritative'
      and new.state = 'audit_only'
    )
    or (
      old.state = 'audit_only'
      and new.state in ('disabled', 'shadow')
    )
  ) then
    raise object_not_in_prerequisite_state using
      message = format(
        'Invalid integration authority transition from %s to %s.',
        old.state,
        new.state
      );
  end if;

  new.previous_state := old.state;
  new.transitioned_at := statement_timestamp();
  return new;
end;
$$;

create trigger guard_integration_authority_transition
  before insert or update on public.integration_authority_states
  for each row execute function private.guard_integration_authority_transition();

create trigger set_integration_authority_states_updated_at
  before update on public.integration_authority_states
  for each row execute function private.set_updated_at();

-- Private mutation helpers are idempotent and exposed only through
-- security-invoker service-role wrappers.
create or replace function private.start_accelo_pull_run(
  target_organization_id uuid,
  target_source_account_id text,
  target_idempotency_key text,
  target_requested_entities text[],
  target_full_snapshot boolean,
  target_manifest jsonb,
  target_start_cursor jsonb,
  target_lease_owner text,
  target_lease_seconds integer
)
returns public.accelo_pull_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.accelo_pull_runs%rowtype;
  new_lease_token uuid := gen_random_uuid();
begin
  if target_lease_seconds not between 30 and 3600
    or char_length(btrim(target_lease_owner)) not between 1 and 200
    or jsonb_typeof(coalesce(target_manifest, '{}'::jsonb)) <> 'object'
    or (
      target_start_cursor is not null
      and jsonb_typeof(target_start_cursor) <> 'object'
    )
  then
    raise check_violation using message = 'Invalid Accelo pull run request.';
  end if;

  insert into public.accelo_pull_runs (
    organization_id,
    source_account_id,
    idempotency_key,
    status,
    full_snapshot,
    requested_entities,
    manifest,
    start_cursor,
    lease_token,
    lease_owner,
    lease_acquired_at,
    lease_expires_at,
    heartbeat_at,
    started_at
  )
  values (
    target_organization_id,
    btrim(target_source_account_id),
    btrim(target_idempotency_key),
    'running',
    target_full_snapshot,
    target_requested_entities,
    coalesce(target_manifest, '{}'::jsonb),
    target_start_cursor,
    new_lease_token,
    btrim(target_lease_owner),
    statement_timestamp(),
    statement_timestamp() + make_interval(secs => target_lease_seconds),
    statement_timestamp(),
    statement_timestamp()
  )
  on conflict (
    organization_id,
    provider,
    source_account_id,
    idempotency_key
  ) do nothing
  returning * into result;

  if result.id is null then
    select run.* into result
    from public.accelo_pull_runs as run
    where run.organization_id = target_organization_id
      and run.provider = 'accelo'
      and run.source_account_id = btrim(target_source_account_id)
      and run.idempotency_key = btrim(target_idempotency_key);
  end if;

  return result;
end;
$$;

create or replace function public.start_accelo_pull_run(
  target_organization_id uuid,
  target_source_account_id text,
  target_idempotency_key text,
  target_requested_entities text[],
  target_full_snapshot boolean default false,
  target_manifest jsonb default '{}'::jsonb,
  target_start_cursor jsonb default null,
  target_lease_owner text default 'accelo-pull-worker',
  target_lease_seconds integer default 300
)
returns public.accelo_pull_runs
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.start_accelo_pull_run(
    target_organization_id,
    target_source_account_id,
    target_idempotency_key,
    target_requested_entities,
    target_full_snapshot,
    target_manifest,
    target_start_cursor,
    target_lease_owner,
    target_lease_seconds
  );
$$;

create or replace function private.heartbeat_accelo_pull_run(
  target_run_id uuid,
  target_lease_token uuid,
  target_lease_seconds integer
)
returns public.accelo_pull_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.accelo_pull_runs%rowtype;
begin
  if target_lease_seconds not between 30 and 3600 then
    raise check_violation using message = 'Invalid Accelo lease duration.';
  end if;

  update public.accelo_pull_runs as run
  set
    heartbeat_at = statement_timestamp(),
    lease_expires_at =
      statement_timestamp() + make_interval(secs => target_lease_seconds)
  where run.id = target_run_id
    and run.status = 'running'
    and run.lease_token = target_lease_token
    and run.lease_expires_at > statement_timestamp()
  returning run.* into result;

  if result.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo pull lease is missing, expired, or owned elsewhere.';
  end if;
  return result;
end;
$$;

create or replace function public.heartbeat_accelo_pull_run(
  target_run_id uuid,
  target_lease_token uuid,
  target_lease_seconds integer default 300
)
returns public.accelo_pull_runs
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.heartbeat_accelo_pull_run(
    target_run_id,
    target_lease_token,
    target_lease_seconds
  );
$$;

create or replace function private.stage_accelo_pull_record(
  target_run_id uuid,
  target_lease_token uuid,
  target_entity_type text,
  target_source_record_id text,
  target_raw_payload jsonb,
  target_normalized_payload jsonb,
  target_source_updated_at timestamptz,
  target_source_deleted boolean
)
returns public.accelo_pull_stage
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_hash text;
  result public.accelo_pull_stage%rowtype;
begin
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

  if jsonb_typeof(target_raw_payload) <> 'object'
    or (
      target_normalized_payload is not null
      and jsonb_typeof(target_normalized_payload) <> 'object'
    )
  then
    raise check_violation using message = 'Accelo stage payloads must be objects.';
  end if;

  target_hash := encode(
    extensions.digest(target_raw_payload::text, 'sha256'),
    'hex'
  );

  select stage.* into result
  from public.accelo_pull_stage as stage
  where stage.run_id = target_run_id
    and stage.entity_type = target_entity_type
    and stage.source_record_id = target_source_record_id
    and stage.payload_sha256 = target_hash;

  if result.id is not null then
    if result.normalized_payload is distinct from target_normalized_payload
      or result.source_updated_at is distinct from target_source_updated_at
      or result.source_deleted is distinct from target_source_deleted
    then
      raise unique_violation using
        message = 'Idempotent Accelo stage retry changed record metadata.';
    end if;
    return result;
  end if;

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
  values (
    target_organization_id,
    target_run_id,
    target_entity_type,
    target_source_record_id,
    target_source_updated_at,
    target_source_deleted,
    target_raw_payload,
    target_normalized_payload
  )
  returning * into result;

  update public.accelo_pull_runs
  set
    records_scanned = records_scanned + 1,
    records_staged = records_staged + 1
  where id = target_run_id;

  return result;
end;
$$;

create or replace function public.stage_accelo_pull_record(
  target_run_id uuid,
  target_lease_token uuid,
  target_entity_type text,
  target_source_record_id text,
  target_raw_payload jsonb,
  target_normalized_payload jsonb default null,
  target_source_updated_at timestamptz default null,
  target_source_deleted boolean default false
)
returns public.accelo_pull_stage
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.stage_accelo_pull_record(
    target_run_id,
    target_lease_token,
    target_entity_type,
    target_source_record_id,
    target_raw_payload,
    target_normalized_payload,
    target_source_updated_at,
    target_source_deleted
  );
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
  result public.accelo_pull_checkpoints%rowtype;
begin
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

create or replace function public.record_accelo_pull_checkpoint(
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
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_accelo_pull_checkpoint(
    target_run_id,
    target_lease_token,
    target_entity_type,
    target_checkpoint_key,
    target_page_number,
    target_cursor,
    target_high_watermark,
    target_record_count,
    target_content_sha256
  );
$$;

create or replace function private.map_source_record(
  target_organization_id uuid,
  target_provider text,
  target_source_account_id text,
  target_source_entity_type text,
  target_source_record_id text,
  target_destination_schema text,
  target_destination_table text,
  target_destination_record_id text,
  target_run_id uuid,
  target_source_updated_at timestamptz,
  target_payload_sha256 text,
  target_source_deleted boolean,
  target_metadata jsonb
)
returns public.source_records
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.source_records%rowtype;
begin
  select mapping.* into result
  from public.source_records as mapping
  where mapping.organization_id = target_organization_id
    and mapping.provider = target_provider
    and mapping.source_account_id = target_source_account_id
    and mapping.source_entity_type = target_source_entity_type
    and mapping.source_record_id = target_source_record_id
  for update;

  if result.id is not null then
    if (
      result.destination_schema,
      result.destination_table,
      result.destination_record_id
    ) is distinct from (
      target_destination_schema,
      target_destination_table,
      target_destination_record_id
    ) then
      raise integrity_constraint_violation using
        message = 'A source identity cannot be remapped to another destination.';
    end if;

    update public.source_records as mapping
    set
      last_seen_run_id = coalesce(target_run_id, mapping.last_seen_run_id),
      source_updated_at = coalesce(
        target_source_updated_at,
        mapping.source_updated_at
      ),
      payload_sha256 = coalesce(
        target_payload_sha256,
        mapping.payload_sha256
      ),
      source_deleted = target_source_deleted,
      last_seen_at = statement_timestamp(),
      retired_at = case
        when target_source_deleted
          then coalesce(mapping.retired_at, statement_timestamp())
        else null
      end,
      metadata = mapping.metadata || coalesce(target_metadata, '{}'::jsonb)
    where mapping.id = result.id
    returning mapping.* into result;
    return result;
  end if;

  insert into public.source_records (
    organization_id,
    provider,
    source_account_id,
    source_entity_type,
    source_record_id,
    destination_schema,
    destination_table,
    destination_record_id,
    first_seen_run_id,
    last_seen_run_id,
    source_updated_at,
    payload_sha256,
    source_deleted,
    retired_at,
    metadata
  )
  values (
    target_organization_id,
    target_provider,
    target_source_account_id,
    target_source_entity_type,
    target_source_record_id,
    target_destination_schema,
    target_destination_table,
    target_destination_record_id,
    target_run_id,
    target_run_id,
    target_source_updated_at,
    target_payload_sha256,
    target_source_deleted,
    case when target_source_deleted then statement_timestamp() else null end,
    coalesce(target_metadata, '{}'::jsonb)
  )
  returning * into result;

  return result;
end;
$$;

create or replace function public.map_source_record(
  target_organization_id uuid,
  target_provider text,
  target_source_account_id text,
  target_source_entity_type text,
  target_source_record_id text,
  target_destination_schema text,
  target_destination_table text,
  target_destination_record_id text,
  target_run_id uuid default null,
  target_source_updated_at timestamptz default null,
  target_payload_sha256 text default null,
  target_source_deleted boolean default false,
  target_metadata jsonb default '{}'::jsonb
)
returns public.source_records
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.map_source_record(
    target_organization_id,
    target_provider,
    target_source_account_id,
    target_source_entity_type,
    target_source_record_id,
    target_destination_schema,
    target_destination_table,
    target_destination_record_id,
    target_run_id,
    target_source_updated_at,
    target_payload_sha256,
    target_source_deleted,
    target_metadata
  );
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
begin
  insert into public.integration_authority_states (
    organization_id,
    source_account_id,
    entity_type
  )
  values (
    target_organization_id,
    target_source_account_id,
    target_entity_type
  )
  on conflict (
    organization_id,
    provider,
    source_account_id,
    entity_type
  ) do nothing;

  select authority.* into result
  from public.integration_authority_states as authority
  where authority.organization_id = target_organization_id
    and authority.provider = 'accelo'
    and authority.source_account_id = target_source_account_id
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

  update public.integration_authority_states as authority
  set
    state = target_state,
    transition_run_id = target_run_id,
    transition_note = target_note,
    transitioned_by = target_actor_id
  where authority.id = result.id
  returning authority.* into result;

  return result;
end;
$$;

create or replace function public.set_integration_authority_state(
  target_organization_id uuid,
  target_source_account_id text,
  target_entity_type text,
  expected_state text,
  target_state text,
  target_run_id uuid default null,
  target_note text default null,
  target_actor_id uuid default null
)
returns public.integration_authority_states
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_integration_authority_state(
    target_organization_id,
    target_source_account_id,
    target_entity_type,
    expected_state,
    target_state,
    target_run_id,
    target_note,
    target_actor_id
  );
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
  staged_total bigint;
  quarantine_total bigint;
  mapped_total bigint;
  expected_total bigint;
  reconciliation_status text;
  final_status text := 'succeeded';
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
  if target_end_cursor is not null
    and jsonb_typeof(target_end_cursor) <> 'object'
  then
    raise check_violation using message = 'Accelo end cursor must be an object.';
  end if;

  foreach entity_name in array result.requested_entities
  loop
    select count(*)::bigint into staged_total
    from public.accelo_pull_stage as stage
    where stage.run_id = target_run_id
      and stage.entity_type = entity_name;

    select count(*)::bigint into quarantine_total
    from public.accelo_pull_quarantine as quarantine
    where quarantine.run_id = target_run_id
      and quarantine.entity_type = entity_name;

    select count(*)::bigint into mapped_total
    from public.source_records as mapping
    where mapping.last_seen_run_id = target_run_id
      and mapping.source_entity_type = entity_name;

    expected_total := nullif(result.manifest ->> entity_name, '')::bigint;
    reconciliation_status := case
      when expected_total is not null
        and expected_total <> staged_total
        then 'mismatch'
      when quarantine_total > 0 then 'mismatch'
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
      status,
      reconciled_at
    )
    values (
      result.organization_id,
      result.id,
      entity_name,
      expected_total,
      staged_total,
      quarantine_total,
      mapped_total,
      reconciliation_status,
      statement_timestamp()
    )
    on conflict (run_id, entity_type) do update
    set
      expected_count = excluded.expected_count,
      staged_count = excluded.staged_count,
      quarantined_count = excluded.quarantined_count,
      mapped_count = excluded.mapped_count,
      status = excluded.status,
      reconciled_at = excluded.reconciled_at;

    if reconciliation_status = 'mismatch' then
      final_status := 'partial';
    end if;
  end loop;

  select count(*)::bigint
  into staged_total
  from public.accelo_pull_stage
  where run_id = target_run_id;

  select count(*)::bigint into mapped_total
  from public.source_records
  where last_seen_run_id = target_run_id;

  update public.accelo_pull_runs as run
  set
    status = final_status,
    end_cursor = target_end_cursor,
    records_staged = staged_total,
    records_quarantined = (
      select count(*)::bigint
      from public.accelo_pull_quarantine
      where run_id = target_run_id
    ),
    records_mapped = mapped_total,
    summary = coalesce(target_summary, '{}'::jsonb),
    finalized_at = statement_timestamp()
  where run.id = target_run_id
  returning run.* into result;

  return result;
end;
$$;

create or replace function public.finalize_accelo_pull_run(
  target_run_id uuid,
  target_lease_token uuid,
  target_end_cursor jsonb default null,
  target_summary jsonb default '{}'::jsonb
)
returns public.accelo_pull_runs
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.finalize_accelo_pull_run(
    target_run_id,
    target_lease_token,
    target_end_cursor,
    target_summary
  );
$$;

-- New integration tables are readable only by same-organization managers and
-- admins. All table mutation remains service-role-only.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accelo_pull_runs',
    'accelo_pull_stage',
    'accelo_pull_checkpoints',
    'accelo_pull_quarantine',
    'accelo_pull_reconciliations',
    'source_records',
    'integration_authority_states'
  ]
  loop
    execute format(
      'alter table public.%I enable row level security',
      table_name
    );
    execute format(
      'revoke all on public.%I from public, anon, authenticated',
      table_name
    );
    execute format(
      'grant select on public.%I to authenticated',
      table_name
    );
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

revoke all on function private.guard_accelo_pull_run()
  from public, anon, authenticated;
revoke all on function private.guard_accelo_pull_append()
  from public, anon, authenticated;
revoke all on function private.guard_integration_authority_transition()
  from public, anon, authenticated;
revoke all on function private.guard_source_record_identity()
  from public, anon, authenticated;

revoke all on function private.start_accelo_pull_run(
  uuid, text, text, text[], boolean, jsonb, jsonb, text, integer
) from public, anon, authenticated;
revoke all on function private.heartbeat_accelo_pull_run(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function private.stage_accelo_pull_record(
  uuid, uuid, text, text, jsonb, jsonb, timestamptz, boolean
) from public, anon, authenticated;
revoke all on function private.record_accelo_pull_checkpoint(
  uuid, uuid, text, text, integer, jsonb, timestamptz, integer, text
) from public, anon, authenticated;
revoke all on function private.map_source_record(
  uuid, text, text, text, text, text, text, text, uuid,
  timestamptz, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function private.set_integration_authority_state(
  uuid, text, text, text, text, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function private.finalize_accelo_pull_run(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function private.start_accelo_pull_run(
  uuid, text, text, text[], boolean, jsonb, jsonb, text, integer
) to service_role;
grant execute on function private.heartbeat_accelo_pull_run(
  uuid, uuid, integer
) to service_role;
grant execute on function private.stage_accelo_pull_record(
  uuid, uuid, text, text, jsonb, jsonb, timestamptz, boolean
) to service_role;
grant execute on function private.record_accelo_pull_checkpoint(
  uuid, uuid, text, text, integer, jsonb, timestamptz, integer, text
) to service_role;
grant execute on function private.map_source_record(
  uuid, text, text, text, text, text, text, text, uuid,
  timestamptz, text, boolean, jsonb
) to service_role;
grant execute on function private.set_integration_authority_state(
  uuid, text, text, text, text, uuid, text, uuid
) to service_role;
grant execute on function private.finalize_accelo_pull_run(
  uuid, uuid, jsonb, jsonb
) to service_role;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.start_accelo_pull_run(uuid,text,text,text[],boolean,jsonb,jsonb,text,integer)',
    'public.heartbeat_accelo_pull_run(uuid,uuid,integer)',
    'public.stage_accelo_pull_record(uuid,uuid,text,text,jsonb,jsonb,timestamptz,boolean)',
    'public.record_accelo_pull_checkpoint(uuid,uuid,text,text,integer,jsonb,timestamptz,integer,text)',
    'public.map_source_record(uuid,text,text,text,text,text,text,text,uuid,timestamptz,text,boolean,jsonb)',
    'public.set_integration_authority_state(uuid,text,text,text,text,uuid,text,uuid)',
    'public.finalize_accelo_pull_run(uuid,uuid,jsonb,jsonb)'
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

-- Invoice subtotal and tax are line-ledger aggregates; total and balance remain
-- stored generated columns. Keep existing columns for API compatibility while
-- rejecting direct attempts to rewrite the derived aggregates.
create or replace function private.protect_invoice_derived_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.subtotal_cents := 0;
    new.tax_cents := 0;
    return new;
  end if;
  if (
    new.subtotal_cents,
    new.tax_cents
  ) is distinct from (
    old.subtotal_cents,
    old.tax_cents
  ) and pg_trigger_depth() < 2 then
    raise exception using
      errcode = '428C9',
      message = 'Invoice subtotal and tax are derived from invoice line items.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_invoice_derived_totals()
  from public, anon, authenticated;

create trigger protect_invoice_derived_totals
  before update of subtotal_cents, tax_cents on public.invoices
  for each row execute function private.protect_invoice_derived_totals();
create trigger initialize_invoice_derived_totals
  before insert on public.invoices
  for each row execute function private.protect_invoice_derived_totals();

create or replace function private.refresh_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice_id uuid;
  target_time_entry_id uuid := case when tg_op = 'DELETE'
    then old.time_entry_id else new.time_entry_id end;
begin
  for target_invoice_id in
    select distinct candidate.invoice_id
    from unnest(array[
      case when tg_op <> 'INSERT' then old.invoice_id end,
      case when tg_op <> 'DELETE' then new.invoice_id end
    ]) as candidate(invoice_id)
    where candidate.invoice_id is not null
  loop
    update public.invoices as invoice
    set
      subtotal_cents = totals.subtotal_cents,
      tax_cents = totals.tax_cents,
      updated_at = statement_timestamp()
    from (
      select
        coalesce(sum(line.amount_cents), 0)::bigint as subtotal_cents,
        coalesce(sum(line.tax_cents), 0)::bigint as tax_cents
      from public.invoice_line_items as line
      where line.invoice_id = target_invoice_id
    ) as totals
    where invoice.id = target_invoice_id;
  end loop;

  if target_time_entry_id is not null then
    update public.time_entries
    set
      status = case when tg_op = 'DELETE' then 'approved' else 'invoiced' end,
      invoiced_at = case
        when tg_op = 'DELETE' then null
        else statement_timestamp()
      end,
      updated_at = statement_timestamp()
    where id = target_time_entry_id;
  end if;
  return null;
end;
$$;

revoke all on function private.refresh_invoice_totals()
  from public, anon, authenticated;

comment on column public.invoices.subtotal_cents is
  'Derived from invoice_line_items.amount_cents by refresh_invoice_totals.';
comment on column public.invoices.tax_cents is
  'Derived from invoice_line_items.tax_cents by refresh_invoice_totals.';
comment on column public.invoices.total_cents is
  'Stored generated sum of derived subtotal_cents and tax_cents.';

-- Correct the compatibility RPC so its tax argument is persisted in the line
-- ledger and therefore survives the aggregate refresh trigger.
create or replace function private.create_detailed_invoice(
  target_client_id uuid,
  target_project_id uuid,
  target_invoice_number text,
  target_subject text,
  target_attention_to text,
  target_billing_address jsonb,
  target_issue_date date,
  target_due_date date,
  target_service_period_start date,
  target_service_period_end date,
  target_currency text,
  target_line_items jsonb,
  target_tax_cents bigint,
  target_notes text,
  target_payment_instructions text,
  target_payment_terms text
)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := (select private.current_organization_id());
  result public.invoices%rowtype;
  line_item jsonb;
  line_position integer := 0;
  line_quantity numeric(12,4);
  line_unit_cents bigint;
  line_type text;
  line_retainer_id uuid;
  line_retainer_period_id uuid;
begin
  if jsonb_typeof(target_line_items) <> 'array'
    or jsonb_array_length(target_line_items) not between 1 and 500
    or target_tax_cents < 0
    or target_due_date < target_issue_date
    or char_length(btrim(target_subject)) not between 1 and 240
    or target_currency !~ '^[A-Z]{3}$'
    or jsonb_typeof(coalesce(target_billing_address, '{}'::jsonb)) <> 'object'
    or (
      target_service_period_start is not null
      and target_service_period_end is not null
      and target_service_period_end < target_service_period_start
    )
  then
    raise check_violation using message = 'Invalid detailed invoice request.';
  end if;

  if not (select private.has_organization_role(
    target_organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;

  if not exists (
    select 1 from public.clients as client
    where client.id = target_client_id
      and client.organization_id = target_organization_id
  ) or (
    target_project_id is not null and not exists (
      select 1 from public.projects as project
      where project.id = target_project_id
        and project.organization_id = target_organization_id
        and project.client_id = target_client_id
    )
  ) then
    raise check_violation using message = 'Invoice client or project is invalid.';
  end if;

  insert into public.invoices (
    organization_id, client_id, project_id, invoice_number, subject,
    attention_to, billing_address, status, issue_date, due_date,
    service_period_start, service_period_end, currency, notes,
    payment_instructions, payment_terms, created_by
  )
  values (
    target_organization_id, target_client_id, target_project_id,
    btrim(target_invoice_number), btrim(target_subject),
    nullif(btrim(target_attention_to), ''),
    coalesce(target_billing_address, '{}'::jsonb), 'draft',
    target_issue_date, target_due_date, target_service_period_start,
    target_service_period_end, target_currency::char(3), target_notes,
    target_payment_instructions, target_payment_terms, (select auth.uid())
  )
  returning * into result;

  for line_item in
    select value
    from jsonb_array_elements(target_line_items)
    order by (value ->> 'item_type' = 'credit')
  loop
    line_quantity := (line_item ->> 'quantity')::numeric;
    line_unit_cents := (line_item ->> 'unit_amount_cents')::bigint;
    line_type := coalesce(nullif(line_item ->> 'item_type', ''), 'service');
    line_retainer_id := nullif(line_item ->> 'retainer_id', '')::uuid;
    line_retainer_period_id :=
      nullif(line_item ->> 'retainer_period_id', '')::uuid;

    if line_quantity <= 0
      or line_type not in ('service', 'material', 'fee', 'deposit', 'credit')
      or char_length(btrim(line_item ->> 'description')) not between 1 and 500
      or (line_type = 'credit' and line_unit_cents > 0)
      or (line_type <> 'credit' and line_unit_cents < 0)
      or (
        line_retainer_id is not null
        and not exists (
          select 1
          from public.retainers as retainer
          where retainer.id = line_retainer_id
            and retainer.organization_id = target_organization_id
            and retainer.client_id = target_client_id
        )
      )
      or (
        line_retainer_period_id is not null
        and not exists (
          select 1
          from public.retainer_periods as period
          where period.id = line_retainer_period_id
            and period.organization_id = target_organization_id
            and (
              line_retainer_id is null
              or period.retainer_id = line_retainer_id
            )
        )
      )
    then
      raise check_violation using message = 'Invalid detailed invoice line.';
    end if;

    insert into public.invoice_line_items (
      organization_id, invoice_id, project_id, retainer_id,
      retainer_period_id, item_type, description, details,
      service_period_start, service_period_end, quantity,
      unit_amount_cents, amount_cents, tax_cents, position
    )
    values (
      target_organization_id, result.id,
      nullif(line_item ->> 'project_id', '')::uuid,
      line_retainer_id, line_retainer_period_id, line_type,
      btrim(line_item ->> 'description'),
      nullif(btrim(line_item ->> 'details'), ''),
      nullif(line_item ->> 'service_period_start', '')::date,
      nullif(line_item ->> 'service_period_end', '')::date,
      line_quantity, line_unit_cents,
      round(line_quantity * line_unit_cents)::bigint,
      case when line_position = 0 then target_tax_cents else 0 end,
      line_position
    );
    line_position := line_position + 1;
  end loop;

  select invoice.* into result
  from public.invoices as invoice
  where invoice.id = result.id;

  if result.total_cents < 0 then
    raise check_violation using message = 'Invoice total cannot be negative.';
  end if;
  return result;
end;
$$;

revoke all on function private.create_detailed_invoice(
  uuid, uuid, text, text, text, jsonb, date, date, date, date,
  text, jsonb, bigint, text, text, text
) from public;
grant execute on function private.create_detailed_invoice(
  uuid, uuid, text, text, text, jsonb, date, date, date, date,
  text, jsonb, bigint, text, text, text
) to authenticated, service_role;
