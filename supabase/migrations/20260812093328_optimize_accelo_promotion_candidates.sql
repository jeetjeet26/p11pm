-- Promotion repeatedly asks for the newest eligible source version. Cover that
-- ordering directly so each bounded batch does not rescan the full staging
-- history.
create index accelo_pull_stage_promotion_candidate_idx
  on public.accelo_pull_stage (
    organization_id,
    entity_type,
    source_record_id,
    source_updated_at desc nulls last,
    transformer_version desc,
    staged_at desc,
    id desc
  )
  where normalized_payload is not null
    and not source_deleted;

create index accelo_unresolved_stage_state_idx
  on public.accelo_unresolved_dependencies (
    stage_record_id,
    resolution_state
  );
