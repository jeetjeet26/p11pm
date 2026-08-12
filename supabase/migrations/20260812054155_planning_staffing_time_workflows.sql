-- Native planning, staffing, retainer-period, and resilient timer workflows.

create table public.project_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  goal text,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'completed', 'cancelled')),
  starts_on date not null,
  ends_on date not null,
  position integer not null default 0 check (position >= 0),
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (project_id, name),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  constraint project_cycles_dates_valid check (ends_on >= starts_on),
  constraint project_cycles_completion_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index project_cycles_project_position_idx
  on public.project_cycles (project_id, position, starts_on, id);

alter table public.milestones
  add column risk_level text default 'none'
    check (risk_level in ('none', 'low', 'medium', 'high')),
  add column risk_reason text;

alter table public.todos
  add column milestone_id uuid references public.milestones(id) on delete set null,
  add column cycle_id uuid references public.project_cycles(id) on delete set null,
  add column risk_level text default 'none'
    check (risk_level in ('none', 'low', 'medium', 'high')),
  add column risk_reason text;

create index todos_milestone_status_idx
  on public.todos (milestone_id, status, id) where milestone_id is not null;
create index todos_cycle_status_idx
  on public.todos (cycle_id, status, id) where cycle_id is not null;

alter table public.retainer_periods
  add column forecast_minutes integer
    check (forecast_minutes is null or forecast_minutes between 0 and 10000000),
  add column forecast_updated_at timestamptz,
  add column locked_at timestamptz,
  add column locked_by uuid references public.profiles(id) on delete set null,
  add column invoiced_at timestamptz,
  add column invoice_id uuid references public.invoices(id) on delete set null,
  add constraint retainer_period_lock_consistent check (
    (locked_at is null and locked_by is null)
    or (locked_at is not null and locked_by is not null)
  ),
  add constraint retainer_period_invoice_consistent check (
    (invoiced_at is null and invoice_id is null)
    or (invoiced_at is not null and invoice_id is not null)
  );

create table public.time_entry_timers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  project_id uuid not null,
  client_id uuid not null,
  todo_id uuid references public.todos(id) on delete set null,
  retainer_period_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  billable boolean not null default true,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'stopped', 'discarded')),
  created_time_entry_id uuid references public.time_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, profile_id)
    references public.profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete cascade,
  foreign key (organization_id, client_id, retainer_period_id)
    references public.retainer_periods(organization_id, client_id, id) on delete restrict,
  constraint time_entry_timers_stop_consistent check (
    (status = 'running' and stopped_at is null and created_time_entry_id is null)
    or (status = 'stopped' and stopped_at is not null and created_time_entry_id is not null)
    or (status = 'discarded' and stopped_at is not null and created_time_entry_id is null)
  )
);

create unique index time_entry_timers_one_running_per_profile
  on public.time_entry_timers (profile_id) where status = 'running';
create index time_entry_timers_project_started_idx
  on public.time_entry_timers (project_id, started_at desc, id);

create or replace function private.enforce_planning_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  target_project_id uuid := (row_data ->> 'project_id')::uuid;
begin
  if tg_table_name = 'todos' then
    if new.milestone_id is not null and not exists (
      select 1 from public.milestones as milestone
      where milestone.id = new.milestone_id
        and milestone.project_id = new.project_id
    ) then
      raise check_violation using message = 'Issue milestone must belong to its project.';
    end if;
    if new.cycle_id is not null and not exists (
      select 1 from public.project_cycles as cycle
      where cycle.id = new.cycle_id
        and cycle.project_id = new.project_id
    ) then
      raise check_violation using message = 'Issue cycle must belong to its project.';
    end if;
  elsif tg_table_name = 'project_cycles' and not exists (
    select 1 from public.projects as project
    where project.id = target_project_id
      and project.organization_id = (row_data ->> 'organization_id')::uuid
  ) then
    raise check_violation using message = 'Cycle must belong to its organization project.';
  end if;
  return new;
end;
$$;

create trigger enforce_project_cycle_scope
  before insert or update on public.project_cycles
  for each row execute function private.enforce_planning_scope();
create trigger enforce_todo_planning_scope
  before insert or update of project_id, milestone_id, cycle_id on public.todos
  for each row execute function private.enforce_planning_scope();
create trigger set_project_cycles_updated_at
  before update on public.project_cycles
  for each row execute function private.set_updated_at();

create or replace function private.enforce_locked_retainer_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  period_id uuid := case when tg_op = 'DELETE'
    then old.retainer_period_id else new.retainer_period_id end;
begin
  if period_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (
    select 1 from public.retainer_periods as period
    where period.id = period_id
      and (period.locked_at is not null or period.invoiced_at is not null)
  ) and not (
    tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and new.status = 'invoiced'
  ) then
    raise check_violation using
      message = 'Time cannot be changed in a locked or invoiced retainer period.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger enforce_locked_retainer_time
  before insert or update or delete on public.time_entries
  for each row execute function private.enforce_locked_retainer_time();

create or replace function private.start_time_timer(
  target_project_id uuid,
  target_todo_id uuid,
  target_retainer_period_id uuid,
  target_description text,
  target_billable boolean
)
returns public.time_entry_timers
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_project public.projects%rowtype;
  result public.time_entry_timers%rowtype;
begin
  select project.* into target_project
  from public.projects as project where project.id = target_project_id;
  if actor_id is null or target_project.id is null
    or target_project.client_id is null
    or not (select private.can_access_project(target_project_id))
  then
    raise insufficient_privilege using message = 'Project time access is required.';
  end if;
  if target_todo_id is not null and not exists (
    select 1 from public.todos as todo
    where todo.id = target_todo_id and todo.project_id = target_project_id
  ) then
    raise check_violation using message = 'Timer issue must belong to its project.';
  end if;
  if target_retainer_period_id is not null and not exists (
    select 1 from public.retainer_periods as period
    where period.id = target_retainer_period_id
      and period.organization_id = target_project.organization_id
      and period.client_id = target_project.client_id
      and current_date between period.period_start and period.period_end
      and period.status in ('planned', 'open')
      and period.locked_at is null
      and period.invoiced_at is null
  ) then
    raise check_violation using message = 'Timer retainer period is unavailable or locked.';
  end if;
  if char_length(btrim(coalesce(target_description, ''))) not between 1 and 1000 then
    raise check_violation using message = 'Timer description is required.';
  end if;
  insert into public.time_entry_timers (
    organization_id, profile_id, project_id, client_id, todo_id,
    retainer_period_id, description, billable
  )
  values (
    target_project.organization_id, actor_id, target_project.id,
    target_project.client_id, target_todo_id, target_retainer_period_id,
    btrim(target_description), target_billable
  )
  returning * into result;
  return result;
exception when unique_violation then
  raise object_in_use using message = 'A timer is already running.';
end;
$$;

create or replace function public.start_time_timer(
  target_project_id uuid,
  target_todo_id uuid default null,
  target_retainer_period_id uuid default null,
  target_description text default '',
  target_billable boolean default true
)
returns public.time_entry_timers
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.start_time_timer(
    target_project_id, target_todo_id, target_retainer_period_id,
    target_description, target_billable
  );
$$;

create or replace function private.stop_time_timer(
  target_timer_id uuid,
  target_stopped_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  timer public.time_entry_timers%rowtype;
  target_project public.projects%rowtype;
  raw_minutes integer;
  rounded_minutes integer;
  rounding_minutes integer;
  entry public.time_entries%rowtype;
  effective_stop timestamptz := least(coalesce(target_stopped_at, now()), now());
begin
  select item.* into timer
  from public.time_entry_timers as item
  where item.id = target_timer_id
  for update;
  if timer.id is null then
    raise no_data_found using message = 'Timer not found.';
  end if;
  if timer.profile_id <> actor_id then
    raise insufficient_privilege using message = 'Only the timer owner can stop it.';
  end if;
  if timer.status <> 'running' then
    if timer.status = 'stopped' then
      select * into entry from public.time_entries
      where id = timer.created_time_entry_id;
      return jsonb_build_object('timer', to_jsonb(timer), 'time_entry', to_jsonb(entry));
    end if;
    raise check_violation using message = 'This timer is no longer running.';
  end if;
  if effective_stop <= timer.started_at then
    raise check_violation using message = 'Timer stop must be after its start.';
  end if;
  raw_minutes := ceil(extract(epoch from (effective_stop - timer.started_at)) / 60.0);
  if raw_minutes > 1440 then
    raise check_violation using
      message = 'Timer exceeds 24 hours. Correct the entry manually or discard it.';
  end if;
  select project.* into target_project
  from public.projects as project where project.id = timer.project_id;
  rounding_minutes := coalesce(target_project.time_rounding_minutes, 1);
  rounded_minutes := least(1440, ceil(raw_minutes::numeric / rounding_minutes)::integer * rounding_minutes);
  if timer.retainer_period_id is not null and exists (
    select 1 from public.retainer_periods as period
    where period.id = timer.retainer_period_id
      and (period.locked_at is not null or period.invoiced_at is not null)
  ) then
    raise check_violation using message = 'The selected retainer period is locked or invoiced.';
  end if;
  entry := private.log_time_entry(
    timer.project_id,
    (timer.started_at at time zone 'UTC')::date,
    rounded_minutes,
    timer.description,
    timer.billable,
    timer.retainer_period_id,
    timer.todo_id,
    timer.profile_id,
    'timer:' || timer.id::text
  );
  update public.time_entries set source = 'timer' where id = entry.id
    returning * into entry;
  update public.time_entry_timers
  set status = 'stopped', stopped_at = effective_stop,
    created_time_entry_id = entry.id, updated_at = now()
  where id = timer.id
  returning * into timer;
  return jsonb_build_object(
    'timer', to_jsonb(timer),
    'time_entry', to_jsonb(entry),
    'raw_minutes', raw_minutes,
    'rounded_minutes', rounded_minutes,
    'rounding_minutes', rounding_minutes
  );
end;
$$;

create or replace function public.stop_time_timer(
  target_timer_id uuid,
  target_stopped_at timestamptz default now()
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.stop_time_timer(target_timer_id, target_stopped_at); $$;

create or replace function public.discard_time_timer(target_timer_id uuid)
returns public.time_entry_timers
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare result public.time_entry_timers%rowtype;
begin
  update public.time_entry_timers
  set status = 'discarded', stopped_at = now(), updated_at = now()
  where id = target_timer_id
    and profile_id = (select auth.uid())
    and status = 'running'
  returning * into result;
  if result.id is null then
    raise no_data_found using message = 'Running timer not found.';
  end if;
  return result;
end;
$$;

alter table public.project_cycles enable row level security;
alter table public.time_entry_timers enable row level security;

create policy "Project members can read cycles"
on public.project_cycles for select to authenticated
using ((select private.can_access_project(project_id)));
create policy "Project members can manage cycles"
on public.project_cycles for all to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Staff can read relevant timers"
on public.time_entry_timers for select to authenticated
using (
  profile_id = (select auth.uid())
  or (select private.has_organization_role(
    organization_id, array['admin', 'manager']::text[]
  ))
);

grant select, insert, update, delete on public.project_cycles to authenticated;
grant select on public.time_entry_timers to authenticated;
grant all on public.project_cycles, public.time_entry_timers to service_role;
grant execute on function public.start_time_timer(uuid, uuid, uuid, text, boolean)
  to authenticated, service_role;
grant execute on function public.stop_time_timer(uuid, timestamptz)
  to authenticated, service_role;
grant execute on function public.discard_time_timer(uuid)
  to authenticated, service_role;

revoke all on function private.enforce_planning_scope() from public, anon, authenticated;
revoke all on function private.enforce_locked_retainer_time() from public, anon, authenticated;
revoke all on function private.start_time_timer(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function private.stop_time_timer(uuid, timestamptz)
  from public, anon, authenticated;

grant select (
  rejection_reason
) on public.time_entries to authenticated;
