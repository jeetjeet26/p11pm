-- Production controls: immutable audit, file security, operator tooling, exports,
-- security matrices, health hooks, and conflict-aware rollback extensions.

create table public.production_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action_category text not null
    check (action_category in (
      'privileged', 'finance', 'authority', 'export', 'share', 'operator'
    )),
  action_type text not null
    check (char_length(btrim(action_type)) between 3 and 64),
  entity_type text not null
    check (char_length(btrim(entity_type)) between 3 and 64),
  entity_id uuid,
  before_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(after_state) = 'object'),
  before_hash text not null
    check (before_hash ~ '^[a-f0-9]{64}$'),
  after_hash text not null
    check (after_hash ~ '^[a-f0-9]{64}$'),
  request_correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key)
);

create index production_audit_events_org_created_idx
  on public.production_audit_events (organization_id, created_at desc, id);
create index production_audit_events_category_idx
  on public.production_audit_events (
    organization_id, action_category, created_at desc
  );
create index production_audit_events_correlation_idx
  on public.production_audit_events (request_correlation_id, created_at desc);
create index production_audit_events_entity_idx
  on public.production_audit_events (
    organization_id, entity_type, entity_id, created_at desc
  );

create table public.file_scan_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'infected', 'quarantined', 'error')),
  scanner_name text not null default 'interface'
    check (char_length(btrim(scanner_name)) between 2 and 64),
  signature text,
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object'),
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (file_id)
);

create index file_scan_results_org_status_idx
  on public.file_scan_results (organization_id, scan_status, updated_at desc);

create table public.file_quarantine_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  action text not null check (action in ('quarantine', 'release', 'delete')),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index file_quarantine_actions_file_idx
  on public.file_quarantine_actions (file_id, created_at desc);

create table public.file_download_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  share_id uuid references public.file_shares(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  access_channel text not null default 'share'
    check (access_channel in ('share', 'member', 'guest', 'operator')),
  ip_hash text,
  user_agent_hash text,
  request_correlation_id uuid not null,
  outcome text not null check (outcome in ('delivered', 'denied', 'rate_limited')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index file_download_audit_file_idx
  on public.file_download_audit (file_id, created_at desc);
create index file_download_audit_share_idx
  on public.file_download_audit (share_id, created_at desc)
  where share_id is not null;

create table public.file_share_access_attempts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  ip_hash text not null,
  success boolean not null default false,
  blocked_until timestamptz,
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_attempt_at timestamptz not null default now(),
  unique (token_hash, ip_hash)
);

create index file_share_access_attempts_blocked_idx
  on public.file_share_access_attempts (token_hash, blocked_until)
  where blocked_until is not null;

create table public.legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_type text not null check (scope_type in ('organization', 'project', 'file')),
  project_id uuid references public.projects(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  placed_by uuid not null references public.profiles(id) on delete restrict,
  released_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint legal_holds_scope_valid check (
    (scope_type = 'organization' and project_id is null and file_id is null)
    or (scope_type = 'project' and project_id is not null and file_id is null)
    or (scope_type = 'file' and file_id is not null)
  ),
  constraint legal_holds_release_valid check (
    (released_at is null and released_by is null)
    or (released_at is not null and released_by is not null)
  )
);

create index legal_holds_active_idx
  on public.legal_holds (organization_id, scope_type, created_at desc)
  where released_at is null;

create table public.production_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  scope text not null default 'platform'
    check (scope in ('platform', 'organization')),
  status text not null check (status in ('healthy', 'degraded', 'critical')),
  checks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checks) = 'array'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now()
);

create index production_health_snapshots_recorded_idx
  on public.production_health_snapshots (recorded_at desc, id);

create table public.production_alert_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  alert_key text not null check (char_length(btrim(alert_key)) between 3 and 120),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  message text not null check (char_length(btrim(message)) between 3 and 2000),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index production_alert_events_open_idx
  on public.production_alert_events (organization_id, severity, created_at desc)
  where acknowledged_at is null;

create table public.organization_export_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_kind text not null default 'full'
    check (export_kind in ('full', 'accounting')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manifest) = 'object'),
  checksum_sha256 text
    check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  row_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(row_counts) = 'object'),
  requested_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index organization_export_runs_org_idx
  on public.organization_export_runs (organization_id, created_at desc);

create table public.accelo_promotion_run_context (
  run_id uuid primary key references public.accelo_pull_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  authority_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(authority_snapshot) = 'array'),
  schedule_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schedule_snapshot) = 'object'),
  source_mapping_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_mapping_snapshot) = 'array'),
  captured_at timestamptz not null default now()
);

create table public.accelo_source_mapping_journal (
  sequence_id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.accelo_pull_runs(id) on delete restrict,
  mapping_id uuid not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  before_image jsonb,
  after_image jsonb,
  recorded_at timestamptz not null default now(),
  constraint accelo_source_mapping_journal_images_valid check (
    (operation = 'insert' and before_image is null and after_image is not null)
    or (operation = 'update' and before_image is not null and after_image is not null)
    or (operation = 'delete' and before_image is not null and after_image is null)
  )
);

create index accelo_source_mapping_journal_run_idx
  on public.accelo_source_mapping_journal (run_id, sequence_id desc);

create table public.tenant_role_security_matrix (
  id bigint generated always as identity primary key,
  table_category text not null check (table_category in ('finance', 'files')),
  table_name text not null,
  role text not null check (role in ('admin', 'manager', 'member', 'viewer')),
  operation text not null check (operation in ('select', 'insert', 'update', 'delete')),
  allowed boolean not null,
  notes text,
  unique (table_category, table_name, role, operation)
);

insert into public.tenant_role_security_matrix (
  table_category, table_name, role, operation, allowed, notes
)
values
  ('finance', 'invoices', 'admin', 'select', true, 'Commercial read/write'),
  ('finance', 'invoices', 'admin', 'insert', true, null),
  ('finance', 'invoices', 'admin', 'update', true, null),
  ('finance', 'invoices', 'admin', 'delete', false, 'Ledger rows are voided, not deleted'),
  ('finance', 'invoices', 'manager', 'select', true, null),
  ('finance', 'invoices', 'manager', 'insert', true, null),
  ('finance', 'invoices', 'manager', 'update', true, null),
  ('finance', 'invoices', 'manager', 'delete', false, null),
  ('finance', 'invoices', 'member', 'select', false, null),
  ('finance', 'invoices', 'member', 'insert', false, null),
  ('finance', 'invoices', 'member', 'update', false, null),
  ('finance', 'invoices', 'member', 'delete', false, null),
  ('finance', 'invoices', 'viewer', 'select', false, null),
  ('finance', 'invoices', 'viewer', 'insert', false, null),
  ('finance', 'invoices', 'viewer', 'update', false, null),
  ('finance', 'invoices', 'viewer', 'delete', false, null),
  ('finance', 'payments', 'admin', 'select', true, null),
  ('finance', 'payments', 'admin', 'insert', true, null),
  ('finance', 'payments', 'admin', 'update', true, null),
  ('finance', 'payments', 'admin', 'delete', false, null),
  ('finance', 'payments', 'manager', 'select', true, null),
  ('finance', 'payments', 'manager', 'insert', true, null),
  ('finance', 'payments', 'manager', 'update', true, null),
  ('finance', 'payments', 'manager', 'delete', false, null),
  ('finance', 'payments', 'member', 'select', false, null),
  ('finance', 'payments', 'member', 'insert', false, null),
  ('finance', 'payments', 'member', 'update', false, null),
  ('finance', 'payments', 'member', 'delete', false, null),
  ('finance', 'payments', 'viewer', 'select', false, null),
  ('finance', 'payments', 'viewer', 'insert', false, null),
  ('finance', 'payments', 'viewer', 'update', false, null),
  ('finance', 'payments', 'viewer', 'delete', false, null),
  ('finance', 'finance_audit_events', 'admin', 'select', true, null),
  ('finance', 'finance_audit_events', 'admin', 'insert', false, 'Server-generated only'),
  ('finance', 'finance_audit_events', 'admin', 'update', false, null),
  ('finance', 'finance_audit_events', 'admin', 'delete', false, null),
  ('finance', 'finance_audit_events', 'manager', 'select', true, null),
  ('finance', 'finance_audit_events', 'manager', 'insert', false, null),
  ('finance', 'finance_audit_events', 'manager', 'update', false, null),
  ('finance', 'finance_audit_events', 'manager', 'delete', false, null),
  ('finance', 'finance_audit_events', 'member', 'select', false, null),
  ('finance', 'finance_audit_events', 'member', 'insert', false, null),
  ('finance', 'finance_audit_events', 'member', 'update', false, null),
  ('finance', 'finance_audit_events', 'member', 'delete', false, null),
  ('finance', 'finance_audit_events', 'viewer', 'select', false, null),
  ('finance', 'finance_audit_events', 'viewer', 'insert', false, null),
  ('finance', 'finance_audit_events', 'viewer', 'update', false, null),
  ('finance', 'finance_audit_events', 'viewer', 'delete', false, null),
  ('files', 'files', 'admin', 'select', true, null),
  ('files', 'files', 'admin', 'insert', true, null),
  ('files', 'files', 'admin', 'update', true, null),
  ('files', 'files', 'admin', 'delete', true, null),
  ('files', 'files', 'manager', 'select', true, null),
  ('files', 'files', 'manager', 'insert', true, null),
  ('files', 'files', 'manager', 'update', true, null),
  ('files', 'files', 'manager', 'delete', true, null),
  ('files', 'files', 'member', 'select', true, 'Project-scoped via RLS'),
  ('files', 'files', 'member', 'insert', true, null),
  ('files', 'files', 'member', 'update', true, null),
  ('files', 'files', 'member', 'delete', false, null),
  ('files', 'files', 'viewer', 'select', true, 'Guest/project scoped via RLS'),
  ('files', 'files', 'viewer', 'insert', false, null),
  ('files', 'files', 'viewer', 'update', false, null),
  ('files', 'files', 'viewer', 'delete', false, null),
  ('files', 'file_shares', 'admin', 'select', true, null),
  ('files', 'file_shares', 'admin', 'insert', true, null),
  ('files', 'file_shares', 'admin', 'update', true, null),
  ('files', 'file_shares', 'admin', 'delete', true, null),
  ('files', 'file_shares', 'manager', 'select', true, null),
  ('files', 'file_shares', 'manager', 'insert', true, null),
  ('files', 'file_shares', 'manager', 'update', true, null),
  ('files', 'file_shares', 'manager', 'delete', true, null),
  ('files', 'file_shares', 'member', 'select', true, null),
  ('files', 'file_shares', 'member', 'insert', true, null),
  ('files', 'file_shares', 'member', 'update', true, null),
  ('files', 'file_shares', 'member', 'delete', true, null),
  ('files', 'file_shares', 'viewer', 'select', true, 'Recipient only'),
  ('files', 'file_shares', 'viewer', 'insert', false, null),
  ('files', 'file_shares', 'viewer', 'update', false, null),
  ('files', 'file_shares', 'viewer', 'delete', false, null),
  ('files', 'file_scan_results', 'admin', 'select', true, null),
  ('files', 'file_scan_results', 'admin', 'insert', false, 'Scanner interface only'),
  ('files', 'file_scan_results', 'admin', 'update', false, null),
  ('files', 'file_scan_results', 'admin', 'delete', false, null),
  ('files', 'file_scan_results', 'manager', 'select', true, null),
  ('files', 'file_scan_results', 'manager', 'insert', false, null),
  ('files', 'file_scan_results', 'manager', 'update', false, null),
  ('files', 'file_scan_results', 'manager', 'delete', false, null),
  ('files', 'file_scan_results', 'member', 'select', false, null),
  ('files', 'file_scan_results', 'member', 'insert', false, null),
  ('files', 'file_scan_results', 'member', 'update', false, null),
  ('files', 'file_scan_results', 'member', 'delete', false, null),
  ('files', 'file_scan_results', 'viewer', 'select', false, null),
  ('files', 'file_scan_results', 'viewer', 'insert', false, null),
  ('files', 'file_scan_results', 'viewer', 'update', false, null),
  ('files', 'file_scan_results', 'viewer', 'delete', false, null);

create or replace function private.stable_json_hash(target jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(target, '{}'::jsonb)::text, 'sha256'), 'hex');
$$;

create or replace function private.guard_production_audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise object_not_in_prerequisite_state using
    message = 'Production audit events are append-only and server-generated.';
end;
$$;

create trigger guard_production_audit_events
  before update or delete on public.production_audit_events
  for each row execute function private.guard_production_audit_append_only();

create or replace function private.record_production_audit(
  target_organization_id uuid,
  target_action_category text,
  target_action_type text,
  target_entity_type text,
  target_entity_id uuid,
  target_before_state jsonb,
  target_after_state jsonb,
  target_request_correlation_id uuid,
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null,
  target_actor_id uuid default null
)
returns public.production_audit_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.production_audit_events%rowtype;
  before_payload jsonb := coalesce(target_before_state, '{}'::jsonb);
  after_payload jsonb := coalesce(target_after_state, '{}'::jsonb);
begin
  if target_idempotency_key is not null then
    select event.* into result
    from public.production_audit_events as event
    where event.organization_id = target_organization_id
      and event.idempotency_key = btrim(target_idempotency_key);
    if result.id is not null then
      return result;
    end if;
  end if;
  insert into public.production_audit_events (
    organization_id,
    actor_id,
    action_category,
    action_type,
    entity_type,
    entity_id,
    before_state,
    after_state,
    before_hash,
    after_hash,
    request_correlation_id,
    metadata,
    idempotency_key
  )
  values (
    target_organization_id,
    coalesce(target_actor_id, auth.uid()),
    target_action_category,
    target_action_type,
    target_entity_type,
    target_entity_id,
    before_payload,
    after_payload,
    private.stable_json_hash(before_payload),
    private.stable_json_hash(after_payload),
    target_request_correlation_id,
    coalesce(target_metadata, '{}'::jsonb),
    nullif(btrim(target_idempotency_key), '')
  )
  returning * into result;
  return result;
end;
$$;

create or replace function private.record_finance_audit(
  target_organization_id uuid,
  target_action_type text,
  target_entity_type text,
  target_entity_id uuid,
  target_before_state jsonb,
  target_after_state jsonb,
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns public.finance_audit_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.finance_audit_events%rowtype;
  correlation_id uuid := coalesce(
    nullif(target_metadata ->> 'request_correlation_id', '')::uuid,
    gen_random_uuid()
  );
begin
  if target_idempotency_key is not null then
    select event.* into result
    from public.finance_audit_events as event
    where event.organization_id = target_organization_id
      and event.idempotency_key = btrim(target_idempotency_key);
    if result.id is not null then
      return result;
    end if;
  end if;
  insert into public.finance_audit_events (
    organization_id, actor_id, action_type, entity_type, entity_id,
    before_state, after_state, metadata, idempotency_key
  )
  values (
    target_organization_id, (select auth.uid()), target_action_type,
    target_entity_type, target_entity_id,
    coalesce(target_before_state, '{}'::jsonb),
    coalesce(target_after_state, '{}'::jsonb),
    coalesce(target_metadata, '{}'::jsonb),
    nullif(btrim(target_idempotency_key), '')
  )
  returning * into result;
  perform private.record_production_audit(
    target_organization_id,
    'finance',
    target_action_type,
    target_entity_type,
    target_entity_id,
    coalesce(target_before_state, '{}'::jsonb),
    coalesce(target_after_state, '{}'::jsonb),
    correlation_id,
    coalesce(target_metadata, '{}'::jsonb) || jsonb_build_object(
      'finance_audit_event_id', result.id
    ),
    case
      when target_idempotency_key is null then null
      else 'finance:' || btrim(target_idempotency_key)
    end
  );
  return result;
end;
$$;

create or replace function private.role_matrix_allows(
  target_category text,
  target_table text,
  target_role text,
  target_operation text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select matrix.allowed
      from public.tenant_role_security_matrix as matrix
      where matrix.table_category = target_category
        and matrix.table_name = target_table
        and matrix.role = target_role
        and matrix.operation = target_operation
    ),
    false
  );
$$;

create or replace function public.check_file_share_rate_limit(
  target_token_hash text,
  target_ip_hash text,
  target_max_attempts integer default 8,
  target_window_minutes integer default 15,
  target_block_minutes integer default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  attempt public.file_share_access_attempts%rowtype;
  window_start timestamptz := now() - make_interval(mins => target_window_minutes);
begin
  select row.* into attempt
  from public.file_share_access_attempts as row
  where row.token_hash = target_token_hash
    and row.ip_hash = target_ip_hash
  for update;
  if attempt.id is not null and attempt.blocked_until is not null
     and attempt.blocked_until > now() then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited',
      'blocked_until', attempt.blocked_until,
      'attempt_count', attempt.attempt_count
    );
  end if;
  if attempt.id is null then
    insert into public.file_share_access_attempts (
      token_hash, ip_hash, success, attempt_count, last_attempt_at
    )
    values (target_token_hash, target_ip_hash, false, 1, now())
    returning * into attempt;
  elsif attempt.last_attempt_at < window_start then
    update public.file_share_access_attempts as row
    set attempt_count = 1, last_attempt_at = now(), blocked_until = null, success = false
    where row.id = attempt.id
    returning row.* into attempt;
  else
    update public.file_share_access_attempts as row
    set
      attempt_count = row.attempt_count + 1,
      last_attempt_at = now(),
      blocked_until = case
        when row.attempt_count + 1 >= target_max_attempts
          then now() + make_interval(mins => target_block_minutes)
        else row.blocked_until
      end
    where row.id = attempt.id
    returning row.* into attempt;
  end if;
  return jsonb_build_object(
    'allowed', coalesce(attempt.blocked_until, now()) <= now(),
    'reason', case
      when attempt.blocked_until is not null and attempt.blocked_until > now()
        then 'rate_limited'
      else null
    end,
    'blocked_until', attempt.blocked_until,
    'attempt_count', attempt.attempt_count
  );
end;
$$;

create or replace function public.mark_file_share_access_success(
  target_token_hash text,
  target_ip_hash text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.file_share_access_attempts (
    token_hash, ip_hash, success, attempt_count, last_attempt_at
  )
  values (target_token_hash, target_ip_hash, true, 0, now())
  on conflict (token_hash, ip_hash) do update
  set success = true, attempt_count = 0, blocked_until = null, last_attempt_at = now();
end;
$$;

create or replace function public.record_file_download_audit(
  target_organization_id uuid,
  target_file_id uuid,
  target_share_id uuid,
  target_actor_id uuid,
  target_access_channel text,
  target_ip_hash text,
  target_user_agent_hash text,
  target_request_correlation_id uuid,
  target_outcome text,
  target_metadata jsonb default '{}'::jsonb
)
returns public.file_download_audit
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.file_download_audit%rowtype;
begin
  insert into public.file_download_audit (
    organization_id, file_id, share_id, actor_id, access_channel,
    ip_hash, user_agent_hash, request_correlation_id, outcome, metadata
  )
  values (
    target_organization_id, target_file_id, target_share_id, target_actor_id,
    target_access_channel, target_ip_hash, target_user_agent_hash,
    target_request_correlation_id, target_outcome, coalesce(target_metadata, '{}'::jsonb)
  )
  returning * into result;
  perform private.record_production_audit(
    target_organization_id,
    'share',
    'file_download',
    'file',
    target_file_id,
    '{}'::jsonb,
    jsonb_build_object(
      'share_id', target_share_id,
      'outcome', target_outcome,
      'access_channel', target_access_channel
    ),
    target_request_correlation_id,
    coalesce(target_metadata, '{}'::jsonb),
    'share-download:' || result.id::text
  );
  return result;
end;
$$;

create or replace function public.submit_file_scan_result(
  target_file_id uuid,
  target_scan_status text,
  target_scanner_name text default 'interface',
  target_signature text default null,
  target_detail jsonb default '{}'::jsonb
)
returns public.file_scan_results
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  file_row public.files%rowtype;
  result public.file_scan_results%rowtype;
  correlation_id uuid := gen_random_uuid();
begin
  select row.* into file_row
  from public.files as row
  where row.id = target_file_id;
  if file_row.id is null then
    raise no_data_found using message = 'File not found.';
  end if;
  insert into public.file_scan_results (
    organization_id, file_id, scan_status, scanner_name, signature, detail, scanned_at
  )
  values (
    file_row.organization_id,
    target_file_id,
    target_scan_status,
    coalesce(nullif(btrim(target_scanner_name), ''), 'interface'),
    nullif(btrim(target_signature), ''),
    coalesce(target_detail, '{}'::jsonb),
    now()
  )
  on conflict (file_id) do update
  set
    scan_status = excluded.scan_status,
    scanner_name = excluded.scanner_name,
    signature = excluded.signature,
    detail = excluded.detail,
    scanned_at = excluded.scanned_at,
    updated_at = now()
  returning * into result;
  if target_scan_status in ('infected', 'quarantined') then
    insert into public.file_quarantine_actions (
      organization_id, file_id, action, reason, actor_id
    )
    values (
      file_row.organization_id,
      target_file_id,
      'quarantine',
      coalesce(target_detail ->> 'reason', 'Malware scan flagged file'),
      auth.uid()
    );
  end if;
  perform private.record_production_audit(
    file_row.organization_id,
    'operator',
    'file_scan',
    'file',
    target_file_id,
    '{}'::jsonb,
    to_jsonb(result),
    correlation_id,
    coalesce(target_detail, '{}'::jsonb),
    'file-scan:' || target_file_id::text || ':' || target_scan_status
  );
  return result;
end;
$$;

create or replace function public.search_production_audit(
  target_organization_id uuid,
  target_action_category text default null,
  target_entity_type text default null,
  target_request_correlation_id uuid default null,
  target_limit integer default 100
)
returns setof public.production_audit_events
language sql
stable
security invoker
set search_path = ''
as $$
  select event.*
  from public.production_audit_events as event
  where event.organization_id = target_organization_id
    and (
      target_action_category is null
      or event.action_category = target_action_category
    )
    and (
      target_entity_type is null
      or event.entity_type = target_entity_type
    )
    and (
      target_request_correlation_id is null
      or event.request_correlation_id = target_request_correlation_id
    )
  order by event.created_at desc, event.id desc
  limit least(greatest(coalesce(target_limit, 100), 1), 500);
$$;

create or replace function public.list_operator_dead_letters(
  target_organization_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'storage_deletion_outbox',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id,
        'bucket_id', row.bucket_id,
        'object_path', row.object_path,
        'status', row.status,
        'attempt_count', row.attempt_count,
        'last_error', row.last_error,
        'updated_at', row.updated_at
      ) order by row.updated_at desc)
      from public.storage_deletion_outbox as row
      where row.status = 'dead'
      limit 100
    ), '[]'::jsonb),
    'slack_notification_outbox',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id,
        'event_type', row.event_type,
        'channel', row.channel,
        'status', row.status,
        'attempt_count', row.attempt_count,
        'last_error', row.last_error,
        'dead_lettered_at', row.dead_lettered_at
      ) order by row.dead_lettered_at desc nulls last, row.updated_at desc)
      from public.slack_notification_outbox as row
      where row.status = 'dead'
      limit 100
    ), '[]'::jsonb),
    'invoice_deliveries',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id,
        'organization_id', row.organization_id,
        'invoice_id', row.invoice_id,
        'recipient_email', row.recipient_email,
        'status', row.status,
        'attempt_count', row.attempt_count,
        'failure_reason', row.failure_reason,
        'updated_at', row.updated_at
      ) order by row.updated_at desc)
      from public.invoice_deliveries as row
      where row.status = 'failed'
        and (target_organization_id is null or row.organization_id = target_organization_id)
      limit 100
    ), '[]'::jsonb)
  );
$$;

create or replace function public.record_production_health_snapshot(
  target_scope text,
  target_status text,
  target_checks jsonb,
  target_organization_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns public.production_health_snapshots
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.production_health_snapshots%rowtype;
begin
  insert into public.production_health_snapshots (
    organization_id, scope, status, checks, metadata
  )
  values (
    target_organization_id,
    target_scope,
    target_status,
    coalesce(target_checks, '[]'::jsonb),
    coalesce(target_metadata, '{}'::jsonb)
  )
  returning * into result;
  if target_status in ('degraded', 'critical') then
    insert into public.production_alert_events (
      organization_id, alert_key, severity, message, metadata
    )
    values (
      target_organization_id,
      'health.' || target_scope,
      case when target_status = 'critical' then 'critical' else 'warning' end,
      'Production health snapshot recorded a ' || target_status || ' status.',
      jsonb_build_object('snapshot_id', result.id, 'checks', target_checks)
        || coalesce(target_metadata, '{}'::jsonb)
    );
  end if;
  return result;
end;
$$;

create or replace function public.retry_accelo_unresolved_dependency(
  target_unresolved_id uuid,
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
  unresolved public.accelo_unresolved_dependencies%rowtype;
  correlation_id uuid := gen_random_uuid();
begin
  select row.* into unresolved
  from public.accelo_unresolved_dependencies as row
  where row.id = target_unresolved_id
  for update;
  if unresolved.id is null then
    raise no_data_found using message = 'Unresolved dependency not found.';
  end if;
  update public.accelo_unresolved_dependencies as row
  set
    resolution_state = 'pending_retry',
    recovery_status = 'queued',
    recovery_reason_code = 'operator_retry',
    recovery_last_attempted_at = now(),
    updated_at = now()
  where row.id = target_unresolved_id;
  perform private.record_production_audit(
    unresolved.organization_id,
    'operator',
    'accelo_unresolved_retry',
    'accelo_unresolved_dependency',
    target_unresolved_id,
    to_jsonb(unresolved),
    jsonb_build_object(
      'resolution_state', 'pending_retry',
      'recovery_status', 'queued'
    ),
    correlation_id,
    jsonb_build_object('reason', btrim(target_reason)),
    'accelo-unresolved-retry:' || target_unresolved_id::text,
    target_actor_id
  );
  return jsonb_build_object('ok', true, 'unresolved_id', target_unresolved_id);
end;
$$;

create or replace function public.replay_accelo_stage_record(
  target_stage_id uuid,
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
  stage public.accelo_pull_stage%rowtype;
  correlation_id uuid := gen_random_uuid();
begin
  select row.* into stage
  from public.accelo_pull_stage as row
  where row.id = target_stage_id
  for update;
  if stage.id is null then
    raise no_data_found using message = 'Accelo stage record not found.';
  end if;
  update public.accelo_pull_stage as row
  set
    promotion_state = 'pending',
    promotion_error = null,
    updated_at = now()
  where row.id = target_stage_id;
  perform private.record_production_audit(
    stage.organization_id,
    'operator',
    'accelo_stage_replay',
    'accelo_pull_stage',
    target_stage_id,
    to_jsonb(stage),
    jsonb_build_object('promotion_state', 'pending'),
    correlation_id,
    jsonb_build_object('reason', btrim(target_reason)),
    'accelo-stage-replay:' || target_stage_id::text,
    target_actor_id
  );
  return jsonb_build_object('ok', true, 'stage_id', target_stage_id);
end;
$$;

create or replace function private.capture_accelo_promotion_run_context(
  target_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_run public.accelo_pull_runs%rowtype;
begin
  select run.* into source_run
  from public.accelo_pull_runs as run
  where run.id = target_run_id;
  if source_run.id is null then
    return;
  end if;
  insert into public.accelo_promotion_run_context (
    run_id,
    organization_id,
    authority_snapshot,
    schedule_snapshot,
    source_mapping_snapshot
  )
  values (
    source_run.id,
    source_run.organization_id,
    coalesce((
      select jsonb_agg(to_jsonb(authority))
      from public.integration_authority_states as authority
      where authority.organization_id = source_run.organization_id
        and authority.provider = 'accelo'
    ), '[]'::jsonb),
    coalesce((
      select to_jsonb(settings)
      from public.integration_settings as settings
      where settings.organization_id = source_run.organization_id
        and settings.provider = 'accelo'
    ), '{}'::jsonb),
    -- Mapping changes are captured incrementally by
    -- journal_accelo_source_mapping. Snapshotting every historical mapping on
    -- each run makes run creation scale with the entire import history.
    '[]'::jsonb
  )
  on conflict (run_id) do nothing;
end;
$$;

create or replace function private.journal_accelo_source_mapping()
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
begin
  if run_id is null
     or coalesce(new.provider, old.provider) <> 'accelo'
     or nullif(current_setting('app.accelo_rollback_run_id', true), '') is not null then
    return coalesce(new, old);
  end if;
  insert into public.accelo_source_mapping_journal (
    organization_id,
    run_id,
    mapping_id,
    operation,
    before_image,
    after_image
  )
  values (
    coalesce(new.organization_id, old.organization_id),
    run_id,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists journal_accelo_source_records on public.source_records;
create trigger journal_accelo_source_records
  after insert or update or delete on public.source_records
  for each row execute function private.journal_accelo_source_mapping();

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
  mapping_journal public.accelo_source_mapping_journal%rowtype;
  run_context public.accelo_promotion_run_context%rowtype;
  current_image jsonb;
  authority_row jsonb;
  column_list text;
  restored_list text;
  restored bigint := 0;
  mappings_restored bigint := 0;
  rollback_conflicts jsonb := '[]'::jsonb;
  correlation_id uuid := gen_random_uuid();
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

  perform private.capture_accelo_promotion_run_context(target_run_id);

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
      rollback_conflicts := rollback_conflicts || jsonb_build_array(jsonb_build_object(
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
      rollback_conflicts := rollback_conflicts || jsonb_build_array(jsonb_build_object(
        'journal_sequence', journal.sequence_id,
        'reason', 'delete_restore_requires_manual_review'
      ));
      continue;
    end if;
    restored := restored + 1;
  end loop;

  for mapping_journal in
    select entry.*
    from public.accelo_source_mapping_journal as entry
    where entry.run_id = source_run.id
    order by entry.sequence_id desc
  loop
    if mapping_journal.operation = 'insert' then
      delete from public.source_records as mapping
      where mapping.id = mapping_journal.mapping_id;
      mappings_restored := mappings_restored + 1;
    elsif mapping_journal.operation = 'update' then
      update public.source_records as mapping
      set
        provider = coalesce(mapping_journal.before_image ->> 'provider', mapping.provider),
        source_account_id = coalesce(
          mapping_journal.before_image ->> 'source_account_id', mapping.source_account_id
        ),
        source_entity_type = coalesce(
          mapping_journal.before_image ->> 'source_entity_type', mapping.source_entity_type
        ),
        source_record_id = coalesce(
          mapping_journal.before_image ->> 'source_record_id', mapping.source_record_id
        ),
        destination_table = coalesce(
          mapping_journal.before_image ->> 'destination_table', mapping.destination_table
        ),
        destination_record_id = coalesce(
          mapping_journal.before_image ->> 'destination_record_id', mapping.destination_record_id
        ),
        source_deleted = coalesce(
          (mapping_journal.before_image ->> 'source_deleted')::boolean, mapping.source_deleted
        )
      where mapping.id = mapping_journal.mapping_id;
      mappings_restored := mappings_restored + 1;
    end if;
  end loop;

  select context.* into run_context
  from public.accelo_promotion_run_context as context
  where context.run_id = source_run.id;

  if run_context.run_id is not null then
    for authority_row in
      select value
      from jsonb_array_elements(run_context.authority_snapshot) as value
    loop
      update public.integration_authority_states as authority
      set
        state = coalesce(authority_row ->> 'state', authority.state),
        previous_state = authority_row ->> 'previous_state',
        transitioned_at = coalesce(
          (authority_row ->> 'transitioned_at')::timestamptz,
          authority.transitioned_at
        ),
        updated_at = now()
      where authority.organization_id = source_run.organization_id
        and authority.provider = 'accelo'
        and authority.entity_type = authority_row ->> 'entity_type'
        and authority.source_account_id = authority_row ->> 'source_account_id';
    end loop;

    update public.integration_settings as settings
    set
      enabled = coalesce((run_context.schedule_snapshot ->> 'enabled')::boolean, settings.enabled),
      settings = coalesce(run_context.schedule_snapshot -> 'settings', settings.settings),
      updated_at = now()
    where settings.organization_id = source_run.organization_id
      and settings.provider = 'accelo';
  end if;

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

  perform private.record_production_audit(
    source_run.organization_id,
    'authority',
    'accelo_promotion_rollback',
    'accelo_pull_run',
    source_run.id,
    '{}'::jsonb,
    jsonb_build_object(
      'attempt_id', attempt_id,
      'restored', restored,
      'mappings_restored', mappings_restored,
      'conflicts', jsonb_array_length(rollback_conflicts)
    ),
    correlation_id,
    jsonb_build_object('reason', btrim(target_reason)),
    'accelo-rollback:' || source_run.id::text,
    target_actor_id
  );

  return jsonb_build_object(
    'attempt_id', attempt_id,
    'restored', restored,
    'mappings_restored', mappings_restored,
    'conflicts', jsonb_array_length(rollback_conflicts),
    'status', case
      when jsonb_array_length(rollback_conflicts) = 0 then 'succeeded'
      else 'conflicted'
    end
  );
end;
$$;

create or replace function public.begin_organization_export(
  target_organization_id uuid,
  target_export_kind text default 'full',
  target_requested_by uuid default null
)
returns public.organization_export_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.organization_export_runs%rowtype;
  correlation_id uuid := gen_random_uuid();
begin
  insert into public.organization_export_runs (
    organization_id, export_kind, status, requested_by, started_at
  )
  values (
    target_organization_id,
    coalesce(nullif(btrim(target_export_kind), ''), 'full'),
    'running',
    target_requested_by,
    now()
  )
  returning * into result;
  perform private.record_production_audit(
    target_organization_id,
    'export',
    'organization_export_started',
    'organization_export_run',
    result.id,
    '{}'::jsonb,
    jsonb_build_object('export_kind', result.export_kind),
    correlation_id,
    '{}'::jsonb,
    'organization-export:' || result.id::text,
    target_requested_by
  );
  return result;
end;
$$;

create or replace function public.complete_organization_export(
  target_export_id uuid,
  target_manifest jsonb,
  target_checksum_sha256 text,
  target_row_counts jsonb default '{}'::jsonb
)
returns public.organization_export_runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.organization_export_runs%rowtype;
begin
  update public.organization_export_runs as run
  set
    status = 'succeeded',
    manifest = coalesce(target_manifest, '{}'::jsonb),
    checksum_sha256 = nullif(btrim(target_checksum_sha256), ''),
    row_counts = coalesce(target_row_counts, '{}'::jsonb),
    completed_at = now()
  where run.id = target_export_id
  returning run.* into result;
  if result.id is null then
    raise no_data_found using message = 'Export run not found.';
  end if;
  perform private.record_production_audit(
    result.organization_id,
    'export',
    'organization_export_completed',
    'organization_export_run',
    result.id,
    '{}'::jsonb,
    jsonb_build_object(
      'checksum_sha256', result.checksum_sha256,
      'row_counts', result.row_counts
    ),
    gen_random_uuid(),
    coalesce(target_manifest, '{}'::jsonb),
    'organization-export-complete:' || result.id::text
  );
  return result;
end;
$$;

alter table public.production_audit_events enable row level security;
alter table public.file_scan_results enable row level security;
alter table public.file_quarantine_actions enable row level security;
alter table public.file_download_audit enable row level security;
alter table public.legal_holds enable row level security;
alter table public.production_health_snapshots enable row level security;
alter table public.production_alert_events enable row level security;
alter table public.organization_export_runs enable row level security;
alter table public.accelo_promotion_run_context enable row level security;
alter table public.accelo_source_mapping_journal enable row level security;
alter table public.tenant_role_security_matrix enable row level security;

create policy "Admins and managers can read production audit"
on public.production_audit_events for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Admins and managers can read file scan results"
on public.file_scan_results for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Admins and managers can read file quarantine actions"
on public.file_quarantine_actions for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Admins and managers can read file download audit"
on public.file_download_audit for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Admins and managers can manage legal holds"
on public.legal_holds for all to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)))
with check ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Admins and managers can read health snapshots"
on public.production_health_snapshots for select to authenticated
using (
  organization_id is null
  or (select private.has_organization_role(
    organization_id, array['admin', 'manager']::text[]
  ))
);

create policy "Admins and managers can read production alerts"
on public.production_alert_events for select to authenticated
using (
  organization_id is null
  or (select private.has_organization_role(
    organization_id, array['admin', 'manager']::text[]
  ))
);

create policy "Admins and managers can read organization exports"
on public.organization_export_runs for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Everyone can read security matrix"
on public.tenant_role_security_matrix for select to authenticated
using (true);

revoke all on public.file_share_access_attempts from anon, authenticated;

revoke all on function private.stable_json_hash(jsonb) from public;
revoke all on function private.record_production_audit(
  uuid, text, text, text, uuid, jsonb, jsonb, uuid, jsonb, text, uuid
) from public;
revoke all on function private.role_matrix_allows(text, text, text, text) from public;
revoke all on function private.capture_accelo_promotion_run_context(uuid) from public;
create or replace function private.guard_source_record_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(current_setting('app.accelo_rollback_run_id', true), '') is not null then
    return coalesce(new, old);
  end if;
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

revoke all on function private.guard_source_record_identity() from public;


grant execute on function public.check_file_share_rate_limit(
  text, text, integer, integer, integer
) to service_role;
grant execute on function public.mark_file_share_access_success(text, text) to service_role;
grant execute on function public.record_file_download_audit(
  uuid, uuid, uuid, uuid, text, text, text, uuid, text, jsonb
) to service_role;
grant execute on function public.submit_file_scan_result(
  uuid, text, text, text, jsonb
) to service_role;
grant execute on function public.search_production_audit(
  uuid, text, text, uuid, integer
) to authenticated, service_role;
grant execute on function public.list_operator_dead_letters(uuid) to service_role;
grant execute on function public.record_production_health_snapshot(
  text, text, jsonb, uuid, jsonb
) to service_role;
grant execute on function public.retry_accelo_unresolved_dependency(
  uuid, uuid, text
) to service_role;
grant execute on function public.replay_accelo_stage_record(
  uuid, uuid, text
) to service_role;
grant execute on function public.begin_organization_export(
  uuid, text, uuid
) to service_role;
grant execute on function public.complete_organization_export(
  uuid, jsonb, text, jsonb
) to service_role;

create or replace function public.record_production_audit(
  target_organization_id uuid,
  target_action_category text,
  target_action_type text,
  target_entity_type text,
  target_entity_id uuid,
  target_before_state jsonb,
  target_after_state jsonb,
  target_request_correlation_id uuid,
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null,
  target_actor_id uuid default null
)
returns public.production_audit_events
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_production_audit(
    target_organization_id,
    target_action_category,
    target_action_type,
    target_entity_type,
    target_entity_id,
    target_before_state,
    target_after_state,
    target_request_correlation_id,
    target_metadata,
    target_idempotency_key,
    target_actor_id
  );
$$;

revoke all on function public.record_production_audit(
  uuid, text, text, text, uuid, jsonb, jsonb, uuid, jsonb, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_production_audit(
  uuid, text, text, text, uuid, jsonb, jsonb, uuid, jsonb, text, uuid
) to service_role;

create or replace function private.ensure_accelo_promotion_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'running'
     and (tg_op = 'INSERT' or old.status is distinct from 'running') then
    perform private.capture_accelo_promotion_run_context(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_accelo_promotion_context on public.accelo_pull_runs;
create trigger ensure_accelo_promotion_context
  after insert or update of status on public.accelo_pull_runs
  for each row execute function private.ensure_accelo_promotion_context();
