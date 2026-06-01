# Payroll Review & Audit — Phase 1 Design

**Status:** Design proposal, not built. Awaiting Liam sign-off before any code or schema change.
**Author:** Claude (top-0.1% advisor mode), 2026-06-01
**Owner:** Liam O'Brien, Director of Operations
**Scope target:** New "PAYROLL & FINANCE" section in EdemaCare Ops, gated to super_admin / admin (Liam + Carla initially)

---

## 0. TL;DR for Liam

You want one weekly screen that says *"these clinicians' paychecks look wrong — go look."* That requires reconciling three independent sources you don't currently have a join key for:

1. **Paylocity** — clock hours, PTO, OT, training (no Cowork connector exists; we'd build a direct Edge Function calling the Paylocity REST API after you provision access)
2. **A mileage app** — *you haven't told me which one yet*, and that single answer changes the effort estimate by ~1-2 weeks
3. **Pariox visits** — already in `visit_schedule_data`, but **visits have no stored duration**. ~58% of recent rows have a parseable time range ("0700 - 0815"); the other ~42% are a single time like "8:00". We'll need an event_type → assumed-duration lookup table, which is an editable config not a one-time choice.

I am recommending we **not** try to integrate Paylocity in v1. Instead, do v1 as a manual weekly XLSX import (same pattern as `AuthAuditImportPage.jsx`) and prove the reconciliation logic catches real fraud/error before we spend 1-2 weeks building the API integration. **Reverse the order from the original ask** — that's the most defensible posture and gets you a working tool in days instead of weeks.

Below: the questions you need to answer before any build, the recommended scope, the schema, the flag rules, the UI, and the effort estimates. Time to read end-to-end: ~12 minutes.

---

## 1. Open questions — answer these before any build

I'm including my recommended default in bold. If you don't answer, I'll proceed with the default.

| # | Question | My recommended default |
|---|---|---|
| 1 | Which mileage tracker app does the staff currently use? | **Tell me** — this is a hard blocker for any live integration. If it's a custom Google Form or spreadsheet, v1 is an XLSX import; if it's MileIQ/TripLog/Everlance, v1 is still an XLSX import (they all support weekly CSV/XLSX export) and v2 considers API access. |
| 2 | Do you have Paylocity admin rights to submit a Web Services Access Request? | **Submit it now, in parallel.** It typically takes 2-4 weeks to enable. Phase 1 doesn't need it, but starting the clock is free. Reference: [Paylocity Web Services Access Request](https://docs.paylocity.com/Knowledge/Partner%20Integration/Paylocity_Web_Services_Access_Request.pdf). |
| 3 | What hours/visit assumption should we use? Is duration uniform by visit type? | **Default: Maintenance = 45 min, Level 2/3/4/5 + Evaluation = 60 min, Cancelled/Attempted = 0 min.** Made editable in `payroll_flag_rules` config table so you can tune without a code change. Drive time/charting/documentation between visits — add a fixed 15 min/visit "overhead" allowance separately. |
| 4 | Should a flag block payroll, or just notify? | **Notify only in v1.** Hard-blocking creates pressure on you to clear flags before Paylocity's processing deadline, and v1 is a learning phase. v2 can add a "hold payroll" workflow once you trust the rules. |
| 5 | Who reviews — just you, or Carla / HR too? | **You + Carla.** Carla = `admin` (already has access to Audit Import). Page gated to `super_admin` (Liam) and `admin` (Carla). RLS not needed yet; both can see all rows. |
| 6 | Is there an existing review workflow today? | **Tell me.** If yes, v1 must mirror it (don't ask Carla to learn a new tool). If no, the design below is greenfield. |
| 7 | What's the pay cadence — weekly, bi-weekly, semi-monthly? | **Assuming bi-weekly** (Paylocity default for healthcare ops). The page should support a "pay period" selector that defaults to the most recent closed period but can also show a single Sun-Sat week for early detection. |
| 8 | Do clinicians submit timesheets only, or do they self-attest visit completion in Paylocity? | **Tell me.** If Paylocity time = clock hours only (no per-visit attestation), Pariox is the ground truth for visit volume. If Paylocity has per-visit codes, we have a richer reconciliation. |
| 9 | Are training hours and PTO already in Paylocity, or in a separate LMS / HR system? | **Default: in Paylocity** (Paylocity has Learning module and PTO module). If LMS is separate, training reconciliation is v3. |
| 10 | Mileage rate paid — IRS standard ($0.67/mi for 2026, or whatever your reimbursement policy uses)? | **$0.67/mi default**, configurable. Dollar-at-risk calculations need this. |

**If I were you, I'd batch-answer 1, 6, 8, 9 by Slack reply and consider 2 actioned today.** The rest I can run with defaults.

---

## 2. Scope I am recommending (counter-proposal)

The original ask is "weekly flagging across three sources." I'm pushing back on doing all three integrations at once. Here's the staged scope:

### Stage 1 — Manual XLSX import + reconciliation (2-3 days, ~$0 vendor cost)
- Liam (or Carla) exports the weekly Paylocity time-summary report as XLSX.
- Exports mileage from whatever app the staff uses (or paste from form).
- Uploads both into `PayrollReviewPage` — model on `AuthAuditImportPage.jsx`.
- App joins them against `visit_schedule_data` for the same Sun-Sat week.
- Runs the flag rules. Shows the table. You review.
- This gets you a **working flag system in 3 days**, validates the rules, and lets you keep payroll moving while we wait on Paylocity API enablement.

### Stage 2 — Paylocity API automation (1-2 weeks, after Paylocity Web Services approval)
- Edge Function pulls time-card data automatically each Monday morning.
- Removes the manual export step.
- Adds employee-master sync so we don't have to maintain `clinician_payroll_map` by hand.

### Stage 3 — Mileage API automation (1 week, if/when staff app supports it)
- Same pattern: Edge Function pull → reconcile → flag.
- Optional. If staff move to a paper/Google Form process this never happens.

### Stage 4 — Closed-loop workflow (1 week)
- Approve / hold / send-back-to-clinician actions
- Email notification to clinician via Resend (`@axiomhealthmanagement.com`)
- Audit trail of reviewer + decision in `payroll_reviews.status`

### What I'm explicitly **not** putting in v1
- Geocoded mileage reconciliation (visit-to-visit driving distance estimation). It's tempting but it's a project — Google Maps API quota, geocoding all patient addresses, handling P.O. boxes, accounting for the clinician's home as a start point. Defer to v3 if at all.
- Training hours reconciliation against an LMS unless you confirm one exists in scope.
- Anything that writes back to Paylocity (corrections, adjustments). Out of scope — a writeback bug becomes payroll fraud risk.

---

## 3. Data sources & data model

### 3.1 Pariox — what we have (and what we don't)

`visit_schedule_data` (verified via Supabase query 2026-06-01):

| Field | Type | Notes |
|---|---|---|
| `staff_name` | text | "Aguilar, Isaac" — needs mapping to Paylocity employee_id |
| `staff_name_normalized` | text | Already normalized; use this as the join key |
| `visit_date` | date | Reliable |
| `visit_time` | text | Freeform: "1530 - 1645", "0700 - 0815", "8:00", sometimes blank. ~21% range / ~42% single / ~37% other in last month. |
| `event_type` | text | Maintenance, Level 2/3/4/5, Evaluation, Cancelled Treatment, Attempted Visit, +PDF variants |
| `status` | text | Completed / Scheduled / Cancelled / Missed. **CRITICAL: Pariox stores cancelled-as-status="Completed" + event_type="Cancelled Treatment".** Use `isCompleted()` from `src/lib/visitMath.js:67`, not raw string check. |
| `discipline` | text | LYMPHEDEMA PT / PTA / OT |

**What's missing for payroll:**
- No stored duration field. Solution: a `visit_duration_assumptions` config table keyed on `event_type` (or `event_type` pattern). Default: Maintenance 45 min, Level 2-5 + Eval 60 min, Cancelled/Attempted 0 min. Editable through Settings.
- No clinician → Paylocity employee_id mapping. Solution: `clinician_payroll_map` table — small (≤30 rows). Seeded manually, maintained when staff onboard.
- `visit_time` parseability — only ~21% have a parseable range. Recommended approach: prefer parsed range when available, otherwise fall back to event-type assumption.

### 3.2 Paylocity — what we'd pull

Paylocity Web Services REST API endpoints we'd need ([Paylocity dev portal](https://developer.paylocity.com/integrations/docs/common-use-cases-partners)):
- `GET /api/v2/companies/{cid}/employees` — employee master + active/terminated status
- `GET /api/v2/companies/{cid}/timecards?startDate=...&endDate=...` — daily punches by employee
- `GET /api/v2/companies/{cid}/employees/{eid}/earnings?payDate=...` — earnings categories (Regular, Overtime, Training, PTO, Holiday)
- PTO balance is in `/employees/{eid}/pto` per `[Time Entry → Payroll Batch endpoint](https://paylocity.egain.cloud/system/templates/selfservice/pctycss/help/customer/locale/en-US/portal/308600000001020/content/PCTY-126374/Utilize-Time-Entry-Information-to-Create-a-Payroll-Batch-via-API)`

**Authentication:** OAuth2 client_credentials. Paylocity issues client_id + client_secret after Web Services Access Request approval. Stored in Supabase Vault, accessed only by Edge Function.

**Caveat:** Paylocity is **read-only** in this design. We do not write back. This is a firm constraint — Liam should reject any future scope creep that wants to do payroll adjustments via API.

### 3.3 Mileage — TBD until Liam confirms app

Three scenarios and the work each implies:

| Scenario | Effort |
|---|---|
| **Paper / Google Form / spreadsheet** | v1 = paste/upload XLSX (1 day). No API needed. |
| **MileIQ / TripLog / Everlance** | All three offer weekly XLSX export. v1 = XLSX upload (1 day). v2 = API integration *if* a free/cheap tier exists; otherwise stay on XLSX. |
| **Custom mobile app the team built** | Need API access details. Could be hours or weeks depending on what's there. |

### 3.4 Proposed schema additions (DDL not run yet)

```sql
-- Pay period (Sun-Sat or bi-weekly Sun-Sat × 2)
CREATE TABLE payroll_periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start  date NOT NULL,    -- Sunday
  period_end    date NOT NULL,    -- Saturday (or Sat 2 weeks later)
  cadence       text NOT NULL DEFAULT 'weekly',  -- 'weekly' | 'biweekly'
  status        text NOT NULL DEFAULT 'open',    -- 'open' | 'in_review' | 'closed'
  opened_at     timestamptz DEFAULT now(),
  closed_at     timestamptz,
  closed_by     uuid REFERENCES coordinators(id),
  UNIQUE (period_start, period_end)
);

-- One row per clinician per pay period
CREATE TABLE payroll_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id         uuid REFERENCES payroll_periods(id) ON DELETE CASCADE,
  clinician_id      uuid REFERENCES coordinators(id),
  staff_name_normalized text NOT NULL,  -- fallback join key for Pariox
  paylocity_data    jsonb,    -- raw clock hours, OT, PTO, training breakdown
  mileage_data      jsonb,    -- raw mileage submission
  pariox_summary    jsonb,    -- {visits_completed, visits_cancelled, estimated_clinic_hours, by_day}
  flags             jsonb,    -- array of {rule_id, severity, message, dollar_impact}
  status            text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'hold' | 'sent_back'
  reviewer_notes    text,
  reviewed_by       uuid REFERENCES coordinators(id),
  reviewed_at       timestamptz,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (period_id, staff_name_normalized)
);

-- Editable flag rules (so Liam can tune thresholds without a deploy)
CREATE TABLE payroll_flag_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key    text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  threshold   jsonb,         -- e.g., {variance_pct: 20}
  severity    text NOT NULL, -- 'soft' (yellow) | 'hard' (red)
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz DEFAULT now()
);

-- Editable visit-duration assumptions (event_type pattern → minutes)
CREATE TABLE visit_duration_assumptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_pattern text UNIQUE NOT NULL,  -- e.g., 'Maintenance', 'Level%', 'Evaluation', 'Cancelled%'
  minutes     int NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

-- Bridge table — Pariox staff_name to Paylocity employee_id
CREATE TABLE clinician_payroll_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordinator_id  uuid REFERENCES coordinators(id),
  staff_name_normalized text UNIQUE NOT NULL,
  paylocity_employee_id text UNIQUE,
  mileage_app_user_id   text,
  hourly_rate     numeric(8,2),     -- optional, for dollar-impact calculations
  is_active       boolean NOT NULL DEFAULT true
);
```

All five tables use `coordinators.id` for FKs (not `auth.uid()`). RLS in v1: super_admin + admin only. If RLS is added later, join through `coordinators.user_id` per the project convention in `CLAUDE.md`.

---

## 4. Flag rules — what counts as "doesn't seem right"

All rules read from `payroll_flag_rules` so thresholds are editable. Severity colour: soft = yellow (review recommended), hard = red (review required).

| Rule | Trigger | Default threshold | Severity | Dollar-impact calc |
|---|---|---|---|---|
| `hours_variance_high` | Paylocity clock hours > Pariox-implied hours by N% | 20% | hard | (clock_hrs − pariox_hrs) × hourly_rate |
| `hours_variance_low` | Paylocity clock hours **less** than Pariox-implied hours by N% | 20% | soft | clinician underreporting — wage-and-hour risk; flag for HR |
| `ot_no_volume` | OT hours > 0 AND completed-visits WoW change ≤ 0% | n/a | hard | OT_hrs × hourly_rate × 1.5 |
| `pto_with_visits` | PTO claimed on day D AND visits completed on day D | 1+ visit | hard | day's PTO + day's visit revenue |
| `mileage_without_visits` | Mileage claimed on day D AND 0 visits on day D | any | hard | miles × $0.67 |
| `zero_visits_no_pto` | Zero completed visits in pay period AND no PTO/training claimed | n/a | hard | full clock hours × rate |
| `training_hours_unlogged` | Training hrs claimed but no training event record | requires training table — v3 | soft | training_hrs × rate |
| `mileage_outlier` | Claimed miles > P95 of clinician's rolling-8-week median by N× | 2× | soft | excess miles × $0.67 |

Total dollar-at-risk = sum of per-row dollar-impact. That number drives the KPI strip at the top of the page so Liam can see how much money is questionable this week.

**Soft vs hard threshold reasoning:** soft flags trigger review but don't block; hard flags require an explicit "Approve anyway" with a note (logged to `payroll_reviews.reviewer_notes`).

---

## 5. UI design

### 5.1 Sidebar placement

New section: `PAYROLL` (single word — matches existing all-caps convention in `Sidebar.jsx:13-23` and the DB constraint that `page_section` strings match verbatim). Inserted between `PERFORMANCE` and `ADMIN`.

Two pages in v1:
- `payroll-review` — "Payroll Review" — the main weekly table
- `payroll-settings` — "Payroll Rules" — admin-only, edits `payroll_flag_rules` + `visit_duration_assumptions` + `clinician_payroll_map`

Page permissions seed:
```sql
INSERT INTO page_permissions (page_section, page_key, page_label, sort_order, super_admin, admin)
VALUES ('PAYROLL', 'payroll-review',   'Payroll Review', 100, true, true),
       ('PAYROLL', 'payroll-settings', 'Payroll Rules',  900, true, false);
```

Add `'PAYROLL'` to `ALL_SECTIONS` in `Sidebar.jsx:13-23` between PERFORMANCE and ADMIN, plus page icons in `PAGE_ICONS` (lines 25-44).

### 5.2 Payroll Review page layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  Payroll Review — [Pay Period: May 24 - Jun 6, 2026 ▾]  [Sun-Sat ▾]    │
├────────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │ Clinicians │ │ Flagged    │ │ $ at risk  │ │ Approved   │           │
│  │    23      │ │    6  (26%)│ │  $4,820    │ │  17 / 23   │           │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │
├────────────────────────────────────────────────────────────────────────┤
│  Upload Paylocity XLSX  [📤]    Upload Mileage XLSX  [📤]               │
│  Last imported: Paylocity 2026-06-01 09:14 by Liam | Mileage —          │
├────────────────────────────────────────────────────────────────────────┤
│  Clinician    │ Clock | Pariox  │ OT  │ PTO │ Mileage │ Flags │ Status │
│  ─────────────┼───────┼─────────┼─────┼─────┼─────────┼───────┼────────│
│  Aguilar, I.  │ 38.5h │ 12 v / 9h│ 0h  │ 0h  │ 142 mi  │ 🔴 2  │ pending│
│  Davis, S.    │ 40.0h │ 18 v /13.5│0h  │ 8h  │ 89 mi   │ 🟡 1  │ pending│
│  Manaay, H.   │ 40.0h │ 22 v /16.5│0h  │ 0h  │ 167 mi  │ ✓     │ approved│
│  ...                                                                    │
├────────────────────────────────────────────────────────────────────────┤
│  [Export selected] [Approve all clear] [Close pay period]               │
└────────────────────────────────────────────────────────────────────────┘
```

Click any row → side drawer with day-by-day breakdown:

```
┌──── Aguilar, Isaac — May 24-30 ────────────────────────────────────────┐
│ Day  │ Clock │ Visits │ Pariox hrs │ Mileage │ PTO │ Flag             │
│ Sun  │ 0     │ 0      │ 0          │ 0       │ 0   │ —                │
│ Mon  │ 8.5   │ 4      │ 3.5        │ 28      │ 0   │ 🔴 -5h variance  │
│ Tue  │ 8.0   │ 3      │ 2.75       │ 22      │ 0   │ 🔴 -5.25h        │
│ Wed  │ 0     │ 0      │ 0          │ 18      │ 0   │ 🔴 mileage/no-vis│
│ Thu  │ 8.0   │ 2      │ 1.75       │ 24      │ 0   │ 🔴 -6.25h        │
│ Fri  │ 8.0   │ 2      │ 1.75       │ 26      │ 0   │ 🔴 -6.25h        │
│ Sat  │ 6.0   │ 1      │ 0.75       │ 24      │ 0   │ 🔴 -5.25h        │
│ ──── │ ───── │ ─────  │ ──────     │ ─────   │ ─── │                  │
│ Total│ 38.5  │ 12     │ 10.5       │ 142     │ 0   │ -28h gap         │
│                                                                         │
│ Estimated $ at risk: 28h × $32/hr = $896                                │
│                                                                         │
│ Reviewer notes: ______________________________                          │
│                                                                         │
│ [Approve] [Hold for review] [Send back to clinician]                    │
└────────────────────────────────────────────────────────────────────────┘
```

The "Send back to clinician" action sends a Resend email from a `@axiomhealthmanagement.com` mailbox (existing infra — DKIM/SPF verified on that domain per `CLAUDE.md`).

### 5.3 Conventions to reuse

- Week selector: `src/components/WeekSelector.jsx` (Sun-Sat already correct)
- Week helpers: `getWeekStart` / `getWeekEnd` / `getWeekRange` from `src/lib/dateUtils.js`
- Visit math: `isCompleted`, `isCancelled`, `dedupEncounters`, `classifyVisits` from `src/lib/visitMath.js`
- Pagination: `fetchAllPages` from `src/lib/supabase.js` — required because `visit_schedule_data` > 5K rows per `CLAUDE.md`
- Activity logging: `logActivity` from `src/lib/supabase.js`
- Modal pattern: `src/components/StatusChangeModal.jsx`
- Upload pattern: `src/pages/AuthAuditImportPage.jsx` — stage → diff → preview → apply
- No inline unicode in JSX text (use `{'✓'}` if needed)

---

## 6. Effort estimate (be specific)

| Piece | Effort | Risk |
|---|---|---|
| Schema (5 tables) + seed data | 0.5 day | Low |
| Sidebar + page_permissions wiring | 0.5 day | Low |
| XLSX upload + parse for Paylocity export | 1 day | Med — depends on Paylocity report format |
| XLSX upload + parse for mileage | 0.5–1 day | Med — depends on app (Q1) |
| Pariox reconciliation engine | 1 day | Low — math is well-understood, helpers exist |
| Flag rules engine | 0.5 day | Low |
| Main table UI + KPI strip | 1 day | Low |
| Day-by-day drawer | 0.5 day | Low |
| Approve/Hold/Send-back actions + Resend email | 0.5 day | Low |
| **Stage 1 subtotal** | **5.5–6 days** | |
| Paylocity Web Services Access Request | 0 dev days; 2-4 wk Paylocity-side wait | High — outside our control |
| Paylocity OAuth2 + Edge Function | 2 days | Med |
| Paylocity timecard pull + employee sync | 2 days | Med |
| Replace XLSX import with API pull | 1 day | Low |
| **Stage 2 subtotal** | **5 dev days + Paylocity wait** | |
| Mileage API (only if app supports it) | 2-5 days | TBD on Q1 |
| Closed-loop workflow polish | 2-3 days | Low |
| **Stage 4 subtotal** | **2-3 days** | |
| **Total to feature-complete v2** | **~13-20 dev days** + Paylocity enablement wait | |

**Reality check for Liam:** the original ask sounded like "build this in a sprint." Honest answer is it's 3-4 weeks of focused work to get Stages 1+2 done, *plus* the Paylocity enablement wait which is outside our control. Stage 1 alone is 5-6 days and gives you 80% of the value.

---

## 7. Risks I want flagged before we start

1. **Pariox visit duration is an assumption, not a measurement.** Every flag based on hours variance is therefore an *estimate*. If a clinician disputes a flag, you have to be able to show the assumption used and why. The day-by-day drawer should show "estimated" explicitly, never "actual."
2. **Wage-and-hour law.** The `hours_variance_low` rule (clinician working unreported time) is a legal exposure if you don't follow up. FLSA requires you to pay for hours worked even if not clocked. This is HR/legal territory — Liam should loop in counsel before that flag goes live.
3. **Pariox data lag.** Pariox uploads are batched. If a clinician's visits for Friday don't hit `visit_schedule_data` until Monday, the Sunday-night payroll review will under-count visits and over-flag. Mitigation: don't run the reconciliation until at least 48h after the period ends.
4. **Co-treat visits.** PT + PTA on the same patient/date = one encounter for revenue but **two clinicians clocked.** `dedupEncounters` in `visitMath.js:82` collapses them for billing but does NOT collapse them for per-clinician productivity, which is what we want for payroll. Confirm both clinicians have their visit row.
5. **Cross-week scheduling.** A visit scheduled at 23:30 on Saturday that ends at 00:45 Sunday — does it count to which week? Default: count by start time (already in `visit_date`).
6. **The 22 `@axiomhealthmanagement.com` coordinator rows** stay as-is per `CLAUDE.md`. Don't rename. Map them via `clinician_payroll_map`.
7. **Vercel preview deploys** can be public — no Paylocity creds in env vars for previews; only in production.

---

## 8. What I need from Liam to greenlight build

A reply that says **"go with the recommended defaults, except question N where I want X"** is enough. Specifically:
- Confirm Q1 (mileage app)
- Confirm or override Q3 (duration assumptions)
- Confirm Q6 (existing workflow today)
- Confirm Stage 1 first, Stage 2 later (counter-proposal in §2)

Anything else, I'll proceed with the bold defaults in §1.

When you greenlight, Phase 2 build order will be: schema migration → sidebar wiring → XLSX import → reconciliation engine → table UI → drawer → workflow actions. Roughly 5-6 dev days for Stage 1 as scoped.

---

*This is a design doc, not an implementation plan. No code, schema, or config has been changed. The `~/Documents/GitHub/edemacare-ops` working tree is untouched as of 2026-06-01.*
