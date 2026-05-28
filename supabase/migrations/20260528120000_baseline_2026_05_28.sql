/* ============================================================================
   BASELINE MIGRATION 2026-05-28
   ----------------------------------------------------------------------------
   Captured from live Supabase project kndiyailsqrialgbozac on 2026-05-28.
   This file recreates the public schema as it existed on that date from
   pg_catalog / information_schema queries.

   DO NOT re-run this migration against an existing database.
   It is intended for fresh DBs (e.g. branch DBs, local dev) only.
   All subsequent schema changes should be incremental migrations layered
   on top of this baseline.
   ============================================================================ */

-- ---------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 2. CUSTOM ENUM TYPES
-- ---------------------------------------------------------------------------
CREATE TYPE public.auth_health_t AS ENUM ('ok','low_visits','expiring','over_limit','exhausted');

-- ---------------------------------------------------------------------------
-- 3. TABLES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."action_items" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "description" text,
  "assigned_to" uuid,
  "created_by" uuid,
  "priority" text DEFAULT 'medium'::text,
  "status" text DEFAULT 'open'::text,
  "due_date" date,
  "completed_at" timestamp with time zone,
  "region" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "category" text DEFAULT 'general'::text,
  "staff_name" text,
  "revenue_impact" numeric DEFAULT 0,
  "follow_up_type" text DEFAULT 'manual'::text,
  "resolved_at" timestamp with time zone,
  "notes" text
);

CREATE TABLE IF NOT EXISTS public."action_responses" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "action_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open'::text,
  "notes" text,
  "responded_by" uuid,
  "responder_name" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."alerts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "alert_type" text NOT NULL,
  "priority" text NOT NULL DEFAULT 'medium'::text,
  "title" text NOT NULL,
  "message" text,
  "patient_name" text,
  "clinician_name" text,
  "region" text,
  "coordinator_region" text,
  "related_date" date,
  "metadata" jsonb,
  "is_read" boolean DEFAULT false,
  "is_dismissed" boolean DEFAULT false,
  "assigned_to_region" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."auth_audit_staging" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "audit_complete" integer,
  "patient_name" text NOT NULL,
  "region" text NOT NULL,
  "address" text,
  "discipline" text,
  "ref_source" text,
  "insurance_pariox" text,
  "insurance_clean" text,
  "changed_at" timestamp with time zone,
  "soc_date" date,
  "is_ppo" boolean,
  "auth_start_date" date,
  "auth_end_date" date,
  "visits_authorized" integer,
  "evals_authorized" integer,
  "ras_authorized" integer,
  "notes" text,
  "status_raw" text,
  "status_normalized" text,
  "is_scheduled" boolean,
  "frequency" text,
  "cc_notes" text,
  "match_patient_id" uuid,
  "match_auth_id" uuid,
  "match_status" text,
  "imported_batch" text NOT NULL,
  "applied_at" timestamp with time zone,
  "applied_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."auth_documents" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "auth_tracker_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "file_size" integer,
  "doc_type" text DEFAULT 'auth'::text,
  "uploaded_by" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."auth_renewal_tasks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "insurance" text,
  "auth_id" uuid,
  "expiry_date" date,
  "days_until_expiry" integer,
  "visits_remaining" integer,
  "assigned_to" text,
  "task_status" text DEFAULT 'open'::text,
  "priority" text DEFAULT 'normal'::text,
  "opened_at" timestamp with time zone DEFAULT now(),
  "due_date" date,
  "notes" text,
  "completed_at" timestamp with time zone,
  "completed_by" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."auth_sync_pending" (
  "pname_key" text NOT NULL,
  "flagged_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."auth_team_assignments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coordinator_id" uuid,
  "insurance" text NOT NULL,
  "region" text,
  "assigned_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."auth_tracker" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "dob" date,
  "member_id" text,
  "phone" text,
  "region" text,
  "insurance" text NOT NULL,
  "insurance_type" text NOT NULL DEFAULT 'standard'::text,
  "auth_number" text,
  "request_type" text DEFAULT 'initial'::text,
  "visits_authorized" integer DEFAULT 24,
  "visits_used" integer DEFAULT 0,
  "evals_authorized" integer DEFAULT 2,
  "evals_used" integer DEFAULT 0,
  "reassessments_authorized" integer DEFAULT 3,
  "reassessments_used" integer DEFAULT 0,
  "soc_date" date,
  "auth_submitted_date" date,
  "auth_needed_by" date,
  "auth_approved_date" date,
  "auth_expiry_date" date,
  "auth_status" text NOT NULL DEFAULT 'pending'::text,
  "pcp_name" text,
  "pcp_phone" text,
  "pcp_fax" text,
  "pcp_facility" text,
  "therapy_type" text DEFAULT 'LYMPHEDEMA'::text,
  "frequency" text,
  "alert_low_visits" boolean DEFAULT false,
  "alert_expiring" boolean DEFAULT false,
  "alert_sent_renewal" boolean DEFAULT false,
  "assigned_to" text,
  "coordinator_region" text,
  "notes" text,
  "denial_reason" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "auth_sequence" integer DEFAULT 1,
  "predecessor_auth_id" uuid,
  "is_currently_active" boolean DEFAULT true,
  "request_category" text DEFAULT 'initial'::text,
  "predecessor_exhausted_date" date,
  "effective_visits_remaining" integer,
  "alert_predecessor_pending" boolean DEFAULT false,
  "cpt_codes" text,
  "diagnosis_code" text,
  "requesting_provider" text,
  "requesting_provider_npi" text,
  "auth_discipline" text,
  "updated_by" text,
  "is_ppo" boolean,
  "auth_start_date" date,
  "is_scheduled" boolean,
  "auth_health" public.auth_health_t NOT NULL DEFAULT 'ok'::auth_health_t
);

CREATE TABLE IF NOT EXISTS public."care_coord_discharges" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "discharge_date" date,
  "discharge_reason" text,
  "coordinator_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."care_coord_notes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "note_type" text DEFAULT 'general'::text,
  "note" text NOT NULL,
  "coordinator_id" uuid,
  "contact_date" date,
  "follow_up_date" date,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" text
);

CREATE TABLE IF NOT EXISTS public."care_coord_referrals" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "referral_source" text,
  "referral_date" date,
  "status" text DEFAULT 'pending'::text,
  "coordinator_id" uuid,
  "insurance" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."care_coord_task_log" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coordinator_id" uuid,
  "patient_name" text,
  "region" text,
  "task_type" text NOT NULL,
  "task_detail" text,
  "completed" boolean DEFAULT false,
  "completed_at" timestamp with time zone,
  "task_date" date DEFAULT CURRENT_DATE,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."census_data" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" uuid,
  "patient_name" text,
  "address" text,
  "discipline" text,
  "ref_source" text,
  "region" text,
  "insurance" text,
  "status" text,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "patient_key" text,
  "previous_status" text,
  "status_changed_at" timestamp with time zone,
  "status_first_seen" timestamp with time zone,
  "last_seen_date" date DEFAULT CURRENT_DATE,
  "first_seen_date" date DEFAULT CURRENT_DATE,
  "last_visit_date" date,
  "last_visit_clinician" text,
  "last_visit_type" text,
  "days_since_last_visit" integer,
  "pipeline_notes" text,
  "pipeline_assigned_to" text,
  "target_start_date" date,
  "has_wound" boolean DEFAULT false,
  "wound_flag_date" date,
  "wound_type" text,
  "inferred_frequency" text,
  "overdue_threshold_days" integer,
  "days_overdue" integer,
  "current_visit_cadence" text,
  "needs_frequency_review" boolean DEFAULT false,
  "frequency_locked_at" timestamp with time zone,
  "frequency_reviewed_by" text,
  "frequency_reviewed_at" timestamp with time zone,
  "updated_by" text
);

CREATE TABLE IF NOT EXISTS public."census_status_log" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "patient_key" text NOT NULL,
  "region" text,
  "insurance" text,
  "old_status" text,
  "new_status" text NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now(),
  "batch_id" text,
  "hospitalization_id" uuid,
  "upload_date" date DEFAULT CURRENT_DATE,
  "change_type" text DEFAULT 'status_change'::text
);

CREATE TABLE IF NOT EXISTS public."clinician_productivity" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "clinician_name" text NOT NULL,
  "clinician_id" uuid,
  "region" text,
  "week_start" date NOT NULL,
  "week_end" date NOT NULL,
  "visits_completed" integer DEFAULT 0,
  "visits_scheduled" integer DEFAULT 0,
  "visits_missed" integer DEFAULT 0,
  "visits_cancelled" integer DEFAULT 0,
  "evals_completed" integer DEFAULT 0,
  "reassessments_completed" integer DEFAULT 0,
  "employment_type" text,
  "visit_target" integer,
  "pct_to_target" numeric,
  "alert_triggered" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."clinician_pto" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "clinician_name" text NOT NULL,
  "region" text,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "pto_type" text DEFAULT 'PTO'::text,
  "approved" boolean DEFAULT false,
  "notes" text,
  "logged_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."clinicians" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "full_name" text NOT NULL,
  "discipline" text,
  "employment_type" text NOT NULL DEFAULT 'ft'::text,
  "region" text,
  "zip" text,
  "address" text,
  "lat" numeric,
  "lng" numeric,
  "phone" text,
  "email" text,
  "is_active" boolean DEFAULT true,
  "weekly_visit_target" integer,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "pariox_name" text,
  "is_telehealth" boolean DEFAULT false,
  "aliases" text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE IF NOT EXISTS public."coordinator_activity_log" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coordinator_id" uuid,
  "coordinator_name" text NOT NULL,
  "coordinator_role" text NOT NULL,
  "action_type" text NOT NULL,
  "action_detail" text,
  "patient_name" text,
  "table_name" text NOT NULL,
  "record_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "resource_type" text,
  "resource_id" text,
  "detail" text,
  "action_date" date
);

CREATE TABLE IF NOT EXISTS public."coordinator_daily_metrics" (
  "id" bigint NOT NULL DEFAULT nextval('coordinator_daily_metrics_id_seq'::regclass),
  "coordinator_name" text NOT NULL,
  "snapshot_date" date NOT NULL DEFAULT CURRENT_DATE,
  "start_task_keys" text[] NOT NULL DEFAULT '{}'::text[],
  "start_count" integer NOT NULL DEFAULT 0,
  "start_critical" integer NOT NULL DEFAULT 0,
  "start_high" integer NOT NULL DEFAULT 0,
  "start_normal" integer NOT NULL DEFAULT 0,
  "snapshot_started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_updated_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public."coordinator_overload_alerts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coordinator_id" uuid,
  "coordinator_name" text NOT NULL,
  "incomplete_count" integer NOT NULL,
  "alert_date" date NOT NULL DEFAULT CURRENT_DATE,
  "sent_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."coordinator_tasks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coordinator_region" text,
  "assigned_to" text,
  "task_type" text NOT NULL,
  "priority" text NOT NULL DEFAULT 'medium'::text,
  "title" text NOT NULL,
  "description" text,
  "patient_name" text,
  "clinician_name" text,
  "auth_tracker_id" uuid,
  "status" text NOT NULL DEFAULT 'open'::text,
  "due_date" date,
  "completed_at" timestamp with time zone,
  "completed_by" text,
  "completion_notes" text,
  "auto_generated" boolean DEFAULT false,
  "source_alert_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" text
);

CREATE TABLE IF NOT EXISTS public."coordinators" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'team_member'::text,
  "team" text,
  "regions" text[],
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "is_swift_team" boolean DEFAULT false,
  "job_title" text,
  "discipline" text,
  "phone" text
);

CREATE TABLE IF NOT EXISTS public."daily_ops_reports" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "report_type" text NOT NULL,
  "report_date" date NOT NULL DEFAULT CURRENT_DATE,
  "report_html" text NOT NULL,
  "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."daily_reports" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coordinator_id" uuid,
  "report_date" date NOT NULL,
  "report_type" text DEFAULT 'morning'::text,
  "region" text,
  "census_count" integer,
  "visits_completed" integer,
  "visits_scheduled" integer,
  "on_hold_count" integer,
  "discharges" integer,
  "referrals" integer,
  "notes" text,
  "submitted_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "contact_attempts" integer DEFAULT 0,
  "on_hold_reached" integer DEFAULT 0,
  "auth_issues" text,
  "hospitalizations" integer DEFAULT 0,
  "biggest_blocker" text,
  "submitted_by_name" text,
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."data_audit_log" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "source" text NOT NULL,
  "table_name" text NOT NULL,
  "row_id" uuid NOT NULL,
  "patient_name" text,
  "region" text,
  "field_name" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "changed_by" text NOT NULL,
  "applied_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reverted_at" timestamp with time zone,
  "reverted_by" text
);

CREATE TABLE IF NOT EXISTS public."data_freshness" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "data_type" text NOT NULL,
  "last_upload" timestamp with time zone,
  "last_batch_id" text,
  "record_count" integer,
  "uploaded_by" text,
  "stale_threshold_days" integer DEFAULT 8,
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."hospitalizations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "insurance" text,
  "clinician_name" text,
  "admission_date" date NOT NULL,
  "discharge_date" date,
  "hospital_name" text,
  "admitting_diagnosis" text NOT NULL,
  "cause_category" text NOT NULL,
  "cause_subcategory" text,
  "potentially_preventable" boolean DEFAULT false,
  "preventability_notes" text,
  "outcome" text,
  "returned_to_service" boolean,
  "return_date" date,
  "visit_frequency_at_admission" text,
  "days_since_last_visit" integer,
  "last_visit_date" date,
  "reported_by" text,
  "reported_date" date DEFAULT CURRENT_DATE,
  "reviewed_by" text,
  "reviewed_date" date,
  "review_notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."hospitalized_tracker" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "hospitalized_date" date NOT NULL,
  "last_followup_date" date,
  "next_followup_due" date,
  "discharge_date" date,
  "reactivated" boolean DEFAULT false,
  "reactivation_date" date,
  "coordinator_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."insurance_abbreviations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "abbreviation" text NOT NULL,
  "region" text,
  "insurance_name" text NOT NULL,
  "display_name" text,
  "category" text,
  "payor_group" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."intake_referrals" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "date_received" date,
  "referral_status" text,
  "referral_type" text,
  "region" text,
  "patient_name" text,
  "dob" date,
  "contact_number" text,
  "location" text,
  "county" text,
  "insurance" text,
  "policy_number" text,
  "medicare_type" text,
  "secondary_insurance" text,
  "secondary_id" text,
  "diagnosis" text,
  "diagnosis_clean" text,
  "denial_reason" text,
  "referral_document" text,
  "referral_source" text,
  "referral_source_phone" text,
  "referral_source_fax" text,
  "pcp_name" text,
  "pcp_phone" text,
  "pcp_fax" text,
  "chart_status" text,
  "census_status" text,
  "welcome_call" text,
  "first_appt" text,
  "total_visits" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "city" text,
  "zip_code" text,
  "phone" text,
  "referral_document_path" text,
  "referral_document_name" text,
  "patient_classification" text,
  "is_new_patient" boolean,
  "matched_census_patient" boolean DEFAULT false,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" text,
  "notes" text,
  "patient_name_norm" text
);

CREATE TABLE IF NOT EXISTS public."marketing_contacts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "contact_type" text NOT NULL,
  "practice_name" text NOT NULL,
  "contact_name" text,
  "title" text,
  "phone" text,
  "email" text,
  "address" text,
  "city" text,
  "state" text DEFAULT 'FL'::text,
  "zip" text,
  "region" text,
  "npi" text,
  "referral_potential" text DEFAULT 'medium'::text,
  "active_referral_source" boolean DEFAULT false,
  "notes" text,
  "assigned_to" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."marketing_encounters" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "contact_id" uuid,
  "encounter_type" text NOT NULL,
  "encounter_date" date NOT NULL DEFAULT CURRENT_DATE,
  "conducted_by" text NOT NULL,
  "region" text,
  "summary" text,
  "outcome" text,
  "referrals_received" integer DEFAULT 0,
  "follow_up_date" date,
  "follow_up_notes" text,
  "follow_up_completed" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."medicare_visit_flags" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "insurance" text DEFAULT 'medicare'::text,
  "evaluating_pt" text,
  "total_completed_visits" integer DEFAULT 0,
  "flag_10th_note" boolean DEFAULT false,
  "flag_10th_acknowledged" boolean DEFAULT false,
  "flag_10th_acknowledged_at" timestamp with time zone,
  "flag_10th_acknowledged_by" text,
  "flag_20th_discharge" boolean DEFAULT false,
  "flag_20th_acknowledged" boolean DEFAULT false,
  "flag_20th_acknowledged_at" timestamp with time zone,
  "flag_20th_acknowledged_by" text,
  "last_calculated_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "care_start_date" date,
  "last_progress_note_date" date,
  "last_progress_note_visit" integer DEFAULT 0,
  "last_progress_note_submitted_by" text,
  "last_progress_note_notes" text,
  "next_due_date" date,
  "next_due_visit" integer,
  "progress_note_due" boolean DEFAULT false,
  "progress_note_due_reason" text
);

CREATE TABLE IF NOT EXISTS public."note_notifications" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "note_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "patient_name" text NOT NULL,
  "read" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."notifications" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "type" text NOT NULL DEFAULT 'general'::text,
  "title" text NOT NULL,
  "message" text,
  "patient_name" text,
  "region" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "read" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."on_hold_recovery" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "hold_reason" text,
  "hold_date" date,
  "recovery_status" text DEFAULT 'on_hold'::text,
  "recovery_date" date,
  "coordinator_id" uuid,
  "action_taken" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "hold_type" text,
  "insurance" text,
  "expected_return_date" date,
  "last_contact_date" date,
  "last_contact_notes" text,
  "days_on_hold" integer,
  "follow_up_due" date,
  "priority" text DEFAULT 'normal'::text,
  "updated_by" text
);

CREATE TABLE IF NOT EXISTS public."page_permissions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "page_key" text NOT NULL,
  "page_label" text NOT NULL,
  "page_section" text NOT NULL,
  "super_admin" boolean NOT NULL DEFAULT true,
  "admin" boolean NOT NULL DEFAULT true,
  "pod_leader" boolean NOT NULL DEFAULT true,
  "team_member" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "regional_manager" boolean DEFAULT false,
  "auth_coordinator" boolean DEFAULT false,
  "intake_coordinator" boolean DEFAULT false,
  "care_coordinator" boolean DEFAULT false,
  "clinician" boolean DEFAULT false,
  "assoc_director" boolean DEFAULT false,
  "telehealth" boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public."patient_clinical_settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "visit_frequency" text,
  "loc" integer,
  "loc_notes" text,
  "frequency_notes" text,
  "assigned_by" text,
  "assigned_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "frequency_set_by" text,
  "frequency_set_date" date,
  "inferred_frequency" text,
  "inferred_from_visits" integer,
  "inferred_at" timestamp with time zone,
  "reassessment_clinician" text,
  "last_reassessment_date" date,
  "last_reassessment_type" text,
  "next_reassessment_target" date,
  "next_reassessment_deadline" date,
  "next_reassessment_scheduled" date,
  "reassessment_status" text DEFAULT 'unknown'::text,
  "last_visit_date" date,
  "next_visit_scheduled" date,
  "days_since_last_visit" integer,
  "days_until_next_visit" integer,
  "alert_no_visits_scheduled" boolean DEFAULT false,
  "alert_reassessment_unscheduled" boolean DEFAULT false,
  "alert_reassessment_overdue" boolean DEFAULT false,
  "clinical_notes" text,
  "insurance" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."patient_clinician_assignments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_key" text NOT NULL,
  "patient_name" text NOT NULL,
  "clinician_id" uuid NOT NULL,
  "role" text NOT NULL,
  "discipline" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  "assigned_by" text,
  "ended_at" timestamp with time zone,
  "ended_by" text,
  "end_reason" text,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."patient_discharges" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "insurance" text,
  "clinician" text,
  "discharge_date" date,
  "discharge_reason" text,
  "discharge_reason_notes" text,
  "final_status_before_discharge" text,
  "total_visits_completed" integer,
  "outcome" text,
  "followup_30day_required" boolean DEFAULT true,
  "followup_30day_completed" boolean DEFAULT false,
  "followup_30day_date" date,
  "followup_30day_notes" text,
  "discharged_by" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" text
);

CREATE TABLE IF NOT EXISTS public."patient_documents" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "auth_tracker_id" uuid,
  "region" text,
  "doc_type" text NOT NULL,
  "doc_label" text,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "file_size" integer,
  "file_type" text,
  "is_latest" boolean DEFAULT true,
  "auth_number" text,
  "uploaded_by" text,
  "effective_date" date,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."patient_master" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "patient_key" text,
  "region" text,
  "insurance" text,
  "current_status" text,
  "previous_status" text,
  "status_changed_at" timestamp with time zone,
  "first_seen_date" date,
  "total_referrals" integer DEFAULT 0,
  "is_new_patient" boolean DEFAULT true,
  "has_been_active" boolean DEFAULT false,
  "has_been_discharged" boolean DEFAULT false,
  "last_discharge_date" date,
  "last_active_date" date,
  "first_upload_batch" text,
  "last_upload_batch" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "last_visit_date" date,
  "last_visit_clinician" text,
  "days_since_last_visit" integer,
  "has_wound" boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public."patient_notes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "author_id" uuid,
  "author_name" text NOT NULL,
  "note_text" text NOT NULL,
  "tagged_users" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."patient_risk_factors" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text NOT NULL,
  "health_plan" text,
  "caremap_score" integer,
  "loc_level" integer,
  "has_wounds" boolean,
  "comorbidities_3plus" boolean,
  "falls_6mo" boolean,
  "high_compliance_risk" boolean,
  "high_environmental_risk" boolean,
  "compliance_score" integer,
  "environmental_score" integer,
  "last_reassessment_date" date,
  "evaluating_pt" text,
  "comments" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" text
);

CREATE TABLE IF NOT EXISTS public."patient_visit_history" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "auth_tracker_id" uuid,
  "region" text,
  "insurance" text,
  "visit_date" date,
  "visit_type" text,
  "clinician_name" text,
  "discipline" text,
  "status" text,
  "event_type" text,
  "auth_number" text,
  "billed" boolean DEFAULT false,
  "note_submitted" boolean DEFAULT true,
  "hospitalized_date" date,
  "hospital_discharge_date" date,
  "days_hospitalized" integer,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."rm_kpi_goals" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "region" text NOT NULL,
  "period_type" text NOT NULL,
  "period_year" integer NOT NULL,
  "period_number" integer NOT NULL,
  "target_visits_completed" integer,
  "target_visit_pct_of_target" numeric,
  "target_miss_rate_max" numeric,
  "target_cancelled_max" integer,
  "target_referrals" integer,
  "target_acceptance_rate" numeric,
  "target_revenue" numeric,
  "target_staff_productivity_pct" numeric,
  "notes" text,
  "set_by" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."scheduled_visits" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "visit_date" date NOT NULL,
  "visit_time" text,
  "visit_type" text NOT NULL DEFAULT 'routine'::text,
  "clinician_id" uuid,
  "clinician_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'scheduled'::text,
  "notes" text,
  "is_recurring" boolean DEFAULT false,
  "recurrence_pattern" text,
  "recurrence_end_date" date,
  "parent_visit_id" uuid,
  "created_by" uuid,
  "created_by_name" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "cancelled_reason" text
);

CREATE TABLE IF NOT EXISTS public."swift_team_patients" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "insurance" text,
  "wound_flag" boolean NOT NULL DEFAULT true,
  "wound_type" text,
  "wound_location" text,
  "wound_severity" text,
  "wound_dimensions" text,
  "wound_onset_date" date,
  "wound_description" text,
  "assigned_swift_clinician" text,
  "assigned_date" date,
  "review_frequency" text,
  "next_review_date" date,
  "wound_status" text DEFAULT 'active'::text,
  "last_assessment_date" date,
  "last_assessment_by" text,
  "last_assessment_notes" text,
  "flagged_by" text,
  "flagged_at" timestamp with time zone DEFAULT now(),
  "flagged_from" text DEFAULT 'manual'::text,
  "referral_diagnosis" text,
  "healed_date" date,
  "closure_method" text,
  "outcome_notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."swift_wound_assessments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "swift_patient_id" uuid,
  "patient_name" text NOT NULL,
  "assessment_date" date NOT NULL DEFAULT CURRENT_DATE,
  "assessed_by" text,
  "length_cm" numeric(5,1),
  "width_cm" numeric(5,1),
  "depth_cm" numeric(5,1),
  "wound_status" text,
  "exudate_type" text,
  "exudate_amount" text,
  "wound_bed" text,
  "periwound_skin" text,
  "odor" text,
  "pain_score" integer,
  "treatment_applied" text,
  "dressing_type" text,
  "next_change_date" date,
  "next_review_date" date,
  "notes" text,
  "photo_url" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."upload_batches" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "batch_type" text NOT NULL,
  "file_name" text,
  "record_count" integer,
  "week_start" date,
  "week_end" date,
  "uploaded_by" text,
  "uploaded_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."user_page_overrides" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coordinator_id" uuid NOT NULL,
  "page_key" text NOT NULL,
  "granted" boolean NOT NULL DEFAULT true,
  "granted_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."visit_schedule_data" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" uuid,
  "patient_name" text,
  "address" text,
  "ref_source" text,
  "region" text,
  "discipline" text,
  "staff_name" text,
  "event_type" text,
  "raw_date" text,
  "visit_date" date,
  "visit_time" text,
  "insurance" text,
  "status" text,
  "notes" text,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "staff_name_normalized" text
);

CREATE TABLE IF NOT EXISTS public."waitlist_assignments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "patient_name" text NOT NULL,
  "region" text,
  "assigned_clinician" text,
  "assignment_status" text DEFAULT 'pending'::text,
  "priority" text DEFAULT 'normal'::text,
  "priority_reason" text,
  "waitlisted_since" date,
  "outreach_count" integer DEFAULT 0,
  "last_outreach_date" date,
  "last_outreach_by" text,
  "outreach_notes" text,
  "target_start_date" date,
  "assigned_by" text,
  "assigned_at" timestamp with time zone,
  "converted_at" timestamp with time zone,
  "removal_reason" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by_name" text
);

-- Sequence for coordinator_daily_metrics
CREATE SEQUENCE IF NOT EXISTS public.coordinator_daily_metrics_id_seq AS bigint
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.coordinator_daily_metrics_id_seq OWNED BY public.coordinator_daily_metrics.id;


-- ---------------------------------------------------------------------------
-- 4. PRIMARY KEYS
-- ---------------------------------------------------------------------------
ALTER TABLE action_items ADD CONSTRAINT action_items_pkey PRIMARY KEY (id);
ALTER TABLE action_responses ADD CONSTRAINT action_responses_pkey PRIMARY KEY (id);
ALTER TABLE alerts ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);
ALTER TABLE auth_audit_staging ADD CONSTRAINT auth_audit_staging_pkey PRIMARY KEY (id);
ALTER TABLE auth_documents ADD CONSTRAINT auth_documents_pkey PRIMARY KEY (id);
ALTER TABLE auth_renewal_tasks ADD CONSTRAINT auth_renewal_tasks_pkey PRIMARY KEY (id);
ALTER TABLE auth_sync_pending ADD CONSTRAINT auth_sync_pending_pkey PRIMARY KEY (pname_key);
ALTER TABLE auth_team_assignments ADD CONSTRAINT auth_team_assignments_pkey PRIMARY KEY (id);
ALTER TABLE auth_tracker ADD CONSTRAINT auth_tracker_pkey PRIMARY KEY (id);
ALTER TABLE care_coord_discharges ADD CONSTRAINT care_coord_discharges_pkey PRIMARY KEY (id);
ALTER TABLE care_coord_notes ADD CONSTRAINT care_coord_notes_pkey PRIMARY KEY (id);
ALTER TABLE care_coord_referrals ADD CONSTRAINT care_coord_referrals_pkey PRIMARY KEY (id);
ALTER TABLE care_coord_task_log ADD CONSTRAINT care_coord_task_log_pkey PRIMARY KEY (id);
ALTER TABLE census_data ADD CONSTRAINT census_data_pkey PRIMARY KEY (id);
ALTER TABLE census_status_log ADD CONSTRAINT census_status_log_pkey PRIMARY KEY (id);
ALTER TABLE clinician_productivity ADD CONSTRAINT clinician_productivity_pkey PRIMARY KEY (id);
ALTER TABLE clinician_pto ADD CONSTRAINT clinician_pto_pkey PRIMARY KEY (id);
ALTER TABLE clinicians ADD CONSTRAINT clinicians_pkey PRIMARY KEY (id);
ALTER TABLE coordinator_activity_log ADD CONSTRAINT coordinator_activity_log_pkey PRIMARY KEY (id);
ALTER TABLE coordinator_daily_metrics ADD CONSTRAINT coordinator_daily_metrics_pkey PRIMARY KEY (id);
ALTER TABLE coordinator_overload_alerts ADD CONSTRAINT coordinator_overload_alerts_pkey PRIMARY KEY (id);
ALTER TABLE coordinator_tasks ADD CONSTRAINT coordinator_tasks_pkey PRIMARY KEY (id);
ALTER TABLE coordinators ADD CONSTRAINT coordinators_pkey PRIMARY KEY (id);
ALTER TABLE daily_ops_reports ADD CONSTRAINT daily_ops_reports_pkey PRIMARY KEY (id);
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_pkey PRIMARY KEY (id);
ALTER TABLE data_audit_log ADD CONSTRAINT data_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE data_freshness ADD CONSTRAINT data_freshness_pkey PRIMARY KEY (id);
ALTER TABLE hospitalizations ADD CONSTRAINT hospitalizations_pkey PRIMARY KEY (id);
ALTER TABLE hospitalized_tracker ADD CONSTRAINT hospitalized_tracker_pkey PRIMARY KEY (id);
ALTER TABLE insurance_abbreviations ADD CONSTRAINT insurance_abbreviations_pkey PRIMARY KEY (id);
ALTER TABLE intake_referrals ADD CONSTRAINT intake_referrals_pkey PRIMARY KEY (id);
ALTER TABLE marketing_contacts ADD CONSTRAINT marketing_contacts_pkey PRIMARY KEY (id);
ALTER TABLE marketing_encounters ADD CONSTRAINT marketing_encounters_pkey PRIMARY KEY (id);
ALTER TABLE medicare_visit_flags ADD CONSTRAINT medicare_visit_flags_pkey PRIMARY KEY (id);
ALTER TABLE note_notifications ADD CONSTRAINT note_notifications_pkey PRIMARY KEY (id);
ALTER TABLE notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE on_hold_recovery ADD CONSTRAINT on_hold_recovery_pkey PRIMARY KEY (id);
ALTER TABLE page_permissions ADD CONSTRAINT page_permissions_pkey PRIMARY KEY (id);
ALTER TABLE patient_clinical_settings ADD CONSTRAINT patient_clinical_settings_pkey PRIMARY KEY (id);
ALTER TABLE patient_clinician_assignments ADD CONSTRAINT patient_clinician_assignments_pkey PRIMARY KEY (id);
ALTER TABLE patient_discharges ADD CONSTRAINT patient_discharges_pkey PRIMARY KEY (id);
ALTER TABLE patient_documents ADD CONSTRAINT patient_documents_pkey PRIMARY KEY (id);
ALTER TABLE patient_master ADD CONSTRAINT patient_master_pkey PRIMARY KEY (id);
ALTER TABLE patient_notes ADD CONSTRAINT patient_notes_pkey PRIMARY KEY (id);
ALTER TABLE patient_risk_factors ADD CONSTRAINT patient_risk_factors_pkey PRIMARY KEY (id);
ALTER TABLE patient_visit_history ADD CONSTRAINT patient_visit_history_pkey PRIMARY KEY (id);
ALTER TABLE rm_kpi_goals ADD CONSTRAINT rm_kpi_goals_pkey PRIMARY KEY (id);
ALTER TABLE scheduled_visits ADD CONSTRAINT scheduled_visits_pkey PRIMARY KEY (id);
ALTER TABLE swift_team_patients ADD CONSTRAINT swift_team_patients_pkey PRIMARY KEY (id);
ALTER TABLE swift_wound_assessments ADD CONSTRAINT swift_wound_assessments_pkey PRIMARY KEY (id);
ALTER TABLE upload_batches ADD CONSTRAINT upload_batches_pkey PRIMARY KEY (id);
ALTER TABLE user_page_overrides ADD CONSTRAINT user_page_overrides_pkey PRIMARY KEY (id);
ALTER TABLE visit_schedule_data ADD CONSTRAINT visit_schedule_data_pkey PRIMARY KEY (id);
ALTER TABLE waitlist_assignments ADD CONSTRAINT waitlist_assignments_pkey PRIMARY KEY (id);

-- ---------------------------------------------------------------------------
-- 5. UNIQUE CONSTRAINTS
-- ---------------------------------------------------------------------------
ALTER TABLE auth_team_assignments ADD CONSTRAINT auth_team_assignments_coordinator_id_insurance_region_key UNIQUE (coordinator_id, insurance, region);
ALTER TABLE census_data ADD CONSTRAINT census_data_patient_unique UNIQUE (patient_name);
ALTER TABLE clinician_productivity ADD CONSTRAINT clinician_productivity_clinician_name_week_start_key UNIQUE (clinician_name, week_start);
ALTER TABLE clinicians ADD CONSTRAINT clinicians_full_name_key UNIQUE (full_name);
ALTER TABLE coordinator_daily_metrics ADD CONSTRAINT coordinator_daily_metrics_coordinator_name_snapshot_date_key UNIQUE (coordinator_name, snapshot_date);
ALTER TABLE coordinator_overload_alerts ADD CONSTRAINT coordinator_overload_alerts_coordinator_id_alert_date_key UNIQUE (coordinator_id, alert_date);
ALTER TABLE coordinators ADD CONSTRAINT coordinators_email_unique UNIQUE (email);
ALTER TABLE coordinators ADD CONSTRAINT coordinators_user_id_key UNIQUE (user_id);
ALTER TABLE data_freshness ADD CONSTRAINT data_freshness_data_type_key UNIQUE (data_type);
ALTER TABLE insurance_abbreviations ADD CONSTRAINT insurance_abbreviations_abbreviation_key UNIQUE (abbreviation);
ALTER TABLE intake_referrals ADD CONSTRAINT intake_referrals_unique_referral UNIQUE (patient_name, date_received);
ALTER TABLE medicare_visit_flags ADD CONSTRAINT medicare_visit_flags_patient_name_key UNIQUE (patient_name);
ALTER TABLE page_permissions ADD CONSTRAINT page_permissions_page_key_key UNIQUE (page_key);
ALTER TABLE patient_clinical_settings ADD CONSTRAINT patient_clinical_settings_patient_name_key UNIQUE (patient_name);
ALTER TABLE patient_master ADD CONSTRAINT patient_master_patient_name_key UNIQUE (patient_name);
ALTER TABLE rm_kpi_goals ADD CONSTRAINT rm_kpi_goals_region_period_type_period_year_period_number_key UNIQUE (region, period_type, period_year, period_number);
ALTER TABLE swift_team_patients ADD CONSTRAINT swift_patient_unique UNIQUE (patient_name);
ALTER TABLE user_page_overrides ADD CONSTRAINT user_page_overrides_coordinator_id_page_key_key UNIQUE (coordinator_id, page_key);
ALTER TABLE visit_schedule_data ADD CONSTRAINT visit_schedule_unique_visit UNIQUE (patient_name, visit_date, event_type, staff_name);
ALTER TABLE waitlist_assignments ADD CONSTRAINT waitlist_assignments_patient_name_key UNIQUE (patient_name);

-- ---------------------------------------------------------------------------
-- 6. FOREIGN KEYS
-- ---------------------------------------------------------------------------
ALTER TABLE action_items ADD CONSTRAINT action_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES coordinators(id);
ALTER TABLE action_items ADD CONSTRAINT action_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES coordinators(id);
ALTER TABLE action_responses ADD CONSTRAINT action_responses_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES auth.users(id);
ALTER TABLE auth_documents ADD CONSTRAINT auth_documents_auth_tracker_id_fkey FOREIGN KEY (auth_tracker_id) REFERENCES auth_tracker(id) ON DELETE CASCADE;
ALTER TABLE auth_renewal_tasks ADD CONSTRAINT auth_renewal_tasks_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth_tracker(id) ON DELETE CASCADE;
ALTER TABLE auth_team_assignments ADD CONSTRAINT auth_team_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES coordinators(id);
ALTER TABLE auth_team_assignments ADD CONSTRAINT auth_team_assignments_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id) ON DELETE CASCADE;
ALTER TABLE auth_tracker ADD CONSTRAINT auth_tracker_predecessor_auth_id_fkey FOREIGN KEY (predecessor_auth_id) REFERENCES auth_tracker(id) ON DELETE SET NULL;
ALTER TABLE care_coord_discharges ADD CONSTRAINT care_coord_discharges_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE care_coord_notes ADD CONSTRAINT care_coord_notes_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE care_coord_referrals ADD CONSTRAINT care_coord_referrals_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE care_coord_task_log ADD CONSTRAINT care_coord_task_log_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE census_data ADD CONSTRAINT census_data_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE;
ALTER TABLE census_status_log ADD CONSTRAINT census_status_log_hospitalization_id_fkey FOREIGN KEY (hospitalization_id) REFERENCES hospitalizations(id) ON DELETE SET NULL;
ALTER TABLE clinician_productivity ADD CONSTRAINT clinician_productivity_clinician_id_fkey FOREIGN KEY (clinician_id) REFERENCES clinicians(id);
ALTER TABLE clinician_pto ADD CONSTRAINT clinician_pto_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES coordinators(id);
ALTER TABLE coordinator_activity_log ADD CONSTRAINT coordinator_activity_log_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE coordinator_overload_alerts ADD CONSTRAINT coordinator_overload_alerts_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE coordinator_tasks ADD CONSTRAINT coordinator_tasks_auth_tracker_id_fkey FOREIGN KEY (auth_tracker_id) REFERENCES auth_tracker(id) ON DELETE SET NULL;
ALTER TABLE coordinators ADD CONSTRAINT coordinators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE hospitalized_tracker ADD CONSTRAINT hospitalized_tracker_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE insurance_abbreviations ADD CONSTRAINT insurance_abbreviations_created_by_fkey FOREIGN KEY (created_by) REFERENCES coordinators(id);
ALTER TABLE insurance_abbreviations ADD CONSTRAINT insurance_abbreviations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES coordinators(id);
ALTER TABLE marketing_encounters ADD CONSTRAINT marketing_encounters_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES marketing_contacts(id) ON DELETE CASCADE;
ALTER TABLE note_notifications ADD CONSTRAINT note_notifications_note_id_fkey FOREIGN KEY (note_id) REFERENCES patient_notes(id) ON DELETE CASCADE;
ALTER TABLE note_notifications ADD CONSTRAINT note_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES coordinators(id);
ALTER TABLE on_hold_recovery ADD CONSTRAINT on_hold_recovery_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id);
ALTER TABLE patient_clinician_assignments ADD CONSTRAINT patient_clinician_assignments_clinician_id_fkey FOREIGN KEY (clinician_id) REFERENCES clinicians(id) ON DELETE CASCADE;
ALTER TABLE patient_notes ADD CONSTRAINT patient_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES coordinators(id);
ALTER TABLE scheduled_visits ADD CONSTRAINT scheduled_visits_clinician_id_fkey FOREIGN KEY (clinician_id) REFERENCES clinicians(id);
ALTER TABLE scheduled_visits ADD CONSTRAINT scheduled_visits_parent_visit_id_fkey FOREIGN KEY (parent_visit_id) REFERENCES scheduled_visits(id);
ALTER TABLE swift_wound_assessments ADD CONSTRAINT swift_wound_assessments_swift_patient_id_fkey FOREIGN KEY (swift_patient_id) REFERENCES swift_team_patients(id) ON DELETE CASCADE;
ALTER TABLE user_page_overrides ADD CONSTRAINT user_page_overrides_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES coordinators(id) ON DELETE CASCADE;
ALTER TABLE user_page_overrides ADD CONSTRAINT user_page_overrides_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES coordinators(id);
ALTER TABLE user_page_overrides ADD CONSTRAINT user_page_overrides_page_key_fkey FOREIGN KEY (page_key) REFERENCES page_permissions(page_key) ON DELETE CASCADE;
ALTER TABLE visit_schedule_data ADD CONSTRAINT visit_schedule_data_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. CHECK CONSTRAINTS
-- ---------------------------------------------------------------------------
ALTER TABLE action_responses ADD CONSTRAINT action_responses_status_check CHECK ((status = ANY (ARRAY['open'::text, 'started'::text, 'completed'::text, 'dismissed'::text])));
ALTER TABLE auth_renewal_tasks ADD CONSTRAINT auth_renewal_tasks_priority_check CHECK ((priority = ANY (ARRAY['urgent'::text, 'high'::text, 'normal'::text])));
ALTER TABLE auth_renewal_tasks ADD CONSTRAINT auth_renewal_tasks_task_status_check CHECK ((task_status = ANY (ARRAY['open'::text, 'in_progress'::text, 'submitted'::text, 'approved'::text, 'denied'::text, 'closed'::text])));
ALTER TABLE auth_tracker ADD CONSTRAINT auth_tracker_request_category_check CHECK ((request_category = ANY (ARRAY['initial'::text, 'renewal'::text, 'concurrent_review'::text, 'resumption'::text, 'retrospective'::text])));
ALTER TABLE coordinators ADD CONSTRAINT coordinators_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'assoc_director'::text, 'ceo'::text, 'telehealth'::text, 'regional_manager'::text, 'auth_coordinator'::text, 'intake_coordinator'::text, 'care_coordinator'::text, 'clinician'::text, 'pod_leader'::text, 'team_leader'::text, 'team_member'::text])));
ALTER TABLE hospitalizations ADD CONSTRAINT hospitalizations_cause_category_check CHECK ((cause_category = ANY (ARRAY['lymphedema_related'::text, 'other_cause'::text, 'unknown'::text])));
ALTER TABLE hospitalizations ADD CONSTRAINT hospitalizations_outcome_check CHECK ((outcome = ANY (ARRAY['discharged_home'::text, 'discharged_snf'::text, 'discharged_rehab'::text, 'deceased'::text, 'still_admitted'::text, 'unknown'::text])));
ALTER TABLE marketing_contacts ADD CONSTRAINT marketing_contacts_contact_type_check CHECK ((contact_type = ANY (ARRAY['PCP'::text, 'Podiatrist'::text, 'Hospital'::text, 'Specialist'::text, 'Wound Care'::text, 'Orthopedic'::text, 'Vascular'::text, 'Cardiology'::text, 'Neurology'::text, 'Assisted Living'::text, 'SNF'::text, 'Home Health Agency'::text, 'Other'::text])));
ALTER TABLE marketing_contacts ADD CONSTRAINT marketing_contacts_referral_potential_check CHECK ((referral_potential = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));
ALTER TABLE marketing_encounters ADD CONSTRAINT marketing_encounters_encounter_type_check CHECK ((encounter_type = ANY (ARRAY['In-Person Visit'::text, 'Phone Call'::text, 'Drop-In'::text, 'Lunch & Learn'::text, 'Event'::text, 'Email'::text, 'Referral Received'::text, 'Follow-Up'::text, 'Other'::text])));
ALTER TABLE on_hold_recovery ADD CONSTRAINT on_hold_recovery_priority_check CHECK ((priority = ANY (ARRAY['high'::text, 'normal'::text, 'low'::text])));
ALTER TABLE patient_clinical_settings ADD CONSTRAINT patient_clinical_settings_loc_check CHECK (((loc >= 1) AND (loc <= 5)));
ALTER TABLE patient_clinical_settings ADD CONSTRAINT patient_clinical_settings_visit_frequency_check CHECK ((visit_frequency = ANY (ARRAY['1x/week'::text, '2x/week'::text, '3x/week'::text, '4x/week'::text, '5x/week'::text, '1x/month'::text, '2x/month'::text, 'PRN'::text, 'Daily'::text, '4w4'::text, '2w4'::text, '1w4'::text, '1em1'::text, '1em2'::text])));
ALTER TABLE patient_clinician_assignments ADD CONSTRAINT patient_clinician_assignments_discipline_check CHECK ((discipline = ANY (ARRAY['PT'::text, 'OT'::text, 'PTA'::text, 'COTA'::text])));
ALTER TABLE patient_clinician_assignments ADD CONSTRAINT patient_clinician_assignments_role_check CHECK ((role = ANY (ARRAY['lead'::text, 'assistant'::text])));
ALTER TABLE patient_discharges ADD CONSTRAINT patient_discharges_discharge_reason_check CHECK ((discharge_reason = ANY (ARRAY['goals_met'::text, 'patient_request'::text, 'insurance_exhausted'::text, 'non_compliance'::text, 'moved'::text, 'deceased'::text, 'hospitalized'::text, 'physician_order'::text, 'other'::text])));
ALTER TABLE patient_discharges ADD CONSTRAINT patient_discharges_outcome_check CHECK ((outcome = ANY (ARRAY['independent'::text, 'improved'::text, 'referred_out'::text, 'readmit_possible'::text, 'no_change'::text, 'unknown'::text])));
ALTER TABLE rm_kpi_goals ADD CONSTRAINT rm_kpi_goals_period_type_check CHECK ((period_type = ANY (ARRAY['week'::text, 'month'::text, 'quarter'::text, 'year'::text])));
ALTER TABLE scheduled_visits ADD CONSTRAINT scheduled_visits_recurrence_pattern_check CHECK ((recurrence_pattern = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, NULL::text])));
ALTER TABLE scheduled_visits ADD CONSTRAINT scheduled_visits_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text, 'rescheduled'::text])));
ALTER TABLE scheduled_visits ADD CONSTRAINT scheduled_visits_visit_type_check CHECK ((visit_type = ANY (ARRAY['eval'::text, 'routine'::text, 'reassessment'::text, 'discharge'::text, 'follow_up'::text, 'wound_care'::text, 'supervisory'::text])));
ALTER TABLE swift_team_patients ADD CONSTRAINT swift_team_patients_review_frequency_check CHECK ((review_frequency = ANY (ARRAY['daily'::text, 'twice_weekly'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'prn'::text])));
ALTER TABLE swift_team_patients ADD CONSTRAINT swift_team_patients_wound_severity_check CHECK ((wound_severity = ANY (ARRAY['stage_1'::text, 'stage_2'::text, 'stage_3'::text, 'stage_4'::text, 'unstageable'::text, 'suspected_dti'::text, 'partial'::text, 'full'::text, 'other'::text])));
ALTER TABLE swift_team_patients ADD CONSTRAINT swift_team_patients_wound_status_check CHECK ((wound_status = ANY (ARRAY['active'::text, 'improving'::text, 'stalled'::text, 'deteriorating'::text, 'healed'::text, 'referred_out'::text, 'discontinued'::text])));
ALTER TABLE swift_wound_assessments ADD CONSTRAINT swift_wound_assessments_pain_score_check CHECK (((pain_score >= 0) AND (pain_score <= 10)));
ALTER TABLE waitlist_assignments ADD CONSTRAINT waitlist_assignments_assignment_status_check CHECK ((assignment_status = ANY (ARRAY['pending'::text, 'assigned'::text, 'scheduled'::text, 'converted'::text, 'removed'::text])));
ALTER TABLE waitlist_assignments ADD CONSTRAINT waitlist_assignments_priority_check CHECK ((priority = ANY (ARRAY['urgent'::text, 'high'::text, 'normal'::text, 'low'::text])));

-- ---------------------------------------------------------------------------
-- 8. INDEXES (non-PK/UK)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_action_items_assigned_to ON public.action_items USING btree (assigned_to);
CREATE INDEX idx_action_items_created_by ON public.action_items USING btree (created_by);
CREATE INDEX idx_action_responses_key ON public.action_responses USING btree (action_key);
CREATE INDEX idx_alerts_created ON public.alerts USING btree (created_at DESC);
CREATE INDEX idx_alerts_region ON public.alerts USING btree (assigned_to_region);
CREATE INDEX idx_alerts_type ON public.alerts USING btree (alert_type);
CREATE INDEX idx_alerts_unread ON public.alerts USING btree (is_read, is_dismissed);
CREATE INDEX idx_audit_staging_applied ON public.auth_audit_staging USING btree (applied_at);
CREATE INDEX idx_audit_staging_batch ON public.auth_audit_staging USING btree (imported_batch);
CREATE INDEX idx_audit_staging_patient ON public.auth_audit_staging USING btree (lower(patient_name), region);
CREATE INDEX idx_auth_documents_tracker ON public.auth_documents USING btree (auth_tracker_id);
CREATE INDEX idx_auth_renewal_patient ON public.auth_renewal_tasks USING btree (patient_name);
CREATE INDEX idx_auth_renewal_status ON public.auth_renewal_tasks USING btree (task_status);
CREATE INDEX idx_auth_renewal_tasks_auth_id ON public.auth_renewal_tasks USING btree (auth_id);
CREATE INDEX idx_auth_sync_pending_flagged ON public.auth_sync_pending USING btree (flagged_at);
CREATE INDEX idx_auth_team_assignments_assigned_by ON public.auth_team_assignments USING btree (assigned_by);
CREATE INDEX idx_auth_expiry ON public.auth_tracker USING btree (auth_expiry_date);
CREATE INDEX idx_auth_insurance ON public.auth_tracker USING btree (insurance);
CREATE INDEX idx_auth_patient ON public.auth_tracker USING btree (patient_name);
CREATE INDEX idx_auth_region ON public.auth_tracker USING btree (region);
CREATE INDEX idx_auth_status ON public.auth_tracker USING btree (auth_status);
CREATE INDEX idx_auth_tracker_health ON public.auth_tracker USING btree (auth_health) WHERE (auth_health <> 'ok'::auth_health_t);
CREATE INDEX idx_auth_tracker_predecessor ON public.auth_tracker USING btree (predecessor_auth_id);
CREATE INDEX idx_care_coord_discharges_coord ON public.care_coord_discharges USING btree (coordinator_id);
CREATE INDEX idx_care_coord_notes_coord ON public.care_coord_notes USING btree (coordinator_id);
CREATE INDEX idx_care_coord_referrals_coord ON public.care_coord_referrals USING btree (coordinator_id);
CREATE INDEX idx_care_coord_task_log_coord ON public.care_coord_task_log USING btree (coordinator_id);
CREATE INDEX census_needs_review_idx ON public.census_data USING btree (needs_frequency_review) WHERE (needs_frequency_review = true);
CREATE INDEX idx_census_batch ON public.census_data USING btree (batch_id);
CREATE INDEX idx_census_days_since ON public.census_data USING btree (days_since_last_visit);
CREATE INDEX idx_census_last_visit ON public.census_data USING btree (last_visit_date DESC);
CREATE INDEX idx_census_region ON public.census_data USING btree (region);
CREATE INDEX idx_census_status ON public.census_data USING btree (status);
CREATE INDEX idx_census_status_log_changed ON public.census_status_log USING btree (changed_at DESC);
CREATE INDEX idx_census_status_log_hosp ON public.census_status_log USING btree (hospitalization_id);
CREATE INDEX idx_census_status_log_patient ON public.census_status_log USING btree (patient_name);
CREATE INDEX idx_clinician_productivity_clin ON public.clinician_productivity USING btree (clinician_id);
CREATE INDEX idx_productivity_clinician_week ON public.clinician_productivity USING btree (clinician_name, week_start);
CREATE INDEX idx_clinician_pto_logged_by ON public.clinician_pto USING btree (logged_by);
CREATE INDEX idx_clinicians_fullname_lower ON public.clinicians USING btree (lower(full_name));
CREATE INDEX idx_clinicians_region ON public.clinicians USING btree (region);
CREATE INDEX idx_activity_log_coordinator ON public.coordinator_activity_log USING btree (coordinator_id, created_at DESC);
CREATE INDEX idx_activity_log_date ON public.coordinator_activity_log USING btree (created_at DESC);
CREATE INDEX idx_activity_log_type ON public.coordinator_activity_log USING btree (action_type, created_at DESC);
CREATE INDEX idx_coordinator_daily_metrics_lookup ON public.coordinator_daily_metrics USING btree (coordinator_name, snapshot_date DESC);
CREATE INDEX coordinator_tasks_auth_tracker_idx ON public.coordinator_tasks USING btree (auth_tracker_id) WHERE (auth_tracker_id IS NOT NULL);
CREATE UNIQUE INDEX coordinator_tasks_auto_dedupe ON public.coordinator_tasks USING btree (auth_tracker_id, task_type) WHERE ((auto_generated = true) AND (auth_tracker_id IS NOT NULL));
CREATE INDEX coordinator_tasks_region_status_idx ON public.coordinator_tasks USING btree (coordinator_region, status);
CREATE INDEX idx_coord_tasks_assigned ON public.coordinator_tasks USING btree (assigned_to);
CREATE INDEX idx_coord_tasks_priority ON public.coordinator_tasks USING btree (priority);
CREATE INDEX idx_coord_tasks_region ON public.coordinator_tasks USING btree (coordinator_region);
CREATE INDEX idx_coord_tasks_status ON public.coordinator_tasks USING btree (status);
CREATE INDEX idx_coord_tasks_type ON public.coordinator_tasks USING btree (task_type);
CREATE INDEX idx_ops_reports_date ON public.daily_ops_reports USING btree (report_date DESC, report_type);
CREATE INDEX idx_daily_reports_coord ON public.daily_reports USING btree (coordinator_id);
CREATE INDEX idx_data_audit_log_patient ON public.data_audit_log USING btree (lower(patient_name));
CREATE INDEX idx_data_audit_log_row ON public.data_audit_log USING btree (table_name, row_id);
CREATE INDEX idx_data_audit_log_source ON public.data_audit_log USING btree (source);
CREATE INDEX idx_hospitalized_tracker_coord ON public.hospitalized_tracker USING btree (coordinator_id);
CREATE INDEX idx_ins_abbr_lookup ON public.insurance_abbreviations USING btree (abbreviation) WHERE (is_active = true);
CREATE INDEX idx_ins_abbr_payor ON public.insurance_abbreviations USING btree (payor_group) WHERE (is_active = true);
CREATE INDEX idx_ins_abbr_region ON public.insurance_abbreviations USING btree (region) WHERE (is_active = true);
CREATE INDEX idx_intake_diagnosis ON public.intake_referrals USING btree (diagnosis_clean);
CREATE INDEX idx_intake_referrals_name_norm ON public.intake_referrals USING btree (patient_name_norm, date_received);
CREATE INDEX idx_intake_referrals_name_trgm ON public.intake_referrals USING gin (patient_name_norm gin_trgm_ops);
CREATE INDEX idx_ir_date ON public.intake_referrals USING btree (date_received);
CREATE INDEX idx_ir_diag ON public.intake_referrals USING btree (diagnosis);
CREATE INDEX idx_ir_ins ON public.intake_referrals USING btree (insurance);
CREATE INDEX idx_ir_region ON public.intake_referrals USING btree (region);
CREATE INDEX idx_ir_status ON public.intake_referrals USING btree (referral_status);
CREATE INDEX idx_ir_type ON public.intake_referrals USING btree (referral_type);
CREATE INDEX idx_marketing_encounters_contact ON public.marketing_encounters USING btree (contact_id);
CREATE INDEX idx_medicare_visit_flags_due ON public.medicare_visit_flags USING btree (progress_note_due, region) WHERE (progress_note_due = true);
CREATE INDEX idx_note_notif_created ON public.note_notifications USING btree (created_at DESC);
CREATE INDEX idx_note_notif_user ON public.note_notifications USING btree (user_id, read);
CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at);
CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, read) WHERE (read = false);
CREATE INDEX idx_on_hold_recovery_coord ON public.on_hold_recovery USING btree (coordinator_id);
CREATE INDEX idx_on_hold_region ON public.on_hold_recovery USING btree (region);
CREATE UNIQUE INDEX on_hold_recovery_patient_name_unique ON public.on_hold_recovery USING btree (patient_name);
CREATE INDEX idx_pcs_patient ON public.patient_clinical_settings USING btree (patient_name);
CREATE INDEX idx_pcs_reassessment_status ON public.patient_clinical_settings USING btree (reassessment_status);
CREATE INDEX idx_pcs_region ON public.patient_clinical_settings USING btree (region);
CREATE INDEX pca_clinician_active_idx ON public.patient_clinician_assignments USING btree (clinician_id) WHERE (is_active = true);
CREATE UNIQUE INDEX pca_one_active_lead_per_discipline ON public.patient_clinician_assignments USING btree (patient_key, discipline) WHERE ((is_active = true) AND (role = 'lead'::text));
CREATE INDEX pca_patient_active_idx ON public.patient_clinician_assignments USING btree (patient_key) WHERE (is_active = true);
CREATE INDEX idx_discharges_date ON public.patient_discharges USING btree (discharge_date DESC);
CREATE INDEX idx_discharges_patient ON public.patient_discharges USING btree (patient_name);
CREATE INDEX idx_docs_auth ON public.patient_documents USING btree (auth_tracker_id);
CREATE INDEX idx_docs_latest ON public.patient_documents USING btree (is_latest);
CREATE INDEX idx_docs_patient ON public.patient_documents USING btree (patient_name);
CREATE INDEX idx_docs_type ON public.patient_documents USING btree (doc_type);
CREATE INDEX idx_patient_master_name ON public.patient_master USING btree (patient_name);
CREATE INDEX idx_patient_master_region ON public.patient_master USING btree (region);
CREATE INDEX idx_patient_master_status ON public.patient_master USING btree (current_status);
CREATE INDEX idx_patient_notes_created ON public.patient_notes USING btree (created_at DESC);
CREATE INDEX idx_patient_notes_patient ON public.patient_notes USING btree (patient_name);
CREATE INDEX idx_risk_factors_loc ON public.patient_risk_factors USING btree (loc_level);
CREATE INDEX idx_risk_factors_region ON public.patient_risk_factors USING btree (region);
CREATE UNIQUE INDEX uniq_risk_factors_patient ON public.patient_risk_factors USING btree (lower(patient_name), region);
CREATE INDEX idx_visit_history_auth ON public.patient_visit_history USING btree (auth_tracker_id);
CREATE INDEX idx_visit_history_date ON public.patient_visit_history USING btree (visit_date DESC);
CREATE INDEX idx_visit_history_patient ON public.patient_visit_history USING btree (patient_name);
CREATE INDEX idx_scheduled_visits_clinician ON public.scheduled_visits USING btree (clinician_id);
CREATE INDEX idx_scheduled_visits_date ON public.scheduled_visits USING btree (visit_date);
CREATE INDEX idx_scheduled_visits_patient ON public.scheduled_visits USING btree (patient_name);
CREATE INDEX idx_scheduled_visits_region ON public.scheduled_visits USING btree (region);
CREATE INDEX idx_scheduled_visits_status ON public.scheduled_visits USING btree (status);
CREATE INDEX idx_swift_patients_region ON public.swift_team_patients USING btree (region);
CREATE INDEX idx_swift_patients_review ON public.swift_team_patients USING btree (next_review_date);
CREATE INDEX idx_swift_patients_status ON public.swift_team_patients USING btree (wound_status);
CREATE INDEX idx_swift_assessments_date ON public.swift_wound_assessments USING btree (assessment_date DESC);
CREATE INDEX idx_swift_assessments_patient ON public.swift_wound_assessments USING btree (swift_patient_id);
CREATE INDEX idx_user_page_overrides_granted_by ON public.user_page_overrides USING btree (granted_by);
CREATE INDEX idx_user_page_overrides_page_key ON public.user_page_overrides USING btree (page_key);
CREATE INDEX idx_visits_staff_normalized ON public.visit_schedule_data USING btree (staff_name_normalized);
CREATE INDEX idx_vsd_batch ON public.visit_schedule_data USING btree (batch_id);
CREATE INDEX idx_vsd_date ON public.visit_schedule_data USING btree (visit_date);
CREATE INDEX idx_vsd_region ON public.visit_schedule_data USING btree (region);
CREATE INDEX idx_vsd_staff ON public.visit_schedule_data USING btree (staff_name);

-- ---------------------------------------------------------------------------
-- 9. VIEWS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.regional_manager_map AS
 SELECT full_name,
    email,
    regions,
    role
   FROM coordinators
  WHERE role = 'regional_manager'::text AND is_active = true;

CREATE OR REPLACE VIEW public.v_coordinator_engagement AS
 SELECT c.id AS coordinator_id,
    c.user_id,
    c.full_name,
    c.email,
    c.role,
    c.regions,
    c.is_active,
    u.last_sign_in_at,
    u.email_confirmed_at,
        CASE
            WHEN u.last_sign_in_at IS NULL THEN NULL::integer
            ELSE EXTRACT(epoch FROM now() - u.last_sign_in_at)::integer / 86400
        END AS days_since_last_login
   FROM coordinators c
     LEFT JOIN auth.users u ON u.id = c.user_id
  WHERE c.is_active = true;

CREATE OR REPLACE VIEW public.v_my_day_notifications AS
 SELECT 'mention'::text AS source,
    nn.id::text AS source_id,
    nn.user_id AS recipient_user_id,
    NULL::text AS recipient_name,
    NULL::text AS recipient_region,
    nn.patient_name,
    pn.author_name AS from_user_name,
    'You were mentioned in a note'::text AS title,
    pn.note_text AS body,
    'normal'::text AS priority,
    pn.created_at AS occurred_at,
    jsonb_build_object('note_id', nn.note_id, 'patient_name', nn.patient_name, 'author_id', pn.author_id) AS metadata
   FROM note_notifications nn
     JOIN patient_notes pn ON pn.id = nn.note_id
  WHERE nn.read = false
UNION ALL
 SELECT 'assigned_task'::text AS source,
    ct.id::text AS source_id,
    c.user_id AS recipient_user_id,
    ct.assigned_to AS recipient_name,
    ct.coordinator_region AS recipient_region,
    ct.patient_name,
    ct.updated_by AS from_user_name,
    ct.title,
    COALESCE(ct.description, ''::text) AS body,
    COALESCE(ct.priority, 'normal'::text) AS priority,
    ct.created_at AS occurred_at,
    jsonb_build_object('task_id', ct.id, 'task_type', ct.task_type, 'auth_tracker_id', ct.auth_tracker_id, 'patient_name', ct.patient_name, 'due_date', ct.due_date, 'status', ct.status) AS metadata
   FROM coordinator_tasks ct
     LEFT JOIN coordinators c ON lower(c.full_name) = lower(ct.assigned_to)
  WHERE ct.status <> ALL (ARRAY['completed'::text, 'closed'::text, 'cancelled'::text])
UNION ALL
 SELECT 'alert'::text AS source,
    a.id::text AS source_id,
    NULL::uuid AS recipient_user_id,
    NULL::text AS recipient_name,
    COALESCE(a.assigned_to_region, a.region) AS recipient_region,
    a.patient_name,
    NULL::text AS from_user_name,
    a.title,
    COALESCE(a.message, ''::text) AS body,
    COALESCE(a.priority, 'medium'::text) AS priority,
    a.created_at AS occurred_at,
    COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object('alert_type', a.alert_type, 'region', a.region) AS metadata
   FROM alerts a
  WHERE NOT a.is_dismissed AND (a.alert_type = ANY (ARRAY['auth_over_limit'::text, 'auth_low_visits'::text, 'auth_expiring'::text]));

CREATE OR REPLACE VIEW public.v_authorizations_effective AS
 WITH base AS (
         SELECT auth_tracker.id,
            auth_tracker.patient_name,
            auth_tracker.dob,
            auth_tracker.member_id,
            auth_tracker.phone,
            auth_tracker.region,
            auth_tracker.insurance,
            auth_tracker.insurance_type,
            auth_tracker.auth_number,
            auth_tracker.request_type,
            auth_tracker.visits_authorized,
            auth_tracker.visits_used,
            auth_tracker.evals_authorized,
            auth_tracker.evals_used,
            auth_tracker.reassessments_authorized,
            auth_tracker.reassessments_used,
            auth_tracker.soc_date,
            auth_tracker.auth_submitted_date,
            auth_tracker.auth_needed_by,
            auth_tracker.auth_approved_date,
            auth_tracker.auth_expiry_date,
            auth_tracker.auth_status,
            auth_tracker.pcp_name,
            auth_tracker.pcp_phone,
            auth_tracker.pcp_fax,
            auth_tracker.pcp_facility,
            auth_tracker.therapy_type,
            auth_tracker.frequency,
            auth_tracker.alert_low_visits,
            auth_tracker.alert_expiring,
            auth_tracker.alert_sent_renewal,
            auth_tracker.assigned_to,
            auth_tracker.coordinator_region,
            auth_tracker.notes,
            auth_tracker.denial_reason,
            auth_tracker.created_at,
            auth_tracker.updated_at,
            auth_tracker.auth_sequence,
            auth_tracker.predecessor_auth_id,
            auth_tracker.is_currently_active,
            auth_tracker.request_category,
            auth_tracker.predecessor_exhausted_date,
            auth_tracker.effective_visits_remaining,
            auth_tracker.alert_predecessor_pending,
            auth_tracker.cpt_codes,
            auth_tracker.diagnosis_code,
            auth_tracker.requesting_provider,
            auth_tracker.requesting_provider_npi,
            auth_tracker.auth_discipline,
            auth_tracker.updated_by,
                CASE
                    WHEN auth_tracker.auth_status = ANY (ARRAY['discharged'::text, 'denied'::text]) THEN auth_tracker.auth_status
                    WHEN auth_tracker.auth_expiry_date IS NOT NULL AND auth_tracker.auth_expiry_date < CURRENT_DATE AND (auth_tracker.auth_status <> ALL (ARRAY['discharged'::text, 'denied'::text])) THEN 'expired'::text
                    ELSE auth_tracker.auth_status
                END AS effective_status
           FROM auth_tracker
        )
 SELECT b.id,
    b.patient_name,
    b.dob,
    b.member_id,
    b.phone,
    b.region,
    b.insurance,
    b.insurance_type,
    b.auth_number,
    b.request_type,
    b.visits_authorized,
    b.visits_used,
    b.evals_authorized,
    b.evals_used,
    b.reassessments_authorized,
    b.reassessments_used,
    b.soc_date,
    b.auth_submitted_date,
    b.auth_needed_by,
    b.auth_approved_date,
    b.auth_expiry_date,
    b.auth_status,
    b.pcp_name,
    b.pcp_phone,
    b.pcp_fax,
    b.pcp_facility,
    b.therapy_type,
    b.frequency,
    b.alert_low_visits,
    b.alert_expiring,
    b.alert_sent_renewal,
    b.assigned_to,
    b.coordinator_region,
    b.notes,
    b.denial_reason,
    b.created_at,
    b.updated_at,
    b.auth_sequence,
    b.predecessor_auth_id,
    b.is_currently_active,
    b.request_category,
    b.predecessor_exhausted_date,
    b.effective_visits_remaining,
    b.alert_predecessor_pending,
    b.cpt_codes,
    b.diagnosis_code,
    b.requesting_provider,
    b.requesting_provider_npi,
    b.auth_discipline,
    b.updated_by,
    b.effective_status,
        CASE
            WHEN b.effective_status = 'expired'::text THEN 0
            ELSE GREATEST(COALESCE(b.visits_authorized, 0) - COALESCE(b.visits_used, 0), 0)
        END AS eff_visits_remaining,
        CASE
            WHEN b.predecessor_auth_id IS NULL THEN false
            WHEN pred.effective_status = ANY (ARRAY['expired'::text, 'discharged'::text, 'denied'::text]) THEN false
            WHEN COALESCE(pred.visits_authorized, 0) > 0 AND COALESCE(pred.visits_used, 0) >= COALESCE(pred.visits_authorized, 0) THEN false
            ELSE true
        END AS eff_predecessor_pending,
    row_number() OVER (PARTITION BY b.patient_name ORDER BY (
        CASE
            WHEN b.effective_status = ANY (ARRAY['expired'::text, 'discharged'::text, 'denied'::text]) THEN 1
            ELSE 0
        END), b.auth_sequence, b.auth_expiry_date) AS stack_position
   FROM base b
     LEFT JOIN base pred ON pred.id = b.predecessor_auth_id;

CREATE OR REPLACE VIEW public.v_auth_pending_coverage AS
 WITH active_pts AS (
         SELECT census_data.patient_name,
            census_data.region,
            census_data.insurance,
            census_data.status,
            census_data.last_visit_date,
            census_data.last_visit_clinician,
            census_data.days_since_last_visit
           FROM census_data
          WHERE census_data.status ~~* '%active%'::text
        ), pt_latest_auth AS (
         SELECT DISTINCT ON ((lower(TRIM(BOTH FROM auth_tracker.patient_name)))) lower(TRIM(BOTH FROM auth_tracker.patient_name)) AS pname_key,
            auth_tracker.id,
            auth_tracker.patient_name,
            auth_tracker.auth_status,
            auth_tracker.auth_submitted_date,
            auth_tracker.auth_approved_date,
            auth_tracker.auth_expiry_date,
            auth_tracker.visits_authorized,
            auth_tracker.visits_used,
            auth_tracker.is_currently_active,
            auth_tracker.created_at,
            auth_tracker.updated_at,
            auth_tracker.assigned_to
           FROM auth_tracker
          ORDER BY (lower(TRIM(BOTH FROM auth_tracker.patient_name))), auth_tracker.created_at DESC NULLS LAST
        ), needs_coverage AS (
         SELECT c_1.patient_name,
            c_1.region,
            c_1.insurance,
            c_1.status,
            c_1.last_visit_date,
            c_1.last_visit_clinician,
            c_1.days_since_last_visit
           FROM active_pts c_1
          WHERE NOT (EXISTS ( SELECT 1
                   FROM auth_tracker a_1
                  WHERE lower(TRIM(BOTH FROM a_1.patient_name)) = lower(TRIM(BOTH FROM c_1.patient_name)) AND (a_1.auth_status = ANY (ARRAY['active'::text, 'approved'::text])) AND (a_1.auth_expiry_date IS NULL OR a_1.auth_expiry_date >= CURRENT_DATE)))
        )
 SELECT c.patient_name,
    c.region,
    c.insurance,
    c.status AS census_status,
    c.last_visit_date,
    c.last_visit_clinician,
    c.days_since_last_visit,
    a.id AS latest_auth_id,
    a.auth_status AS latest_auth_status,
    a.auth_submitted_date,
    a.auth_approved_date,
    a.auth_expiry_date AS latest_auth_expiry,
    a.assigned_to AS latest_auth_assigned_to,
        CASE
            WHEN a.id IS NULL THEN 'never_had_auth'::text
            WHEN a.auth_status = 'pending'::text AND a.auth_submitted_date IS NULL THEN 'pending_not_submitted'::text
            WHEN a.auth_status = 'submitted'::text THEN 'submitted_no_response'::text
            WHEN a.auth_expiry_date IS NOT NULL AND a.auth_expiry_date < CURRENT_DATE THEN 'expired_no_renewal'::text
            WHEN a.auth_status = ANY (ARRAY['denied'::text, 'cancelled'::text, 'expired'::text]) THEN 'expired_no_renewal'::text
            WHEN a.auth_status = 'pending'::text THEN 'pending_not_submitted'::text
            ELSE 'other'::text
        END AS pending_state,
        CASE
            WHEN a.id IS NULL THEN NULL::integer
            WHEN a.auth_status = 'pending'::text THEN CURRENT_DATE - a.created_at::date
            WHEN a.auth_status = 'submitted'::text THEN CURRENT_DATE - a.auth_submitted_date
            WHEN a.auth_expiry_date IS NOT NULL AND a.auth_expiry_date < CURRENT_DATE THEN CURRENT_DATE - a.auth_expiry_date
            ELSE NULL::integer
        END AS days_in_state
   FROM needs_coverage c
     LEFT JOIN pt_latest_auth a ON a.pname_key = lower(TRIM(BOTH FROM c.patient_name))
  ORDER BY c.days_since_last_visit;
