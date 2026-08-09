create or replace function private.queue_unreferenced_file_blob()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_blob_id uuid;
  prior_row jsonb;
begin
  prior_row := to_jsonb(old);
  prior_blob_id := old.blob_id;

  if tg_table_name = 'files' then
    update public.upload_reservations as reservation
    set
      status = 'failed',
      resource_id = null,
      finalized_at = null,
      failure_reason = 'finalized_metadata_deleted'
    where reservation.resource_id = old.id
      and reservation.target_kind = 'project_file'
      and reservation.status = 'finalized';
  end if;

  if prior_blob_id is not null
    and (
      tg_op = 'DELETE'
      or prior_blob_id is distinct from new.blob_id
    )
  then
    perform private.enqueue_unreferenced_file_blob(
      prior_blob_id,
      tg_table_name || '_blob_unreferenced',
      jsonb_build_object(
        'resourceId', old.id,
        'sourceTable', tg_table_name
      )
    );
  elsif prior_blob_id is null
    and tg_table_name = 'files'
    and tg_op = 'DELETE'
    and nullif(prior_row ->> 'bucket_id', '') is not null
    and nullif(prior_row ->> 'object_path', '') is not null
  then
    perform private.enqueue_storage_deletion(
      prior_row ->> 'bucket_id',
      prior_row ->> 'object_path',
      'legacy_project_file_metadata_deleted',
      jsonb_build_object('resourceId', old.id)
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.queue_unreferenced_file_blob() from public;
