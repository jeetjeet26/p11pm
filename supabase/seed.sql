-- Local demo data only. This file is run by `supabase db reset` because
-- db.seed.sql_paths points here; do not run it against production.
-- It intentionally creates no Auth users or profile-owned records.

insert into public.organizations (
  id,
  name,
  slug,
  description,
  settings
)
values (
  '11000000-0000-4000-8000-000000000001',
  'P11 Marketing Studio',
  'p11-marketing-studio',
  'Integrated digital and print marketing delivery team.',
  '{"demo": true, "default_currency": "USD"}'::jsonb
)
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug,
    description = excluded.description,
    settings = excluded.settings;

insert into public.workspace_conversations (
  organization_id,
  kind,
  name,
  slug
)
values (
  '11000000-0000-4000-8000-000000000001',
  'channel',
  'general',
  'general'
)
on conflict do nothing;

insert into public.projects (
  id,
  organization_id,
  name,
  code,
  client_name,
  description,
  status,
  priority,
  start_date,
  due_date,
  budget,
  metadata
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'Fall Brand Awareness Campaign',
    'P11-DIG-26',
    'Northstar Coffee Co.',
    'Paid social, email, landing-page, and measurement program for the fall launch.',
    'active',
    'high',
    '2026-08-03',
    '2026-10-16',
    85000.00,
    '{"demo": true, "channel": "digital"}'::jsonb
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    'Retail Print Collateral Rollout',
    'P11-PRT-26',
    'Northstar Coffee Co.',
    'Store posters, counter cards, menus, and direct-mail production across 42 locations.',
    'planning',
    'medium',
    '2026-08-17',
    '2026-11-06',
    43000.00,
    '{"demo": true, "channel": "print", "locations": 42}'::jsonb
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000001',
    'Holiday Product Launch',
    'P11-INT-26',
    'Lumen Home',
    'Integrated launch spanning ecommerce creative, creator content, packaging inserts, and catalog.',
    'planning',
    'urgent',
    '2026-09-01',
    '2026-11-20',
    125000.00,
    '{"demo": true, "channel": "integrated"}'::jsonb
  )
on conflict (id) do update
set name = excluded.name,
    client_name = excluded.client_name,
    description = excluded.description,
    status = excluded.status,
    priority = excluded.priority,
    start_date = excluded.start_date,
    due_date = excluded.due_date,
    budget = excluded.budget,
    metadata = excluded.metadata;

insert into public.todo_lists (
  id,
  project_id,
  title,
  description,
  position
)
values
  (
    '33000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Campaign Strategy',
    'Audience, offer, channel mix, and measurement planning.',
    0
  ),
  (
    '33000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    'Creative Production',
    'Digital concept, copy, design, and trafficking.',
    1
  ),
  (
    '33000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000002',
    'Prepress',
    'Final artwork, proofing, stock, and color checks.',
    0
  ),
  (
    '33000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000002',
    'Production & Distribution',
    'Print run, quality control, kitting, and shipment.',
    1
  ),
  (
    '33000000-0000-4000-8000-000000000005',
    '22000000-0000-4000-8000-000000000003',
    'Integrated Launch Plan',
    'Cross-channel dependencies and launch readiness.',
    0
  )
on conflict (id) do update
set title = excluded.title,
    description = excluded.description,
    position = excluded.position;

insert into public.milestones (
  id,
  project_id,
  name,
  description,
  status,
  due_date,
  position
)
values
  (
    '44000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Strategy approved',
    'Client signs off on audience, messaging, and channel allocation.',
    'in_progress',
    '2026-08-14',
    0
  ),
  (
    '44000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    'Campaign launch',
    'Paid media, email, and landing page go live.',
    'upcoming',
    '2026-09-08',
    1
  ),
  (
    '44000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000002',
    'Press proof approved',
    'Final physical proof receives client and production approval.',
    'upcoming',
    '2026-09-25',
    0
  ),
  (
    '44000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000002',
    'Collateral delivered',
    'All store kits arrive before the merchandising reset.',
    'upcoming',
    '2026-10-30',
    1
  ),
  (
    '44000000-0000-4000-8000-000000000005',
    '22000000-0000-4000-8000-000000000003',
    'Launch creative locked',
    'Digital, creator, packaging, and catalog assets are production ready.',
    'upcoming',
    '2026-10-09',
    0
  )
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    due_date = excluded.due_date,
    position = excluded.position;
