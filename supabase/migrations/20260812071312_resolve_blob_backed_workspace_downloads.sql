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
    coalesce(blob.bucket_id, file.bucket_id),
    coalesce(blob.object_path, file.object_path),
    file.file_name,
    coalesce(file.mime_type, blob.mime_type)
  from public.files as file
  left join public.file_blobs as blob on blob.id = file.blob_id
  where file.id = target_file_id
    and file.trashed_at is null
    and private.can_access_file(file.id)
    and (
      (
        blob.id is not null
        and blob.status in ('ready', 'unverified')
        and blob.bucket_id is not null
        and blob.object_path is not null
      )
      or (
        file.blob_id is null
        and file.bucket_id is not null
        and file.object_path is not null
      )
    );
$$;

revoke all on function private.resolve_workspace_file_download(uuid)
  from public, anon, authenticated;
grant execute on function private.resolve_workspace_file_download(uuid)
  to authenticated, service_role;
