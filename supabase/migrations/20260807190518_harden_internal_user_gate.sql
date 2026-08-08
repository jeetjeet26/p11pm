-- Public Auth users must not inherit workspace access until an invite, import,
-- or staff sync binds their profile to an organization and activates it.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    status,
    chat_enabled
  )
  values (
    new.id,
    lower(coalesce(new.email, new.id::text || '@invalid.local')),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    'suspended',
    true
  )
  on conflict (id) do update
  set chat_enabled = true,
      updated_at = now();

  return new;
end;
$$;

create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and status = 'active'
      and organization_id is not null
  );
$$;
