-- Promotion is deliberately bounded by the Vercel function deadline, but the
-- default Data API statement timeout is too short for a reconciled multi-page
-- shadow batch.
alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '90s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '95s';
