-- Basecamp's project-level client_name is legacy display data, not an Accelo
-- company record. Remove the synthetic clients created from those names and
-- prevent future Basecamp imports from recreating them.

create or replace function private.backfill_project_clients()
returns integer
language sql
security definer
set search_path = ''
as $$
  select 0;
$$;

create or replace function private.normalize_project_commercial_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.billing_type := coalesce(new.billing_type, 'time_and_materials');
  return new;
end;
$$;

create temporary table basecamp_bootstrap_clients
on commit drop
as
select client.id
from public.clients as client
where client.external_id is null
  and client.metadata = '{}'::jsonb
  and exists (
    select 1
    from public.projects as project
    where project.client_id = client.id
  )
  and not exists (
    select 1 from public.client_contacts as item where item.client_id = client.id
  )
  and not exists (
    select 1 from public.retainers as item where item.client_id = client.id
  )
  and not exists (
    select 1 from public.client_activities as item where item.client_id = client.id
  )
  and not exists (
    select 1 from public.time_entries as item where item.client_id = client.id
  )
  and not exists (
    select 1 from public.invoices as item where item.client_id = client.id
  )
  and not exists (
    select 1 from public.payments as item where item.client_id = client.id
  )
  and not exists (
    select 1 from public.staff_billing_rates as item where item.client_id = client.id
  );

update public.projects as project
set client_id = null
from basecamp_bootstrap_clients as bootstrap
where project.client_id = bootstrap.id;

delete from public.clients as client
using basecamp_bootstrap_clients as bootstrap
where client.id = bootstrap.id;
