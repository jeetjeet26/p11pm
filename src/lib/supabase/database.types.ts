export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accelo_authority_transition_events: {
        Row: {
          actor_id: string
          entity_type: string
          evidence: Json
          evidence_run_id: string | null
          id: string
          organization_id: string
          previous_state: string
          reason: string
          source_account_id: string
          target_state: string
          transitioned_at: string
        }
        Insert: {
          actor_id: string
          entity_type: string
          evidence?: Json
          evidence_run_id?: string | null
          id?: string
          organization_id: string
          previous_state: string
          reason: string
          source_account_id: string
          target_state: string
          transitioned_at?: string
        }
        Update: {
          actor_id?: string
          entity_type?: string
          evidence?: Json
          evidence_run_id?: string | null
          id?: string
          organization_id?: string
          previous_state?: string
          reason?: string
          source_account_id?: string
          target_state?: string
          transitioned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_authority_transition_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_authority_transition_events_evidence_run_id_fkey"
            columns: ["evidence_run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_authority_transition_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_orphan_archive: {
        Row: {
          approval_reason: string | null
          approval_state: string
          approved_at: string | null
          approved_by: string | null
          archive_reason_code: string
          archived_at: string
          entity_type: string
          field_sha256: string
          id: string
          normalized_payload: Json | null
          organization_id: string
          payload_sha256: string
          raw_payload: Json
          relationship_sha256: string
          required_parent_identity: Json
          source_account_id: string
          source_record_id: string
          stage_record_id: string
          unresolved_id: string
        }
        Insert: {
          approval_reason?: string | null
          approval_state?: string
          approved_at?: string | null
          approved_by?: string | null
          archive_reason_code: string
          archived_at?: string
          entity_type: string
          field_sha256: string
          id?: string
          normalized_payload?: Json | null
          organization_id: string
          payload_sha256: string
          raw_payload: Json
          relationship_sha256: string
          required_parent_identity: Json
          source_account_id: string
          source_record_id: string
          stage_record_id: string
          unresolved_id: string
        }
        Update: {
          approval_reason?: string | null
          approval_state?: string
          approved_at?: string | null
          approved_by?: string | null
          archive_reason_code?: string
          archived_at?: string
          entity_type?: string
          field_sha256?: string
          id?: string
          normalized_payload?: Json | null
          organization_id?: string
          payload_sha256?: string
          raw_payload?: Json
          relationship_sha256?: string
          required_parent_identity?: Json
          source_account_id?: string
          source_record_id?: string
          stage_record_id?: string
          unresolved_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_orphan_archive_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_orphan_archive_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_orphan_archive_stage_record_id_fkey"
            columns: ["stage_record_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_stage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_orphan_archive_unresolved_id_fkey"
            columns: ["unresolved_id"]
            isOneToOne: true
            referencedRelation: "accelo_unresolved_dependencies"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_promotion_journal: {
        Row: {
          after_image: Json | null
          before_image: Json | null
          destination_record_id: string
          destination_table: string
          entity_type: string
          operation: string
          organization_id: string
          recorded_at: string
          run_id: string
          sequence_id: number
          source_record_id: string | null
        }
        Insert: {
          after_image?: Json | null
          before_image?: Json | null
          destination_record_id: string
          destination_table: string
          entity_type: string
          operation: string
          organization_id: string
          recorded_at?: string
          run_id: string
          sequence_id?: never
          source_record_id?: string | null
        }
        Update: {
          after_image?: Json | null
          before_image?: Json | null
          destination_record_id?: string
          destination_table?: string
          entity_type?: string
          operation?: string
          organization_id?: string
          recorded_at?: string
          run_id?: string
          sequence_id?: never
          source_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accelo_promotion_journal_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_promotion_journal_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_promotion_run_context: {
        Row: {
          authority_snapshot: Json
          captured_at: string
          organization_id: string
          run_id: string
          schedule_snapshot: Json
          source_mapping_snapshot: Json
        }
        Insert: {
          authority_snapshot?: Json
          captured_at?: string
          organization_id: string
          run_id: string
          schedule_snapshot?: Json
          source_mapping_snapshot?: Json
        }
        Update: {
          authority_snapshot?: Json
          captured_at?: string
          organization_id?: string
          run_id?: string
          schedule_snapshot?: Json
          source_mapping_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "accelo_promotion_run_context_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_promotion_run_context_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_pull_checkpoints: {
        Row: {
          checkpoint_key: string
          completed_at: string
          content_sha256: string
          cursor: Json
          entity_type: string
          high_watermark: string | null
          id: string
          organization_id: string
          page_number: number | null
          record_count: number
          run_id: string
          source_account_id: string
        }
        Insert: {
          checkpoint_key: string
          completed_at?: string
          content_sha256: string
          cursor?: Json
          entity_type: string
          high_watermark?: string | null
          id?: string
          organization_id: string
          page_number?: number | null
          record_count: number
          run_id: string
          source_account_id: string
        }
        Update: {
          checkpoint_key?: string
          completed_at?: string
          content_sha256?: string
          cursor?: Json
          entity_type?: string
          high_watermark?: string | null
          id?: string
          organization_id?: string
          page_number?: number | null
          record_count?: number
          run_id?: string
          source_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_pull_checkpoints_organization_id_run_id_fkey"
            columns: ["organization_id", "run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      accelo_pull_quarantine: {
        Row: {
          entity_type: string
          id: string
          organization_id: string
          payload_sha256: string | null
          quarantined_at: string
          raw_payload: Json
          reason_code: string
          reason_detail: string | null
          run_id: string
          source_record_id: string
          stage_record_id: string | null
        }
        Insert: {
          entity_type: string
          id?: string
          organization_id: string
          payload_sha256?: string | null
          quarantined_at?: string
          raw_payload: Json
          reason_code: string
          reason_detail?: string | null
          run_id: string
          source_record_id: string
          stage_record_id?: string | null
        }
        Update: {
          entity_type?: string
          id?: string
          organization_id?: string
          payload_sha256?: string | null
          quarantined_at?: string
          raw_payload?: Json
          reason_code?: string
          reason_detail?: string | null
          run_id?: string
          source_record_id?: string
          stage_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accelo_pull_quarantine_organization_id_run_id_fkey"
            columns: ["organization_id", "run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "accelo_pull_quarantine_organization_stage_record_fkey"
            columns: ["organization_id", "stage_record_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_stage"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      accelo_pull_reconciliations: {
        Row: {
          approved_exclusion_count: number
          created_at: string
          destination_count: number
          destination_missing_count: number
          details: Json
          entity_type: string
          expected_count: number | null
          field_hash_mismatch_count: number
          financial_destination: Json
          financial_source: Json
          id: string
          inserted_count: number
          latest_unique_staged_count: number
          mapped_count: number
          organization_id: string
          quarantined_count: number
          reconciled_at: string | null
          relationship_mismatch_count: number
          relationship_missing_count: number
          run_id: string
          source_deleted_count: number
          staged_count: number
          status: string
          unchanged_count: number
          updated_at: string
          updated_count: number
        }
        Insert: {
          approved_exclusion_count?: number
          created_at?: string
          destination_count?: number
          destination_missing_count?: number
          details?: Json
          entity_type: string
          expected_count?: number | null
          field_hash_mismatch_count?: number
          financial_destination?: Json
          financial_source?: Json
          id?: string
          inserted_count?: number
          latest_unique_staged_count?: number
          mapped_count?: number
          organization_id: string
          quarantined_count?: number
          reconciled_at?: string | null
          relationship_mismatch_count?: number
          relationship_missing_count?: number
          run_id: string
          source_deleted_count?: number
          staged_count?: number
          status?: string
          unchanged_count?: number
          updated_at?: string
          updated_count?: number
        }
        Update: {
          approved_exclusion_count?: number
          created_at?: string
          destination_count?: number
          destination_missing_count?: number
          details?: Json
          entity_type?: string
          expected_count?: number | null
          field_hash_mismatch_count?: number
          financial_destination?: Json
          financial_source?: Json
          id?: string
          inserted_count?: number
          latest_unique_staged_count?: number
          mapped_count?: number
          organization_id?: string
          quarantined_count?: number
          reconciled_at?: string | null
          relationship_mismatch_count?: number
          relationship_missing_count?: number
          run_id?: string
          source_deleted_count?: number
          staged_count?: number
          status?: string
          unchanged_count?: number
          updated_at?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "accelo_pull_reconciliations_organization_id_run_id_fkey"
            columns: ["organization_id", "run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      accelo_pull_runs: {
        Row: {
          created_at: string
          direction: string | null
          end_cursor: Json | null
          error_message: string | null
          finalized_at: string | null
          full_snapshot: boolean
          heartbeat_at: string | null
          id: string
          idempotency_key: string
          lease_acquired_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          manifest: Json
          organization_id: string
          provider: string
          records_mapped: number
          records_quarantined: number
          records_scanned: number
          records_staged: number
          requested_entities: string[]
          source_account_id: string
          start_cursor: Json | null
          started_at: string | null
          status: string
          summary: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction?: string | null
          end_cursor?: Json | null
          error_message?: string | null
          finalized_at?: string | null
          full_snapshot?: boolean
          heartbeat_at?: string | null
          id?: string
          idempotency_key: string
          lease_acquired_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          manifest?: Json
          organization_id: string
          provider?: string
          records_mapped?: number
          records_quarantined?: number
          records_scanned?: number
          records_staged?: number
          requested_entities: string[]
          source_account_id: string
          start_cursor?: Json | null
          started_at?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string | null
          end_cursor?: Json | null
          error_message?: string | null
          finalized_at?: string | null
          full_snapshot?: boolean
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string
          lease_acquired_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          manifest?: Json
          organization_id?: string
          provider?: string
          records_mapped?: number
          records_quarantined?: number
          records_scanned?: number
          records_staged?: number
          requested_entities?: string[]
          source_account_id?: string
          start_cursor?: Json | null
          started_at?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_pull_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_pull_stage: {
        Row: {
          entity_type: string
          field_sha256: string | null
          id: string
          normalized_payload: Json | null
          organization_id: string
          payload_sha256: string | null
          raw_payload: Json
          relationship_sha256: string | null
          run_id: string
          source_deleted: boolean
          source_record_id: string
          source_updated_at: string | null
          staged_at: string
          transformer_version: number
        }
        Insert: {
          entity_type: string
          field_sha256?: string | null
          id?: string
          normalized_payload?: Json | null
          organization_id: string
          payload_sha256?: string | null
          raw_payload: Json
          relationship_sha256?: string | null
          run_id: string
          source_deleted?: boolean
          source_record_id: string
          source_updated_at?: string | null
          staged_at?: string
          transformer_version?: number
        }
        Update: {
          entity_type?: string
          field_sha256?: string | null
          id?: string
          normalized_payload?: Json | null
          organization_id?: string
          payload_sha256?: string | null
          raw_payload?: Json
          relationship_sha256?: string | null
          run_id?: string
          source_deleted?: boolean
          source_record_id?: string
          source_updated_at?: string | null
          staged_at?: string
          transformer_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "accelo_pull_stage_organization_id_run_id_fkey"
            columns: ["organization_id", "run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      accelo_recovery_attempt_events: {
        Row: {
          attempt_number: number
          detail: Json
          id: number
          organization_id: string
          outcome: string
          recorded_at: string
          run_id: string
          unresolved_id: string
        }
        Insert: {
          attempt_number: number
          detail?: Json
          id?: never
          organization_id: string
          outcome: string
          recorded_at?: string
          run_id: string
          unresolved_id: string
        }
        Update: {
          attempt_number?: number
          detail?: Json
          id?: never
          organization_id?: string
          outcome?: string
          recorded_at?: string
          run_id?: string
          unresolved_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_recovery_attempt_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_recovery_attempt_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_recovery_attempt_events_unresolved_id_fkey"
            columns: ["unresolved_id"]
            isOneToOne: false
            referencedRelation: "accelo_unresolved_dependencies"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_recovery_stage_links: {
        Row: {
          created_at: string
          organization_id: string
          run_id: string
          stage_record_id: string
          unresolved_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          run_id: string
          stage_record_id: string
          unresolved_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          run_id?: string
          stage_record_id?: string
          unresolved_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_recovery_stage_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_recovery_stage_links_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_recovery_stage_links_stage_record_id_fkey"
            columns: ["stage_record_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_stage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_recovery_stage_links_unresolved_id_fkey"
            columns: ["unresolved_id"]
            isOneToOne: false
            referencedRelation: "accelo_unresolved_dependencies"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_rollback_attempts: {
        Row: {
          actor_id: string
          completed_at: string | null
          conflict_count: number
          conflicts: Json
          id: string
          organization_id: string
          reason: string
          restored_count: number
          run_id: string
          started_at: string
          status: string
        }
        Insert: {
          actor_id: string
          completed_at?: string | null
          conflict_count?: number
          conflicts?: Json
          id?: string
          organization_id: string
          reason: string
          restored_count?: number
          run_id: string
          started_at?: string
          status: string
        }
        Update: {
          actor_id?: string
          completed_at?: string | null
          conflict_count?: number
          conflicts?: Json
          id?: string
          organization_id?: string
          reason?: string
          restored_count?: number
          run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_rollback_attempts_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_rollback_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_rollback_attempts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_source_mapping_journal: {
        Row: {
          after_image: Json | null
          before_image: Json | null
          mapping_id: string
          operation: string
          organization_id: string
          recorded_at: string
          run_id: string
          sequence_id: number
        }
        Insert: {
          after_image?: Json | null
          before_image?: Json | null
          mapping_id: string
          operation: string
          organization_id: string
          recorded_at?: string
          run_id: string
          sequence_id?: never
        }
        Update: {
          after_image?: Json | null
          before_image?: Json | null
          mapping_id?: string
          operation?: string
          organization_id?: string
          recorded_at?: string
          run_id?: string
          sequence_id?: never
        }
        Relationships: [
          {
            foreignKeyName: "accelo_source_mapping_journal_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_source_mapping_journal_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_sync_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor: string | null
          direction: string
          error_message: string | null
          id: string
          metadata: Json
          organization_id: string
          project_id: string | null
          records_created: number
          records_failed: number
          records_scanned: number
          records_updated: number
          started_at: string | null
          status: string
          trigger_type: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          direction?: string
          error_message?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          project_id?: string | null
          records_created?: number
          records_failed?: number
          records_scanned?: number
          records_updated?: number
          started_at?: string | null
          status?: string
          trigger_type?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          direction?: string
          error_message?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          project_id?: string | null
          records_created?: number
          records_failed?: number
          records_scanned?: number
          records_updated?: number
          started_at?: string | null
          status?: string
          trigger_type?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_sync_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_sync_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_sync_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_unresolved_dependencies: {
        Row: {
          approved_disposition: string | null
          attempt_count: number
          child_identity: Json
          entity_type: string
          first_seen_at: string
          first_seen_run_id: string
          id: string
          last_attempted_at: string
          last_seen_run_id: string
          organization_id: string
          reason_code: string
          reason_detail: string | null
          recovery_attempt_count: number
          recovery_last_attempted_at: string | null
          recovery_reason_code: string | null
          recovery_status: string
          required_parent_identity: Json
          resolution_reason: string | null
          resolution_state: string
          resolved_at: string | null
          resolved_by: string | null
          source_account_id: string
          source_record_id: string
          stage_record_id: string
          transformer_version: number
          updated_at: string
        }
        Insert: {
          approved_disposition?: string | null
          attempt_count?: number
          child_identity: Json
          entity_type: string
          first_seen_at?: string
          first_seen_run_id: string
          id?: string
          last_attempted_at?: string
          last_seen_run_id: string
          organization_id: string
          reason_code: string
          reason_detail?: string | null
          recovery_attempt_count?: number
          recovery_last_attempted_at?: string | null
          recovery_reason_code?: string | null
          recovery_status?: string
          required_parent_identity: Json
          resolution_reason?: string | null
          resolution_state?: string
          resolved_at?: string | null
          resolved_by?: string | null
          source_account_id: string
          source_record_id: string
          stage_record_id: string
          transformer_version: number
          updated_at?: string
        }
        Update: {
          approved_disposition?: string | null
          attempt_count?: number
          child_identity?: Json
          entity_type?: string
          first_seen_at?: string
          first_seen_run_id?: string
          id?: string
          last_attempted_at?: string
          last_seen_run_id?: string
          organization_id?: string
          reason_code?: string
          reason_detail?: string | null
          recovery_attempt_count?: number
          recovery_last_attempted_at?: string | null
          recovery_reason_code?: string | null
          recovery_status?: string
          required_parent_identity?: Json
          resolution_reason?: string | null
          resolution_state?: string
          resolved_at?: string | null
          resolved_by?: string | null
          source_account_id?: string
          source_record_id?: string
          stage_record_id?: string
          transformer_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_unresolved_dependencie_organization_id_stage_record_fkey"
            columns: ["organization_id", "stage_record_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_stage"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "accelo_unresolved_dependencies_first_seen_run_id_fkey"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_unresolved_dependencies_last_seen_run_id_fkey"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_unresolved_dependencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_unresolved_dependencies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accelo_unresolved_disposition_events: {
        Row: {
          actor_id: string
          disposition: string
          id: number
          organization_id: string
          reason: string
          recorded_at: string
          unresolved_id: string
        }
        Insert: {
          actor_id: string
          disposition: string
          id?: never
          organization_id: string
          reason: string
          recorded_at?: string
          unresolved_id: string
        }
        Update: {
          actor_id?: string
          disposition?: string
          id?: never
          organization_id?: string
          reason?: string
          recorded_at?: string
          unresolved_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accelo_unresolved_disposition_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_unresolved_disposition_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accelo_unresolved_disposition_events_unresolved_id_fkey"
            columns: ["unresolved_id"]
            isOneToOne: false
            referencedRelation: "accelo_unresolved_dependencies"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          organization_id: string | null
          project_id: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          project_id?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          project_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rule_runs: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          event_key: string
          id: string
          input: Json
          last_error: string | null
          max_attempts: number
          organization_id: string
          output: Json
          requested_by: string | null
          rule_id: string
          started_at: string | null
          status: string
          trigger_source_id: string | null
          trigger_source_type: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          event_key: string
          id?: string
          input?: Json
          last_error?: string | null
          max_attempts?: number
          organization_id: string
          output?: Json
          requested_by?: string | null
          rule_id: string
          started_at?: string | null
          status?: string
          trigger_source_id?: string | null
          trigger_source_type?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          event_key?: string
          id?: string
          input?: Json
          last_error?: string | null
          max_attempts?: number
          organization_id?: string
          output?: Json
          requested_by?: string | null
          rule_id?: string
          started_at?: string | null
          status?: string
          trigger_source_id?: string | null
          trigger_source_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rule_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string
          created_by: string
          enabled: boolean
          id: string
          name: string
          organization_id: string
          project_id: string | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          created_at?: string
          created_by?: string
          enabled?: boolean
          id?: string
          name: string
          organization_id: string
          project_id?: string | null
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string
          created_by?: string
          enabled?: boolean
          id?: string
          name?: string
          organization_id?: string
          project_id?: string | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_run_attempts: {
        Row: {
          attempt_number: number
          completed_at: string | null
          error: string | null
          id: number
          organization_id: string
          output: Json
          run_id: string
          started_at: string
          status: string
        }
        Insert: {
          attempt_number: number
          completed_at?: string | null
          error?: string | null
          id?: never
          organization_id: string
          output?: Json
          run_id: string
          started_at?: string
          status: string
        }
        Update: {
          attempt_number?: number
          completed_at?: string | null
          error?: string | null
          id?: never
          organization_id?: string
          output?: Json
          run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_run_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_run_attempts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_rule_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_archive_entries: {
        Row: {
          blob_id: string | null
          classification: string
          compressed_size_bytes: number
          crc32: string
          created_at: string
          data_offset: number | null
          entry_type: string
          file_name: string
          id: string
          local_header_offset: number | null
          metadata: Json
          project_id: string | null
          run_id: string
          source_created_at: string | null
          source_id: string | null
          source_modified_at: string | null
          source_parent_id: string | null
          source_path: string
          source_updated_at: string | null
          uncompressed_size_bytes: number
          updated_at: string
        }
        Insert: {
          blob_id?: string | null
          classification: string
          compressed_size_bytes: number
          crc32: string
          created_at?: string
          data_offset?: number | null
          entry_type: string
          file_name: string
          id?: string
          local_header_offset?: number | null
          metadata?: Json
          project_id?: string | null
          run_id: string
          source_created_at?: string | null
          source_id?: string | null
          source_modified_at?: string | null
          source_parent_id?: string | null
          source_path: string
          source_updated_at?: string | null
          uncompressed_size_bytes: number
          updated_at?: string
        }
        Update: {
          blob_id?: string | null
          classification?: string
          compressed_size_bytes?: number
          crc32?: string
          created_at?: string
          data_offset?: number | null
          entry_type?: string
          file_name?: string
          id?: string
          local_header_offset?: number | null
          metadata?: Json
          project_id?: string | null
          run_id?: string
          source_created_at?: string | null
          source_id?: string | null
          source_modified_at?: string | null
          source_parent_id?: string | null
          source_path?: string
          source_updated_at?: string | null
          uncompressed_size_bytes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_archive_entries_blob_id_fkey"
            columns: ["blob_id"]
            isOneToOne: false
            referencedRelation: "file_blobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basecamp_archive_entries_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_archive_record_entries: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          metadata: Json
          ordinal: number
          record_id: string
          reference_role: string
          source_locator: string | null
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          metadata?: Json
          ordinal?: number
          record_id: string
          reference_role: string
          source_locator?: string | null
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          metadata?: Json
          ordinal?: number
          record_id?: string
          reference_role?: string
          source_locator?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_archive_record_entries_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "basecamp_archive_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basecamp_archive_record_entries_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "basecamp_archive_records"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_archive_records: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          native_creator_id: number | null
          native_recording_id: number | null
          parent_id: string | null
          plain_text: string | null
          project_id: string | null
          record_type: string
          run_id: string
          sanitized_html: string | null
          search_vector: unknown
          source_created_at: string | null
          source_exported_at: string | null
          source_locator: string
          source_path: string
          source_status: string | null
          source_updated_at: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          native_creator_id?: number | null
          native_recording_id?: number | null
          parent_id?: string | null
          plain_text?: string | null
          project_id?: string | null
          record_type: string
          run_id: string
          sanitized_html?: string | null
          search_vector?: unknown
          source_created_at?: string | null
          source_exported_at?: string | null
          source_locator: string
          source_path: string
          source_status?: string | null
          source_updated_at?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          native_creator_id?: number | null
          native_recording_id?: number | null
          parent_id?: string | null
          plain_text?: string | null
          project_id?: string | null
          record_type?: string
          run_id?: string
          sanitized_html?: string | null
          search_vector?: unknown
          source_created_at?: string | null
          source_exported_at?: string | null
          source_locator?: string
          source_path?: string
          source_status?: string | null
          source_updated_at?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_archive_records_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "basecamp_archive_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basecamp_archive_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_export_conflicts: {
        Row: {
          conflict: Json
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          local_row: Json
          project_id: string
          resolution: string
          resolved_at: string | null
          run_id: string
          source_key: string
          staged_payload: Json
        }
        Insert: {
          conflict: Json
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          local_row: Json
          project_id: string
          resolution?: string
          resolved_at?: string | null
          run_id: string
          source_key: string
          staged_payload: Json
        }
        Update: {
          conflict?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          local_row?: Json
          project_id?: string
          resolution?: string
          resolved_at?: string | null
          run_id?: string
          source_key?: string
          staged_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_export_conflicts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_export_preimages: {
        Row: {
          captured_at: string
          entity_id: string | null
          entity_type: string
          id: string
          operation: string
          preimage: Json | null
          project_id: string
          run_id: string
          source_key: string
          staged_payload: Json
        }
        Insert: {
          captured_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          operation: string
          preimage?: Json | null
          project_id: string
          run_id: string
          source_key: string
          staged_payload: Json
        }
        Update: {
          captured_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          operation?: string
          preimage?: Json | null
          project_id?: string
          run_id?: string
          source_key?: string
          staged_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_export_preimages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_export_project_status: {
        Row: {
          attempt_count: number
          created_at: string
          errors: Json
          expected_counts: Json
          is_read_only: boolean
          project_id: string
          promoted_at: string | null
          promoted_counts: Json
          run_id: string
          source_project_id: number | null
          staged_counts: Json
          status: string
          summary: Json
          updated_at: string
          validated_at: string | null
          warnings: Json
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          errors?: Json
          expected_counts?: Json
          is_read_only?: boolean
          project_id: string
          promoted_at?: string | null
          promoted_counts?: Json
          run_id: string
          source_project_id?: number | null
          staged_counts?: Json
          status?: string
          summary?: Json
          updated_at?: string
          validated_at?: string | null
          warnings?: Json
        }
        Update: {
          attempt_count?: number
          created_at?: string
          errors?: Json
          expected_counts?: Json
          is_read_only?: boolean
          project_id?: string
          promoted_at?: string | null
          promoted_counts?: Json
          run_id?: string
          source_project_id?: number | null
          staged_counts?: Json
          status?: string
          summary?: Json
          updated_at?: string
          validated_at?: string | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_export_project_status_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_export_runs: {
        Row: {
          account_id: number
          archive_name: string
          archive_sha256: string | null
          archive_size_bytes: number
          blob_count_expected: number
          blob_count_ready: number
          bytes_hashed: number
          bytes_total: number
          bytes_uploaded: number
          completed_at: string | null
          created_at: string
          entry_count_expected: number
          entry_count_processed: number
          error_count: number
          errors: Json
          exported_at: string
          id: string
          inventory_completed_at: string | null
          manifest: Json
          manifest_sha256: string
          organization_id: string
          parser_version: string
          phase: string
          progress: Json
          record_count_expected: number
          record_count_processed: number
          started_at: string
          status: string
          updated_at: string
          warning_count: number
          warnings: Json
        }
        Insert: {
          account_id: number
          archive_name: string
          archive_sha256?: string | null
          archive_size_bytes: number
          blob_count_expected?: number
          blob_count_ready?: number
          bytes_hashed?: number
          bytes_total?: number
          bytes_uploaded?: number
          completed_at?: string | null
          created_at?: string
          entry_count_expected?: number
          entry_count_processed?: number
          error_count?: number
          errors?: Json
          exported_at: string
          id?: string
          inventory_completed_at?: string | null
          manifest?: Json
          manifest_sha256: string
          organization_id: string
          parser_version: string
          phase?: string
          progress?: Json
          record_count_expected?: number
          record_count_processed?: number
          started_at?: string
          status?: string
          updated_at?: string
          warning_count?: number
          warnings?: Json
        }
        Update: {
          account_id?: number
          archive_name?: string
          archive_sha256?: string | null
          archive_size_bytes?: number
          blob_count_expected?: number
          blob_count_ready?: number
          bytes_hashed?: number
          bytes_total?: number
          bytes_uploaded?: number
          completed_at?: string | null
          created_at?: string
          entry_count_expected?: number
          entry_count_processed?: number
          error_count?: number
          errors?: Json
          exported_at?: string
          id?: string
          inventory_completed_at?: string | null
          manifest?: Json
          manifest_sha256?: string
          organization_id?: string
          parser_version?: string
          phase?: string
          progress?: Json
          record_count_expected?: number
          record_count_processed?: number
          started_at?: string
          status?: string
          updated_at?: string
          warning_count?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_export_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_export_stage: {
        Row: {
          content_sha256: string | null
          entity_type: string
          payload: Json
          project_id: string
          run_id: string
          source_key: string
          staged_at: string
        }
        Insert: {
          content_sha256?: string | null
          entity_type: string
          payload: Json
          project_id: string
          run_id: string
          source_key: string
          staged_at?: string
        }
        Update: {
          content_sha256?: string | null
          entity_type?: string
          payload?: Json
          project_id?: string
          run_id?: string
          source_key?: string
          staged_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_export_stage_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_import_checkpoints: {
        Row: {
          batch_number: number
          completed_at: string
          content_sha256: string
          entity_type: string
          row_count: number
          run_id: string
        }
        Insert: {
          batch_number: number
          completed_at?: string
          content_sha256: string
          entity_type: string
          row_count: number
          run_id: string
        }
        Update: {
          batch_number?: number
          completed_at?: string
          content_sha256?: string
          entity_type?: string
          row_count?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_import_checkpoints_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_import_runs: {
        Row: {
          account_id: number
          coverage: Json
          created_at: string
          error_message: string | null
          export_date: string
          finalized_at: string | null
          id: string
          known_gaps: Json
          manifest: Json
          organization_id: string
          source: string
          started_at: string
          status: string
          summary: Json
          updated_at: string
        }
        Insert: {
          account_id: number
          coverage: Json
          created_at?: string
          error_message?: string | null
          export_date: string
          finalized_at?: string | null
          id: string
          known_gaps?: Json
          manifest: Json
          organization_id: string
          source: string
          started_at?: string
          status?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          account_id?: number
          coverage?: Json
          created_at?: string
          error_message?: string | null
          export_date?: string
          finalized_at?: string | null
          id?: string
          known_gaps?: Json
          manifest?: Json
          organization_id?: string
          source?: string
          started_at?: string
          status?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_import_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      basecamp_import_stage: {
        Row: {
          entity_type: string
          payload: Json
          run_id: string
          source_key: string
          staged_at: string
        }
        Insert: {
          entity_type: string
          payload: Json
          run_id: string
          source_key: string
          staged_at?: string
        }
        Update: {
          entity_type?: string
          payload?: Json
          run_id?: string
          source_key?: string
          staged_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "basecamp_import_stage_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          basecamp_account_id: number | null
          basecamp_chat_id: number | null
          basecamp_creator_id: number | null
          basecamp_export_run_id: string | null
          basecamp_message_id: number | null
          basecamp_payload: Json
          completion_tokens: number | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          imported_at: string | null
          metadata: Json
          model: string | null
          parent_message_id: string | null
          profile_id: string | null
          project_id: string | null
          prompt_tokens: number | null
          role: string
          source_created_at: string | null
          source_exported_at: string | null
          source_locator: string | null
          source_ordinal: number | null
          source_path: string | null
          source_updated_at: string | null
          tool_call_id: string | null
          tool_calls: Json
          tool_name: string | null
          updated_at: string
        }
        Insert: {
          basecamp_account_id?: number | null
          basecamp_chat_id?: number | null
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_message_id?: number | null
          basecamp_payload?: Json
          completion_tokens?: number | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          imported_at?: string | null
          metadata?: Json
          model?: string | null
          parent_message_id?: string | null
          profile_id?: string | null
          project_id?: string | null
          prompt_tokens?: number | null
          role: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_locator?: string | null
          source_ordinal?: number | null
          source_path?: string | null
          source_updated_at?: string | null
          tool_call_id?: string | null
          tool_calls?: Json
          tool_name?: string | null
          updated_at?: string
        }
        Update: {
          basecamp_account_id?: number | null
          basecamp_chat_id?: number | null
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_message_id?: number | null
          basecamp_payload?: Json
          completion_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          imported_at?: string | null
          metadata?: Json
          model?: string | null
          parent_message_id?: string | null
          profile_id?: string | null
          project_id?: string | null
          prompt_tokens?: number | null
          role?: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_locator?: string | null
          source_ordinal?: number | null
          source_path?: string | null
          source_updated_at?: string | null
          tool_call_id?: string | null
          tool_calls?: Json
          tool_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_activities: {
        Row: {
          activity_type: string
          body: string | null
          client_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          direction: string | null
          duration_minutes: number | null
          external_id: string | null
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          participant_contact_ids: string[]
          project_id: string | null
          prospect_id: string | null
          retainer_period_id: string | null
          source: string
          source_payload: Json
          source_updated_at: string | null
          subject: string
          updated_at: string
        }
        Insert: {
          activity_type: string
          body?: string | null
          client_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          duration_minutes?: number | null
          external_id?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          participant_contact_ids?: string[]
          project_id?: string | null
          prospect_id?: string | null
          retainer_period_id?: string | null
          source?: string
          source_payload?: Json
          source_updated_at?: string | null
          subject: string
          updated_at?: string
        }
        Update: {
          activity_type?: string
          body?: string | null
          client_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          duration_minutes?: number | null
          external_id?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          participant_contact_ids?: string[]
          project_id?: string | null
          prospect_id?: string | null
          retainer_period_id?: string | null
          source?: string
          source_payload?: Json
          source_updated_at?: string | null
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_activities_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_activities_organization_id_contact_id_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_activities_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_activities_organization_prospect_fkey"
            columns: ["organization_id", "prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_activities_organization_retainer_period_fkey"
            columns: ["organization_id", "client_id", "retainer_period_id"]
            isOneToOne: false
            referencedRelation: "retainer_periods"
            referencedColumns: ["organization_id", "client_id", "id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          client_id: string
          contact_id: string
          created_at: string
          external_id: string | null
          id: string
          is_primary: boolean
          organization_id: string
          position: string | null
          receives_invoices: boolean
          role: string | null
          source_payload: Json
          source_updated_at: string | null
          standing: string | null
        }
        Insert: {
          client_id: string
          contact_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          is_primary?: boolean
          organization_id: string
          position?: string | null
          receives_invoices?: boolean
          role?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          standing?: string | null
        }
        Update: {
          client_id?: string
          contact_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          is_primary?: boolean
          organization_id?: string
          position?: string | null
          receives_invoices?: boolean
          role?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          standing?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_contacts_organization_id_contact_id_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_owner_id: string | null
          billing_address: Json
          billing_email: string | null
          created_at: string
          created_by: string | null
          default_currency: string
          external_id: string | null
          id: string
          metadata: Json
          name: string
          organization_id: string
          parent_client_id: string | null
          payment_terms_days: number
          phone: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          updated_at: string
          website: string | null
        }
        Insert: {
          account_owner_id?: string | null
          billing_address?: Json
          billing_email?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          name: string
          organization_id: string
          parent_client_id?: string | null
          payment_terms_days?: number
          phone?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          account_owner_id?: string | null
          billing_address?: Json
          billing_email?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          name?: string
          organization_id?: string
          parent_client_id?: string | null
          payment_terms_days?: number
          phone?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_organization_account_owner_fkey"
            columns: ["organization_id", "account_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_organization_parent_client_fkey"
            columns: ["organization_id", "parent_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      comment_attachments: {
        Row: {
          comment_id: string
          created_at: string
          external_url: string | null
          file_id: string | null
          id: string
          title: string | null
        }
        Insert: {
          comment_id: string
          created_at?: string
          external_url?: string | null
          file_id?: string | null
          id?: string
          title?: string | null
        }
        Update: {
          comment_id?: string
          created_at?: string
          external_url?: string | null
          file_id?: string | null
          id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comment_attachments_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_mentions: {
        Row: {
          comment_id: string
          created_at: string
          profile_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          profile_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_mentions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          basecamp_comment_id: number | null
          basecamp_creator_id: number | null
          basecamp_export_run_id: string | null
          basecamp_payload: Json
          basecamp_recording_id: number | null
          body: string
          created_at: string
          doc_id: string | null
          id: string
          imported_at: string | null
          is_edited: boolean
          metadata: Json
          parent_comment_id: string | null
          project_id: string
          resolved_at: string | null
          resolved_by: string | null
          source_created_at: string | null
          source_exported_at: string | null
          source_path: string | null
          source_updated_at: string | null
          todo_id: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          basecamp_comment_id?: number | null
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_recording_id?: number | null
          body: string
          created_at?: string
          doc_id?: string | null
          id?: string
          imported_at?: string | null
          is_edited?: boolean
          metadata?: Json
          parent_comment_id?: string | null
          project_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          todo_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          basecamp_comment_id?: number | null
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_recording_id?: number | null
          body?: string
          created_at?: string
          doc_id?: string | null
          id?: string
          imported_at?: string | null
          is_edited?: boolean
          metadata?: Json
          parent_comment_id?: string | null
          project_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          todo_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_attachments: {
        Row: {
          byte_size: number | null
          content_type: string | null
          created_at: string
          file_name: string
          id: string
          metadata: Json
          organization_id: string
          source_attachment_id: string | null
          storage_path: string | null
          thread_id: string
        }
        Insert: {
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          file_name: string
          id?: string
          metadata?: Json
          organization_id: string
          source_attachment_id?: string | null
          storage_path?: string | null
          thread_id: string
        }
        Update: {
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          file_name?: string
          id?: string
          metadata?: Json
          organization_id?: string
          source_attachment_id?: string | null
          storage_path?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_attachments_organization_id_thread_id_fkey"
            columns: ["organization_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "communication_threads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      communication_participants: {
        Row: {
          contact_id: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          organization_id: string
          participant_role: string
          profile_id: string | null
          thread_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          organization_id: string
          participant_role: string
          profile_id?: string | null
          thread_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          organization_id?: string
          participant_role?: string
          profile_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_participants_organization_id_contact_id_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_participants_organization_id_profile_id_fkey"
            columns: ["organization_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "communication_participants_organization_id_thread_id_fkey"
            columns: ["organization_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "communication_threads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      communication_threads: {
        Row: {
          client_id: string | null
          contact_id: string | null
          created_at: string
          direction: string
          id: string
          last_message_at: string
          metadata: Json
          organization_id: string
          project_id: string | null
          source_provider: string
          source_thread_id: string | null
          subject: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          last_message_at?: string
          metadata?: Json
          organization_id: string
          project_id?: string | null
          source_provider?: string
          source_thread_id?: string | null
          subject: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          last_message_at?: string
          metadata?: Json
          organization_id?: string
          project_id?: string | null
          source_provider?: string
          source_thread_id?: string | null
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_webhook_events: {
        Row: {
          created_at: string
          event_id: string
          id: string
          organization_id: string
          payload: Json
          processed_at: string | null
          provider: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
          provider: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          external_id: string | null
          first_name: string
          id: string
          last_name: string
          metadata: Json
          organization_id: string
          phone: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          first_name: string
          id?: string
          last_name?: string
          metadata?: Json
          organization_id: string
          phone?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          first_name?: string
          id?: string
          last_name?: string
          metadata?: Json
          organization_id?: string
          phone?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_summaries: {
        Row: {
          actions: Json
          blockers: Json
          citations: Json
          conversation_id: string
          created_at: string
          decisions: Json
          generated_by: string | null
          id: string
          open_questions: Json
          organization_id: string
          project_id: string | null
          source_message_count: number
          summary: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          blockers?: Json
          citations?: Json
          conversation_id: string
          created_at?: string
          decisions?: Json
          generated_by?: string | null
          id?: string
          open_questions?: Json
          organization_id: string
          project_id?: string | null
          source_message_count?: number
          summary: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          blockers?: Json
          citations?: Json
          conversation_id?: string
          created_at?: string
          decisions?: Json
          generated_by?: string | null
          id?: string
          open_questions?: Json
          organization_id?: string
          project_id?: string | null
          source_message_count?: number
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_issues: {
        Row: {
          added_at: string
          added_by: string
          cycle_id: string
          todo_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string
          cycle_id: string
          todo_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          cycle_id?: string
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_issues_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_issues_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "work_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_issues_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      docs: {
        Row: {
          basecamp_document_id: number | null
          basecamp_export_run_id: string | null
          basecamp_payload: Json
          content: Json
          created_at: string
          created_by: string | null
          id: string
          imported_at: string | null
          plain_text: string | null
          project_id: string
          published_at: string | null
          slug: string
          source_created_at: string | null
          source_exported_at: string | null
          source_path: string | null
          source_updated_at: string | null
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          basecamp_document_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          imported_at?: string | null
          plain_text?: string | null
          project_id: string
          published_at?: string | null
          slug: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          basecamp_document_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          imported_at?: string | null
          plain_text?: string | null
          project_id?: string
          published_at?: string | null
          slug?: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "docs_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      file_blobs: {
        Row: {
          bucket_id: string
          crc32: string | null
          created_at: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          mime_type: string | null
          object_path: string
          organization_id: string
          sha256: string | null
          size_bytes: number
          status: string
          tus_offset_bytes: number
          tus_upload_url: string | null
          updated_at: string
          upload_attempt_count: number
          upload_lease_expires_at: string | null
          upload_lease_token: string | null
          upload_started_at: string | null
          verified_at: string | null
        }
        Insert: {
          bucket_id?: string
          crc32?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          mime_type?: string | null
          object_path: string
          organization_id: string
          sha256?: string | null
          size_bytes: number
          status?: string
          tus_offset_bytes?: number
          tus_upload_url?: string | null
          updated_at?: string
          upload_attempt_count?: number
          upload_lease_expires_at?: string | null
          upload_lease_token?: string | null
          upload_started_at?: string | null
          verified_at?: string | null
        }
        Update: {
          bucket_id?: string
          crc32?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          mime_type?: string | null
          object_path?: string
          organization_id?: string
          sha256?: string | null
          size_bytes?: number
          status?: string
          tus_offset_bytes?: number
          tus_upload_url?: string | null
          updated_at?: string
          upload_attempt_count?: number
          upload_lease_expires_at?: string | null
          upload_lease_token?: string | null
          upload_started_at?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "file_blobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          file_id: string
          id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          file_id: string
          id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          file_id?: string
          id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_comments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "file_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      file_download_audit: {
        Row: {
          access_channel: string
          actor_id: string | null
          created_at: string
          file_id: string
          id: string
          ip_hash: string | null
          metadata: Json
          organization_id: string
          outcome: string
          request_correlation_id: string
          share_id: string | null
          user_agent_hash: string | null
        }
        Insert: {
          access_channel?: string
          actor_id?: string | null
          created_at?: string
          file_id: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          organization_id: string
          outcome: string
          request_correlation_id: string
          share_id?: string | null
          user_agent_hash?: string | null
        }
        Update: {
          access_channel?: string
          actor_id?: string | null
          created_at?: string
          file_id?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          organization_id?: string
          outcome?: string
          request_correlation_id?: string
          share_id?: string | null
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "file_download_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_download_audit_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_download_audit_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_download_audit_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "file_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      file_favorites: {
        Row: {
          created_at: string
          file_id: string | null
          folder_id: string | null
          profile_id: string
        }
        Insert: {
          created_at?: string
          file_id?: string | null
          folder_id?: string | null
          profile_id: string
        }
        Update: {
          created_at?: string
          file_id?: string | null
          folder_id?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_favorites_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_favorites_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "file_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_favorites_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      file_folders: {
        Row: {
          client_id: string | null
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          parent_id: string | null
          project_id: string | null
          trashed_at: string | null
          trashed_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          parent_id?: string | null
          project_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_id?: string | null
          project_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "file_folders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "file_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_folders_trashed_by_fkey"
            columns: ["trashed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_folders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      file_quarantine_actions: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          file_id: string
          id: string
          metadata: Json
          organization_id: string
          reason: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          file_id: string
          id?: string
          metadata?: Json
          organization_id: string
          reason: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          file_id?: string
          id?: string
          metadata?: Json
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_quarantine_actions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_quarantine_actions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_quarantine_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_references: {
        Row: {
          alt_text: string | null
          archive_record_id: string | null
          caption: string | null
          chat_message_id: string | null
          comment_id: string | null
          created_at: string
          doc_id: string | null
          file_id: string
          id: string
          message_id: string | null
          ordinal: number
          payload: Json
          project_id: string
          reference_role: string
          source_locator: string | null
          title: string | null
          todo_id: string | null
        }
        Insert: {
          alt_text?: string | null
          archive_record_id?: string | null
          caption?: string | null
          chat_message_id?: string | null
          comment_id?: string | null
          created_at?: string
          doc_id?: string | null
          file_id: string
          id?: string
          message_id?: string | null
          ordinal?: number
          payload?: Json
          project_id: string
          reference_role?: string
          source_locator?: string | null
          title?: string | null
          todo_id?: string | null
        }
        Update: {
          alt_text?: string | null
          archive_record_id?: string | null
          caption?: string | null
          chat_message_id?: string | null
          comment_id?: string | null
          created_at?: string
          doc_id?: string | null
          file_id?: string
          id?: string
          message_id?: string | null
          ordinal?: number
          payload?: Json
          project_id?: string
          reference_role?: string
          source_locator?: string | null
          title?: string | null
          todo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "file_references_archive_record_id_fkey"
            columns: ["archive_record_id"]
            isOneToOne: false
            referencedRelation: "basecamp_archive_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_references_chat_message_id_fkey"
            columns: ["chat_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_references_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_references_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_references_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_references_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_references_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_references_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      file_scan_results: {
        Row: {
          created_at: string
          detail: Json
          file_id: string
          id: string
          organization_id: string
          scan_status: string
          scanned_at: string | null
          scanner_name: string
          signature: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          file_id: string
          id?: string
          organization_id: string
          scan_status?: string
          scanned_at?: string | null
          scanner_name?: string
          signature?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          file_id?: string
          id?: string
          organization_id?: string
          scan_status?: string
          scanned_at?: string | null
          scanner_name?: string
          signature?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_scan_results_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: true
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_scan_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_share_access_attempts: {
        Row: {
          attempt_count: number
          blocked_until: string | null
          id: string
          ip_hash: string
          last_attempt_at: string
          success: boolean
          token_hash: string
        }
        Insert: {
          attempt_count?: number
          blocked_until?: string | null
          id?: string
          ip_hash: string
          last_attempt_at?: string
          success?: boolean
          token_hash: string
        }
        Update: {
          attempt_count?: number
          blocked_until?: string | null
          id?: string
          ip_hash?: string
          last_attempt_at?: string
          success?: boolean
          token_hash?: string
        }
        Relationships: []
      }
      file_shares: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          file_id: string | null
          folder_id: string | null
          guest_email: string | null
          id: string
          organization_id: string
          password_hash: string | null
          permission: string
          revoked_at: string | null
          shared_with_profile_id: string | null
          token_hash: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          file_id?: string | null
          folder_id?: string | null
          guest_email?: string | null
          id?: string
          organization_id: string
          password_hash?: string | null
          permission?: string
          revoked_at?: string | null
          shared_with_profile_id?: string | null
          token_hash?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          file_id?: string | null
          folder_id?: string | null
          guest_email?: string | null
          id?: string
          organization_id?: string
          password_hash?: string | null
          permission?: string
          revoked_at?: string | null
          shared_with_profile_id?: string | null
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "file_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "file_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_shared_with_profile_id_fkey"
            columns: ["shared_with_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      file_versions: {
        Row: {
          blob_id: string | null
          bucket_id: string
          checksum_sha256: string | null
          created_at: string
          created_by: string | null
          file_id: string
          file_name: string
          id: string
          metadata: Json
          mime_type: string | null
          object_path: string
          size_bytes: number
          version_number: number
        }
        Insert: {
          blob_id?: string | null
          bucket_id: string
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          file_id: string
          file_name: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          object_path: string
          size_bytes: number
          version_number: number
        }
        Update: {
          blob_id?: string | null
          bucket_id?: string
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          file_id?: string
          file_name?: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          object_path?: string
          size_bytes?: number
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "file_versions_blob_id_fkey"
            columns: ["blob_id"]
            isOneToOne: false
            referencedRelation: "file_blobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_versions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          availability_status: string
          basecamp_account_id: number | null
          basecamp_export_run_id: string | null
          basecamp_upload_id: number | null
          blob_id: string | null
          bucket_id: string | null
          checksum_sha256: string | null
          client_id: string | null
          created_at: string
          current_version_id: string | null
          description: string | null
          file_name: string
          folder_id: string | null
          id: string
          imported_at: string | null
          listing_position: number | null
          metadata: Json
          mime_type: string | null
          object_path: string | null
          organization_id: string
          project_id: string | null
          size_bytes: number
          source_account_id: string | null
          source_checksum_sha256: string | null
          source_crc32: string | null
          source_created_at: string | null
          source_exported_at: string | null
          source_file_id: string | null
          source_path: string | null
          source_payload: Json
          source_system: string | null
          source_updated_at: string | null
          source_uploader_id: string | null
          trashed_at: string | null
          trashed_by: string | null
          updated_at: string
          uploaded_by: string | null
          version_count: number
        }
        Insert: {
          availability_status?: string
          basecamp_account_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_upload_id?: number | null
          blob_id?: string | null
          bucket_id?: string | null
          checksum_sha256?: string | null
          client_id?: string | null
          created_at?: string
          current_version_id?: string | null
          description?: string | null
          file_name: string
          folder_id?: string | null
          id?: string
          imported_at?: string | null
          listing_position?: number | null
          metadata?: Json
          mime_type?: string | null
          object_path?: string | null
          organization_id: string
          project_id?: string | null
          size_bytes?: number
          source_account_id?: string | null
          source_checksum_sha256?: string | null
          source_crc32?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_file_id?: string | null
          source_path?: string | null
          source_payload?: Json
          source_system?: string | null
          source_updated_at?: string | null
          source_uploader_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          uploaded_by?: string | null
          version_count?: number
        }
        Update: {
          availability_status?: string
          basecamp_account_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_upload_id?: number | null
          blob_id?: string | null
          bucket_id?: string | null
          checksum_sha256?: string | null
          client_id?: string | null
          created_at?: string
          current_version_id?: string | null
          description?: string | null
          file_name?: string
          folder_id?: string | null
          id?: string
          imported_at?: string | null
          listing_position?: number | null
          metadata?: Json
          mime_type?: string | null
          object_path?: string | null
          organization_id?: string
          project_id?: string | null
          size_bytes?: number
          source_account_id?: string | null
          source_checksum_sha256?: string | null
          source_crc32?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_file_id?: string | null
          source_path?: string | null
          source_payload?: Json
          source_system?: string | null
          source_updated_at?: string | null
          source_uploader_id?: string | null
          trashed_at?: string | null
          trashed_by?: string | null
          updated_at?: string
          uploaded_by?: string | null
          version_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "files_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_blob_id_fkey"
            columns: ["blob_id"]
            isOneToOne: false
            referencedRelation: "file_blobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "file_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "file_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_trashed_by_fkey"
            columns: ["trashed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_audit_events: {
        Row: {
          action_type: string
          actor_id: string | null
          after_state: Json
          before_state: Json
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          after_state?: Json
          before_state?: Json
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id: string
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          after_state?: Json
          before_state?: Json
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_project_access: {
        Row: {
          access_role: string
          can_access_chat: boolean
          created_at: string
          expires_at: string | null
          granted_by: string
          id: string
          organization_id: string
          profile_id: string
          project_id: string
        }
        Insert: {
          access_role?: string
          can_access_chat?: boolean
          created_at?: string
          expires_at?: string | null
          granted_by?: string
          id?: string
          organization_id: string
          profile_id: string
          project_id: string
        }
        Update: {
          access_role?: string
          can_access_chat?: boolean
          created_at?: string
          expires_at?: string | null
          granted_by?: string
          id?: string
          organization_id?: string
          profile_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_project_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_project_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_project_access_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_project_access_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_api_tokens: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          organization_id: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          organization_id: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
          token_prefix: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_api_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_api_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_authority_states: {
        Row: {
          created_at: string
          entity_type: string
          id: string
          organization_id: string
          previous_state: string | null
          provider: string
          source_account_id: string
          state: string
          transition_note: string | null
          transition_run_id: string | null
          transitioned_at: string
          transitioned_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          id?: string
          organization_id: string
          previous_state?: string | null
          provider?: string
          source_account_id: string
          state?: string
          transition_note?: string | null
          transition_run_id?: string | null
          transitioned_at?: string
          transitioned_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          id?: string
          organization_id?: string
          previous_state?: string | null
          provider?: string
          source_account_id?: string
          state?: string
          transition_note?: string | null
          transition_run_id?: string | null
          transitioned_at?: string
          transitioned_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_authority_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_authority_states_organization_id_provider_sour_fkey"
            columns: [
              "organization_id",
              "provider",
              "source_account_id",
              "transition_run_id",
            ]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: [
              "organization_id",
              "provider",
              "source_account_id",
              "id",
            ]
          },
          {
            foreignKeyName: "integration_authority_states_organization_id_transitioned__fkey"
            columns: ["organization_id", "transitioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      integration_settings: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          last_error: string | null
          last_synced_at: string | null
          organization_id: string
          provider: string
          settings: Json
          updated_at: string
          updated_by: string | null
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id: string
          provider: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string
          provider?: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
          vault_secret_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: string
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: string
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: string
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_adjustments: {
        Row: {
          adjustment_type: string
          amount_cents: number
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          idempotency_key: string
          invoice_id: string
          organization_id: string
          reason: string
        }
        Insert: {
          adjustment_type: string
          amount_cents: number
          client_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          idempotency_key: string
          invoice_id: string
          organization_id: string
          reason: string
        }
        Update: {
          adjustment_type?: string
          amount_cents?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          idempotency_key?: string
          invoice_id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_adjustments_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_adjustments_organization_id_invoice_id_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invoice_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          created_by: string | null
          delivery_method: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          invoice_id: string
          last_attempt_at: string | null
          next_retry_at: string | null
          organization_id: string
          recipient_email: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          delivery_method?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          invoice_id: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          organization_id: string
          recipient_email: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          delivery_method?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          invoice_id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          organization_id?: string
          recipient_email?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_deliveries_organization_id_invoice_id_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invoice_delivery_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          delivery_id: string
          error_message: string | null
          id: string
          organization_id: string
          provider: string | null
          provider_message_id: string | null
          response: Json
          status: string
        }
        Insert: {
          attempt_number: number
          attempted_at?: string
          delivery_id: string
          error_message?: string | null
          id?: string
          organization_id: string
          provider?: string | null
          provider_message_id?: string | null
          response?: Json
          status: string
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          delivery_id?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          provider?: string | null
          provider_message_id?: string | null
          response?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_delivery_attempts_organization_id_delivery_id_fkey"
            columns: ["organization_id", "delivery_id"]
            isOneToOne: false
            referencedRelation: "invoice_deliveries"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_delivery_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          details: string | null
          external_id: string | null
          id: string
          invoice_id: string
          item_type: string
          organization_id: string
          position: number
          project_id: string | null
          quantity: number
          retainer_id: string | null
          retainer_period_id: string | null
          service_period_end: string | null
          service_period_start: string | null
          source_payload: Json
          tax_cents: number
          time_entry_id: string | null
          unit_amount_cents: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          description: string
          details?: string | null
          external_id?: string | null
          id?: string
          invoice_id: string
          item_type?: string
          organization_id: string
          position?: number
          project_id?: string | null
          quantity?: number
          retainer_id?: string | null
          retainer_period_id?: string | null
          service_period_end?: string | null
          service_period_start?: string | null
          source_payload?: Json
          tax_cents?: number
          time_entry_id?: string | null
          unit_amount_cents: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          details?: string | null
          external_id?: string | null
          id?: string
          invoice_id?: string
          item_type?: string
          organization_id?: string
          position?: number
          project_id?: string | null
          quantity?: number
          retainer_id?: string | null
          retainer_period_id?: string | null
          service_period_end?: string | null
          service_period_start?: string | null
          source_payload?: Json
          tax_cents?: number
          time_entry_id?: string | null
          unit_amount_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_invoice_id_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_time_entry_id_fkey"
            columns: ["organization_id", "time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_retainer_fkey"
            columns: ["organization_id", "retainer_id"]
            isOneToOne: false
            referencedRelation: "retainers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_retainer_period_fkey"
            columns: ["organization_id", "retainer_period_id"]
            isOneToOne: false
            referencedRelation: "retainer_periods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invoices: {
        Row: {
          attention_to: string | null
          balance_cents: number | null
          billing_address: Json
          client_id: string
          collection_notes: string | null
          collection_owner_id: string | null
          collection_promise_notes: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivered_at: string | null
          delivery_method: string | null
          due_date: string
          external_id: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_at: string | null
          last_collection_reminder_at: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_cents: number
          payment_instructions: string | null
          payment_terms: string | null
          project_id: string | null
          promised_payment_date: string | null
          service_period_end: string | null
          service_period_start: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          subject: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number | null
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          attention_to?: string | null
          balance_cents?: number | null
          billing_address?: Json
          client_id: string
          collection_notes?: string | null
          collection_owner_id?: string | null
          collection_promise_notes?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          delivered_at?: string | null
          delivery_method?: string | null
          due_date: string
          external_id?: string | null
          id?: string
          invoice_number: string
          issue_date?: string
          issued_at?: string | null
          last_collection_reminder_at?: string | null
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          paid_cents?: number
          payment_instructions?: string | null
          payment_terms?: string | null
          project_id?: string | null
          promised_payment_date?: string | null
          service_period_end?: string | null
          service_period_start?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          subject?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number | null
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          attention_to?: string | null
          balance_cents?: number | null
          billing_address?: Json
          client_id?: string
          collection_notes?: string | null
          collection_owner_id?: string | null
          collection_promise_notes?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delivered_at?: string | null
          delivery_method?: string | null
          due_date?: string
          external_id?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          issued_at?: string | null
          last_collection_reminder_at?: string | null
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_cents?: number
          payment_instructions?: string | null
          payment_terms?: string | null
          project_id?: string | null
          promised_payment_date?: string | null
          service_period_end?: string | null
          service_period_start?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          subject?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number | null
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_collection_owner_fkey"
            columns: ["organization_id", "collection_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoices_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      issue_blockers: {
        Row: {
          created_at: string
          created_by: string
          expected_resolution_at: string | null
          id: string
          organization_id: string
          owner_id: string | null
          project_id: string
          reason: string | null
          resolved_at: string | null
          source_conversation_id: string | null
          source_message_id: string | null
          status: string
          title: string
          todo_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          expected_resolution_at?: string | null
          id?: string
          organization_id: string
          owner_id?: string | null
          project_id: string
          reason?: string | null
          resolved_at?: string | null
          source_conversation_id?: string | null
          source_message_id?: string | null
          status?: string
          title: string
          todo_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expected_resolution_at?: string | null
          id?: string
          organization_id?: string
          owner_id?: string | null
          project_id?: string
          reason?: string | null
          resolved_at?: string | null
          source_conversation_id?: string | null
          source_message_id?: string | null
          status?: string
          title?: string
          todo_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_blockers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_blockers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_blockers_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_blockers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_blockers_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_blockers_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_blockers_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_dependencies: {
        Row: {
          created_at: string
          created_by: string
          id: string
          organization_id: string
          predecessor_todo_id: string
          project_id: string
          reason: string | null
          relationship: string
          successor_todo_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          organization_id: string
          predecessor_todo_id: string
          project_id: string
          reason?: string | null
          relationship?: string
          successor_todo_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          predecessor_todo_id?: string
          project_id?: string
          reason?: string | null
          relationship?: string
          successor_todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_dependencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_dependencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_dependencies_predecessor_todo_id_fkey"
            columns: ["predecessor_todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_dependencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_dependencies_successor_todo_id_fkey"
            columns: ["successor_todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_status_transitions: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: string
          id: string
          issue_version: number
          project_id: string
          to_status: string
          todo_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status: string
          id?: string
          issue_version: number
          project_id: string
          to_status: string
          todo_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: string
          id?: string
          issue_version?: number
          project_id?: string
          to_status?: string
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_status_transitions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_status_transitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_status_transitions_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_holds: {
        Row: {
          created_at: string
          file_id: string | null
          id: string
          metadata: Json
          organization_id: string
          placed_by: string
          project_id: string | null
          reason: string
          released_at: string | null
          released_by: string | null
          scope_type: string
        }
        Insert: {
          created_at?: string
          file_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          placed_by: string
          project_id?: string | null
          reason: string
          released_at?: string | null
          released_by?: string | null
          scope_type: string
        }
        Update: {
          created_at?: string
          file_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          placed_by?: string
          project_id?: string | null
          reason?: string
          released_at?: string | null
          released_by?: string | null
          scope_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_holds_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_holds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_holds_placed_by_fkey"
            columns: ["placed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_holds_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_holds_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          revoked_at: string | null
          scopes: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          basecamp_creator_id: number | null
          basecamp_export_run_id: string | null
          basecamp_message_id: number | null
          basecamp_payload: Json
          body: string
          channel: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          imported_at: string | null
          metadata: Json
          project_id: string
          recipient_emails: string[]
          sender_id: string | null
          sent_at: string | null
          source_created_at: string | null
          source_exported_at: string | null
          source_path: string | null
          source_updated_at: string | null
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_message_id?: number | null
          basecamp_payload?: Json
          body: string
          channel?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          imported_at?: string | null
          metadata?: Json
          project_id: string
          recipient_emails?: string[]
          sender_id?: string | null
          sent_at?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_message_id?: number | null
          basecamp_payload?: Json
          body?: string
          channel?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          imported_at?: string | null
          metadata?: Json
          project_id?: string
          recipient_emails?: string[]
          sender_id?: string | null
          sent_at?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          accelo_milestone_id: string | null
          accelo_payload: Json
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          name: string
          owner_id: string | null
          position: number
          project_id: string
          risk_level: string | null
          risk_reason: string | null
          source_updated_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accelo_milestone_id?: string | null
          accelo_payload?: Json
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          owner_id?: string | null
          position?: number
          project_id: string
          risk_level?: string | null
          risk_reason?: string | null
          source_updated_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accelo_milestone_id?: string | null
          accelo_payload?: Json
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          position?: number
          project_id?: string
          risk_level?: string | null
          risk_reason?: string | null
          source_updated_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_export_runs: {
        Row: {
          checksum_sha256: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          export_kind: string
          id: string
          manifest: Json
          organization_id: string
          requested_by: string | null
          row_counts: Json
          started_at: string | null
          status: string
        }
        Insert: {
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          export_kind?: string
          id?: string
          manifest?: Json
          organization_id: string
          requested_by?: string | null
          row_counts?: Json
          started_at?: string | null
          status?: string
        }
        Update: {
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          export_kind?: string
          id?: string
          manifest?: Json
          organization_id?: string
          requested_by?: string | null
          row_counts?: Json
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          allocated_by: string | null
          amount_cents: number
          client_id: string
          created_at: string
          id: string
          invoice_id: string
          organization_id: string
          payment_id: string
        }
        Insert: {
          allocated_by?: string | null
          amount_cents: number
          client_id: string
          created_at?: string
          id?: string
          invoice_id: string
          organization_id: string
          payment_id: string
        }
        Update: {
          allocated_by?: string | null
          amount_cents?: number
          client_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_allocated_by_fkey"
            columns: ["allocated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_organization_id_invoice_id_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_allocations_organization_id_payment_id_fkey"
            columns: ["organization_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          external_id: string | null
          id: string
          idempotency_key: string
          method: string
          notes: string | null
          organization_id: string
          payment_date: string
          received_by: string | null
          reference: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          client_id: string
          created_at?: string
          currency: string
          external_id?: string | null
          id?: string
          idempotency_key: string
          method?: string
          notes?: string | null
          organization_id: string
          payment_date?: string
          received_by?: string | null
          reference?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          client_id?: string
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          idempotency_key?: string
          method?: string
          notes?: string | null
          organization_id?: string
          payment_date?: string
          received_by?: string | null
          reference?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_alert_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_key: string
          created_at: string
          id: string
          message: string
          metadata: Json
          organization_id: string | null
          severity: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_key: string
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          organization_id?: string | null
          severity: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_key?: string
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          organization_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_alert_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_alert_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_audit_events: {
        Row: {
          action_category: string
          action_type: string
          actor_id: string | null
          after_hash: string
          after_state: Json
          before_hash: string
          before_state: Json
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          request_correlation_id: string
        }
        Insert: {
          action_category: string
          action_type: string
          actor_id?: string | null
          after_hash: string
          after_state?: Json
          before_hash: string
          before_state?: Json
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id: string
          request_correlation_id: string
        }
        Update: {
          action_category?: string
          action_type?: string
          actor_id?: string | null
          after_hash?: string
          after_state?: Json
          before_hash?: string
          before_state?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: string
          request_correlation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_health_snapshots: {
        Row: {
          checks: Json
          id: string
          metadata: Json
          organization_id: string | null
          recorded_at: string
          scope: string
          status: string
        }
        Insert: {
          checks?: Json
          id?: string
          metadata?: Json
          organization_id?: string | null
          recorded_at?: string
          scope?: string
          status: string
        }
        Update: {
          checks?: Json
          id?: string
          metadata?: Json
          organization_id?: string | null
          recorded_at?: string
          scope?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_health_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accelo_staff_id: string | null
          avatar_url: string | null
          basecamp_account_id: number | null
          basecamp_person_id: number | null
          chat_enabled: boolean
          company_name: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          last_seen_at: string | null
          organization_id: string | null
          permissions: Json
          person_type: string | null
          phone: string | null
          preferences: Json
          role: string
          source_payload: Json
          status: string
          timezone: string
          title: string | null
          updated_at: string
          weekly_capacity_minutes: number
        }
        Insert: {
          accelo_staff_id?: string | null
          avatar_url?: string | null
          basecamp_account_id?: number | null
          basecamp_person_id?: number | null
          chat_enabled?: boolean
          company_name?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          last_seen_at?: string | null
          organization_id?: string | null
          permissions?: Json
          person_type?: string | null
          phone?: string | null
          preferences?: Json
          role?: string
          source_payload?: Json
          status?: string
          timezone?: string
          title?: string | null
          updated_at?: string
          weekly_capacity_minutes?: number
        }
        Update: {
          accelo_staff_id?: string | null
          avatar_url?: string | null
          basecamp_account_id?: number | null
          basecamp_person_id?: number | null
          chat_enabled?: boolean
          company_name?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_seen_at?: string | null
          organization_id?: string | null
          permissions?: Json
          person_type?: string | null
          phone?: string | null
          preferences?: Json
          role?: string
          source_payload?: Json
          status?: string
          timezone?: string
          title?: string | null
          updated_at?: string
          weekly_capacity_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_change_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          description: string
          id: string
          impact_summary: string | null
          organization_id: string
          project_id: string
          requested_by: string
          reviewer_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          description: string
          id?: string
          impact_summary?: string | null
          organization_id: string
          project_id: string
          requested_by?: string
          reviewer_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          description?: string
          id?: string
          impact_summary?: string | null
          organization_id?: string
          project_id?: string
          requested_by?: string
          reviewer_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_change_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_change_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_change_requests_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_channel_bindings: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          organization_id: string
          project_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by?: string
          id?: string
          is_primary?: boolean
          organization_id: string
          project_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_channel_bindings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_channel_bindings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_channel_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_channel_bindings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_contacts: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
          organization_id: string
          project_id: string
          role: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id: string
          project_id: string
          role?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          project_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_contacts_organization_id_contact_id_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "project_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contacts_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      project_cycles: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          ends_on: string
          goal: string | null
          id: string
          name: string
          organization_id: string
          position: number
          project_id: string
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_on: string
          goal?: string | null
          id?: string
          name: string
          organization_id: string
          position?: number
          project_id: string
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_on?: string
          goal?: string | null
          id?: string
          name?: string
          organization_id?: string
          position?: number
          project_id?: string
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cycles_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      project_members: {
        Row: {
          allocation_percent: number | null
          basecamp_export_run_id: string | null
          created_at: string
          id: string
          imported_at: string | null
          joined_at: string
          profile_id: string
          project_id: string
          role: string
          source: string | null
          source_payload: Json
          updated_at: string
        }
        Insert: {
          allocation_percent?: number | null
          basecamp_export_run_id?: string | null
          created_at?: string
          id?: string
          imported_at?: string | null
          joined_at?: string
          profile_id: string
          project_id: string
          role?: string
          source?: string | null
          source_payload?: Json
          updated_at?: string
        }
        Update: {
          allocation_percent?: number | null
          basecamp_export_run_id?: string | null
          created_at?: string
          id?: string
          imported_at?: string | null
          joined_at?: string
          profile_id?: string
          project_id?: string
          role?: string
          source?: string | null
          source_payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          accelo_contact_source_ids: string[] | null
          accelo_custom_code: string | null
          accelo_job_id: string | null
          archived_at: string | null
          basecamp_account_id: number | null
          basecamp_export_run_id: string | null
          basecamp_payload: Json
          basecamp_project_id: number | null
          billing_cadence: string | null
          billing_cap_cents: number | null
          billing_type: string
          budget: number | null
          client_id: string | null
          client_name: string | null
          code: string
          commercial_currency: string | null
          commercial_value_cents: number | null
          created_at: string
          currency: string
          description: string | null
          due_date: string | null
          fixed_fee_cents: number | null
          hourly_rate_cents: number | null
          id: string
          imported_at: string | null
          is_read_only: boolean
          metadata: Json
          name: string
          organization_id: string
          owner_id: string | null
          priority: string
          source_created_at: string | null
          source_exported_at: string | null
          source_path: string | null
          source_payload: Json
          source_updated_at: string | null
          start_date: string | null
          status: string
          time_rounding_minutes: number | null
          updated_at: string
        }
        Insert: {
          accelo_contact_source_ids?: string[] | null
          accelo_custom_code?: string | null
          accelo_job_id?: string | null
          archived_at?: string | null
          basecamp_account_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_project_id?: number | null
          billing_cadence?: string | null
          billing_cap_cents?: number | null
          billing_type?: string
          budget?: number | null
          client_id?: string | null
          client_name?: string | null
          code: string
          commercial_currency?: string | null
          commercial_value_cents?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          fixed_fee_cents?: number | null
          hourly_rate_cents?: number | null
          id?: string
          imported_at?: string | null
          is_read_only?: boolean
          metadata?: Json
          name: string
          organization_id: string
          owner_id?: string | null
          priority?: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          start_date?: string | null
          status?: string
          time_rounding_minutes?: number | null
          updated_at?: string
        }
        Update: {
          accelo_contact_source_ids?: string[] | null
          accelo_custom_code?: string | null
          accelo_job_id?: string | null
          archived_at?: string | null
          basecamp_account_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_project_id?: number | null
          billing_cadence?: string | null
          billing_cap_cents?: number | null
          billing_type?: string
          budget?: number | null
          client_id?: string | null
          client_name?: string | null
          code?: string
          commercial_currency?: string | null
          commercial_value_cents?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          fixed_fee_cents?: number | null
          hourly_rate_cents?: number | null
          id?: string
          imported_at?: string | null
          is_read_only?: boolean
          metadata?: Json
          name?: string
          organization_id?: string
          owner_id?: string | null
          priority?: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_payload?: Json
          source_updated_at?: string | null
          start_date?: string | null
          status?: string
          time_rounding_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_contacts: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
          organization_id: string
          prospect_id: string
          role: string | null
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id: string
          prospect_id: string
          role?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          prospect_id?: string
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_contacts_organization_id_contact_id_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "prospect_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_contacts_organization_id_prospect_id_fkey"
            columns: ["organization_id", "prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      prospects: {
        Row: {
          client_id: string
          closed_at: string | null
          conversion_key: string | null
          converted_at: string | null
          created_at: string
          currency: string
          external_id: string | null
          id: string
          lost_reason: string | null
          next_action: string | null
          next_action_at: string | null
          organization_id: string
          owner_id: string | null
          primary_contact_id: string | null
          probability: number
          source_payload: Json
          source_updated_at: string | null
          stage: string
          title: string
          updated_at: string
          value_cents: number
          weighted_value_cents: number | null
          won_project_id: string | null
          won_retainer_id: string | null
        }
        Insert: {
          client_id: string
          closed_at?: string | null
          conversion_key?: string | null
          converted_at?: string | null
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          lost_reason?: string | null
          next_action?: string | null
          next_action_at?: string | null
          organization_id: string
          owner_id?: string | null
          primary_contact_id?: string | null
          probability?: number
          source_payload?: Json
          source_updated_at?: string | null
          stage?: string
          title: string
          updated_at?: string
          value_cents?: number
          weighted_value_cents?: number | null
          won_project_id?: string | null
          won_retainer_id?: string | null
        }
        Update: {
          client_id?: string
          closed_at?: string | null
          conversion_key?: string | null
          converted_at?: string | null
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          lost_reason?: string | null
          next_action?: string | null
          next_action_at?: string | null
          organization_id?: string
          owner_id?: string | null
          primary_contact_id?: string | null
          probability?: number
          source_payload?: Json
          source_updated_at?: string | null
          stage?: string
          title?: string
          updated_at?: string
          value_cents?: number
          weighted_value_cents?: number | null
          won_project_id?: string | null
          won_retainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospects_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "prospects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_organization_id_owner_id_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "prospects_organization_id_primary_contact_id_fkey"
            columns: ["organization_id", "primary_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "prospects_organization_won_project_fkey"
            columns: ["organization_id", "won_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "prospects_organization_won_retainer_fkey"
            columns: ["organization_id", "won_retainer_id"]
            isOneToOne: false
            referencedRelation: "retainers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      recurring_work_rules: {
        Row: {
          assignee_ids: string[]
          cadence: string
          created_at: string
          created_by: string
          description: string | null
          due_offset_days: number
          enabled: boolean
          id: string
          next_run_at: string
          organization_id: string
          project_id: string
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_ids?: string[]
          cadence: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_offset_days?: number
          enabled?: boolean
          id?: string
          next_run_at: string
          organization_id: string
          project_id: string
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_ids?: string[]
          cadence?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_offset_days?: number
          enabled?: boolean
          id?: string
          next_run_at?: string
          organization_id?: string
          project_id?: string
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_work_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_work_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_work_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_work_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "work_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      retainer_periods: {
        Row: {
          allowance_type: string
          client_id: string
          closed_at: string | null
          consumed_minutes: number
          consumed_value_cents: number
          created_at: string
          currency: string
          external_id: string | null
          fee_cents: number
          forecast_minutes: number | null
          forecast_updated_at: string | null
          id: string
          included_minutes: number
          included_value_cents: number | null
          invoice_id: string | null
          invoiced_at: string | null
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          overage_minutes: number
          overage_value_cents: number
          period_end: string
          period_start: string
          retainer_id: string
          rollover_minutes: number
          rollover_value_cents: number
          source_payload: Json
          source_updated_at: string | null
          status: string
          template_revision: number
          updated_at: string
        }
        Insert: {
          allowance_type?: string
          client_id: string
          closed_at?: string | null
          consumed_minutes?: number
          consumed_value_cents?: number
          created_at?: string
          currency?: string
          external_id?: string | null
          fee_cents: number
          forecast_minutes?: number | null
          forecast_updated_at?: string | null
          id?: string
          included_minutes: number
          included_value_cents?: number | null
          invoice_id?: string | null
          invoiced_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          organization_id: string
          overage_minutes?: number
          overage_value_cents?: number
          period_end: string
          period_start: string
          retainer_id: string
          rollover_minutes?: number
          rollover_value_cents?: number
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          template_revision?: number
          updated_at?: string
        }
        Update: {
          allowance_type?: string
          client_id?: string
          closed_at?: string | null
          consumed_minutes?: number
          consumed_value_cents?: number
          created_at?: string
          currency?: string
          external_id?: string | null
          fee_cents?: number
          forecast_minutes?: number | null
          forecast_updated_at?: string | null
          id?: string
          included_minutes?: number
          included_value_cents?: number | null
          invoice_id?: string | null
          invoiced_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string
          overage_minutes?: number
          overage_value_cents?: number
          period_end?: string
          period_start?: string
          retainer_id?: string
          rollover_minutes?: number
          rollover_value_cents?: number
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          template_revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retainer_periods_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retainer_periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retainer_periods_organization_id_client_id_retainer_id_fkey"
            columns: ["organization_id", "client_id", "retainer_id"]
            isOneToOne: false
            referencedRelation: "retainers"
            referencedColumns: ["organization_id", "client_id", "id"]
          },
          {
            foreignKeyName: "retainer_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retainer_projects: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          project_id: string
          retainer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          project_id: string
          retainer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string
          retainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retainer_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retainer_projects_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "retainer_projects_organization_id_retainer_id_fkey"
            columns: ["organization_id", "retainer_id"]
            isOneToOne: false
            referencedRelation: "retainers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      retainers: {
        Row: {
          allowance_type: string
          allowance_value_cents: number | null
          auto_renew: boolean
          cadence: string
          client_id: string
          contract_type: string | null
          created_at: string
          created_by: string | null
          currency: string
          end_date: string | null
          external_id: string | null
          fee_cents: number
          id: string
          included_minutes: number
          invoice_timing: string
          name: string
          organization_id: string
          overage_policy: string
          overage_rate_cents: number | null
          renewal_days: number | null
          rollover_policy: string
          source_payload: Json
          source_updated_at: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          allowance_type?: string
          allowance_value_cents?: number | null
          auto_renew?: boolean
          cadence?: string
          client_id: string
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          external_id?: string | null
          fee_cents: number
          id?: string
          included_minutes: number
          invoice_timing?: string
          name: string
          organization_id: string
          overage_policy?: string
          overage_rate_cents?: number | null
          renewal_days?: number | null
          rollover_policy?: string
          source_payload?: Json
          source_updated_at?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          allowance_type?: string
          allowance_value_cents?: number | null
          auto_renew?: boolean
          cadence?: string
          client_id?: string
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          external_id?: string | null
          fee_cents?: number
          id?: string
          included_minutes?: number
          invoice_timing?: string
          name?: string
          organization_id?: string
          overage_policy?: string
          overage_rate_cents?: number | null
          renewal_days?: number | null
          rollover_policy?: string
          source_payload?: Json
          source_updated_at?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retainers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retainers_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "retainers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_workspace_items: {
        Row: {
          created_at: string
          href: string
          id: string
          note: string | null
          organization_id: string
          owner_id: string
          project_id: string | null
          source_id: string
          source_type: string
          title: string
        }
        Insert: {
          created_at?: string
          href: string
          id?: string
          note?: string | null
          organization_id: string
          owner_id?: string
          project_id?: string | null
          source_id: string
          source_type: string
          title: string
        }
        Update: {
          created_at?: string
          href?: string
          id?: string
          note?: string | null
          organization_id?: string
          owner_id?: string
          project_id?: string | null
          source_id?: string
          source_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_workspace_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_workspace_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_workspace_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_notification_outbox: {
        Row: {
          attempt_count: number
          available_at: string
          channel: string
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          event_type: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          last_error_code: string | null
          lock_token: string | null
          locked_at: string | null
          locked_until: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          channel: string
          completed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_error_code?: string | null
          lock_token?: string | null
          locked_at?: string | null
          locked_until?: string | null
          max_attempts?: number
          payload: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          channel?: string
          completed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_error_code?: string | null
          lock_token?: string | null
          locked_at?: string | null
          locked_until?: string | null
          max_attempts?: number
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      source_records: {
        Row: {
          destination_record_id: string
          destination_schema: string
          destination_table: string
          first_seen_at: string
          first_seen_run_id: string | null
          id: string
          last_seen_at: string
          last_seen_run_id: string | null
          metadata: Json
          organization_id: string
          payload_sha256: string | null
          provider: string
          retired_at: string | null
          source_account_id: string
          source_deleted: boolean
          source_entity_type: string
          source_record_id: string
          source_updated_at: string | null
        }
        Insert: {
          destination_record_id: string
          destination_schema?: string
          destination_table: string
          first_seen_at?: string
          first_seen_run_id?: string | null
          id?: string
          last_seen_at?: string
          last_seen_run_id?: string | null
          metadata?: Json
          organization_id: string
          payload_sha256?: string | null
          provider: string
          retired_at?: string | null
          source_account_id: string
          source_deleted?: boolean
          source_entity_type: string
          source_record_id: string
          source_updated_at?: string | null
        }
        Update: {
          destination_record_id?: string
          destination_schema?: string
          destination_table?: string
          first_seen_at?: string
          first_seen_run_id?: string | null
          id?: string
          last_seen_at?: string
          last_seen_run_id?: string | null
          metadata?: Json
          organization_id?: string
          payload_sha256?: string | null
          provider?: string
          retired_at?: string | null
          source_account_id?: string
          source_deleted?: boolean
          source_entity_type?: string
          source_record_id?: string
          source_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_records_organization_id_provider_source_account_id__fkey"
            columns: [
              "organization_id",
              "provider",
              "source_account_id",
              "first_seen_run_id",
            ]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: [
              "organization_id",
              "provider",
              "source_account_id",
              "id",
            ]
          },
          {
            foreignKeyName: "source_records_organization_id_provider_source_account_id_fkey1"
            columns: [
              "organization_id",
              "provider",
              "source_account_id",
              "last_seen_run_id",
            ]
            isOneToOne: false
            referencedRelation: "accelo_pull_runs"
            referencedColumns: [
              "organization_id",
              "provider",
              "source_account_id",
              "id",
            ]
          },
        ]
      }
      staff_billing_rates: {
        Row: {
          client_id: string | null
          cost_rate_cents: number | null
          created_at: string
          created_by: string | null
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          organization_id: string
          profile_id: string
          project_id: string | null
          rate_cents: number
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          cost_rate_cents?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          organization_id: string
          profile_id: string
          project_id?: string | null
          rate_cents: number
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          cost_rate_cents?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          organization_id?: string
          profile_id?: string
          project_id?: string | null
          rate_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_billing_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_billing_rates_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "staff_billing_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_billing_rates_organization_id_profile_id_fkey"
            columns: ["organization_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "staff_billing_rates_organization_project_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      storage_deletion_outbox: {
        Row: {
          attempt_count: number
          available_at: string
          bucket_id: string
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          lock_token: string | null
          locked_at: string | null
          locked_until: string | null
          max_attempts: number
          metadata: Json
          object_path: string
          reason: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          bucket_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          locked_until?: string | null
          max_attempts?: number
          metadata?: Json
          object_path: string
          reason: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          bucket_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          locked_until?: string | null
          max_attempts?: number
          metadata?: Json
          object_path?: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      storage_reconciliation_issues: {
        Row: {
          bucket_id: string
          first_seen_at: string
          id: string
          issue_type: string
          last_seen_at: string
          metadata: Json
          object_path: string
          resolved_at: string | null
        }
        Insert: {
          bucket_id: string
          first_seen_at?: string
          id?: string
          issue_type: string
          last_seen_at?: string
          metadata?: Json
          object_path: string
          resolved_at?: string | null
        }
        Update: {
          bucket_id?: string
          first_seen_at?: string
          id?: string
          issue_type?: string
          last_seen_at?: string
          metadata?: Json
          object_path?: string
          resolved_at?: string | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          client_id: string
          closed_at: string | null
          created_at: string
          external_id: string | null
          first_response_at: string | null
          first_response_due_at: string | null
          id: string | null
          last_customer_message_at: string | null
          last_team_response_at: string | null
          opened_at: string
          organization_id: string
          requester_contact_id: string | null
          resolution_due_at: string | null
          resolved_at: string | null
          retainer_id: string | null
          source_payload: Json
          source_provider: string
          source_status: string | null
          source_updated_at: string | null
          source_url: string | null
          todo_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          closed_at?: string | null
          created_at?: string
          external_id?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string | null
          last_customer_message_at?: string | null
          last_team_response_at?: string | null
          opened_at?: string
          organization_id: string
          requester_contact_id?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          retainer_id?: string | null
          source_payload?: Json
          source_provider?: string
          source_status?: string | null
          source_updated_at?: string | null
          source_url?: string | null
          todo_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          closed_at?: string | null
          created_at?: string
          external_id?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string | null
          last_customer_message_at?: string | null
          last_team_response_at?: string | null
          opened_at?: string
          organization_id?: string
          requester_contact_id?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          retainer_id?: string | null
          source_payload?: Json
          source_provider?: string
          source_status?: string | null
          source_updated_at?: string | null
          source_url?: string | null
          todo_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_organization_id_requester_contact_id_fkey"
            columns: ["organization_id", "requester_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_tickets_organization_id_retainer_id_fkey"
            columns: ["organization_id", "retainer_id"]
            isOneToOne: false
            referencedRelation: "retainers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "support_tickets_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: true
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_conflicts: {
        Row: {
          accelo_id: string
          created_at: string
          entity_type: string
          field_name: string | null
          id: string
          local_entity_id: string | null
          local_value: Json | null
          organization_id: string
          project_id: string | null
          remote_value: Json | null
          resolution: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          sync_run_id: string | null
          updated_at: string
        }
        Insert: {
          accelo_id: string
          created_at?: string
          entity_type: string
          field_name?: string | null
          id?: string
          local_entity_id?: string | null
          local_value?: Json | null
          organization_id: string
          project_id?: string | null
          remote_value?: Json | null
          resolution?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sync_run_id?: string | null
          updated_at?: string
        }
        Update: {
          accelo_id?: string
          created_at?: string
          entity_type?: string
          field_name?: string | null
          id?: string
          local_entity_id?: string | null
          local_value?: Json | null
          organization_id?: string
          project_id?: string | null
          remote_value?: Json | null
          resolution?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sync_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_conflicts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_conflicts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_conflicts_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "accelo_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_role_security_matrix: {
        Row: {
          allowed: boolean
          id: number
          notes: string | null
          operation: string
          role: string
          table_category: string
          table_name: string
        }
        Insert: {
          allowed: boolean
          id?: never
          notes?: string | null
          operation: string
          role: string
          table_category: string
          table_name: string
        }
        Update: {
          allowed?: boolean
          id?: never
          notes?: string | null
          operation?: string
          role?: string
          table_category?: string
          table_name?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          billable: boolean
          billable_amount_cents: number | null
          billing_rate_cents: number
          client_id: string
          cost_rate_cents: number | null
          created_at: string
          currency: string
          description: string
          entry_date: string
          external_id: string | null
          id: string
          invoiced_at: string | null
          minutes: number
          organization_id: string
          profile_id: string
          project_id: string
          rejection_reason: string | null
          retainer_period_id: string | null
          source: string
          source_payload: Json
          source_updated_at: string | null
          status: string
          todo_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          billable?: boolean
          billable_amount_cents?: number | null
          billing_rate_cents: number
          client_id: string
          cost_rate_cents?: number | null
          created_at?: string
          currency: string
          description: string
          entry_date?: string
          external_id?: string | null
          id?: string
          invoiced_at?: string | null
          minutes: number
          organization_id: string
          profile_id: string
          project_id: string
          rejection_reason?: string | null
          retainer_period_id?: string | null
          source?: string
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          todo_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          billable?: boolean
          billable_amount_cents?: number | null
          billing_rate_cents?: number
          client_id?: string
          cost_rate_cents?: number | null
          created_at?: string
          currency?: string
          description?: string
          entry_date?: string
          external_id?: string | null
          id?: string
          invoiced_at?: string | null
          minutes?: number
          organization_id?: string
          profile_id?: string
          project_id?: string
          rejection_reason?: string | null
          retainer_period_id?: string | null
          source?: string
          source_payload?: Json
          source_updated_at?: string | null
          status?: string
          todo_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_client_id_retainer_period_id_fkey"
            columns: ["organization_id", "client_id", "retainer_period_id"]
            isOneToOne: false
            referencedRelation: "retainer_periods"
            referencedColumns: ["organization_id", "client_id", "id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_profile_id_fkey"
            columns: ["organization_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "time_entries_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entry_timers: {
        Row: {
          billable: boolean
          client_id: string
          created_at: string
          created_time_entry_id: string | null
          description: string
          id: string
          organization_id: string
          profile_id: string
          project_id: string
          retainer_period_id: string | null
          started_at: string
          status: string
          stopped_at: string | null
          todo_id: string | null
          updated_at: string
        }
        Insert: {
          billable?: boolean
          client_id: string
          created_at?: string
          created_time_entry_id?: string | null
          description: string
          id?: string
          organization_id: string
          profile_id: string
          project_id: string
          retainer_period_id?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          todo_id?: string | null
          updated_at?: string
        }
        Update: {
          billable?: boolean
          client_id?: string
          created_at?: string
          created_time_entry_id?: string | null
          description?: string
          id?: string
          organization_id?: string
          profile_id?: string
          project_id?: string
          retainer_period_id?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          todo_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entry_timers_created_time_entry_id_fkey"
            columns: ["created_time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entry_timers_organization_id_client_id_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "time_entry_timers_organization_id_client_id_retainer_perio_fkey"
            columns: ["organization_id", "client_id", "retainer_period_id"]
            isOneToOne: false
            referencedRelation: "retainer_periods"
            referencedColumns: ["organization_id", "client_id", "id"]
          },
          {
            foreignKeyName: "time_entry_timers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entry_timers_organization_id_profile_id_fkey"
            columns: ["organization_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "time_entry_timers_organization_id_project_id_fkey"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "time_entry_timers_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_assignees: {
        Row: {
          assigned_by: string | null
          basecamp_export_run_id: string | null
          created_at: string
          imported_at: string | null
          profile_id: string
          source: string | null
          source_payload: Json
          todo_id: string
        }
        Insert: {
          assigned_by?: string | null
          basecamp_export_run_id?: string | null
          created_at?: string
          imported_at?: string | null
          profile_id: string
          source?: string | null
          source_payload?: Json
          todo_id: string
        }
        Update: {
          assigned_by?: string | null
          basecamp_export_run_id?: string | null
          created_at?: string
          imported_at?: string | null
          profile_id?: string
          source?: string | null
          source_payload?: Json
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_assignees_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_assignees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_assignees_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_completion_subscribers: {
        Row: {
          basecamp_export_run_id: string | null
          created_at: string
          imported_at: string | null
          profile_id: string
          source: string | null
          source_payload: Json
          todo_id: string
        }
        Insert: {
          basecamp_export_run_id?: string | null
          created_at?: string
          imported_at?: string | null
          profile_id: string
          source?: string | null
          source_payload?: Json
          todo_id: string
        }
        Update: {
          basecamp_export_run_id?: string | null
          created_at?: string
          imported_at?: string | null
          profile_id?: string
          source?: string | null
          source_payload?: Json
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_completion_subscribers_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_completion_subscribers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_completion_subscribers_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_lists: {
        Row: {
          basecamp_export_run_id: string | null
          basecamp_payload: Json
          basecamp_todolist_id: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          imported_at: string | null
          is_archived: boolean
          position: number
          project_id: string
          source_created_at: string | null
          source_exported_at: string | null
          source_path: string | null
          source_updated_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_todolist_id?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          imported_at?: string | null
          is_archived?: boolean
          position?: number
          project_id: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_todolist_id?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          imported_at?: string | null
          is_archived?: boolean
          position?: number
          project_id?: string
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_lists_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_lists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_subtasks: {
        Row: {
          basecamp_export_run_id: string | null
          basecamp_payload: Json
          basecamp_subtask_id: number | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          imported_at: string | null
          position: number
          source_created_at: string | null
          source_exported_at: string | null
          source_path: string | null
          source_updated_at: string | null
          title: string
          todo_id: string
          updated_at: string
          version: number
        }
        Insert: {
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_subtask_id?: number | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          imported_at?: string | null
          position?: number
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          title: string
          todo_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_subtask_id?: number | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          imported_at?: string | null
          position?: number
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          title?: string
          todo_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "todo_subtasks_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_subtasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_subtasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_subtasks_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todos: {
        Row: {
          accelo_activity_id: string | null
          accelo_issue_id: string | null
          accelo_parent_id: string | null
          accelo_payload: Json
          accelo_task_id: string | null
          accelo_url: string | null
          actual_minutes: number | null
          assigned_to: string | null
          basecamp_creator_id: number | null
          basecamp_export_run_id: string | null
          basecamp_payload: Json
          basecamp_todo_id: number | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          cycle_id: string | null
          description: string | null
          due_at: string | null
          due_on: string | null
          estimated_minutes: number | null
          id: string
          imported_at: string | null
          issue_number: number
          issue_type: string
          labels: string[]
          last_synced_at: string | null
          milestone_id: string | null
          operational_state: string
          position: number
          priority: string
          project_id: string
          rank: number
          risk_level: string | null
          risk_reason: string | null
          source_created_at: string | null
          source_exported_at: string | null
          source_path: string | null
          source_updated_at: string | null
          status: string
          sync_error: string | null
          sync_status: string
          sync_version: number
          title: string
          todo_list_id: string
          updated_at: string
          version: number
        }
        Insert: {
          accelo_activity_id?: string | null
          accelo_issue_id?: string | null
          accelo_parent_id?: string | null
          accelo_payload?: Json
          accelo_task_id?: string | null
          accelo_url?: string | null
          actual_minutes?: number | null
          assigned_to?: string | null
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_todo_id?: number | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id?: string | null
          description?: string | null
          due_at?: string | null
          due_on?: string | null
          estimated_minutes?: number | null
          id?: string
          imported_at?: string | null
          issue_number: number
          issue_type?: string
          labels?: string[]
          last_synced_at?: string | null
          milestone_id?: string | null
          operational_state?: string
          position?: number
          priority?: string
          project_id: string
          rank: number
          risk_level?: string | null
          risk_reason?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: string
          sync_version?: number
          title: string
          todo_list_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          accelo_activity_id?: string | null
          accelo_issue_id?: string | null
          accelo_parent_id?: string | null
          accelo_payload?: Json
          accelo_task_id?: string | null
          accelo_url?: string | null
          actual_minutes?: number | null
          assigned_to?: string | null
          basecamp_creator_id?: number | null
          basecamp_export_run_id?: string | null
          basecamp_payload?: Json
          basecamp_todo_id?: number | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id?: string | null
          description?: string | null
          due_at?: string | null
          due_on?: string | null
          estimated_minutes?: number | null
          id?: string
          imported_at?: string | null
          issue_number?: number
          issue_type?: string
          labels?: string[]
          last_synced_at?: string | null
          milestone_id?: string | null
          operational_state?: string
          position?: number
          priority?: string
          project_id?: string
          rank?: number
          risk_level?: string | null
          risk_reason?: string | null
          source_created_at?: string | null
          source_exported_at?: string | null
          source_path?: string | null
          source_updated_at?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: string
          sync_version?: number
          title?: string
          todo_list_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "todos_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_basecamp_export_run_id_fkey"
            columns: ["basecamp_export_run_id"]
            isOneToOne: false
            referencedRelation: "basecamp_export_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "project_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_todo_list_id_fkey"
            columns: ["todo_list_id"]
            isOneToOne: false
            referencedRelation: "todo_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_reservations: {
        Row: {
          bucket_id: string
          conversation_id: string | null
          created_at: string
          expires_at: string
          failure_reason: string | null
          file_name: string
          finalized_at: string | null
          folder_id: string | null
          id: string
          mime_type: string | null
          object_path: string
          organization_id: string | null
          progress_bytes: number
          project_id: string | null
          resource_id: string | null
          size_bytes: number
          status: string
          target_kind: string
          updated_at: string
          uploader_id: string
        }
        Insert: {
          bucket_id: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          failure_reason?: string | null
          file_name: string
          finalized_at?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          object_path: string
          organization_id?: string | null
          progress_bytes?: number
          project_id?: string | null
          resource_id?: string | null
          size_bytes: number
          status?: string
          target_kind: string
          updated_at?: string
          uploader_id: string
        }
        Update: {
          bucket_id?: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          failure_reason?: string | null
          file_name?: string
          finalized_at?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          object_path?: string
          organization_id?: string | null
          progress_bytes?: number
          project_id?: string | null
          resource_id?: string | null
          size_bytes?: number
          status?: string
          target_kind?: string
          updated_at?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_reservations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_reservations_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "file_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_reservations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_reservations_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      work_approvals: {
        Row: {
          automation_run_id: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          organization_id: string
          project_id: string
          requested_by: string
          responded_at: string | null
          response_note: string | null
          reviewer_id: string
          source_conversation_id: string | null
          source_message_id: string | null
          status: string
          subject_id: string
          subject_type: string
          title: string
          updated_at: string
        }
        Insert: {
          automation_run_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          organization_id: string
          project_id: string
          requested_by?: string
          responded_at?: string | null
          response_note?: string | null
          reviewer_id: string
          source_conversation_id?: string | null
          source_message_id?: string | null
          status?: string
          subject_id: string
          subject_type: string
          title: string
          updated_at?: string
        }
        Update: {
          automation_run_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          requested_by?: string
          responded_at?: string | null
          response_note?: string | null
          reviewer_id?: string
          source_conversation_id?: string | null
          source_message_id?: string | null
          status?: string
          subject_id?: string
          subject_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_approvals_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: true
            referencedRelation: "automation_rule_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_approvals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_approvals_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_approvals_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_approvals_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      work_cycles: {
        Row: {
          created_at: string
          created_by: string
          ends_on: string
          goal: string | null
          id: string
          name: string
          organization_id: string
          project_id: string | null
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          ends_on: string
          goal?: string | null
          id?: string
          name: string
          organization_id: string
          project_id?: string | null
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_on?: string
          goal?: string | null
          id?: string
          name?: string
          organization_id?: string
          project_id?: string | null
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_cycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_cycles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      work_decisions: {
        Row: {
          created_at: string
          created_by: string
          decided_at: string
          id: string
          organization_id: string
          owner_id: string | null
          project_id: string
          rationale: string | null
          source_conversation_id: string | null
          source_message_id: string | null
          status: string
          summary: string
          superseded_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          decided_at?: string
          id?: string
          organization_id: string
          owner_id?: string | null
          project_id: string
          rationale?: string | null
          source_conversation_id?: string | null
          source_message_id?: string | null
          status?: string
          summary: string
          superseded_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          decided_at?: string
          id?: string
          organization_id?: string
          owner_id?: string | null
          project_id?: string
          rationale?: string | null
          source_conversation_id?: string | null
          source_message_id?: string | null
          status?: string
          summary?: string
          superseded_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_decisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_decisions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_decisions_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_decisions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_decisions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "work_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      work_goals: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          organization_id: string
          owner_id: string | null
          parent_goal_id: string | null
          progress: number
          project_id: string | null
          starts_on: string | null
          status: string
          target_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          organization_id: string
          owner_id?: string | null
          parent_goal_id?: string | null
          progress?: number
          project_id?: string | null
          starts_on?: string | null
          status?: string
          target_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          organization_id?: string
          owner_id?: string | null
          parent_goal_id?: string | null
          progress?: number
          project_id?: string | null
          starts_on?: string | null
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_goals_parent_goal_id_fkey"
            columns: ["parent_goal_id"]
            isOneToOne: false
            referencedRelation: "work_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_goals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      work_templates: {
        Row: {
          configuration: Json
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_shared: boolean
          name: string
          organization_id: string
          template_type: string
          updated_at: string
        }
        Insert: {
          configuration?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_shared?: boolean
          name: string
          organization_id: string
          template_type: string
          updated_at?: string
        }
        Update: {
          configuration?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_shared?: boolean
          name?: string
          organization_id?: string
          template_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          organization_id: string
          project_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          organization_id: string
          project_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_audit_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_chat_conversation_projection: {
        Row: {
          conversation_id: string
          kind_rank: number
          last_message_at: string | null
          last_message_id: string | null
          last_message_sender_id: string | null
          organization_id: string
          profile_id: string
          projected_at: string
          sort_at: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          conversation_id: string
          kind_rank: number
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_sender_id?: string | null
          organization_id: string
          profile_id: string
          projected_at?: string
          sort_at: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          kind_rank?: number
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_sender_id?: string | null
          organization_id?: string
          profile_id?: string
          projected_at?: string
          sort_at?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_chat_conversation_project_last_message_sender_id_fkey"
            columns: ["last_message_sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_chat_conversation_projection_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_chat_conversation_projection_last_message_id_fkey"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_chat_conversation_projection_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_chat_conversation_projection_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_chat_events: {
        Row: {
          conversation_id: string | null
          event_at: string
          event_type: string
          message_id: string | null
          organization_id: string
          parent_message_id: string | null
          profile_id: string
          sender_id: string | null
          sequence: number
        }
        Insert: {
          conversation_id?: string | null
          event_at?: string
          event_type: string
          message_id?: string | null
          organization_id: string
          parent_message_id?: string | null
          profile_id: string
          sender_id?: string | null
          sequence: number
        }
        Update: {
          conversation_id?: string | null
          event_at?: string
          event_type?: string
          message_id?: string | null
          organization_id?: string
          parent_message_id?: string | null
          profile_id?: string
          sender_id?: string | null
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "workspace_chat_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_chat_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_chat_sync_cursors: {
        Row: {
          last_sequence: number
          profile_id: string
          updated_at: string
        }
        Insert: {
          last_sequence?: number
          profile_id: string
          updated_at?: string
        }
        Update: {
          last_sequence?: number
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_chat_sync_cursors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_conversation_members: {
        Row: {
          added_by: string | null
          conversation_id: string
          created_at: string
          joined_at: string
          member_role: string
          profile_id: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          conversation_id: string
          created_at?: string
          joined_at?: string
          member_role?: string
          profile_id: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          conversation_id?: string
          created_at?: string
          joined_at?: string
          member_role?: string
          profile_id?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_conversation_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_conversation_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_conversation_reads: {
        Row: {
          conversation_id: string
          created_at: string
          last_read_at: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          last_read_at?: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          last_read_at?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_conversation_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_conversations: {
        Row: {
          created_at: string
          created_by: string | null
          dm_member_key: string | null
          dm_profile_a: string | null
          dm_profile_b: string | null
          id: string
          kind: string
          name: string | null
          organization_id: string
          purpose: string | null
          slug: string | null
          topic: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dm_member_key?: string | null
          dm_profile_a?: string | null
          dm_profile_b?: string | null
          id?: string
          kind: string
          name?: string | null
          organization_id: string
          purpose?: string | null
          slug?: string | null
          topic?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dm_member_key?: string | null
          dm_profile_a?: string | null
          dm_profile_b?: string | null
          id?: string
          kind?: string
          name?: string | null
          organization_id?: string
          purpose?: string | null
          slug?: string | null
          topic?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_conversations_dm_profile_a_fkey"
            columns: ["dm_profile_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_conversations_dm_profile_b_fkey"
            columns: ["dm_profile_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_cross_links: {
        Row: {
          archive_record_id: string | null
          chat_type: string
          comment_id: string | null
          conversation_id: string
          created_at: string
          created_by: string
          doc_id: string | null
          file_id: string | null
          folder_id: string | null
          id: string
          milestone_id: string | null
          organization_id: string
          project_id: string | null
          project_message_id: string | null
          todo_id: string | null
          work_id: string
          work_type: string
          workspace_attachment_id: string | null
          workspace_message_id: string | null
        }
        Insert: {
          archive_record_id?: string | null
          chat_type: string
          comment_id?: string | null
          conversation_id: string
          created_at?: string
          created_by: string
          doc_id?: string | null
          file_id?: string | null
          folder_id?: string | null
          id?: string
          milestone_id?: string | null
          organization_id: string
          project_id?: string | null
          project_message_id?: string | null
          todo_id?: string | null
          work_id: string
          work_type: string
          workspace_attachment_id?: string | null
          workspace_message_id?: string | null
        }
        Update: {
          archive_record_id?: string | null
          chat_type?: string
          comment_id?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string
          doc_id?: string | null
          file_id?: string | null
          folder_id?: string | null
          id?: string
          milestone_id?: string | null
          organization_id?: string
          project_id?: string | null
          project_message_id?: string | null
          todo_id?: string | null
          work_id?: string
          work_type?: string
          workspace_attachment_id?: string | null
          workspace_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_cross_links_archive_record_id_fkey"
            columns: ["archive_record_id"]
            isOneToOne: false
            referencedRelation: "basecamp_archive_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "file_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_project_message_id_fkey"
            columns: ["project_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_workspace_attachment_id_fkey"
            columns: ["workspace_attachment_id"]
            isOneToOne: false
            referencedRelation: "workspace_message_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_cross_links_workspace_message_id_fkey"
            columns: ["workspace_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_inbox_items: {
        Row: {
          acknowledged_at: string | null
          actor_id: string | null
          body: string | null
          completed_at: string | null
          created_at: string
          href: string
          id: string
          kind: string
          organization_id: string
          priority: string
          project_id: string | null
          read_at: string | null
          recipient_id: string
          snoozed_until: string | null
          source_id: string
          source_type: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          actor_id?: string | null
          body?: string | null
          completed_at?: string | null
          created_at?: string
          href: string
          id?: string
          kind: string
          organization_id: string
          priority?: string
          project_id?: string | null
          read_at?: string | null
          recipient_id: string
          snoozed_until?: string | null
          source_id: string
          source_type: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          actor_id?: string | null
          body?: string | null
          completed_at?: string | null
          created_at?: string
          href?: string
          id?: string
          kind?: string
          organization_id?: string
          priority?: string
          project_id?: string | null
          read_at?: string | null
          recipient_id?: string
          snoozed_until?: string | null
          source_id?: string
          source_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_inbox_items_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_inbox_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_inbox_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_inbox_items_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_message_attachments: {
        Row: {
          bucket_id: string
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          message_id: string | null
          mime_type: string | null
          object_path: string
          size_bytes: number
          uploader_id: string
        }
        Insert: {
          bucket_id?: string
          conversation_id: string
          created_at?: string
          file_name: string
          id?: string
          message_id?: string | null
          mime_type?: string | null
          object_path: string
          size_bytes: number
          uploader_id: string
        }
        Update: {
          bucket_id?: string
          conversation_id?: string
          created_at?: string
          file_name?: string
          id?: string
          message_id?: string | null
          mime_type?: string | null
          object_path?: string
          size_bytes?: number
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_message_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_attachments_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_message_edits: {
        Row: {
          conversation_id: string
          edited_at: string
          editor_id: string
          id: string
          message_id: string
          organization_id: string
          previous_body: string
        }
        Insert: {
          conversation_id: string
          edited_at?: string
          editor_id: string
          id?: string
          message_id: string
          organization_id: string
          previous_body: string
        }
        Update: {
          conversation_id?: string
          edited_at?: string
          editor_id?: string
          id?: string
          message_id?: string
          organization_id?: string
          previous_body?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_message_edits_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_edits_editor_id_fkey"
            columns: ["editor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_edits_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_edits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_message_signals: {
        Row: {
          created_at: string
          message_id: string
          profile_id: string
          signal: string
        }
        Insert: {
          created_at?: string
          message_id: string
          profile_id: string
          signal: string
        }
        Update: {
          created_at?: string
          message_id?: string
          profile_id?: string
          signal?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_message_signals_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_signals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_messages: {
        Row: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_message_id: string | null
          sender_id: string
        }
        Insert: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          client_nonce?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_pins: {
        Row: {
          conversation_id: string
          created_at: string
          href: string | null
          id: string
          message_id: string | null
          organization_id: string
          pinned_by: string
          title: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          href?: string | null
          id?: string
          message_id?: string | null
          organization_id: string
          pinned_by?: string
          title: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          href?: string | null
          id?: string
          message_id?: string | null
          organization_id?: string
          pinned_by?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "workspace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_pins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_pins_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_thread_reads: {
        Row: {
          created_at: string
          last_read_at: string
          profile_id: string
          root_message_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          last_read_at?: string
          profile_id: string
          root_message_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          last_read_at?: string
          profile_id?: string
          root_message_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_thread_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_thread_reads_root_message_id_fkey"
            columns: ["root_message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ack_slack_notification: {
        Args: { notification_id: string; notification_lock_token: string }
        Returns: boolean
      }
      ack_storage_deletion: {
        Args: { deletion_id: string; deletion_lock_token: string }
        Returns: boolean
      }
      add_support_ticket_comment: {
        Args: {
          requested_actor_id: string
          target_body: string
          target_todo_id: string
        }
        Returns: Json
      }
      advance_overdue_invoices: { Args: never; Returns: number }
      allocate_payment_multi: {
        Args: {
          target_allocations: Json
          target_client_id: string
          target_currency: string
          target_idempotency_key: string
          target_method: string
          target_payment_date: string
          target_reference: string
        }
        Returns: {
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          external_id: string | null
          id: string
          idempotency_key: string
          method: string
          notes: string | null
          organization_id: string
          payment_date: string
          received_by: string | null
          reference: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_time_entries: {
        Args: { target_time_entry_ids: string[] }
        Returns: number
      }
      begin_organization_export: {
        Args: {
          target_export_kind?: string
          target_organization_id: string
          target_requested_by?: string
        }
        Returns: {
          checksum_sha256: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          export_kind: string
          id: string
          manifest: Json
          organization_id: string
          requested_by: string | null
          row_counts: Json
          started_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_export_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      capture_communication_message: {
        Args: {
          target_attachments?: Json
          target_body: string
          target_client_id: string
          target_contact_id: string
          target_direction: string
          target_idempotency_key?: string
          target_occurred_at: string
          target_participants?: Json
          target_project_id: string
          target_source_provider: string
          target_source_thread_id: string
          target_subject: string
        }
        Returns: {
          client_id: string | null
          contact_id: string | null
          created_at: string
          direction: string
          id: string
          last_message_at: string
          metadata: Json
          organization_id: string
          project_id: string | null
          source_provider: string
          source_thread_id: string | null
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_threads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_file_share_rate_limit: {
        Args: {
          target_block_minutes?: number
          target_ip_hash: string
          target_max_attempts?: number
          target_token_hash: string
          target_window_minutes?: number
        }
        Returns: Json
      }
      claim_accelo_activity_recoveries: {
        Args: {
          result_limit?: number
          target_lease_token: string
          target_run_id: string
        }
        Returns: {
          recovery_attempt_count: number
          required_parent_identity: Json
          source_record_id: string
          unresolved_id: string
        }[]
      }
      claim_basecamp_file_blob: {
        Args: {
          target_blob_id: string
          target_bucket_id: string
          target_crc32: string
          target_lease_token: string
          target_mime_type: string
          target_object_path: string
          target_organization_id: string
          target_sha256: string
          target_size_bytes: number
        }
        Returns: {
          bucket_id: string
          claimed: boolean
          id: string
          object_path: string
          status: string
          tus_offset_bytes: number
          tus_upload_url: string
        }[]
      }
      claim_slack_notifications: {
        Args: { lease_seconds?: number; requested_limit?: number }
        Returns: {
          attempt_count: number
          channel: string
          event_type: string
          id: string
          lock_token: string
          payload: Json
        }[]
      }
      claim_storage_deletions: {
        Args: { lease_seconds?: number; requested_limit?: number }
        Returns: {
          attempt_count: number
          bucket_id: string
          id: string
          lock_token: string
          object_path: string
        }[]
      }
      claim_workspace_invite: {
        Args: { invite_token: string; requested_full_name: string }
        Returns: string
      }
      cleanup_workspace_chat_events: {
        Args: { requested_limit?: number }
        Returns: number
      }
      complete_organization_export: {
        Args: {
          target_checksum_sha256: string
          target_export_id: string
          target_manifest: Json
          target_row_counts?: Json
        }
        Returns: {
          checksum_sha256: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          export_kind: string
          id: string
          manifest: Json
          organization_id: string
          requested_by: string | null
          row_counts: Json
          started_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_export_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      configure_accelo_shadow: {
        Args: {
          target_actor_id: string
          target_entities: string[]
          target_organization_id: string
          target_reason: string
          target_source_account_id: string
        }
        Returns: number
      }
      convert_prospect_to_won: {
        Args: {
          target_conversion_key?: string
          target_create_retainer?: boolean
          target_project_code: string
          target_project_name: string
          target_prospect_id: string
          target_retainer_fee_cents?: number
          target_retainer_included_minutes?: number
          target_retainer_name?: string
          target_start_date?: string
        }
        Returns: Json
      }
      correct_payment_allocation: {
        Args: {
          target_allocation_id: string
          target_amount_cents: number
          target_idempotency_key: string
        }
        Returns: {
          allocated_by: string | null
          amount_cents: number
          client_id: string
          created_at: string
          id: string
          invoice_id: string
          organization_id: string
          payment_id: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_allocations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_detailed_invoice: {
        Args: {
          target_attention_to: string
          target_billing_address: Json
          target_client_id: string
          target_currency: string
          target_due_date: string
          target_invoice_number: string
          target_issue_date: string
          target_line_items: Json
          target_notes?: string
          target_payment_instructions?: string
          target_payment_terms?: string
          target_project_id: string
          target_service_period_end: string
          target_service_period_start: string
          target_subject: string
          target_tax_cents?: number
        }
        Returns: {
          attention_to: string | null
          balance_cents: number | null
          billing_address: Json
          client_id: string
          collection_notes: string | null
          collection_owner_id: string | null
          collection_promise_notes: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivered_at: string | null
          delivery_method: string | null
          due_date: string
          external_id: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_at: string | null
          last_collection_reminder_at: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_cents: number
          payment_instructions: string | null
          payment_terms: string | null
          project_id: string | null
          promised_payment_date: string | null
          service_period_end: string | null
          service_period_start: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          subject: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number | null
          updated_at: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invoice_from_time_entries: {
        Args: {
          target_client_id: string
          target_due_date: string
          target_invoice_number: string
          target_issue_date: string
          target_project_id: string
          target_tax_cents?: number
          target_time_entry_ids: string[]
        }
        Returns: {
          attention_to: string | null
          balance_cents: number | null
          billing_address: Json
          client_id: string
          collection_notes: string | null
          collection_owner_id: string | null
          collection_promise_notes: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivered_at: string | null
          delivery_method: string | null
          due_date: string
          external_id: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_at: string | null
          last_collection_reminder_at: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_cents: number
          payment_instructions: string | null
          payment_terms: string | null
          project_id: string | null
          promised_payment_date: string | null
          service_period_end: string | null
          service_period_start: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          subject: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number | null
          updated_at: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_issue_from_workspace_message: {
        Args: {
          requested_actor_id?: string
          target_assignee_ids?: string[]
          target_due_at?: string
          target_idempotency_key?: string
          target_message_id: string
          target_priority?: string
          target_project_id: string
          target_title: string
        }
        Returns: Json
      }
      create_manual_invoice: {
        Args: {
          target_client_id: string
          target_currency: string
          target_due_date: string
          target_invoice_number: string
          target_issue_date: string
          target_line_items: Json
          target_notes?: string
          target_project_id: string
          target_tax_cents?: number
        }
        Returns: {
          attention_to: string | null
          balance_cents: number | null
          billing_address: Json
          client_id: string
          collection_notes: string | null
          collection_owner_id: string | null
          collection_promise_notes: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivered_at: string | null
          delivery_method: string | null
          due_date: string
          external_id: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_at: string | null
          last_collection_reminder_at: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_cents: number
          payment_instructions: string | null
          payment_terms: string | null
          project_id: string | null
          promised_payment_date: string | null
          service_period_end: string | null
          service_period_start: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          subject: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number | null
          updated_at: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project_comment: {
        Args: {
          requested_actor_id: string
          target_attachment_file_ids: string[]
          target_body: string
          target_external_attachments: Json
          target_idempotency_key: string
          target_mention_profile_ids: string[]
          target_parent_id: string
          target_parent_type: string
          target_project_id: string
        }
        Returns: Json
      }
      create_project_issue: {
        Args: {
          requested_actor_id: string
          target_actual_minutes: number
          target_assignee_ids: string[]
          target_completion_subscriber_ids: string[]
          target_description: string
          target_due_at: string
          target_estimated_minutes: number
          target_idempotency_key: string
          target_issue_type: string
          target_labels: string[]
          target_priority: string
          target_project_id: string
          target_title: string
          target_todo_list_id: string
        }
        Returns: Json
      }
      create_project_message: {
        Args: {
          requested_actor_id: string
          target_body: string
          target_category: string
          target_idempotency_key: string
          target_project_id: string
          target_subject: string
        }
        Returns: Json
      }
      create_project_subtask: {
        Args: {
          requested_actor_id: string
          target_idempotency_key: string
          target_title: string
          target_todo_id: string
        }
        Returns: Json
      }
      create_project_todo: {
        Args: {
          requested_actor_id: string
          target_assignee_ids: string[]
          target_completion_subscriber_ids: string[]
          target_description: string
          target_due_at: string
          target_idempotency_key: string
          target_priority: string
          target_project_id: string
          target_title: string
          target_todo_list_id: string
        }
        Returns: Json
      }
      create_upload_reservation: {
        Args: {
          target_id: string
          upload_file_name: string
          upload_mime_type: string
          upload_size_bytes: number
          upload_target: string
        }
        Returns: Json
      }
      create_workspace_conversation: {
        Args: {
          target_kind: string
          target_member_ids: string[]
          target_name: string
          target_slug: string
          target_visibility: string
        }
        Returns: string
      }
      create_workspace_file_upload: {
        Args: {
          target_folder_id: string
          upload_file_name: string
          upload_mime_type: string
          upload_size_bytes: number
        }
        Returns: Json
      }
      dead_letter_slack_notification: {
        Args: {
          failure_code?: string
          failure_message: string
          notification_id: string
          notification_lock_token: string
        }
        Returns: boolean
      }
      discard_time_timer: {
        Args: { target_timer_id: string }
        Returns: {
          billable: boolean
          client_id: string
          created_at: string
          created_time_entry_id: string | null
          description: string
          id: string
          organization_id: string
          profile_id: string
          project_id: string
          retainer_period_id: string | null
          started_at: string
          status: string
          stopped_at: string | null
          todo_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entry_timers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_slack_notification: {
        Args: {
          notification_blocks?: Json
          notification_channel: string
          notification_event_type: string
          notification_idempotency_key?: string
          notification_metadata?: Json
          notification_text: string
          notification_thread_ts?: string
        }
        Returns: string
      }
      export_commercial_report_csv: {
        Args: {
          report_kind?: string
          requested_days?: number
          target_project_id?: string
        }
        Returns: Json
      }
      fail_slack_notification: {
        Args: {
          failure_code?: string
          failure_message: string
          notification_id: string
          notification_lock_token: string
          retry_after_seconds?: number
        }
        Returns: string
      }
      fail_storage_deletion: {
        Args: {
          deletion_id: string
          deletion_lock_token: string
          failure_message: string
        }
        Returns: string
      }
      fail_upload_reservation: {
        Args: { failure_message: string; reservation_id: string }
        Returns: Json
      }
      finalize_accelo_pull_run: {
        Args: {
          target_end_cursor?: Json
          target_lease_token: string
          target_run_id: string
          target_summary?: Json
        }
        Returns: {
          created_at: string
          direction: string | null
          end_cursor: Json | null
          error_message: string | null
          finalized_at: string | null
          full_snapshot: boolean
          heartbeat_at: string | null
          id: string
          idempotency_key: string
          lease_acquired_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          manifest: Json
          organization_id: string
          provider: string
          records_mapped: number
          records_quarantined: number
          records_scanned: number
          records_staged: number
          requested_entities: string[]
          source_account_id: string
          start_cursor: Json | null
          started_at: string | null
          status: string
          summary: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "accelo_pull_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_basecamp_import: {
        Args: { target_run_id: string }
        Returns: Json
      }
      finalize_upload_reservation: {
        Args: { reservation_id: string }
        Returns: Json
      }
      finalize_workspace_file_upload: {
        Args: { reservation_id: string }
        Returns: Json
      }
      get_accelo_parity_summary: { Args: never; Returns: Json }
      get_accelo_pending_report: {
        Args: {
          target_organization_id: string
          target_source_account_id: string
        }
        Returns: Json
      }
      get_accounts_receivable_report: {
        Args: { as_of_date?: string; requested_limit?: number }
        Returns: Json
      }
      get_activity_project_data: {
        Args: {
          before_activity_id?: string
          before_created_at?: string
          requested_limit?: number
        }
        Returns: Json
      }
      get_agency_clients: {
        Args: {
          after_client_id?: string
          after_name?: string
          requested_limit?: number
          status_filters?: string[]
          text_filter?: string
        }
        Returns: Json
      }
      get_basecamp_project_archive_counts: {
        Args: { project_id: string; run_id?: string }
        Returns: {
          entry_classifications: Json
          entry_count: number
          export_run_id: string
          imported_file_count: number
          record_count: number
          record_types: Json
        }[]
      }
      get_billing_workbench: {
        Args: { through_date?: string }
        Returns: {
          amount_cents: number
          client_id: string
          client_name: string
          currency: string
          description: string
          project_id: string
          project_name: string
          quantity: number
          ready_since: string
          source_id: string
          source_type: string
        }[]
      }
      get_client_operations: {
        Args: {
          requested_activity_limit?: number
          requested_invoice_limit?: number
          requested_time_limit?: number
          target_client_id: string
        }
        Returns: Json
      }
      get_commercial_operations_report: {
        Args: { requested_days?: number; target_project_id?: string }
        Returns: Json
      }
      get_commercial_snapshot: { Args: never; Returns: Json }
      get_dashboard_project_data: {
        Args: {
          before_activity_created_at?: string
          before_activity_id?: string
          before_project_id?: string
          before_project_updated_at?: string
          requested_activity_limit?: number
          requested_project_limit?: number
        }
        Returns: Json
      }
      get_delivery_report: {
        Args: { requested_days?: number; target_project_id?: string }
        Returns: Json
      }
      get_issue_detail_data: { Args: { target_todo_id: string }; Returns: Json }
      get_my_work_project_data: {
        Args: {
          after_due_at?: string
          after_todo_id?: string
          requested_limit?: number
        }
        Returns: Json
      }
      get_project_commercial_summary: {
        Args: { target_project_id: string }
        Returns: Json
      }
      get_project_issues_data: {
        Args: {
          after_issue_number?: number
          after_rank?: number
          after_todo_id?: string
          assignee_filter?: string
          due_state_filter?: string
          label_filters?: string[]
          operational_state_filters?: string[]
          priority_filters?: string[]
          requested_limit?: number
          status_filters?: string[]
          target_project_id: string
          text_filter?: string
          unassigned_filter?: boolean
        }
        Returns: Json
      }
      get_project_messages_data: {
        Args: {
          before_created_at?: string
          before_message_id?: string
          requested_limit?: number
          target_project_id: string
        }
        Returns: Json
      }
      get_project_overview_data: {
        Args: {
          after_milestone_due_date?: string
          after_milestone_id?: string
          requested_chat_limit?: number
          requested_document_limit?: number
          requested_milestone_limit?: number
          target_project_id: string
        }
        Returns: Json
      }
      get_project_todos_data: {
        Args: {
          after_list_position?: number
          after_todo_id?: string
          after_todo_position?: number
          requested_limit?: number
          target_project_id: string
        }
        Returns: Json
      }
      get_projects_project_data: {
        Args: {
          before_project_id?: string
          before_updated_at?: string
          requested_limit?: number
        }
        Returns: Json
      }
      get_relationship_timeline: {
        Args: {
          before_occurred_at?: string
          result_limit?: number
          search_query?: string
          target_activity_type?: string
          target_client_id: string
          target_source?: string
        }
        Returns: {
          activity_type: string
          author_name: string
          body: string
          client_id: string
          contact_id: string
          contact_name: string
          direction: string
          duration_minutes: number
          has_more: boolean
          id: string
          occurred_at: string
          participant_contact_ids: string[]
          project_id: string
          project_name: string
          source: string
          subject: string
        }[]
      }
      get_retainer_burn_report: {
        Args: {
          from_period_start?: string
          requested_limit?: number
          target_retainer_id: string
        }
        Returns: Json
      }
      get_retainers_overview: {
        Args: { requested_limit?: number }
        Returns: Json
      }
      get_support_queue: {
        Args: {
          client_filter?: string
          include_closed?: boolean
          owner_filter?: string
          priority_filters?: string[]
          requested_limit?: number
          sla_filter?: string
          status_filters?: string[]
          text_filter?: string
        }
        Returns: Json
      }
      get_support_ticket_detail: {
        Args: { target_todo_id: string }
        Returns: Json
      }
      get_team_project_data: {
        Args: {
          after_due_at?: string
          after_todo_id?: string
          requested_limit?: number
        }
        Returns: Json
      }
      get_upload_reservation: {
        Args: { reservation_id: string }
        Returns: Json
      }
      get_workspace_admin_channels: { Args: never; Returns: Json }
      get_workspace_admin_profiles: { Args: never; Returns: Json }
      get_workspace_chat_bootstrap: {
        Args: {
          requested_message_limit?: number
          requested_summary_limit?: number
          target_conversation_id?: string
        }
        Returns: Json
      }
      get_workspace_chat_events: {
        Args: { after_sequence?: number; requested_limit?: number }
        Returns: Json
      }
      get_workspace_conversation_members: {
        Args: { target_conversation_id: string }
        Returns: {
          member_role: string
          profile_id: string
        }[]
      }
      get_workspace_conversation_summaries: {
        Args: never
        Returns: {
          can_manage: boolean
          conversation_id: string
          created_at: string
          current_member_role: string
          dm_member_key: string
          dm_profile_a: string
          dm_profile_b: string
          kind: string
          last_message_at: string
          last_message_body: string
          last_message_id: string
          last_message_sender_id: string
          members: Json
          name: string
          organization_id: string
          slug: string
          unread_count: number
          updated_at: string
          visibility: string
        }[]
      }
      get_workspace_conversation_summaries_page: {
        Args: {
          after_conversation_id?: string
          after_kind_rank?: number
          after_sort_at?: string
          requested_limit?: number
          target_conversation_id?: string
        }
        Returns: Json
      }
      get_workspace_messages_delta_v1: {
        Args: {
          after_created_at?: string
          after_message_id?: string
          requested_limit?: number
          target_conversation_id: string
          target_parent_message_id?: string
        }
        Returns: {
          attachments: Json
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          last_reply_at: string
          message_id: string
          parent_message_id: string
          reply_count: number
          sender_id: string
          thread_unread_count: number
        }[]
      }
      get_workspace_messages_page: {
        Args: {
          before_created_at?: string
          before_message_id?: string
          requested_limit?: number
          target_conversation_id: string
        }
        Returns: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          message_id: string
          sender_id: string
        }[]
      }
      get_workspace_messages_page_v2: {
        Args: {
          before_created_at?: string
          before_message_id?: string
          requested_limit?: number
          target_conversation_id: string
          target_parent_message_id?: string
        }
        Returns: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          last_reply_at: string
          message_id: string
          parent_message_id: string
          reply_count: number
          sender_id: string
          thread_unread_count: number
        }[]
      }
      get_workspace_messages_page_v3: {
        Args: {
          before_created_at?: string
          before_message_id?: string
          requested_limit?: number
          target_conversation_id: string
          target_parent_message_id?: string
        }
        Returns: {
          attachments: Json
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          last_reply_at: string
          message_id: string
          parent_message_id: string
          reply_count: number
          sender_id: string
          thread_unread_count: number
        }[]
      }
      get_workspace_messages_page_v4: {
        Args: {
          before_created_at?: string
          before_message_id?: string
          requested_limit?: number
          target_conversation_id: string
          target_parent_message_id?: string
        }
        Returns: {
          attachments: Json
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          last_reply_at: string
          message_id: string
          parent_message_id: string
          reply_count: number
          sender_id: string
          thread_unread_count: number
        }[]
      }
      heartbeat_accelo_pull_run: {
        Args: {
          target_lease_seconds?: number
          target_lease_token: string
          target_run_id: string
        }
        Returns: {
          created_at: string
          direction: string | null
          end_cursor: Json | null
          error_message: string | null
          finalized_at: string | null
          full_snapshot: boolean
          heartbeat_at: string | null
          id: string
          idempotency_key: string
          lease_acquired_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          manifest: Json
          organization_id: string
          provider: string
          records_mapped: number
          records_quarantined: number
          records_scanned: number
          records_staged: number
          requested_entities: string[]
          source_account_id: string
          start_cursor: Json | null
          started_at: string | null
          status: string
          summary: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "accelo_pull_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ingest_communication_webhook: {
        Args: {
          target_event_id: string
          target_organization_id: string
          target_payload: Json
          target_provider: string
        }
        Returns: {
          created_at: string
          event_id: string
          id: string
          organization_id: string
          payload: Json
          processed_at: string | null
          provider: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_webhook_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_credit_note: {
        Args: {
          target_amount_cents: number
          target_idempotency_key: string
          target_invoice_id: string
          target_reason: string
        }
        Returns: {
          adjustment_type: string
          amount_cents: number
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          idempotency_key: string
          invoice_id: string
          organization_id: string
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_adjustments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_invoice: {
        Args: { target_invoice_id: string }
        Returns: {
          attention_to: string | null
          balance_cents: number | null
          billing_address: Json
          client_id: string
          collection_notes: string | null
          collection_owner_id: string | null
          collection_promise_notes: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivered_at: string | null
          delivery_method: string | null
          due_date: string
          external_id: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_at: string | null
          last_collection_reminder_at: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_cents: number
          payment_instructions: string | null
          payment_terms: string | null
          project_id: string | null
          promised_payment_date: string | null
          service_period_end: string | null
          service_period_start: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          subject: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number | null
          updated_at: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      link_workspace_chat_entity: {
        Args: {
          target_chat_id: string
          target_chat_type: string
          target_work_id: string
          target_work_type: string
        }
        Returns: {
          archive_record_id: string | null
          chat_type: string
          comment_id: string | null
          conversation_id: string
          created_at: string
          created_by: string
          doc_id: string | null
          file_id: string | null
          folder_id: string | null
          id: string
          milestone_id: string | null
          organization_id: string
          project_id: string | null
          project_message_id: string | null
          todo_id: string | null
          work_id: string
          work_type: string
          workspace_attachment_id: string | null
          workspace_message_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "workspace_cross_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_basecamp_archive_projects: {
        Args: {
          after_project_id?: string
          after_project_name?: string
          organization_id: string
          page_size?: number
          run_id?: string
        }
        Returns: {
          entry_count: number
          export_run_id: string
          exported_at: string
          file_count: number
          is_read_only: boolean
          project_id: string
          project_name: string
          project_status: string
          record_count: number
        }[]
      }
      list_basecamp_archive_records: {
        Args: {
          after_record_id?: string
          after_source_updated_at?: string
          page_size?: number
          source_from?: string
          source_to?: string
          target_parent_id?: string
          target_project_id: string
          target_record_type?: string
        }
        Returns: {
          export_run_id: string
          metadata: Json
          native_recording_id: number
          parent_id: string
          plain_text: string
          record_id: string
          record_type: string
          sanitized_html: string
          source_created_at: string
          source_status: string
          source_updated_at: string
          title: string
        }[]
      }
      list_imported_project_files: {
        Args: {
          after_file_id?: string
          after_listing_position?: number
          page_size?: number
          project_id: string
        }
        Returns: {
          availability_status: string
          file_id: string
          file_name: string
          imported_at: string
          listing_cursor: number
          listing_position: number
          mime_type: string
          reference_count: number
          size_bytes: number
          source_account_id: string
          source_created_at: string
          source_file_id: string
          source_path: string
          source_system: string
          source_updated_at: string
          source_uploader_id: string
        }[]
      }
      list_operator_dead_letters: {
        Args: { target_organization_id?: string }
        Returns: Json
      }
      log_time_entry: {
        Args: {
          target_billable?: boolean
          target_description: string
          target_entry_date: string
          target_external_id?: string
          target_minutes: number
          target_profile_id?: string
          target_project_id: string
          target_retainer_period_id?: string
          target_todo_id?: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          billable: boolean
          billable_amount_cents: number | null
          billing_rate_cents: number
          client_id: string
          cost_rate_cents: number | null
          created_at: string
          currency: string
          description: string
          entry_date: string
          external_id: string | null
          id: string
          invoiced_at: string | null
          minutes: number
          organization_id: string
          profile_id: string
          project_id: string
          rejection_reason: string | null
          retainer_period_id: string | null
          source: string
          source_payload: Json
          source_updated_at: string | null
          status: string
          todo_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      map_source_record: {
        Args: {
          target_destination_record_id: string
          target_destination_schema: string
          target_destination_table: string
          target_metadata?: Json
          target_organization_id: string
          target_payload_sha256?: string
          target_provider: string
          target_run_id?: string
          target_source_account_id: string
          target_source_deleted?: boolean
          target_source_entity_type: string
          target_source_record_id: string
          target_source_updated_at?: string
        }
        Returns: {
          destination_record_id: string
          destination_schema: string
          destination_table: string
          first_seen_at: string
          first_seen_run_id: string | null
          id: string
          last_seen_at: string
          last_seen_run_id: string | null
          metadata: Json
          organization_id: string
          payload_sha256: string | null
          provider: string
          retired_at: string | null
          source_account_id: string
          source_deleted: boolean
          source_entity_type: string
          source_record_id: string
          source_updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "source_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_file_share_access_success: {
        Args: { target_ip_hash: string; target_token_hash: string }
        Returns: undefined
      }
      mark_invoice_delivery_attempt: {
        Args: {
          target_delivery_id: string
          target_error_message?: string
          target_provider?: string
          target_provider_message_id?: string
          target_response?: Json
          target_status: string
        }
        Returns: {
          attempt_number: number
          attempted_at: string
          delivery_id: string
          error_message: string | null
          id: string
          organization_id: string
          provider: string | null
          provider_message_id: string | null
          response: Json
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_delivery_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_workspace_conversation_read: {
        Args: { target_conversation_id: string }
        Returns: Json
      }
      mark_workspace_thread_read: {
        Args: { target_root_message_id: string }
        Returns: Json
      }
      merge_workspace_contacts: {
        Args: { duplicate_contact_id: string; target_contact_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          email: string | null
          external_id: string | null
          first_name: string
          id: string
          last_name: string
          metadata: Json
          organization_id: string
          phone: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      promote_accelo_pull_run: {
        Args: { target_lease_token: string; target_run_id: string }
        Returns: Json
      }
      promote_basecamp_export_project: {
        Args: { project_id: string; run_id: string }
        Returns: Json
      }
      promote_basecamp_export_project_extended: {
        Args: { project_id: string; run_id: string }
        Returns: Json
      }
      queue_invoice_delivery: {
        Args: {
          target_delivery_method?: string
          target_idempotency_key?: string
          target_invoice_id: string
          target_recipient_email: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          created_by: string | null
          delivery_method: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          invoice_id: string
          last_attempt_at: string | null
          next_retry_at: string | null
          organization_id: string
          recipient_email: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reap_stale_accelo_pull_runs: { Args: never; Returns: number }
      reconcile_settlement: {
        Args: {
          target_allocations: Json
          target_idempotency_key: string
          target_payment_id: string
        }
        Returns: {
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          external_id: string | null
          id: string
          idempotency_key: string
          method: string
          notes: string | null
          organization_id: string
          payment_date: string
          received_by: string | null
          reference: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_accelo_pull_checkpoint: {
        Args: {
          target_checkpoint_key: string
          target_content_sha256: string
          target_cursor: Json
          target_entity_type: string
          target_high_watermark: string
          target_lease_token: string
          target_page_number: number
          target_record_count: number
          target_run_id: string
        }
        Returns: {
          checkpoint_key: string
          completed_at: string
          content_sha256: string
          cursor: Json
          entity_type: string
          high_watermark: string | null
          id: string
          organization_id: string
          page_number: number | null
          record_count: number
          run_id: string
          source_account_id: string
        }
        SetofOptions: {
          from: "*"
          to: "accelo_pull_checkpoints"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_accelo_recovery_failure: {
        Args: {
          target_lease_token: string
          target_reason_code: string
          target_run_id: string
          target_terminal?: boolean
          target_unresolved_id: string
        }
        Returns: {
          approved_disposition: string | null
          attempt_count: number
          child_identity: Json
          entity_type: string
          first_seen_at: string
          first_seen_run_id: string
          id: string
          last_attempted_at: string
          last_seen_run_id: string
          organization_id: string
          reason_code: string
          reason_detail: string | null
          recovery_attempt_count: number
          recovery_last_attempted_at: string | null
          recovery_reason_code: string | null
          recovery_status: string
          required_parent_identity: Json
          resolution_reason: string | null
          resolution_state: string
          resolved_at: string | null
          resolved_by: string | null
          source_account_id: string
          source_record_id: string
          stage_record_id: string
          transformer_version: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "accelo_unresolved_dependencies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_client_payment: {
        Args: {
          target_amount_cents: number
          target_client_id: string
          target_idempotency_key: string
          target_invoice_id: string
          target_method: string
          target_payment_date: string
          target_reference: string
        }
        Returns: {
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          external_id: string | null
          id: string
          idempotency_key: string
          method: string
          notes: string | null
          organization_id: string
          payment_date: string
          received_by: string | null
          reference: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_file_download_audit: {
        Args: {
          target_access_channel: string
          target_actor_id: string
          target_file_id: string
          target_ip_hash: string
          target_metadata?: Json
          target_organization_id: string
          target_outcome: string
          target_request_correlation_id: string
          target_share_id: string
          target_user_agent_hash: string
        }
        Returns: {
          access_channel: string
          actor_id: string | null
          created_at: string
          file_id: string
          id: string
          ip_hash: string | null
          metadata: Json
          organization_id: string
          outcome: string
          request_correlation_id: string
          share_id: string | null
          user_agent_hash: string | null
        }
        SetofOptions: {
          from: "*"
          to: "file_download_audit"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_production_audit: {
        Args: {
          target_action_category: string
          target_action_type: string
          target_actor_id?: string
          target_after_state: Json
          target_before_state: Json
          target_entity_id: string
          target_entity_type: string
          target_idempotency_key?: string
          target_metadata?: Json
          target_organization_id: string
          target_request_correlation_id: string
        }
        Returns: {
          action_category: string
          action_type: string
          actor_id: string | null
          after_hash: string
          after_state: Json
          before_hash: string
          before_state: Json
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          request_correlation_id: string
        }
        SetofOptions: {
          from: "*"
          to: "production_audit_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_production_health_snapshot: {
        Args: {
          target_checks: Json
          target_metadata?: Json
          target_organization_id?: string
          target_scope: string
          target_status: string
        }
        Returns: {
          checks: Json
          id: string
          metadata: Json
          organization_id: string | null
          recorded_at: string
          scope: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "production_health_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refund_payment: {
        Args: {
          target_idempotency_key: string
          target_payment_id: string
          target_reason: string
        }
        Returns: {
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          external_id: string | null
          id: string
          idempotency_key: string
          method: string
          notes: string | null
          organization_id: string
          payment_date: string
          received_by: string | null
          reference: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replay_accelo_stage_record: {
        Args: {
          target_actor_id: string
          target_reason: string
          target_stage_id: string
        }
        Returns: Json
      }
      report_upload_progress: {
        Args: { reported_bytes: number; reservation_id: string }
        Returns: Json
      }
      resolve_basecamp_download_target: {
        Args: { archive_entry_id?: string; file_id?: string }
        Returns: {
          bucket_id: string
          file_name: string
          mime_type: string
          object_path: string
          size_bytes: number
        }[]
      }
      resolve_workspace_file_download: {
        Args: { target_file_id: string }
        Returns: {
          bucket_id: string
          file_name: string
          mime_type: string
          object_path: string
        }[]
      }
      retry_accelo_unresolved_dependency: {
        Args: {
          target_actor_id: string
          target_reason: string
          target_unresolved_id: string
        }
        Returns: Json
      }
      roll_active_retainer_periods: {
        Args: { through_date?: string }
        Returns: number
      }
      rollback_accelo_promotion_run: {
        Args: {
          target_actor_id: string
          target_reason: string
          target_run_id: string
        }
        Returns: Json
      }
      run_operations_cleanup: {
        Args: { dry_run?: boolean; requested_batch_size?: number }
        Returns: Json
      }
      search_basecamp_archive: {
        Args: {
          after_rank?: number
          after_record_id?: string
          after_source_updated_at?: string
          page_size?: number
          search_query: string
          source_from?: string
          source_to?: string
          target_organization_id: string
          target_project_id?: string
          target_record_type?: string
        }
        Returns: {
          export_run_id: string
          parent_id: string
          plain_text_excerpt: string
          project_id: string
          rank: number
          record_id: string
          record_type: string
          source_updated_at: string
          title: string
        }[]
      }
      search_production_audit: {
        Args: {
          target_action_category?: string
          target_entity_type?: string
          target_limit?: number
          target_organization_id: string
          target_request_correlation_id?: string
        }
        Returns: {
          action_category: string
          action_type: string
          actor_id: string | null
          after_hash: string
          after_state: Json
          before_hash: string
          before_state: Json
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          request_correlation_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "production_audit_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      send_workspace_message: {
        Args: {
          target_attachment_ids?: string[]
          target_body: string
          target_client_nonce: string
          target_conversation_id: string
          target_parent_message_id?: string
          target_work_links?: Json
        }
        Returns: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_message_id: string | null
          sender_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_accelo_unresolved_disposition: {
        Args: {
          target_actor_id: string
          target_disposition: string
          target_reason: string
          target_unresolved_id: string
        }
        Returns: {
          approved_disposition: string | null
          attempt_count: number
          child_identity: Json
          entity_type: string
          first_seen_at: string
          first_seen_run_id: string
          id: string
          last_attempted_at: string
          last_seen_run_id: string
          organization_id: string
          reason_code: string
          reason_detail: string | null
          recovery_attempt_count: number
          recovery_last_attempted_at: string | null
          recovery_reason_code: string | null
          recovery_status: string
          required_parent_identity: Json
          resolution_reason: string | null
          resolution_state: string
          resolved_at: string | null
          resolved_by: string | null
          source_account_id: string
          source_record_id: string
          stage_record_id: string
          transformer_version: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "accelo_unresolved_dependencies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_integration_authority_state: {
        Args: {
          expected_state: string
          target_actor_id?: string
          target_entity_type: string
          target_note?: string
          target_organization_id: string
          target_run_id?: string
          target_source_account_id: string
          target_state: string
        }
        Returns: {
          created_at: string
          entity_type: string
          id: string
          organization_id: string
          previous_state: string | null
          provider: string
          source_account_id: string
          state: string
          transition_note: string | null
          transition_run_id: string | null
          transitioned_at: string
          transitioned_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "integration_authority_states"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_workspace_channel_members: {
        Args: { target_conversation_id: string; target_member_ids: string[] }
        Returns: undefined
      }
      stage_accelo_pull_batch: {
        Args: {
          target_entity_type: string
          target_lease_token: string
          target_records: Json
          target_run_id: string
        }
        Returns: number
      }
      stage_accelo_pull_record: {
        Args: {
          target_entity_type: string
          target_lease_token: string
          target_normalized_payload?: Json
          target_raw_payload: Json
          target_run_id: string
          target_source_deleted?: boolean
          target_source_record_id: string
          target_source_updated_at?: string
        }
        Returns: {
          entity_type: string
          field_sha256: string | null
          id: string
          normalized_payload: Json | null
          organization_id: string
          payload_sha256: string | null
          raw_payload: Json
          relationship_sha256: string | null
          run_id: string
          source_deleted: boolean
          source_record_id: string
          source_updated_at: string | null
          staged_at: string
          transformer_version: number
        }
        SetofOptions: {
          from: "*"
          to: "accelo_pull_stage"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_accelo_recovery_batch: {
        Args: {
          target_lease_token: string
          target_records: Json
          target_run_id: string
          target_unresolved_id: string
        }
        Returns: number
      }
      start_accelo_pull_run: {
        Args: {
          target_full_snapshot?: boolean
          target_idempotency_key: string
          target_lease_owner?: string
          target_lease_seconds?: number
          target_manifest?: Json
          target_organization_id: string
          target_requested_entities: string[]
          target_source_account_id: string
          target_start_cursor?: Json
        }
        Returns: {
          created_at: string
          direction: string | null
          end_cursor: Json | null
          error_message: string | null
          finalized_at: string | null
          full_snapshot: boolean
          heartbeat_at: string | null
          id: string
          idempotency_key: string
          lease_acquired_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          manifest: Json
          organization_id: string
          provider: string
          records_mapped: number
          records_quarantined: number
          records_scanned: number
          records_staged: number
          requested_entities: string[]
          source_account_id: string
          start_cursor: Json | null
          started_at: string | null
          status: string
          summary: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "accelo_pull_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_time_timer: {
        Args: {
          target_billable?: boolean
          target_description?: string
          target_project_id: string
          target_retainer_period_id?: string
          target_todo_id?: string
        }
        Returns: {
          billable: boolean
          client_id: string
          created_at: string
          created_time_entry_id: string | null
          description: string
          id: string
          organization_id: string
          profile_id: string
          project_id: string
          retainer_period_id: string | null
          started_at: string
          status: string
          stopped_at: string | null
          todo_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entry_timers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stop_time_timer: {
        Args: { target_stopped_at?: string; target_timer_id: string }
        Returns: Json
      }
      submit_file_scan_result: {
        Args: {
          target_detail?: Json
          target_file_id: string
          target_scan_status: string
          target_scanner_name?: string
          target_signature?: string
        }
        Returns: {
          created_at: string
          detail: Json
          file_id: string
          id: string
          organization_id: string
          scan_status: string
          scanned_at: string | null
          scanner_name: string
          signature: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "file_scan_results"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unallocate_payment: {
        Args: { target_allocation_id: string; target_idempotency_key: string }
        Returns: {
          allocated_by: string | null
          amount_cents: number
          client_id: string
          created_at: string
          id: string
          invoice_id: string
          organization_id: string
          payment_id: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_allocations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project_subtask: {
        Args: {
          expected_version: number
          requested_actor_id: string
          target_completed: boolean
          target_idempotency_key: string
          target_subtask_id: string
        }
        Returns: Json
      }
      update_project_todo: {
        Args: {
          changes: Json
          expected_version: number
          requested_actor_id: string
          target_idempotency_key: string
          target_todo_id: string
        }
        Returns: Json
      }
      update_support_ticket: {
        Args: {
          changes: Json
          expected_version: number
          requested_actor_id: string
          target_todo_id: string
        }
        Returns: Json
      }
      update_workspace_profile_admin: {
        Args: {
          target_chat_enabled: boolean
          target_profile_id: string
          target_role: string
          target_status: string
        }
        Returns: undefined
      }
      update_workspace_profile_admin_v2: {
        Args: {
          target_chat_enabled: boolean
          target_permissions: Json
          target_profile_id: string
          target_role: string
          target_status: string
        }
        Returns: undefined
      }
      update_workspace_profile_permissions: {
        Args: { target_permissions: Json; target_profile_id: string }
        Returns: {
          accelo_staff_id: string | null
          avatar_url: string | null
          basecamp_account_id: number | null
          basecamp_person_id: number | null
          chat_enabled: boolean
          company_name: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          last_seen_at: string | null
          organization_id: string | null
          permissions: Json
          person_type: string | null
          phone: string | null
          preferences: Json
          role: string
          source_payload: Json
          status: string
          timezone: string
          title: string | null
          updated_at: string
          weekly_capacity_minutes: number
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_invoice: {
        Args: {
          target_idempotency_key: string
          target_invoice_id: string
          target_reason: string
        }
        Returns: {
          attention_to: string | null
          balance_cents: number | null
          billing_address: Json
          client_id: string
          collection_notes: string | null
          collection_owner_id: string | null
          collection_promise_notes: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivered_at: string | null
          delivery_method: string | null
          due_date: string
          external_id: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_at: string | null
          last_collection_reminder_at: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_cents: number
          payment_instructions: string | null
          payment_terms: string | null
          project_id: string | null
          promised_payment_date: string | null
          service_period_end: string | null
          service_period_start: string | null
          source_payload: Json
          source_updated_at: string | null
          status: string
          subject: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number | null
          updated_at: string
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      write_off_invoice: {
        Args: {
          target_amount_cents: number
          target_idempotency_key: string
          target_invoice_id: string
          target_reason: string
        }
        Returns: {
          adjustment_type: string
          amount_cents: number
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          idempotency_key: string
          invoice_id: string
          organization_id: string
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_adjustments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

