-- Domain fields required to preserve P11's live Accelo operating model without
-- giving the integration any write access to Accelo.

alter table public.profiles
  add column accelo_staff_id text,
  add column permissions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(permissions) = 'object');

create unique index profiles_organization_accelo_staff_key
  on public.profiles (organization_id, accelo_staff_id)
  where organization_id is not null and accelo_staff_id is not null;

create or replace function private.has_organization_permission(
  target_organization_id uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      profile.organization_id = target_organization_id
      and profile.status = 'active'
      and (
        profile.role = 'admin'
        or coalesce((profile.permissions ->> target_permission)::boolean, false)
        or (
          profile.role = 'manager'
          and target_permission in (
            'commercial.read',
            'commercial.write',
            'time.approve',
            'pipeline.write'
          )
        )
      )
    from public.profiles as profile
    where profile.id = (select auth.uid())
  ), false);
$$;

revoke all on function private.has_organization_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function private.has_organization_permission(uuid, text)
  to authenticated, service_role;

create or replace function private.get_workspace_admin_profiles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (select private.is_workspace_admin()) then null
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', profile.id,
          'email', profile.email,
          'full_name', profile.full_name,
          'title', profile.title,
          'role', profile.role,
          'status', profile.status,
          'chat_enabled', profile.chat_enabled,
          'permissions', profile.permissions
        )
        order by profile.full_name, profile.email
      )
      from public.profiles as profile
      where profile.organization_id =
        (select private.current_workspace_organization_id())
    ), '[]'::jsonb)
  end;
$$;

create or replace function private.update_workspace_profile_permissions(
  target_profile_id uuid,
  target_permissions jsonb
)
returns public.profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.profiles%rowtype;
begin
  if not (select private.is_workspace_admin()) then
    raise insufficient_privilege using
      message = 'Workspace administrator access is required.';
  end if;
  if jsonb_typeof(target_permissions) <> 'object'
    or exists (
      select 1
      from jsonb_each(target_permissions) as item
      where item.key not in (
        'commercial.read',
        'commercial.write',
        'time.approve',
        'pipeline.write'
      )
        or jsonb_typeof(item.value) <> 'boolean'
    )
  then
    raise check_violation using message = 'Invalid workspace permissions.';
  end if;
  update public.profiles as profile
  set permissions = target_permissions,
      updated_at = now()
  where profile.id = target_profile_id
    and profile.organization_id =
      (select private.current_workspace_organization_id())
  returning profile.* into result;
  if result.id is null then
    raise no_data_found using message = 'Workspace profile not found.';
  end if;
  return result;
end;
$$;

create or replace function public.update_workspace_profile_permissions(
  target_profile_id uuid,
  target_permissions jsonb
)
returns public.profiles
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_workspace_profile_permissions(
    target_profile_id,
    target_permissions
  );
$$;

revoke all on function private.update_workspace_profile_permissions(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.update_workspace_profile_permissions(uuid, jsonb)
  to authenticated, service_role;
revoke all on function public.update_workspace_profile_permissions(uuid, jsonb)
  from public, anon;
grant execute on function public.update_workspace_profile_permissions(uuid, jsonb)
  to authenticated, service_role;

create or replace function public.update_workspace_profile_admin_v2(
  target_profile_id uuid,
  target_role text,
  target_status text,
  target_chat_enabled boolean,
  target_permissions jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.update_workspace_profile_admin(
    target_profile_id,
    target_role,
    target_status,
    target_chat_enabled
  );
  perform private.update_workspace_profile_permissions(
    target_profile_id,
    target_permissions
  );
end;
$$;

revoke all on function public.update_workspace_profile_admin_v2(
  uuid, text, text, boolean, jsonb
) from public, anon;
grant execute on function public.update_workspace_profile_admin_v2(
  uuid, text, text, boolean, jsonb
) to authenticated, service_role;

alter table public.clients
  add column account_owner_id uuid,
  add column parent_client_id uuid,
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

alter table public.clients
  add constraint clients_organization_account_owner_fkey
    foreign key (organization_id, account_owner_id)
    references public.profiles(organization_id, id)
    on delete set null (account_owner_id),
  add constraint clients_organization_parent_client_fkey
    foreign key (organization_id, parent_client_id)
    references public.clients(organization_id, id)
    on delete set null (parent_client_id);

create index clients_account_owner_idx
  on public.clients (organization_id, account_owner_id, status, name);
create index clients_parent_idx
  on public.clients (parent_client_id, name)
  where parent_client_id is not null;

alter table public.contacts
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

alter table public.client_contacts
  add column external_id text,
  add column position text,
  add column standing text,
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

create unique index client_contacts_organization_external_id_key
  on public.client_contacts (organization_id, external_id)
  where external_id is not null;

alter table public.projects
  add column accelo_job_id text,
  add column commercial_value_cents bigint
    check (commercial_value_cents is null or commercial_value_cents >= 0),
  add column billing_cadence text
    check (
      billing_cadence is null
      or billing_cadence in ('weekly', 'monthly', 'quarterly', 'milestone', 'completion')
    ),
  add column time_rounding_minutes integer
    check (
      time_rounding_minutes is null
      or time_rounding_minutes in (1, 5, 6, 10, 15, 30, 60)
    ),
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

create unique index projects_organization_accelo_job_key
  on public.projects (organization_id, accelo_job_id)
  where accelo_job_id is not null;

create table public.project_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  contact_id uuid not null,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (project_id, contact_id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete cascade
);

create index project_contacts_contact_idx
  on public.project_contacts (contact_id, project_id);

alter table public.retainers
  add column external_id text,
  add column contract_type text,
  add column allowance_type text not null default 'fixed_value'
    check (allowance_type in ('fixed_value', 'fixed_hours', 'unlimited_hours', 'deliverables')),
  add column allowance_value_cents bigint
    check (allowance_value_cents is null or allowance_value_cents >= 0),
  add column overage_policy text not null default 'do_not_bill'
    check (overage_policy in ('do_not_bill', 'bill', 'unlimited', 'manual_review')),
  add column auto_renew boolean not null default false,
  add column renewal_days integer
    check (renewal_days is null or renewal_days between 0 and 3650),
  add column invoice_timing text not null default 'period_start'
    check (invoice_timing in ('period_start', 'period_end', 'manual')),
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

create unique index retainers_organization_external_id_key
  on public.retainers (organization_id, external_id)
  where external_id is not null;

create table public.retainer_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  retainer_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (retainer_id, project_id),
  foreign key (organization_id, retainer_id)
    references public.retainers(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade
);

create index retainer_projects_project_idx
  on public.retainer_projects (project_id, retainer_id);

alter table public.retainer_periods
  add column external_id text,
  add column allowance_type text not null default 'fixed_value'
    check (allowance_type in ('fixed_value', 'fixed_hours', 'unlimited_hours', 'deliverables')),
  add column included_value_cents bigint
    check (included_value_cents is null or included_value_cents >= 0),
  add column consumed_value_cents bigint not null default 0
    check (consumed_value_cents >= 0),
  add column template_revision integer not null default 1
    check (template_revision > 0),
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

create unique index retainer_periods_organization_external_id_key
  on public.retainer_periods (organization_id, external_id)
  where external_id is not null;

alter table public.client_activities
  drop constraint client_activities_activity_type_check,
  add constraint client_activities_activity_type_check check (
    activity_type in (
      'note', 'call', 'email', 'meeting', 'report', 'event_log', 'status_change'
    )
  ),
  add column external_id text,
  add column source text not null default 'manual'
    check (source in ('manual', 'accelo', 'email', 'calendar', 'api')),
  add column direction text
    check (direction is null or direction in ('inbound', 'outbound', 'internal')),
  add column participant_contact_ids uuid[] not null default '{}'::uuid[],
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

create unique index client_activities_organization_external_id_key
  on public.client_activities (organization_id, external_id)
  where external_id is not null;
create index client_activities_project_occurred_idx
  on public.client_activities (project_id, occurred_at desc, id desc)
  where project_id is not null;
create index client_activities_contact_occurred_idx
  on public.client_activities (contact_id, occurred_at desc, id desc)
  where contact_id is not null;
create index client_activities_search_idx
  on public.client_activities using gin (
    to_tsvector(
      'english',
      coalesce(subject, '') || ' ' || coalesce(body, '')
    )
  );

alter table public.time_entries
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object'),
  add column rejection_reason text;

alter table public.invoices
  add column external_id text,
  add column delivered_at timestamptz,
  add column delivery_method text
    check (delivery_method is null or delivery_method in ('email', 'portal', 'manual', 'import')),
  add column collection_owner_id uuid,
  add column promised_payment_date date,
  add column collection_notes text,
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

alter table public.invoices
  add constraint invoices_organization_collection_owner_fkey
    foreign key (organization_id, collection_owner_id)
    references public.profiles(organization_id, id)
    on delete set null (collection_owner_id);

create unique index invoices_organization_external_id_key
  on public.invoices (organization_id, external_id)
  where external_id is not null;
create index invoices_collection_idx
  on public.invoices (
    organization_id, collection_owner_id, due_date, balance_cents desc, id
  )
  where status in ('issued', 'partially_paid', 'overdue');

alter table public.invoice_line_items
  add column external_id text,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

create unique index invoice_line_items_invoice_external_id_key
  on public.invoice_line_items (invoice_id, external_id)
  where external_id is not null;

alter table public.payments
  add column external_id text,
  add column source_updated_at timestamptz,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

create unique index payments_organization_external_id_key
  on public.payments (organization_id, external_id)
  where external_id is not null;

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  primary_contact_id uuid,
  owner_id uuid,
  external_id text,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  stage text not null default 'lead'
    check (stage in ('lead', 'qualified', 'quote', 'won', 'lost')),
  probability integer not null default 20 check (probability between 0 and 100),
  value_cents bigint not null default 0 check (value_cents >= 0),
  weighted_value_cents bigint generated always as (
    round((value_cents::numeric * probability::numeric) / 100)::bigint
  ) stored,
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  next_action text,
  next_action_at timestamptz,
  closed_at timestamptz,
  source_updated_at timestamptz,
  source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, primary_contact_id)
    references public.contacts(organization_id, id) on delete set null,
  foreign key (organization_id, owner_id)
    references public.profiles(organization_id, id)
    on delete set null (owner_id),
  constraint prospects_closed_consistent check (
    (stage in ('won', 'lost') and closed_at is not null)
    or (stage not in ('won', 'lost') and closed_at is null)
  )
);

create unique index prospects_organization_external_id_key
  on public.prospects (organization_id, external_id)
  where external_id is not null;
create index prospects_pipeline_idx
  on public.prospects (
    organization_id, stage, owner_id, next_action_at, value_cents desc, id
  );

alter table public.milestones
  add column if not exists source_updated_at timestamptz;

alter table public.todos
  add column accelo_issue_id text;

create unique index todos_project_accelo_issue_key
  on public.todos (project_id, accelo_issue_id)
  where accelo_issue_id is not null;

alter table public.project_contacts enable row level security;
alter table public.retainer_projects enable row level security;
alter table public.prospects enable row level security;

create policy project_contacts_select_organization
  on public.project_contacts for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy project_contacts_manage_managers
  on public.project_contacts for all to authenticated
  using (
    (select private.has_organization_permission(
      organization_id, 'commercial.write'
    ))
  )
  with check (
    (select private.has_organization_permission(
      organization_id, 'commercial.write'
    ))
  );

create policy retainer_projects_select_organization
  on public.retainer_projects for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy retainer_projects_manage_managers
  on public.retainer_projects for all to authenticated
  using (
    (select private.has_organization_permission(
      organization_id, 'commercial.write'
    ))
  )
  with check (
    (select private.has_organization_permission(
      organization_id, 'commercial.write'
    ))
  );

create policy prospects_select_organization
  on public.prospects for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy prospects_manage_managers
  on public.prospects for all to authenticated
  using (
    (select private.has_organization_permission(
      organization_id, 'pipeline.write'
    ))
  )
  with check (
    (select private.has_organization_permission(
      organization_id, 'pipeline.write'
    ))
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'staff_billing_rates',
    'invoices',
    'invoice_line_items',
    'payments',
    'payment_allocations'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated
       using ((select private.has_organization_permission(
         organization_id, ''commercial.read''
       )))',
      'Commercial readers can read ' || table_name,
      table_name
    );
    execute format(
      'create policy %I on public.%I for all to authenticated
       using ((select private.has_organization_permission(
         organization_id, ''commercial.write''
       )))
       with check ((select private.has_organization_permission(
         organization_id, ''commercial.write''
       )))',
      'Commercial managers can manage ' || table_name,
      table_name
    );
  end loop;

  foreach table_name in array array[
    'clients',
    'contacts',
    'client_contacts',
    'retainers',
    'retainer_periods',
    'client_activities'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated
       using ((select private.has_organization_permission(
         organization_id, ''commercial.write''
       )))
       with check ((select private.has_organization_permission(
         organization_id, ''commercial.write''
       )))',
      'Commercial managers can manage ' || table_name,
      table_name
    );
  end loop;
end;
$$;

create policy "Time approvers can read organization time"
on public.time_entries for select to authenticated
using (
  (select private.has_organization_permission(
    organization_id, 'time.approve'
  ))
);
create policy "Time approvers can update organization time"
on public.time_entries for update to authenticated
using (
  (select private.has_organization_permission(
    organization_id, 'time.approve'
  ))
)
with check (
  (select private.has_organization_permission(
    organization_id, 'time.approve'
  ))
);

grant select on public.project_contacts, public.retainer_projects, public.prospects
  to authenticated;
grant insert, update, delete
  on public.project_contacts, public.retainer_projects, public.prospects
  to authenticated, service_role;
grant all on public.project_contacts, public.retainer_projects, public.prospects
  to service_role;

create or replace function public.get_accelo_parity_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'clients', (
      select count(*) from public.clients
      where organization_id = (select private.current_organization_id())
    ),
    'active_jobs', (
      select count(*) from public.projects
      where organization_id = (select private.current_organization_id())
        and status = 'active'
    ),
    'active_contracts', (
      select count(*) from public.retainers
      where organization_id = (select private.current_organization_id())
        and status = 'active'
    ),
    'open_pipeline_value_cents', (
      select coalesce(sum(value_cents), 0)
      from public.prospects
      where organization_id = (select private.current_organization_id())
        and stage not in ('won', 'lost')
    ),
    'weighted_pipeline_value_cents', (
      select coalesce(sum(weighted_value_cents), 0)
      from public.prospects
      where organization_id = (select private.current_organization_id())
        and stage not in ('won', 'lost')
    ),
    'outstanding_cents', (
      select coalesce(sum(balance_cents), 0)
      from public.invoices
      where organization_id = (select private.current_organization_id())
        and status in ('issued', 'partially_paid', 'overdue')
    )
  );
$$;

revoke all on function public.get_accelo_parity_summary() from public, anon;
grant execute on function public.get_accelo_parity_summary()
  to authenticated, service_role;

create or replace function public.get_relationship_timeline(
  target_client_id uuid,
  before_occurred_at timestamptz default null,
  target_activity_type text default null,
  target_source text default null,
  search_query text default null,
  result_limit integer default 100
)
returns table (
  id uuid,
  client_id uuid,
  project_id uuid,
  contact_id uuid,
  activity_type text,
  subject text,
  body text,
  occurred_at timestamptz,
  duration_minutes integer,
  direction text,
  source text,
  participant_contact_ids uuid[],
  contact_name text,
  project_name text,
  author_name text,
  has_more boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounded as (
    select
      activity.id,
      activity.client_id,
      activity.project_id,
      activity.contact_id,
      activity.activity_type,
      activity.subject,
      activity.body,
      activity.occurred_at,
      activity.duration_minutes,
      activity.direction,
      activity.source,
      activity.participant_contact_ids,
      nullif(
        btrim(concat_ws(' ', contact.first_name, contact.last_name)),
        ''
      ) as contact_name,
      project.name as project_name,
      profile.full_name as author_name
    from public.client_activities as activity
    left join public.contacts as contact on contact.id = activity.contact_id
    left join public.projects as project on project.id = activity.project_id
    left join public.profiles as profile on profile.id = activity.created_by
    where activity.client_id = target_client_id
      and activity.organization_id = (select private.current_organization_id())
      and (
        before_occurred_at is null
        or activity.occurred_at < before_occurred_at
      )
      and (
        target_activity_type is null
        or activity.activity_type = target_activity_type
      )
      and (target_source is null or activity.source = target_source)
      and (
        nullif(btrim(search_query), '') is null
        or to_tsvector(
          'english',
          coalesce(activity.subject, '') || ' ' || coalesce(activity.body, '')
        ) @@ websearch_to_tsquery('english', search_query)
      )
    order by activity.occurred_at desc, activity.id desc
    limit least(greatest(result_limit, 1), 200) + 1
  ),
  page as (
    select *
    from bounded
    order by occurred_at desc, id desc
    limit least(greatest(result_limit, 1), 200)
  )
  select
    page.*,
    (select count(*) from bounded)
      > least(greatest(result_limit, 1), 200) as has_more
  from page;
$$;

revoke all on function public.get_relationship_timeline(
  uuid, timestamptz, text, text, text, integer
) from public, anon;
grant execute on function public.get_relationship_timeline(
  uuid, timestamptz, text, text, text, integer
) to authenticated, service_role;

create or replace function public.get_billing_workbench(
  through_date date default current_date
)
returns table (
  source_type text,
  source_id uuid,
  client_id uuid,
  client_name text,
  project_id uuid,
  project_name text,
  description text,
  quantity numeric,
  amount_cents bigint,
  currency text,
  ready_since date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with authorized as (
    select private.current_organization_id() as organization_id
    where private.has_organization_permission(
      private.current_organization_id(),
      'commercial.write'
    )
  ),
  approved_time as (
    select
      'approved_time'::text as source_type,
      (array_agg(entry.id order by entry.id))[1] as source_id,
      entry.client_id,
      client.name as client_name,
      entry.project_id,
      project.name as project_name,
      count(*)::text || ' approved time entries' as description,
      (sum(entry.minutes)::numeric / 60)::numeric as quantity,
      sum(entry.billable_amount_cents)::bigint as amount_cents,
      min(entry.currency)::text as currency,
      min(entry.entry_date) as ready_since
    from public.time_entries as entry
    join authorized on authorized.organization_id = entry.organization_id
    join public.clients as client on client.id = entry.client_id
    join public.projects as project on project.id = entry.project_id
    where entry.status = 'approved'
      and entry.billable
      and entry.entry_date <= through_date
    group by
      entry.client_id, client.name, entry.project_id, project.name
  ),
  fixed_periods as (
    select
      'contract_period'::text as source_type,
      period.id as source_id,
      period.client_id,
      client.name as client_name,
      link.project_id,
      project.name as project_name,
      retainer.name || ' · ' ||
        to_char(period.period_start, 'Mon DD, YYYY') || '–' ||
        to_char(period.period_end, 'Mon DD, YYYY') as description,
      1::numeric as quantity,
      period.fee_cents as amount_cents,
      retainer.currency::text as currency,
      period.period_start as ready_since
    from public.retainer_periods as period
    join authorized on authorized.organization_id = period.organization_id
    join public.retainers as retainer on retainer.id = period.retainer_id
    join public.clients as client on client.id = period.client_id
    left join lateral (
      select relation.project_id
      from public.retainer_projects as relation
      where relation.retainer_id = retainer.id
      order by relation.created_at, relation.id
      limit 1
    ) as link on true
    left join public.projects as project on project.id = link.project_id
    where period.status in ('open', 'closed')
      and period.period_start <= through_date
      and retainer.invoice_timing <> 'manual'
      and not exists (
        select 1
        from public.invoice_line_items as line
        where line.retainer_period_id = period.id
      )
  )
  select * from approved_time
  union all
  select * from fixed_periods
  order by ready_since, client_name, project_name nulls last;
$$;

revoke all on function public.get_billing_workbench(date) from public, anon;
grant execute on function public.get_billing_workbench(date)
  to authenticated, service_role;

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
    or not (select private.has_organization_permission(
      target_organization_id, 'time.approve'
    ))
  then
    raise insufficient_privilege using
      message = 'Time approval access is required.';
  end if;
  if (
    select count(distinct entry.id)
    from public.time_entries as entry
    where entry.id = any(target_time_entry_ids)
      and entry.organization_id = target_organization_id
      and entry.status in ('draft', 'submitted', 'rejected')
  ) <> cardinality(array(select distinct unnest(target_time_entry_ids))) then
    raise check_violation using
      message = 'All time entries must be open and in one organization.';
  end if;
  update public.time_entries
  set
    status = 'approved',
    rejection_reason = null,
    approved_by = (select auth.uid()),
    approved_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = any(target_time_entry_ids);
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
