-- Promotion can reconcile staged records from an earlier partial run during a
-- later leased run. Preserve both identities without requiring the stage row
-- and quarantine observation to share the same run.
alter table public.accelo_pull_quarantine
  drop constraint
    accelo_pull_quarantine_organization_id_run_id_stage_record_fkey,
  add constraint accelo_pull_quarantine_organization_stage_record_fkey
    foreign key (organization_id, stage_record_id)
    references public.accelo_pull_stage(organization_id, id)
    on delete restrict;
