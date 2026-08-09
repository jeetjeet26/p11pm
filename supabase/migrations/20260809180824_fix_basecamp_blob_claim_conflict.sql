create or replace function public.claim_basecamp_file_blob(
  target_blob_id uuid,
  target_organization_id uuid,
  target_bucket_id text,
  target_object_path text,
  target_sha256 text,
  target_crc32 text,
  target_size_bytes bigint,
  target_mime_type text,
  target_lease_token uuid
)
returns table (
  id uuid,
  status text,
  tus_upload_url text,
  tus_offset_bytes bigint,
  bucket_id text,
  object_path text,
  claimed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  blob public.file_blobs%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  select candidate.*
  into blob
  from public.file_blobs as candidate
  where candidate.organization_id = target_organization_id
    and candidate.sha256 = target_sha256
    and candidate.size_bytes = target_size_bytes
    and candidate.status = 'ready'
  limit 1
  for update;

  if found then
    return query select
      blob.id,
      blob.status,
      blob.tus_upload_url,
      blob.tus_offset_bytes,
      blob.bucket_id,
      blob.object_path,
      false;
    return;
  end if;

  insert into public.file_blobs (
    id,
    organization_id,
    bucket_id,
    object_path,
    sha256,
    crc32,
    size_bytes,
    mime_type,
    status
  )
  values (
    target_blob_id,
    target_organization_id,
    target_bucket_id,
    target_object_path,
    target_sha256,
    target_crc32,
    target_size_bytes,
    target_mime_type,
    'pending'
  )
  on conflict on constraint file_blobs_bucket_path_unique do nothing;

  select candidate.*
  into blob
  from public.file_blobs as candidate
  where candidate.bucket_id = target_bucket_id
    and candidate.object_path = target_object_path
  for update;

  if not found then
    raise no_data_found using message = 'File blob claim could not be created.';
  end if;
  if blob.organization_id <> target_organization_id
    or blob.sha256 is distinct from target_sha256
    or blob.size_bytes <> target_size_bytes
  then
    raise check_violation using message = 'File blob claim identity mismatch.';
  end if;
  if blob.status = 'ready' then
    return query select
      blob.id,
      blob.status,
      blob.tus_upload_url,
      blob.tus_offset_bytes,
      blob.bucket_id,
      blob.object_path,
      false;
    return;
  end if;
  if blob.status = 'uploading'
    and blob.upload_lease_token is distinct from target_lease_token
    and blob.upload_lease_expires_at > statement_timestamp()
  then
    raise lock_not_available using
      message = 'File blob is leased by another importer.';
  end if;

  update public.file_blobs
  set
    status = 'uploading',
    upload_lease_token = target_lease_token,
    upload_lease_expires_at = statement_timestamp() + interval '5 minutes',
    upload_attempt_count = upload_attempt_count + 1,
    upload_started_at = coalesce(upload_started_at, statement_timestamp()),
    last_attempt_at = statement_timestamp(),
    last_error = null
  where file_blobs.id = blob.id
  returning * into blob;

  return query select
    blob.id,
    blob.status,
    blob.tus_upload_url,
    blob.tus_offset_bytes,
    blob.bucket_id,
    blob.object_path,
    true;
end;
$$;

revoke all on function public.claim_basecamp_file_blob(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.claim_basecamp_file_blob(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) to service_role;
