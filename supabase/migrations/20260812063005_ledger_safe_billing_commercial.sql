-- Ledger-safe billing, delivery, collections, communications capture, and SQL reports.

create table public.finance_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action_type text not null
    check (char_length(btrim(action_type)) between 3 and 64),
  entity_type text not null
    check (char_length(btrim(entity_type)) between 3 and 64),
  entity_id uuid not null,
  before_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(after_state) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key)
);

create index finance_audit_events_entity_idx
  on public.finance_audit_events (
    organization_id, entity_type, entity_id, created_at desc
  );

create table public.invoice_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  recipient_email text not null
    check (recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  delivery_method text not null default 'email'
    check (delivery_method in ('email', 'portal', 'manual')),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'cancelled')),
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  sent_at timestamptz,
  failure_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, invoice_id)
    references public.invoices(organization_id, id) on delete cascade,
  constraint invoice_deliveries_status_timestamps check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index invoice_deliveries_outbox_idx
  on public.invoice_deliveries (organization_id, status, next_retry_at, id)
  where status in ('queued', 'failed');

create table public.invoice_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('queued', 'sent', 'failed')),
  provider text,
  provider_message_id text,
  response jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response) = 'object'),
  error_message text,
  attempted_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (delivery_id, attempt_number),
  foreign key (organization_id, delivery_id)
    references public.invoice_deliveries(organization_id, id) on delete cascade
);

create table public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  invoice_id uuid not null,
  adjustment_type text not null
    check (adjustment_type in ('credit_note', 'write_off', 'refund_reversal')),
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, invoice_id)
    references public.invoices(organization_id, id) on delete restrict
);

create index invoice_adjustments_invoice_idx
  on public.invoice_adjustments (invoice_id, created_at desc);

create table public.communication_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  project_id uuid,
  contact_id uuid,
  source_provider text not null default 'internal'
    check (source_provider in ('internal', 'resend', 'google', 'microsoft')),
  source_thread_id text,
  subject text not null check (char_length(btrim(subject)) between 1 and 500),
  direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound')),
  last_message_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_provider, source_thread_id)
);

create index communication_threads_client_idx
  on public.communication_threads (client_id, last_message_at desc)
  where client_id is not null;

create table public.communication_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  participant_role text not null
    check (participant_role in ('from', 'to', 'cc', 'bcc')),
  email text,
  contact_id uuid,
  profile_id uuid,
  display_name text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, thread_id)
    references public.communication_threads(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete set null,
  foreign key (organization_id, profile_id)
    references public.profiles(organization_id, id) on delete set null,
  constraint communication_participants_identity check (
    email is not null or contact_id is not null or profile_id is not null
  )
);

create index communication_participants_thread_idx
  on public.communication_participants (thread_id, participant_role);

create table public.communication_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  storage_path text,
  source_attachment_id text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, thread_id)
    references public.communication_threads(organization_id, id) on delete cascade
);

create table public.communication_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('resend', 'google', 'microsoft')),
  event_id text not null check (char_length(btrim(event_id)) between 1 and 200),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, event_id)
);

alter table public.invoices
  add column if not exists last_collection_reminder_at timestamptz,
  add column if not exists collection_promise_notes text;

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
  if target_invoice.status <> 'draft'
    and coalesce(current_setting('p11.finance_adjustment', true), '') <> '1'
    and coalesce(new.external_id, '') !~ '^(credit-note:|write-off:|accelo:)'
  then
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

create or replace function private.protect_invoice_derived_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.subtotal_cents := 0;
    new.tax_cents := 0;
    new.paid_cents := 0;
    return new;
  end if;
  if (
    new.subtotal_cents,
    new.tax_cents,
    new.paid_cents
  ) is distinct from (
    old.subtotal_cents,
    old.tax_cents,
    old.paid_cents
  ) and pg_trigger_depth() < 2 then
    raise exception using
      errcode = '428C9',
      message = 'Invoice subtotal, tax, and paid amounts are ledger-derived.';
  end if;
  return new;
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
  return result;
end;
$$;

create or replace function private.sync_accelo_invoice_lines(
  target_organization_id uuid,
  target_invoice_id uuid,
  target_project_id uuid,
  target_payload jsonb,
  target_raw_payload jsonb,
  target_source_record_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
  line_position integer := 0;
  source_lines jsonb;
  line_description text;
  line_quantity numeric(12,4);
  line_unit_cents bigint;
  line_amount_cents bigint;
  line_tax_cents bigint;
  line_external_id text;
  expected_subtotal bigint;
  expected_tax bigint;
  actual_subtotal bigint;
  actual_tax bigint;
  balancing_amount bigint;
begin
  source_lines := coalesce(
    target_payload -> 'line_items',
    target_raw_payload -> 'items',
    target_raw_payload -> 'line_items',
    '[]'::jsonb
  );
  if jsonb_typeof(source_lines) <> 'array' then
    source_lines := '[]'::jsonb;
  end if;

  for line in
    select value from jsonb_array_elements(source_lines)
    where jsonb_typeof(value) = 'object'
  loop
    line_description := coalesce(
      nullif(btrim(line ->> 'description'), ''),
      nullif(btrim(line ->> 'title'), ''),
      'Imported line item'
    );
    line_quantity := greatest(
      coalesce((line ->> 'quantity')::numeric, 1),
      0.0001
    );
    line_unit_cents := coalesce(
      (line ->> 'unit_amount_cents')::bigint,
      round(coalesce((line ->> 'unit_price')::numeric, 0) * 100)::bigint,
      round(coalesce((line ->> 'amount')::numeric, 0) * 100)::bigint
    );
    line_amount_cents := coalesce(
      (line ->> 'amount_cents')::bigint,
      round(line_quantity * line_unit_cents)::bigint
    );
    line_tax_cents := coalesce((line ->> 'tax_cents')::bigint, 0);
    line_external_id := coalesce(
      nullif(line ->> 'external_id', ''),
      nullif(line ->> 'id', ''),
      'accelo-line:' || target_source_record_id || ':' || line_position
    );
    insert into public.invoice_line_items (
      organization_id, invoice_id, project_id, item_type, description,
      quantity, unit_amount_cents, amount_cents, tax_cents, position,
      external_id, source_payload
    )
    values (
      target_organization_id, target_invoice_id, target_project_id,
      coalesce(nullif(line ->> 'item_type', ''), 'service'),
      line_description, line_quantity, line_unit_cents, line_amount_cents,
      line_tax_cents, line_position, line_external_id, line
    )
    on conflict (invoice_id, external_id)
      where external_id is not null
    do update set
      description = excluded.description,
      quantity = excluded.quantity,
      unit_amount_cents = excluded.unit_amount_cents,
      amount_cents = excluded.amount_cents,
      tax_cents = excluded.tax_cents,
      position = excluded.position,
      source_payload = excluded.source_payload,
      updated_at = statement_timestamp();
    line_position := line_position + 1;
  end loop;

  expected_subtotal := greatest(
    coalesce((target_payload ->> 'amount_cents')::bigint, 0)
      - coalesce((target_payload ->> 'tax_cents')::bigint, 0),
    0
  );
  expected_tax := coalesce((target_payload ->> 'tax_cents')::bigint, 0);

  select
    coalesce(sum(line.amount_cents), 0)::bigint,
    coalesce(sum(line.tax_cents), 0)::bigint
  into actual_subtotal, actual_tax
  from public.invoice_line_items as line
  where line.invoice_id = target_invoice_id;

  balancing_amount := expected_subtotal - actual_subtotal;
  if balancing_amount <> 0 or (line_position = 0 and expected_subtotal <> 0) then
    insert into public.invoice_line_items (
      organization_id, invoice_id, project_id, item_type, description,
      quantity, unit_amount_cents, amount_cents, tax_cents, position,
      external_id, source_payload
    )
    values (
      target_organization_id, target_invoice_id, target_project_id, 'service',
      'Accelo source summary balancing line',
      1, balancing_amount, balancing_amount,
      greatest(expected_tax - actual_tax, 0),
      line_position,
      'accelo:source-summary:' || target_source_record_id,
      jsonb_build_object(
        'kind', 'source_summary_balancing_line',
        'expected_subtotal_cents', expected_subtotal,
        'expected_tax_cents', expected_tax,
        'actual_subtotal_cents', actual_subtotal,
        'actual_tax_cents', actual_tax
      )
    )
    on conflict (invoice_id, external_id)
      where external_id is not null
    do update set
      amount_cents = excluded.amount_cents,
      unit_amount_cents = excluded.unit_amount_cents,
      tax_cents = excluded.tax_cents,
      source_payload = excluded.source_payload,
      updated_at = statement_timestamp();
  elsif line_position = 0 and expected_subtotal = 0 and expected_tax = 0 then
    insert into public.invoice_line_items (
      organization_id, invoice_id, project_id, item_type, description,
      quantity, unit_amount_cents, amount_cents, tax_cents, position,
      external_id, source_payload
    )
    values (
      target_organization_id, target_invoice_id, target_project_id, 'service',
      'Accelo source summary balancing line',
      1, 0, 0, 0, 0,
      'accelo:source-summary:' || target_source_record_id,
      jsonb_build_object('kind', 'source_summary_balancing_line', 'zero_total', true)
    )
    on conflict (invoice_id, external_id)
      where external_id is not null
    do nothing;
  end if;
end;
$$;

create or replace function private.promote_accelo_invoice_stage(
  run public.accelo_pull_runs,
  stage public.accelo_pull_stage,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination_id uuid;
  client_id uuid;
  project_id uuid;
  retainer_id uuid;
  target_status text;
  source_paid_cents bigint;
  outstanding_cents bigint;
  summary_payment_id uuid;
begin
  project_id := null;
  client_id := null;
  if payload ->> 'against_type' = 'job' then
    project_id := private.accelo_destination_uuid(
      run.organization_id, run.source_account_id, 'jobs',
      payload ->> 'against_source_id', 'projects'
    );
    select item.client_id into client_id
    from public.projects as item where item.id = project_id;
  elsif payload ->> 'against_type' = 'contract' then
    retainer_id := private.accelo_destination_uuid(
      run.organization_id, run.source_account_id, 'contracts',
      payload ->> 'against_source_id', 'retainers'
    );
    select item.client_id into client_id
    from public.retainers as item where item.id = retainer_id;
  elsif payload ->> 'against_type' = 'company' then
    client_id := private.accelo_destination_uuid(
      run.organization_id, run.source_account_id, 'companies',
      payload ->> 'against_source_id', 'clients'
    );
  elsif payload ->> 'against_type' = 'issue' then
    destination_id := private.accelo_destination_uuid(
      run.organization_id, run.source_account_id, 'issues',
      payload ->> 'against_source_id', 'todos'
    );
    select item.project_id, project.client_id
      into project_id, client_id
    from public.todos as item
    join public.projects as project on project.id = item.project_id
    where item.id = destination_id;
  end if;
  if client_id is null then
    raise foreign_key_violation using message = 'invoice_client_missing';
  end if;

  outstanding_cents := coalesce((payload ->> 'outstanding_cents')::bigint, 0);
  source_paid_cents := greatest(
    coalesce((payload ->> 'amount_cents')::bigint, 0) - outstanding_cents,
    0
  );
  target_status := case
    when outstanding_cents = 0
      and coalesce((payload ->> 'amount_cents')::bigint, 0) > 0 then 'paid'
    when source_paid_cents > 0 then 'partially_paid'
    else 'issued'
  end;

  insert into public.invoices (
    organization_id, client_id, project_id, invoice_number, subject,
    status, issue_date, issued_at, due_date, currency, notes,
    external_id, delivery_method, source_updated_at, source_payload
  )
  values (
    run.organization_id, client_id, project_id,
    left(payload ->> 'invoice_number', 64),
    coalesce(payload ->> 'subject', 'Professional services'),
    'draft',
    coalesce(nullif(payload ->> 'issue_date', '')::date, current_date),
    null,
    coalesce(
      nullif(payload ->> 'due_date', '')::date,
      coalesce(nullif(payload ->> 'issue_date', '')::date, current_date) + 30
    ),
    coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
    nullif(payload ->> 'notes', ''),
    stage.source_record_id, 'import', stage.source_updated_at, stage.raw_payload
  )
  on conflict (organization_id, external_id)
    where external_id is not null
  do update set
    client_id = excluded.client_id,
    project_id = excluded.project_id,
    invoice_number = excluded.invoice_number,
    subject = excluded.subject,
    issue_date = excluded.issue_date,
    due_date = excluded.due_date,
    notes = excluded.notes,
    source_updated_at = excluded.source_updated_at,
    source_payload = excluded.source_payload,
    updated_at = statement_timestamp()
  returning id into destination_id;

  perform private.sync_accelo_invoice_lines(
    run.organization_id, destination_id, project_id, payload,
    stage.raw_payload, stage.source_record_id
  );

  update public.invoices as invoice
  set
    status = target_status,
    issued_at = coalesce(
      nullif(payload ->> 'issue_date', '')::date,
      current_date
    )::timestamptz,
    updated_at = statement_timestamp()
  where invoice.id = destination_id;

  if source_paid_cents > 0 and not exists (
    select 1 from public.payment_allocations as allocation
    where allocation.invoice_id = destination_id
  ) then
    insert into public.payments (
      organization_id, client_id, amount_cents, currency, payment_date,
      method, reference, status, idempotency_key, external_id,
      source_updated_at, source_payload
    )
    values (
      run.organization_id, client_id, source_paid_cents,
      coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
      coalesce(nullif(payload ->> 'issue_date', '')::date, current_date),
      'other', 'accelo:invoice-paid-summary', 'received',
      'accelo:invoice-paid:' || run.source_account_id || ':' || stage.source_record_id,
      'accelo:invoice-paid:' || stage.source_record_id,
      stage.source_updated_at, payload
    )
    on conflict (organization_id, external_id)
      where external_id is not null
    do update set
      amount_cents = excluded.amount_cents,
      source_updated_at = excluded.source_updated_at
    returning id into summary_payment_id;

    insert into public.payment_allocations (
      organization_id, client_id, payment_id, invoice_id, amount_cents
    )
    select
      run.organization_id, client_id, payment.id,
      (select invoice.id from public.invoices as invoice
        where invoice.organization_id = run.organization_id
          and invoice.external_id = stage.source_record_id),
      least(source_paid_cents, invoice.total_cents)
    from public.payments as payment
    join public.invoices as invoice
      on invoice.organization_id = run.organization_id
      and invoice.external_id = stage.source_record_id
    where payment.organization_id = run.organization_id
      and payment.external_id = 'accelo:invoice-paid:' || stage.source_record_id
    on conflict (payment_id, invoice_id) do update set
      amount_cents = excluded.amount_cents;
  end if;

  select invoice.id into destination_id
  from public.invoices as invoice
  where invoice.organization_id = run.organization_id
    and invoice.external_id = stage.source_record_id;
  return destination_id;
end;
$$;

create or replace function private.allocate_payment_multi(
  target_client_id uuid,
  target_payment_date date,
  target_method text,
  target_reference text,
  target_idempotency_key text,
  target_currency char(3),
  target_allocations jsonb
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := (select private.current_organization_id());
  allocation jsonb;
  invoice_ids uuid[] := '{}'::uuid[];
  invoice_id uuid;
  amount_cents bigint;
  total_allocated bigint := 0;
  result public.payments%rowtype;
  before_state jsonb;
  after_state jsonb;
begin
  if jsonb_typeof(target_allocations) <> 'array'
    or jsonb_array_length(target_allocations) not between 1 and 50
    or not (select private.has_organization_role(
      target_organization_id, array['admin', 'manager']::text[]
    ))
  then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('finance:allocate:' || target_organization_id::text)
  );

  for allocation in select value from jsonb_array_elements(target_allocations)
  loop
    invoice_id := (allocation ->> 'invoice_id')::uuid;
    amount_cents := (allocation ->> 'amount_cents')::bigint;
    if invoice_id is null or amount_cents <= 0 then
      raise check_violation using message = 'Invalid payment allocation payload.';
    end if;
    invoice_ids := array_append(invoice_ids, invoice_id);
    total_allocated := total_allocated + amount_cents;
  end loop;

  if cardinality(invoice_ids) <> (
    select count(distinct candidate.invoice_id)
    from unnest(invoice_ids) as candidate(invoice_id)
  ) then
    raise check_violation using message = 'Duplicate invoice allocations are not allowed.';
  end if;

  if exists (
    select 1 from public.invoices as invoice
    where invoice.id = any(invoice_ids)
      and (
        invoice.organization_id <> target_organization_id
        or invoice.client_id <> target_client_id
        or invoice.currency <> target_currency
        or invoice.status in ('draft', 'void', 'paid')
      )
  ) then
    raise check_violation using message = 'Allocations target invalid invoices.';
  end if;

  if exists (
    select 1
    from public.invoices as invoice
    join unnest(invoice_ids) with ordinality as requested(invoice_id, position)
      on requested.invoice_id = invoice.id
    join lateral (
      select coalesce(sum(allocation.amount_cents), 0)::bigint as allocated
      from public.payment_allocations as allocation
      where allocation.invoice_id = invoice.id
    ) as existing on true
    join jsonb_array_elements(target_allocations) as payload(value)
      on (payload.value ->> 'invoice_id')::uuid = invoice.id
    where (payload.value ->> 'amount_cents')::bigint
      > invoice.balance_cents
  ) then
    raise check_violation using message = 'An allocation exceeds invoice balance.';
  end if;

  insert into public.payments (
    organization_id, client_id, amount_cents, currency, payment_date,
    method, reference, idempotency_key, received_by
  )
  values (
    target_organization_id, target_client_id, total_allocated, target_currency,
    target_payment_date, target_method, nullif(btrim(target_reference), ''),
    btrim(target_idempotency_key), (select auth.uid())
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into result;
  if result.id is null then
    select payment.* into result from public.payments as payment
    where payment.organization_id = target_organization_id
      and payment.idempotency_key = btrim(target_idempotency_key);
    return result;
  end if;

  for allocation in select value from jsonb_array_elements(target_allocations)
  loop
    insert into public.payment_allocations (
      organization_id, client_id, payment_id, invoice_id, amount_cents, allocated_by
    )
    values (
      target_organization_id, target_client_id, result.id,
      (allocation ->> 'invoice_id')::uuid,
      (allocation ->> 'amount_cents')::bigint,
      (select auth.uid())
    );
  end loop;

  before_state := jsonb_build_object('payment', null);
  after_state := jsonb_build_object(
    'payment_id', result.id,
    'allocations', target_allocations
  );
  perform private.record_finance_audit(
    target_organization_id, 'payment_allocate_multi', 'payment', result.id,
    before_state, after_state, '{}'::jsonb,
    'audit:payment_allocate:' || btrim(target_idempotency_key)
  );
  return result;
end;
$$;

create or replace function public.allocate_payment_multi(
  target_client_id uuid,
  target_payment_date date,
  target_method text,
  target_reference text,
  target_idempotency_key text,
  target_currency char(3),
  target_allocations jsonb
)
returns public.payments
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.allocate_payment_multi(
    target_client_id, target_payment_date, target_method, target_reference,
    target_idempotency_key, target_currency, target_allocations
  );
$$;

create or replace function private.correct_payment_allocation(
  target_allocation_id uuid,
  target_amount_cents bigint,
  target_idempotency_key text
)
returns public.payment_allocations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.payment_allocations%rowtype;
  target_payment public.payments%rowtype;
  target_invoice public.invoices%rowtype;
  before_state jsonb;
begin
  select allocation.* into target
  from public.payment_allocations as allocation
  where allocation.id = target_allocation_id
  for update;
  if target.id is null or not (select private.has_organization_role(
    target.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  perform pg_advisory_xact_lock(
    hashtext('finance:allocation:' || target.payment_id::text)
  );
  select payment.* into target_payment
  from public.payments as payment where payment.id = target.payment_id for update;
  select invoice.* into target_invoice
  from public.invoices as invoice where invoice.id = target.invoice_id for update;
  if target_amount_cents <= 0
    or target_amount_cents > target_invoice.balance_cents + target.amount_cents
    or (
      select coalesce(sum(allocation.amount_cents), 0)::bigint
      from public.payment_allocations as allocation
      where allocation.payment_id = target.payment_id
        and allocation.id <> target.id
    ) + target_amount_cents > target_payment.amount_cents
  then
    raise check_violation using message = 'Corrected allocation exceeds available balance.';
  end if;
  before_state := to_jsonb(target);
  update public.payment_allocations
  set amount_cents = target_amount_cents
  where id = target.id
  returning * into target;
  perform private.record_finance_audit(
    target.organization_id, 'payment_allocation_correct', 'payment_allocation',
    target.id, before_state, to_jsonb(target), '{}'::jsonb,
    nullif(btrim(target_idempotency_key), '')
  );
  return target;
end;
$$;

create or replace function public.correct_payment_allocation(
  target_allocation_id uuid,
  target_amount_cents bigint,
  target_idempotency_key text
)
returns public.payment_allocations
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.correct_payment_allocation(
    target_allocation_id, target_amount_cents, target_idempotency_key
  );
$$;

create or replace function private.unallocate_payment(
  target_allocation_id uuid,
  target_idempotency_key text
)
returns public.payment_allocations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.payment_allocations%rowtype;
  before_state jsonb;
begin
  select allocation.* into target
  from public.payment_allocations as allocation
  where allocation.id = target_allocation_id
  for update;
  if target.id is null or not (select private.has_organization_role(
    target.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  perform pg_advisory_xact_lock(
    hashtext('finance:allocation:' || target.payment_id::text)
  );
  before_state := to_jsonb(target);
  delete from public.payment_allocations where id = target.id;
  perform private.record_finance_audit(
    target.organization_id, 'payment_unallocate', 'payment_allocation',
    target.id, before_state, '{}'::jsonb, '{}'::jsonb,
    nullif(btrim(target_idempotency_key), '')
  );
  return target;
end;
$$;

create or replace function public.unallocate_payment(
  target_allocation_id uuid,
  target_idempotency_key text
)
returns public.payment_allocations
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.unallocate_payment(target_allocation_id, target_idempotency_key);
$$;

create or replace function private.void_invoice(
  target_invoice_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.invoices%rowtype;
  before_state jsonb;
begin
  select invoice.* into result
  from public.invoices as invoice
  where invoice.id = target_invoice_id
  for update;
  if result.id is null or not (select private.has_organization_role(
    result.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  if result.status = 'void' then
    return result;
  end if;
  if char_length(btrim(coalesce(target_reason, ''))) not between 3 and 1000 then
    raise check_violation using message = 'Void reason is required.';
  end if;
  perform pg_advisory_xact_lock(
    hashtext('finance:invoice:' || target_invoice_id::text)
  );
  before_state := to_jsonb(result);
  delete from public.payment_allocations
  where invoice_id = target_invoice_id;
  update public.invoices
  set status = 'void', voided_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = target_invoice_id
  returning * into result;
  perform private.record_finance_audit(
    result.organization_id, 'invoice_void', 'invoice', result.id,
    before_state, to_jsonb(result),
    jsonb_build_object('reason', btrim(target_reason)),
    nullif(btrim(target_idempotency_key), '')
  );
  return result;
end;
$$;

create or replace function public.void_invoice(
  target_invoice_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns public.invoices
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.void_invoice(
    target_invoice_id, target_reason, target_idempotency_key
  );
$$;

create or replace function private.refund_payment(
  target_payment_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.payments%rowtype;
  before_state jsonb;
begin
  select payment.* into result
  from public.payments as payment
  where payment.id = target_payment_id
  for update;
  if result.id is null or not (select private.has_organization_role(
    result.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  if result.status = 'refunded' then
    return result;
  end if;
  perform pg_advisory_xact_lock(
    hashtext('finance:payment:' || target_payment_id::text)
  );
  before_state := to_jsonb(result);
  delete from public.payment_allocations where payment_id = target_payment_id;
  update public.payments
  set status = 'refunded', updated_at = statement_timestamp()
  where id = target_payment_id
  returning * into result;
  perform private.record_finance_audit(
    result.organization_id, 'payment_refund', 'payment', result.id,
    before_state, to_jsonb(result),
    jsonb_build_object('reason', btrim(target_reason)),
    nullif(btrim(target_idempotency_key), '')
  );
  return result;
end;
$$;

create or replace function public.refund_payment(
  target_payment_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns public.payments
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.refund_payment(
    target_payment_id, target_reason, target_idempotency_key
  );
$$;

create or replace function private.issue_credit_note(
  target_invoice_id uuid,
  target_amount_cents bigint,
  target_reason text,
  target_idempotency_key text
)
returns public.invoice_adjustments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_invoice public.invoices%rowtype;
  result public.invoice_adjustments%rowtype;
begin
  select invoice.* into target_invoice
  from public.invoices as invoice
  where invoice.id = target_invoice_id
  for update;
  if target_invoice.id is null or not (select private.has_organization_role(
    target_invoice.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  if target_amount_cents <= 0
    or target_amount_cents > target_invoice.balance_cents
    or char_length(btrim(target_reason)) not between 3 and 1000
  then
    raise check_violation using message = 'Invalid credit note request.';
  end if;
  perform pg_advisory_xact_lock(
    hashtext('finance:invoice:' || target_invoice_id::text)
  );
  perform set_config('p11.finance_adjustment', '1', true);
  insert into public.invoice_adjustments (
    organization_id, client_id, invoice_id, adjustment_type,
    amount_cents, currency, reason, idempotency_key, created_by
  )
  values (
    target_invoice.organization_id, target_invoice.client_id, target_invoice.id,
    'credit_note', target_amount_cents, target_invoice.currency,
    btrim(target_reason), btrim(target_idempotency_key), (select auth.uid())
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into result;
  if result.id is null then
    select adjustment.* into result
    from public.invoice_adjustments as adjustment
    where adjustment.organization_id = target_invoice.organization_id
      and adjustment.idempotency_key = btrim(target_idempotency_key);
    return result;
  end if;
  insert into public.invoice_line_items (
    organization_id, invoice_id, project_id, item_type, description,
    quantity, unit_amount_cents, amount_cents, tax_cents, position,
    external_id, source_payload
  )
  values (
    target_invoice.organization_id, target_invoice.id, target_invoice.project_id,
    'credit', 'Credit note: ' || btrim(target_reason),
    1, -target_amount_cents, -target_amount_cents, 0,
    coalesce((
      select max(line.position) + 1
      from public.invoice_line_items as line
      where line.invoice_id = target_invoice.id
    ), 0),
    'credit-note:' || result.id::text,
    jsonb_build_object('adjustment_id', result.id, 'kind', 'credit_note')
  );
  perform private.record_finance_audit(
    target_invoice.organization_id, 'credit_note_issue', 'invoice_adjustment',
    result.id, '{}'::jsonb, to_jsonb(result),
    jsonb_build_object('invoice_id', target_invoice.id),
    'audit:credit_note:' || btrim(target_idempotency_key)
  );
  return result;
end;
$$;

create or replace function public.issue_credit_note(
  target_invoice_id uuid,
  target_amount_cents bigint,
  target_reason text,
  target_idempotency_key text
)
returns public.invoice_adjustments
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.issue_credit_note(
    target_invoice_id, target_amount_cents, target_reason, target_idempotency_key
  );
$$;

create or replace function private.write_off_invoice(
  target_invoice_id uuid,
  target_amount_cents bigint,
  target_reason text,
  target_idempotency_key text
)
returns public.invoice_adjustments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_invoice public.invoices%rowtype;
  result public.invoice_adjustments%rowtype;
begin
  select invoice.* into target_invoice
  from public.invoices as invoice
  where invoice.id = target_invoice_id
  for update;
  if target_invoice.id is null or not (select private.has_organization_role(
    target_invoice.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  if target_amount_cents <= 0
    or target_amount_cents > target_invoice.balance_cents
    or char_length(btrim(target_reason)) not between 3 and 1000
  then
    raise check_violation using message = 'Invalid write-off request.';
  end if;
  perform pg_advisory_xact_lock(
    hashtext('finance:invoice:' || target_invoice_id::text)
  );
  perform set_config('p11.finance_adjustment', '1', true);
  insert into public.invoice_adjustments (
    organization_id, client_id, invoice_id, adjustment_type,
    amount_cents, currency, reason, idempotency_key, created_by
  )
  values (
    target_invoice.organization_id, target_invoice.client_id, target_invoice.id,
    'write_off', target_amount_cents, target_invoice.currency,
    btrim(target_reason), btrim(target_idempotency_key), (select auth.uid())
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into result;
  if result.id is null then
    select adjustment.* into result
    from public.invoice_adjustments as adjustment
    where adjustment.organization_id = target_invoice.organization_id
      and adjustment.idempotency_key = btrim(target_idempotency_key);
    return result;
  end if;
  insert into public.invoice_line_items (
    organization_id, invoice_id, project_id, item_type, description,
    quantity, unit_amount_cents, amount_cents, tax_cents, position,
    external_id, source_payload
  )
  values (
    target_invoice.organization_id, target_invoice.id, target_invoice.project_id,
    'credit', 'Write-off: ' || btrim(target_reason),
    1, -target_amount_cents, -target_amount_cents, 0,
    coalesce((
      select max(line.position) + 1
      from public.invoice_line_items as line
      where line.invoice_id = target_invoice.id
    ), 0),
    'write-off:' || result.id::text,
    jsonb_build_object('adjustment_id', result.id, 'kind', 'write_off')
  );
  perform private.record_finance_audit(
    target_invoice.organization_id, 'invoice_write_off', 'invoice_adjustment',
    result.id, '{}'::jsonb, to_jsonb(result),
    jsonb_build_object('invoice_id', target_invoice.id),
    'audit:write_off:' || btrim(target_idempotency_key)
  );
  return result;
end;
$$;

create or replace function public.write_off_invoice(
  target_invoice_id uuid,
  target_amount_cents bigint,
  target_reason text,
  target_idempotency_key text
)
returns public.invoice_adjustments
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.write_off_invoice(
    target_invoice_id, target_amount_cents, target_reason, target_idempotency_key
  );
$$;

create or replace function private.reconcile_settlement(
  target_payment_id uuid,
  target_allocations jsonb,
  target_idempotency_key text
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_payment public.payments%rowtype;
  allocation jsonb;
  before_state jsonb;
  after_state jsonb;
begin
  select payment.* into target_payment
  from public.payments as payment
  where payment.id = target_payment_id
  for update;
  if target_payment.id is null or not (select private.has_organization_role(
    target_payment.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  perform pg_advisory_xact_lock(
    hashtext('finance:payment:' || target_payment_id::text)
  );
  before_state := jsonb_build_object(
    'payment', to_jsonb(target_payment),
    'allocations', coalesce((
      select jsonb_agg(to_jsonb(allocation))
      from public.payment_allocations as allocation
      where allocation.payment_id = target_payment.id
    ), '[]'::jsonb)
  );
  delete from public.payment_allocations
  where payment_id = target_payment.id;
  for allocation in select value from jsonb_array_elements(target_allocations)
  loop
    insert into public.payment_allocations (
      organization_id, client_id, payment_id, invoice_id, amount_cents, allocated_by
    )
    values (
      target_payment.organization_id, target_payment.client_id, target_payment.id,
      (allocation ->> 'invoice_id')::uuid,
      (allocation ->> 'amount_cents')::bigint,
      (select auth.uid())
    );
  end loop;
  select payment.* into target_payment
  from public.payments as payment where payment.id = target_payment.id;
  after_state := jsonb_build_object(
    'payment', to_jsonb(target_payment),
    'allocations', target_allocations
  );
  perform private.record_finance_audit(
    target_payment.organization_id, 'settlement_reconcile', 'payment',
    target_payment.id, before_state, after_state, '{}'::jsonb,
    nullif(btrim(target_idempotency_key), '')
  );
  return target_payment;
end;
$$;

create or replace function public.reconcile_settlement(
  target_payment_id uuid,
  target_allocations jsonb,
  target_idempotency_key text
)
returns public.payments
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reconcile_settlement(
    target_payment_id, target_allocations, target_idempotency_key
  );
$$;

create or replace function private.queue_invoice_delivery(
  target_invoice_id uuid,
  target_recipient_email text,
  target_delivery_method text,
  target_idempotency_key text
)
returns public.invoice_deliveries
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_invoice public.invoices%rowtype;
  result public.invoice_deliveries%rowtype;
begin
  select invoice.* into target_invoice
  from public.invoices as invoice
  where invoice.id = target_invoice_id
  for update;
  if target_invoice.id is null or not (select private.has_organization_role(
    target_invoice.organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;
  if target_invoice.status in ('draft', 'void') then
    raise check_violation using message = 'Only issued invoices can be delivered.';
  end if;
  insert into public.invoice_deliveries (
    organization_id, invoice_id, recipient_email, delivery_method,
    status, idempotency_key, created_by
  )
  values (
    target_invoice.organization_id, target_invoice.id,
    lower(btrim(target_recipient_email)),
    coalesce(nullif(btrim(target_delivery_method), ''), 'email'),
    'queued', btrim(target_idempotency_key), (select auth.uid())
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into result;
  if result.id is null then
    select delivery.* into result
    from public.invoice_deliveries as delivery
    where delivery.organization_id = target_invoice.organization_id
      and delivery.idempotency_key = btrim(target_idempotency_key);
  end if;
  return result;
end;
$$;

create or replace function public.queue_invoice_delivery(
  target_invoice_id uuid,
  target_recipient_email text,
  target_delivery_method text default 'email',
  target_idempotency_key text default null
)
returns public.invoice_deliveries
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.queue_invoice_delivery(
    target_invoice_id, target_recipient_email, target_delivery_method,
    coalesce(nullif(btrim(target_idempotency_key), ''),
      'delivery:' || target_invoice_id::text || ':' || lower(btrim(target_recipient_email)))
  );
$$;

create or replace function private.mark_invoice_delivery_attempt(
  target_delivery_id uuid,
  target_status text,
  target_provider text default null,
  target_provider_message_id text default null,
  target_response jsonb default '{}'::jsonb,
  target_error_message text default null
)
returns public.invoice_delivery_attempts
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.invoice_deliveries%rowtype;
  result public.invoice_delivery_attempts%rowtype;
  next_attempt integer;
begin
  select delivery.* into target
  from public.invoice_deliveries as delivery
  where delivery.id = target_delivery_id
  for update;
  if target.id is null then
    raise no_data_found using message = 'Invoice delivery not found.';
  end if;
  next_attempt := target.attempt_count + 1;
  insert into public.invoice_delivery_attempts (
    organization_id, delivery_id, attempt_number, status, provider,
    provider_message_id, response, error_message
  )
  values (
    target.organization_id, target.id, next_attempt, target_status,
    nullif(btrim(target_provider), ''), nullif(btrim(target_provider_message_id), ''),
    coalesce(target_response, '{}'::jsonb), nullif(btrim(target_error_message), '')
  )
  returning * into result;
  update public.invoice_deliveries
  set
    status = target_status,
    attempt_count = next_attempt,
    last_attempt_at = statement_timestamp(),
    sent_at = case when target_status = 'sent' then statement_timestamp() else sent_at end,
    next_retry_at = case
      when target_status = 'failed'
        then statement_timestamp() + ((2 ^ least(next_attempt, 5)) * interval '5 minutes')
      else null
    end,
    failure_reason = case
      when target_status = 'failed' then nullif(btrim(target_error_message), '')
      else null
    end,
    updated_at = statement_timestamp()
  where id = target.id;
  if target_status = 'sent' then
    update public.invoices
    set delivered_at = statement_timestamp(), delivery_method = target.delivery_method
    where id = target.invoice_id;
  end if;
  return result;
end;
$$;

create or replace function public.mark_invoice_delivery_attempt(
  target_delivery_id uuid,
  target_status text,
  target_provider text default null,
  target_provider_message_id text default null,
  target_response jsonb default '{}'::jsonb,
  target_error_message text default null
)
returns public.invoice_delivery_attempts
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.mark_invoice_delivery_attempt(
    target_delivery_id, target_status, target_provider,
    target_provider_message_id, target_response, target_error_message
  );
$$;

create or replace function private.advance_overdue_invoices(
  target_organization_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  update public.invoices as invoice
  set status = 'overdue', updated_at = statement_timestamp()
  where invoice.status in ('issued', 'partially_paid')
    and invoice.due_date < current_date
    and invoice.balance_cents > 0
    and (target_organization_id is null or invoice.organization_id = target_organization_id);
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.advance_overdue_invoices()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$ select private.advance_overdue_invoices((select private.current_organization_id())); $$;

create or replace function private.capture_communication_message(
  target_client_id uuid,
  target_project_id uuid,
  target_contact_id uuid,
  target_subject text,
  target_body text,
  target_direction text,
  target_source_provider text,
  target_source_thread_id text,
  target_occurred_at timestamptz,
  target_participants jsonb,
  target_attachments jsonb,
  target_idempotency_key text
)
returns public.communication_threads
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := (select private.current_organization_id());
  thread public.communication_threads%rowtype;
  participant jsonb;
  attachment jsonb;
begin
  if not (select private.has_organization_role(
    target_organization_id, array['admin', 'manager', 'member']::text[]
  )) then
    raise insufficient_privilege using message = 'Organization access is required.';
  end if;
  insert into public.communication_threads (
    organization_id, client_id, project_id, contact_id, source_provider,
    source_thread_id, subject, direction, last_message_at, metadata
  )
  values (
    target_organization_id, target_client_id, target_project_id, target_contact_id,
    coalesce(nullif(btrim(target_source_provider), ''), 'internal'),
    nullif(btrim(target_source_thread_id), ''),
    btrim(target_subject), coalesce(nullif(btrim(target_direction), ''), 'inbound'),
    coalesce(target_occurred_at, statement_timestamp()),
    jsonb_build_object('idempotency_key', nullif(btrim(target_idempotency_key), ''))
  )
  on conflict (organization_id, source_provider, source_thread_id)
    where source_thread_id is not null
  do update set
    last_message_at = excluded.last_message_at,
    updated_at = statement_timestamp()
  returning * into thread;

  insert into public.client_activities (
    organization_id, client_id, project_id, contact_id, activity_type,
    subject, body, occurred_at, metadata
  )
  values (
    target_organization_id, target_client_id, target_project_id, target_contact_id,
    case when target_direction = 'outbound' then 'email' else 'email' end,
    btrim(target_subject), nullif(btrim(target_body), ''),
    coalesce(target_occurred_at, statement_timestamp()),
    jsonb_build_object(
      'communication_thread_id', thread.id,
      'direction', target_direction,
      'source_provider', target_source_provider
    )
  );

  if jsonb_typeof(target_participants) = 'array' then
    for participant in select value from jsonb_array_elements(target_participants)
    loop
      insert into public.communication_participants (
        organization_id, thread_id, participant_role, email, contact_id,
        profile_id, display_name
      )
      values (
        target_organization_id, thread.id,
        coalesce(nullif(participant ->> 'role', ''), 'to'),
        nullif(participant ->> 'email', ''),
        nullif(participant ->> 'contact_id', '')::uuid,
        nullif(participant ->> 'profile_id', '')::uuid,
        nullif(participant ->> 'display_name', '')
      );
    end loop;
  end if;

  if jsonb_typeof(target_attachments) = 'array' then
    for attachment in select value from jsonb_array_elements(target_attachments)
    loop
      insert into public.communication_attachments (
        organization_id, thread_id, file_name, content_type, byte_size,
        storage_path, source_attachment_id, metadata
      )
      values (
        target_organization_id, thread.id,
        coalesce(nullif(attachment ->> 'file_name', ''), 'attachment'),
        nullif(attachment ->> 'content_type', ''),
        nullif(attachment ->> 'byte_size', '')::bigint,
        nullif(attachment ->> 'storage_path', ''),
        nullif(attachment ->> 'source_attachment_id', ''),
        coalesce(attachment -> 'metadata', '{}'::jsonb)
      );
    end loop;
  end if;
  return thread;
end;
$$;

create or replace function public.capture_communication_message(
  target_client_id uuid,
  target_project_id uuid,
  target_contact_id uuid,
  target_subject text,
  target_body text,
  target_direction text,
  target_source_provider text,
  target_source_thread_id text,
  target_occurred_at timestamptz,
  target_participants jsonb default '[]'::jsonb,
  target_attachments jsonb default '[]'::jsonb,
  target_idempotency_key text default null
)
returns public.communication_threads
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.capture_communication_message(
    target_client_id, target_project_id, target_contact_id, target_subject,
    target_body, target_direction, target_source_provider, target_source_thread_id,
    target_occurred_at, target_participants, target_attachments, target_idempotency_key
  );
$$;

create or replace function private.ingest_communication_webhook(
  target_organization_id uuid,
  target_provider text,
  target_event_id text,
  target_payload jsonb
)
returns public.communication_webhook_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.communication_webhook_events%rowtype;
begin
  insert into public.communication_webhook_events (
    organization_id, provider, event_id, payload
  )
  values (
    target_organization_id, target_provider, btrim(target_event_id),
    coalesce(target_payload, '{}'::jsonb)
  )
  on conflict (organization_id, provider, event_id) do nothing
  returning * into result;
  if result.id is null then
    select event.* into result
    from public.communication_webhook_events as event
    where event.organization_id = target_organization_id
      and event.provider = target_provider
      and event.event_id = btrim(target_event_id);
  end if;
  return result;
end;
$$;

create or replace function public.ingest_communication_webhook(
  target_organization_id uuid,
  target_provider text,
  target_event_id text,
  target_payload jsonb
)
returns public.communication_webhook_events
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.ingest_communication_webhook(
    target_organization_id, target_provider, target_event_id, target_payload
  );
$$;

create or replace function public.get_commercial_operations_report(
  requested_days integer default 90,
  target_project_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with organization as (
    select private.current_organization_id() as id
  ), settings as (
    select greatest(7, least(coalesce(requested_days, 90), 365)) as days
  ), report_window as (
    select (current_date - ((select days from settings) - 1)) as since_date
  ), profiles as (
    select profile.*
    from public.profiles as profile
    join organization on organization.id = profile.organization_id
    where profile.status = 'active'
      and profile.role in ('admin', 'manager', 'member')
  ), time_rows as (
    select entry.*
    from public.time_entries as entry
    join organization on organization.id = entry.organization_id
    cross join report_window
    where entry.entry_date >= report_window.since_date
      and (target_project_id is null or entry.project_id = target_project_id)
  ), week_bounds as (
    select
      (current_date - ((extract(isodow from current_date)::integer - 1) || ' days')::interval)::date as week_start,
      (current_date + ((7 - extract(isodow from current_date)::integer) || ' days')::interval)::date as week_end
  ), week_time as (
    select entry.profile_id, sum(entry.minutes)::bigint as minutes
    from public.time_entries as entry
    join organization on organization.id = entry.organization_id
    cross join week_bounds
    where entry.entry_date between week_bounds.week_start and week_bounds.week_end
      and entry.status <> 'rejected'
      and (target_project_id is null or entry.project_id = target_project_id)
    group by entry.profile_id
  ), utilization as (
    select
      coalesce(sum(case when status <> 'rejected' then minutes else 0 end), 0)::bigint as logged_minutes,
      coalesce(sum(case when status <> 'rejected' and billable then minutes else 0 end), 0)::bigint as billable_minutes,
      coalesce((
        select sum(profile.weekly_capacity_minutes)::bigint
        from profiles as profile
      ), 0)::bigint * (select days from settings) / 7 as capacity_minutes
    from time_rows
  ), unapproved as (
    select
      count(*)::bigint as entries,
      coalesce(sum(minutes), 0)::bigint as minutes,
      coalesce(sum(billable_amount_cents), 0)::bigint as value_cents
    from time_rows
    where status in ('draft', 'submitted', 'rejected')
  ), job_margins as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'projectId', project.id,
        'projectName', project.name,
        'clientName', client.name,
        'loggedMinutes', coalesce((margin.summary ->> 'logged_minutes')::bigint, 0),
        'billedValue', coalesce((margin.summary ->> 'billed_cents')::bigint, 0) / 100.0,
        'unbilledValue', coalesce((margin.summary ->> 'unbilled_cents')::bigint, 0) / 100.0,
        'grossMarginPercent', nullif(margin.summary ->> 'gross_margin_percent', '')::numeric
      )
      order by project.updated_at desc
    ), '[]'::jsonb) as rows
    from public.projects as project
    join organization on organization.id = project.organization_id
    join public.clients as client on client.id = project.client_id
    left join lateral (
      select private.get_project_commercial_summary(project.id) as summary
    ) as margin on private.has_organization_role(
      organization.id, array['admin', 'manager']::text[]
    )
    where project.is_read_only = false
      and project.status in ('planning', 'active')
      and (target_project_id is null or project.id = target_project_id)
    limit 12
  ), renewals as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', retainer.id,
        'name', retainer.name,
        'clientName', client.name,
        'endDate', retainer.end_date,
        'daysRemaining', greatest(
          0,
          (retainer.end_date - current_date)
        ),
        'value', coalesce(retainer.allowance_value_cents, retainer.fee_cents) / 100.0
      )
      order by retainer.end_date
    ), '[]'::jsonb) as rows
    from public.retainers as retainer
    join organization on organization.id = retainer.organization_id
    join public.clients as client on client.id = retainer.client_id
    where retainer.status = 'active'
      and retainer.end_date is not null
      and retainer.end_date between current_date and current_date + 180
  ), receivables as (
    select
      coalesce(sum(invoice.balance_cents), 0)::bigint as open_cents,
      coalesce(jsonb_agg(jsonb_build_object(
        'balance', invoice.balance_cents,
        'daysOverdue', greatest(0, current_date - invoice.due_date)
      )), '[]'::jsonb) as rows
    from public.invoices as invoice
    join organization on organization.id = invoice.organization_id
    where private.has_organization_role(
      organization.id, array['admin', 'manager']::text[]
    )
      and invoice.status in ('issued', 'partially_paid', 'overdue')
      and invoice.balance_cents > 0
  ), pipeline as (
    select
      (select count(*) from public.prospects as prospect
        join organization on organization.id = prospect.organization_id
        where prospect.stage not in ('won', 'lost')) as prospect_clients,
      (select count(*) from public.projects as project
        join organization on organization.id = project.organization_id
        where project.status = 'planning'
          and project.is_read_only = false
          and (target_project_id is null or project.id = target_project_id)) as planning_jobs,
      (
        coalesce((select sum(prospect.value_cents) from public.prospects as prospect
          join organization on organization.id = prospect.organization_id
          where prospect.stage not in ('won', 'lost')), 0)
        + coalesce((select sum(project.fixed_fee_cents) from public.projects as project
          join organization on organization.id = project.organization_id
          where project.status = 'planning'
            and project.is_read_only = false
            and (target_project_id is null or project.id = target_project_id)), 0)
      ) / 100.0 as fixed_fee_value,
      coalesce((select sum(prospect.weighted_value_cents) from public.prospects as prospect
        join organization on organization.id = prospect.organization_id
        where prospect.stage not in ('won', 'lost')), 0) / 100.0 as weighted_value
  ), capacity as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'profileId', profile.id,
        'name', profile.full_name,
        'capacityMinutes', profile.weekly_capacity_minutes,
        'scheduledMinutes', coalesce(week_time.minutes, 0),
        'availableMinutes', greatest(
          profile.weekly_capacity_minutes - coalesce(week_time.minutes, 0), 0
        ),
        'utilizationPercent', case
          when profile.weekly_capacity_minutes > 0 then round(
            (coalesce(week_time.minutes, 0)::numeric
              / profile.weekly_capacity_minutes) * 100
          )::integer
          else 0
        end
      )
      order by 6 desc, profile.full_name
    ), '[]'::jsonb) as rows
    from profiles as profile
    left join week_time on week_time.profile_id = profile.id
    where private.has_organization_role(
      (select id from organization), array['admin', 'manager']::text[]
    )
      or profile.id = (select auth.uid())
    limit 20
  )
  select jsonb_build_object(
    'available', true,
    'metadata', jsonb_build_object(
      'days', (select days from settings),
      'generatedAt', statement_timestamp(),
      'projectId', target_project_id,
      'completeness', jsonb_build_object(
        'utilization', (select logged_minutes > 0 from utilization),
        'jobMargins', jsonb_array_length((select rows from job_margins)) > 0,
        'receivables', (select open_cents > 0 from receivables)
      )
    ),
    'utilization', jsonb_build_object(
      'loggedMinutes', (select logged_minutes from utilization),
      'billableMinutes', (select billable_minutes from utilization),
      'capacityMinutes', (select capacity_minutes from utilization),
      'percent', case
        when (select capacity_minutes from utilization) > 0 then round(
          ((select logged_minutes from utilization)::numeric
            / (select capacity_minutes from utilization)) * 100
        )::integer
        else null
      end
    ),
    'unapprovedTime', jsonb_build_object(
      'entries', (select entries from unapproved),
      'minutes', (select minutes from unapproved),
      'value', (select value_cents from unapproved) / 100.0
    ),
    'jobMargins', (select rows from job_margins),
    'renewals', (select rows from renewals),
    'accountsReceivable', jsonb_build_object(
      'available', private.has_organization_role(
        (select id from organization), array['admin', 'manager']::text[]
      ),
      'open', (select open_cents from receivables) / 100.0,
      'buckets', jsonb_build_array(
        jsonb_build_object('label', 'Current', 'value', (
          select coalesce(sum((row ->> 'balance')::bigint), 0)
          from receivables, jsonb_array_elements(receivables.rows) as row
          where (row ->> 'daysOverdue')::integer <= 0
        ) / 100.0),
        jsonb_build_object('label', '1–30', 'value', (
          select coalesce(sum((row ->> 'balance')::bigint), 0)
          from receivables, jsonb_array_elements(receivables.rows) as row
          where (row ->> 'daysOverdue')::integer between 1 and 30
        ) / 100.0),
        jsonb_build_object('label', '31–60', 'value', (
          select coalesce(sum((row ->> 'balance')::bigint), 0)
          from receivables, jsonb_array_elements(receivables.rows) as row
          where (row ->> 'daysOverdue')::integer between 31 and 60
        ) / 100.0),
        jsonb_build_object('label', '61–90', 'value', (
          select coalesce(sum((row ->> 'balance')::bigint), 0)
          from receivables, jsonb_array_elements(receivables.rows) as row
          where (row ->> 'daysOverdue')::integer between 61 and 90
        ) / 100.0),
        jsonb_build_object('label', '90+', 'value', (
          select coalesce(sum((row ->> 'balance')::bigint), 0)
          from receivables, jsonb_array_elements(receivables.rows) as row
          where (row ->> 'daysOverdue')::integer >= 91
        ) / 100.0)
      )
    ),
    'pipeline', jsonb_build_object(
      'prospectClients', (select prospect_clients from pipeline),
      'planningJobs', (select planning_jobs from pipeline),
      'fixedFeeValue', (select fixed_fee_value from pipeline),
      'weightedValue', (select weighted_value from pipeline)
    ),
    'capacity', (select rows from capacity)
  );
$$;

create or replace function public.get_delivery_report(
  requested_days integer default 90,
  target_project_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with organization as (
    select private.current_organization_id() as id
  ), settings as (
    select greatest(7, least(coalesce(requested_days, 90), 365)) as days
  ), report_window as (
    select (statement_timestamp() - ((select days from settings) || ' days')::interval) as since_at
  ), transitions as (
    select transition.*
    from public.issue_status_transitions as transition
    join public.todos as todo on todo.id = transition.todo_id
    join public.projects as project on project.id = todo.project_id
    join organization on organization.id = project.organization_id
    cross join report_window
    where transition.created_at >= report_window.since_at
      and project.is_read_only = false
      and (target_project_id is null or todo.project_id = target_project_id)
  ), active_todos as (
    select todo.*
    from public.todos as todo
    join public.projects as project on project.id = todo.project_id
    join organization on organization.id = project.organization_id
    where project.is_read_only = false
      and todo.operational_state = 'active'
      and (target_project_id is null or todo.project_id = target_project_id)
  )
  select jsonb_build_object(
    'available', true,
    'metadata', jsonb_build_object(
      'days', (select days from settings),
      'generatedAt', statement_timestamp(),
      'projectId', target_project_id
    ),
    'capturedSince', (select min(created_at) from transitions),
    'throughputLast7Days', (
      select count(*) from transitions
      where to_status = 'done'
        and created_at >= statement_timestamp() - interval '7 days'
    ),
    'workInProgress', (
      select count(*) from active_todos
      where status not in ('done', 'cancelled')
    ),
    'blockedCount', (
      select count(*) from active_todos where status = 'blocked'
    ),
    'overdueCount', (
      select count(*) from active_todos
      where status not in ('done', 'cancelled')
        and due_at is not null
        and due_at < statement_timestamp()
    ),
    'weeklyThroughput', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week', week_start::text,
        'count', done_count
      ) order by week_start)
      from (
        select
          date_trunc('week', transition.created_at)::date as week_start,
          count(*) filter (where transition.to_status = 'done') as done_count
        from transitions as transition
        group by 1
        order by 1 desc
        limit 12
      ) as weeks
    ), '[]'::jsonb),
    'overdueAgeBuckets', jsonb_build_array(
      jsonb_build_object('label', '1-7 days', 'count', (
        select count(*) from active_todos
        where status not in ('done', 'cancelled')
          and due_at is not null
          and due_at < statement_timestamp()
          and due_at >= statement_timestamp() - interval '7 days'
      )),
      jsonb_build_object('label', '8-30 days', 'count', (
        select count(*) from active_todos
        where status not in ('done', 'cancelled')
          and due_at is not null
          and due_at < statement_timestamp() - interval '7 days'
          and due_at >= statement_timestamp() - interval '30 days'
      )),
      jsonb_build_object('label', '31+ days', 'count', (
        select count(*) from active_todos
        where status not in ('done', 'cancelled')
          and due_at is not null
          and due_at < statement_timestamp() - interval '30 days'
      ))
    ),
    'projectHealth', coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectId', project.id,
        'projectName', project.name,
        'active', stats.active_count,
        'blocked', stats.blocked_count,
        'overdue', stats.overdue_count,
        'estimatedMinutes', stats.estimated_minutes
      ) order by project.name)
      from public.projects as project
      join organization on organization.id = project.organization_id
      join lateral (
        select
          count(*) filter (
            where todo.status not in ('done', 'cancelled')
          ) as active_count,
          count(*) filter (where todo.status = 'blocked') as blocked_count,
          count(*) filter (
            where todo.status not in ('done', 'cancelled')
              and todo.due_at is not null
              and todo.due_at < statement_timestamp()
          ) as overdue_count,
          coalesce(sum(todo.estimated_minutes), 0)::bigint as estimated_minutes
        from public.todos as todo
        where todo.project_id = project.id
          and todo.operational_state = 'active'
      ) as stats on true
      where project.is_read_only = false
        and (target_project_id is null or project.id = target_project_id)
    ), '[]'::jsonb)
  );
$$;

create or replace function public.export_commercial_report_csv(
  report_kind text default 'operations',
  requested_days integer default 90,
  target_project_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with payload as (
    select case report_kind
      when 'operations' then public.get_commercial_operations_report(
        requested_days, target_project_id
      )
      when 'delivery' then public.get_delivery_report(
        requested_days, target_project_id
      )
      else null
    end as body
  )
  select jsonb_build_object(
    'reportKind', report_kind,
    'filename', report_kind || '-report-' || to_char(current_date, 'YYYY-MM-DD') || '.csv',
    'contentType', 'text/csv; charset=utf-8',
    'metadata', coalesce(body -> 'metadata', '{}'::jsonb),
    'csv', case report_kind
      when 'operations' then
        'section,key,value' || E'\n' ||
        'utilization,loggedMinutes,' || coalesce((body #>> '{utilization,loggedMinutes}'), '0') || E'\n' ||
        'utilization,billableMinutes,' || coalesce((body #>> '{utilization,billableMinutes}'), '0') || E'\n' ||
        'pipeline,weightedValue,' || coalesce((body #>> '{pipeline,weightedValue}'), '0') || E'\n' ||
        'receivables,open,' || coalesce((body #>> '{accountsReceivable,open}'), '0')
      when 'delivery' then
        'section,key,value' || E'\n' ||
        'delivery,throughputLast7Days,' || coalesce((body #>> '{throughputLast7Days}'), '0') || E'\n' ||
        'delivery,workInProgress,' || coalesce((body #>> '{workInProgress}'), '0') || E'\n' ||
        'delivery,blockedCount,' || coalesce((body #>> '{blockedCount}'), '0') || E'\n' ||
        'delivery,overdueCount,' || coalesce((body #>> '{overdueCount}'), '0')
      else ''
    end
  )
  from payload
  where body is not null;
$$;

-- Patch Accelo invoice promotion to use ledger-safe helper.
do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  );
  updated_definition := regexp_replace(
    original_definition,
    $pattern$        when 'invoices' then[\s\S]*?        when 'payments' then$pattern$,
    $replace$        when 'invoices' then
          destination_id := private.promote_accelo_invoice_stage(run, stage, payload);

        when 'payments' then$replace$
  );
  if updated_definition = original_definition then
    raise exception 'Failed to patch Accelo invoice promotion block.';
  end if;
  execute updated_definition;
end;
$migration$;

alter table public.finance_audit_events enable row level security;
alter table public.invoice_deliveries enable row level security;
alter table public.invoice_delivery_attempts enable row level security;
alter table public.invoice_adjustments enable row level security;
alter table public.communication_threads enable row level security;
alter table public.communication_participants enable row level security;
alter table public.communication_attachments enable row level security;
alter table public.communication_webhook_events enable row level security;

create policy "Managers can read finance audit"
on public.finance_audit_events for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Managers can read invoice deliveries"
on public.invoice_deliveries for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Managers can manage invoice deliveries"
on public.invoice_deliveries for all to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)))
with check ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Managers can read delivery attempts"
on public.invoice_delivery_attempts for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Managers can read invoice adjustments"
on public.invoice_adjustments for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Organization members can read communication threads"
on public.communication_threads for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager', 'member']::text[]
)));

create policy "Managers can manage communication threads"
on public.communication_threads for all to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)))
with check ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Organization members can read communication participants"
on public.communication_participants for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager', 'member']::text[]
)));

create policy "Managers can manage communication participants"
on public.communication_participants for all to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)))
with check ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Organization members can read communication attachments"
on public.communication_attachments for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager', 'member']::text[]
)));

create policy "Managers can manage communication attachments"
on public.communication_attachments for all to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)))
with check ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

create policy "Managers can read communication webhook events"
on public.communication_webhook_events for select to authenticated
using ((select private.has_organization_role(
  organization_id, array['admin', 'manager']::text[]
)));

revoke all on function private.record_finance_audit(uuid,text,text,uuid,jsonb,jsonb,jsonb,text) from public;
revoke all on function private.sync_accelo_invoice_lines(uuid,uuid,uuid,jsonb,jsonb,text) from public;
revoke all on function private.promote_accelo_invoice_stage(public.accelo_pull_runs,public.accelo_pull_stage,jsonb) from public;
revoke all on function private.mark_invoice_delivery_attempt(uuid,text,text,text,jsonb,text) from public;
revoke all on function private.ingest_communication_webhook(uuid,text,text,jsonb) from public;
revoke all on function private.advance_overdue_invoices(uuid) from public;

grant execute on function public.allocate_payment_multi(uuid,date,text,text,text,char(3),jsonb) to authenticated, service_role;
grant execute on function public.correct_payment_allocation(uuid,bigint,text) to authenticated, service_role;
grant execute on function public.unallocate_payment(uuid,text) to authenticated, service_role;
grant execute on function public.void_invoice(uuid,text,text) to authenticated, service_role;
grant execute on function public.refund_payment(uuid,text,text) to authenticated, service_role;
grant execute on function public.issue_credit_note(uuid,bigint,text,text) to authenticated, service_role;
grant execute on function public.write_off_invoice(uuid,bigint,text,text) to authenticated, service_role;
grant execute on function public.reconcile_settlement(uuid,jsonb,text) to authenticated, service_role;
grant execute on function public.queue_invoice_delivery(uuid,text,text,text) to authenticated, service_role;
grant execute on function public.mark_invoice_delivery_attempt(uuid,text,text,text,jsonb,text) to authenticated, service_role;
grant execute on function public.ingest_communication_webhook(uuid,text,text,jsonb) to service_role;
grant execute on function public.capture_communication_message(uuid,uuid,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text) to authenticated, service_role;
grant execute on function public.advance_overdue_invoices() to authenticated, service_role;
grant execute on function public.get_commercial_operations_report(integer,uuid) to authenticated, service_role;
grant execute on function public.get_delivery_report(integer,uuid) to authenticated, service_role;
grant execute on function public.export_commercial_report_csv(text,integer,uuid) to authenticated, service_role;

create trigger set_invoice_deliveries_updated_at
  before update on public.invoice_deliveries
  for each row execute function private.set_updated_at();
create trigger set_communication_threads_updated_at
  before update on public.communication_threads
  for each row execute function private.set_updated_at();
