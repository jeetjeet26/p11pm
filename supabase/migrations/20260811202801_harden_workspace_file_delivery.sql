-- Keep privileged file resolution out of the exposed public schema.

create or replace function private.resolve_workspace_file_download(
  target_file_id uuid
)
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

revoke all on function private.resolve_workspace_file_download(uuid)
  from public, anon;
grant execute on function private.resolve_workspace_file_download(uuid)
  to authenticated, service_role;

create or replace function public.resolve_workspace_file_download(
  target_file_id uuid
)
returns table (
  bucket_id text,
  object_path text,
  file_name text,
  mime_type text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.resolve_workspace_file_download(target_file_id);
$$;

revoke all on function public.resolve_workspace_file_download(uuid)
  from public, anon;
grant execute on function public.resolve_workspace_file_download(uuid)
  to authenticated, service_role;
