create index files_dropbox_content_identity_idx
  on public.files (
    organization_id,
    source_account_id,
    size_bytes,
    (source_payload ->> 'content_hash')
  )
  where source_system = 'dropbox'
    and availability_status = 'available'
    and blob_id is not null;
