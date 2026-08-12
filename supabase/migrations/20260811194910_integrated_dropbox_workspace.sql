-- Integrated Dropbox-style workspace.
-- Logical hierarchy lives in Postgres; object paths remain immutable in Storage.

create table public.file_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid references public.file_folders(id) on delete restrict,
  project_id uuid references public.projects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 255),
  description text,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  trashed_at timestamptz,
  trashed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint file_folders_scope_valid check (
    project_id is null or client_id is null
  ),
  constraint file_folders_trash_valid check (
    (trashed_at is null and trashed_by is null)
    or (trashed_at is not null and trashed_by is not null)
  )
);

create unique index file_folders_active_sibling_name_key
  on public.file_folders (
    organization_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  where trashed_at is null;
create index file_folders_parent_list_idx
  on public.file_folders (organization_id, parent_id, name, id)
  where trashed_at is null;
create index file_folders_project_idx
  on public.file_folders (project_id, parent_id, name, id)
  where project_id is not null and trashed_at is null;
create index file_folders_client_idx
  on public.file_folders (client_id, parent_id, name, id)
  where client_id is not null and trashed_at is null;
create index file_folders_trash_idx
  on public.file_folders (organization_id, trashed_at desc, id)
  where trashed_at is not null;

alter table public.files
  alter column project_id drop not null,
  add column organization_id uuid references public.organizations(id) on delete cascade,
  add column folder_id uuid references public.file_folders(id) on delete restrict,
  add column client_id uuid references public.clients(id) on delete set null,
  add column description text,
  add column trashed_at timestamptz,
  add column trashed_by uuid references public.profiles(id) on delete set null,
  add column version_count integer not null default 0 check (version_count >= 0);

update public.files as file
set organization_id = project.organization_id,
    client_id = project.client_id
from public.projects as project
where project.id = file.project_id
  and file.organization_id is null;

alter table public.files
  alter column organization_id set not null,
  add constraint files_scope_valid check (
    project_id is not null or client_id is not null or organization_id is not null
  ),
  add constraint files_trash_valid check (
    (trashed_at is null and trashed_by is null)
    or (trashed_at is not null and trashed_by is not null)
  );

create index files_active_sibling_name_idx
  on public.files (
    organization_id,
    coalesce(
      folder_id,
      project_id,
      client_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ),
    lower(file_name)
  )
  where trashed_at is null;
create index files_folder_list_idx
  on public.files (organization_id, folder_id, file_name, id)
  where trashed_at is null;
create index files_client_idx
  on public.files (client_id, created_at desc, id)
  where client_id is not null and trashed_at is null;
create index files_trash_idx
  on public.files (organization_id, trashed_at desc, id)
  where trashed_at is not null;

create table public.file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  blob_id uuid references public.file_blobs(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  bucket_id text not null check (bucket_id = 'project-files'),
  object_path text not null check (
    char_length(btrim(object_path)) between 1 and 1024
    and object_path !~ '(^|/)\.\.(/|$)'
  ),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum_sha256 text check (
    checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (file_id, version_number),
  unique (bucket_id, object_path)
);

insert into public.file_versions (
  file_id,
  blob_id,
  version_number,
  bucket_id,
  object_path,
  file_name,
  mime_type,
  size_bytes,
  checksum_sha256,
  created_by,
  metadata,
  created_at
)
select
  file.id,
  file.blob_id,
  1,
  file.bucket_id,
  file.object_path,
  file.file_name,
  file.mime_type,
  file.size_bytes,
  file.checksum_sha256,
  file.uploaded_by,
  file.metadata || jsonb_build_object('migrated_current_version', true),
  file.created_at
from public.files as file
where file.bucket_id is not null
  and file.object_path is not null
on conflict (file_id, version_number) do nothing;

alter table public.files
  add column current_version_id uuid references public.file_versions(id) on delete restrict;

update public.files as file
set current_version_id = version.id,
    version_count = 1
from public.file_versions as version
where version.file_id = file.id
  and version.version_number = 1
  and file.current_version_id is null;

create index file_versions_file_created_idx
  on public.file_versions (file_id, version_number desc, id);

create table public.file_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  folder_id uuid references public.file_folders(id) on delete cascade,
  shared_with_profile_id uuid references public.profiles(id) on delete cascade,
  guest_email text,
  token_hash text unique,
  permission text not null default 'view'
    check (permission in ('view', 'comment', 'edit')),
  password_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint file_shares_target_valid check (
    (file_id is not null)::integer + (folder_id is not null)::integer = 1
  ),
  constraint file_shares_recipient_valid check (
    (
      shared_with_profile_id is not null
      and guest_email is null
      and token_hash is null
    )
    or (
      shared_with_profile_id is null
      and guest_email is not null
      and token_hash is not null
    )
  ),
  constraint file_shares_guest_email_valid check (
    guest_email is null
    or (guest_email = lower(guest_email) and position('@' in guest_email) > 1)
  ),
  constraint file_shares_token_valid check (
    token_hash is null or char_length(token_hash) >= 32
  )
);

create unique index file_shares_profile_file_key
  on public.file_shares (file_id, shared_with_profile_id)
  where file_id is not null and shared_with_profile_id is not null and revoked_at is null;
create unique index file_shares_profile_folder_key
  on public.file_shares (folder_id, shared_with_profile_id)
  where folder_id is not null and shared_with_profile_id is not null and revoked_at is null;
create index file_shares_recipient_idx
  on public.file_shares (shared_with_profile_id, created_at desc, id)
  where shared_with_profile_id is not null and revoked_at is null;

create table public.file_comments (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  parent_id uuid references public.file_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index file_comments_file_created_idx
  on public.file_comments (file_id, created_at, id);

create table public.file_favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  folder_id uuid references public.file_folders(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint file_favorites_target_valid check (
    (file_id is not null)::integer + (folder_id is not null)::integer = 1
  )
);
create unique index file_favorites_profile_file_key
  on public.file_favorites (profile_id, file_id)
  where file_id is not null;
create unique index file_favorites_profile_folder_key
  on public.file_favorites (profile_id, folder_id)
  where folder_id is not null;

create or replace function private.file_folder_scope_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.file_folders;
  project_org uuid;
  project_client uuid;
  client_org uuid;
begin
  if new.parent_id = new.id then
    raise check_violation using message = 'A folder cannot contain itself.';
  end if;

  if new.parent_id is not null then
    select item.* into parent
    from public.file_folders as item
    where item.id = new.parent_id;
    if not found or parent.organization_id <> new.organization_id then
      raise check_violation using message = 'Parent folder must belong to the same organization.';
    end if;
    if parent.project_id is distinct from new.project_id
      or parent.client_id is distinct from new.client_id
    then
      raise check_violation using message = 'Nested folders must keep the same project or client scope.';
    end if;
    if exists (
      with recursive ancestors as (
        select item.id, item.parent_id
        from public.file_folders as item
        where item.id = new.parent_id
        union all
        select item.id, item.parent_id
        from public.file_folders as item
        join ancestors on ancestors.parent_id = item.id
      )
      select 1 from ancestors where id = new.id
    ) then
      raise check_violation using message = 'Folder moves cannot create a cycle.';
    end if;
  end if;

  if new.project_id is not null then
    select project.organization_id, project.client_id
      into project_org, project_client
    from public.projects as project
    where project.id = new.project_id;
    new.organization_id := coalesce(new.organization_id, project_org);
    new.client_id := coalesce(new.client_id, project_client);
    if project_org is distinct from new.organization_id then
      raise check_violation using message = 'Project folder organization mismatch.';
    end if;
  elsif new.client_id is not null then
    select client.organization_id into client_org
    from public.clients as client
    where client.id = new.client_id;
    new.organization_id := coalesce(new.organization_id, client_org);
    if client_org is distinct from new.organization_id then
      raise check_violation using message = 'Client folder organization mismatch.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_file_folder_scope
  before insert or update of organization_id, parent_id, project_id, client_id
  on public.file_folders
  for each row execute function private.file_folder_scope_valid();

create or replace function private.file_scope_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder public.file_folders;
  project_org uuid;
  project_client uuid;
  client_org uuid;
begin
  new.version_count := coalesce(new.version_count, 1);
  if new.folder_id is not null then
    select item.* into folder
    from public.file_folders as item
    where item.id = new.folder_id;
    if not found or folder.organization_id <> new.organization_id then
      raise check_violation using message = 'File folder must belong to the same organization.';
    end if;
    if folder.project_id is distinct from new.project_id
      or folder.client_id is distinct from new.client_id
    then
      raise check_violation using message = 'File must keep the folder scope.';
    end if;
  end if;
  if new.project_id is not null then
    select project.organization_id, project.client_id
      into project_org, project_client
    from public.projects as project
    where project.id = new.project_id;
    new.organization_id := coalesce(new.organization_id, project_org);
    new.client_id := coalesce(new.client_id, project_client);
    if project_org is distinct from new.organization_id then
      raise check_violation using message = 'File project organization mismatch.';
    end if;
  elsif new.client_id is not null then
    select client.organization_id into client_org
    from public.clients as client
    where client.id = new.client_id;
    new.organization_id := coalesce(new.organization_id, client_org);
    if client_org is distinct from new.organization_id then
      raise check_violation using message = 'File client organization mismatch.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_file_scope
  before insert or update of organization_id, folder_id, project_id, client_id
  on public.files
  for each row execute function private.file_scope_valid();

create trigger mark_file_folders_updated_at
  before update on public.file_folders
  for each row execute function private.set_updated_at();
create trigger mark_file_comments_updated_at
  before update on public.file_comments
  for each row execute function private.set_updated_at();
create trigger capture_file_folder_activity
  after insert or update or delete on public.file_folders
  for each row execute function private.capture_activity_event('file_folder');

create or replace function private.enqueue_unreferenced_file_blob(
  target_blob_id uuid,
  deletion_reason text,
  deletion_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  blob public.file_blobs%rowtype;
begin
  if target_blob_id is null then
    return null;
  end if;

  select candidate.*
  into blob
  from public.file_blobs as candidate
  where candidate.id = target_blob_id
  for update;

  if not found
    or exists (select 1 from public.files as file where file.blob_id = blob.id)
    or exists (
      select 1
      from public.basecamp_archive_entries as entry
      where entry.blob_id = blob.id
    )
    or exists (
      select 1
      from public.file_versions as version
      where version.blob_id = blob.id
    )
  then
    return null;
  end if;

  update public.file_blobs
  set status = 'deleting', last_error = null
  where id = blob.id
    and status <> 'deleting';

  return private.enqueue_storage_deletion(
    blob.bucket_id,
    blob.object_path,
    deletion_reason,
    coalesce(deletion_metadata, '{}'::jsonb)
      || jsonb_build_object('blobId', blob.id)
  );
end;
$$;

create or replace function private.queue_deleted_file_version_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.blob_id is null then
    perform private.enqueue_storage_deletion(
      old.bucket_id,
      old.object_path,
      'file_version_metadata_deleted',
      jsonb_build_object(
        'resourceId', old.id,
        'fileId', old.file_id,
        'versionNumber', old.version_number
      )
    );
  else
    perform private.enqueue_unreferenced_file_blob(
      old.blob_id,
      'file_version_blob_unreferenced',
      jsonb_build_object(
        'resourceId', old.id,
        'fileId', old.file_id,
        'versionNumber', old.version_number
      )
    );
  end if;
  return old;
end;
$$;
revoke all on function private.queue_deleted_file_version_object()
  from public, anon, authenticated;
create trigger queue_deleted_file_version_object
  after delete on public.file_versions
  for each row execute function private.queue_deleted_file_version_object();

create or replace function private.can_access_file_folder(target_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.file_folders as folder
    where folder.id = target_folder_id
      and (
        (
          folder.project_id is null
          and private.has_organization_role(
            folder.organization_id,
            array['admin', 'manager', 'member']::text[]
          )
        )
        or (
          folder.project_id is not null
          and private.can_access_project(folder.project_id)
        )
        or exists (
          select 1
          from public.file_shares as share
          where share.folder_id = folder.id
            and share.shared_with_profile_id = (select auth.uid())
            and share.revoked_at is null
            and (share.expires_at is null or share.expires_at > now())
        )
      )
  );
$$;

create or replace function private.can_access_file(target_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.files as file
    where file.id = target_file_id
      and (
        (
          file.project_id is null
          and private.has_organization_role(
            file.organization_id,
            array['admin', 'manager', 'member']::text[]
          )
        )
        or (
          file.project_id is not null
          and private.can_access_project(file.project_id)
        )
        or exists (
          select 1
          from public.file_shares as share
          where share.file_id = file.id
            and share.shared_with_profile_id = (select auth.uid())
            and share.revoked_at is null
            and (share.expires_at is null or share.expires_at > now())
        )
        or (
          file.folder_id is not null
          and private.can_access_file_folder(file.folder_id)
        )
      )
  );
$$;

revoke all on function private.can_access_file_folder(uuid) from public;
revoke all on function private.can_access_file(uuid) from public;
grant execute on function private.can_access_file_folder(uuid) to authenticated, service_role;
grant execute on function private.can_access_file(uuid) to authenticated, service_role;

create or replace function public.resolve_workspace_file_download(target_file_id uuid)
returns table (
  bucket_id text,
  object_path text,
  file_name text,
  mime_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    file.bucket_id,
    file.object_path,
    file.file_name,
    file.mime_type
  from public.files as file
  where file.id = target_file_id
    and file.trashed_at is null
    and file.bucket_id is not null
    and file.object_path is not null
    and private.can_access_file(file.id);
$$;
revoke all on function public.resolve_workspace_file_download(uuid)
  from public, anon;
grant execute on function public.resolve_workspace_file_download(uuid)
  to authenticated;

alter table public.file_folders enable row level security;
alter table public.file_versions enable row level security;
alter table public.file_shares enable row level security;
alter table public.file_comments enable row level security;
alter table public.file_favorites enable row level security;

drop policy if exists "Project members can view files" on public.files;
drop policy if exists "Project members can add files" on public.files;
drop policy if exists "File owners and project managers can update files" on public.files;
drop policy if exists "File owners and project managers can delete files" on public.files;

create policy "Members can read accessible files"
on public.files for select to authenticated
using (
  (
    project_id is null
    and (select private.has_organization_role(
      organization_id,
      array['admin', 'manager', 'member']::text[]
    ))
  )
  or (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (select private.can_access_file(id))
);
create policy "Members can create scoped files"
on public.files for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
  and (folder_id is null or (select private.can_access_file_folder(folder_id)))
);
create policy "Members can update accessible files"
on public.files for update to authenticated
using ((select private.can_access_file(id)))
with check (
  (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);
create policy "Owners and managers can permanently delete files"
on public.files for delete to authenticated
using (
  uploaded_by = (select auth.uid())
  or (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);

create policy "Members can read accessible folders"
on public.file_folders for select to authenticated
using (
  (
    project_id is null
    and (select private.has_organization_role(
      organization_id,
      array['admin', 'manager', 'member']::text[]
    ))
  )
  or (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (select private.can_access_file_folder(id))
);
create policy "Members can create scoped folders"
on public.file_folders for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);
create policy "Members can update accessible folders"
on public.file_folders for update to authenticated
using ((select private.can_access_file_folder(id)))
with check ((select private.can_access_organization(organization_id)));
create policy "Managers can delete folders"
on public.file_folders for delete to authenticated
using ((select private.has_organization_role(
  organization_id,
  array['admin', 'manager']::text[]
)));

create policy "Members can read accessible versions"
on public.file_versions for select to authenticated
using ((select private.can_access_file(file_id)));
create policy "Members can add accessible versions"
on public.file_versions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_file(file_id))
);

create policy "Recipients can read file shares"
on public.file_shares for select to authenticated
using (
  shared_with_profile_id = (select auth.uid())
  or created_by = (select auth.uid())
  or (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);
create policy "Editors can create file shares"
on public.file_shares for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_organization(organization_id))
  and (
    (file_id is not null and (select private.can_access_file(file_id)))
    or (folder_id is not null and (select private.can_access_file_folder(folder_id)))
  )
);
create policy "Share creators can update file shares"
on public.file_shares for update to authenticated
using (
  created_by = (select auth.uid())
  or (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);
create policy "Share creators can delete file shares"
on public.file_shares for delete to authenticated
using (
  created_by = (select auth.uid())
  or (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);

create policy "Members can read file comments"
on public.file_comments for select to authenticated
using ((select private.can_access_file(file_id)));
create policy "Members can create file comments"
on public.file_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.can_access_file(file_id))
);
create policy "Authors can update file comments"
on public.file_comments for update to authenticated
using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()));
create policy "Authors can delete file comments"
on public.file_comments for delete to authenticated
using (author_id = (select auth.uid()));

create policy "People can manage file favorites"
on public.file_favorites for all to authenticated
using (profile_id = (select auth.uid()))
with check (
  profile_id = (select auth.uid())
  and (
    (file_id is not null and (select private.can_access_file(file_id)))
    or (folder_id is not null and (select private.can_access_file_folder(folder_id)))
  )
);

grant select, insert, update, delete on
  public.file_folders,
  public.file_shares,
  public.file_comments,
  public.file_favorites
to authenticated;
grant select (
  organization_id,
  folder_id,
  client_id,
  description,
  trashed_at,
  trashed_by,
  version_count,
  current_version_id
) on public.files to authenticated;
grant select, insert on public.file_versions to authenticated;
grant all on
  public.file_folders,
  public.file_versions,
  public.file_shares,
  public.file_comments,
  public.file_favorites
to service_role;

-- Extend upload reservations without changing the existing public RPC signature.
alter table public.upload_reservations
  add column folder_id uuid references public.file_folders(id) on delete cascade,
  add column organization_id uuid references public.organizations(id) on delete cascade;

alter table public.upload_reservations
  drop constraint upload_reservations_target_kind_check,
  drop constraint upload_reservations_target_valid,
  add constraint upload_reservations_target_kind_check
    check (target_kind in ('project_file', 'chat_attachment', 'workspace_file')),
  add constraint upload_reservations_target_valid check (
    (
      target_kind = 'project_file'
      and project_id is not null
      and conversation_id is null
      and folder_id is null
      and bucket_id = 'project-files'
    )
    or (
      target_kind = 'chat_attachment'
      and project_id is null
      and conversation_id is not null
      and folder_id is null
      and bucket_id = 'workspace-chat-files'
    )
    or (
      target_kind = 'workspace_file'
      and conversation_id is null
      and folder_id is not null
      and organization_id is not null
      and bucket_id = 'project-files'
    )
  );

create or replace function private.upload_resource_payload(
  reservation public.upload_reservations
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if reservation.resource_id is null then
    return null;
  end if;
  if reservation.target_kind in ('project_file', 'workspace_file') then
    select jsonb_build_object(
      'id', file.id,
      'projectId', file.project_id,
      'folderId', file.folder_id,
      'title', file.file_name,
      'kind', 'file',
      'authorId', file.uploaded_by,
      'sizeBytes', file.size_bytes,
      'updatedAt', file.updated_at
    )
    into result
    from public.files as file
    where file.id = reservation.resource_id;
  else
    select jsonb_build_object(
      'id', attachment.id,
      'fileName', attachment.file_name,
      'mimeType', attachment.mime_type,
      'sizeBytes', attachment.size_bytes
    )
    into result
    from public.workspace_message_attachments as attachment
    where attachment.id = reservation.resource_id;
  end if;
  return result;
end;
$$;

create or replace function private.create_workspace_file_upload(
  target_folder_id uuid,
  upload_file_name text,
  upload_mime_type text,
  upload_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.upload_reservations;
  folder public.file_folders;
  safe_name text;
begin
  if (select auth.uid()) is null or not (select private.is_internal_user()) then
    raise insufficient_privilege using message = 'An active account is required.';
  end if;
  select item.* into folder
  from public.file_folders as item
  where item.id = target_folder_id
    and item.trashed_at is null;
  if not found or not (select private.can_access_file_folder(folder.id)) then
    raise insufficient_privilege using message = 'Folder access is required.';
  end if;
  if char_length(btrim(coalesce(upload_file_name, ''))) not between 1 and 255 then
    raise check_violation using message = 'File names must contain 1 to 255 characters.';
  end if;
  if upload_size_bytes not between 1 and 26214400 then
    raise check_violation using message = 'Files must be between 1 byte and 25 MB.';
  end if;
  if exists (
    select 1 from public.files as file
    where file.folder_id = folder.id
      and lower(file.file_name) = lower(btrim(upload_file_name))
      and file.trashed_at is null
  ) then
    raise unique_violation using message = 'A file with that name already exists.';
  end if;

  safe_name := regexp_replace(btrim(upload_file_name), '[^a-zA-Z0-9._-]+', '-', 'g');
  safe_name := right(btrim(regexp_replace(safe_name, '-+', '-', 'g'), '-'), 180);
  if safe_name = '' then safe_name := 'file'; end if;

  result.id := gen_random_uuid();
  insert into public.upload_reservations (
    id, target_kind, project_id, folder_id, organization_id, uploader_id,
    bucket_id, object_path, file_name, mime_type, size_bytes
  )
  values (
    result.id, 'workspace_file', folder.project_id, folder.id,
    folder.organization_id, (select auth.uid()), 'project-files',
    format(
      'workspace/%s/%s/%s-%s',
      folder.organization_id,
      (select auth.uid()),
      result.id,
      safe_name
    ),
    btrim(upload_file_name), nullif(btrim(upload_mime_type), ''), upload_size_bytes
  )
  returning * into result;
  return private.upload_reservation_payload(result);
end;
$$;

create or replace function public.create_workspace_file_upload(
  target_folder_id uuid,
  upload_file_name text,
  upload_mime_type text,
  upload_size_bytes bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_workspace_file_upload(
    target_folder_id,
    upload_file_name,
    upload_mime_type,
    upload_size_bytes
  );
$$;

revoke all on function private.create_workspace_file_upload(uuid, text, text, bigint)
  from public, anon;
revoke all on function public.create_workspace_file_upload(uuid, text, text, bigint)
  from public, anon;
grant execute on function private.create_workspace_file_upload(uuid, text, text, bigint)
  to authenticated;
grant execute on function public.create_workspace_file_upload(uuid, text, text, bigint)
  to authenticated;

create or replace function private.can_upload_reserved_object(
  target_bucket_id text,
  target_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.upload_reservations as reservation
    where reservation.bucket_id = target_bucket_id
      and reservation.object_path = target_object_path
      and reservation.uploader_id = (select auth.uid())
      and reservation.status = 'pending'
      and reservation.expires_at > now()
      and (
        (
          reservation.target_kind = 'project_file'
          and private.can_access_upload_project(reservation.project_id)
        )
        or (
          reservation.target_kind = 'workspace_file'
          and private.can_access_file_folder(reservation.folder_id)
        )
        or (
          reservation.target_kind = 'chat_attachment'
          and private.can_access_workspace_conversation(reservation.conversation_id)
        )
      )
  );
$$;

create or replace function private.finalize_workspace_file_upload(
  reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.upload_reservations;
  observed_size bigint;
  observed_mime text;
  result_id uuid;
  version_id uuid;
  folder public.file_folders;
begin
  select candidate.* into reservation
  from public.upload_reservations as candidate
  where candidate.id = reservation_id
    and candidate.uploader_id = (select auth.uid())
    and candidate.target_kind = 'workspace_file'
  for update;
  if not found then return null; end if;
  if reservation.status <> 'pending' then
    return private.upload_reservation_payload(reservation);
  end if;
  if reservation.expires_at <= now()
    or not private.can_access_file_folder(reservation.folder_id)
  then
    update public.upload_reservations
    set status = 'failed', failure_reason = 'upload_access_revoked'
    where id = reservation.id
    returning * into reservation;
    perform private.enqueue_storage_deletion(
      reservation.bucket_id,
      reservation.object_path,
      'workspace_upload_access_revoked',
      jsonb_build_object('reservationId', reservation.id)
    );
    return private.upload_reservation_payload(reservation);
  end if;

  select item.* into folder
  from public.file_folders as item
  where item.id = reservation.folder_id and item.trashed_at is null;

  select
    case when object.metadata ->> 'size' ~ '^[0-9]+$'
      then (object.metadata ->> 'size')::bigint end,
    nullif(object.metadata ->> 'mimetype', '')
  into observed_size, observed_mime
  from storage.objects as object
  where object.bucket_id = reservation.bucket_id
    and object.name = reservation.object_path;
  if not found then
    return private.upload_reservation_payload(reservation)
      || jsonb_build_object('finalizeError', 'upload_not_complete');
  end if;
  if observed_size is null or observed_size <> reservation.size_bytes then
    update public.upload_reservations
    set status = 'failed', failure_reason = 'size_mismatch'
    where id = reservation.id
    returning * into reservation;
    perform private.enqueue_storage_deletion(
      reservation.bucket_id,
      reservation.object_path,
      'workspace_upload_size_mismatch',
      jsonb_build_object('reservationId', reservation.id)
    );
    return private.upload_reservation_payload(reservation);
  end if;

  insert into public.files (
    organization_id, project_id, client_id, folder_id, uploaded_by,
    bucket_id, object_path, file_name, mime_type, size_bytes, metadata,
    current_version_id
  )
  values (
    folder.organization_id, folder.project_id, folder.client_id, folder.id,
    reservation.uploader_id, reservation.bucket_id, reservation.object_path,
    reservation.file_name, coalesce(observed_mime, reservation.mime_type),
    observed_size, jsonb_build_object('upload_reservation_id', reservation.id),
    -- Temporarily satisfied after inserting the first version below.
    gen_random_uuid()
  )
  returning id into result_id;

  -- Replace the deferred placeholder by creating the canonical first version.
  insert into public.file_versions (
    file_id, version_number, bucket_id, object_path, file_name,
    mime_type, size_bytes, created_by, metadata
  )
  values (
    result_id, 1, reservation.bucket_id, reservation.object_path,
    reservation.file_name, coalesce(observed_mime, reservation.mime_type),
    observed_size, reservation.uploader_id,
    jsonb_build_object('upload_reservation_id', reservation.id)
  )
  returning id into version_id;

  update public.files set current_version_id = version_id where id = result_id;
  update public.upload_reservations
  set status = 'finalized', progress_bytes = size_bytes, resource_id = result_id,
      finalized_at = now(), failure_reason = null
  where id = reservation.id
  returning * into reservation;
  return private.upload_reservation_payload(reservation);
exception
  when foreign_key_violation then
    -- `current_version_id` is non-null and references versions, so create the
    -- file through a deferred constraint-free helper path in the API migration.
    raise;
end;
$$;

-- The current version FK must be deferrable so a new file and its first version
-- can be created atomically in either order.
alter table public.files
  drop constraint files_current_version_id_fkey,
  add constraint files_current_version_id_fkey
    foreign key (current_version_id) references public.file_versions(id)
    on delete set null deferrable initially deferred;

create or replace function public.finalize_workspace_file_upload(
  reservation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.finalize_workspace_file_upload(reservation_id);
$$;

revoke all on function private.finalize_workspace_file_upload(uuid)
  from public, anon;
revoke all on function public.finalize_workspace_file_upload(uuid)
  from public, anon;
grant execute on function private.finalize_workspace_file_upload(uuid)
  to authenticated;
grant execute on function public.finalize_workspace_file_upload(uuid)
  to authenticated;

-- Files and folders participate in the Slack-style workspace cross-link graph.
alter table public.workspace_cross_links
  alter column project_id drop not null,
  add column folder_id uuid references public.file_folders(id) on delete cascade;

alter table public.workspace_cross_links
  drop constraint workspace_cross_links_work_type_check,
  drop constraint workspace_cross_links_work_shape,
  add constraint workspace_cross_links_work_type_check check (
    work_type in (
      'project', 'issue', 'comment', 'message', 'doc', 'file', 'folder',
      'milestone', 'archive_record'
    )
  ),
  add constraint workspace_cross_links_work_shape check (
    (
      work_type = 'project'
      and work_id = project_id
      and num_nonnulls(
        todo_id, comment_id, project_message_id, doc_id, file_id, folder_id,
        milestone_id, archive_record_id
      ) = 0
    )
    or (
      work_type <> 'project'
      and num_nonnulls(
        todo_id, comment_id, project_message_id, doc_id, file_id, folder_id,
        milestone_id, archive_record_id
      ) = 1
      and work_id = case work_type
        when 'issue' then todo_id
        when 'comment' then comment_id
        when 'message' then project_message_id
        when 'doc' then doc_id
        when 'file' then file_id
        when 'folder' then folder_id
        when 'milestone' then milestone_id
        when 'archive_record' then archive_record_id
      end
    )
  );

create or replace function private.validate_workspace_cross_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_organization_id uuid;
  work_organization_id uuid;
  attached_message_id uuid;
begin
  new.todo_id := null;
  new.comment_id := null;
  new.project_message_id := null;
  new.doc_id := null;
  new.file_id := null;
  new.folder_id := null;
  new.milestone_id := null;
  new.archive_record_id := null;

  case new.chat_type
    when 'conversation' then
      select conversation.organization_id into chat_organization_id
      from public.workspace_conversations as conversation
      where conversation.id = new.conversation_id;
    when 'message' then
      select conversation.organization_id, message.conversation_id
      into chat_organization_id, new.conversation_id
      from public.workspace_messages as message
      join public.workspace_conversations as conversation
        on conversation.id = message.conversation_id
      where message.id = new.workspace_message_id;
    when 'attachment' then
      select conversation.organization_id, attachment.conversation_id,
        attachment.message_id
      into chat_organization_id, new.conversation_id, attached_message_id
      from public.workspace_message_attachments as attachment
      join public.workspace_conversations as conversation
        on conversation.id = attachment.conversation_id
      where attachment.id = new.workspace_attachment_id;
      if attached_message_id is null then
        raise check_violation using
          message = 'Pending chat attachments cannot be cross-linked.';
      end if;
  end case;
  if chat_organization_id is null then
    raise foreign_key_violation using message = 'Chat target does not exist.';
  end if;

  case new.work_type
    when 'project' then
      new.project_id := new.work_id;
      select project.organization_id into work_organization_id
      from public.projects as project where project.id = new.work_id;
    when 'issue' then
      select todo.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.todos as todo
      join public.projects as project on project.id = todo.project_id
      where todo.id = new.work_id;
      new.todo_id := new.work_id;
    when 'comment' then
      select comment.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.comments as comment
      join public.projects as project on project.id = comment.project_id
      where comment.id = new.work_id;
      new.comment_id := new.work_id;
    when 'message' then
      select message.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.messages as message
      join public.projects as project on project.id = message.project_id
      where message.id = new.work_id;
      new.project_message_id := new.work_id;
    when 'doc' then
      select doc.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.docs as doc
      join public.projects as project on project.id = doc.project_id
      where doc.id = new.work_id;
      new.doc_id := new.work_id;
    when 'file' then
      select file.project_id, file.organization_id
      into new.project_id, work_organization_id
      from public.files as file where file.id = new.work_id;
      new.file_id := new.work_id;
    when 'folder' then
      select folder.project_id, folder.organization_id
      into new.project_id, work_organization_id
      from public.file_folders as folder where folder.id = new.work_id;
      new.folder_id := new.work_id;
    when 'milestone' then
      select milestone.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.milestones as milestone
      join public.projects as project on project.id = milestone.project_id
      where milestone.id = new.work_id;
      new.milestone_id := new.work_id;
    when 'archive_record' then
      select record.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.basecamp_archive_records as record
      join public.projects as project on project.id = record.project_id
      where record.id = new.work_id;
      new.archive_record_id := new.work_id;
  end case;
  if work_organization_id is null then
    raise foreign_key_violation using message = 'Work target does not exist.';
  end if;
  if chat_organization_id <> work_organization_id then
    raise check_violation using
      message = 'Cross-links must remain in one organization.';
  end if;
  new.organization_id := work_organization_id;
  if new.created_by is null then new.created_by := (select auth.uid()); end if;
  if (select auth.uid()) is not null and new.created_by <> (select auth.uid()) then
    raise insufficient_privilege using
      message = 'Cross-links must be created as the signed-in user.';
  end if;
  return new;
end;
$$;

create policy "Members can read file workspace cross-links"
on public.workspace_cross_links for select to authenticated
using (
  (select private.can_access_workspace_conversation(conversation_id))
  and (
    (work_type = 'file' and (select private.can_access_file(file_id)))
    or (work_type = 'folder' and (select private.can_access_file_folder(folder_id)))
  )
);
create policy "Members can create file workspace cross-links"
on public.workspace_cross_links for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
  and (
    (work_type = 'file' and (select private.can_access_file(file_id)))
    or (work_type = 'folder' and (select private.can_access_file_folder(folder_id)))
  )
);
create policy "Members can remove file workspace cross-links"
on public.workspace_cross_links for delete to authenticated
using (
  created_by = (select auth.uid())
  and (
    (work_type = 'file' and (select private.can_access_file(file_id)))
    or (work_type = 'folder' and (select private.can_access_file_folder(folder_id)))
  )
);

alter table public.workspace_inbox_items
  drop constraint workspace_inbox_items_kind_check,
  add constraint workspace_inbox_items_kind_check check (
    kind in (
      'mention', 'assignment', 'thread_reply', 'approval', 'due', 'overdue',
      'blocker', 'watch', 'automation', 'integration', 'file_share',
      'file_comment'
    )
  );

create or replace function private.notify_file_workspace_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_file public.files;
  target_recipient uuid;
  target_kind text;
  target_title text;
  target_source_type text;
  target_source_id text;
begin
  if tg_table_name = 'file_shares' then
    if new.shared_with_profile_id is null then return new; end if;
    select file.* into target_file from public.files as file where file.id = new.file_id;
    target_recipient := new.shared_with_profile_id;
    target_kind := 'file_share';
    target_title := 'A file was shared with you';
    target_source_type := 'file_share';
    target_source_id := new.id::text;
  else
    select file.* into target_file from public.files as file where file.id = new.file_id;
    target_recipient := target_file.uploaded_by;
    if target_recipient is null or target_recipient = new.author_id then return new; end if;
    target_kind := 'file_comment';
    target_title := 'New comment on ' || left(target_file.file_name, 180);
    target_source_type := 'file_comment';
    target_source_id := new.id::text;
  end if;
  if target_file.id is null then return new; end if;
  insert into public.workspace_inbox_items (
    organization_id, recipient_id, actor_id, project_id, kind, title, body,
    href, source_type, source_id
  )
  values (
    target_file.organization_id, target_recipient, (select auth.uid()),
    target_file.project_id, target_kind, target_title,
    case when tg_table_name = 'file_comments' then left(new.body, 500) end,
    '/files?file=' || target_file.id::text
      || case when target_file.folder_id is not null
        then '&folderId=' || target_file.folder_id::text else '' end,
    target_source_type, target_source_id
  )
  on conflict (recipient_id, kind, source_type, source_id) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_file_workspace_event()
  from public, anon, authenticated;
create trigger notify_internal_file_share
  after insert on public.file_shares
  for each row execute function private.notify_file_workspace_event();
create trigger notify_file_comment
  after insert on public.file_comments
  for each row execute function private.notify_file_workspace_event();

-- Existing organizations receive editable top-level team spaces.
insert into public.file_folders (organization_id, name)
select organization.id, root.name
from public.organizations as organization
cross join (
  values
    ('Clients'),
    ('Creative Resources'),
    ('Human Resources'),
    ('Operations'),
    ('Sales and Marketing'),
    ('Technology')
) as root(name)
on conflict do nothing;
