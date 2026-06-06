# Reassessments + Evaluations Monitor & Telehealth Team Monitor — Design

**Status:** Phase 1 design — no code changes. Awaiting Liam approval before Phase 2 build.
**Author:** Claude (acting as advisor) · **Date:** 2026-06-05
**Scope:** Repurpose `SchedulingAlertsPage.jsx` into a focused R+E Monitor; add a new Telehealth Team Visit Monitor.

---

## TL;DR — read this first

Three findings reframe the brief:

1. **There is a real, measurable gap that this build closes.** Today, 28 patients sit in census `status = 'Eval Pending'`. Only **9** have an evaluation visit scheduled in the next 7 days. **19 patients (68%) are stuck mid-pipeline with no eval booked** — and no page in the dashboard surfaces it. Reassessments are tracked. Evals aren't. That's the gap to close.

2. **The "Telehealth Team" *is* the eval + reassessment team — and it's bigger than I first reported.** Per Liam's correction, the team is six clinicians: **Alexis Giordano, Elizabeth (Liz) Seely, Abi Balogun, Marzina Tejani, Kelsey Downing, Carrie Lucero**. The data confirms all six: combined **1,938 visits, ~270 evaluations and ~1,450 reassessments YTD 2026**, **zero routine treatment visits across all six**. They are *exclusively* the eval + reassessment team. **But only 1 of 6 (Alexis) exists in the `coordinators` table.** The other five are doing the bulk of the org's reassessment work and are completely undocumented in the org schema. That means the two pages Liam asked for are not two pages — **they are two views of the same data** (patient-centric vs. staff-centric).

3. **Recommendation: build both pages, but share one query/state layer.** A new `useTelehealthData()` hook should be the single source of truth for both pages. Otherwise the Pariox dedup logic, the 30/45-day deadlines, the 48-hour eval SLA, and the region scoping all get duplicated — and drift. This is the kind of repeat work the codebase has been bitten by before (see CLAUDE.md "Things that broke before" #1, #2, #3, #9, #10).

**Strong push-back, up front:** Liam asked whether R+E should be **two separate pages**. Recommendation: **no — keep them as one page with two tabs**. The clinical workflow is identical (a PT/OT schedules a visit against an SLA), the deadline math is identical (calendar-day countdown to a hard date), the user is identical (care coord + ADC + RM), and a patient can be in both states at once. Splitting forces 2× navigation and 2× context-switching for zero analytical gain. See §A1 below.

---

## A. Reassessments + Evaluations Monitor (repurpose existing page)

### A0. Current state audit — what the page does today

**File:** `src/pages/dashboard/SchedulingAlertsPage.jsx` (402 lines)
**Route key:** `scheduling-alerts` (Dashboard.jsx line 117) · **Sidebar:** `CARE COORDINATION → Scheduling Alerts`
**Data source:** `patient_clinical_settings` table — one row per patient, with pre-computed `next_reassessment_target` (30d), `next_reassessment_deadline` (45d), `reassessment_status` enum (`overdue`/`critical`/`urgent`/`approaching`/`ok`/`scheduled`/`no_data`).

**What's working — keep:**
- The 30/45-day status engine (`STATUS_CFG`). Solid color/threshold logic.
- Region-scoped fetch via `myRegions` (super_admin/admin/assoc_director/pod_leader/telehealth see all; everyone else sees their assigned regions).
- The `FrequencyModal` for setting visit frequency + assigned reassessment clinician.
- Real-time refresh via `useRealtimeTable('patient_clinical_settings')`.
- Three useful tabs: Reassessment Tracking, No Future Visits, No Frequency Set.

**What's broken or missing — fix in redesign:**
- **No evaluations data at all.** Page only knows about reassessments. The 28 Eval Pending patients are invisible here.
- **Unicode in JSX strings** — emojis baked into `STATUS_CFG.icon` and tab labels. CLAUDE.md "Things that broke before" #4 says don't do this. Replace with inline SVG icons or `{'🚨'}` JSX expressions during the rebuild.
- **Hard-coded `REGIONS` constant** at line 7 instead of importing from `src/lib/constants.js`. Drift risk.
- **`alert_no_visits_scheduled` and `alert_reassessment_unscheduled`** are pre-computed and stored — fine, but the SQL trigger behind them must be checked to confirm it uses the per-(patient, date) latest-`uploaded_at` Pariox dedup rule (CLAUDE.md "Things that broke before" #10). If it's using the older per-batch logic, the unscheduled counts are inflated.
- The title is "Scheduling Alerts" — vague and doesn't tell you what's inside.

### A1. Recommendation: one page, two tabs

Liam's question: "Two separate pages or one with tabs?" — **One page, two tabs**. Justification:

| Dimension | Reassessments | Evaluations | Same? |
|---|---|---|---|
| Clinical action | Schedule PT/OT visit | Schedule PT/OT visit | Yes |
| SLA model | 30d target / 45d hard deadline | 48h from Eval Pending → eval booked | Yes (countdown to date) |
| User | Care coord, ADC, RM | Same | Yes |
| Owner clinician | Alexis or Liz | Alexis or Liz | Yes — same two people |
| Source data | `patient_clinical_settings` + `visit_schedule_data` | `census_data` + `visit_schedule_data` | Overlapping |
| Region scoping | Same | Same | Yes |

The only argument for splitting is "they feel like two different jobs cognitively." But care coords frequently have one patient who needs *both* — a new admit with a reassessment coming up. A unified page lets them work that patient once.

**If Liam disagrees and wants two pages,** the design below cleanly splits into two — just lift each tab into its own page with `useTelehealthData()` shared.

### A2. Redesigned page — "Reassessments & Evaluations Monitor"

**Sidebar label:** `Reassessments & Evals` (under CARE COORDINATION)
**URL slug:** keep `scheduling-alerts` to avoid breaking the 4 internal links to it (AlertsBell, ExceptionFeed, ManagerScorecards, Dashboard.jsx).
**Permissions row in `page_permissions`:** keep existing `scheduling-alerts` row, update `page_label`. Roles already granted: super_admin, admin, assoc_director, regional_manager, pod_leader, care_coordinator. **Add:** `auth_coordinator` (they own the Auth Pending → Eval Pending transition and need to see the downstream impact), `telehealth` (the team itself), `director_payer_marketing` (Yvonne).

**Layout (top → bottom):**

```
TopBar: "Reassessments & Evaluations Monitor"
        subtitle: "{N} reassessments unscheduled · {M} evals overdue 48h SLA · {K} evals not on schedule"

[ KPI strip — 8 cards, no emojis in JSX text, use lucide-react icons ]
  Evals: [Eval Pending Total] [Eval Not Scheduled] [Eval >48h SLA breach] [Eval Booked This Week]
  Reassess: [Overdue >45d] [Critical ≤7d] [Urgent ≤14d] [Scheduled]

[ Tab strip ]
  ▸ Reassessments     ▸ Evaluations    ▸ All Alerts (combined)

[ Filters: Search · Region · Status · Insurance · Clinician (Alexis/Liz) ]

[ Patient table — same row hover/click → modal pattern as today ]
  Reassessment tab columns:  Patient | Rgn | Freq | Last Reassess | 30d | 45d | Days Left | Status | Clinician
  Evaluation tab columns:    Patient | Rgn | Census Status | Status First Seen | Hours in Eval Pending | Eval Scheduled? | Eval Date | Clinician
  All Alerts tab:            Patient | Rgn | Alert Type (Reassess|Eval) | Severity | Owner Clinician | Days Until/Since
```

**Row → modal click behavior:**
- Reassessment row → existing `FrequencyModal` (preserve as-is, drop the emoji from "✓ Frequency manually set").
- Eval row → new `EvalScheduleModal` showing: (a) census status history, (b) the date Eval Pending was set, (c) hours elapsed against 48h SLA, (d) any prior eval attempts (Missed/Cancelled), (e) a "Mark eval scheduled" form that records date + clinician (Alexis or Liz dropdown), (f) "Escalate to ADC" button that fires a coordinator_activity_log entry.

**SLA flags (consistent across both tabs):**

| Color | Reassess meaning | Eval meaning |
|---|---|---|
| 🔴 Red | Past 45d deadline | >48h in Eval Pending, no eval scheduled |
| 🟡 Yellow | ≤14d to deadline, not scheduled | 24–48h in Eval Pending, no eval scheduled |
| 🟢 Green | Scheduled | Eval booked, future date |
| ⚪ Grey | OK / no data | <24h, working as expected |

**Auto-refresh:** keep `useRealtimeTable('patient_clinical_settings')`, add `useRealtimeTable('census_data')` and `useRealtimeTable('visit_schedule_data')`. All three fire the same `load()`.

**Pariox dedup contract:** the join from `census_data` (Eval Pending patients) → `visit_schedule_data` (their booked eval) MUST use the per-(patient_name, visit_date) latest-`uploaded_at` rule from CLAUDE.md #10. We will materialize this as a Postgres view `v_latest_visit_per_slot` once and reuse it across this page and the Telehealth page — see §C2.

### A3. Should care coords get a 48h SLA alert?

**Recommendation: yes, but quietly — banner + AlertsBell, no email.** The 48h SLA is operationally meaningful but not safety-critical (unlike a hospitalization). Pushing it to email creates fatigue and trains people to ignore the inbox. The pattern:

- On the R+E page: persistent red banner — "{N} evals in 48h breach. Click to filter."
- AlertsBell: a single rolled-up notification when the count > 0, with a link to the page.
- No email, no Slack. If Liam wants escalation, the path is: ADC daily digest email (separate build) summarizing all SLA breaches across the org.

---

## B. Telehealth Team Visit Monitor (new page)

### B1. Team definition (6 clinicians)

**Today, by data — last 4 weeks (2026-05-10 to 2026-06-06), per-(patient,date) latest-`uploaded_at` dedup applied:**

| Clinician | In `coordinators`? | Visits 4wk | Avg/wk | Completed | Completion % | YTD visits | YTD evals | YTD reassess | Distinct patients |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Balogun, Abi | ❌ no | 101 | 25.3 | 88 | **87%** | 660 | 54 | 531 | 237 |
| Tejani, Marzina | ❌ no | 82 | 20.5 | 72 | **88%** | 629 | 37 | 527 | 234 |
| Giordano, Alexis | ✅ `role='telehealth'` | 39 | 9.8 | 32 | 82% | 191 | 80 | 92 | 87 |
| Seely, Elizabeth | ❌ no | 35 | 8.8 | 26 | **74%** ⚠ | 190 | 37 | 126 | 96 |
| Downing, Kelsey | ❌ no | 34 | 8.5 | 29 | 85% | 158 | 39 | 107 | 107 |
| Lucero, Carrie | ❌ no | 18 | 4.5 | 16 | 89% | 110 | 23 | 67 | 67 |
| **Team total** | | **309** | **77.3/wk** | **263** | **85%** | **1,938** | **270** | **1,450** | — |

**Two business-critical observations the page would surface:**

(a) **Workload spread is 5.6× from top to bottom.** Abi does 101 visits in 4 weeks; Carrie does 18. Either this is intentional FT/PT capacity allocation (in which case the page should display each clinician's target capacity alongside actuals), or it's accidental misallocation (in which case the page is exposing a management problem worth $50K+/yr in capacity left on the table). I need Liam to clarify which it is before we can set thresholds.

(b) **Liz Seely's completion rate is 74% — 11–15 points below the rest of the team.** She also handles a heavy reassessment load (126 YTD, second only to Abi & Marzina in raw count among the lower-volume tier). If 74% is real, that's about 9 missed/cancelled visits in 4 weeks — roughly $2,070 in lost revenue per 4-week cycle at the $230 blended rate, plus the clinical compliance exposure on missed reassessments. This is exactly the kind of insight a director-grade page should surface; today nobody sees it.

**Visit-type evidence (all 6, YTD 2026):** ~270 evaluations, ~1,450 reassessments, the rest is cancelled-treatment write-ups + attempted visits. **Zero routine treatment visits across all six clinicians.** Their entire scope is evals + reassessments + the paperwork around them.

**Strong recommendation: add the missing 5 to `coordinators`** with `role='telehealth'`, `is_active=true`, `regions=[]` (they cover statewide). Right now the team page would have to define the roster by hard-coded `staff_name IN (...)` — brittle, doesn't survive a sub coverage event, doesn't let Liz log in as `role='telehealth'` and see her own view. A one-time INSERT of 5 rows is cleaner than carrying the hard-coded list as tech debt indefinitely. Need each person's work email to do this properly (`alexis@axiomhealthmanagement.com` follows the org convention — assume `lizseely@`, `abalogun@`, `mtejani@`, `kdowning@`, `clucero@axiomhealthmanagement.com` and let Liam correct).

**If Liam wants to ship before HR adds them:** fallback is hard-coded `staff_name IN ('Giordano, Alexis','Seely, Elizabeth','Balogun, Abi','Tejani, Marzina','Downing, Kelsey','Lucero, Carrie')` with a file-header TODO. Acceptable for v1; not acceptable for v2.

### B2. Visit identification

A row in `visit_schedule_data` is a "telehealth visit" if **either**:
- `staff_name` matches an active row in `coordinators WHERE role='telehealth'` (preferred — see B1), **OR**
- `event_type ILIKE '%Evaluation%'` OR `event_type ILIKE '%Reassessment%'` OR `event_type ILIKE '%Re-Assessment%'` (fallback — catches the rare case where a non-telehealth clinician covers an eval).

Apply the per-(patient_name, visit_date) latest-`uploaded_at` dedup before counting (CLAUDE.md #10).

### B3. Page layout — "Telehealth Team"

**Sidebar:** `CLINICAL DEPARTMENT → Telehealth Team` (alongside SWIFT Team, Clinician Schedule). Same section as the other team-roster pages.
**URL slug:** `telehealth-team`.
**Component file:** `src/pages/dashboard/TelehealthTeamPage.jsx`.
**Permissions:** super_admin, admin, assoc_director, regional_manager, pod_leader, care_coordinator (read-only), telehealth (self), director_payer_marketing (Yvonne).

```
TopBar: "Telehealth Team"
        subtitle: "{N} active patients · {M} visits this week · {K%} completion · {L} evals 48h-breach"

[ PeriodSelector — Week (Sun-Sat) / Month / Quarter / YTD — reuse Yvonne component ]

[ Team Roster card ]
  Row per clinician: Name | Role | Active patients | Visits in period | Completed | Cancelled | Missed | Completion % | Avg time to eval booking
  Bottom row: TEAM TOTAL

[ Tabs ]
  ▸ Today    ▸ This Week    ▸ Next Week    ▸ Last 4 Weeks    ▸ By Patient

[ Visit table — sortable, exportable ]
  Date | Time | Patient | Region | Clinician | Event Type | Status | SLA flag

[ Bottom panel: SLA scorecard (4 metrics) ]
  · Eval Booking SLA: % evals booked within 48h of Eval Pending (target ≥90%)
  · Eval Completion SLA: % scheduled evals completed (vs missed/cancelled)
  · Reassess Compliance: % patients reassessed within 45d (target ≥95%)
  · Cancellation Rate: telehealth-driven cancels (clinician-cancelled vs patient-cancelled)

[ Export to XLSX button — uses xlsx skill helper ]
```

### B4. Productivity threshold — recommendation

Liam asked whether telehealth should have a fixed "12 visits/week per clinician" threshold like the RMs. With the 6-clinician picture in hand, my answer gets sharper, not softer.

**Strong recommendation: hybrid model — per-clinician capacity target × team-level SLA accountability.** Reasoning:

- **A flat "12/wk per clinician" makes no sense given the 5.6× spread.** Abi (25.3/wk) hits "12" by Tuesday; Carrie (4.5/wk) never hits it. A flat target either makes top performers look like slackers or makes part-timers look like failures — neither is fair or useful.
- **But total-anarchy "team-level only" hides accountability.** With 6 clinicians, you can't tell from a team aggregate whether the team is healthy or whether 2 people are carrying 4. The page has to show per-clinician numbers, but the *judgment* about whether someone is on-target needs a per-clinician capacity input.
- **Proposed model:** Each clinician has a `weekly_visit_target` field on `coordinators` (default per FTE: 1.0 = 22/wk, 0.5 = 11/wk, 0.25 = 5/wk). The page shows actual vs. target per clinician. Team SLA metrics (eval 48h, reassess 45d, completion %) sit on top.
- **What actually matters clinically and operationally:** evals booked within 48h, reassessments completed before 45d, low cancel rate. Those team-level SLAs are non-negotiable. Per-clinician targets are management tools, not compliance tools.

**Two specific things the page would surface that nobody sees today:**

1. **The Carrie question.** 4.5 visits/week is either (a) intentional 0.2 FTE, (b) a region/insurance constraint, or (c) someone disengaging. The page can't answer it, but it makes Liam ask the question. Today nobody asks.
2. **The Liz question.** 74% completion is 11+ points below the team. Either she's getting handed the messy patients (in which case the assignment process needs review), or there's a coaching opportunity. Same logic — surface it, don't decide it.

**Need from Liam before Phase 2 build:** the FTE/weekly target for each of the 6 clinicians, OR explicit "use a default of 20/wk for everyone and ignore the gap for now" — either is fine, but I won't guess.

---

## C. Common to both pages

### C1. Permissions matrix

| Role | R+E Monitor | Telehealth Team |
|---|---|---|
| super_admin (Liam, director) | ✓ all regions | ✓ all regions |
| admin (Carla) | ✓ all regions | ✓ all regions |
| assoc_director (Lia/Samantha/Ariel) | ✓ assigned regions | ✓ all (team is org-wide) |
| regional_manager | ✓ assigned regions | ✓ read-only |
| pod_leader (Hervylie) | ✓ assigned regions | ✓ read-only |
| care_coordinator | ✓ assigned regions | ✓ read-only |
| auth_coordinator | ✓ assigned regions | — |
| telehealth (Alexis, Liz once added) | ✓ all regions | ✓ self-only view + team |
| director_payer_marketing (Yvonne) | ✓ all regions | ✓ all regions |

### C2. Shared query layer (the thing that prevents drift)

Build a single hook `src/hooks/useTelehealthData.js` that returns:

```
{
  evalsPending,            // census Eval Pending patients + booked-eval join
  reassessments,           // patient_clinical_settings rows
  telehealthVisits,        // visit_schedule_data filtered to telehealth
  teamRoster,              // coordinators where role='telehealth'
  slaMetrics,              // computed SLAs (eval 48h, reassess 45d, completion %)
  loading, error, refresh
}
```

Both pages consume this hook. All Pariox dedup, region scoping, and SLA math lives here, once.

Optionally back it with a Postgres view `v_latest_visit_per_slot` that pre-applies the per-(patient, date) latest-`uploaded_at` rule, so client-side dedup is unnecessary. Strongly recommend this — it'll fix every page in the codebase that currently re-implements the dedup, not just these two.

### C3. Sidebar placement

- **R+E Monitor:** stays in `CARE COORDINATION`, rename label "Scheduling Alerts" → "Reassessments & Evals". URL `scheduling-alerts` preserved.
- **Telehealth Team:** new entry in `CLINICAL DEPARTMENT`, slot it between "Clinician Schedule" and "SWIFT Team". URL `telehealth-team`.

### C4. Data quality risks to flag up front

- **5 of 6 telehealth clinicians not in `coordinators`** (Liz Seely, Abi Balogun, Marzina Tejani, Kelsey Downing, Carrie Lucero) — needs 5 INSERTs before build, or fallback to `staff_name IN (...)` matching with tech-debt flag.
- **No `weekly_visit_target` column on `coordinators`** — needs adding for the productivity model. One migration, additive, non-breaking.
- **`patient_clinical_settings` trigger logic** — must verify it uses per-(patient, date) latest-`uploaded_at` for `next_visit_scheduled` / `alert_no_visits_scheduled`. If not, the existing reassessment counts are slightly off. Will audit before build starts.
- **Census status typos** ("Active - Auth Pendin", "Discharge - Change I") are already in the data — normalize on read in the shared hook.
- **The 28 Eval Pending count includes "TEST Account, TRAINING"** — filter test patients out.
- **`Initial Assessment *e*` (1 row)** — single legacy event_type, include it in eval detection.

---

## D. Gating questions for Liam (decide before Phase 2)

1. **R+E split: one page two tabs (my recommendation), or two separate pages?** I'd push hard for one — same user, same SLA model, same clinician owners.
2. **Add the 5 missing telehealth clinicians (Liz, Abi, Marzina, Kelsey, Carrie) to `coordinators` as `role='telehealth'` before build?** Recommend yes — need their work emails. If you'd rather ship v1 fast, we hard-code the team list with a TODO and add them in v2.
3. **Telehealth productivity model: hybrid per-clinician target × team-level SLA (my recommendation), or flat 12/wk per clinician, or pure team-level?** Hybrid is the right answer for a 6-person team with a 5.6× workload spread. Need each clinician's FTE/weekly target — or default everyone to 20/wk and treat the gap as a finding, not a fault.
4. **Is the 48-hour eval SLA wall-clock or business hours?** The workflow doc says 48h from Auth Pending → Eval Pending. If a transition happens 3pm Friday, is the deadline Sunday 3pm or Tuesday 3pm? Recommend wall-clock (simpler, more conservative).
5. **Care coord notification surface for 48h eval breaches: in-page banner + AlertsBell (my recommendation), or also email/Slack?** Pushing for in-app only to avoid email fatigue.
6. **Should the shared Postgres view `v_latest_visit_per_slot` be built as part of this work?** Costs 30 min, fixes drift risk across the whole codebase. I'd say yes and bill it under this project.

---

## E. Build estimate (for Phase 2 sizing only)

- R+E Monitor redesign: 1 day (mostly preserves existing FrequencyModal + status engine; adds Evaluations tab + EvalScheduleModal)
- Telehealth Team page: 1 day (new page, but leans on shared hook)
- Shared hook + Postgres view: 0.5 day
- Permissions + sidebar + testing: 0.5 day
- **Total: ~3 days work, single ship to main with feature-flag toggle for safety.**

---

**Approval needed on:** the 6 gating questions above + the recommendation to keep R+E as a single page. Once Liam answers (or says "go" and accepts the defaults), Phase 2 starts.
