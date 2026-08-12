-- Preserve legacy project-scoped insert compatibility while retaining strict
-- organization validation for first-class workspace/client files.
create or replace function private.ensure_file_blob_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  file_organization_id uuid;
  blob public.file_blobs%rowtype;
  run_organization_id uuid;
begin
  if new.project_id is null then
    file_organization_id := new.organization_id;
    if file_organization_id is null then
      raise not_null_violation using
        message = 'Workspace file organization is required.';
    end if;
  else
    select project.organization_id
    into file_organization_id
    from public.projects as project
    where project.id = new.project_id;

    if file_organization_id is null then
      raise foreign_key_violation using message = 'File project does not exist.';
    end if;
    if new.organization_id is null then
      new.organization_id := file_organization_id;
    elsif new.organization_id is distinct from file_organization_id then
      raise check_violation using
        message = 'File project must belong to its organization.';
    end if;
  end if;

  if new.basecamp_export_run_id is not null then
    select run.organization_id
    into run_organization_id
    from public.basecamp_export_runs as run
    where run.id = new.basecamp_export_run_id;

    if run_organization_id is distinct from file_organization_id then
      raise check_violation using
        message = 'Logical file import run must match its organization.';
    end if;
    new.imported_at := coalesce(new.imported_at, now());
  end if;

  if new.blob_id is null then
    if new.bucket_id is null or new.object_path is null then
      if new.source_system is null
        or new.availability_status = 'available'
      then
        raise check_violation using
          message = 'An available logical file requires a physical target.';
      end if;
      return new;
    end if;

    insert into public.file_blobs (
      organization_id,
      bucket_id,
      object_path,
      sha256,
      size_bytes,
      mime_type,
      status,
      verified_at
    )
    values (
      file_organization_id,
      new.bucket_id,
      new.object_path,
      new.checksum_sha256,
      new.size_bytes,
      new.mime_type,
      case when new.checksum_sha256 is null then 'unverified' else 'ready' end,
      case when new.checksum_sha256 is null then null else now() end
    )
    on conflict (bucket_id, object_path) do update
    set object_path = excluded.object_path
    returning * into blob;

    new.blob_id := blob.id;
  else
    select candidate.*
    into blob
    from public.file_blobs as candidate
    where candidate.id = new.blob_id
    for key share;

    if not found then
      raise foreign_key_violation using message = 'File blob does not exist.';
    end if;
  end if;

  if blob.organization_id <> file_organization_id then
    raise check_violation using
      message = 'Logical file and blob must belong to the same organization.';
  end if;
  if blob.status = 'deleting' then
    raise object_not_in_prerequisite_state using
      message = 'A blob pending deletion cannot receive new references.';
  end if;
  if new.bucket_id is not null and (
    new.bucket_id <> blob.bucket_id
    or new.object_path is distinct from blob.object_path
  ) then
    raise check_violation using
      message = 'Logical file physical fields must match its blob.';
  end if;
  if new.size_bytes <> blob.size_bytes then
    raise check_violation using
      message = 'Logical file size must match its blob.';
  end if;

  return new;
end;
$$;

create or replace function private.normalize_project_commercial_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.billing_type := coalesce(new.billing_type, 'time_and_materials');
  new.source_payload := coalesce(new.source_payload, '{}'::jsonb);
  return new;
end;
$$;
