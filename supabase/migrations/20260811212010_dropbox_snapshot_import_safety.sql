-- Make source-backed workspace imports idempotent and keep deduplicated blobs
-- compatible with logical file versions.

alter table public.file_versions
  drop constraint if exists file_versions_bucket_id_object_path_key;

create index if not exists file_versions_bucket_object_lookup_idx
  on public.file_versions (bucket_id, object_path);

drop index if exists public.files_source_identity_unique_idx;

create unique index files_source_identity_unique_idx
  on public.files (
    organization_id,
    project_id,
    source_system,
    source_account_id,
    source_file_id
  )
  nulls not distinct
  where source_system is not null
    and source_account_id is not null
    and source_file_id is not null;

create or replace function private.enforce_file_current_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.current_version_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.file_versions as version
    where version.id = new.current_version_id
      and version.file_id = new.id
  ) then
    raise check_violation using
      message = 'Current file version must belong to the same file.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_file_current_version()
  from public, anon, authenticated;

drop trigger if exists enforce_file_current_version on public.files;
create constraint trigger enforce_file_current_version
  after insert or update of current_version_id on public.files
  deferrable initially deferred
  for each row execute function private.enforce_file_current_version();

create or replace function private.enforce_file_version_blob_consistency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  file_organization_id uuid;
  blob public.file_blobs%rowtype;
begin
  if new.blob_id is null then
    return new;
  end if;

  select file.organization_id
  into file_organization_id
  from public.files as file
  where file.id = new.file_id;

  select candidate.*
  into blob
  from public.file_blobs as candidate
  where candidate.id = new.blob_id;

  if file_organization_id is null or not found then
    raise foreign_key_violation using message = 'File version target is missing.';
  end if;
  if blob.organization_id <> file_organization_id then
    raise check_violation using
      message = 'File version and blob must belong to the same organization.';
  end if;
  if new.bucket_id <> blob.bucket_id
    or new.size_bytes <> blob.size_bytes
    or new.checksum_sha256 is distinct from blob.sha256
  then
    raise check_violation using
      message = 'File version physical metadata must match its blob.';
  end if;
  if blob.status not in ('ready', 'unverified') then
    raise object_not_in_prerequisite_state using
      message = 'File versions require an available blob.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_file_version_blob_consistency()
  from public, anon, authenticated;

drop trigger if exists enforce_file_version_blob_consistency
  on public.file_versions;
create trigger enforce_file_version_blob_consistency
  before insert or update of
    file_id,
    blob_id,
    bucket_id,
    size_bytes,
    checksum_sha256
  on public.file_versions
  for each row execute function private.enforce_file_version_blob_consistency();
