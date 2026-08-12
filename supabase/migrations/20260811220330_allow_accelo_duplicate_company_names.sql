-- Accelo permits separate company records to share a display name and contains
-- one legacy one-character prospect. Provider identity, not display name, is
-- the canonical uniqueness boundary.
drop index public.clients_organization_normalized_name_key;

create index clients_organization_normalized_name_idx
  on public.clients (
    organization_id,
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  );

alter table public.clients
  drop constraint clients_name_check,
  add constraint clients_name_check
    check (char_length(btrim(name)) between 1 and 160);
