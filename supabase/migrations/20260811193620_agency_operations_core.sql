-- Organization-scoped agency operations: CRM, retainers, time, billing, and cash.
-- Monetary values are integer minor units; durations are whole minutes.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  status text not null default 'active'
    check (status in ('prospect', 'active', 'on_hold', 'inactive')),
  billing_email text check (
    billing_email is null
    or (billing_email = lower(billing_email) and position('@' in billing_email) > 1)
  ),
  phone text,
  website text,
  billing_address jsonb not null default '{}'::jsonb
    check (jsonb_typeof(billing_address) = 'object'),
  default_currency char(3) not null default 'USD'
    check (default_currency ~ '^[A-Z]{3}$'),
  payment_terms_days integer not null default 30
    check (payment_terms_days between 0 and 365),
  external_id text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index clients_organization_normalized_name_key
  on public.clients (
    organization_id,
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  );
create unique index clients_organization_external_id_key
  on public.clients (organization_id, external_id)
  where external_id is not null;
create index clients_organization_status_name_idx
  on public.clients (organization_id, status, name, id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text not null default ''
    check (char_length(btrim(last_name)) <= 100),
  email text check (
    email is null
    or (email = lower(email) and position('@' in email) > 1)
  ),
  phone text,
  title text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  external_id text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index contacts_organization_email_key
  on public.contacts (organization_id, lower(email))
  where email is not null;
create unique index contacts_organization_external_id_key
  on public.contacts (organization_id, external_id)
  where external_id is not null;
create index contacts_organization_name_idx
  on public.contacts (organization_id, last_name, first_name, id);

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  contact_id uuid not null,
  role text,
  is_primary boolean not null default false,
  receives_invoices boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (client_id, contact_id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete cascade
);

create unique index client_contacts_one_primary_per_client
  on public.client_contacts (client_id) where is_primary;
create index client_contacts_contact_idx on public.client_contacts (contact_id, client_id);

create table public.retainers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  start_date date not null,
  end_date date,
  cadence text not null default 'monthly'
    check (cadence in ('weekly', 'monthly', 'quarterly', 'annual', 'custom')),
  included_minutes integer not null check (included_minutes between 0 and 10000000),
  fee_cents bigint not null check (fee_cents >= 0),
  overage_rate_cents bigint check (overage_rate_cents is null or overage_rate_cents >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  rollover_policy text not null default 'none'
    check (rollover_policy in ('none', 'next_period', 'contract')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, client_id, id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  constraint retainers_dates_valid check (end_date is null or end_date >= start_date)
);

create index retainers_client_status_idx
  on public.retainers (client_id, status, start_date, id);

create table public.retainer_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  retainer_id uuid not null,
  period_start date not null,
  period_end date not null,
  included_minutes integer not null check (included_minutes between 0 and 10000000),
  rollover_minutes integer not null default 0
    check (rollover_minutes between 0 and 10000000),
  fee_cents bigint not null check (fee_cents >= 0),
  status text not null default 'open'
    check (status in ('planned', 'open', 'closed', 'cancelled')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, client_id, id),
  unique (retainer_id, period_start, period_end),
  foreign key (organization_id, client_id, retainer_id)
    references public.retainers(organization_id, client_id, id) on delete cascade,
  constraint retainer_periods_dates_valid check (period_end >= period_start),
  constraint retainer_periods_closed_consistent check (
    (status = 'closed' and closed_at is not null)
    or (status <> 'closed' and closed_at is null)
  )
);

create index retainer_periods_client_dates_idx
  on public.retainer_periods (client_id, period_start desc, period_end desc, id);
create index retainer_periods_retainer_status_idx
  on public.retainer_periods (retainer_id, status, period_start, id);

create or replace function private.ensure_retainer_periods(
  target_retainer_id uuid,
  through_date date
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  contract public.retainers%rowtype;
  next_period_start date;
  next_period_end date;
  generated_count integer := 0;
  inserted_count integer;
begin
  select item.* into contract
  from public.retainers as item
  where item.id = target_retainer_id;
  if contract.id is null then
    raise no_data_found using message = 'Retainer not found.';
  end if;
  if (select auth.role()) = 'authenticated'
    and not (select private.has_organization_role(
      contract.organization_id, array['admin', 'manager']::text[]
    ))
  then
    raise insufficient_privilege using message = 'Manager retainer access is required.';
  end if;

  select coalesce(max(item.period_end) + 1, contract.start_date)
  into next_period_start
  from public.retainer_periods as item
  where item.retainer_id = contract.id
    and item.status <> 'cancelled';

  while next_period_start <= least(
    coalesce(contract.end_date, through_date),
    greatest(through_date, contract.start_date)
  ) and generated_count < 240
  loop
    next_period_end := case contract.cadence
      when 'weekly' then next_period_start + 6
      when 'quarterly' then (next_period_start + interval '3 months - 1 day')::date
      when 'annual' then (next_period_start + interval '1 year - 1 day')::date
      when 'custom' then coalesce(contract.end_date, through_date)
      else (next_period_start + interval '1 month - 1 day')::date
    end;
    next_period_end := least(
      next_period_end,
      coalesce(contract.end_date, next_period_end)
    );

    insert into public.retainer_periods (
      organization_id,
      client_id,
      retainer_id,
      period_start,
      period_end,
      included_minutes,
      fee_cents,
      status,
      closed_at
    )
    values (
      contract.organization_id,
      contract.client_id,
      contract.id,
      next_period_start,
      next_period_end,
      contract.included_minutes,
      contract.fee_cents,
      case
        when current_date between next_period_start and next_period_end then 'open'
        when next_period_end < current_date then 'closed'
        else 'planned'
      end,
      case when next_period_end < current_date then statement_timestamp() else null end
    )
    on conflict do nothing;
    get diagnostics inserted_count = row_count;
    generated_count := generated_count + inserted_count;
    next_period_start := next_period_end + 1;
  end loop;
  return generated_count;
end;
$$;

create or replace function private.initialize_retainer_periods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_retainer_periods(
    new.id,
    greatest(current_date, new.start_date)
  );
  return new;
end;
$$;

revoke all on function private.ensure_retainer_periods(uuid, date) from public;
revoke all on function private.initialize_retainer_periods() from public;

create trigger initialize_retainer_periods
  after insert on public.retainers
  for each row execute function private.initialize_retainer_periods();

create or replace function private.roll_active_retainer_periods(
  through_date date
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item record;
  generated_count integer := 0;
begin
  for item in
    select retainer.id
    from public.retainers as retainer
    where retainer.status = 'active'
      and retainer.start_date <= through_date
      and (retainer.end_date is null or retainer.end_date >= current_date)
  loop
    generated_count := generated_count
      + private.ensure_retainer_periods(item.id, through_date);
  end loop;
  return generated_count;
end;
$$;

create or replace function public.roll_active_retainer_periods(
  through_date date default current_date
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.roll_active_retainer_periods(through_date);
$$;

revoke all on function private.roll_active_retainer_periods(date) from public;
revoke all on function public.roll_active_retainer_periods(date)
  from public, anon, authenticated;
grant execute on function private.roll_active_retainer_periods(date)
  to service_role;
grant execute on function public.roll_active_retainer_periods(date)
  to service_role;

create unique index profiles_organization_id_id_key
  on public.profiles (organization_id, id);

create table public.staff_billing_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  client_id uuid,
  project_id uuid,
  rate_cents bigint not null check (rate_cents >= 0),
  cost_rate_cents bigint check (cost_rate_cents is null or cost_rate_cents >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_to date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, profile_id)
    references public.profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete cascade,
  constraint staff_billing_rates_dates_valid check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint staff_billing_rates_scope_valid check (
    project_id is null or client_id is not null
  )
);

create index staff_billing_rates_lookup_idx
  on public.staff_billing_rates (
    organization_id, profile_id, project_id, client_id, effective_from desc, id
  );

-- P11's standard baseline is $180/hour billed and $70/hour cost. Rates are
-- effective-dated and snapshotted onto each time entry, so future changes do
-- not rewrite historical margin.
insert into public.staff_billing_rates (
  organization_id,
  profile_id,
  rate_cents,
  cost_rate_cents,
  currency,
  effective_from
)
select
  profile.organization_id,
  profile.id,
  18000,
  7000,
  'USD',
  date '2026-01-01'
from public.profiles as profile
where profile.organization_id is not null
  and profile.status = 'active'
  and profile.role in ('admin', 'manager', 'member');

create unique index projects_organization_id_id_key
  on public.projects (organization_id, id);

alter table public.projects
  add column client_id uuid,
  add column billing_type text not null default 'time_and_materials',
  add column fixed_fee_cents bigint,
  add column hourly_rate_cents bigint,
  add column billing_cap_cents bigint,
  add column commercial_currency char(3);

create or replace function private.backfill_project_clients()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  insert into public.clients (organization_id, name, default_currency)
  select
    project.organization_id,
    min(regexp_replace(btrim(project.client_name), '\s+', ' ', 'g')),
    min(project.currency)
  from public.projects as project
  where nullif(regexp_replace(btrim(project.client_name), '\s+', ' ', 'g'), '') is not null
  group by
    project.organization_id,
    lower(regexp_replace(btrim(project.client_name), '\s+', ' ', 'g'))
  on conflict do nothing;

  update public.projects as project
  set client_id = client.id
  from public.clients as client
  where client.organization_id = project.organization_id
    and lower(regexp_replace(btrim(client.name), '\s+', ' ', 'g'))
      = lower(regexp_replace(btrim(project.client_name), '\s+', ' ', 'g'))
    and project.client_id is null
    and nullif(regexp_replace(btrim(project.client_name), '\s+', ' ', 'g'), '') is not null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function private.backfill_project_clients() from public, anon, authenticated;
grant execute on function private.backfill_project_clients() to service_role;

select private.backfill_project_clients();

alter table public.projects
  add constraint projects_organization_client_fkey
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  add constraint projects_billing_type_valid check (
    billing_type in ('time_and_materials', 'fixed_fee', 'internal')
  ),
  add constraint projects_fixed_fee_valid check (
    fixed_fee_cents is null or fixed_fee_cents >= 0
  ),
  add constraint projects_hourly_rate_valid check (
    hourly_rate_cents is null or hourly_rate_cents >= 0
  ),
  add constraint projects_billing_cap_valid check (
    billing_cap_cents is null or billing_cap_cents >= 0
  ),
  add constraint projects_commercial_currency_valid check (
    commercial_currency is null or commercial_currency ~ '^[A-Z]{3}$'
  ),
  add constraint projects_commercial_fields_consistent check (
    billing_type = 'fixed_fee' or fixed_fee_cents is null
  );

-- Dynamic Basecamp promotion populates the complete composite row and therefore
-- supplies null (rather than invoking a column default) for newly added fields.
-- This trigger keeps that existing import path compatible and normalizes future
-- legacy client_name writes into the organization-scoped client relation.
create or replace function private.normalize_project_commercial_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_client_name text :=
    nullif(regexp_replace(btrim(new.client_name), '\s+', ' ', 'g'), '');
begin
  new.billing_type := coalesce(new.billing_type, 'time_and_materials');

  if new.client_id is null and normalized_client_name is not null then
    insert into public.clients (organization_id, name, default_currency)
    values (new.organization_id, normalized_client_name, new.currency)
    on conflict do nothing;

    select client.id into new.client_id
    from public.clients as client
    where client.organization_id = new.organization_id
      and lower(regexp_replace(btrim(client.name), '\s+', ' ', 'g'))
        = lower(normalized_client_name);
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_project_commercial_fields() from public;

create trigger normalize_project_commercial_fields
  before insert or update of organization_id, client_name, client_id, currency,
    billing_type, fixed_fee_cents, hourly_rate_cents, billing_cap_cents,
    commercial_currency
  on public.projects
  for each row execute function private.normalize_project_commercial_fields();

create index projects_client_status_idx
  on public.projects (client_id, status, updated_at desc, id)
  where client_id is not null;

alter table public.staff_billing_rates
  add constraint staff_billing_rates_organization_project_fkey
    foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade;

create table public.client_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  project_id uuid,
  contact_id uuid,
  activity_type text not null
    check (activity_type in ('note', 'call', 'email', 'meeting', 'status_change')),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text,
  occurred_at timestamptz not null default now(),
  duration_minutes integer check (
    duration_minutes is null or duration_minutes between 0 and 10080
  ),
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete set null
);

create index client_activities_client_occurred_idx
  on public.client_activities (client_id, occurred_at desc, id desc);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  project_id uuid not null,
  profile_id uuid not null,
  todo_id uuid references public.todos(id) on delete set null,
  retainer_period_id uuid,
  entry_date date not null default current_date,
  minutes integer not null check (minutes between 1 and 1440),
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  billable boolean not null default true,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'invoiced')),
  billing_rate_cents bigint not null check (billing_rate_cents >= 0),
  cost_rate_cents bigint check (cost_rate_cents is null or cost_rate_cents >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  billable_amount_cents bigint generated always as (
    case when billable then ((minutes::bigint * billing_rate_cents) + 30) / 60 else 0 end
  ) stored,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  invoiced_at timestamptz,
  source text not null default 'manual'
    check (source in ('manual', 'timer', 'import', 'api')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, profile_id)
    references public.profiles(organization_id, id) on delete restrict,
  foreign key (organization_id, client_id, retainer_period_id)
    references public.retainer_periods(organization_id, client_id, id) on delete restrict,
  constraint time_entries_approval_consistent check (
    (status in ('approved', 'invoiced') and approved_by is not null and approved_at is not null)
    or (status not in ('approved', 'invoiced') and approved_by is null and approved_at is null)
  ),
  constraint time_entries_invoice_consistent check (
    (status = 'invoiced' and invoiced_at is not null)
    or (status <> 'invoiced' and invoiced_at is null)
  )
);

create unique index time_entries_organization_external_id_key
  on public.time_entries (organization_id, external_id)
  where external_id is not null;
create index time_entries_project_date_idx
  on public.time_entries (project_id, entry_date desc, id desc);
create index time_entries_client_status_date_idx
  on public.time_entries (client_id, status, entry_date, id);
create index time_entries_retainer_period_idx
  on public.time_entries (retainer_period_id, entry_date, id)
  where retainer_period_id is not null;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  project_id uuid,
  invoice_number text not null
    check (char_length(btrim(invoice_number)) between 1 and 64),
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void', 'overdue')),
  issue_date date not null default current_date,
  due_date date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint generated always as (subtotal_cents + tax_cents) stored,
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  balance_cents bigint generated always as (
    greatest((subtotal_cents + tax_cents) - paid_cents, 0)
  ) stored,
  notes text,
  issued_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, invoice_number),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete restrict,
  constraint invoices_dates_valid check (due_date >= issue_date),
  constraint invoices_paid_not_over_total check (
    paid_cents <= subtotal_cents + tax_cents
  ),
  constraint invoices_status_timestamps_consistent check (
    (status in ('issued', 'partially_paid', 'paid', 'overdue') and issued_at is not null)
    or (status = 'draft' and issued_at is null and paid_at is null and voided_at is null)
    or (status = 'void' and voided_at is not null)
  )
);

create index invoices_client_status_due_idx
  on public.invoices (client_id, status, due_date, id);
create index invoices_organization_ar_idx
  on public.invoices (organization_id, due_date, id)
  where status in ('issued', 'partially_paid', 'overdue');

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  time_entry_id uuid,
  project_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(12,4) not null default 1 check (quantity > 0),
  unit_amount_cents bigint not null check (unit_amount_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (time_entry_id),
  foreign key (organization_id, invoice_id)
    references public.invoices(organization_id, id) on delete cascade,
  foreign key (organization_id, time_entry_id)
    references public.time_entries(organization_id, id) on delete restrict,
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete restrict,
  constraint invoice_line_items_amount_math check (
    amount_cents = round(quantity * unit_amount_cents)::bigint
  )
);

create index invoice_line_items_invoice_position_idx
  on public.invoice_line_items (invoice_id, position, id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  payment_date date not null default current_date,
  method text not null default 'other'
    check (method in ('bank_transfer', 'card', 'check', 'cash', 'credit', 'other')),
  status text not null default 'received'
    check (status in ('pending', 'received', 'partially_allocated', 'allocated', 'refunded', 'void')),
  reference text,
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  notes text,
  received_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict
);

create index payments_client_date_idx
  on public.payments (client_id, payment_date desc, id desc);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  allocated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (payment_id, invoice_id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, payment_id)
    references public.payments(organization_id, id) on delete cascade,
  foreign key (organization_id, invoice_id)
    references public.invoices(organization_id, id) on delete cascade
);

create index payment_allocations_invoice_idx
  on public.payment_allocations (invoice_id, payment_id);

-- Tenant and commercial invariants that require parent-row inspection.
create or replace function private.enforce_agency_operations_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  row_organization_id uuid := nullif(row_data ->> 'organization_id', '')::uuid;
  row_client_id uuid := nullif(row_data ->> 'client_id', '')::uuid;
  row_project_id uuid := nullif(row_data ->> 'project_id', '')::uuid;
  row_profile_id uuid;
begin
  if row_project_id is not null and not exists (
    select 1
    from public.projects as project
    where project.id = row_project_id
      and project.organization_id = row_organization_id
      and (
        row_client_id is null
        or project.client_id is null
        or project.client_id = row_client_id
      )
  ) then
    raise check_violation using
      message = 'Project, client, and organization scope must agree.';
  end if;

  if tg_table_name in ('client_activities', 'invoices')
    and row_project_id is not null
    and not exists (
      select 1 from public.projects as project
      where project.id = row_project_id
        and project.organization_id = row_organization_id
        and project.client_id = row_client_id
    )
  then
    raise check_violation using
      message = 'Client-scoped project records require the project client.';
  end if;

  if tg_table_name = 'staff_billing_rates'
    and row_project_id is not null
    and not exists (
      select 1
      from public.projects as project
      where project.id = row_project_id
        and project.organization_id = row_organization_id
        and project.client_id = row_client_id
    )
  then
    raise check_violation using
      message = 'Project-specific rates require the project client.';
  end if;

  if tg_table_name = 'time_entries' then
    if not exists (
      select 1
      from public.projects as project
      where project.id = new.project_id
        and project.organization_id = new.organization_id
        and project.client_id = new.client_id
    ) then
      raise check_violation using
        message = 'Time entries require a project assigned to the same client.';
    end if;
    if new.todo_id is not null and not exists (
      select 1 from public.todos as todo
      where todo.id = new.todo_id and todo.project_id = new.project_id
    ) then
      raise check_violation using message = 'Time entry issue must belong to its project.';
    end if;
    if new.retainer_period_id is not null and not (
      new.entry_date between (
        select period.period_start from public.retainer_periods as period
        where period.id = new.retainer_period_id
      ) and (
        select period.period_end from public.retainer_periods as period
        where period.id = new.retainer_period_id
      )
    ) then
      raise check_violation using
        message = 'Time entry date must fall inside its retainer period.';
    end if;
  end if;

  if tg_table_name = 'payments' and exists (
    select 1
    from public.payment_allocations as allocation
    where allocation.payment_id = new.id
    group by allocation.payment_id
    having sum(allocation.amount_cents)
      > (row_data ->> 'amount_cents')::bigint
  ) then
    raise check_violation using
      message = 'Payment amount cannot be less than its allocations.';
  end if;

  foreach row_profile_id in array array[
    nullif(row_data ->> 'created_by', '')::uuid,
    nullif(row_data ->> 'approved_by', '')::uuid,
    nullif(row_data ->> 'received_by', '')::uuid,
    nullif(row_data ->> 'allocated_by', '')::uuid
  ]
  loop
    continue when row_profile_id is null;
    if not exists (
      select 1 from public.profiles as profile
      where profile.id = row_profile_id
        and profile.organization_id = row_organization_id
    ) then
      raise check_violation using
        message = 'Referenced staff must belong to the row organization.';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function private.enforce_agency_operations_scope() from public;

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
    raise exclusion_violation using message = 'Billing rate periods cannot overlap.';
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
  ) then
    raise exclusion_violation using message = 'Retainer periods cannot overlap.';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_overlapping_agency_periods() from public;

create or replace function private.validate_invoice_line_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice public.invoices%rowtype;
  target_entry public.time_entries%rowtype;
begin
  select invoice.* into target_invoice
  from public.invoices as invoice
  where invoice.id = new.invoice_id
  for update;
  if target_invoice.status <> 'draft' then
    raise check_violation using message = 'Only draft invoices can change line items.';
  end if;
  if new.organization_id <> target_invoice.organization_id then
    raise check_violation using message = 'Invoice line organization mismatch.';
  end if;
  new.project_id := coalesce(new.project_id, target_invoice.project_id);
  if new.project_id is not null and target_invoice.project_id is not null
    and new.project_id <> target_invoice.project_id
  then
    raise check_violation using message = 'Invoice line project mismatch.';
  end if;
  if new.time_entry_id is not null then
    select entry.* into target_entry
    from public.time_entries as entry
    where entry.id = new.time_entry_id
    for update;
    if target_entry.id is null
      or target_entry.organization_id <> target_invoice.organization_id
      or target_entry.client_id <> target_invoice.client_id
      or (target_invoice.project_id is not null
        and target_entry.project_id <> target_invoice.project_id)
      or target_entry.status <> 'approved'
      or not target_entry.billable
    then
      raise check_violation using
        message = 'Invoice time must be approved, billable, and in invoice scope.';
    end if;
    new.project_id := target_entry.project_id;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_invoice_line_item() from public;

create or replace function private.refresh_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  target_time_entry_id uuid := case when tg_op = 'DELETE'
    then old.time_entry_id else new.time_entry_id end;
begin
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

  if target_time_entry_id is not null then
    update public.time_entries
    set
      status = case when tg_op = 'DELETE' then 'approved' else 'invoiced' end,
      invoiced_at = case when tg_op = 'DELETE' then null else statement_timestamp() end,
      updated_at = statement_timestamp()
    where id = target_time_entry_id;
  end if;
  return null;
end;
$$;

revoke all on function private.refresh_invoice_totals() from public;

create or replace function private.validate_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_payment public.payments%rowtype;
  target_invoice public.invoices%rowtype;
  other_payment_allocations bigint;
  other_invoice_allocations bigint;
begin
  select payment.* into target_payment
  from public.payments as payment where payment.id = new.payment_id for update;
  select invoice.* into target_invoice
  from public.invoices as invoice where invoice.id = new.invoice_id for update;
  if target_payment.id is null or target_invoice.id is null
    or target_payment.organization_id <> new.organization_id
    or target_invoice.organization_id <> new.organization_id
    or target_payment.client_id <> new.client_id
    or target_invoice.client_id <> new.client_id
    or target_payment.currency <> target_invoice.currency
    or target_payment.status in ('refunded', 'void')
    or target_invoice.status in ('draft', 'void')
  then
    raise check_violation using message = 'Payment and invoice scope or status is invalid.';
  end if;

  select coalesce(sum(allocation.amount_cents), 0)::bigint
  into other_payment_allocations
  from public.payment_allocations as allocation
  where allocation.payment_id = new.payment_id and allocation.id <> new.id;
  select coalesce(sum(allocation.amount_cents), 0)::bigint
  into other_invoice_allocations
  from public.payment_allocations as allocation
  where allocation.invoice_id = new.invoice_id and allocation.id <> new.id;

  if other_payment_allocations + new.amount_cents > target_payment.amount_cents
    or other_invoice_allocations + new.amount_cents > target_invoice.total_cents
  then
    raise check_violation using message = 'Payment allocation exceeds available balance.';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_payment_allocation() from public;

create or replace function private.refresh_payment_allocation_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_payment_id uuid := case when tg_op = 'DELETE' then old.payment_id else new.payment_id end;
  target_invoice_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  allocated_payment bigint;
  allocated_invoice bigint;
begin
  select coalesce(sum(amount_cents), 0)::bigint into allocated_payment
  from public.payment_allocations where payment_id = target_payment_id;
  update public.payments as payment
  set
    status = case
      when allocated_payment = 0 then 'received'
      when allocated_payment < payment.amount_cents then 'partially_allocated'
      else 'allocated'
    end,
    updated_at = statement_timestamp()
  where payment.id = target_payment_id
    and payment.status not in ('pending', 'refunded', 'void');

  select coalesce(sum(amount_cents), 0)::bigint into allocated_invoice
  from public.payment_allocations where invoice_id = target_invoice_id;
  update public.invoices as invoice
  set
    paid_cents = allocated_invoice,
    status = case
      when allocated_invoice = 0 then
        case when invoice.due_date < current_date then 'overdue' else 'issued' end
      when allocated_invoice < invoice.total_cents then 'partially_paid'
      else 'paid'
    end,
    paid_at = case when allocated_invoice >= invoice.total_cents
      then statement_timestamp() else null end,
    updated_at = statement_timestamp()
  where invoice.id = target_invoice_id and invoice.status <> 'void';
  return null;
end;
$$;

revoke all on function private.refresh_payment_allocation_totals() from public;

create trigger prevent_overlapping_staff_rates
  before insert or update of organization_id, profile_id, client_id, project_id,
    effective_from, effective_to
  on public.staff_billing_rates
  for each row execute function private.prevent_overlapping_agency_periods();
create trigger prevent_overlapping_retainer_periods
  before insert or update of retainer_id, period_start, period_end, status
  on public.retainer_periods
  for each row execute function private.prevent_overlapping_agency_periods();

create trigger enforce_staff_billing_rate_scope
  before insert or update on public.staff_billing_rates
  for each row execute function private.enforce_agency_operations_scope();
create trigger enforce_client_scope
  before insert or update on public.clients
  for each row execute function private.enforce_agency_operations_scope();
create trigger enforce_contact_scope
  before insert or update on public.contacts
  for each row execute function private.enforce_agency_operations_scope();
create trigger enforce_retainer_scope
  before insert or update on public.retainers
  for each row execute function private.enforce_agency_operations_scope();
create trigger enforce_client_activity_scope
  before insert or update on public.client_activities
  for each row execute function private.enforce_agency_operations_scope();
create trigger enforce_time_entry_scope
  before insert or update on public.time_entries
  for each row execute function private.enforce_agency_operations_scope();
create trigger enforce_invoice_scope
  before insert or update on public.invoices
  for each row execute function private.enforce_agency_operations_scope();
create trigger validate_invoice_line
  before insert or update on public.invoice_line_items
  for each row execute function private.validate_invoice_line_item();
create trigger refresh_invoice_after_line
  after insert or update or delete on public.invoice_line_items
  for each row execute function private.refresh_invoice_totals();
create trigger enforce_payment_scope
  before insert or update on public.payments
  for each row execute function private.enforce_agency_operations_scope();
create trigger validate_payment_allocation
  before insert or update on public.payment_allocations
  for each row execute function private.validate_payment_allocation();
create trigger enforce_payment_allocation_scope
  before insert or update on public.payment_allocations
  for each row execute function private.enforce_agency_operations_scope();
create trigger refresh_payment_allocation_totals
  after insert or update or delete on public.payment_allocations
  for each row execute function private.refresh_payment_allocation_totals();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'contacts', 'retainers', 'retainer_periods',
    'staff_billing_rates', 'client_activities', 'time_entries', 'invoices',
    'invoice_line_items', 'payments'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function private.set_updated_at()',
      'set_' || table_name || '_updated_at',
      table_name
    );
  end loop;
end;
$$;

-- Audit only durable business records; link-table noise is intentionally omitted.
do $$
declare
  item text[];
begin
  foreach item slice 1 in array array[
    array['clients', 'client'],
    array['contacts', 'contact'],
    array['retainers', 'retainer'],
    array['retainer_periods', 'retainer_period'],
    array['staff_billing_rates', 'staff_billing_rate'],
    array['client_activities', 'client_activity'],
    array['time_entries', 'time_entry'],
    array['invoices', 'invoice'],
    array['invoice_line_items', 'invoice_line_item'],
    array['payments', 'payment'],
    array['payment_allocations', 'payment_allocation']
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
       for each row execute function private.capture_activity_event(%L)',
      'capture_' || item[1] || '_activity',
      item[1],
      item[2]
    );
  end loop;
end;
$$;

-- New public tables are fail-closed and organization scoped.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'contacts', 'client_contacts', 'retainers', 'retainer_periods',
    'staff_billing_rates', 'client_activities', 'time_entries', 'invoices',
    'invoice_line_items', 'payments', 'payment_allocations'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated
       using ((select private.has_organization_role(
         organization_id, array[''admin'', ''manager'', ''member'']::text[]
       )))',
      'Organization members can read ' || table_name,
      table_name
    );
    execute format(
      'create policy %I on public.%I for all to authenticated
       using ((select private.has_organization_role(
         organization_id, array[''admin'', ''manager'']::text[]
       )))
       with check ((select private.has_organization_role(
         organization_id, array[''admin'', ''manager'']::text[]
       )))',
      'Organization managers can manage ' || table_name,
      table_name
    );
  end loop;
end;
$$;

-- Financial ledgers and rate cards are manager-only. Time is visible to the
-- owner and managers; bounded reporting RPCs expose safe aggregates.
drop policy "Organization members can read staff_billing_rates"
  on public.staff_billing_rates;
drop policy "Organization members can read invoices" on public.invoices;
drop policy "Organization members can read invoice_line_items"
  on public.invoice_line_items;
drop policy "Organization members can read payments" on public.payments;
drop policy "Organization members can read payment_allocations"
  on public.payment_allocations;
drop policy "Organization members can read time_entries" on public.time_entries;

create policy "Staff can read their own time entries"
on public.time_entries for select to authenticated
using (
  profile_id = (select auth.uid())
  or (select private.has_organization_role(
    organization_id, array['admin', 'manager']::text[]
  ))
);

-- Staff may enter and maintain their own unapproved time.
create policy "Staff can create their own time entries"
on public.time_entries for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);
create policy "Staff can update their own open time entries"
on public.time_entries for update to authenticated
using (
  profile_id = (select auth.uid())
  and status in ('draft', 'submitted', 'rejected')
  and (select private.can_access_project(project_id))
)
with check (
  profile_id = (select auth.uid())
  and status in ('draft', 'submitted')
  and (select private.can_access_project(project_id))
);
create policy "Staff can delete their own draft time entries"
on public.time_entries for delete to authenticated
using (
  profile_id = (select auth.uid())
  and status = 'draft'
  and (select private.can_access_project(project_id))
);

grant select, insert, update, delete on
  public.clients,
  public.contacts,
  public.client_contacts,
  public.retainers,
  public.retainer_periods,
  public.staff_billing_rates,
  public.client_activities,
  public.time_entries,
  public.invoices,
  public.invoice_line_items,
  public.payments,
  public.payment_allocations
to authenticated;

revoke select on public.time_entries from authenticated;
grant select (
  id,
  organization_id,
  client_id,
  project_id,
  profile_id,
  todo_id,
  retainer_period_id,
  entry_date,
  minutes,
  description,
  billable,
  status,
  billing_rate_cents,
  currency,
  billable_amount_cents,
  approved_by,
  approved_at,
  invoiced_at,
  source,
  external_id,
  created_at,
  updated_at
) on public.time_entries to authenticated;

grant all on
  public.clients,
  public.contacts,
  public.client_contacts,
  public.retainers,
  public.retainer_periods,
  public.staff_billing_rates,
  public.client_activities,
  public.time_entries,
  public.invoices,
  public.invoice_line_items,
  public.payments,
  public.payment_allocations
to service_role;

-- Atomic mutation RPCs live privately; public wrappers remain security invokers.
create or replace function private.log_time_entry(
  target_project_id uuid,
  target_entry_date date,
  target_minutes integer,
  target_description text,
  target_billable boolean,
  target_retainer_period_id uuid,
  target_todo_id uuid,
  target_profile_id uuid,
  target_external_id text
)
returns public.time_entries
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_project public.projects%rowtype;
  selected_rate public.staff_billing_rates%rowtype;
  result public.time_entries%rowtype;
  actor_id uuid := (select auth.uid());
begin
  select project.* into target_project
  from public.projects as project where project.id = target_project_id;
  if target_project.id is null or target_project.client_id is null then
    raise check_violation using message = 'Project must have a client before time is logged.';
  end if;
  if (select auth.role()) = 'authenticated' and (
    target_profile_id <> actor_id
    or not (select private.can_access_project(target_project_id))
  ) then
    raise insufficient_privilege using message = 'Cannot log time for this staff/project.';
  end if;
  if target_minutes not between 1 and 1440
    or char_length(btrim(coalesce(target_description, ''))) not between 1 and 1000
  then
    raise check_violation using message = 'Invalid time entry.';
  end if;

  select rate.* into selected_rate
  from public.staff_billing_rates as rate
  where rate.organization_id = target_project.organization_id
    and rate.profile_id = target_profile_id
    and target_entry_date >= rate.effective_from
    and (rate.effective_to is null or target_entry_date <= rate.effective_to)
    and (rate.client_id is null or rate.client_id = target_project.client_id)
    and (rate.project_id is null or rate.project_id = target_project.id)
  order by
    (rate.project_id is not null) desc,
    (rate.client_id is not null) desc,
    rate.effective_from desc,
    rate.id desc
  limit 1;
  if selected_rate.id is null and target_billable then
    raise check_violation using message = 'No effective billing rate exists.';
  end if;

  insert into public.time_entries (
    organization_id, client_id, project_id, profile_id, todo_id,
    retainer_period_id, entry_date, minutes, description, billable,
    billing_rate_cents, cost_rate_cents, currency, external_id
  )
  values (
    target_project.organization_id, target_project.client_id, target_project.id,
    target_profile_id, target_todo_id, target_retainer_period_id,
    target_entry_date, target_minutes, btrim(target_description), target_billable,
    coalesce(selected_rate.rate_cents, 0), selected_rate.cost_rate_cents,
    coalesce(
      selected_rate.currency,
      target_project.commercial_currency,
      target_project.currency
    ),
    nullif(btrim(target_external_id), '')
  )
  on conflict (organization_id, external_id) where external_id is not null
  do update set external_id = excluded.external_id
  returning * into result;
  return result;
end;
$$;

create or replace function public.log_time_entry(
  target_project_id uuid,
  target_entry_date date,
  target_minutes integer,
  target_description text,
  target_billable boolean default true,
  target_retainer_period_id uuid default null,
  target_todo_id uuid default null,
  target_profile_id uuid default auth.uid(),
  target_external_id text default null
)
returns public.time_entries
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.log_time_entry(
    target_project_id, target_entry_date, target_minutes, target_description,
    target_billable, target_retainer_period_id, target_todo_id,
    target_profile_id, target_external_id
  );
$$;

create or replace function private.approve_time_entries(
  target_time_entry_ids uuid[]
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := (select private.current_organization_id());
  updated_count integer;
begin
  if cardinality(target_time_entry_ids) not between 1 and 500
    or not (select private.has_organization_role(
      target_organization_id, array['admin', 'manager']::text[]
    ))
  then
    raise insufficient_privilege using message = 'Manager approval is required.';
  end if;
  if (
    select count(distinct entry.id)
    from public.time_entries as entry
    where entry.id = any(target_time_entry_ids)
      and entry.organization_id = target_organization_id
      and entry.status in ('draft', 'submitted', 'rejected')
  ) <> cardinality(array(select distinct unnest(target_time_entry_ids))) then
    raise check_violation using message = 'All time entries must be open and in one organization.';
  end if;
  update public.time_entries
  set status = 'approved', approved_by = (select auth.uid()),
      approved_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = any(target_time_entry_ids);
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.approve_time_entries(target_time_entry_ids uuid[])
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$ select private.approve_time_entries(target_time_entry_ids); $$;

create or replace function private.create_invoice_from_time_entries(
  target_client_id uuid,
  target_project_id uuid,
  target_invoice_number text,
  target_issue_date date,
  target_due_date date,
  target_time_entry_ids uuid[],
  target_tax_cents bigint
)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := (select private.current_organization_id());
  target_currency char(3);
  result public.invoices%rowtype;
begin
  if cardinality(target_time_entry_ids) not between 1 and 500
    or target_tax_cents < 0 or target_due_date < target_issue_date
  then
    raise check_violation using message = 'Invalid invoice request.';
  end if;
  if not (select private.has_organization_role(
    target_organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  select client.default_currency into target_currency
  from public.clients as client
  where client.id = target_client_id and client.organization_id = target_organization_id;
  if target_currency is null or (
    target_project_id is not null and not exists (
      select 1 from public.projects as project
      where project.id = target_project_id
        and project.organization_id = target_organization_id
        and project.client_id = target_client_id
    )
  ) then
    raise check_violation using message = 'Invoice client/project scope is invalid.';
  end if;
  if (
    select count(distinct entry.id)
    from public.time_entries as entry
    where entry.id = any(target_time_entry_ids)
      and entry.organization_id = target_organization_id
      and entry.client_id = target_client_id
      and (target_project_id is null or entry.project_id = target_project_id)
      and entry.status = 'approved'
      and entry.billable
      and entry.currency = target_currency
  ) <> cardinality(array(select distinct unnest(target_time_entry_ids))) then
    raise check_violation using message = 'Invoice time entries are not eligible.';
  end if;

  insert into public.invoices (
    organization_id, client_id, project_id, invoice_number, issue_date,
    due_date, currency, tax_cents, created_by
  )
  values (
    target_organization_id, target_client_id, target_project_id,
    btrim(target_invoice_number), target_issue_date, target_due_date,
    target_currency, target_tax_cents, (select auth.uid())
  )
  on conflict (organization_id, invoice_number) do nothing
  returning * into result;
  if result.id is null then
    select invoice.* into result from public.invoices as invoice
    where invoice.organization_id = target_organization_id
      and invoice.invoice_number = btrim(target_invoice_number);
    return result;
  end if;

  insert into public.invoice_line_items (
    organization_id, invoice_id, time_entry_id, project_id, description,
    quantity, unit_amount_cents, amount_cents, tax_cents, position
  )
  select
    entry.organization_id, result.id, entry.id, entry.project_id,
    entry.description, entry.minutes::numeric / 60,
    entry.billing_rate_cents, entry.billable_amount_cents,
    case when entry.position = 1 then target_tax_cents else 0 end,
    entry.position - 1
  from (
    select source.*,
      row_number() over (order by source.entry_date, source.id)::integer as position
    from public.time_entries as source
    where source.id = any(target_time_entry_ids)
  ) as entry
  order by entry.position;

  select invoice.* into result from public.invoices as invoice where invoice.id = result.id;
  return result;
end;
$$;

create or replace function public.create_invoice_from_time_entries(
  target_client_id uuid,
  target_project_id uuid,
  target_invoice_number text,
  target_issue_date date,
  target_due_date date,
  target_time_entry_ids uuid[],
  target_tax_cents bigint default 0
)
returns public.invoices
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_invoice_from_time_entries(
    target_client_id, target_project_id, target_invoice_number,
    target_issue_date, target_due_date, target_time_entry_ids, target_tax_cents
  );
$$;

create or replace function private.create_manual_invoice(
  target_client_id uuid,
  target_project_id uuid,
  target_invoice_number text,
  target_issue_date date,
  target_due_date date,
  target_currency char(3),
  target_line_items jsonb,
  target_tax_cents bigint,
  target_notes text
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
begin
  if jsonb_typeof(target_line_items) <> 'array'
    or jsonb_array_length(target_line_items) not between 1 and 500
    or target_tax_cents < 0
    or target_due_date < target_issue_date
    or target_currency !~ '^[A-Z]{3}$'
  then
    raise check_violation using message = 'Invalid manual invoice request.';
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
    organization_id, client_id, project_id, invoice_number, status,
    issue_date, due_date, currency, notes, created_by
  )
  values (
    target_organization_id, target_client_id, target_project_id,
    btrim(target_invoice_number), 'draft', target_issue_date, target_due_date,
    target_currency, nullif(btrim(target_notes), ''), (select auth.uid())
  )
  returning * into result;

  for line_item in select value from jsonb_array_elements(target_line_items)
  loop
    line_quantity := (line_item ->> 'quantity')::numeric;
    line_unit_cents := (line_item ->> 'unit_amount_cents')::bigint;
    if char_length(btrim(coalesce(line_item ->> 'description', '')))
        not between 1 and 500
      or line_quantity <= 0
      or line_unit_cents < 0
    then
      raise check_violation using message = 'Invalid manual invoice line.';
    end if;
    insert into public.invoice_line_items (
      organization_id, invoice_id, project_id, description, quantity,
      unit_amount_cents, amount_cents, tax_cents, position
    )
    values (
      target_organization_id,
      result.id,
      nullif(line_item ->> 'project_id', '')::uuid,
      btrim(line_item ->> 'description'),
      line_quantity,
      line_unit_cents,
      round(line_quantity * line_unit_cents)::bigint,
      case when line_position = 0 then target_tax_cents else 0 end,
      line_position
    );
    line_position := line_position + 1;
  end loop;

  select invoice.* into result
  from public.invoices as invoice
  where invoice.id = result.id;
  return result;
end;
$$;

create or replace function public.create_manual_invoice(
  target_client_id uuid,
  target_project_id uuid,
  target_invoice_number text,
  target_issue_date date,
  target_due_date date,
  target_currency char(3),
  target_line_items jsonb,
  target_tax_cents bigint default 0,
  target_notes text default null
)
returns public.invoices
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_manual_invoice(
    target_client_id, target_project_id, target_invoice_number,
    target_issue_date, target_due_date, target_currency, target_line_items,
    target_tax_cents, target_notes
  );
$$;

create or replace function private.issue_invoice(target_invoice_id uuid)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.invoices%rowtype;
begin
  select invoice.* into result from public.invoices as invoice
  where invoice.id = target_invoice_id for update;
  if result.id is null or not (select private.has_organization_role(
    result.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  if result.status <> 'draft' or result.total_cents <= 0 then
    raise check_violation using message = 'Only non-empty draft invoices can be issued.';
  end if;
  update public.invoices
  set status = case when due_date < current_date then 'overdue' else 'issued' end,
      issued_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = target_invoice_id returning * into result;
  return result;
end;
$$;

create or replace function public.issue_invoice(target_invoice_id uuid)
returns public.invoices
language sql
volatile
security invoker
set search_path = ''
as $$ select private.issue_invoice(target_invoice_id); $$;

create or replace function private.record_client_payment(
  target_client_id uuid,
  target_invoice_id uuid,
  target_amount_cents bigint,
  target_payment_date date,
  target_method text,
  target_reference text,
  target_idempotency_key text
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_invoice public.invoices%rowtype;
  result public.payments%rowtype;
begin
  select invoice.* into target_invoice
  from public.invoices as invoice where invoice.id = target_invoice_id for update;
  if target_invoice.id is null
    or target_invoice.client_id <> target_client_id
    or not (select private.has_organization_role(
      target_invoice.organization_id, array['admin', 'manager']::text[]
    ))
  then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  if target_invoice.status not in ('issued', 'partially_paid', 'overdue')
    or target_amount_cents <= 0
    or target_amount_cents > target_invoice.balance_cents
  then
    raise check_violation using message = 'Payment exceeds the open invoice balance.';
  end if;

  insert into public.payments (
    organization_id, client_id, amount_cents, currency, payment_date,
    method, reference, idempotency_key, received_by
  )
  values (
    target_invoice.organization_id, target_client_id, target_amount_cents,
    target_invoice.currency, target_payment_date, target_method,
    nullif(btrim(target_reference), ''), btrim(target_idempotency_key),
    (select auth.uid())
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into result;
  if result.id is null then
    select payment.* into result from public.payments as payment
    where payment.organization_id = target_invoice.organization_id
      and payment.idempotency_key = btrim(target_idempotency_key);
    return result;
  end if;
  insert into public.payment_allocations (
    organization_id, client_id, payment_id, invoice_id, amount_cents, allocated_by
  )
  values (
    target_invoice.organization_id, target_client_id, result.id,
    target_invoice.id, target_amount_cents, (select auth.uid())
  );
  select payment.* into result from public.payments as payment where payment.id = result.id;
  return result;
end;
$$;

create or replace function public.record_client_payment(
  target_client_id uuid,
  target_invoice_id uuid,
  target_amount_cents bigint,
  target_payment_date date,
  target_method text,
  target_reference text,
  target_idempotency_key text
)
returns public.payments
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_client_payment(
    target_client_id, target_invoice_id, target_amount_cents,
    target_payment_date, target_method, target_reference, target_idempotency_key
  );
$$;

-- Bounded organization/client reads and operational reports.
create or replace function public.get_agency_clients(
  after_name text default null,
  after_client_id uuid default null,
  requested_limit integer default 50,
  status_filters text[] default null,
  text_filter text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select greatest(1, least(coalesce(requested_limit, 50), 100)) as page_limit,
      nullif(btrim(text_filter), '') as search_text
  ), page as (
    select client.*,
      (select count(*) from public.projects as project
       where project.client_id = client.id) as project_count,
      (select count(*) from public.retainers as retainer
       where retainer.client_id = client.id
         and retainer.status = 'active') as retainer_count,
      (select coalesce(sum(invoice.balance_cents), 0)
       from public.invoices as invoice
       where invoice.client_id = client.id
         and invoice.status in ('issued', 'partially_paid', 'overdue')) as balance_cents
    from public.clients as client cross join settings
    where (select private.can_access_organization(client.organization_id))
      and (coalesce(cardinality(status_filters), 0) = 0 or client.status = any(status_filters))
      and (settings.search_text is null
        or client.name ilike '%' || settings.search_text || '%')
      and (
        after_name is null or after_client_id is null
        or (lower(client.name), client.id) > (lower(after_name), after_client_id)
      )
    order by lower(client.name), client.id
    limit (select page_limit + 1 from settings)
  )
  select jsonb_build_object(
    'clients', coalesce((
      select jsonb_agg(to_jsonb(client) order by lower(client.name), client.id)
      from (
        select * from page order by lower(name), id
        limit (select page_limit from settings)
      ) as client
    ), '[]'::jsonb),
    'has_more', (select count(*) > (select page_limit from settings) from page)
  );
$$;

create or replace function private.get_client_operations(
  target_client_id uuid,
  requested_activity_limit integer default 50,
  requested_time_limit integer default 100,
  requested_invoice_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with client as materialized (
    select item.* from public.clients as item
    where item.id = target_client_id
      and (select private.can_access_organization(item.organization_id))
      and (select private.has_organization_role(
        item.organization_id, array['admin', 'manager', 'member']::text[]
      ))
  )
  select case when not exists (select 1 from client) then null
  else jsonb_build_object(
    'client', (select to_jsonb(client.*) from client),
    'projects', coalesce((
      select jsonb_agg(to_jsonb(project) order by project.updated_at desc, project.id)
      from (select item.* from public.projects as item
        where item.client_id = target_client_id
        order by item.updated_at desc, item.id limit 100) as project
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(activity) order by activity.occurred_at desc, activity.id desc)
      from (select item.* from public.client_activities as item
        where item.client_id = target_client_id
        order by item.occurred_at desc, item.id desc
        limit greatest(1, least(coalesce(requested_activity_limit, 50), 100))) as activity
    ), '[]'::jsonb),
    'time_entries', coalesce((
      select jsonb_agg(
        to_jsonb(entry) - 'cost_rate_cents'
        order by entry.entry_date desc, entry.id desc
      )
      from (select item.* from public.time_entries as item
        where item.client_id = target_client_id
        order by item.entry_date desc, item.id desc
        limit greatest(1, least(coalesce(requested_time_limit, 100), 200))) as entry
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(invoice) order by invoice.issue_date desc, invoice.id desc)
      from (select item.* from public.invoices as item
        where item.client_id = target_client_id
        order by item.issue_date desc, item.id desc
        limit greatest(1, least(coalesce(requested_invoice_limit, 50), 100))) as invoice
    ), '[]'::jsonb)
  ) end;
$$;

create or replace function public.get_client_operations(
  target_client_id uuid,
  requested_activity_limit integer default 50,
  requested_time_limit integer default 100,
  requested_invoice_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_client_operations(
    target_client_id,
    requested_activity_limit,
    requested_time_limit,
    requested_invoice_limit
  );
$$;

create or replace function private.get_retainer_burn_report(
  target_retainer_id uuid,
  from_period_start date default null,
  requested_limit integer default 24
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as materialized (
    select retainer.* from public.retainers as retainer
    where retainer.id = target_retainer_id
      and (select private.can_access_organization(retainer.organization_id))
      and (select private.has_organization_role(
        retainer.organization_id, array['admin', 'manager', 'member']::text[]
      ))
  ), periods as (
    select period.*,
      coalesce(sum(entry.minutes) filter (where entry.billable), 0)::bigint as used_minutes,
      coalesce(sum(entry.billable_amount_cents) filter (where entry.billable), 0)::bigint
        as used_value_cents
    from public.retainer_periods as period
    join allowed on allowed.id = period.retainer_id
    left join public.time_entries as entry on entry.retainer_period_id = period.id
      and entry.status in ('approved', 'invoiced')
    where from_period_start is null or period.period_start >= from_period_start
    group by period.id
    order by period.period_start desc, period.id desc
    limit greatest(1, least(coalesce(requested_limit, 24), 60))
  )
  select case when not exists (select 1 from allowed) then null
  else jsonb_build_object(
    'retainer', (select to_jsonb(allowed.*) from allowed),
    'periods', coalesce((
      select jsonb_agg(
        to_jsonb(periods.*) || jsonb_build_object(
          'available_minutes', periods.included_minutes + periods.rollover_minutes,
          'remaining_minutes', greatest(
            periods.included_minutes + periods.rollover_minutes - periods.used_minutes, 0
          ),
          'overage_minutes', greatest(
            periods.used_minutes - periods.included_minutes - periods.rollover_minutes, 0
          )
        )
        order by periods.period_start desc, periods.id desc
      ) from periods
    ), '[]'::jsonb)
  ) end;
$$;

create or replace function public.get_retainer_burn_report(
  target_retainer_id uuid,
  from_period_start date default null,
  requested_limit integer default 24
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_retainer_burn_report(
    target_retainer_id, from_period_start, requested_limit
  );
$$;

create or replace function private.get_retainers_overview(
  requested_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with organization as (
    select private.current_organization_id() as id
    where private.has_organization_role(
      private.current_organization_id(),
      array['admin', 'manager', 'member']::text[]
    )
  ), page as (
    select
      retainer.*,
      client.name as client_name,
      period.id as current_period_id,
      period.period_start,
      period.period_end,
      period.included_minutes as period_included_minutes,
      period.rollover_minutes,
      period.fee_cents as period_fee_cents,
      coalesce(usage.used_minutes, 0)::bigint as used_minutes
    from public.retainers as retainer
    join organization on organization.id = retainer.organization_id
    join public.clients as client on client.id = retainer.client_id
    left join lateral (
      select item.*
      from public.retainer_periods as item
      where item.retainer_id = retainer.id
        and item.status <> 'cancelled'
      order by
        (current_date between item.period_start and item.period_end) desc,
        item.period_start desc,
        item.id desc
      limit 1
    ) as period on true
    left join lateral (
      select coalesce(sum(entry.minutes) filter (where entry.billable), 0) as used_minutes
      from public.time_entries as entry
      where entry.retainer_period_id = period.id
        and entry.status in ('approved', 'invoiced')
    ) as usage on true
    order by retainer.updated_at desc, retainer.id
    limit greatest(1, least(coalesce(requested_limit, 200), 500))
  )
  select coalesce(jsonb_agg(to_jsonb(page.*)
    order by page.updated_at desc, page.id), '[]'::jsonb)
  from page;
$$;

create or replace function public.get_retainers_overview(
  requested_limit integer default 200
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_retainers_overview(requested_limit); $$;

create or replace function public.get_accounts_receivable_report(
  as_of_date date default current_date,
  requested_limit integer default 200
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with organization as (
    select private.current_organization_id() as id
    where private.has_organization_role(
      private.current_organization_id(),
      array['admin', 'manager', 'member']::text[]
    )
  ), open_invoices as (
    select invoice.*, client.name as client_name,
      greatest(as_of_date - invoice.due_date, 0) as days_overdue
    from public.invoices as invoice
    join public.clients as client on client.id = invoice.client_id
    join organization on organization.id = invoice.organization_id
    where invoice.status in ('issued', 'partially_paid', 'overdue')
      and invoice.balance_cents > 0
    order by invoice.due_date, invoice.id
    limit greatest(1, least(coalesce(requested_limit, 200), 500))
  )
  select jsonb_build_object(
    'as_of_date', as_of_date,
    'summary', jsonb_build_object(
      'open_cents', coalesce(sum(balance_cents), 0),
      'current_cents', coalesce(sum(balance_cents) filter (where days_overdue = 0), 0),
      'days_1_30_cents', coalesce(sum(balance_cents) filter (where days_overdue between 1 and 30), 0),
      'days_31_60_cents', coalesce(sum(balance_cents) filter (where days_overdue between 31 and 60), 0),
      'days_61_90_cents', coalesce(sum(balance_cents) filter (where days_overdue between 61 and 90), 0),
      'days_90_plus_cents', coalesce(sum(balance_cents) filter (where days_overdue > 90), 0)
    ),
    'invoices', coalesce(jsonb_agg(to_jsonb(open_invoices.*)
      order by due_date, id), '[]'::jsonb)
  )
  from open_invoices;
$$;

create or replace function private.get_commercial_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with organization as (
    select private.current_organization_id() as id
  ), current_periods as (
    select period.id, period.included_minutes + period.rollover_minutes as allowance
    from public.retainer_periods as period
    join organization on organization.id = period.organization_id
    where current_date between period.period_start and period.period_end
      and period.status <> 'cancelled'
  ), tracked_time as (
    select entry.*
    from public.time_entries as entry
    join organization on organization.id = entry.organization_id
    where entry.status in ('approved', 'invoiced')
  ), retainer_usage as (
    select
      coalesce(sum(period.allowance), 0)::bigint as allowance_minutes,
      coalesce(sum(entry.minutes), 0)::bigint as used_minutes
    from current_periods as period
    left join tracked_time as entry on entry.retainer_period_id = period.id
      and entry.billable
  ), economics as (
    select
      coalesce(sum(entry.billable_amount_cents)
        filter (where entry.status = 'approved' and entry.billable), 0)::bigint
        as unbilled_cents,
      coalesce(sum(
        ((entry.minutes::bigint * coalesce(entry.cost_rate_cents, 0)) + 30) / 60
      ), 0)::bigint as labor_cost_cents,
      coalesce(sum(entry.billable_amount_cents), 0)::bigint as labor_value_cents
    from tracked_time as entry
  )
  select jsonb_build_object(
    'active_clients', (
      select count(*) from public.clients as client
      join organization on organization.id = client.organization_id
      where client.status = 'active'
    ),
    'active_retainers', (
      select count(*) from public.retainers as retainer
      join organization on organization.id = retainer.organization_id
      where retainer.status = 'active'
    ),
    'retainer_allowance_minutes', (select allowance_minutes from retainer_usage),
    'retainer_used_minutes', (select used_minutes from retainer_usage),
    'unbilled_cents', (select unbilled_cents from economics),
    'outstanding_cents', (
      select coalesce(sum(invoice.balance_cents), 0)::bigint
      from public.invoices as invoice
      join organization on organization.id = invoice.organization_id
      where invoice.status in ('issued', 'partially_paid', 'overdue')
    ),
    'cash_collected_month_cents', (
      select coalesce(sum(payment.amount_cents), 0)::bigint
      from public.payments as payment
      join organization on organization.id = payment.organization_id
      where payment.payment_date >= date_trunc('month', current_date)::date
        and payment.status not in ('refunded', 'void')
    ),
    'gross_margin_percent', case
      when private.has_organization_role(
        (select id from organization), array['admin', 'manager']::text[]
      ) and (select labor_value_cents from economics) > 0
      then round(
        (
          ((select labor_value_cents from economics)
            - (select labor_cost_cents from economics))::numeric
          / (select labor_value_cents from economics)
        ) * 100
      )
      else null
    end
  );
$$;

create or replace function public.get_commercial_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_commercial_snapshot(); $$;

create or replace function private.get_project_commercial_summary(
  target_project_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with project as (
    select item.* from public.projects as item
    where item.id = target_project_id
      and private.can_access_project(item.id)
      and private.has_organization_role(
        item.organization_id, array['admin', 'manager', 'member']::text[]
      )
  ), tracked_time as (
    select entry.* from public.time_entries as entry
    join project on project.id = entry.project_id
    where entry.status <> 'rejected'
  ), billed as (
    select coalesce(sum(line.amount_cents), 0)::bigint as cents
    from public.invoice_line_items as line
    join public.invoices as invoice on invoice.id = line.invoice_id
    join project on project.id = line.project_id
    where invoice.status <> 'void'
  )
  select case when not exists (select 1 from project) then null
  else jsonb_build_object(
    'logged_minutes', (select coalesce(sum(minutes), 0) from tracked_time),
    'unbilled_cents', (
      select coalesce(sum(billable_amount_cents), 0)
      from tracked_time where status = 'approved' and billable
    ),
    'billed_cents', (select cents from billed),
    'gross_margin_percent', case
      when private.has_organization_role(
        (select organization_id from project), array['admin', 'manager']::text[]
      ) and (select cents from billed) > 0
      then round(
        (
          (select cents from billed) - (
            select coalesce(sum(
              ((minutes::bigint * coalesce(cost_rate_cents, 0)) + 30) / 60
            ), 0)
            from tracked_time
          )
        )::numeric / (select cents from billed) * 100
      )
      else null
    end
  ) end;
$$;

create or replace function public.get_project_commercial_summary(
  target_project_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_project_commercial_summary(target_project_id); $$;

revoke all on function private.log_time_entry(
  uuid, date, integer, text, boolean, uuid, uuid, uuid, text
) from public;
revoke all on function private.approve_time_entries(uuid[]) from public;
revoke all on function private.create_invoice_from_time_entries(
  uuid, uuid, text, date, date, uuid[], bigint
) from public;
revoke all on function private.create_manual_invoice(
  uuid, uuid, text, date, date, character, jsonb, bigint, text
) from public;
revoke all on function private.issue_invoice(uuid) from public;
revoke all on function private.record_client_payment(
  uuid, uuid, bigint, date, text, text, text
) from public;
revoke all on function private.get_commercial_snapshot() from public;
revoke all on function private.get_project_commercial_summary(uuid) from public;
revoke all on function private.get_client_operations(
  uuid, integer, integer, integer
) from public;
revoke all on function private.get_retainer_burn_report(
  uuid, date, integer
) from public;
revoke all on function private.get_retainers_overview(integer) from public;

grant execute on function private.log_time_entry(
  uuid, date, integer, text, boolean, uuid, uuid, uuid, text
) to authenticated, service_role;
grant execute on function private.approve_time_entries(uuid[])
  to authenticated, service_role;
grant execute on function private.create_invoice_from_time_entries(
  uuid, uuid, text, date, date, uuid[], bigint
) to authenticated, service_role;
grant execute on function private.create_manual_invoice(
  uuid, uuid, text, date, date, character, jsonb, bigint, text
) to authenticated, service_role;
grant execute on function private.issue_invoice(uuid)
  to authenticated, service_role;
grant execute on function private.record_client_payment(
  uuid, uuid, bigint, date, text, text, text
) to authenticated, service_role;
grant execute on function private.get_commercial_snapshot()
  to authenticated, service_role;
grant execute on function private.get_project_commercial_summary(uuid)
  to authenticated, service_role;
grant execute on function private.get_client_operations(
  uuid, integer, integer, integer
) to authenticated, service_role;
grant execute on function private.get_retainer_burn_report(
  uuid, date, integer
) to authenticated, service_role;
grant execute on function private.get_retainers_overview(integer)
  to authenticated, service_role;

revoke all on function public.log_time_entry(
  uuid, date, integer, text, boolean, uuid, uuid, uuid, text
) from public, anon;
revoke all on function public.approve_time_entries(uuid[]) from public, anon;
revoke all on function public.create_invoice_from_time_entries(
  uuid, uuid, text, date, date, uuid[], bigint
) from public, anon;
revoke all on function public.create_manual_invoice(
  uuid, uuid, text, date, date, character, jsonb, bigint, text
) from public, anon;
revoke all on function public.issue_invoice(uuid) from public, anon;
revoke all on function public.record_client_payment(
  uuid, uuid, bigint, date, text, text, text
) from public, anon;
revoke all on function public.get_agency_clients(
  text, uuid, integer, text[], text
) from public, anon;
revoke all on function public.get_client_operations(
  uuid, integer, integer, integer
) from public, anon;
revoke all on function public.get_retainer_burn_report(
  uuid, date, integer
) from public, anon;
revoke all on function public.get_accounts_receivable_report(
  date, integer
) from public, anon;
revoke all on function public.get_commercial_snapshot() from public, anon;
revoke all on function public.get_project_commercial_summary(uuid)
  from public, anon;
revoke all on function public.get_retainers_overview(integer)
  from public, anon;

grant execute on function public.log_time_entry(
  uuid, date, integer, text, boolean, uuid, uuid, uuid, text
) to authenticated, service_role;
grant execute on function public.approve_time_entries(uuid[])
  to authenticated, service_role;
grant execute on function public.create_invoice_from_time_entries(
  uuid, uuid, text, date, date, uuid[], bigint
) to authenticated, service_role;
grant execute on function public.create_manual_invoice(
  uuid, uuid, text, date, date, character, jsonb, bigint, text
) to authenticated, service_role;
grant execute on function public.issue_invoice(uuid)
  to authenticated, service_role;
grant execute on function public.record_client_payment(
  uuid, uuid, bigint, date, text, text, text
) to authenticated, service_role;
grant execute on function public.get_agency_clients(
  text, uuid, integer, text[], text
) to authenticated, service_role;
grant execute on function public.get_client_operations(
  uuid, integer, integer, integer
) to authenticated, service_role;
grant execute on function public.get_retainer_burn_report(
  uuid, date, integer
) to authenticated, service_role;
grant execute on function public.get_accounts_receivable_report(
  date, integer
) to authenticated, service_role;
grant execute on function public.get_commercial_snapshot()
  to authenticated, service_role;
grant execute on function public.get_project_commercial_summary(uuid)
  to authenticated, service_role;
grant execute on function public.get_retainers_overview(integer)
  to authenticated, service_role;
