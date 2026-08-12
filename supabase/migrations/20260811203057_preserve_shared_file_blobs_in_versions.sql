-- Preserve Basecamp's shared blob reference accounting in version history.
-- Blob-backed imports are never sent directly to the storage deletion outbox.

alter table public.file_versions
  add column if not exists blob_id uuid
    references public.file_blobs(id) on delete restrict;

update public.file_versions as version
set blob_id = file.blob_id
from public.files as file
where file.id = version.file_id
  and file.blob_id is not null
  and version.blob_id is null;

create index if not exists file_versions_blob_idx
  on public.file_versions (blob_id)
  where blob_id is not null;

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

drop trigger if exists queue_deleted_file_version_object on public.file_versions;

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
