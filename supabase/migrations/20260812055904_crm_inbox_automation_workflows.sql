-- Complete the local sales workflow and make inbox/automation promises durable.
-- Accelo remains read-only: these records and functions only mutate P11 tables.

alter table public.prospects
  add column lost_reason text,
  add column won_project_id uuid,
  add column won_retainer_id uuid,
  add column conversion_key text,
  add column converted_at timestamptz;

update public.prospects
set lost_reason = coalesce(
  nullif(btrim(source_payload ->> 'lost_reason'), ''),
  'Imported without a recorded loss reason'
)
where stage = 'lost'
  and nullif(btrim(lost_reason), '') is null;

alter table public.prospects
  add constraint prospects_lost_reason_consistent check (
    (
      stage = 'lost'
      and lost_reason is not null
      and char_length(btrim(lost_reason)) between 3 and 1000
    )
    or (stage <> 'lost' and lost_reason is null)
  ),
  add constraint prospects_won_conversion_consistent check (
    (
      stage = 'won'
      and (
        (won_project_id is null and won_retainer_id is null and converted_at is null)
        or (won_project_id is not null and converted_at is not null)
      )
    )
    or (
      stage <> 'won'
      and won_project_id is null
      and won_retainer_id is null
      and converted_at is null
    )
  ),
  add constraint prospects_organization_won_project_fkey
    foreign key (organization_id, won_project_id)
    references public.projects(organization_id, id)
    on delete set null (won_project_id),
  add constraint prospects_organization_won_retainer_fkey
    foreign key (organization_id, won_retainer_id)
    references public.retainers(organization_id, id)
    on delete set null (won_retainer_id);

create unique index prospects_organization_conversion_key
  on public.prospects (organization_id, conversion_key)
  where conversion_key is not null;
create index prospects_next_action_idx
  on public.prospects (organization_id, owner_id, next_action_at, id)
  where stage not in ('won', 'lost') and next_action_at is not null;

create table public.prospect_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null,
  contact_id uuid not null,
  role text check (role is null or char_length(btrim(role)) <= 160),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (prospect_id, contact_id),
  foreign key (organization_id, prospect_id)
    references public.prospects(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete cascade
);

create unique index prospect_contacts_one_primary
  on public.prospect_contacts (prospect_id)
  where is_primary;
create index prospect_contacts_contact_idx
  on public.prospect_contacts (contact_id, prospect_id);

alter table public.client_activities
  add column prospect_id uuid;

alter table public.client_activities
  add constraint client_activities_organization_prospect_fkey
    foreign key (organization_id, prospect_id)
    references public.prospects(organization_id, id) on delete set null;

create index client_activities_prospect_occurred_idx
  on public.client_activities (prospect_id, occurred_at desc, id desc)
  where prospect_id is not null;

create table public.automation_rule_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  event_key text not null check (char_length(btrim(event_key)) between 1 and 500),
  trigger_source_type text,
  trigger_source_id text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retry', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (rule_id, event_key)
);

create index automation_rule_runs_claim_idx
  on public.automation_rule_runs (available_at, created_at, id)
  where status in ('pending', 'retry');
create index automation_rule_runs_rule_history_idx
  on public.automation_rule_runs (rule_id, created_at desc, id desc);

create table public.automation_run_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.automation_rule_runs(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 20),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  error text,
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (run_id, attempt_number, status)
);

create index automation_run_attempts_history_idx
  on public.automation_run_attempts (run_id, attempt_number desc, id desc);

alter table public.work_approvals
  add column automation_run_id uuid unique
    references public.automation_rule_runs(id) on delete set null;

alter table public.workspace_inbox_items
  drop constraint workspace_inbox_items_kind_check,
  add constraint workspace_inbox_items_kind_check check (
    kind in (
      'mention', 'assignment', 'thread_reply', 'approval', 'due', 'overdue',
      'blocker', 'watch', 'automation', 'integration', 'file_share',
      'file_comment', 'support_ticket', 'time_approval', 'renewal',
      'prospect_next_action', 'bill_ready', 'delivery_failure',
      'collection_promise'
    )
  );

create or replace function private.sync_prospect_primary_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_primary then
    update public.prospects
    set primary_contact_id = new.contact_id, updated_at = statement_timestamp()
    where id = new.prospect_id;
  elsif tg_op = 'UPDATE' and old.is_primary and not new.is_primary then
    update public.prospects
    set primary_contact_id = null, updated_at = statement_timestamp()
    where id = new.prospect_id and primary_contact_id = new.contact_id;
  end if;
  return new;
end;
$$;

create or replace function private.clear_deleted_prospect_primary_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_primary then
    update public.prospects
    set primary_contact_id = null, updated_at = statement_timestamp()
    where id = old.prospect_id and primary_contact_id = old.contact_id;
  end if;
  return old;
end;
$$;

create trigger sync_prospect_primary_contact
  after insert or update of is_primary, contact_id on public.prospect_contacts
  for each row execute function private.sync_prospect_primary_contact();
create trigger clear_deleted_prospect_primary_contact
  after delete on public.prospect_contacts
  for each row execute function private.clear_deleted_prospect_primary_contact();
create trigger set_prospect_contacts_updated_at
  before update on public.prospect_contacts
  for each row execute function private.set_updated_at();
create trigger set_automation_rule_runs_updated_at
  before update on public.automation_rule_runs
  for each row execute function private.set_updated_at();

create or replace function private.convert_prospect_to_won(
  target_prospect_id uuid,
  target_project_name text,
  target_project_code text,
  target_start_date date,
  target_create_retainer boolean,
  target_retainer_name text,
  target_retainer_fee_cents bigint,
  target_retainer_included_minutes integer,
  target_conversion_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  opportunity public.prospects%rowtype;
  account public.clients%rowtype;
  project public.projects%rowtype;
  retainer public.retainers%rowtype;
  actor_id uuid := (select auth.uid());
begin
  select item.* into opportunity
  from public.prospects as item
  where item.id = target_prospect_id
  for update;

  if opportunity.id is null then
    raise no_data_found using message = 'Opportunity not found.';
  end if;
  if not (select private.has_organization_permission(
    opportunity.organization_id, 'pipeline.write'
  )) then
    raise insufficient_privilege using message = 'Pipeline management access is required.';
  end if;
  if opportunity.stage = 'won' and opportunity.won_project_id is not null then
    if opportunity.conversion_key = nullif(btrim(target_conversion_key), '') then
      return jsonb_build_object(
        'prospect_id', opportunity.id,
        'client_id', opportunity.client_id,
        'project_id', opportunity.won_project_id,
        'retainer_id', opportunity.won_retainer_id,
        'idempotent', true
      );
    end if;
    raise object_not_in_prerequisite_state using
      message = 'Opportunity was already converted.';
  end if;
  if opportunity.stage = 'lost' then
    raise object_not_in_prerequisite_state using
      message = 'A lost opportunity must be reopened before conversion.';
  end if;
  if char_length(btrim(target_project_name)) not between 2 and 160
    or target_project_code !~ '^[A-Z0-9][A-Z0-9-]{1,31}$'
    or char_length(btrim(target_conversion_key)) not between 8 and 500
    or (
      target_create_retainer
      and (
        char_length(btrim(coalesce(target_retainer_name, ''))) not between 2 and 160
        or coalesce(target_retainer_fee_cents, -1) < 0
        or coalesce(target_retainer_included_minutes, -1) not between 0 and 10000000
      )
    )
  then
    raise check_violation using message = 'Invalid opportunity conversion request.';
  end if;

  select item.* into account
  from public.clients as item
  where item.id = opportunity.client_id
    and item.organization_id = opportunity.organization_id
  for update;
  if account.id is null then
    raise foreign_key_violation using message = 'Opportunity client is missing.';
  end if;

  insert into public.projects (
    organization_id, client_id, name, code, client_name, status, owner_id,
    start_date, currency, commercial_currency, billing_type,
    commercial_value_cents, metadata
  )
  values (
    opportunity.organization_id, account.id, btrim(target_project_name),
    upper(btrim(target_project_code)), account.name, 'active',
    opportunity.owner_id, coalesce(target_start_date, current_date),
    opportunity.currency, opportunity.currency, 'time_and_materials',
    opportunity.value_cents,
    jsonb_build_object('converted_from_prospect_id', opportunity.id)
  )
  returning * into project;

  insert into public.project_contacts (
    organization_id, project_id, contact_id, role, is_primary
  )
  select
    relation.organization_id, project.id, relation.contact_id,
    relation.role, relation.is_primary
  from public.prospect_contacts as relation
  where relation.prospect_id = opportunity.id
  on conflict (project_id, contact_id) do update
  set role = excluded.role, is_primary = excluded.is_primary;

  if opportunity.primary_contact_id is not null then
    insert into public.project_contacts (
      organization_id, project_id, contact_id, role, is_primary
    )
    values (
      opportunity.organization_id, project.id, opportunity.primary_contact_id,
      'Opportunity contact', true
    )
    on conflict (project_id, contact_id) do update set is_primary = true;
  end if;

  if target_create_retainer then
    insert into public.retainers (
      organization_id, client_id, name, status, start_date, cadence,
      included_minutes, fee_cents, currency, allowance_type, created_by
    )
    values (
      opportunity.organization_id, account.id, btrim(target_retainer_name),
      'active', coalesce(target_start_date, current_date), 'monthly',
      target_retainer_included_minutes, target_retainer_fee_cents,
      opportunity.currency, 'fixed_hours', actor_id
    )
    returning * into retainer;

    insert into public.retainer_projects (
      organization_id, retainer_id, project_id
    )
    values (opportunity.organization_id, retainer.id, project.id);
  end if;

  update public.clients
  set
    status = 'active',
    account_owner_id = coalesce(account_owner_id, opportunity.owner_id),
    updated_at = statement_timestamp()
  where id = account.id;

  update public.prospects
  set
    stage = 'won',
    probability = 100,
    lost_reason = null,
    closed_at = statement_timestamp(),
    won_project_id = project.id,
    won_retainer_id = retainer.id,
    conversion_key = btrim(target_conversion_key),
    converted_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = opportunity.id;

  insert into public.client_activities (
    organization_id, client_id, project_id, contact_id, prospect_id,
    activity_type, subject, body, occurred_at, created_by, source, metadata
  )
  values (
    opportunity.organization_id, account.id, project.id,
    opportunity.primary_contact_id, opportunity.id, 'status_change',
    'Opportunity won',
    'Converted "' || opportunity.title || '" into project ' || project.name || '.',
    statement_timestamp(), actor_id, 'manual',
    jsonb_build_object(
      'project_id', project.id,
      'retainer_id', retainer.id,
      'conversion_key', btrim(target_conversion_key)
    )
  );

  return jsonb_build_object(
    'prospect_id', opportunity.id,
    'client_id', account.id,
    'project_id', project.id,
    'retainer_id', retainer.id,
    'idempotent', false
  );
end;
$$;

create or replace function public.convert_prospect_to_won(
  target_prospect_id uuid,
  target_project_name text,
  target_project_code text,
  target_start_date date default current_date,
  target_create_retainer boolean default false,
  target_retainer_name text default null,
  target_retainer_fee_cents bigint default null,
  target_retainer_included_minutes integer default null,
  target_conversion_key text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.convert_prospect_to_won(
    target_prospect_id, target_project_name, target_project_code,
    target_start_date, target_create_retainer, target_retainer_name,
    target_retainer_fee_cents, target_retainer_included_minutes,
    target_conversion_key
  );
$$;

create or replace function private.merge_workspace_contacts(
  target_contact_id uuid,
  duplicate_contact_id uuid
)
returns public.contacts
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  canonical public.contacts%rowtype;
  duplicate public.contacts%rowtype;
begin
  if target_contact_id = duplicate_contact_id then
    raise check_violation using message = 'Choose two different contacts.';
  end if;
  select item.* into canonical
  from public.contacts as item where item.id = target_contact_id for update;
  select item.* into duplicate
  from public.contacts as item where item.id = duplicate_contact_id for update;
  if canonical.id is null or duplicate.id is null
    or canonical.organization_id <> duplicate.organization_id
  then
    raise check_violation using message = 'Contacts must belong to one workspace.';
  end if;
  if not (select private.has_organization_permission(
    canonical.organization_id, 'commercial.write'
  )) then
    raise insufficient_privilege using message = 'Commercial management access is required.';
  end if;

  insert into public.client_contacts (
    organization_id, client_id, contact_id, role, is_primary,
    receives_invoices, position, standing
  )
  select
    link.organization_id, link.client_id, canonical.id, link.role,
    link.is_primary, link.receives_invoices, link.position, link.standing
  from public.client_contacts as link
  where link.contact_id = duplicate.id
  on conflict (client_id, contact_id) do update set
    role = coalesce(public.client_contacts.role, excluded.role),
    is_primary = public.client_contacts.is_primary or excluded.is_primary,
    receives_invoices =
      public.client_contacts.receives_invoices or excluded.receives_invoices,
    position = coalesce(public.client_contacts.position, excluded.position),
    standing = coalesce(public.client_contacts.standing, excluded.standing);
  delete from public.client_contacts where contact_id = duplicate.id;

  insert into public.project_contacts (
    organization_id, project_id, contact_id, role, is_primary
  )
  select organization_id, project_id, canonical.id, role, is_primary
  from public.project_contacts
  where contact_id = duplicate.id
  on conflict (project_id, contact_id) do update set
    role = coalesce(public.project_contacts.role, excluded.role),
    is_primary = public.project_contacts.is_primary or excluded.is_primary;
  delete from public.project_contacts where contact_id = duplicate.id;

  insert into public.prospect_contacts (
    organization_id, prospect_id, contact_id, role, is_primary
  )
  select organization_id, prospect_id, canonical.id, role, is_primary
  from public.prospect_contacts
  where contact_id = duplicate.id
  on conflict (prospect_id, contact_id) do update set
    role = coalesce(public.prospect_contacts.role, excluded.role),
    is_primary = public.prospect_contacts.is_primary or excluded.is_primary;
  delete from public.prospect_contacts where contact_id = duplicate.id;

  update public.prospects
  set primary_contact_id = canonical.id, updated_at = statement_timestamp()
  where primary_contact_id = duplicate.id;
  update public.client_activities
  set
    contact_id = canonical.id,
    participant_contact_ids =
      array_replace(participant_contact_ids, duplicate.id, canonical.id),
    updated_at = statement_timestamp()
  where contact_id = duplicate.id
    or duplicate.id = any(participant_contact_ids);

  update public.contacts
  set
    first_name = coalesce(nullif(btrim(canonical.first_name), ''), duplicate.first_name),
    last_name = coalesce(nullif(btrim(canonical.last_name), ''), duplicate.last_name),
    email = coalesce(canonical.email, duplicate.email),
    phone = coalesce(canonical.phone, duplicate.phone),
    title = coalesce(canonical.title, duplicate.title),
    updated_at = statement_timestamp()
  where id = canonical.id
  returning * into canonical;

  update public.contacts
  set
    status = 'inactive',
    metadata = metadata || jsonb_build_object(
      'merged_into_contact_id', canonical.id,
      'merged_at', statement_timestamp()
    ),
    updated_at = statement_timestamp()
  where id = duplicate.id;
  return canonical;
end;
$$;

create or replace function public.merge_workspace_contacts(
  target_contact_id uuid,
  duplicate_contact_id uuid
)
returns public.contacts
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.merge_workspace_contacts(target_contact_id, duplicate_contact_id);
$$;

create or replace function private.guard_automation_attempt_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise object_not_in_prerequisite_state using
    message = 'Automation attempt history is append-only.';
end;
$$;

create trigger guard_automation_attempt_history
  before update or delete on public.automation_run_attempts
  for each row execute function private.guard_automation_attempt_history();

alter table public.prospect_contacts enable row level security;
alter table public.automation_rule_runs enable row level security;
alter table public.automation_run_attempts enable row level security;

create policy prospect_contacts_select_organization
on public.prospect_contacts for select to authenticated
using (organization_id = (select private.current_organization_id()));
create policy prospect_contacts_manage_pipeline
on public.prospect_contacts for all to authenticated
using ((select private.has_organization_permission(organization_id, 'pipeline.write')))
with check ((select private.has_organization_permission(organization_id, 'pipeline.write')));

create policy automation_rule_runs_read_managers
on public.automation_rule_runs for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));
create policy automation_rule_runs_manage_managers
on public.automation_rule_runs for all to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)))
with check ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));
create policy automation_attempts_read_managers
on public.automation_run_attempts for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));
create policy automation_attempts_insert_managers
on public.automation_run_attempts for insert to authenticated
with check ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

revoke all on
  public.prospect_contacts,
  public.automation_rule_runs,
  public.automation_run_attempts
from public, anon, authenticated;
grant select, insert, update, delete on public.prospect_contacts to authenticated;
grant select, insert, update, delete on public.automation_rule_runs to authenticated;
grant select, insert on public.automation_run_attempts to authenticated;
grant all on
  public.prospect_contacts,
  public.automation_rule_runs,
  public.automation_run_attempts
to service_role;
grant usage, select on sequence public.automation_run_attempts_id_seq
  to authenticated, service_role;

revoke all on function private.convert_prospect_to_won(
  uuid, text, text, date, boolean, text, bigint, integer, text
) from public, anon, authenticated;
grant execute on function private.convert_prospect_to_won(
  uuid, text, text, date, boolean, text, bigint, integer, text
) to authenticated, service_role;
revoke all on function public.convert_prospect_to_won(
  uuid, text, text, date, boolean, text, bigint, integer, text
) from public, anon;
grant execute on function public.convert_prospect_to_won(
  uuid, text, text, date, boolean, text, bigint, integer, text
) to authenticated, service_role;

revoke all on function private.merge_workspace_contacts(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.merge_workspace_contacts(uuid, uuid)
  to authenticated, service_role;
revoke all on function public.merge_workspace_contacts(uuid, uuid)
  from public, anon;
grant execute on function public.merge_workspace_contacts(uuid, uuid)
  to authenticated, service_role;

revoke all on function private.sync_prospect_primary_contact()
  from public, anon, authenticated;
revoke all on function private.clear_deleted_prospect_primary_contact()
  from public, anon, authenticated;
revoke all on function private.guard_automation_attempt_history()
  from public, anon, authenticated;
