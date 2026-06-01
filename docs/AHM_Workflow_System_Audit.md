# EdemaCare Operations Workflow System Audit

> **Naming note (2026-06-01):** "EdemaCare" is the public-facing brand as of June 1, 2026.
> "AxiomHealth Management" / "AHM" remains the legal entity name and is preserved here in
> the original file name and in references to the canonical training guide
> (`AHM_Authorization_Training_Guide_v2.docx`) to keep links stable and historical context
> intact. EdemaCare is a service of AxiomHealth Management LLC.

**Date:** 2026-05-28
**Auditor:** Claude (commissioned by Liam O'Brien, Director of Operations)
**Scope:** EdemaCare Operations Dashboard codebase + Supabase schema
**Reference workflow:** the 9-step canonical workflow ratified 2026-05-28, codified in *AHM_Authorization_Training_Guide_v2.docx* §1 (file name preserved; content reissued as EdemaCare-branded training material)

---

## Audit method

- Read every file in `src/components/`, `src/pages/`, `src/lib/`, and `src/hooks/` that handles status changes, auth records, alerts, or assignments.
- Read every SQL migration in `supabase/migrations/` and the companion README files.
- Cross-referenced findings against the four canonical statuses (**SOC Pending → Auth Pending → Eval Pending → Active**) and the team-handoff model.
- No code or schema was modified.

---

## Verdict at a glance

| # | Audit item | Verdict |
|---|---|---|
| 1 | Status enum / values | **PARTIAL** |
| 2 | PPO bypass | **YES** (frontend-only, not enforced in DB) |
| 3 | 48-hour Eval Pending SLA | **PARTIAL** (display-only, no automation) |
| 4 | Eval note verification gate | **NO** |
| 5 | Status transition guardrails | **NO** |
| 6 | Auth approval data capture | **PARTIAL** |
| 7 | Team ownership clarity | **PARTIAL** |
| 8 | Intake → Auth / Auth → Care Coord handoff signal | **NO** |

---

## 1. Status enum / values — PARTIAL

The four canonical statuses (SOC Pending, Auth Pending, Eval Pending, Active) all exist as literal strings used across the codebase, so the workflow is *representable*. But there is no database-level enum or `CHECK` constraint on `census_data.status` in any committed migration — the column accepts arbitrary text. The canonical list is enforced only by the front-end dropdown in `src/components/StatusChangeModal.jsx` lines 4–19.

That dropdown, however, also exposes legacy Pariox-truncation strings — `"Active - Auth Pendin"` (missing the trailing "g") and `"Discharge - Change I"` (truncated). `AuthAuditImportPage.jsx` lines 31–33 has a normalization map for these on import, but the dropdown still lets a coordinator pick the broken values. Patients can be saved with statuses outside the canonical set, including off-path values (Waitlist, On Hold sub-types, Hospitalized, Discharge sub-types) that are valid but not in Liam's 4-status spine.

---

## 2. PPO bypass — YES (frontend-only)

PPO bypass logic is implemented end-to-end on the frontend. The detection function lives at `src/pages/dashboard/AuthTrackerPage.jsx` lines 67–73 (`isPPO(rec)` returns true when `insurance_type === 'ppo'`). When a coordinator sets `insurance_type` to `'ppo'` on an auth record, line 323 auto-sets `auth_status = 'active'` and appends `"PPO — No authorization required."` to the notes — exactly the behavior the v2 guide codifies.

PPO patients are also explicitly excluded from auth alerts in `src/lib/alertEngine.js` line 146 and surfaced under a dedicated "PPO — No Auth Req." chip on the All Authorizations page. **Gap:** the bypass is application-level only — there is no schema flag, view, or trigger that recognizes PPO status, so any direct DB edit can leave a PPO patient stuck in Auth Pending. Also, the bypass acts on the auth record but does NOT automatically flip the census_data status to Eval Pending — the coordinator still has to do that manually.

---

## 3. 48-hour Eval Pending SLA — PARTIAL (display-only, no automation)

The 48-hour SLA is *displayed* but not *enforced*. `src/pages/dashboard/OperationsManagerDashboard.jsx` line 65 carries the comment `stuckThreshold: 2,   // 48-hour SLA per Liam`, and lines 477–478, 760–778 surface drilldowns titled "Overdue evals (> 48h)" — patients with `status_changed_at` more than 2 days ago while status matches `/eval.*pending/i`. `CoordinatorPage.jsx` lines 788–798 and `CareCoordMyPatients.jsx` lines 382–392 each carry a similar in-app calculation labeled "Eval Pending > 3 days" — note the inconsistency: one place uses 2 days, others use 3.

There is no pg_cron job, alert row, or push notification that fires when a patient crosses 48 hours in Eval Pending. The `auth_low_visits` alert tier mentioned in v1 has no parallel `eval_scheduling_sla` tier. The information exists but only when a manager opens the dashboard — there is no automated escalation.

---

## 4. Eval note verification gate — NO

A coordinator can flip a patient to Active without an eval note being present. `src/components/StatusChangeModal.jsx` is a free `<select>` (lines 93–98) of all 14 status strings, with the only validation being a required free-text reason (line 32: `if (!changed || !reason.trim()) return;`). The save handler (lines 31–68) writes the new status straight to `census_data` and inserts an audit note — no check on visit_schedule_data, no check on any eval-note table, no clinician confirmation.

There is also no schema-level guard: no trigger, no `CHECK`, no foreign-key enforcement that requires an eval-note row before status = 'Active'. The verification gate exists only as a policy in the v2 training guide.

---

## 5. Status transition guardrails — NO

The system permits arbitrary status jumps. The StatusChangeModal dropdown shows all 14 statuses simultaneously regardless of current status. A SOC Pending patient can be flipped to Active in one click. There is no state-machine validation, no trigger that enforces sequencing, and no migration containing such logic.

`PatientCensusPage.jsx` lines 657–699 also exposes a separate status dropdown UI on the patient detail view with a different (and smaller) set of values (`active / inactive / discharged / on_hold`), which is itself inconsistent with the StatusChangeModal. This means the same patient can be saved with statuses from two different vocabularies depending on which page the coordinator was on. This is the highest-stakes data-integrity issue in the audit.

---

## 6. Auth approval data capture — PARTIAL

`AuthEditModal` in `src/pages/dashboard/AuthCoordDashboard.jsx` lines 25–149 validates several things on save: visits cannot be negative (lines 76–77), `visits_used > visits_authorized` is rejected (lines 78–80), date typos and date ordering are caught (lines 82–97). Good, but **incomplete**: there is no required-field check that `visits_authorized` is populated when `auth_status` is set to `'active'`. The form state (lines 26–38) does not even include `evals_authorized` or `reassessments_authorized` as fields — those two count fields, which Liam's canonical workflow explicitly requires at step 6, are not collected by this modal.

`PatientCensusPage.jsx` line 355 silently coerces blank count fields to `0` via `parseInt(...) || 0`. Combined with no DB constraint, this means an auth can be marked active with zero or null visit counts, which then drives Visit Runway / Over Limit pages to wrong conclusions.

---

## 7. Team ownership clarity — PARTIAL

Ownership is split across two fields with no documented relationship. `census_data.pipeline_assigned_to` is the coordinator owner used by Coordinator Portal, Operations Manager Dashboard, and Clinician Assignment (`CoordinatorPage.jsx` 570, 976–1055; `OperationsManagerDashboard.jsx` 227, 1000–1069). `auth_tracker.assigned_to` is a separate field representing the auth coordinator (`AuthCoordDashboard.jsx` line 37). The OperationsManagerDashboard at line 1067 explicitly merges the two with `var owner = p.assigned_to || p.pipeline_assigned_to || null;` — meaning the system treats either as "the owner" depending on context.

There are no dedicated `intake_coordinator`, `auth_coordinator`, or `care_coordinator` fields on census_data. So at a given moment a Patient Census row cannot answer "who owns this patient *for this status*?" with certainty — the coordinator visible depends on the page and on which field was set last.

---

## 8. Intake → Auth / Auth → Care Coord handoff signal — NO

When a patient's status flips between teams, nothing is actively pushed to the receiving team. The auth team and care coord team must *poll* — by opening their respective dashboards and noticing a new row. There is no trigger on `census_data.status` UPDATE that inserts into `note_notifications`, `coordinator_tasks`, or any push surface. There is also no auto-creation of a coordinator task ("verify intake handoff for Patient X").

The closest the system has is `auth_renewal_tasks`, which is auto-populated by the visit-sync drain when an auth crosses the renewal threshold (per `README_auth_visit_sync_2026_05_20.md` Phase 3). But that pattern is not generalized to other handoffs. The Auth Pending Coverage view's `never_had_auth` state catches missed Intake → Auth handoffs *after* they have already slipped — it is a *detection* mechanism, not a *prevention* one.

---

## Cross-cutting observation: schema is not in git

This is not one of the 8 audit items, but it is the structural finding that shapes every other answer. The three SQL files in `supabase/migrations/` cover only ~300 lines combined (RLS fixes, page renames, the My Day coordinator-snapshot table). Every core table — `census_data`, `auth_tracker`, `visit_schedule_data`, `auth_renewal_tasks`, `coordinator_activity_log`, `auth_sync_pending`, `insurance_abbreviations`, plus the views `v_auth_pending_coverage` and `v_my_day_notifications` — was applied via Supabase UI or MCP and never committed.

This means any schema-level fix to the gaps above (CHECK constraints, status-transition triggers, NOT NULL enforcement on count fields, SLA cron jobs) will be invisible in git unless a baseline migration is captured first. Worth a one-time effort to dump current schema into a `20260528000000_baseline.sql` file before adding any new constraints.

---

## What this audit did *not* propose

This document is diagnosis only. Recommended fixes, priority order, and effort estimates are deliberately left to the verbal summary Liam asked for separately.
