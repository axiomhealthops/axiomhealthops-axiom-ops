# Marketing CRM Outreach Tracker — Phase 1 Audit + Phase 2 Design

**Author:** Claude (top-0.1% business-advisor mode, per Liam's instruction)
**Date:** 2026-05-29 (updated same day after roster cleanup pass)
**Status:** PROPOSAL — no code written. Blocker #1 (roster) resolved. 5 blockers remain.
**Repo:** `~/Documents/GitHub/edemacare-ops`
**Supabase project:** `axiom-ops` (`kndiyailsqrialgbozac`)

---

## TL;DR — read this first

You asked me to build a CRM-style outreach tracker. **You already have one.** It's
called Marketing CRM, it's live in the sidebar, the tables exist, and Carla / the
ADs already have access. Before we spend hours rebuilding, the real decision is:

> **Do we extend the existing Marketing CRM, or rip-and-replace?**

My strong recommendation: **extend, don't replace.** The current schema covers
~60% of what you asked for. The remaining 40% is real work (rep attribution,
special projects, outcome scale, in-service vs lunch-n-learn taxonomy, phone-call
distinct from visit, RLS hardening). All of it fits as additive columns + one new
lookup table + UI changes. Doing it as an extension preserves the 1 contact + 1
encounter already in there (created by you on May 28), keeps the sidebar entry,
keeps the existing page_permissions row, and ships in roughly half the hours of a
greenfield rewrite.

Three other things you should know before reading the rest:

1. **The "RMP" roster is half what you thought.** You named 14 RMPs; 7 are real
   coordinators (Uma, Earl, Hollie, Kaylee as `regional_manager`; Lia, Ariel,
   Samantha as `assoc_director`). The other 7 (Nicholas Santago, Robert Sockol,
   Briana Kidd, Carrie Nyugen, Johnny Campbell, Phyleischa Owen, Sean Houseman)
   are **confirmed former employees per Liam (2026-05-29)** and have already
   been fully removed — no coordinator row, no auth.users row, no historical
   activity in any data table. Cleanup pass complete; see §1.6.
2. **Regions O and R don't exist** anywhere in the data model. Active regions in
   the live DB are A, B, C, G, H, I, J, M, N, T, V. The `REGIONS` map in
   `src/lib/constants.js` is missing I (CLAUDE.md is stale on the same point).
3. **There is no `marketing_rep` / `RMP` role in the system.** The people you
   call RMPs are `regional_manager` (4 active) and `assoc_director` (3 active).
   That's fine if marketing is a hat they wear, but if you actually want a
   dedicated marketing role with marketing-only sidebar access, that's a new
   role to add to `page_permissions` and `useAuth`.
4. **Region I is uncovered** at the RM/AD level. Sean Houseman was the only
   person tied to it; with him gone, no active coordinator has I in their
   regions array. This is the single urgent coverage gap. See §1.6.

---

## Phase 1 — Audit (what's actually in the system right now)

### 1.1 Existing Marketing surface

| Surface | Status | Notes |
|---|---|---|
| Sidebar section `MARKETING` | EXISTS | One page only: `marketing-crm` ("Marketing CRM"), sort_order 600 |
| `src/pages/dashboard/MarketingCRMPage.jsx` | EXISTS (519 lines) | 3 tabs: Contacts / Encounter Log / Follow-Ups. KPI strip. Filter bar. Modals for contact + encounter. |
| Table `public.marketing_contacts` | EXISTS | 20 columns. PK uuid. `region` text, no FK. |
| Table `public.marketing_encounters` | EXISTS | 13 columns. `contact_id` uuid FK to marketing_contacts. |
| `page_permissions` row `marketing-crm` | EXISTS | Allowed: super_admin, admin, regional_manager, assoc_director. Blocked: everyone else. |
| RLS on both marketing tables | EXISTS but coarse | One policy each: `Active coordinators full access` using `is_active_coordinator()`. **Any active coordinator can read/write all rows regardless of region.** |
| Region scoping | App-layer only | Page uses `useAssignedRegions().applyToQuery(...)` to filter. |
| Realtime subscriptions | EXISTS | `useRealtimeTable(['marketing_contacts','marketing_encounters'], load)` |

#### Existing `marketing_contacts` schema
```
id              uuid PK
contact_type    text NOT NULL  -- PCP / Podiatrist / Hospital / Specialist / Wound Care / Orthopedic / Vascular / Cardiology / Neurology / Assisted Living / SNF / Home Health Agency / Other
practice_name   text NOT NULL
contact_name    text
title           text
phone, email    text
address, city   text
state           text default 'FL'
zip             text
region          text  -- single letter, no FK
npi             text
referral_potential   text default 'medium'   -- high / medium / low
active_referral_source boolean default false
notes           text
assigned_to     text   -- free text, not an FK!
created_by      text   -- free text, not an FK!
created_at, updated_at  timestamptz
```

#### Existing `marketing_encounters` schema
```
id                    uuid PK
contact_id            uuid (FK by name to marketing_contacts.id — no formal constraint in this schema dump)
encounter_type        text NOT NULL  -- In-Person Visit / Phone Call / Drop-In / Lunch & Learn / Event / Email / Referral Received / Follow-Up / Other
encounter_date        date NOT NULL default CURRENT_DATE
conducted_by          text NOT NULL    -- free text, not an FK!
region                text             -- duplicated from contact (denormalized)
summary               text
outcome               text             -- free text
referrals_received    int default 0
follow_up_date        date
follow_up_notes       text
follow_up_completed   boolean default false
created_at            timestamptz
```

### 1.2 RMP roster reality check (real roster only)

The seven active coordinators who do marketing-rep work today:

| Name | Role | Regions assigned | Email |
|---|---|---|---|
| Uma Jacobs | regional_manager | [A] | uma@axiomhealthmanagement.com |
| Earl Dimaano | regional_manager | [C] | earl@axiomhealthmanagement.com |
| Kaylee Ramsey | regional_manager | [H] | kaylee@axiomhealthmanagement.com |
| Hollie Fincher | regional_manager | [J] | hollie.fincher@axiomhealthmanagement.com |
| Lia Davis | assoc_director | [B, C, G] | lia.borio@axiomhealthmanagement.com |
| Ariel Maboudi | assoc_director | [A, H, M, N] | arielm@axiomhealthmanagement.com |
| Samantha Faliks | assoc_director | [J, T, V] | samantha@axiomhealthmanagement.com |

The seven names from your earlier brief that are NOT in the system (per your
2026-05-29 confirmation they're former employees): Nicholas Santago, Robert
Sockol, Briana Kidd, Carrie Nyugen, Johnny Campbell, Phyleischa Owen, Sean
Houseman. Cleanup audit in §1.6.

Active coordinator roles in DB (counts): admin 5, regional_manager 4, care_coordinator 4, auth_coordinator 3, assoc_director 3, super_admin 1, pod_leader 1, intake_coordinator 1. **There is no role `marketing_rep`, `rmp`, `marketing_manager`, or anything like it.**

### 1.3 Existing data

```
marketing_contacts:    1 row  -- "Axiom Corporate" (Home Health Agency, Region A), created by you 2026-05-28
marketing_encounters:  1 row  -- Phone Call on 2026-05-28, conducted by you, follow-up 2026-06-01
```

That's it. There's no real data to preserve — these are test rows. Migration is
trivial regardless of whether we extend or rebuild.

### 1.4 Security gap (worth flagging)

Both tables have only one RLS policy: `Active coordinators full access`. That
means any active coordinator — including `care_coordinator`, `auth_coordinator`,
`intake_coordinator`, `clinician` if they had an account — can read and write
every row in both tables via direct API. The sidebar hides the page from those
roles via `page_permissions`, but the API doesn't. **This is a real data-leakage
risk** and should be tightened as part of this work regardless of which path we
take.

### 1.5 Region dictionary discrepancies (decide before build)

| Source | Regions listed |
|---|---|
| `coordinators.regions` (live data) | A, B, C, G, H, **I**, J, M, N, T, V (11) |
| `REGIONS` map in `src/lib/constants.js` | A, B, C, G, H, J, M, N, T, V (10 — missing I) |
| `MarketingCRMPage.jsx` constant | A, B, C, G, H, J, M, N, T, V (10 — missing I) |
| Your spec (this brief) | A, B, C, G, H, J, M, N, **O**, **R**, T, V (12 — has O, R; missing I) |
| `CLAUDE.md` | A, B, C, G, H, J, M, N, T, V (10 — missing I) |

We need ONE source of truth. My recommendation: live DB wins (A–V minus skips,
including I). Fix the constants + CLAUDE.md as part of this work. **Reject O
and R** unless you can tell me what geography they refer to and whether a
coordinator should be assigned to them.

### 1.6 Departed-RMP cleanup audit (2026-05-29)

Per Liam's confirmation that the seven names are former employees, ran a full
sweep. **Nothing to deactivate — they were already fully removed before today's
audit, or were never in the system in the first place.**

| Location | Result | Action taken |
|---|---|---|
| `coordinators` (name + email regex) | 0 rows | None needed |
| `auth.users` (email + raw_user_meta_data.full_name regex) | 0 rows | None needed (no session to revoke, no row to ban) |
| `auth_tracker.assigned_to` | 0 hits | None needed |
| `auth_tracker.updated_by` | 0 hits | None needed |
| `intake_referrals.updated_by` | 0 hits | None needed |
| `intake_referrals.referral_source` | 0 hits | None needed |
| `census_data.updated_by` | 0 hits | None needed |
| `census_data.pipeline_assigned_to` | 0 hits | None needed |
| `census_data.frequency_reviewed_by` | 0 hits | None needed |
| `visit_schedule_data.staff_name` | 0 hits | None needed |
| `coordinator_activity_log.coordinator_name` | 0 hits | None needed (no historical activity exists for any of them) |
| `marketing_contacts.created_by` / `assigned_to` | 0 hits | None needed |
| `marketing_encounters.conducted_by` | 0 hits | None needed |
| `CLAUDE.md` | 0 mentions | None needed |
| `src/` (excluding node_modules) | 0 real matches; 1 false positive in `ClinicianAccountabilityPage.jsx` line 48 (a comment listing "Nick/Nicholas" as a generic clinician-aliasing example, unrelated to Nicholas Santago) | None — false positive |
| `MARKETING_CRM_DESIGN.md` (this doc, pre-update) | 7 mentions in the old roster table | Edited out in this revision |
| Other repo docs / migrations / scripts / public | 0 matches | None needed |

There is one thing this finding implies that you should sit with: **none of
these seven people ever logged anything traceable in the operations system.**
Zero auth updates, zero census updates, zero scheduled visits, zero activity-log
rows, zero marketing contacts. Either they predated the platform, or their
marketing work was entirely happening in someone else's head (texts, calls,
spreadsheets). The platform never saw it. That is, in itself, a finding worth
acting on — going forward, attribution at the rep level is the whole point of
this CRM, and the seven current RMPs need to know that "if it's not in the CRM,
it didn't happen" is the new operating rule.

No reassignments needed: there are zero patients, auths, intakes, or
census entries whose last touch was a departed RMP. Nothing to hand off.

### 1.7 Region coverage report (orphan analysis)

Live coverage across all 11 active regions, RM + AD only:

| Region | Dedicated RM | AD acting | Coverage status |
|---|---|---|---|
| A | Uma Jacobs | Ariel Maboudi | Fully covered |
| B | — | Lia Davis | AD-acting only (no dedicated RM) |
| C | Earl Dimaano | Lia Davis | Fully covered |
| G | — | Lia Davis | AD-acting only (no dedicated RM) |
| H | Kaylee Ramsey | Ariel Maboudi | Fully covered |
| **I** | **— (none)** | **— (none)** | **ORPHANED — no RM, no AD** |
| J | Hollie Fincher | Samantha Faliks | Fully covered |
| M | — | Ariel Maboudi | AD-acting only (no dedicated RM) |
| N | — | Ariel Maboudi | AD-acting only (no dedicated RM) |
| T | — | Samantha Faliks | AD-acting only (no dedicated RM) |
| V | — | Samantha Faliks | AD-acting only (no dedicated RM) |

**The one urgent finding: Region I has nobody.** No active `regional_manager` or
`assoc_director` has I in their `coordinators.regions` array. Sean Houseman was
the only person attached to it; now that he's gone, marketing outreach for that
territory has no rep to attribute to and no manager scope-covering it. **This
needs a recruitment / reassignment decision before the CRM goes live**, or any
outreach logged in Region I will fail your role-scoping rules.

The other six gaps (B, G, M, N, T, V are AD-acting) are consistent with the
2026-05-15 reorganization noted in CLAUDE.md / constants.js — these have AD
coverage and Liam was already aware. They're flagged for completeness, not as
news.

---

## Phase 2 — Design proposal

### 2.1 Architecture decision: extend the existing CRM

I'm proposing we **extend** `marketing_contacts` + `marketing_encounters` rather
than create your proposed `marketing_providers` / `marketing_contacts` /
`marketing_outreach` triplet. Reasons:

- The existing `marketing_contacts` already plays the role of your proposed
  `marketing_providers` (one row per practice/facility with type, region,
  address, NPI, referral potential). It is mis-named — it's actually a
  *practice* table. Rename it to `marketing_providers` via a Postgres `ALTER
  TABLE ... RENAME` (zero data risk) and we have your provider table for free.
- The existing `marketing_encounters` plays the role of your proposed
  `marketing_outreach`. Rename it to `marketing_outreach` and add the columns
  you asked for (rep_id, special_project_id, outcome enum, purpose enum,
  payer, scheduled_next_event_date, target_follow_up_date, phone_call_reason,
  target_clinic_or_school, discussion_points, follow_up_actions).
- The **net-new** table is `marketing_contacts_people` (or just `marketing_contact_people` — see naming question below). The current schema mashes the practice
  and the contact person into one row, so "we've called this Network Lead 6
  times even though the practice has 3 people we know" is impossible to report
  on. Splitting people out as their own table is your single biggest reporting
  upgrade.
- Plus one tiny lookup table `marketing_special_projects` so campaign tags are
  canonical, not free-text typos.

This avoids a destructive rebuild, preserves the test rows, keeps the page
permission entry and existing sidebar route, and lets us ship faster.

### 2.2 Proposed data model

#### Rename + extend `marketing_contacts` → `marketing_providers`

```sql
ALTER TABLE marketing_contacts RENAME TO marketing_providers;

-- existing columns stay (practice_name, contact_type, region, address, city,
-- state, zip, npi, referral_potential, active_referral_source, notes,
-- assigned_to, created_at, updated_at)

ALTER TABLE marketing_providers
  ADD COLUMN primary_insurance text,             -- "Insurance/Payer" (field #17)
  ADD COLUMN assigned_rep_id  uuid REFERENCES coordinators(id),  -- replaces free-text assigned_to
  ADD COLUMN is_active        boolean default true;

-- Migrate existing "contact_name / title / phone / email" data into the new
-- people table (next), then drop those columns from providers — they belong
-- on people, not the provider.
```

**Push back:** the current schema treats `contact_name + title + phone + email`
as columns on the practice. That breaks the moment one practice has two
referral leads, which it always does. Multi-contact-per-practice is the whole
point of normalizing.

#### NEW table: `marketing_contact_people` (or `marketing_contacts`, see naming Q)

```sql
CREATE TABLE marketing_contact_people (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES marketing_providers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  title          text,         -- MD, DO, DPM, NP, Office Manager, Referral Coordinator, etc.
  phone          text,
  email          text,
  is_primary     boolean default false,    -- one primary per provider for "default contact" UI
  is_active      boolean default true,
  notes          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

CREATE INDEX idx_mcp_provider ON marketing_contact_people(provider_id);
```

#### Rename + extend `marketing_encounters` → `marketing_outreach`

```sql
ALTER TABLE marketing_encounters RENAME TO marketing_outreach;
ALTER TABLE marketing_outreach RENAME COLUMN contact_id TO provider_id;

ALTER TABLE marketing_outreach
  ADD COLUMN contact_person_id  uuid REFERENCES marketing_contact_people(id),  -- which person at the provider
  ADD COLUMN rep_id              uuid REFERENCES coordinators(id),              -- who logged it (was free-text `conducted_by`)
  ADD COLUMN outreach_type       text,        -- replaces existing `encounter_type` with stricter taxonomy below
  ADD COLUMN purpose             text,        -- 'in_service' | 'lunch_and_learn' | 'introduction' | 'check_in' | 'event_support' | 'other'
  ADD COLUMN discussion_points   text,
  ADD COLUMN follow_up_actions   text,
  ADD COLUMN payer               text,        -- insurance/payer relevant to this visit
  ADD COLUMN scheduled_next_event_date date,  -- "Scheduled Future In-Service/Luncheon"
  ADD COLUMN target_follow_up_date    date,   -- distinct from existing `follow_up_date` which is an action date; this is a target/aspirational date
  ADD COLUMN phone_call_reason   text,        -- when outreach_type='phone_call'
  ADD COLUMN target_clinic_or_school text,    -- for event / job_fair when provider_id is null
  ADD COLUMN special_project_id  uuid REFERENCES marketing_special_projects(id),
  ADD COLUMN outcome_rating      text;        -- 4-level enum (see pushback below)

-- We'll backfill rep_id from conducted_by where possible (string-match against
-- coordinators.full_name), then keep conducted_by for the audit trail of legacy
-- rows. New code reads rep_id.
```

**Outreach taxonomy** (`outreach_type` controlled vocab):
- `in_person_visit` — generic in-person visit (covers existing "In-Person Visit", "Drop-In")
- `in_service` — formal in-service presentation
- `lunch_and_learn` — lunch-n-learn (a specific subtype of in-person)
- `phone_call` — phone call (replaces existing "Phone Call")
- `email` — email outreach
- `event` — community event, health fair (provider may be null)
- `job_fair` — staffing event (provider may be null)
- `follow_up` — explicitly tracking back to a prior outreach
- `referral_received` — kept from existing schema for backward compat
- `other`

> **Push back on Liam:** Your fields #1–22 describe a visit and field #23 calls
> phone calls "DISTINCT entry type." Yes — they should be the same table with
> different `outreach_type` values, not two tables. One activity stream, one
> filter, one report. The form just hides/shows fields based on the type.

#### NEW table: `marketing_special_projects` (lookup)

```sql
CREATE TABLE marketing_special_projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  description  text,
  color        text,                      -- chip color for UI ("#1565C0", etc.)
  is_active    boolean default true,
  started_at   date,
  ended_at     date,
  created_at   timestamptz default now()
);
```

> **Push back:** field #22 "Special Project" as free text is a reporting
> nightmare. "Q4 Push" / "Q4 push" / "q4 Push" all count separately. Lookup
> table forces a single canonical spelling. Admin (you / Carla) maintains the
> list.

#### NEW reporting view: `v_marketing_activity_weekly`

```sql
CREATE OR REPLACE VIEW v_marketing_activity_weekly AS
SELECT
  o.rep_id,
  c.full_name AS rep_name,
  o.region,
  -- Sun-Sat week start (per src/lib/dateUtils.js convention)
  date_trunc('week', o.encounter_date + interval '1 day')::date - interval '1 day' AS week_start,
  COUNT(*)                                       AS outreach_count,
  COUNT(*) FILTER (WHERE o.outcome_rating='successful')      AS successful_count,
  COUNT(*) FILTER (WHERE o.outcome_rating='unsuccessful')    AS unsuccessful_count,
  COUNT(*) FILTER (WHERE o.outreach_type='in_service')       AS in_service_count,
  COUNT(*) FILTER (WHERE o.outreach_type='lunch_and_learn')  AS lunch_count,
  COUNT(*) FILTER (WHERE o.outreach_type='phone_call')       AS call_count,
  COUNT(*) FILTER (WHERE o.target_follow_up_date IS NOT NULL AND o.target_follow_up_date < CURRENT_DATE) AS follow_ups_overdue
FROM marketing_outreach o
LEFT JOIN coordinators c ON c.id = o.rep_id
GROUP BY 1,2,3,4;
```

Note: Postgres `date_trunc('week')` is Mon-start; the `+ 1 day / - 1 day` shift
makes it Sun-start to match the project convention. Verifying this in SQL before
shipping is a Phase 3 task.

#### `coordinator_activity_log` integration

Every outreach insert will write to `coordinator_activity_log` via the existing
`logActivity()` helper from `src/lib/supabase.js`:

```js
logActivity({
  coordinatorId: rep_id,
  coordinatorName: profile.full_name,
  coordinatorRole: profile.role,
  actionType: 'marketing_outreach_logged',
  actionDetail: `${outreach_type} — ${provider_name}${special_project ? ' [' + special_project + ']' : ''}`,
  tableName: 'marketing_outreach',
  recordId: <new uuid>,
  metadata: { outreach_type, region, outcome_rating },
});
```

This puts marketing reps into the engagement signal you said was just fixed.

### 2.3 Pushback on Liam's field list (point-by-point)

| # | Your field | My recommendation | Why |
|---|---|---|---|
| 1 | Timestamp (auto) | Keep as `created_at`. | ✓ |
| 2 | Email Address | **Drop** as a stored column — derive from `coordinators.email` via rep_id join. | Storing it duplicates a fact that's already in coordinators. If a rep's email changes, you'd update one row, not 500 outreach records. |
| 3 | Marketing Rep Name | **Derive** from `coordinators.full_name` via rep_id. | Same reason. Store the FK, not the name. |
| 4 | Region | Derive from rep + provider — store on outreach for fast filtering, but it's denormalized cache. | The current page already denormalizes it. Keep that, but enforce via trigger. |
| 5 | Date of Visit | Keep as `encounter_date`. | ✓ |
| 6 | Provider Type | Keep on `marketing_providers.contact_type`. | ✓ (rename column to `provider_type` for clarity — minor). |
| 7 | Target Clinic or School | Add as `target_clinic_or_school` on outreach. | Only relevant for event/job_fair. |
| 8 | Provider Name | Lives on `marketing_providers`. | ✓ |
| 9 | Contact Name | **Move to `marketing_contact_people`.** | Big change. See pushback above. |
| 10 | Contact Title | Same — on people. | |
| 11 | Contact Phone | Same — on people. | |
| 12 | Contact Email | Same — on people. | |
| 13 | Location Address | Lives on `marketing_providers`. | ✓ |
| 14 | Purpose of Visit | `purpose` enum on outreach. | ✓ |
| 15 | Discussion Points | `discussion_points` text on outreach. | ✓ |
| 16 | Follow-Up Action Steps | `follow_up_actions` text. | ✓ |
| 17 | Insurance/Payer | `primary_insurance` on provider (most common case) + `payer` on outreach (when a single visit is payer-specific). | Storing on provider gives you "show me all providers that accept Humana"; storing on outreach gives you "show me payer mix of this rep's outreach." Both have reporting value, both are cheap. |
| 18 | Notes/Comments | Keep existing `summary` + `notes`. | ✓ |
| 19 | Scheduled Future In-Service/Luncheon | `scheduled_next_event_date` on outreach. | ✓ |
| 20 | Target Follow-Up Date | `target_follow_up_date` on outreach. Existing `follow_up_date` becomes "when next action is due." | Two date fields, two meanings — see open question below. |
| 21 | Was the visit successful (yes/no) | **REJECT binary. Recommend 4-level enum:** `successful` / `neutral` / `unsuccessful` / `follow_up_needed`. | A yes/no on a marketing interaction is a coin flip with no signal. 4 levels give you "warming up" (neutral), "ghosting us" (unsuccessful), and "we're owed a callback" (follow_up_needed) — those are 3 different management actions. |
| 22 | Special Project | `special_project_id` FK to `marketing_special_projects`. | Lookup, not free text. |
| 23 | Phone Call Outreach | Same table, `outreach_type='phone_call'` + `phone_call_reason` field. | Not a separate entity — see push back above. |

### 2.4 UI proposal

**Single page**, `/marketing-crm`, existing route. Three layout changes:

1. **Tabs grow from 3 to 5:** `Activity Log` / `Providers` / `Contacts` / `Follow-Ups` / `Reports`. (Renaming "Encounter Log" → "Activity Log" so it's not provider-tied.)
2. **One primary CTA: "Log Activity"** — large button top-right of every tab. Opens a single modal. The modal:
    - Step 1: Pick outreach type (icon-grid of 7-8 options). This drives field visibility.
    - Step 2: Provider picker (typeahead from `marketing_providers`, with "+ New Provider" inline). For event/job_fair this becomes a free-text `target_clinic_or_school` instead.
    - Step 3: Contact-person picker (typeahead scoped to the chosen provider, "+ New Contact" inline). Skippable.
    - Step 4: Type-specific fields:
        - `in_service` / `lunch_and_learn` — purpose pre-filled, discussion points, follow-up actions, payer, scheduled next event
        - `phone_call` — phone_call_reason, summary, follow-up actions
        - `event` / `job_fair` — target_clinic_or_school, summary
    - Step 5: Outcome rating (4-level radio), Special Project (dropdown from lookup), follow-up dates, notes.
    - Auto-fills: rep_id from `useAuth().profile.id`, region from rep's regions (if multi-region rep, ask).
3. **KPI strip on Activity Log tab:**
    - This Week (Sun-Sat) outreach count
    - This Month outreach count
    - Successful rate (% with `outcome_rating='successful'`)
    - Follow-ups overdue (`target_follow_up_date < today AND follow_up_completed=false`)
    - Active special projects
    - In-services + lunch-n-learns this month (combined)
4. **Filter bar** (applies to all tabs except Reports):
    - Region (multi-select)
    - Rep (multi-select, joined to coordinators.full_name)
    - Provider Type (multi-select)
    - Insurance/Payer (multi-select, free-text combinations OR'd)
    - Outreach Type (multi-select)
    - Date range (default: last 30d, with quick-picks for This Week / This Month / This Quarter)
    - Special Project (multi-select)
    - Outcome (multi-select)
5. **My Pipeline view** for individual reps — flipping the page into "show me MY outreach + MY follow-ups due" with a single toggle. For RMs this auto-scopes to their assigned region anyway, so the toggle is mostly cosmetic; for ADs it actually filters.
6. **Manager View** — extra dropdown visible only to admin / super_admin / assoc_director: "Group by rep / region / provider type / special project" with a stacked bar chart underneath the KPI strip. Recharts is already in the bundle.
7. **Reports tab** — 4 charts/tables:
    - Activity trends by rep (line chart, weekly Sun-Sat)
    - Provider relationship depth (table: provider | # touchpoints | last contact | next follow-up | outcome distribution)
    - Special project rollup (table per project)
    - Overdue follow-ups (operational triage list, sortable by days overdue)
    - "Export to CSV" button — uses the existing export helper used elsewhere in the codebase.

### 2.5 Role gating

| Role | Sidebar visible? | Can read | Can write own | Can write others' | Admin (lookup tables) |
|---|---|---|---|---|---|
| super_admin (Liam) | YES | all rows | all | yes | yes |
| admin (Carla, Yvonne, etc.) | YES | all rows | all | yes | yes |
| assoc_director (Lia, Ariel, Samantha) | YES | their region rows | their own + reps in their region | yes (in their region) | no |
| regional_manager (Uma, Earl, Hollie, Kaylee) | YES | their region rows | their own | no | no |
| pod_leader (Hervylie) | open question — see below | — | — | — | — |
| care_coordinator / auth_coordinator / intake_coordinator | NO | nothing | — | — | — |
| clinician / telehealth | NO | nothing | — | — | — |

**RLS implementation:** replace the single open `is_active_coordinator()` policy
with role-based + region-scoped policies. Use the existing
`coordinators.user_id = auth.uid()` pattern (CLAUDE.md is explicit about this).

> **Open Q:** do we add a new role `marketing_rep` for people who do marketing
> but aren't a regional_manager? Or do we keep piggybacking on
> `regional_manager` + `assoc_director`? See open questions section.

### 2.6 Effort estimate (hours)

| Workstream | Hours | Notes |
|---|---|---|
| **Phase 1 wrap-up** | 0.5 | Confirm decisions in §3 below |
| Schema migration (rename + extend + 2 new tables + view + indexes) | 2.5 | Apply via Supabase MCP `apply_migration`. Includes RLS policy rewrite. |
| Backfill: split existing `contact_name/title/phone/email` into `marketing_contact_people` | 0.5 | Trivial — 1 contact row to migrate |
| Backfill: match `conducted_by` text → `rep_id` FK | 0.5 | 1 row currently |
| `MarketingCRMPage.jsx` refactor: 5 tabs, redesigned modal, type-driven field visibility | 6 | Existing 519-line file. Big edit, not a rewrite. |
| Provider + contact pickers (typeahead) | 1.5 | Reusable components |
| Special Projects management UI (admin-only, lookup CRUD) | 1.5 | Small admin section |
| Reports tab (4 charts/tables, CSV export) | 3 | Recharts already wired |
| Filter bar rebuild (multi-select, persisted to URL params) | 1.5 | |
| `logActivity()` integration on every write | 0.5 | Pattern is well-established |
| RLS policy rewrite + manual test as each role | 2 | Critical — current policies are too open |
| Update `src/lib/constants.js` REGIONS to include I + maybe normalize | 0.5 | |
| Update CLAUDE.md to reflect new schema + region I + new lookups | 0.5 | |
| Update `src/components/Sidebar.jsx` if we add new sub-pages | 0.5 | We won't — keep one route |
| `useRealtimeTable` extension for new tables | 0.25 | |
| Manual QA pass as RM / AD / Admin / Liam | 2 | |
| Build + ship | 0.5 | `npx vite build` then `ship` |
| **Total** | **23.75 h** | Realistically a 3-day build for one focused engineer |

If you wanted the greenfield rebuild instead (3 new tables, drop existing,
migrate data, all-new page): ~35 h. The extension path saves ~12 h.

---

## 3. Open questions — please answer before I start Phase 3

These are blockers; the rest is judgment calls I'll make on default if you don't
answer them by my next pass.

### Blockers (answer please)

1. ~~**The 7 missing RMPs**~~ — **RESOLVED 2026-05-29.** Confirmed former
   employees. Audit complete (§1.6). Zero footprint in DB or code; nothing to
   deactivate. Build proceeds with the 7 active coordinators only.
2. **Regions O and R**: do these correspond to a real geography I'm missing, or were they in the spec by mistake? **My default:** drop them. Live regions stay A, B, C, G, H, I, J, M, N, T, V.
3. **Region I coverage — new blocker.** With Sean Houseman gone, no active RM
   or AD has I in their regions array (§1.7). Three options: (a) recruit /
   hire someone for Region I before launch, (b) assign I to an existing AD as
   acting coverage (Ariel is the obvious pick — FL Central), (c) launch and
   accept that Region I outreach has no rep to attribute to. **My default:** option
   (b) — temporarily add I to Ariel Maboudi's regions array, flag the gap on
   the page UI as "Acting coverage, recruitment open."
4. **Dedicated `marketing_rep` role?** Right now your "RMPs" are double-hatted as regional_manager (Uma, Earl, Hollie, Kaylee) and assoc_director (Lia, Ariel, Samantha). Do you want a separate role with marketing-only access, or do RMs / ADs continue to wear the marketing hat? **My default:** no new role; we use regional_manager + assoc_director. Cleaner to introduce a new role later if you need to onboard non-RM marketing staff.
5. **"Email Address" (field #2) ambiguity**: confirmed it's the rep's email, auto-populated from auth — not the contact's? **My default:** rep's email, derived not stored.
6. **`pod_leader` access**: Hervylie covers Region A care coord directly. Does she need read access to Marketing CRM for her region, or no? **My default:** no — pod_leader stays blocked, same as today.
7. **What happens to the existing single test row** in marketing_contacts + marketing_encounters? **My default:** keep — they're test data created by you, harmless, and demonstrate the schema works end-to-end.

### Soft questions (your call but won't block me)

7. **Outcome rating** — confirm the 4-level enum (`successful` / `neutral` / `unsuccessful` / `follow_up_needed`)? Or do you want a 5-level scale, or include "no contact made" as a fifth value? **My default:** 4-level as proposed.
8. **Provider Type vocab** — the current page has 13 types (PCP, Podiatrist, Hospital, Specialist, Wound Care, Orthopedic, Vascular, Cardiology, Neurology, Assisted Living, SNF, Home Health Agency, Other). Your spec adds "Clinic, School, Hospital, Job Fair, SNF, etc." Do we add School + Clinic + Job Fair to the existing list, or rethink the vocabulary entirely? **My default:** add School + Clinic + Job Fair; keep the rest.
9. **Two follow-up dates** — `follow_up_date` (existing, "when the next action is due") and `target_follow_up_date` (proposed, "aspirational target") — are these actually two different fields, or do you want one? **My default:** combine them. One field, called `follow_up_due_date`, with the existing `follow_up_completed` boolean.
10. **Naming**: people are confusingly called "contacts" in the current schema where they should be called "people," and providers are called "contacts" too. Final names I'll use unless you object: `marketing_providers`, `marketing_contact_people`, `marketing_outreach`, `marketing_special_projects`. The page stays at `/marketing-crm` with label "Marketing CRM."

---

## 4. What I will NOT do without your explicit go-ahead

- Touch any of the 7 missing RMPs' identities (no speculative account creation).
- Add regions O or R unless you confirm them.
- Add a new `marketing_rep` role.
- Wipe the existing test rows.
- Push to git (per your instructions; I'll commit locally only after you say "ship").
- Touch files outside the marketing scope (Sidebar.jsx, constants.js, dateUtils.js, supabase.js will get small edits — flagged above — only if you greenlight).

---

## 5. Recommended next steps (your move)

1. Answer blockers 1-6 above. Even one-word answers work ("drop O+R", "no new role", "rep email yes", "keep test rows", "no pod_leader access", "stale roster — build with 7").
2. Greenlight the extension path (vs. rebuild).
3. I move to Phase 3, applying the migration first (lowest-risk, fastest to validate), then the page refactor, RLS, reports.

I am holding here until you respond. The audit answers in this doc are derived
from live SQL against project `kndiyailsqrialgbozac` on 2026-05-29 — they will
go stale fast if other sessions modify the marketing tables, so don't sit on
this for a week without a recheck.
