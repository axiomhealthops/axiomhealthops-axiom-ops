-- 20260714120000_payroll_mirror_schema.sql
--
-- axiom-payroll Firestore mirror schema.
--
-- Ref: docs/PAYROLL_PORTAL_SPEC.md (Dustin, 2026-07-13)
--      docs/Payroll_Review_Design.md (rev 2, 2026-06-02)
--
-- Owned by nightly Edge Function `payroll-mirror-nightly` which reads 14
-- Firestore collections in the axiom-payroll project via a Google service
-- account (roles/datastore.viewer) and upserts here.
--
-- Every mirror table has:
--   - firestore_id TEXT PRIMARY KEY  (Firestore doc ID; natural key or auto)
--   - raw          JSONB             (full source doc, PII-stripped)
--   - mirrored_at  TIMESTAMPTZ       (defaults now())
--
-- PII / blob policy (enforced in the Edge Function, not here):
--   - visits.patient is redacted to '[PHI]' in raw; patient_hash column carries
--     SHA-256(lowercase(patient)) for join-without-disclosure.
--   - mileageSubmissions.fileData and expenses.fileData (base64 receipts up to
--     800KB inline) are dropped entirely. fileName/fileType/fileSize/fileTooBig
--     retained so we can flag lost-receipt cases.
--
-- Access: super_admin only (see 20260714120400_payroll_lockdown_super_admin_only.sql
-- which supersedes the initial admin_or_above policies below).
--
-- NOTE: Applied to production via Supabase MCP apply_migration on 2026-07-14.
-- This file is the git-committed record of that migration.

CREATE SCHEMA IF NOT EXISTS mirror;
GRANT USAGE ON SCHEMA mirror TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Reference / dimension collections
-- ---------------------------------------------------------------------------

CREATE TABLE mirror.employees (
  firestore_id TEXT PRIMARY KEY,
  name TEXT,
  emp_id TEXT,                 -- Paylocity Employee ID (string in Firestore)
  email TEXT,
  employment_type TEXT,        -- joined by NAME to mirror.employment_types.name
  role_id TEXT,
  mileage_rate NUMERIC,
  department TEXT,
  location TEXT,
  ls_level TEXT,
  discipline_type TEXT,
  is_preceptor BOOLEAN,
  is_wound_care_cert BOOLEAN,
  notes TEXT,
  salary_per_period NUMERIC,
  custom_hourly_rate NUMERIC,
  active BOOLEAN,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employees_emp_id_idx ON mirror.employees(emp_id) WHERE emp_id IS NOT NULL;
CREATE INDEX employees_name_idx ON mirror.employees(lower(name));

CREATE TABLE mirror.employment_types (
  firestore_id TEXT PRIMARY KEY,
  name TEXT,
  color TEXT,
  behavior TEXT,               -- 'regular' | 'salaried' | '1099'
  weekly_visit_goal INT,
  sort_order INT,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mirror.roles (
  firestore_id TEXT PRIMARY KEY,
  name TEXT,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mirror.visit_types (
  firestore_id TEXT PRIMARY KEY,
  name TEXT,
  default_rate NUMERIC,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mirror.rate_matrix (
  firestore_id TEXT PRIMARY KEY,
  role_id TEXT,
  visit_type_id TEXT,
  rate NUMERIC,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mirror.settings (
  firestore_id TEXT PRIMARY KEY,   -- e.g. 'defaultMileageRate', 'lsRates'
  value JSONB,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Fact / transaction collections
-- ---------------------------------------------------------------------------

CREATE TABLE mirror.hours_entries (
  firestore_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  entry_date DATE,
  category TEXT,                  -- Regular | Overtime | Vacation/PTO | Training |
                                  --   Meaningful Work | Meetings | Documentation |
                                  --   Level Pay | Bonus | Other
  hours NUMERIC,
  hourly_rate NUMERIC,
  amount NUMERIC,
  notes TEXT,
  status TEXT NOT NULL,           -- pending | approved | denied
  submitted_at TIMESTAMPTZ,
  source TEXT,                    -- paylocity | timecard | NULL(manual)
  paylocity_code TEXT,            -- REG|OT|VAC|PTO|TRTM|MW|L1..L5|DOCU|BONUS|MISC
  pay_period_start DATE,
  pay_period_end DATE,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hours_entries_emp_date_idx ON mirror.hours_entries(employee_id, entry_date);
CREATE INDEX hours_entries_period_idx ON mirror.hours_entries(pay_period_start, pay_period_end);
CREATE INDEX hours_entries_status_idx ON mirror.hours_entries(status);

CREATE TABLE mirror.mileage_submissions (
  firestore_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  pay_period_start DATE,          -- WEEK start (portal enforces 7-day inclusive)
  pay_period_end DATE,
  total_miles NUMERIC,
  reimbursement NUMERIC,          -- submit-time snapshot at DEFAULT rate; variance target
  mileage_rate NUMERIC,
  source TEXT,                    -- MileIQ | Stride | Spreadsheet | ...
  notes TEXT,
  status TEXT NOT NULL,           -- pending | approved | rejected
  submitted_at TIMESTAMPTZ,
  file_name TEXT,
  file_type TEXT,
  file_size INT,
  file_too_big BOOLEAN,
  -- file_data (base64) DROPPED in the Edge Function - never mirrored
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mileage_emp_period_idx ON mirror.mileage_submissions(employee_id, pay_period_start);
CREATE INDEX mileage_status_idx ON mirror.mileage_submissions(status);

CREATE TABLE mirror.expenses (
  firestore_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  employee_name TEXT,
  amount NUMERIC,
  description TEXT,
  expense_date DATE,
  file_name TEXT,
  file_type TEXT,
  file_size INT,
  file_too_big BOOLEAN,
  -- file_data (base64) DROPPED
  status TEXT NOT NULL,           -- pending | approved | rejected | exported [PLANNED]
  submitted_at TIMESTAMPTZ,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_emp_date_idx ON mirror.expenses(employee_id, expense_date);
CREATE INDEX expenses_status_idx ON mirror.expenses(status);

CREATE TABLE mirror.visits (
  firestore_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  visit_date DATE,
  visit_type_id TEXT,
  patient_hash TEXT,              -- SHA-256(lower(patient)) hex; NEVER store patient plaintext
  discipline TEXT,
  event_type TEXT,                -- /Wound/i => wound-care bump upstream
  ref_source TEXT,
  verified TEXT,                  -- 'Verified' or other text
  rate NUMERIC,
  pariox_total NUMERIC,           -- presence flips rate-selection mode
  pariox_visits INT,
  miles_driven NUMERIC,
  notes TEXT,
  source_file TEXT,               -- manual | import | Pariox:<file> | MileagePortal
  import_id TEXT,
  pay_period_start DATE,
  pay_period_end DATE,
  status TEXT,                    -- pending | approved | rejected | NULL(legacy=approved)
  created_at TIMESTAMPTZ,
  raw JSONB NOT NULL,             -- patient field REDACTED to '[PHI]'
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX visits_emp_date_idx ON mirror.visits(employee_id, visit_date);
CREATE INDEX visits_period_idx ON mirror.visits(pay_period_start, pay_period_end);
CREATE INDEX visits_source_idx ON mirror.visits(source_file);
CREATE INDEX visits_status_idx ON mirror.visits(status);

CREATE TABLE mirror.bonus_approvals (
  firestore_id TEXT PRIMARY KEY,
  approval_key TEXT,              -- 'preceptor_{empId}_{from}_{to}' | 'prodbonus_...'
  bonus_type TEXT,                -- preceptor | prodBonus
  employee_id TEXT,
  employee_name TEXT,
  amount NUMERIC,
  status TEXT,                    -- pending | approved | denied
  pay_period_from DATE,
  pay_period_to DATE,
  updated_at TIMESTAMPTZ,
  monthly_rate NUMERIC,
  days_in_period INT,
  iso_week TEXT,                  -- prodBonus only; Monday-anchored ISO week (Sunday-anchored payroll wrinkle)
  weekly_visits INT,
  eligible_visits INT,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bonus_approval_key_idx ON mirror.bonus_approvals(approval_key);
CREATE INDEX bonus_emp_period_idx ON mirror.bonus_approvals(employee_id, pay_period_from);

CREATE TABLE mirror.payroll_overrides (
  firestore_id TEXT PRIMARY KEY,
  employee_id TEXT,
  pay_period_from DATE,
  pay_period_to DATE,
  fields JSONB,                   -- {salaryPay?, visitPay?, ..., otPremium?}
  updated_at TIMESTAMPTZ,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX overrides_emp_period_idx ON mirror.payroll_overrides(employee_id, pay_period_from);

CREATE TABLE mirror.payroll_periods (
  firestore_id TEXT PRIMARY KEY,  -- '{from}_{to}', e.g. '2026-05-17_2026-05-30'
  pay_period_from DATE,
  pay_period_to DATE,
  status TEXT,                    -- always 'paid'
  export_type TEXT,               -- paylocity | 1099 | manual
  processed_at TIMESTAMPTZ,
  processed_by TEXT,
  grand_total NUMERIC,
  line_count INT,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payroll_periods_from_idx ON mirror.payroll_periods(pay_period_from);

CREATE TABLE mirror.imports (
  firestore_id TEXT PRIMARY KEY,
  filename TEXT,
  date_range TEXT,                -- 'MM/DD/YYYY - MM/DD/YYYY'
  visit_count INT,
  grand_total NUMERIC,
  employee_count INT,
  imported_at TIMESTAMPTZ,
  imported_by TEXT,
  pay_period_start DATE,
  pay_period_end DATE,
  raw JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Snapshot bookkeeping + synthesized who-changed-what audit trail.
--
-- Dustin's portal stores NO approver identity or approval timestamp on
-- visits/hours/mileage/expenses/bonuses (spec §6). This audit_events table
-- is the only durable audit trail for those mutations. Nightly diff.
-- ---------------------------------------------------------------------------

CREATE TABLE mirror.snapshot_run (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',  -- running | success | error
  triggered_by TEXT,                        -- 'cron' | 'manual:<uid>' | 'edge:<url>'
  doc_counts JSONB,
  collection_hashes JSONB,
  error_message TEXT,
  notes TEXT
);
CREATE INDEX snapshot_run_started_idx ON mirror.snapshot_run(started_at DESC);

CREATE TYPE mirror.audit_event_type AS ENUM ('created','updated','deleted','undeleted');

CREATE TABLE mirror.audit_events (
  id BIGSERIAL PRIMARY KEY,
  snapshot_run_id BIGINT NOT NULL REFERENCES mirror.snapshot_run(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  event_type mirror.audit_event_type NOT NULL,
  field_path TEXT,
  old_value JSONB,
  new_value JSONB,
  employee_id TEXT,
  in_paid_period BOOLEAN NOT NULL DEFAULT false,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_run_idx ON mirror.audit_events(snapshot_run_id);
CREATE INDEX audit_events_coll_doc_idx ON mirror.audit_events(collection, doc_id);
CREATE INDEX audit_events_paid_idx ON mirror.audit_events(in_paid_period) WHERE in_paid_period = true;
CREATE INDEX audit_events_emp_idx ON mirror.audit_events(employee_id) WHERE employee_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Initial RLS (superseded later this same day by super_admin lockdown)
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','employment_types','roles','visit_types','rate_matrix','settings',
    'hours_entries','mileage_submissions','expenses','visits','bonus_approvals',
    'payroll_overrides','payroll_periods','imports','snapshot_run','audit_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE mirror.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "admin_or_above read" ON mirror.%I FOR SELECT TO authenticated USING (public.is_admin_or_above())',
      t
    );
  END LOOP;
END $$;

COMMENT ON SCHEMA mirror IS
  'Nightly Firestore mirror of axiom-payroll (Dustin''s payroll portal). '
  'Populated by Edge Function payroll-mirror-nightly. PII stripped: visits.patient -> patient_hash; '
  'mileage/expense fileData dropped. See docs/PAYROLL_PORTAL_SPEC.md.';

COMMENT ON TABLE mirror.audit_events IS
  'Synthesized who-changed-what audit trail. Dustin''s app stores no approver identity '
  'or approval timestamp on visits/hours/mileage/expenses/bonuses (spec §6). This table '
  'is the only durable audit trail for those mutations.';
