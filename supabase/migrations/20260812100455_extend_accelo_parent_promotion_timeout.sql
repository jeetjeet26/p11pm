-- Parent upserts fan out through source-aware triggers and can exceed the
-- default Data API timeout while remaining bounded by the worker deadline.
alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '240s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '245s';
