-- Reusable planning structures and explicit delivery-risk records.

alter table public.profiles
  add column weekly_capacity_minutes integer not null default 2400
    check (weekly_capacity_minutes between 60 and 10080);

create table public.issue_blockers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  todo_id uuid not null references public.todos(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 240),
  reason text,
  owner_id uuid references public.profiles(id) on delete set null,
  expected_resolution_at timestamptz,
  source_conversation_id uuid references public.workspace_conversations(id) on delete set null,
  source_message_id uuid references public.workspace_messages(id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'watching', 'resolved', 'cancelled')),
  resolved_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issue_blockers_open_idx
  on public.issue_blockers (project_id, expected_resolution_at, created_at)
  where status in ('open', 'watching');
create index issue_blockers_owner_idx
  on public.issue_blockers (owner_id, status, expected_resolution_at)
  where owner_id is not null;

create table public.work_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 160),
  description text,
  template_type text not null
    check (template_type in ('project', 'issue', 'checklist', 'approval', 'channel')),
  configuration jsonb not null default '{}'::jsonb
    check (jsonb_typeof(configuration) = 'object'),
  is_shared boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name, template_type)
);

create index work_templates_org_idx
  on public.work_templates (organization_id, template_type, name);

create table public.recurring_work_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  template_id uuid references public.work_templates(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 2 and 300),
  description text,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly', 'quarterly')),
  next_run_at timestamptz not null,
  assignee_ids uuid[] not null default '{}',
  due_offset_days integer not null default 0 check (due_offset_days between 0 and 365),
  enabled boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_work_due_idx
  on public.recurring_work_rules (next_run_at)
  where enabled;

create table public.work_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  parent_goal_id uuid references public.work_goals(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  description text,
  owner_id uuid references public.profiles(id) on delete set null,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'at_risk', 'achieved', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  starts_on date,
  target_date date,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_goals_org_idx
  on public.work_goals (organization_id, status, target_date);
create index work_goals_project_idx
  on public.work_goals (project_id, status)
  where project_id is not null;

create table public.project_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  description text not null,
  impact_summary text,
  requested_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  reviewer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'implemented', 'cancelled')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_change_requests_project_idx
  on public.project_change_requests (project_id, status, created_at desc);

create or replace function private.set_pm_chat_project_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_organization_id uuid;
begin
  select project.organization_id
  into canonical_organization_id
  from public.projects as project
  where project.id = new.project_id;
  if canonical_organization_id is null then
    raise foreign_key_violation using message = 'Project does not exist.';
  end if;
  new.organization_id := canonical_organization_id;
  return new;
end;
$$;

create trigger set_issue_blocker_organization
  before insert or update of project_id, organization_id
  on public.issue_blockers
  for each row execute function private.set_pm_chat_project_organization();
create trigger set_recurring_work_organization
  before insert or update of project_id, organization_id
  on public.recurring_work_rules
  for each row execute function private.set_pm_chat_project_organization();
create trigger set_change_request_organization
  before insert or update of project_id, organization_id
  on public.project_change_requests
  for each row execute function private.set_pm_chat_project_organization();

revoke all on
  public.issue_blockers,
  public.work_templates,
  public.recurring_work_rules,
  public.work_goals,
  public.project_change_requests
from public, anon, authenticated;
grant select, insert, update, delete on
  public.issue_blockers,
  public.work_templates,
  public.recurring_work_rules,
  public.work_goals,
  public.project_change_requests
to authenticated;
grant all on
  public.issue_blockers,
  public.work_templates,
  public.recurring_work_rules,
  public.work_goals,
  public.project_change_requests
to service_role;

alter table public.issue_blockers enable row level security;
alter table public.work_templates enable row level security;
alter table public.recurring_work_rules enable row level security;
alter table public.work_goals enable row level security;
alter table public.project_change_requests enable row level security;

create policy "Project members can read blockers"
on public.issue_blockers for select to authenticated
using ((select private.can_access_project(project_id)));
create policy "Project members can create blockers"
on public.issue_blockers for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_project(project_id))
);
create policy "Blocker owners can update blockers"
on public.issue_blockers for update to authenticated
using (
  created_by = (select auth.uid())
  or owner_id = (select auth.uid())
  or (select private.can_manage_project(project_id))
)
with check ((select private.can_access_project(project_id)));

create policy "Members can read shared templates"
on public.work_templates for select to authenticated
using ((select private.can_access_organization(organization_id)));
create policy "Managers can manage templates"
on public.work_templates for all to authenticated
using ((select private.has_organization_role(organization_id, array['admin', 'manager'])))
with check ((select private.has_organization_role(organization_id, array['admin', 'manager'])));

create policy "Members can read recurring work"
on public.recurring_work_rules for select to authenticated
using ((select private.can_access_project(project_id)));
create policy "Managers can manage recurring work"
on public.recurring_work_rules for all to authenticated
using ((select private.can_manage_project(project_id)))
with check ((select private.can_manage_project(project_id)));

create policy "Members can read accessible goals"
on public.work_goals for select to authenticated
using (
  (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);
create policy "Managers can manage goals"
on public.work_goals for all to authenticated
using ((select private.has_organization_role(organization_id, array['admin', 'manager'])))
with check ((select private.has_organization_role(organization_id, array['admin', 'manager'])));

create policy "Project members can read change requests"
on public.project_change_requests for select to authenticated
using ((select private.can_access_project(project_id)));
create policy "Project members can create change requests"
on public.project_change_requests for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and (select private.can_access_project(project_id))
);
create policy "Managers can update change requests"
on public.project_change_requests for update to authenticated
using ((select private.can_manage_project(project_id)))
with check ((select private.can_manage_project(project_id)));
