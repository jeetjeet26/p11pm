begin;

select extensions.plan(5);

select extensions.ok(
  (
    select count(*) = 3 and bool_and(class.relrowsecurity)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = any(array[
        'project_contacts', 'retainer_projects', 'prospects'
      ])
  ),
  'new Accelo parity relationship tables enforce RLS'
);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values (
  'b1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'parity-manager@example.com', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values (
  'b1200000-0000-4000-8000-000000000001',
  'Accelo parity test',
  'accelo-parity-test'
);

insert into public.profiles (
  id, organization_id, email, full_name, role, status, accelo_staff_id
)
values (
  'b1100000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'parity-manager@example.com', 'Parity Manager', 'manager', 'active', '501'
);

insert into public.clients (
  id, organization_id, name, status, external_id
)
values (
  'b1400000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'Parity Client', 'prospect', 'accelo-company-701'
);

insert into public.prospects (
  organization_id, client_id, owner_id, external_id, title, stage,
  probability, value_cents
)
values (
  'b1200000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'accelo-prospect-801', 'Parity Opportunity', 'quote', 60, 10000000
);

select extensions.is(
  (
    select weighted_value_cents
    from public.prospects
    where external_id = 'accelo-prospect-801'
  ),
  6000000::bigint,
  'pipeline weighted value is derived from probability'
);

insert into public.retainers (
  id, organization_id, client_id, name, status, start_date, cadence,
  included_minutes, fee_cents, currency, external_id, allowance_type,
  allowance_value_cents, overage_policy, auto_renew
)
values (
  'b1500000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000001',
  'Annual fixed value', 'active', '2026-01-01', 'annual',
  0, 12000000, 'USD', 'accelo-contract-901', 'fixed_value',
  12000000, 'do_not_bill', true
);

select extensions.ok(
  (
    select allowance_type = 'fixed_value'
      and allowance_value_cents = 12000000
      and included_minutes = 0
    from public.retainers
    where external_id = 'accelo-contract-901'
  ),
  'fixed-value contracts do not derive revenue from included hours'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"b1100000-0000-4000-8000-000000000001"}',
  true
);

select extensions.ok(
  (
    select count(*) = 1
      and min((public.get_accelo_parity_summary() ->> 'open_pipeline_value_cents')::bigint)
        = 10000000
    from public.prospects
  ),
  'organization members can read their bounded parity summary'
);

select extensions.throws_ok(
  $$
    insert into public.prospects (
      organization_id, client_id, title, stage
    )
    values (
      '00000000-0000-4000-8000-000000000000',
      'b1400000-0000-4000-8000-000000000001',
      'Cross-tenant prospect', 'lead'
    )
  $$,
  '42501',
  null,
  'RLS rejects cross-tenant pipeline writes'
);

select * from extensions.finish();
rollback;
