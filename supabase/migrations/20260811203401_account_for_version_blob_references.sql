-- Treat historical file versions as live references to shared Basecamp blobs.

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
