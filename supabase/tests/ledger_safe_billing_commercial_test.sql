begin;

select extensions.plan(12);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values (
  'f1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'finance-manager@example.com', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values (
  'f1200000-0000-4000-8000-000000000001',
  'Ledger billing test',
  'ledger-billing-test'
);

insert into public.profiles (
  id, organization_id, email, full_name, role, status
)
values (
  'f1100000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001',
  'finance-manager@example.com', 'Finance Manager', 'manager', 'active'
);

insert into public.clients (
  id, organization_id, name, default_currency, payment_terms_days, billing_email
)
values (
  'f1400000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001',
  'Ledger Client', 'USD', 30, 'billing@ledger-client.test'
);

insert into public.projects (
  id, organization_id, client_id, name, code, client_name, status,
  billing_type, commercial_currency
)
values (
  'f1300000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001',
  'f1400000-0000-4000-8000-000000000001',
  'Ledger Project', 'LG-CORE', 'Ledger Client', 'active',
  'time_and_materials', 'USD'
);

select set_config('request.jwt.claim.sub', 'f1100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.create_manual_invoice(
  'f1400000-0000-4000-8000-000000000001',
  'f1300000-0000-4000-8000-000000000001',
  'LG-INV-001',
  current_date,
  current_date + 30,
  'USD',
  '[{"description":"Strategy work","quantity":1,"unit_amount_cents":50000}]'::jsonb,
  5000,
  'Ledger test invoice'
);

select public.issue_invoice(
  (select id from public.invoices where invoice_number = 'LG-INV-001')
);

select extensions.ok(
  (
    select invoice.total_cents = 55000
      and invoice.balance_cents = 55000
      and count(line.id) = 1
    from public.invoices as invoice
    join public.invoice_line_items as line on line.invoice_id = invoice.id
    where invoice.invoice_number = 'LG-INV-001'
    group by invoice.id
  ),
  'issued invoice totals remain ledger-derived from line items'
);

select public.allocate_payment_multi(
  'f1400000-0000-4000-8000-000000000001',
  current_date,
  'bank_transfer',
  'MULTI-001',
  'ledger-multi-payment-001',
  'USD',
  jsonb_build_array(
    jsonb_build_object(
      'invoice_id', (select id from public.invoices where invoice_number = 'LG-INV-001'),
      'amount_cents', 25000
    )
  )
);

select extensions.ok(
  (
    select invoice.paid_cents = 25000
      and invoice.balance_cents = 30000
      and invoice.status = 'partially_paid'
    from public.invoices as invoice
    where invoice.invoice_number = 'LG-INV-001'
  ),
  'multi-invoice allocation updates paid and balance exactly'
);

select public.queue_invoice_delivery(
  (select id from public.invoices where invoice_number = 'LG-INV-001'),
  'billing@ledger-client.test',
  'email',
  'delivery:lg-inv-001'
);

select extensions.ok(
  exists (
    select 1 from public.invoice_deliveries as delivery
    where delivery.idempotency_key = 'delivery:lg-inv-001'
      and delivery.status = 'queued'
  ),
  'invoice delivery outbox queues idempotently'
);

select private.mark_invoice_delivery_attempt(
  (select id from public.invoice_deliveries where idempotency_key = 'delivery:lg-inv-001'),
  'sent',
  'test',
  'msg-001',
  '{"ok":true}'::jsonb,
  null
);

select extensions.ok(
  (
    select delivery.status = 'sent'
      and invoice.delivered_at is not null
    from public.invoice_deliveries as delivery
    join public.invoices as invoice on invoice.id = delivery.invoice_id
    where delivery.idempotency_key = 'delivery:lg-inv-001'
  ),
  'delivery attempts mark invoice delivery state'
);

update public.invoices
set
  collection_owner_id = 'f1100000-0000-4000-8000-000000000001',
  promised_payment_date = current_date + 7,
  collection_notes = 'Client promised payment next week'
where invoice_number = 'LG-INV-001';

select extensions.ok(
  (
    select collection_owner_id is not null
      and promised_payment_date is not null
      and collection_notes is not null
    from public.invoices
    where invoice_number = 'LG-INV-001'
  ),
  'collections metadata persists on invoice records'
);

select public.issue_credit_note(
  (select id from public.invoices where invoice_number = 'LG-INV-001'),
  5000,
  'Goodwill credit for delayed delivery',
  'credit-note-lg-001'
);

select extensions.ok(
  (
    select invoice.total_cents = 50000
      and invoice.balance_cents = 25000
      and exists (
        select 1 from public.invoice_adjustments as adjustment
        where adjustment.idempotency_key = 'credit-note-lg-001'
          and adjustment.adjustment_type = 'credit_note'
      )
    from public.invoices as invoice
    where invoice.invoice_number = 'LG-INV-001'
  ),
  'credit notes adjust ledger totals and record immutable adjustment'
);

select extensions.ok(
  exists (
    select 1 from public.finance_audit_events as event
    where event.action_type in ('payment_allocate_multi', 'credit_note_issue')
  ),
  'finance audit events capture privileged billing actions'
);

select extensions.ok(
  (
    select (payload -> 'metadata' -> 'completeness') is not null
      and (payload -> 'utilization' ->> 'loggedMinutes') is not null
    from public.get_commercial_operations_report(90, null) as payload
  ),
  'commercial operations report returns SQL aggregate metadata'
);

select public.capture_communication_message(
  'f1400000-0000-4000-8000-000000000001',
  'f1300000-0000-4000-8000-000000000001',
  null,
  'Invoice follow-up',
  'Following up on LG-INV-001',
  'outbound',
  'resend',
  'thread-lg-001',
  now(),
  '[{"role":"to","email":"billing@ledger-client.test"}]'::jsonb,
  '[{"file_name":"invoice.pdf","content_type":"application/pdf"}]'::jsonb,
  'comm-lg-001'
);

select extensions.ok(
  exists (
    select 1
    from public.communication_threads as thread
    join public.communication_participants as participant
      on participant.thread_id = thread.id
    join public.communication_attachments as attachment
      on attachment.thread_id = thread.id
    where thread.source_thread_id = 'thread-lg-001'
      and participant.email = 'billing@ledger-client.test'
      and attachment.file_name = 'invoice.pdf'
  ),
  'communication capture persists thread participants and attachments'
);

select private.ingest_communication_webhook(
  'f1200000-0000-4000-8000-000000000001',
  'resend',
  'evt-lg-001',
  '{"type":"email.received"}'::jsonb
);

select extensions.ok(
  exists (
    select 1 from public.communication_webhook_events as event
    where event.event_id = 'evt-lg-001'
  ),
  'communication webhook ingestion is idempotent'
);

select private.ingest_communication_webhook(
  'f1200000-0000-4000-8000-000000000001',
  'resend',
  'evt-lg-001',
  '{"type":"email.received"}'::jsonb
);

select extensions.is(
  (
    select count(*)::bigint
    from public.communication_webhook_events
    where event_id = 'evt-lg-001'
  ),
  1::bigint,
  'duplicate communication webhook events are ignored'
);

select extensions.ok(
  (
    select (payload -> 'metadata' ->> 'generatedAt') is not null
      and jsonb_typeof(payload -> 'weeklyThroughput') = 'array'
    from public.get_delivery_report(90, null) as payload
  ),
  'delivery report aggregates transition history in SQL'
);

select * from extensions.finish();

rollback;
