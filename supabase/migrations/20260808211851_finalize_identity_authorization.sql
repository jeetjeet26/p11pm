-- Reconcile identity scope with the later upload-reservation migration. Direct
-- object policies would bypass reservations, so finalized objects and reserved
-- uploads remain the only authenticated Storage paths.

create or replace function private.workspace_signup_is_allowed(
  candidate_id uuid,
  candidate_email text,
  marked_invite_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.profiles as profile
      where lower(profile.email) = lower(btrim(candidate_email))
        and profile.id = candidate_id
        and profile.organization_id is not null
        and profile.status = 'active'
    )
    or (
      nullif(btrim(marked_invite_id), '') is not null
      and exists (
        select 1
        from public.invites as invitation
        where invitation.id::text = btrim(marked_invite_id)
          and lower(invitation.email) = lower(btrim(candidate_email))
          and invitation.status = 'pending'
          and invitation.accepted_at is null
          and invitation.expires_at > statement_timestamp()
          and (
            not exists (
              select 1
              from public.profiles as profile
              where lower(profile.email) = lower(btrim(candidate_email))
            )
            or exists (
              select 1
              from public.profiles as profile
              where lower(profile.email) = lower(btrim(candidate_email))
                and profile.id = candidate_id
            )
          )
      )
    );
$$;

revoke all on function private.workspace_signup_is_allowed(uuid, text, text)
  from public;

create or replace function private.hook_restrict_workspace_signup(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.workspace_signup_is_allowed(
    nullif(event #>> '{user,id}', '')::uuid,
    event #>> '{user,email}',
    event #>> '{user,app_metadata,workspace_invite_id}'
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'This workspace is invite-only.'
    )
  );
end;
$$;

revoke all on function private.hook_restrict_workspace_signup(jsonb)
  from public, anon, authenticated;
grant execute on function private.hook_restrict_workspace_signup(jsonb)
  to supabase_auth_admin;

-- The Auth hook gives a clean rejection when configured. This trigger is the
-- fail-closed database backstop, so an Auth setting change cannot create an
-- unrostered identity.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.workspace_signup_is_allowed(
    new.id,
    new.email,
    new.raw_app_meta_data ->> 'workspace_invite_id'
  ) then
    raise insufficient_privilege using
      message = 'This workspace is invite-only.';
  end if;

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
    lower(new.email),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1),
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

revoke all on function private.handle_new_user() from public;

create or replace function private.can_access_upload_project(
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_project(target_project_id);
$$;

revoke all on function private.can_access_upload_project(uuid) from public;
grant execute on function private.can_access_upload_project(uuid)
  to authenticated, service_role;

drop policy if exists "Project members can read project files"
  on storage.objects;
drop policy if exists "Project members can upload project files"
  on storage.objects;
drop policy if exists "Project members can update project files"
  on storage.objects;
drop policy if exists "Project members can delete project files"
  on storage.objects;
