begin;

select extensions.plan(11);

select extensions.ok(
  (
    select count(*) = 12 and bool_and(class.relrowsecurity)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = any(array[
        'clients', 'contacts', 'client_contacts', 'retainers',
        'retainer_periods', 'client_activities', 'staff_billing_rates',
        'time_entries', 'invoices', 'invoice_line_items', 'payments',
        'payment_allocations'
      ])
  ),
  'every agency operations table has RLS enabled'
);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values
  (
    'a1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'agency-manager@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    'a1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'agency-member@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    'a1100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'agency-outsider@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values
  (
    'a1200000-0000-4000-8000-000000000001',
    'Agency operations test',
    'agency-operations-test'
  ),
  (
    'a1200000-0000-4000-8000-000000000002',
    'Agency operations outsider',
    'agency-operations-outsider'
  );

insert into public.profiles (
  id, organization_id, email, full_name, role, status
)
values
  (
    'a1100000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001',
    'agency-manager@example.com', 'Agency Manager', 'manager', 'active'
  ),
  (
    'a1100000-0000-4000-8000-000000000002',
    'a1200000-0000-4000-8000-000000000001',
    'agency-member@example.com', 'Agency Member', 'member', 'active'
  ),
  (
    'a1100000-0000-4000-8000-000000000003',
    'a1200000-0000-4000-8000-000000000002',
    'agency-outsider@example.com', 'Agency Outsider', 'manager', 'active'
  );

-- Legacy Basecamp client labels remain project display data and must not create
-- synthetic Accelo clients.
insert into public.projects (
  id, organization_id, name, code, client_name, status
)
values (
  'a1300000-0000-4000-8000-000000000099',
  'a1200000-0000-4000-8000-000000000001',
  'Legacy backfill project', 'AG-LEGACY', '  North   Star  ', 'active'
);

select extensions.is(
  private.backfill_project_clients(),
  0,
  'legacy project client backfill remains disabled'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.clients
    where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = 'north star'
  ),
  0::bigint,
  'legacy project client labels do not create client records'
);
select extensions.ok(
  (
    select project.client_id is null
    from public.projects as project
    where project.id = 'a1300000-0000-4000-8000-000000000099'
  ),
  'legacy Basecamp projects remain unlinked from operational clients'
);

insert into public.clients (
  id, organization_id, name, default_currency, payment_terms_days
)
values (
  'a1400000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'Operational Client', 'USD', 30
);

insert into public.projects (
  id, organization_id, client_id, name, code, client_name, status,
  billing_type, commercial_currency
)
values (
  'a1300000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'a1400000-0000-4000-8000-000000000001',
  'Operational Core Project', 'AG-CORE', 'Operational Client', 'active',
  'time_and_materials', 'USD'
);

insert into public.project_members (project_id, profile_id)
values (
  'a1300000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000002'
);

insert into public.retainers (
  id, organization_id, client_id, name, status, start_date,
  cadence, included_minutes, fee_cents, currency
)
values (
  'a1500000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'a1400000-0000-4000-8000-000000000001',
  'Monthly support', 'active', '2026-08-01',
  'monthly', 600, 120000, 'USD'
);

insert into public.staff_billing_rates (
  id, organization_id, profile_id, client_id, project_id, rate_cents,
  cost_rate_cents, currency, effective_from
)
values (
  'a1700000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000002',
  'a1400000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000001',
  12000, 6000, 'USD', '2026-08-01'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000002"}',
  true
);

select public.log_time_entry(
  'a1300000-0000-4000-8000-000000000001',
  '2026-08-10',
  90,
  'Retainer implementation work',
  true,
  (
    select id from public.retainer_periods
    where retainer_id = 'a1500000-0000-4000-8000-000000000001'
      and '2026-08-10'::date between period_start and period_end
  ),
  null,
  'a1100000-0000-4000-8000-000000000002',
  'agency-test-time-001'
);

reset role;
update public.staff_billing_rates
set rate_cents = 15000
where id = 'a1700000-0000-4000-8000-000000000001';

select extensions.ok(
  (
    select billing_rate_cents = 12000
      and cost_rate_cents = 6000
      and billable_amount_cents = 18000
    from public.time_entries
    where external_id = 'agency-test-time-001'
  ),
  'time entries snapshot rates and calculate minute-based value'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000003"}',
  true
);
select extensions.is(
  (
    select count(*)::bigint
    from public.clients
    where id = 'a1400000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'RLS hides another organization client'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a1100000-0000-4000-8000-000000000001"}',
  true
);
select public.approve_time_entries(array[
  (select id from public.time_entries where external_id = 'agency-test-time-001')
]);

select extensions.is(
  (
    public.get_retainer_burn_report(
      'a1500000-0000-4000-8000-000000000001',
      null,
      24
    ) #>> '{periods,0,used_minutes}'
  )::bigint,
  90::bigint,
  'retainer burn includes approved billable minutes'
);

select public.create_invoice_from_time_entries(
  'a1400000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000001',
  'AG-INV-001',
  '2026-08-11',
  '2026-09-10',
  array[(select id from public.time_entries where external_id = 'agency-test-time-001')],
  1800
);

select extensions.ok(
  (
    select subtotal_cents = 18000
      and tax_cents = 1800
      and total_cents = 19800
      and balance_cents = 19800
    from public.invoices
    where invoice_number = 'AG-INV-001'
  ),
  'invoice line and tax totals are maintained atomically'
);

select public.create_detailed_invoice(
  'a1400000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000001',
  'AG-INV-DETAIL-001',
  'Monthly Marketing Strategy & Support Services',
  'Client Billing Contact',
  '{"line1":"100 Client Street","city":"Irvine","region":"CA"}'::jsonb,
  '2026-08-11',
  '2026-09-10',
  '2026-08-01',
  '2026-08-31',
  'USD',
  '[
    {
      "item_type":"service",
      "description":"Monthly management fees",
      "details":"Strategy, SEO, social and paid media management",
      "quantity":1,
      "unit_amount_cents":100000
    },
    {
      "item_type":"credit",
      "description":"Service reconciliation credit",
      "quantity":1,
      "unit_amount_cents":-10000
    }
  ]'::jsonb,
  0,
  null,
  'ACH or check',
  'Net 30'
);

select extensions.ok(
  (
    select invoice.subject = 'Monthly Marketing Strategy & Support Services'
      and invoice.attention_to = 'Client Billing Contact'
      and invoice.service_period_start = '2026-08-01'
      and invoice.service_period_end = '2026-08-31'
      and invoice.total_cents = 90000
      and count(line.id) = 2
      and count(line.id) filter (where line.item_type = 'credit') = 1
    from public.invoices as invoice
    join public.invoice_line_items as line on line.invoice_id = invoice.id
    where invoice.invoice_number = 'AG-INV-DETAIL-001'
    group by invoice.id
  ),
  'detailed invoices preserve periods, descriptions, categories, and credits'
);

select public.issue_invoice(
  (select id from public.invoices where invoice_number = 'AG-INV-001')
);
select public.record_client_payment(
  'a1400000-0000-4000-8000-000000000001',
  (select id from public.invoices where invoice_number = 'AG-INV-001'),
  9900,
  '2026-08-12',
  'bank_transfer',
  'BANK-001',
  'agency-payment-idempotency-001'
);

select extensions.ok(
  (
    select invoice.paid_cents = 9900
      and invoice.balance_cents = 9900
      and invoice.status = 'partially_paid'
      and payment.status = 'allocated'
      and allocation.amount_cents = 9900
    from public.invoices as invoice
    join public.payment_allocations as allocation
      on allocation.invoice_id = invoice.id
    join public.payments as payment on payment.id = allocation.payment_id
    where invoice.invoice_number = 'AG-INV-001'
  ),
  'payment allocation updates payment and invoice math'
);

select extensions.throws_ok(
  $$
    insert into public.payment_allocations (
      organization_id, client_id, payment_id, invoice_id, amount_cents
    )
    select
      invoice.organization_id, invoice.client_id, payment.id, invoice.id, 10000
    from public.invoices as invoice
    join public.payments as payment on payment.client_id = invoice.client_id
    where invoice.invoice_number = 'AG-INV-001'
  $$,
  '23514',
  'Payment allocation exceeds available balance.',
  'excessive payment allocation is rejected'
);

select * from extensions.finish();
rollback;
