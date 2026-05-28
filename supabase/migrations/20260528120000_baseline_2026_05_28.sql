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

-- ---------------------------------------------------------------------------
-- 10. FUNCTIONS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_user(p_email text, p_full_name text, p_role text, p_password text DEFAULT NULL::text, p_regions text[] DEFAULT '{}'::text[], p_team text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  caller_role text;
  new_user_id uuid;
  existing_auth_id uuid;
  existing_coord_id uuid;
BEGIN
  SELECT role INTO caller_role FROM public.coordinators WHERE user_id = auth.uid();
  IF caller_role NOT IN ('super_admin', 'admin', 'ceo') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT id INTO existing_coord_id FROM public.coordinators WHERE email = p_email;
  IF existing_coord_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'A coordinator profile with this email already exists');
  END IF;

  SELECT id INTO existing_auth_id FROM auth.users WHERE email = p_email;

  IF existing_auth_id IS NOT NULL THEN
    new_user_id := existing_auth_id;
  ELSE
    new_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, email_confirmed_at,
      encrypted_password,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      -- All token/change columns must be '' (GoTrue is NULL-intolerant on these)
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new,
      email_change_token_current,
      reauthentication_token,
      phone_change,
      phone_change_token,
      is_super_admin
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      p_email, now(),
      CASE
        WHEN p_password IS NOT NULL AND p_password <> ''
        THEN extensions.crypt(p_password, extensions.gen_salt('bf'))
        ELSE extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
      END,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name),
      now(), now(),
      '', '', '', '', '', '', '', '',
      false
    );
  END IF;

  -- Update password if provided and auth user already existed
  IF existing_auth_id IS NOT NULL AND p_password IS NOT NULL AND p_password <> '' THEN
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    WHERE id = existing_auth_id;
  END IF;

  -- Ensure matching auth.identities row exists (login path)
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  VALUES (
    new_user_id::text,
    new_user_id,
    jsonb_build_object(
      'sub', new_user_id::text,
      'email', p_email,
      'email_verified', true,   -- we already set email_confirmed_at; keep identity_data consistent
      'phone_verified', false,
      'name', p_full_name
    ),
    'email',
    now(),
    now()
  )
  ON CONFLICT (provider, provider_id) DO NOTHING;

  -- Create coordinator profile
  INSERT INTO public.coordinators (full_name, email, role, regions, team, user_id, is_active)
  VALUES (p_full_name, p_email, p_role, p_regions, p_team, new_user_id, true);

  RETURN jsonb_build_object(
    'success', true,
    'user_id', new_user_id,
    'note', CASE WHEN existing_auth_id IS NOT NULL THEN 'Linked to existing auth account' ELSE 'New auth account created' END
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Only super_admin can delete users
  IF NOT EXISTS (
    SELECT 1 FROM public.coordinators
    WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Delete auth user (cascades to sessions, identities, etc.)
  DELETE FROM auth.users WHERE id = target_user_id;

  RETURN jsonb_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_password(target_user_id uuid, new_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  caller_role text;
  rows_updated int;
BEGIN
  SELECT role INTO caller_role 
  FROM public.coordinators 
  WHERE user_id = auth.uid();
  
  IF caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE auth.users 
  SET 
    encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
    updated_at = now()
  WHERE id = target_user_id;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  
  IF rows_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No user found with that ID');
  END IF;

  RETURN jsonb_build_object('success', true, 'rows_updated', rows_updated);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_user(target_user_id uuid, new_email text DEFAULT NULL::text, new_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role 
  FROM public.coordinators 
  WHERE user_id = auth.uid();
  
  IF caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF new_email IS NOT NULL AND new_email <> '' THEN
    UPDATE auth.users 
    SET email = new_email, email_confirmed_at = now(), updated_at = now()
    WHERE id = target_user_id;
    
    UPDATE public.coordinators 
    SET email = new_email, updated_at = now()
    WHERE user_id = target_user_id;
  END IF;

  IF new_password IS NOT NULL AND new_password <> '' THEN
    UPDATE auth.users 
    SET 
      encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
      updated_at = now()
    WHERE id = target_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_audit_row(staging_id uuid, applied_by_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  c_row census_data%ROWTYPE;
  a_row auth_tracker%ROWTYPE;
  changes_made INTEGER := 0;
  audit_source TEXT;
BEGIN
  -- Load the staging row
  SELECT * INTO s FROM auth_audit_staging WHERE id = staging_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'staging row not found');
  END IF;
  IF s.applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already applied', 'applied_at', s.applied_at);
  END IF;

  audit_source := s.imported_batch;

  -- ── Find matching census row (most recent if multiple) ──────────────
  SELECT * INTO c_row
  FROM census_data
  WHERE LOWER(patient_name) = LOWER(s.patient_name) AND region = s.region
  ORDER BY uploaded_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    -- Apply each non-NULL field from staging, logging the old value
    IF s.status_normalized IS NOT NULL AND s.status_normalized IS DISTINCT FROM c_row.status THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'census_data', c_row.id, c_row.patient_name, c_row.region, 'status', c_row.status, s.status_normalized, applied_by_name);
      UPDATE census_data SET status = s.status_normalized, status_changed_at = NOW() WHERE id = c_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.address IS NOT NULL AND s.address IS DISTINCT FROM c_row.address THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'census_data', c_row.id, c_row.patient_name, c_row.region, 'address', c_row.address, s.address, applied_by_name);
      UPDATE census_data SET address = s.address WHERE id = c_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.discipline IS NOT NULL AND s.discipline IS DISTINCT FROM c_row.discipline THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'census_data', c_row.id, c_row.patient_name, c_row.region, 'discipline', c_row.discipline, s.discipline, applied_by_name);
      UPDATE census_data SET discipline = s.discipline WHERE id = c_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.ref_source IS NOT NULL AND s.ref_source IS DISTINCT FROM c_row.ref_source THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'census_data', c_row.id, c_row.patient_name, c_row.region, 'ref_source', c_row.ref_source, s.ref_source, applied_by_name);
      UPDATE census_data SET ref_source = s.ref_source WHERE id = c_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.insurance_clean IS NOT NULL AND s.insurance_clean IS DISTINCT FROM c_row.insurance THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'census_data', c_row.id, c_row.patient_name, c_row.region, 'insurance', c_row.insurance, s.insurance_clean, applied_by_name);
      UPDATE census_data SET insurance = s.insurance_clean WHERE id = c_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.frequency IS NOT NULL AND s.frequency IS DISTINCT FROM c_row.inferred_frequency THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'census_data', c_row.id, c_row.patient_name, c_row.region, 'inferred_frequency', c_row.inferred_frequency, s.frequency, applied_by_name);
      UPDATE census_data SET inferred_frequency = s.frequency, frequency_reviewed_at = NOW(), frequency_reviewed_by = applied_by_name WHERE id = c_row.id;
      changes_made := changes_made + 1;
    END IF;
  END IF;

  -- ── Find or insert auth_tracker row ─────────────────────────────────
  SELECT * INTO a_row
  FROM auth_tracker
  WHERE LOWER(patient_name) = LOWER(s.patient_name) AND region = s.region AND COALESCE(is_currently_active, true) = true
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    -- No auth row exists yet — INSERT one with the audit data
    INSERT INTO auth_tracker (
      patient_name, region, insurance, soc_date, auth_start_date, auth_expiry_date,
      visits_authorized, evals_authorized, reassessments_authorized,
      is_ppo, is_scheduled, notes, assigned_to, updated_by,
      is_currently_active, auth_status
    ) VALUES (
      s.patient_name, s.region, s.insurance_clean, s.soc_date, s.auth_start_date, s.auth_end_date,
      s.visits_authorized, s.evals_authorized, s.ras_authorized,
      s.is_ppo, s.is_scheduled, s.notes, applied_by_name, applied_by_name,
      TRUE, CASE WHEN s.auth_end_date IS NOT NULL THEN 'approved' ELSE 'pending' END
    ) RETURNING * INTO a_row;
    INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
      VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, '_created_from_audit', NULL, 'inserted', applied_by_name);
    changes_made := changes_made + 1;
  ELSE
    -- UPDATE existing auth row, logging each change
    IF s.soc_date IS NOT NULL AND s.soc_date IS DISTINCT FROM a_row.soc_date THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'soc_date', a_row.soc_date::text, s.soc_date::text, applied_by_name);
      UPDATE auth_tracker SET soc_date = s.soc_date WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.auth_start_date IS NOT NULL AND s.auth_start_date IS DISTINCT FROM a_row.auth_start_date THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'auth_start_date', a_row.auth_start_date::text, s.auth_start_date::text, applied_by_name);
      UPDATE auth_tracker SET auth_start_date = s.auth_start_date WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.auth_end_date IS NOT NULL AND s.auth_end_date IS DISTINCT FROM a_row.auth_expiry_date THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'auth_expiry_date', a_row.auth_expiry_date::text, s.auth_end_date::text, applied_by_name);
      UPDATE auth_tracker SET auth_expiry_date = s.auth_end_date WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.visits_authorized IS NOT NULL AND s.visits_authorized IS DISTINCT FROM a_row.visits_authorized THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'visits_authorized', a_row.visits_authorized::text, s.visits_authorized::text, applied_by_name);
      UPDATE auth_tracker SET visits_authorized = s.visits_authorized WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.evals_authorized IS NOT NULL AND s.evals_authorized IS DISTINCT FROM a_row.evals_authorized THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'evals_authorized', a_row.evals_authorized::text, s.evals_authorized::text, applied_by_name);
      UPDATE auth_tracker SET evals_authorized = s.evals_authorized WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.ras_authorized IS NOT NULL AND s.ras_authorized IS DISTINCT FROM a_row.reassessments_authorized THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'reassessments_authorized', a_row.reassessments_authorized::text, s.ras_authorized::text, applied_by_name);
      UPDATE auth_tracker SET reassessments_authorized = s.ras_authorized WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.is_ppo IS NOT NULL AND s.is_ppo IS DISTINCT FROM a_row.is_ppo THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'is_ppo', a_row.is_ppo::text, s.is_ppo::text, applied_by_name);
      UPDATE auth_tracker SET is_ppo = s.is_ppo WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.is_scheduled IS NOT NULL AND s.is_scheduled IS DISTINCT FROM a_row.is_scheduled THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'is_scheduled', a_row.is_scheduled::text, s.is_scheduled::text, applied_by_name);
      UPDATE auth_tracker SET is_scheduled = s.is_scheduled WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    IF s.notes IS NOT NULL AND s.notes IS DISTINCT FROM a_row.notes THEN
      INSERT INTO data_audit_log(source, table_name, row_id, patient_name, region, field_name, old_value, new_value, changed_by)
        VALUES (audit_source, 'auth_tracker', a_row.id, a_row.patient_name, a_row.region, 'notes', a_row.notes, s.notes, applied_by_name);
      UPDATE auth_tracker SET notes = s.notes WHERE id = a_row.id;
      changes_made := changes_made + 1;
    END IF;
    UPDATE auth_tracker SET updated_at = NOW(), updated_by = applied_by_name WHERE id = a_row.id;
  END IF;

  -- ── CC notes — always APPEND (never overwrite) ──────────────────────
  IF s.cc_notes IS NOT NULL THEN
    INSERT INTO care_coord_notes (patient_name, region, note_type, note, contact_date, updated_by)
      VALUES (s.patient_name, s.region, 'audit_import', s.cc_notes, COALESCE(s.changed_at::date, CURRENT_DATE), applied_by_name);
    changes_made := changes_made + 1;
  END IF;

  -- ── Mark staging row applied ────────────────────────────────────────
  UPDATE auth_audit_staging
  SET applied_at = NOW(),
      applied_by = applied_by_name,
      match_patient_id = c_row.id,
      match_auth_id = a_row.id,
      match_status = CASE WHEN c_row.id IS NULL THEN 'no_census_match' ELSE 'matched' END
  WHERE id = staging_id;

  RETURN jsonb_build_object(
    'success', true,
    'changes_made', changes_made,
    'census_matched', c_row.id IS NOT NULL,
    'auth_matched', a_row.id IS NOT NULL
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_frequency_change(p_patient_name text, p_new_frequency text, p_reviewed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  updated int;
  thresh int;
BEGIN
  SELECT CASE p_new_frequency
    WHEN '4w4'  THEN 3
    WHEN '2w4'  THEN 4
    WHEN '1w4'  THEN 10
    WHEN '1em1' THEN 30
    WHEN '1em2' THEN 60
    ELSE 9999
  END INTO thresh;

  UPDATE public.census_data
  SET inferred_frequency      = p_new_frequency,
      overdue_threshold_days  = thresh,
      frequency_locked_at     = now(),
      frequency_reviewed_by   = p_reviewed_by,
      frequency_reviewed_at   = now(),
      needs_frequency_review  = false,
      days_overdue            = GREATEST(0, COALESCE(days_since_last_visit, 0) - thresh)
  WHERE LOWER(TRIM(patient_name)) = LOWER(TRIM(p_patient_name));
  GET DIAGNOSTICS updated = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'rows_updated', updated);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_clear_freq_review_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN (
       'Discharge', 'Discharge - Change Insurance', 'Discharged',
       'Non-Admit', 'Non-admit',
       'On Hold', 'On Hold - Facility', 'On Hold - Pt Request', 'On Hold - MD Request',
       'Hospitalized', 'Waitlist'
     ) THEN
    NEW.needs_frequency_review := false;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calc_reassessment_status(last_reassessment date, next_scheduled date)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF last_reassessment IS NULL THEN RETURN 'no_data'; END IF;
  IF next_scheduled IS NOT NULL THEN RETURN 'scheduled'; END IF;
  IF (last_reassessment + 45) < CURRENT_DATE  THEN RETURN 'overdue'; END IF;
  IF (last_reassessment + 45) <= CURRENT_DATE + 7  THEN RETURN 'critical'; END IF;
  IF (last_reassessment + 45) <= CURRENT_DATE + 14 THEN RETURN 'urgent'; END IF;
  IF (last_reassessment + 30) <= CURRENT_DATE + 7  THEN RETURN 'approaching'; END IF;
  RETURN 'ok';
END; $function$
;

CREATE OR REPLACE FUNCTION public.check_coordinator_overload()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_result jsonb := '[]'::jsonb;
BEGIN
  -- Check coordinator_tasks + auth_renewal_tasks combined incomplete count
  WITH combined_incomplete AS (
    SELECT assigned_to as name,
           SUM(cnt) as incomplete_total
    FROM (
      SELECT assigned_to, COUNT(*) as cnt
      FROM coordinator_tasks WHERE status != 'completed'
      GROUP BY assigned_to
      UNION ALL
      SELECT assigned_to, COUNT(*) as cnt
      FROM auth_renewal_tasks WHERE task_status != 'completed'
      GROUP BY assigned_to
    ) sub
    GROUP BY assigned_to
  ),
  already_alerted AS (
    SELECT coordinator_name FROM coordinator_overload_alerts WHERE alert_date = v_today
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', ci.name,
    'incomplete_count', ci.incomplete_total,
    'coordinator_id', c.id,
    'email', c.email,
    'role', c.role
  )), '[]'::jsonb)
  INTO v_result
  FROM combined_incomplete ci
  JOIN coordinators c ON c.full_name = ci.name
  LEFT JOIN already_alerted aa ON aa.coordinator_name = ci.name
  WHERE ci.incomplete_total >= 30
    AND aa.coordinator_name IS NULL; -- not already alerted today

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_auth_health(p_auth_id uuid)
 RETURNS auth_health_t
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  a            auth_tracker%ROWTYPE;
  remaining    integer;
  days_left    integer;
  is_terminal  boolean;
BEGIN
  SELECT * INTO a FROM auth_tracker WHERE id = p_auth_id;
  IF NOT FOUND THEN RETURN 'ok'; END IF;

  is_terminal := a.auth_status IN ('denied','cancelled','expired','discharged');
  remaining   := GREATEST(0, COALESCE(a.visits_authorized,0) - COALESCE(a.visits_used,0));
  days_left   := CASE WHEN a.auth_expiry_date IS NOT NULL
                       THEN (a.auth_expiry_date - CURRENT_DATE)::integer
                       ELSE NULL END;

  -- Over-limit takes precedence over everything when the visit count exceeds
  IF COALESCE(a.visits_used,0) >= COALESCE(a.visits_authorized,0) AND a.visits_authorized > 0 THEN
    IF days_left IS NOT NULL AND days_left < 0 THEN
      RETURN 'exhausted';
    ELSE
      RETURN 'over_limit';
    END IF;
  END IF;

  -- low_visits beats expiring when both apply (UI shows red over amber)
  IF remaining < 7 THEN
    RETURN 'low_visits';
  END IF;

  IF days_left IS NOT NULL AND days_left <= 14 AND days_left >= 0 THEN
    RETURN 'expiring';
  END IF;

  RETURN 'ok';
END $function$
;

CREATE OR REPLACE FUNCTION public.compute_loc_level()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.caremap_score IS NULL THEN
    NEW.loc_level := NULL;
  ELSIF NEW.caremap_score <= 19 THEN
    NEW.loc_level := 1;
  ELSIF NEW.caremap_score <= 39 THEN
    NEW.loc_level := 2;
  ELSIF NEW.caremap_score <= 69 THEN
    NEW.loc_level := 3;
  ELSIF NEW.caremap_score <= 85 THEN
    NEW.loc_level := 4;
  ELSE
    NEW.loc_level := 5;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.coordinator_tasks_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.current_coordinator_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT role FROM public.coordinators
  WHERE user_id = (SELECT auth.uid()) AND is_active = true
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.find_intake_duplicates(p_name text, p_date date, p_dob date DEFAULT NULL::date, p_exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, patient_name text, date_received date, dob date, region text, insurance text, referral_status text, similarity_score real, days_apart integer, confidence text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_norm TEXT;
BEGIN
  v_norm := norm_patient_name(p_name);
  IF v_norm = '' OR p_date IS NULL THEN
    RETURN;  -- nothing to compare against
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      r.id,
      r.patient_name,
      r.date_received,
      r.dob,
      r.region,
      r.insurance,
      r.referral_status,
      similarity(r.patient_name_norm, v_norm)::real AS sim,
      ABS(r.date_received - p_date) AS days_apart,
      (p_dob IS NOT NULL AND r.dob IS NOT NULL AND r.dob = p_dob) AS dob_match
    FROM intake_referrals r
    WHERE
      (p_exclude_id IS NULL OR r.id <> p_exclude_id)
      AND (
        -- Pull anything with reasonable name overlap (trigram threshold)
        r.patient_name_norm % v_norm
        -- Or anything with matching DOB
        OR (p_dob IS NOT NULL AND r.dob = p_dob)
      )
      AND r.date_received BETWEEN (p_date - INTERVAL '90 days')::date
                              AND (p_date + INTERVAL '90 days')::date
  )
  SELECT
    c.id, c.patient_name, c.date_received, c.dob, c.region, c.insurance, c.referral_status,
    c.sim AS similarity_score,
    c.days_apart::int,
    CASE
      WHEN c.sim >= 0.95 AND c.days_apart = 0           THEN 'exact_today'
      WHEN c.sim >= 0.85 AND c.days_apart <= 7          THEN 'very_likely'
      WHEN c.sim >= 0.70 AND c.days_apart <= 30         THEN 'possible'
      WHEN c.dob_match                                  THEN 'dob_match'
      WHEN c.sim >= 0.60                                THEN 'possible'
      ELSE 'low'
    END AS confidence
  FROM candidates c
  WHERE
    c.sim >= 0.60
    OR c.dob_match
  ORDER BY
    -- Surface most-likely-dup first
    CASE
      WHEN c.sim >= 0.95 AND c.days_apart = 0     THEN 1
      WHEN c.sim >= 0.85 AND c.days_apart <= 7    THEN 2
      WHEN c.dob_match                            THEN 3
      WHEN c.sim >= 0.70 AND c.days_apart <= 30   THEN 4
      ELSE 5
    END,
    c.sim DESC,
    c.days_apart ASC
  LIMIT 10;
END $function$
;

CREATE OR REPLACE FUNCTION public.fire_auth_health_alerts(p_auth_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  a auth_tracker%ROWTYPE;
  remaining int;
  days_left int;
  is_active boolean;
BEGIN
  SELECT * INTO a FROM auth_tracker WHERE id = p_auth_id;
  IF NOT FOUND THEN RETURN; END IF;

  is_active := COALESCE(a.is_currently_active, TRUE);
  remaining := GREATEST(0, COALESCE(a.visits_authorized,0) - COALESCE(a.visits_used,0));
  days_left := CASE WHEN a.auth_expiry_date IS NOT NULL
                     THEN (a.auth_expiry_date - CURRENT_DATE)::int
                     ELSE NULL END;

  -- OVER_LIMIT — fires for ANY auth in over_limit state, active or not
  IF a.auth_health = 'over_limit' THEN
    INSERT INTO alerts (alert_type, priority, title, message, patient_name, region, related_date, metadata)
    SELECT 'auth_over_limit', 'critical',
           'Auth over limit: ' || a.patient_name,
           'Auth #' || a.id || ' (' || a.insurance || ', ' || a.visits_authorized || ' authorized)' ||
           ' has ' || a.visits_used || ' completed visits — ' ||
           (a.visits_used - a.visits_authorized) || ' beyond the auth.' ||
           CASE WHEN a.auth_expiry_date IS NOT NULL THEN ' Expires ' || a.auth_expiry_date ELSE '' END ||
           CASE WHEN is_active THEN ' Submit emergency renewal.'
                ELSE ' (Historical predecessor auth — verify billing reconciliation.)' END,
           a.patient_name, a.region, a.auth_expiry_date,
           jsonb_build_object('auth_id', a.id, 'visits_authorized', a.visits_authorized,
                              'visits_used', a.visits_used,
                              'overage', a.visits_used - a.visits_authorized,
                              'is_currently_active', is_active,
                              'auth_expiry_date', a.auth_expiry_date)
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts
      WHERE alert_type='auth_over_limit' AND is_dismissed=FALSE
        AND (metadata->>'auth_id')::uuid = a.id
    );
  END IF;

  -- LOW_VISITS — only on currently_active auths (predictive operational alert)
  IF a.auth_health = 'low_visits' AND is_active THEN
    INSERT INTO alerts (alert_type, priority, title, message, patient_name, region, related_date, metadata)
    SELECT 'auth_low_visits', 'high',
           'Low visits remaining: ' || a.patient_name,
           a.patient_name || ' has ' || remaining || ' visit' ||
           CASE WHEN remaining=1 THEN '' ELSE 's' END ||
           ' remaining on auth #' || a.id || ' (' || a.insurance || ').' ||
           CASE WHEN a.auth_expiry_date IS NOT NULL THEN ' Expires ' || a.auth_expiry_date || '.' ELSE '' END ||
           ' Submit renewal soon.',
           a.patient_name, a.region, a.auth_expiry_date,
           jsonb_build_object('auth_id', a.id, 'visits_authorized', a.visits_authorized,
                              'visits_used', a.visits_used, 'remaining', remaining,
                              'auth_expiry_date', a.auth_expiry_date)
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts
      WHERE alert_type='auth_low_visits' AND is_dismissed=FALSE
        AND (metadata->>'auth_id')::uuid = a.id
    );
  END IF;

  -- EXPIRING — only on currently_active, fires INDEPENDENTLY of low_visits
  IF is_active AND (a.auth_health = 'expiring' 
                    OR (a.auth_health = 'low_visits' AND days_left BETWEEN 0 AND 14)) THEN
    INSERT INTO alerts (alert_type, priority, title, message, patient_name, region, related_date, metadata)
    SELECT 'auth_expiring', 'medium',
           'Auth expiring: ' || a.patient_name,
           'Auth #' || a.id || ' expires in ' || days_left || ' day' ||
           CASE WHEN days_left=1 THEN '' ELSE 's' END ||
           ' (' || a.auth_expiry_date || '). ' || remaining || ' visit' ||
           CASE WHEN remaining=1 THEN '' ELSE 's' END || ' remaining.',
           a.patient_name, a.region, a.auth_expiry_date,
           jsonb_build_object('auth_id', a.id, 'days_until_expiry', days_left,
                              'auth_expiry_date', a.auth_expiry_date, 'remaining', remaining)
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts
      WHERE alert_type='auth_expiring' AND is_dismissed=FALSE
        AND (metadata->>'auth_id')::uuid = a.id
    );
  END IF;

  -- Auto-dismiss when recovered
  IF a.auth_health = 'ok' THEN
    UPDATE alerts SET is_dismissed=TRUE, updated_at=now()
    WHERE is_dismissed=FALSE
      AND alert_type IN ('auth_over_limit','auth_low_visits','auth_expiring')
      AND (metadata->>'auth_id')::uuid = a.id;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_log_care_coord_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_name text;
  v_role text;
BEGIN
  SELECT full_name, role INTO v_name, v_role FROM coordinators WHERE id = NEW.coordinator_id;
  INSERT INTO coordinator_activity_log (
    coordinator_id, coordinator_name, coordinator_role,
    action_type, action_detail, patient_name, table_name, record_id
  ) VALUES (
    NEW.coordinator_id, COALESCE(v_name, 'Unknown'), COALESCE(v_role, 'care_coordinator'),
    'note_added',
    'Care coord note added (' || COALESCE(NEW.note_type, 'general') || ') for ' || COALESCE(NEW.patient_name, '—'),
    NEW.patient_name, 'care_coord_notes', NEW.id
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_log_coordinator_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_actor_name text;
  v_actor_id uuid;
  v_actor_role text;
  v_action_type text;
  v_action_detail text;
  v_patient text;
BEGIN
  -- ═══ AUTH TRACKER ═══
  IF TG_TABLE_NAME = 'auth_tracker' THEN
    v_patient := COALESCE(NEW.patient_name, OLD.patient_name);
    v_actor_name := COALESCE(NEW.updated_by, NEW.assigned_to, 'System');
    
    IF TG_OP = 'INSERT' THEN
      v_action_type := 'auth_created';
      v_action_detail := 'New auth record created for ' || v_patient || ' — ' || COALESCE(NEW.insurance, 'Unknown') || ', status: ' || COALESCE(NEW.auth_status, 'pending');
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.auth_status IS DISTINCT FROM NEW.auth_status THEN
        v_action_type := 'auth_status_changed';
        v_action_detail := 'Auth status changed: ' || COALESCE(OLD.auth_status, '—') || ' → ' || COALESCE(NEW.auth_status, '—') || ' for ' || v_patient;
      ELSIF OLD.visits_used IS DISTINCT FROM NEW.visits_used THEN
        v_action_type := 'auth_visits_updated';
        v_action_detail := 'Visits updated: ' || COALESCE(OLD.visits_used::text, '0') || ' → ' || COALESCE(NEW.visits_used::text, '0') || ' of ' || COALESCE(NEW.visits_authorized::text, '?') || ' for ' || v_patient;
      ELSE
        v_action_type := 'auth_updated';
        v_action_detail := 'Auth record updated for ' || v_patient;
      END IF;
    END IF;

  -- ═══ INTAKE REFERRALS ═══
  ELSIF TG_TABLE_NAME = 'intake_referrals' THEN
    v_patient := COALESCE(NEW.patient_name, OLD.patient_name);
    v_actor_name := COALESCE(NEW.updated_by, 'System');
    
    IF TG_OP = 'INSERT' THEN
      v_action_type := 'referral_received';
      v_action_detail := 'New referral received for ' || v_patient || ' — ' || COALESCE(NEW.insurance, 'Unknown');
    ELSIF TG_OP = 'UPDATE' AND OLD.referral_status IS DISTINCT FROM NEW.referral_status THEN
      v_action_type := 'referral_' || lower(COALESCE(NEW.referral_status, 'updated'));
      v_action_detail := 'Referral status: ' || COALESCE(OLD.referral_status, '—') || ' → ' || COALESCE(NEW.referral_status, '—') || ' for ' || v_patient;
    ELSIF TG_OP = 'UPDATE' AND OLD.chart_status IS DISTINCT FROM NEW.chart_status THEN
      v_action_type := 'chart_status_changed';
      v_action_detail := 'Chart status: ' || COALESCE(OLD.chart_status, '—') || ' → ' || COALESCE(NEW.chart_status, '—') || ' for ' || v_patient;
    ELSE
      v_action_type := 'referral_updated';
      v_action_detail := 'Referral updated for ' || v_patient;
    END IF;

  -- ═══ COORDINATOR TASKS ═══
  ELSIF TG_TABLE_NAME = 'coordinator_tasks' THEN
    v_patient := COALESCE(NEW.patient_name, OLD.patient_name);
    v_actor_name := COALESCE(NEW.completed_by, NEW.assigned_to, 'System');
    
    IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed' THEN
      v_action_type := 'task_completed';
      v_action_detail := 'Task completed: ' || COALESCE(NEW.title, NEW.task_type, 'untitled') || ' for ' || COALESCE(v_patient, '—');
    ELSIF TG_OP = 'INSERT' THEN
      v_action_type := 'task_created';
      v_action_detail := 'Task created: ' || COALESCE(NEW.title, NEW.task_type, 'untitled') || ' assigned to ' || COALESCE(NEW.assigned_to, '—');
    ELSE
      v_action_type := 'task_updated';
      v_action_detail := 'Task updated: ' || COALESCE(NEW.title, NEW.task_type, 'untitled');
    END IF;

  -- ═══ AUTH RENEWAL TASKS ═══
  ELSIF TG_TABLE_NAME = 'auth_renewal_tasks' THEN
    v_patient := COALESCE(NEW.patient_name, OLD.patient_name);
    v_actor_name := COALESCE(NEW.completed_by, NEW.assigned_to, 'System');
    
    IF TG_OP = 'UPDATE' AND NEW.task_status = 'completed' AND OLD.task_status != 'completed' THEN
      v_action_type := 'renewal_completed';
      v_action_detail := 'Auth renewal completed for ' || v_patient || ' — ' || COALESCE(NEW.insurance, '');
    ELSE
      v_action_type := 'renewal_updated';
      v_action_detail := 'Auth renewal updated for ' || v_patient;
    END IF;

  -- ═══ PATIENT DISCHARGES ═══
  ELSIF TG_TABLE_NAME = 'patient_discharges' THEN
    v_patient := COALESCE(NEW.patient_name, OLD.patient_name);
    v_actor_name := COALESCE(NEW.discharged_by, NEW.updated_by, 'System');
    v_action_type := 'discharge_processed';
    v_action_detail := 'Discharge processed for ' || v_patient;

  -- ═══ ON HOLD RECOVERY ═══
  ELSIF TG_TABLE_NAME = 'on_hold_recovery' THEN
    v_patient := COALESCE(NEW.patient_name, OLD.patient_name);
    v_actor_name := COALESCE(NEW.updated_by, 'System');
    IF TG_OP = 'UPDATE' AND OLD.recovery_status IS DISTINCT FROM NEW.recovery_status THEN
      v_action_type := 'onhold_status_changed';
      v_action_detail := 'On-hold status: ' || COALESCE(OLD.recovery_status, '—') || ' → ' || COALESCE(NEW.recovery_status, '—') || ' for ' || v_patient;
    ELSIF TG_OP = 'UPDATE' THEN
      v_action_type := 'onhold_updated';
      v_action_detail := 'On-hold record updated for ' || v_patient;
    END IF;

  -- ═══ WAITLIST ASSIGNMENTS ═══
  ELSIF TG_TABLE_NAME = 'waitlist_assignments' THEN
    v_patient := COALESCE(NEW.patient_name, OLD.patient_name);
    v_actor_name := COALESCE(NEW.assigned_by, NEW.updated_by, 'System');
    v_action_type := CASE WHEN TG_OP = 'INSERT' THEN 'waitlist_assigned' ELSE 'waitlist_updated' END;
    v_action_detail := CASE WHEN TG_OP = 'INSERT' 
      THEN 'Patient added to waitlist: ' || v_patient
      ELSE 'Waitlist updated for ' || v_patient END;
  END IF;

  -- Skip if no action type was set (unchanged row)
  IF v_action_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up coordinator
  SELECT id, role INTO v_actor_id, v_actor_role
  FROM coordinators WHERE full_name = v_actor_name LIMIT 1;

  INSERT INTO coordinator_activity_log (
    coordinator_id, coordinator_name, coordinator_role,
    action_type, action_detail, patient_name, table_name, record_id
  ) VALUES (
    v_actor_id, v_actor_name, COALESCE(v_actor_role, 'unknown'),
    v_action_type, v_action_detail, v_patient, TG_TABLE_NAME, NEW.id
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_log_patient_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_coord_id uuid;
  v_role text;
BEGIN
  SELECT id, role INTO v_coord_id, v_role FROM coordinators WHERE full_name = NEW.author_name LIMIT 1;
  INSERT INTO coordinator_activity_log (
    coordinator_id, coordinator_name, coordinator_role,
    action_type, action_detail, patient_name, table_name, record_id
  ) VALUES (
    v_coord_id, COALESCE(NEW.author_name, 'Unknown'), COALESCE(v_role, 'unknown'),
    'chart_note_added',
    'Chart note added for ' || COALESCE(NEW.patient_name, '—'),
    NEW.patient_name, 'patient_notes', NEW.id
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_daily_ops_report(p_report_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_result jsonb;
BEGIN

  -- ═══ AUTH COORDINATOR SUMMARY ═══
  WITH auth_open AS (
    SELECT assigned_to,
           COUNT(*) as total_open,
           COUNT(*) FILTER (WHERE priority = 'urgent' OR priority = 'high') as urgent,
           COUNT(*) FILTER (WHERE due_date <= v_today) as overdue,
           COUNT(*) FILTER (WHERE due_date = v_today) as due_today
    FROM coordinator_tasks
    WHERE status != 'completed' AND task_type ILIKE '%auth%'
    GROUP BY assigned_to
  ),
  auth_completed_today AS (
    SELECT completed_by as name, COUNT(*) as done_today
    FROM coordinator_tasks
    WHERE status = 'completed' AND completed_at::date = v_today AND task_type ILIKE '%auth%'
    GROUP BY completed_by
  ),
  auth_renewal_open AS (
    SELECT assigned_to,
           COUNT(*) as total_open,
           COUNT(*) FILTER (WHERE priority = 'urgent' OR priority = 'high') as urgent,
           COUNT(*) FILTER (WHERE due_date <= v_today) as overdue
    FROM auth_renewal_tasks
    WHERE task_status != 'completed'
    GROUP BY assigned_to
  ),
  auth_renewal_done AS (
    SELECT completed_by as name, COUNT(*) as done_today
    FROM auth_renewal_tasks
    WHERE task_status = 'completed' AND completed_at::date = v_today
    GROUP BY completed_by
  ),
  auth_updates AS (
    SELECT updated_by as name, COUNT(*) as updates_today
    FROM auth_tracker
    WHERE updated_at::date = v_today AND updated_by IS NOT NULL
    GROUP BY updated_by
  ),

  -- ═══ INTAKE COORDINATOR SUMMARY ═══
  intake_updates AS (
    SELECT updated_by as name,
           COUNT(*) as total_updated,
           COUNT(*) FILTER (WHERE referral_status = 'Accepted') as accepted,
           COUNT(*) FILTER (WHERE referral_status = 'Denied') as denied,
           COUNT(*) FILTER (WHERE referral_status = 'Pending') as still_pending
    FROM intake_referrals
    WHERE updated_at::date = v_today AND updated_by IS NOT NULL
    GROUP BY updated_by
  ),
  intake_pending AS (
    SELECT COUNT(*) as total_pending,
           COUNT(*) FILTER (WHERE created_at::date = v_today) as new_today
    FROM intake_referrals
    WHERE referral_status = 'Pending'
  ),

  -- ═══ CARE COORDINATOR SUMMARY ═══
  care_notes_today AS (
    SELECT c.full_name as name, COUNT(*) as notes_added
    FROM care_coord_notes cn
    JOIN coordinators c ON c.id = cn.coordinator_id
    WHERE cn.created_at::date = v_today
    GROUP BY c.full_name
  ),
  care_chart_notes AS (
    SELECT author_name as name, COUNT(*) as chart_notes
    FROM patient_notes
    WHERE created_at::date = v_today
    GROUP BY author_name
  ),
  discharge_today AS (
    SELECT discharged_by as name, COUNT(*) as discharges
    FROM patient_discharges
    WHERE created_at::date = v_today AND discharged_by IS NOT NULL
    GROUP BY discharged_by
  ),
  onhold_today AS (
    SELECT c.full_name as name, COUNT(*) as onhold_updates
    FROM on_hold_recovery oh
    JOIN coordinators c ON c.id = oh.coordinator_id
    WHERE oh.updated_at::date = v_today
    GROUP BY c.full_name
  ),
  all_coord_tasks AS (
    SELECT assigned_to,
           COUNT(*) as total_assigned,
           COUNT(*) FILTER (WHERE status = 'completed') as completed,
           COUNT(*) FILTER (WHERE status != 'completed') as incomplete,
           COUNT(*) FILTER (WHERE status != 'completed' AND due_date <= v_today) as overdue
    FROM coordinator_tasks
    GROUP BY assigned_to
  ),

  -- ═══ LAST ACTIVITY per coordinator (for inactivity tracking) ═══
  last_activity AS (
    SELECT coordinator_name,
           MAX(created_at) as last_action_at,
           COUNT(*) FILTER (WHERE created_at::date = v_today) as actions_today
    FROM coordinator_activity_log
    GROUP BY coordinator_name
  )

  SELECT jsonb_build_object(
    'report_type', p_report_type,
    'report_date', v_today,
    'generated_at', now(),

    'auth_coordinators', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', c.full_name,
        'role', 'Auth Coordinator',
        'tasks_open', COALESCE(ao.total_open,0) + COALESCE(aro.total_open,0),
        'tasks_urgent', COALESCE(ao.urgent,0) + COALESCE(aro.urgent,0),
        'tasks_overdue', COALESCE(ao.overdue,0) + COALESCE(aro.overdue,0),
        'tasks_due_today', COALESCE(ao.due_today,0),
        'completed_today', COALESCE(acd.done_today,0) + COALESCE(ard.done_today,0),
        'auth_records_updated', COALESCE(au.updates_today,0),
        'renewal_tasks_open', COALESCE(aro.total_open,0),
        'actions_today', COALESCE(la.actions_today,0),
        'last_activity_at', la.last_action_at,
        'is_inactive', COALESCE(la.actions_today,0) = 0
      ) ORDER BY COALESCE(la.actions_today,0) ASC, c.full_name), '[]'::jsonb)
      FROM coordinators c
      LEFT JOIN auth_open ao ON ao.assigned_to = c.full_name
      LEFT JOIN auth_completed_today acd ON acd.name = c.full_name
      LEFT JOIN auth_renewal_open aro ON aro.assigned_to = c.full_name
      LEFT JOIN auth_renewal_done ard ON ard.name = c.full_name
      LEFT JOIN auth_updates au ON au.name = c.full_name
      LEFT JOIN last_activity la ON la.coordinator_name = c.full_name
      WHERE c.role = 'auth_coordinator' AND c.is_active = true
    ),

    'intake_coordinators', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', c.full_name,
        'role', 'Intake Coordinator',
        'referrals_updated_today', COALESCE(iu.total_updated,0),
        'accepted_today', COALESCE(iu.accepted,0),
        'denied_today', COALESCE(iu.denied,0),
        'still_pending', COALESCE(iu.still_pending,0),
        'actions_today', COALESCE(la.actions_today,0),
        'last_activity_at', la.last_action_at,
        'is_inactive', COALESCE(la.actions_today,0) = 0
      ) ORDER BY COALESCE(la.actions_today,0) ASC, c.full_name), '[]'::jsonb)
      FROM coordinators c
      LEFT JOIN intake_updates iu ON iu.name = c.full_name
      LEFT JOIN last_activity la ON la.coordinator_name = c.full_name
      WHERE c.role = 'intake_coordinator' AND c.is_active = true
    ),

    'care_coordinators', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', c.full_name,
        'role', 'Care Coordinator',
        'coord_notes_today', COALESCE(cnt.notes_added,0),
        'chart_notes_today', COALESCE(ccn.chart_notes,0),
        'discharges_today', COALESCE(dt.discharges,0),
        'onhold_updates_today', COALESCE(oht.onhold_updates,0),
        'tasks_open', COALESCE(act.incomplete,0),
        'tasks_overdue', COALESCE(act.overdue,0),
        'completed_today', COALESCE(act.completed,0),
        'actions_today', COALESCE(la.actions_today,0),
        'last_activity_at', la.last_action_at,
        'is_inactive', COALESCE(la.actions_today,0) = 0
      ) ORDER BY COALESCE(la.actions_today,0) ASC, c.full_name), '[]'::jsonb)
      FROM coordinators c
      LEFT JOIN care_notes_today cnt ON cnt.name = c.full_name
      LEFT JOIN care_chart_notes ccn ON ccn.name = c.full_name
      LEFT JOIN discharge_today dt ON dt.name = c.full_name
      LEFT JOIN onhold_today oht ON oht.name = c.full_name
      LEFT JOIN all_coord_tasks act ON act.assigned_to = c.full_name
      LEFT JOIN last_activity la ON la.coordinator_name = c.full_name
      WHERE c.role = 'care_coordinator' AND c.is_active = true
    ),

    -- Pod leaders tracked separately
    'pod_leaders', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', c.full_name,
        'role', 'Pod Leader',
        'actions_today', COALESCE(la.actions_today,0),
        'last_activity_at', la.last_action_at,
        'chart_notes_today', COALESCE(ccn.chart_notes,0),
        'is_inactive', COALESCE(la.actions_today,0) = 0
      ) ORDER BY COALESCE(la.actions_today,0) ASC, c.full_name), '[]'::jsonb)
      FROM coordinators c
      LEFT JOIN last_activity la ON la.coordinator_name = c.full_name
      LEFT JOIN care_chart_notes ccn ON ccn.name = c.full_name
      WHERE c.role = 'pod_leader' AND c.is_active = true
    ),

    'intake_pipeline', (SELECT row_to_json(ip)::jsonb FROM intake_pending ip),

    -- ═══ INACTIVITY ALERT: coordinators with ZERO actions today ═══
    'inactive_coordinators', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', c.full_name,
        'role', c.role,
        'role_label', CASE c.role
          WHEN 'auth_coordinator' THEN 'Auth Coordinator'
          WHEN 'intake_coordinator' THEN 'Intake Coordinator'
          WHEN 'care_coordinator' THEN 'Care Coordinator'
          WHEN 'pod_leader' THEN 'Pod Leader'
          ELSE c.role
        END,
        'last_activity_at', la.last_action_at,
        'days_since_activity', CASE
          WHEN la.last_action_at IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM now() - la.last_action_at)::int
        END,
        'never_logged_in', la.last_action_at IS NULL
      ) ORDER BY
        CASE WHEN la.last_action_at IS NULL THEN 0 ELSE 1 END,
        COALESCE(la.last_action_at, '1970-01-01'::timestamptz) ASC
      ), '[]'::jsonb)
      FROM coordinators c
      LEFT JOIN last_activity la ON la.coordinator_name = c.full_name
      WHERE c.role IN ('auth_coordinator','intake_coordinator','care_coordinator','pod_leader')
        AND c.is_active = true
        AND COALESCE(la.actions_today, 0) = 0
    ),

    'overload_coordinators', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', act.assigned_to,
        'incomplete', act.incomplete,
        'overdue', act.overdue
      )), '[]'::jsonb)
      FROM all_coord_tasks act
      WHERE act.incomplete >= 30
    ),

    'activity_log_today', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'coordinator', cal.coordinator_name,
        'action', cal.action_type,
        'detail', cal.action_detail,
        'patient', cal.patient_name,
        'time', cal.created_at
      ) ORDER BY cal.created_at DESC), '[]'::jsonb)
      FROM coordinator_activity_log cal
      WHERE cal.created_at::date = v_today
    )

  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_auth_user(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE caller_role text; u record;
BEGIN
  SELECT role INTO caller_role FROM public.coordinators WHERE user_id = auth.uid();
  IF caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;
  SELECT id, email, email_confirmed_at, last_sign_in_at, created_at INTO u FROM auth.users WHERE id = target_user_id;
  RETURN jsonb_build_object('id', u.id, 'email', u.email, 'email_confirmed', u.email_confirmed_at IS NOT NULL, 'last_sign_in', u.last_sign_in_at, 'created_at', u.created_at);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_coordinator_engagement()
 RETURNS SETOF v_coordinator_engagement
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM coordinators WHERE user_id = auth.uid();
  IF caller_role NOT IN ('super_admin','admin','director','ceo','assoc_director') THEN
    -- Non-admins get nothing — silently empty for safety
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM v_coordinator_engagement;
END $function$
;

CREATE OR REPLACE FUNCTION public.infer_visit_frequency(p_patient_name text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.visit_schedule_data
  WHERE LOWER(TRIM(patient_name)) = LOWER(TRIM(p_patient_name))
    AND status ILIKE '%completed%'
    AND visit_date >= CURRENT_DATE - 60;
  RETURN CASE
    WHEN v_count >= 32 THEN '4x_week'  WHEN v_count >= 20 THEN '3x_week'
    WHEN v_count >= 12 THEN '2x_week'  WHEN v_count >= 6  THEN '1x_week'
    WHEN v_count >= 3  THEN '2x_month' WHEN v_count >= 1  THEN '1x_month'
    ELSE 'prn'
  END;
END; $function$
;

CREATE OR REPLACE FUNCTION public.is_active_coordinator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.coordinators
    WHERE user_id = (SELECT auth.uid()) AND is_active = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.coordinators
    WHERE user_id = (SELECT auth.uid())
      AND is_active = true
      AND role IN ('super_admin', 'admin', 'ceo')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin_or_above()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.coordinators
    WHERE user_id = (SELECT auth.uid())
      AND is_active = true
      AND role IN ('super_admin','admin','ceo','assoc_director')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.coordinators
    WHERE user_id = (SELECT auth.uid())
      AND is_active = true
      AND role = 'super_admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.mark_expired_auths()
 RETURNS TABLE(rows_updated integer, affected_patients text[])
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
  v_patients text[];
BEGIN
  -- Capture distinct patient names BEFORE update (we'll re-sequence them after)
  SELECT ARRAY_AGG(DISTINCT patient_name)
  INTO v_patients
  FROM public.auth_tracker
  WHERE auth_expiry_date IS NOT NULL
    AND auth_expiry_date < CURRENT_DATE
    AND (auth_status NOT IN ('expired','denied','cancelled') OR is_currently_active = true);

  WITH upd AS (
    UPDATE public.auth_tracker
    SET auth_status = 'expired',
        is_currently_active = false,
        effective_visits_remaining = 0,
        updated_at = now()
    WHERE auth_expiry_date IS NOT NULL
      AND auth_expiry_date < CURRENT_DATE
      AND (auth_status NOT IN ('expired','denied','cancelled') OR is_currently_active = true)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  -- Re-sequence each affected patient so any successor auths properly activate
  IF v_patients IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_patients,1) LOOP
      PERFORM public.recompute_auth_sequence(v_patients[i]);
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_count, COALESCE(v_patients, ARRAY[]::text[]);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.norm_patient_name(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT LOWER(REGEXP_REPLACE(COALESCE(input, ''), '[^a-zA-Z0-9]', '', 'g'));
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_pariox_name(pariox_name text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  parts text[];
  last_name text;
  first_name text;
BEGIN
  IF pariox_name IS NULL OR pariox_name = '' THEN RETURN NULL; END IF;
  -- Already "FirstName LastName" format (no comma)
  IF POSITION(',' IN pariox_name) = 0 THEN RETURN TRIM(pariox_name); END IF;
  parts := STRING_TO_ARRAY(pariox_name, ',');
  last_name  := TRIM(parts[1]);
  first_name := TRIM(parts[2]);
  RETURN first_name || ' ' || last_name;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pca_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.recompute_auth_sequence(p_patient_name text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  rec RECORD;
  prev_id uuid := NULL;
  prev_visits_auth integer := 0;
  prev_visits_used integer := 0;
  seq integer := 1;
  today_d date := CURRENT_DATE;
BEGIN
  FOR rec IN
    SELECT id, visits_authorized, visits_used,
           soc_date, auth_approved_date, auth_expiry_date, auth_status
    FROM public.auth_tracker
    WHERE LOWER(TRIM(patient_name)) = LOWER(TRIM(p_patient_name))
      AND auth_status NOT IN ('denied','cancelled','expired')
    ORDER BY COALESCE(soc_date, auth_approved_date, created_at) ASC
  LOOP
    DECLARE
      pred_exhausted boolean := (prev_id IS NULL OR prev_visits_used >= prev_visits_auth);
      visits_remaining integer := GREATEST(0, rec.visits_authorized - rec.visits_used);
      self_exhausted boolean := (rec.visits_used >= rec.visits_authorized);
      self_expired boolean := (rec.auth_expiry_date IS NOT NULL AND rec.auth_expiry_date < today_d);
      should_be_active boolean := pred_exhausted AND NOT self_exhausted AND NOT self_expired;
    BEGIN
      UPDATE public.auth_tracker SET
        auth_sequence            = seq,
        predecessor_auth_id      = prev_id,
        is_currently_active      = should_be_active,
        alert_predecessor_pending = (prev_id IS NOT NULL AND NOT pred_exhausted),
        effective_visits_remaining = CASE WHEN should_be_active THEN visits_remaining ELSE 0 END,
        request_category         = CASE WHEN seq = 1 THEN 'initial' ELSE 'renewal' END,
        updated_at               = now()
      WHERE id = rec.id;

      prev_id          := rec.id;
      prev_visits_auth := rec.visits_authorized;
      prev_visits_used := rec.visits_used;
      seq              := seq + 1;
    END;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_last_visit_dates()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.recompute_patient_status_fields();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_patient_status_fields()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  census_nulled int;
  master_nulled int;
  census_updated int;
  master_updated int;
  drift_flagged int;
BEGIN
  UPDATE public.census_data
  SET last_visit_date = NULL, last_visit_clinician = NULL, days_since_last_visit = NULL
  WHERE last_visit_date IS NOT NULL AND last_visit_date > current_date;
  GET DIAGNOSTICS census_nulled = ROW_COUNT;

  UPDATE public.patient_master
  SET last_visit_date = NULL, last_visit_clinician = NULL, days_since_last_visit = NULL
  WHERE last_visit_date IS NOT NULL AND last_visit_date > current_date;
  GET DIAGNOSTICS master_nulled = ROW_COUNT;

  CREATE TEMP TABLE _real_visits ON COMMIT DROP AS
  SELECT
    LOWER(TRIM(v.patient_name)) AS patient_key,
    v.visit_date::date AS visit_date,
    v.staff_name_normalized,
    c.discipline,
    c.is_telehealth
  FROM public.visit_schedule_data v
  LEFT JOIN public.clinicians c
    ON LOWER(TRIM(c.full_name)) = LOWER(TRIM(v.staff_name_normalized))
    OR LOWER(TRIM(c.pariox_name)) = LOWER(TRIM(v.staff_name_normalized))
  WHERE v.visit_date IS NOT NULL
    AND v.patient_name IS NOT NULL
    AND v.visit_date::date <= current_date
    AND (v.event_type IS NULL OR (
           v.event_type NOT ILIKE '%cancel%'
       AND v.event_type NOT ILIKE '%attempt%'
       AND v.event_type NOT ILIKE '%missed%'
       AND v.event_type NOT ILIKE '%no show%'
       AND v.event_type NOT ILIKE '%no-show%'))
    AND (v.status IS NULL OR v.status NOT ILIKE '%cancel%');

  CREATE TEMP TABLE _latest_visits ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      patient_key, visit_date, staff_name_normalized,
      ROW_NUMBER() OVER (
        PARTITION BY patient_key
        ORDER BY visit_date DESC NULLS LAST,
                 CASE
                   WHEN discipline IN ('PTA','COTA') THEN 1
                   WHEN discipline IN ('PT','OT') AND is_telehealth = false THEN 2
                   WHEN discipline IN ('PT','OT') AND is_telehealth = true  THEN 3
                   ELSE 4
                 END ASC
      ) AS rn
    FROM _real_visits
  )
  SELECT patient_key, visit_date AS last_visit_date, staff_name_normalized AS last_visit_clinician
  FROM ranked WHERE rn = 1;

  CREATE TEMP TABLE _cadence ON COMMIT DROP AS
  SELECT
    patient_key,
    count(*) AS visits_60d,
    CASE
      WHEN count(*) >= 30 THEN '4w4'
      WHEN count(*) >= 13 THEN '2w4'
      WHEN count(*) >= 6  THEN '1w4'
      WHEN count(*) >= 2  THEN '1em1'
      WHEN count(*) = 1   THEN '1em2'
      ELSE 'prn'
    END AS current_cadence
  FROM _real_visits
  WHERE visit_date >= current_date - 60
  GROUP BY patient_key;

  -- Threshold map
  CREATE TEMP TABLE _threshold_map ON COMMIT DROP AS
  SELECT 'prn'::text AS freq, 9999 AS days UNION ALL
  SELECT '1em2',60 UNION ALL SELECT '1em1',30 UNION ALL
  SELECT '1w4',10 UNION ALL SELECT '2w4',4 UNION ALL SELECT '4w4',3;

  UPDATE public.census_data c
  SET
    last_visit_date      = l.last_visit_date,
    last_visit_clinician = COALESCE(l.last_visit_clinician, c.last_visit_clinician),
    days_since_last_visit = (current_date - l.last_visit_date),
    -- current cadence always refreshed
    current_visit_cadence = COALESCE(cd.current_cadence, 'prn'),
    -- inferred_frequency: only fill if unlocked (first-time / cleared)
    inferred_frequency = CASE
      WHEN c.frequency_locked_at IS NULL THEN COALESCE(cd.current_cadence, 'prn')
      ELSE c.inferred_frequency
    END,
    frequency_locked_at = CASE
      WHEN c.frequency_locked_at IS NULL AND cd.current_cadence IS NOT NULL THEN now()
      ELSE c.frequency_locked_at
    END,
    -- Needs review when live cadence differs from prescribed (ignore prn↔prn)
    needs_frequency_review = (
      COALESCE(cd.current_cadence, 'prn') IS DISTINCT FROM
      COALESCE(
        CASE WHEN c.frequency_locked_at IS NULL THEN cd.current_cadence ELSE c.inferred_frequency END,
        'prn'
      )
    ),
    -- Threshold always follows the PRESCRIBED (inferred_frequency), not live cadence
    overdue_threshold_days = (
      SELECT days FROM _threshold_map
      WHERE freq = COALESCE(
        CASE WHEN c.frequency_locked_at IS NULL THEN cd.current_cadence ELSE c.inferred_frequency END,
        'prn'
      )
    ),
    days_overdue = GREATEST(
      0,
      (current_date - l.last_visit_date) -
      (SELECT days FROM _threshold_map
       WHERE freq = COALESCE(
         CASE WHEN c.frequency_locked_at IS NULL THEN cd.current_cadence ELSE c.inferred_frequency END,
         'prn'
       ))
    )
  FROM _latest_visits l
  LEFT JOIN _cadence cd ON cd.patient_key = l.patient_key
  WHERE LOWER(TRIM(c.patient_name)) = l.patient_key;
  GET DIAGNOSTICS census_updated = ROW_COUNT;

  -- Patients with no visits → harmless prn baseline
  UPDATE public.census_data
  SET current_visit_cadence     = 'prn',
      inferred_frequency        = COALESCE(inferred_frequency, 'prn'),
      overdue_threshold_days    = 9999,
      days_overdue              = 0,
      needs_frequency_review    = false
  WHERE NOT EXISTS (
    SELECT 1 FROM _latest_visits l WHERE l.patient_key = LOWER(TRIM(public.census_data.patient_name))
  );

  UPDATE public.patient_master p
  SET last_visit_date = l.last_visit_date,
      last_visit_clinician = COALESCE(l.last_visit_clinician, p.last_visit_clinician),
      days_since_last_visit = (current_date - l.last_visit_date)
  FROM _latest_visits l
  WHERE LOWER(TRIM(p.patient_name)) = l.patient_key;
  GET DIAGNOSTICS master_updated = ROW_COUNT;

  SELECT count(*) INTO drift_flagged FROM public.census_data WHERE needs_frequency_review = true;

  RETURN jsonb_build_object(
    'success', true,
    'census_future_nulled', census_nulled,
    'master_future_nulled', master_nulled,
    'census_rows_updated', census_updated,
    'patient_master_rows_updated', master_updated,
    'drift_flagged_for_review', drift_flagged,
    'computed_at', now()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.revert_audit_change(audit_log_id uuid, reverted_by_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  log_row data_audit_log%ROWTYPE;
  sql_stmt TEXT;
BEGIN
  SELECT * INTO log_row FROM data_audit_log WHERE id = audit_log_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'log row not found'); END IF;
  IF log_row.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already reverted', 'reverted_at', log_row.reverted_at);
  END IF;
  IF log_row.field_name LIKE '\_%' THEN
    RETURN jsonb_build_object('error', 'creation events cannot be reverted via this function');
  END IF;

  -- Build dynamic SQL to restore old value
  sql_stmt := format('UPDATE %I SET %I = $1 WHERE id = $2', log_row.table_name, log_row.field_name);
  EXECUTE sql_stmt USING log_row.old_value, log_row.row_id;
  UPDATE data_audit_log SET reverted_at = NOW(), reverted_by = reverted_by_name WHERE id = audit_log_id;
  RETURN jsonb_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_auth_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.insurance_type = 'medicare' THEN
    IF NEW.visits_authorized = 24 THEN -- only override if still at default
      NEW.visits_authorized := 20;
    END IF;
    NEW.evals_authorized := 1;
    NEW.reassessments_authorized := 0;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_visit_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.employment_type = 'ft' THEN
    NEW.weekly_visit_target := 25;
  ELSIF NEW.employment_type = 'pt' THEN
    NEW.weekly_visit_target := 15;
  ELSIF NEW.employment_type = 'prn' THEN
    NEW.weekly_visit_target := 10; -- alert threshold, not hard limit
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_activity_log_legacy_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Forward sync: canonical -> legacy (for old well-formed inserts)
  IF NEW.resource_type IS NULL AND NEW.table_name IS NOT NULL THEN
    NEW.resource_type := NEW.table_name;
  END IF;
  IF NEW.resource_id IS NULL AND NEW.record_id IS NOT NULL THEN
    NEW.resource_id := NEW.record_id::text;
  END IF;
  IF NEW.detail IS NULL AND NEW.action_detail IS NOT NULL THEN
    NEW.detail := NEW.action_detail;
  END IF;

  -- Reverse sync: legacy -> canonical (for buggy inserts)
  IF NEW.table_name IS NULL AND NEW.resource_type IS NOT NULL THEN
    NEW.table_name := NEW.resource_type;
  END IF;
  IF NEW.record_id IS NULL AND NEW.resource_id IS NOT NULL THEN
    BEGIN
      NEW.record_id := NEW.resource_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      -- Some legacy callers pass non-UUID identifiers; just leave null.
      NULL;
    END;
  END IF;
  IF NEW.action_detail IS NULL AND NEW.detail IS NOT NULL THEN
    NEW.action_detail := NEW.detail;
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_pending_auths()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  pending_count int := 0;
  pname text;
BEGIN
  -- Snapshot the queue, sync each patient, clear processed rows.
  FOR pname IN
    SELECT pname_key FROM auth_sync_pending ORDER BY flagged_at
  LOOP
    PERFORM sync_visits_to_auth_for_patient(pname);
    DELETE FROM auth_sync_pending WHERE pname_key = pname;
    pending_count := pending_count + 1;
  END LOOP;
  RETURN pending_count;
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_visits_to_auth()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  auth_rec RECORD;
  visit_count integer;
  eval_count integer;
  reassess_count integer;
  updated_patients text[] := ARRAY[]::text[];
  total_updated integer := 0;
BEGIN
  -- For each non-terminal auth record, count completed ENCOUNTERS (not rows).
  -- Co-treat visits (PT + PTA on same day) count as ONE encounter via DISTINCT visit_date.
  FOR auth_rec IN
    SELECT id, patient_name, soc_date, auth_expiry_date,
           visits_authorized, visits_used,
           evals_authorized, evals_used,
           reassessments_authorized, reassessments_used
    FROM auth_tracker
    WHERE auth_status NOT IN ('denied', 'cancelled', 'expired', 'discharged')
      AND is_currently_active = true
  LOOP
    -- Count completed regular visit ENCOUNTERS (distinct dates, not rows)
    SELECT COUNT(DISTINCT v.visit_date) INTO visit_count
    FROM visit_schedule_data v
    WHERE LOWER(TRIM(v.patient_name)) = LOWER(TRIM(auth_rec.patient_name))
      AND v.status ILIKE '%coD v.event_type NOT ILIKE '%reassess%'
      AND v.event_type NOT ILIKE '%re-assess%'
      AND v.event_type NOT ILIKE '%recert%'
      AND v.event_type NOT ILIKE '%cancel%'
      AND (auth_rec.soc_date IS NULL OR v.visit_date >= auth_rec.soc_date)
      AND (auth_rec.auth_expiry_date IS NULL OR v.visit_date <= auth_rec.auth_expiry_date);

    -- Count completed eval ENCOUNTERS (distinct dates)
    SELECT COUNT(DISTINCT v.visit_date) INTO eval_count
    FROM visit_schedule_data v
    WHERE LOWER(TRIM(v.patient_name)) = LOWER(TRIM(auth_rec.patient_name))
      AND v.status ILIKE '%completed%'
      AND (v.event_type ILIKE '%eval%' AND v.event_type NOT ILIKE '%reassess%' AND v.event_type NOT ILIKE '%re-assess%' AND v.event_type NOT ILIKE '%recert%')
      AND (auth_rec.soc_date IS NULL OR v.visit_date >= auth_rec.soc_date)
      AND (auth_rec.auth_expiry_date IS NULL OR v.visit_date <= auth_rec.auth_expiry_date);

    -- Count completed reassessment ENCOUNTERS (distinct dates)
    SELECT COUNT(DISTINCT v.visit_date) INTO reassess_count
    FROM visit_schedule_data v
    WHERE LOWER(TRIM(v.patient_name)) = LOWER(TRIM(auth_rec.patient_name))
      AND v.status ILIKE '%completed%'
      AND (v.event_type ILIKE '%reassess%' OR v.event_type ILIKE '%re-assess%' OR v.event_type ILIKE '%recert%')
      AND (auth_rec.soc_date IS NULL OR v.visit_date >= auth_rec.soc_date)
      AND (auth_rec.auth_expiry_date IS NULL OR v.visit_date <= auth_rec.auth_expiry_date);

    -- Only update if counts changed
    IF visit_count != COALESCE(auth_rec.visits_used, 0)
       OR eval_count != COALESCE(auth_rec.evals_used, 0)
       OR reassess_count != COALESCE(auth_rec.reassessments_used, 0)
    THEN
      UPDATE auth_tracker SET
        visits_used = visit_count,
        evals_used = eval_count,
        reassessments_used = reassess_count,
        updated_at = now()
      WHERE id = auth_rec.id;

      total_updated := total_updated + 1;

      IF NOT auth_rec.patient_name = ANY(updated_patients) THEN
        updated_patients := array_append(updated_patients, auth_rec.patient_name);
      END IF;
    END IF;
  END LOOP;

  -- Recompute auth sequences for all patients whose counts changed
  IF array_length(updated_patients, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(updated_patients, 1) LOOP
      PERFORM recompute_auth_sequence(updated_patients[i]);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'auths_updated', total_updated,
    'patients_resequenced', COALESCE(array_length(updated_patients, 1), 0)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_visits_to_auth_for_patient(p_patient_name text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  auth_rec       RECORD;
  visit_count    integer;
  eval_count     integer;
  reassess_count integer;
  updated_count  integer := 0;
  pname_key      text;
BEGIN
  IF p_patient_name IS NULL OR length(trim(p_patient_name)) = 0 THEN
    RETURN 0;
  END IF;
  pname_key := lower(trim(p_patient_name));

  FOR auth_rec IN
    SELECT id, visits_authorized, evals_authorized, reassessments_authorized,
           soc_date, auth_expiry_date, visits_used, evals_used, reassessments_used
    FROM auth_tracker
    WHERE LOWER(TRIM(patient_name)) = pname_key
      AND auth_status NOT IN ('denied','cancelled','expired','discharged')
  LOOP
    -- VISITS
    SELECT COUNT(DISTINCT visit_date) INTO visit_count
    FROM visit_schedule_data
    WHERE LOWER(TRIM(patient_name)) = pname_key
      AND status ILIKE '%completed%'
      AND event_type NOT ILIKE '%eval%'
      AND event_type NOT ILIKE '%reassess%'
      AND event_type NOT ILIKE '%re-assess%'
      AND event_type NOT ILIKE '%recert%'
      AND event_type NOT ILIKE '%cancel%'
      AND (auth_rec.soc_date IS NULL OR visit_date >= auth_rec.soc_date)
      AND (auth_rec.auth_expiry_date IS NULL OR visit_date <= auth_rec.auth_expiry_date);

    -- Plus completed visits from in-app scheduled_visits (telehealth + in-person bucketed together)
    SELECT visit_count + COUNT(DISTINCT visit_date) INTO visit_count
    FROM scheduled_visits
    WHERE LOWER(TRIM(patient_name)) = pname_key
      AND status ILIKE '%completed%'
      AND visit_type NOT ILIKE '%eval%'
      AND visit_type NOT ILIKE '%reassess%'
      AND (auth_rec.soc_date IS NULL OR visit_date >= auth_rec.soc_date)
      AND (auth_rec.auth_expiry_date IS NULL OR visit_date <= auth_rec.auth_expiry_date);

    -- EVALS
    SELECT COUNT(DISTINCT visit_date) INTO eval_count
    FROM visit_schedule_data
    WHERE LOWER(TRIM(patient_name)) = pname_key
      AND status ILIKE '%completed%'
      AND event_type ILIKE '%eval%'
      AND event_type NOT ILIKE '%cancel%'
      AND (auth_rec.soc_date IS NULL OR visit_date >= auth_rec.soc_date)
      AND (auth_rec.auth_expiry_date IS NULL OR visit_date <= auth_rec.auth_expiry_date);

    -- REASSESSMENTS
    SELECT COUNT(DISTINCT visit_date) INTO reassess_count
    FROM visit_schedule_data
    WHERE LOWER(TRIM(patient_name)) = pname_key
      AND status ILIKE '%completed%'
      AND (event_type ILIKE '%reassess%' OR event_type ILIKE '%re-assess%' OR event_type ILIKE '%recert%')
      AND event_type NOT ILIKE '%cancel%'
      AND (auth_rec.soc_date IS NULL OR visit_date >= auth_rec.soc_date)
      AND (auth_rec.auth_expiry_date IS NULL OR visit_date <= auth_rec.auth_expiry_date);

    -- Write only when something changed
    IF visit_count IS DISTINCT FROM auth_rec.visits_used
       OR eval_count IS DISTINCT FROM auth_rec.evals_used
       OR reassess_count IS DISTINCT FROM auth_rec.reassessments_used THEN
      UPDATE auth_tracker
      SET visits_used        = COALESCE(visit_count, 0),
          evals_used         = COALESCE(eval_count, 0),
          reassessments_used = COALESCE(reassess_count, 0),
          updated_at         = now()
      WHERE id = auth_rec.id;
      updated_count := updated_count + 1;
    END IF;
  END LOOP;

  -- Re-sequence (effective_visits_remaining, is_currently_active)
  PERFORM recompute_auth_sequence(p_patient_name);

  -- Refresh auth_health for every auth this patient has
  UPDATE auth_tracker
  SET auth_health = compute_auth_health(id)
  WHERE LOWER(TRIM(patient_name)) = pname_key
    AND auth_status NOT IN ('denied','cancelled','expired','discharged');

  -- Fire / clear alerts for each auth (proper loop scope this time)
  FOR auth_rec IN
    SELECT id FROM auth_tracker
    WHERE LOWER(TRIM(patient_name)) = pname_key
  LOOP
    PERFORM fire_auth_health_alerts(auth_rec.id);
  END LOOP;

  RETURN updated_count;
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_wound_to_census()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.has_wounds IS NOT NULL THEN
    UPDATE census_data
    SET has_wound = NEW.has_wounds,
        wound_flag_date = CASE WHEN NEW.has_wounds = TRUE AND wound_flag_date IS NULL THEN CURRENT_DATE ELSE wound_flag_date END
    WHERE LOWER(patient_name) = LOWER(NEW.patient_name) AND region = NEW.region;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_scheduled_visit_sync_auth()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- INSERT/UPDATE: sync for the patient on NEW. UPDATE that changes
  -- patient_name (rare) syncs both OLD and NEW patients.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM sync_visits_to_auth_for_patient(NEW.patient_name);
    IF TG_OP = 'UPDATE' AND OLD.patient_name IS DISTINCT FROM NEW.patient_name THEN
      PERFORM sync_visits_to_auth_for_patient(OLD.patient_name);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM sync_visits_to_auth_for_patient(OLD.patient_name);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.trg_visit_data_flag_pending()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  pname_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    pname_key := LOWER(TRIM(OLD.patient_name));
  ELSE
    pname_key := LOWER(TRIM(NEW.patient_name));
  END IF;
  IF pname_key IS NOT NULL AND length(pname_key) > 0 THEN
    INSERT INTO auth_sync_pending (pname_key) VALUES (pname_key)
    ON CONFLICT (pname_key) DO UPDATE SET flagged_at = now();
  END IF;
  -- Also flag OLD on UPDATE if name changed (rare)
  IF TG_OP = 'UPDATE' AND OLD.patient_name IS DISTINCT FROM NEW.patient_name THEN
    INSERT INTO auth_sync_pending (pname_key) VALUES (LOWER(TRIM(OLD.patient_name)))
    ON CONFLICT (pname_key) DO UPDATE SET flagged_at = now();
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.update_coordinator_tasks_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$
;

-- ---------------------------------------------------------------------------
-- 11. TRIGGERS
-- ---------------------------------------------------------------------------
CREATE TRIGGER auth_tracker_defaults BEFORE INSERT OR UPDATE ON public.auth_tracker FOR EACH ROW EXECUTE FUNCTION set_auth_defaults();
CREATE TRIGGER clinician_visit_target_trigger BEFORE INSERT OR UPDATE ON public.clinicians FOR EACH ROW EXECUTE FUNCTION set_visit_target();
CREATE TRIGGER coordinator_tasks_set_updated_at BEFORE UPDATE ON public.coordinator_tasks FOR EACH ROW EXECUTE FUNCTION coordinator_tasks_touch_updated_at();
CREATE TRIGGER coordinator_tasks_updated BEFORE UPDATE ON public.coordinator_tasks FOR EACH ROW EXECUTE FUNCTION update_coordinator_tasks_timestamp();
CREATE TRIGGER pca_updated_at BEFORE UPDATE ON public.patient_clinician_assignments FOR EACH ROW EXECUTE FUNCTION pca_set_updated_at();
CREATE TRIGGER trg_activity_auth_renewal_tasks AFTER INSERT OR UPDATE ON public.auth_renewal_tasks FOR EACH ROW EXECUTE FUNCTION fn_log_coordinator_activity();
CREATE TRIGGER trg_activity_auth_tracker AFTER INSERT OR UPDATE ON public.auth_tracker FOR EACH ROW EXECUTE FUNCTION fn_log_coordinator_activity();
CREATE TRIGGER trg_activity_care_coord_notes AFTER INSERT ON public.care_coord_notes FOR EACH ROW EXECUTE FUNCTION fn_log_care_coord_note();
CREATE TRIGGER trg_activity_coordinator_tasks AFTER INSERT OR UPDATE ON public.coordinator_tasks FOR EACH ROW EXECUTE FUNCTION fn_log_coordinator_activity();
CREATE TRIGGER trg_activity_intake_referrals AFTER INSERT OR UPDATE ON public.intake_referrals FOR EACH ROW EXECUTE FUNCTION fn_log_coordinator_activity();
CREATE TRIGGER trg_activity_on_hold_recovery AFTER UPDATE ON public.on_hold_recovery FOR EACH ROW EXECUTE FUNCTION fn_log_coordinator_activity();
CREATE TRIGGER trg_activity_patient_discharges AFTER INSERT ON public.patient_discharges FOR EACH ROW EXECUTE FUNCTION fn_log_coordinator_activity();
CREATE TRIGGER trg_activity_patient_notes AFTER INSERT ON public.patient_notes FOR EACH ROW EXECUTE FUNCTION fn_log_patient_note();
CREATE TRIGGER trg_activity_waitlist_assignments AFTER INSERT OR UPDATE ON public.waitlist_assignments FOR EACH ROW EXECUTE FUNCTION fn_log_coordinator_activity();
CREATE TRIGGER trg_auto_clear_freq_review BEFORE UPDATE ON public.census_data FOR EACH ROW EXECUTE FUNCTION auto_clear_freq_review_on_status_change();
CREATE TRIGGER trg_compute_loc_level BEFORE INSERT OR UPDATE OF caremap_score ON public.patient_risk_factors FOR EACH ROW EXECUTE FUNCTION compute_loc_level();
CREATE TRIGGER trg_ins_abbr_touch BEFORE UPDATE ON public.insurance_abbreviations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_scheduled_visit_sync AFTER INSERT OR DELETE OR UPDATE ON public.scheduled_visits FOR EACH ROW EXECUTE FUNCTION trg_scheduled_visit_sync_auth();
CREATE TRIGGER trg_sync_activity_legacy BEFORE INSERT OR UPDATE ON public.coordinator_activity_log FOR EACH ROW EXECUTE FUNCTION sync_activity_log_legacy_columns();
CREATE TRIGGER trg_sync_wound_to_census AFTER INSERT OR UPDATE OF has_wounds ON public.patient_risk_factors FOR EACH ROW EXECUTE FUNCTION sync_wound_to_census();
CREATE TRIGGER trg_visit_data_flag AFTER INSERT OR DELETE OR UPDATE ON public.visit_schedule_data FOR EACH ROW EXECUTE FUNCTION trg_visit_data_flag_pending();

-- ---------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY (enable + policies)
-- ---------------------------------------------------------------------------
ALTER TABLE public."action_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."action_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."auth_audit_staging" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."auth_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."auth_renewal_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."auth_team_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."auth_tracker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."care_coord_discharges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."care_coord_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."care_coord_referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."care_coord_task_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."census_data" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."census_status_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."clinician_productivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."clinician_pto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."clinicians" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coordinator_daily_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coordinator_overload_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coordinator_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coordinators" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."daily_ops_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."daily_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."data_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."data_freshness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."hospitalizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."hospitalized_tracker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."insurance_abbreviations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."intake_referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."marketing_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."marketing_encounters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."medicare_visit_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."note_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."on_hold_recovery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."page_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_clinical_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_clinician_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_discharges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_master" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_risk_factors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."patient_visit_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."rm_kpi_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."scheduled_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."swift_team_patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."swift_wound_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."upload_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_page_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."visit_schedule_data" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."waitlist_assignments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active coordinators full access" ON public."action_items" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Authenticated users can insert action_responses" ON public."action_responses" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can read action_responses" ON public."action_responses" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can update action_responses" ON public."action_responses" AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Active coordinators full access" ON public."alerts" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Admin only access to auth_audit_staging" ON public."auth_audit_staging" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM coordinators WHERE ((coordinators.user_id = auth.uid()) AND (coordinators.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'ceo'::text, 'director'::text])) AND (coordinators.is_active = true))))) WITH CHECK ((EXISTS ( SELECT 1 FROM coordinators WHERE ((coordinators.user_id = auth.uid()) AND (coordinators.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'ceo'::text, 'director'::text])) AND (coordinators.is_active = true)))));
CREATE POLICY "Active coordinators full access" ON public."auth_documents" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."auth_renewal_tasks" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."auth_team_assignments" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."auth_tracker" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."care_coord_discharges" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."care_coord_notes" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."care_coord_referrals" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."care_coord_task_log" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."census_data" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."census_status_log" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."clinician_productivity" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."clinician_pto" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."clinicians" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "coordinator_daily_metrics_insert" ON public."coordinator_daily_metrics" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1 FROM coordinators p WHERE ((p.user_id = auth.uid()) AND ((p.full_name = coordinator_daily_metrics.coordinator_name) OR (p.email = coordinator_daily_metrics.coordinator_name))))));
CREATE POLICY "coordinator_daily_metrics_select" ON public."coordinator_daily_metrics" AS PERMISSIVE FOR SELECT TO public USING (((EXISTS ( SELECT 1 FROM coordinators p WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['super_admin'::text, 'director'::text, 'admin'::text, 'assoc_director'::text, 'regional_manager'::text, 'pod_leader'::text, 'ceo'::text]))))) OR (EXISTS ( SELECT 1 FROM coordinators p WHERE ((p.user_id = auth.uid()) AND ((p.full_name = coordinator_daily_metrics.coordinator_name) OR (p.email = coordinator_daily_metrics.coordinator_name)))))));
CREATE POLICY "coordinator_daily_metrics_update" ON public."coordinator_daily_metrics" AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1 FROM coordinators p WHERE ((p.user_id = auth.uid()) AND ((p.full_name = coordinator_daily_metrics.coordinator_name) OR (p.email = coordinator_daily_metrics.coordinator_name))))));
CREATE POLICY "Active coordinators full access (temp - tighten to admin only)" ON public."coordinator_overload_alerts" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."coordinator_tasks" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators read coordinators" ON public."coordinators" AS PERMISSIVE FOR SELECT TO authenticated USING (is_active_coordinator());
CREATE POLICY "Admins insert coordinators" ON public."coordinators" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_admin_or_above());
CREATE POLICY "Admins update coordinators" ON public."coordinators" AS PERMISSIVE FOR UPDATE TO authenticated USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());
CREATE POLICY "Authenticated users can delete coordinators" ON public."coordinators" AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert coordinators" ON public."coordinators" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can read all coordinators" ON public."coordinators" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can update coordinators" ON public."coordinators" AS PERMISSIVE FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Only super_admin can delete coordinators" ON public."coordinators" AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Active coordinators full access (temp - tighten to admin only)" ON public."daily_ops_reports" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."daily_reports" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Admin only access to data_audit_log" ON public."data_audit_log" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM coordinators WHERE ((coordinators.user_id = auth.uid()) AND (coordinators.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'ceo'::text, 'director'::text])) AND (coordinators.is_active = true))))) WITH CHECK ((EXISTS ( SELECT 1 FROM coordinators WHERE ((coordinators.user_id = auth.uid()) AND (coordinators.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'ceo'::text, 'director'::text])) AND (coordinators.is_active = true)))));
CREATE POLICY "Active coordinators full access" ON public."data_freshness" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."hospitalizations" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."hospitalized_tracker" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators can read" ON public."insurance_abbreviations" AS PERMISSIVE FOR SELECT TO authenticated USING (is_active_coordinator());
CREATE POLICY "Admins can delete" ON public."insurance_abbreviations" AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY "Admins can insert" ON public."insurance_abbreviations" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "Admins can update" ON public."insurance_abbreviations" AS PERMISSIVE FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Active coordinators full access" ON public."intake_referrals" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."marketing_contacts" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."marketing_encounters" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."medicare_visit_flags" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Anyone can insert notifications" ON public."note_notifications" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Users can read own notifications" ON public."note_notifications" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Users can update own notifications" ON public."note_notifications" AS PERMISSIVE FOR UPDATE TO public USING (true);
CREATE POLICY "Authenticated users can insert notifications" ON public."notifications" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Users can update own notifications" ON public."notifications" AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own notifications" ON public."notifications" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Active coordinators full access" ON public."on_hold_recovery" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators read" ON public."page_permissions" AS PERMISSIVE FOR SELECT TO authenticated USING (is_active_coordinator());
CREATE POLICY "Admins manage" ON public."page_permissions" AS PERMISSIVE FOR ALL TO authenticated USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());
CREATE POLICY "Active coordinators full access" ON public."patient_clinical_settings" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "pca_authenticated_all" ON public."patient_clinician_assignments" AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Active coordinators full access" ON public."patient_discharges" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."patient_documents" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."patient_master" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Anyone can insert notes" ON public."patient_notes" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read notes" ON public."patient_notes" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Read patient_risk_factors" ON public."patient_risk_factors" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM coordinators WHERE ((coordinators.user_id = auth.uid()) AND (coordinators.is_active = true)))));
CREATE POLICY "Write patient_risk_factors" ON public."patient_risk_factors" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM coordinators WHERE ((coordinators.user_id = auth.uid()) AND (coordinators.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'ceo'::text, 'director'::text, 'assoc_director'::text])) AND (coordinators.is_active = true))))) WITH CHECK ((EXISTS ( SELECT 1 FROM coordinators WHERE ((coordinators.user_id = auth.uid()) AND (coordinators.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'ceo'::text, 'director'::text, 'assoc_director'::text])) AND (coordinators.is_active = true)))));
CREATE POLICY "Active coordinators full access" ON public."patient_visit_history" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators read" ON public."rm_kpi_goals" AS PERMISSIVE FOR SELECT TO authenticated USING (is_active_coordinator());
CREATE POLICY "Admins manage" ON public."rm_kpi_goals" AS PERMISSIVE FOR ALL TO authenticated USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());
CREATE POLICY "Active coordinators full access on scheduled_visits" ON public."scheduled_visits" AS PERMISSIVE FOR ALL TO public USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."swift_team_patients" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."swift_wound_assessments" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."upload_batches" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators read" ON public."user_page_overrides" AS PERMISSIVE FOR SELECT TO authenticated USING (is_active_coordinator());
CREATE POLICY "Admins manage" ON public."user_page_overrides" AS PERMISSIVE FOR ALL TO authenticated USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());
CREATE POLICY "Active coordinators full access" ON public."visit_schedule_data" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());
CREATE POLICY "Active coordinators full access" ON public."waitlist_assignments" AS PERMISSIVE FOR ALL TO authenticated USING (is_active_coordinator()) WITH CHECK (is_active_coordinator());

-- ---------------------------------------------------------------------------
-- 13. GRANTS (Supabase default — full DML on all public tables to all 3 roles)
-- ---------------------------------------------------------------------------
-- The live DB has identical grants on every public table for anon,
-- authenticated, service_role: SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER (the Supabase default). Row-level
-- access is gated by the RLS policies above.

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ---------------------------------------------------------------------------
-- 14. pg_cron JOBS (registered via cron.schedule — listed here for reference)
-- ---------------------------------------------------------------------------
/* These jobs were active on the live DB as of 2026-05-28.
   Recreate them on a new DB with:
     SELECT cron.schedule('<jobname>', '<schedule>', $$<command>$$);

   - daily-ops-morning         '0 12 * * 1-5'
       -> POST https://kndiyailsqrialgbozac.supabase.co/functions/v1/daily-ops-report
          body: {"report_type":"morning_overview"}
   - daily-ops-midday          '0 16 * * 1-5'
       -> POST daily-ops-report body: {"report_type":"midday_snapshot"}
   - daily-ops-eod             '0 21 * * 1-5'
       -> POST daily-ops-report body: {"report_type":"eod_review"}
   - overload-check            '*/15 12-22 * * 1-5'
       -> POST daily-ops-report body: {"report_type":"overload_check_only"}
   - mark-expired-auths-daily  '30 9 * * *'
       -> SELECT mark_expired_auths();
   - sync-pending-auths-safety-net '*/15 * * * *'
       -> SELECT sync_pending_auths();
*/

-- ---------------------------------------------------------------------------
-- 15. EDGE FUNCTIONS (deployed separately via Supabase; reference only)
-- ---------------------------------------------------------------------------
/* Active edge functions as of 2026-05-28:
     slug                 | status | version | verify_jwt
     ---------------------+--------+---------+-----------
     extract-document     | ACTIVE | v6      | false
     notify-mention       | ACTIVE | v1      | true
     daily-ops-report     | ACTIVE | v3      | false
     admin-user-actions   | ACTIVE | v3      | true
   Source lives under supabase/functions/<slug>/index.ts.
*/

-- ============================================================================
-- END BASELINE
-- ============================================================================
