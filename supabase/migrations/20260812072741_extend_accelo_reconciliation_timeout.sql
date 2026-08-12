-- Full inventory reconciliation validates every requested domain against its
-- staged scan, source mapping, destination record, and approved exclusions.
-- Production-sized multi-domain runs exceed the Data API's default timeout
-- even though the work remains bounded by the worker deadline.
alter function private.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '90s';
alter function public.finalize_accelo_pull_run(uuid, uuid, jsonb, jsonb)
  set statement_timeout = '95s';
