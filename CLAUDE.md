# EdemaCare Operations System

React + Vite + Supabase healthcare operations dashboard for **EdemaCare** (the public-facing
brand / d/b/a as of 2026-06-01). The underlying legal entity is **AxiomHealth Management LLC**.
Deploys to Vercel automatically from the `main` branch within ~60 seconds of a push.

---

## Brand naming conventions — read before renaming anything

**Brand palette (2026-06-09):** EdemaCare adopted the official cool teal/navy/indigo
palette. CSS variables in `src/index.css` (and the `B` / `EC` constants in
`src/lib/constants.js`) now map to these brand colors. Use `var(--ec-teal)`,
`var(--ec-navy)`, `var(--ec-indigo)`, etc. for new code. Legacy `--red` / `--black`
variable NAMES are preserved (so existing pages keep rendering unchanged) but their
VALUES are now the EdemaCare palette. Signature gradient: `--ec-gradient` =
linear from `#06B6D4` (Teal) → `#6366F1` (Indigo), which mirrors the heart-mark
gradient inside the EdemaCare logo. Logo assets live in `public/`
(`logo.png`, `logo-dark.png`, `icon-192.png`, `icon-512.png`).

The 2026-06-01 rebrand was a **DBA only** — AxiomHealth Management LLC remains the legal
entity. That means there are three distinct ways the old name still appears in this
codebase, and they have different rules:

| What | Status | Example | Rule |
|---|---|---|---|
| **Public brand (user-visible)** | Renamed to EdemaCare | UI strings, page titles, email subjects, PDF/XLSX headers, sidebar logo | If a user reads it, it says "EdemaCare". |
| **Legal entity (footer fine print)** | Stays "AxiomHealth Management LLC" | Login footer, sidebar footer, edge-function email footers, invoices, contracts, 1099s | Single legal-line disclosure: "EdemaCare is a service of AxiomHealth Management LLC". |
| **Code-internal identifiers** | Stays AHM / axiomhealth | `package.json` name "axiomhealth-ops", Vercel project `axiomhealthops-axiom-ops`, GitHub org/repo, Supabase project `axiom-ops`, `axiomhealthops-axiom-ops.vercel.app` URL hardcoded in 3 places, Resend FROM mailboxes `@axiomhealthmanagement.com`, employee email addresses, historical DB rows | Do NOT rename. These are infrastructure / identifier-level and renaming them cascades into broken URLs, broken auth, and broken email delivery. Phase 3 cleanup. |

**Out-of-scope for any "rebrand cleanup" task without explicit Liam sign-off:**
- The 22 `coordinators.email` rows on `@axiomhealthmanagement.com`
- The Vercel canonical URL `axiomhealthops-axiom-ops.vercel.app`
- The Resend sender domain `axiomhealthmanagement.com` (DKIM/SPF is verified there, not on edemacare.com)
- Historical `daily_ops_reports.report_html` (114 rows) and `patient_notes.note_text` (58 rows) that contain "AxiomHealth" — these are audit trail and rewriting them is falsification.
- Database table / column / function / enum / view names
- Git history

---

## Liam's role + what he expects from Claude

- **Director of Operations** — not a developer.
- Wants top-0.1% business advisor judgment, not a yes-man.
- Push back when a request is ambiguous, when the plan looks weak, or when there's a
  better way. Always offer your strong recommendation along with the question.
- Be decisive — when he says "go" or doesn't answer a clarifying question, pick the
  most sensible default and execute. Don't ask again.
- Honest caveats are valued — flag known limitations, data quality risks, and
  long-term maintenance debt up front.

---

## Hard-won project conventions (DO NOT VIOLATE)

### Work week
- **Sun-Sat**, not Mon-Sun. Use helpers from `src/lib/dateUtils.js`:
  - `getWeekStart(date, weeksOffset)` — returns Sunday at 00:00 local
  - `getWeekEnd(date, weeksOffset)` — returns Saturday at 23:59:59 local
  - `getWeekRange(date, weeksOffset)` — returns `{start, end, startStr, endStr, label}`

### Visit math
- **Blended rate is $230/visit**. Import `BLENDED_RATE` from `src/lib/visitMath.js`. Never hardcode.
- Always use the helpers from `src/lib/visitMath.js`:
  - `isCompleted(v)`, `isCancelled(v)`, `isAttempted(v)`, `isMissed(v)`, `isEval(v)`
  - `dedupEncounters(rows)` — collapses co-treat duplicates to one slot
  - `classifyVisits(rows)`, `estimateRevenue(count, rate)`
- **Pariox quirk:** cancelled visits often have `status="Completed"` + `event_type="Cancelled Treatment"`.
  NEVER write `/completed/i.test(status)` alone — it overcounts revenue.
- **Per (patient, date, staff) slot = ONE counted visit.** Pariox sometimes uploads
  duplicate rows for the same slot with different `event_type`s
  (e.g. "Maintenance *e*" + "Level 2 *e*"). Collapse to one row per slot before counting.

### Census status (added 2026-07-21)
- **`src/lib/censusStatus.js` is the only place that interprets `census_data.status`.**
  Never regex the raw column. `/active/i` matches `"Active - Auth Pendin"` too — that
  exact bug made Director Command read 496 Active while the census page read 473.
- Pariox **truncates status at 20 chars** on the roster import. The DB genuinely
  contains `"Active - Auth Pendin"` and `"Discharge - Change I"`. `normalizeStatus()`
  repairs them; call it before any comparison.
- `bucketCensus(rows)` returns the 9 live buckets plus `liveRoster` / `discharged` /
  `nonAdmit` / `total`. The buckets sum to `liveRoster`, and
  `liveRoster + discharged + nonAdmit === total`. If a new Pariox status appears it
  lands in `.unmapped` and renders a visible warning rather than silently vanishing.
- **"Total census" is ambiguous — always say which.** Live roster (~720, actionable)
  vs all-time rows (~1,037, includes ~270 discharged + 47 non-admit). Liam's default
  is live roster.
- **`status_changed_at` is NULL on ~95% of census rows.** Pariox does not send it on
  the bulk upload; it is only stamped by our own UI. Any "days in status" metric built
  on it under-reports ~20x — this silently broke the old Director Command "Pipeline
  Stalled" tile, which evaluated 2 of 38 SOC Pending patients. Use `first_seen_date`
  (100% populated), `last_visit_date` (NULL = never seen — the strongest pipeline-stall
  signal), `days_since_last_visit`, or `days_overdue` instead.

### Visit counting
- **Two units, never interchangeable.** A co-treat (PT + PTA, same patient, same day)
  is **2 visits** on the schedule but **1 billable encounter**.
  - *Visits* = `(patient, date, staff)` rows. What Pariox and the ops team count, and
    what Liam reads off the schedule. Use for "how many visits", capacity, productivity.
  - *Encounters* = `(patient, date)`. Use for revenue: `encounters * BLENDED_RATE`.
  - **Never multiply a visit count by BLENDED_RATE** — ~12% overstatement (749 vs 657
    in the week of 2026-07-19).
  - `classifyWeekSlots()` returns both, named: `booked` / `bookedVisits`,
    `completed` / `completedVisits`, etc.
- **Pariox sends full-week SNAPSHOTS, not deltas.** The morning export re-states the
  whole current week (completed, missed and scheduled together). Use
  **`dedupVisitsByAuthoritativeBatch()`** — NOT `dedupVisitsByLatestUpload()` — for any
  count of booked/scheduled work. See incident 10 below.
- `WEEKLY_VISIT_TARGET` (1000) lives in `visitMath.js`. Do **not** redeclare a local
  target — Director Command had a local `const WEEKLY_TARGET = 750` disagreeing with it.
- **Booked != completed.** `classifyWeekSlots(rows)` assigns each (patient, date) slot
  exactly ONE outcome so the counts are mutually exclusive and
  `booked === completed + missed + scheduled`. Use it whenever you need those numbers
  to reconcile on screen. `classifyVisits()` dedups each class independently and is
  fine only when you read a single field off it.
- `isScheduled()` excludes cancellations: Pariox emits
  `status="Scheduled"` + `event_type="Cancelled Treatment"` for same-week cancels.
  Same trap as `isCompleted()` — never test `status` alone.
- Run **`npm run check`** before `ship`. Dependency-free, sub-second, and it pins every
  Pariox trap in the "Things that broke before" list below.

### Medicare tracker (added 2026-07-21)
- **`total_completed_visits` is maintained server-side.** `sync_medicare_visit_counts()`
  runs every 15 min via pg_cron (same safety-net pattern as `sync_pending_auths`) and
  recomputes visit counts + the progress-note clock from `visit_schedule_data`.
  Before this it was only written by the client Recalculate button — last pressed
  2026-06-30, leaving 12 of 57 patients drifted and 4 sitting 13-23 visits past a
  required progress note while the page showed `progress_note_due = false`.
- The sync **deliberately does not touch `current_episode_visit_count`** — that column
  drives `trg_flag_medicare_ready_for_discharge` (critical alert at 20) and has its own
  increment trigger. Recomputing it there would risk duplicate discharge escalations.
- The sync **skips `needs_audit` and `archived_at` rows** so manual work is never
  clobbered. Client `recalculate()` remains the full pass (new patients, therapist
  resolution, escalation ladder).
- Alert creation is gated by `medicare_sync_config.alerts_enabled_at` so a corrective
  run can fix counts without blasting coordinators. Set it forward to re-mute.
- **Progress notes are rows, not columns.** `medicare_progress_notes` holds one row per
  note; files attach via `patient_documents.progress_note_id` in the existing
  `patient-documents` bucket. The legacy `last_progress_note_*` columns are still
  written as a denormalised "latest note" pointer because both the cron function and
  `recalculate()` read them for the clock — do not delete them without rewiring both.

### Supabase queries
- **Always wrap with `fetchAllPages()`** when querying these tables — they exceed 1000 rows
  in production and supabase-js silently truncates:
  - `visit_schedule_data` (5K+)
  - `intake_referrals` (4K+)
  - `census_data` (~900)
  - `care_coord_notes` (1.3K+)
  - `coordinator_activity_log` (13K+)
  - `census_status_log` (4.3K+)
  - `auth_tracker` (700+, growing)
- Helpers are in `src/lib/supabase.js`: `supabase`, `fetchAllPages`, `safeUpdate`, `logActivity`.

### JSX
- **Never inline unicode characters in JSX text** (`✕`, emojis, em-dash, etc.) —
  the build tooling stores them as literal `×` escape sequences and they render
  as visible gibberish. Either use plain ASCII or wrap in a JS expression: `{'×'}`.
- This bit us multiple times — be vigilant.

### Auth / RLS
- `coordinators.user_id` ties to `auth.uid()`, NOT `coordinators.id`.
- The 'director' role exists in the codebase but maps to super_admin permissions
  via both `Sidebar.jsx` and `useAuth.canAccess()`.
- `page_permissions` columns: super_admin, admin, assoc_director, regional_manager,
  pod_leader, team_member, auth_coordinator, intake_coordinator, care_coordinator,
  clinician, telehealth.

### Sidebar sections
The DB stores these EXACT strings in `page_permissions.page_section` — `Sidebar.jsx`
`ALL_SECTIONS` keys MUST match verbatim. Don't shorten or rename:
```
OVERVIEW · OPERATIONS · INTAKE · AUTHORIZATION · CARE COORDINATION ·
CLINICAL DEPARTMENT · MARKETING · PERFORMANCE · ADMIN
```

---

## Org structure (May 2026 reorganization)

- **Director of Operations:** Liam O'Brien — `super_admin`
- **Operations Manager:** Carla Smith — `admin` — runs Intake / Auth / Care Coord
- **Pod Leader:** Hervylie Manaay — covers Region A care coord directly
- **Associate Directors** (`assoc_director`):
  - Lia Davis — FL North (regions B, C, G)
  - Samantha Faliks — FL South (regions T, V) + acting for region G when needed
  - Ariel Maboudi — FL Central (regions M, N) + acting for H, J when needed
- **Regions:** A, B, C, G, H, J, M, N, T, V (single letters). Some have dedicated TMs,
  others are AD-acting. See `src/lib/constants.js` for the current `REGIONS` map.

---

## Deployment

- `ship "commit message"` is a shell function — commits all changes to `main` and pushes.
- Vercel auto-deploys from `main` within ~60s.
- **NEVER edit production data without a confirmation dialog or a preview step.**
  Audit Import is the model: stage → diff → preview → apply with rollback log.
- Schema changes: use Supabase MCP `apply_migration` with descriptive names.
- The `data_audit_log` table records reversible field-level changes from imports.

---

## Key pages (what they're for, who uses them)

| Page | Role | Job |
|---|---|---|
| Director Command | Liam | Company pulse: visit delivery + 9 census status buckets, each with its owning department |
| Operations Manager Dashboard | Carla | Pipeline bottlenecks across Intake/Auth/Care Coord |
| Coordinator Portal | Mary (and care coords) | 2-col workflow: pipeline left, sticky tasks right |
| Auth Coordinator Dashboard | Auth team | My Queue + insurance tabs + inline status toggle |
| Auth Tracker | Auth team | Full inventory with expandable rows + doc upload |
| Auth Renewals | Auth team | Renewal task workflow with inline status |
| Productivity Tracker | Care coords | Per-clinician scheduled vs target capacity |
| Clinician Accountability | Director/RM | Per-clinician metrics for accountability |
| Audit Import | Admin | Weekly audit XLSX → preview → apply with audit log |
| Reports & Export | Admin/AD/RM | 30 reports in 6 buckets (Executive, Intake, Auth, Care Coord, Clinical, Operations) + "Most Used" pinned row |
| User Management | Admin | Per-user role + page access + Export/Import bulk XLSX flow |
| Marketing Team Directory | Marketing team | Org structure of who's on the marketing team |
| Marketing CRM | Marketing team | Provider/contact relationships + outreach encounter log |
| Marketing Referrals by Territory | Yvonne + marketing team | Read-only referrals view by territory, FL + GA on one page |
| Marketing Luncheon Requests | Marketing field + Liam/Yvonne | Provider lunch/in-service approval workflow |
| Payer + Marketing Report | Yvonne | Per-payer revenue + productivity breakdown |

---

## Useful commands

```bash
# Dev server
npm run dev   # Vite on localhost:5173

# Build (verify before ship)
npx vite build

# Deploy
ship "your commit message"

# Supabase migrations live under
supabase/migrations/
```

---

## Things that broke before (don't repeat)

1. **Silent 1000-row truncation** — fixed in 12+ files by wrapping with `fetchAllPages`.
   New code MUST use it for the tables listed above.
2. **Mon-Sun vs Sun-Sat week math** — fixed in 8 files by extracting to `dateUtils.js`.
   New code MUST use those helpers.
3. **`$185` vs `$230` blended rate drift** — fixed by extracting to `visitMath.js`.
   New code MUST import from there.
4. **JSX unicode rendering** — recurring. Stick to ASCII.
5. **Sidebar section key mismatch** with DB — fixed by matching DB strings verbatim.
6. **RLS policy joined wrong column** (`coordinators.id` instead of `user_id`) —
   any new RLS policies on coordinator-scoped tables MUST use `user_id`.
7. **Audit Pariox imports** can have typos and truncations
   (`"Active - Auth Pendin"` → `"Active - Auth Pending"`, `"Discharge - Change I"` →
   `"Discharge - Change Insurance"`). Normalize before applying.
8. **`needs_frequency_review` auto-clears** via Postgres trigger when patient
   moves to Discharge/On Hold/Hospitalized/Non-Admit/Waitlist statuses.
9. **`visit_schedule_data` ghost rows** (2026-06-02) — Pariox visit uploads were
   running as append-only upserts on conflict key `(patient_name, visit_date,
   event_type, staff_name)`. When Pariox reassigned a slot to a different staff
   member or dropped a cancellation, the old row stayed (different conflict key,
   nothing to overwrite). Result: **1,573 ghost rows accumulated across history,
   389 of them with `status='Completed'`, inflating Director Command revenue by
   ~$89,470 YTD** and over-counting 35 of 46 active clinicians on the
   Productivity Tracker (24.7% inflation on the current week alone). Fix:
   `UploadsPage.jsx` now defaults Replace Mode = TRUE for `batchType === 'visits'`,
   which deletes every existing row in the file's date range before insert.
   Toggle stays visible in the UI for the rare partial-week file case.
   One-time backfill snapshot lives in
   `_visit_schedule_data_ghost_purge_2026_06_02` (safe to drop after one
   clean Pariox cycle proves the fix). **New ingestion paths for any table
   where Pariox is the source of truth MUST use Replace Mode semantics — do
   not assume `onConflict` will collapse reassignments.** Audited 2026-06-02:
   `census_data` and `patient_master` (conflict on `patient_name` — full
   census means absent-rows are intentional historical retention),
   `intake_referrals`, `auth_tracker`, `patient_risk_factors`,
   `medicare_roster` are all safe — no other Pariox-style replacement
   ingestion exists.
10. **Page-level "latest batch per visit_date" filter was wrong** (2026-06-03).
    The Productivity Tracker had a filter that, for each `visit_date`, dropped
    any row not in the newest batch covering that date. That broke on partial
    Pariox uploads: when Pariox sent a 3-row update for date D after a 30-row
    full upload earlier, the 3-row batch became "the latest for D" and the
    filter silently nuked the 27 unchanged rows from the prior batch. Brian
    Espinola under-counted 19/22, the rest of the team was off by ~10.9%
    system-wide (650 vs 721 true slots that week). **Correct rule (now in
    `ProductivityPage.jsx`): per `(patient_name, visit_date)`, keep only
    rows with the latest `uploaded_at`.** Handles all three cases:
    (a) cross-staff reassignment — older clinician's row drops, new one wins;
    (b) same-batch co-treat — both rows have same `uploaded_at`, both survive;
    (c) partial-update upload — older batch's untouched rows are kept because
    the newer upload never covered those (patient, date) pairs. Any new
    consumer of `visit_schedule_data` for counting/billing MUST use this
    per-(patient, date) latest rule, NOT per-date latest batch.
11. **Replace-mode default ON silently destroyed historical revenue** (2026-06-06).
    The 2026-06-02 fix made Replace Mode = TRUE the default for visit uploads,
    on the assumption Pariox's daily file was a full-week schedule. It is not.
    Pariox's report is a rolling forward-looking window — roughly today-3 days
    through today+7. Each Replace upload deleted EVERY row in the file's date
    range, including Completed billing events. Because Pariox's older completed
    visits had already dropped off the schedule view by the time the next
    report was uploaded, the deletes wiped them and the re-insert never put
    them back. By Sat 6/6, dates 5/31 and 6/1 had ZERO rows in
    `visit_schedule_data` — Director Command read $60,720 of $200K target
    instead of the true ~$150K+. **Permanent fix:**
    (1) Replace Mode default reverted to FALSE in `UploadsPage.jsx`;
    (2) when manually toggled ON, the delete now filters
    `status NOT ILIKE 'Completed' AND status NOT ILIKE 'Missed%'` —
    billing-event rows can never be deleted again, no matter what range
    the file covers;
    (3) confirmation dialog wording updated to make the new semantics
    explicit. **General rule for any future "replace before insert" logic:
    never delete rows that represent a recorded clinical or billing event
    just because they're absent from the latest source file. The source may
    be a rolling window; the database is the system of record.** To recover
    the lost 5/31 / 6/1 / older data, Liam needs to re-upload his original
    Pariox files for those days in non-Replace mode — the safe append+upsert
    path will fill the missing rows. Snapshot
    `_visit_schedule_data_ghost_purge_2026_06_02` has 6/1 (134 Scheduled
    rows) but not 5/31, and the rows in it are pre-completion schedule
    snapshots — not useful for restoring billing data.
12. **Silent chunked-upsert failures from Medicare-cap trigger** (2026-06-06).
    `UploadsPage.jsx` was upserting visit rows in 100-row chunks with
    `if (res.error) { errors++; console.warn(...) }` — swallowing the error
    silently. Root cause: `trg_enforce_medicare_visit_cap` is a BEFORE INSERT
    trigger that `RAISE EXCEPTION` when a completed visit pushes a Medicare
    patient past the 20-visit episode cap. ONE bad row killed the entire
    100-row chunk; user saw "✓ Visits saved" while losing 100 rows. The
    Pariox 6.6.26 9am file (741 rows) landed only 400 — **341 rows silently
    dropped**, including all of 5/31 and 6/1. Fix (now in `UploadsPage.jsx`):
    (a) PRE-DEDUPE by `(patient, visit_date, event_type, staff_name)` before
    upsert — Pariox sometimes ships the same slot twice (Scheduled +
    Completed (PDF)) and the parser's PDF-suffix strip collapses them onto
    the same conflict key, triggering Postgres
    "ON CONFLICT cannot affect row twice"; (b) when a chunk upsert errors,
    fall back to per-row upsert so the good 99 land and only the offending
    row is logged into `rowFailures`; (c) the success message now surfaces
    `dedupeDropped` count + `errors` count + the most common error reason
    (typically the Medicare-cap message). Companion DB-side function
    `public.bulk_upsert_visits(jsonb, uuid, timestamptz)` was created for
    admin bulk loads — wraps each insert in BEGIN/EXCEPTION and returns
    `{inserted, updated, failed, errors[]}`. Use it for backfills where
    silent per-chunk loss would be catastrophic. **General rule for any
    INSERT/UPSERT loop touching `visit_schedule_data`: never silently
    swallow chunk errors. Either retry per-row or raise.**
13. **Engagement-signal logic must go through `useCoordinatorEngagement`** (2026-06-08).
    Three pages have now been bitten by the same bug pattern: each rolled
    its own "is coordinator X active?" check using `coordinator_activity_log`
    alone (or worse, `auth.users.last_sign_in_at`). The problem:
    (a) managers (Carla, Hervylie, all ADs) rarely write to `activity_log` —
    they work via `auth_tracker.updated_by`, `patient_notes`,
    `care_coord_notes`. A page that reads `activity_log` alone shows
    them as "no activity in 24h" forever, which is false. (b) Even for
    frontline coordinators who DO log activity, a case-sensitivity or
    whitespace mismatch between `coordinators.full_name` and
    `coordinator_activity_log.coordinator_name` silently flips the lookup
    to `Infinity`-hours-inactive. Liam flagged the same 8 frontline
    coordinators in May (banner) and again in June (Live Exception Feed):
    Gerilyn Bayson, Mary Imperio, April Manalo, Audrey Sarmiento, Gypsy
    Renos, Kiarra Arabejo, Ethel Camposano, Jhon Padit — all had 50-500+
    activity rows in the last 24h while the page said "no activity".
    **Permanent fix:** the DB-side view `v_coordinator_engagement` MAXes
    `last_active_utc` across SIX sources (`coordinator_activity_log`,
    `coordinator_daily_metrics`, `auth_tracker.updated_by`, `patient_notes`,
    `care_coord_notes`, `auth.users.last_sign_in_at`). The RPC
    `get_coordinator_engagement` wraps it with a role-gated select. The
    React hook `useCoordinatorEngagement()` in
    `src/hooks/useCoordinatorEngagement.js` fetches the RPC once per
    component, returns a lowercased-key Map for O(1) lookup, and exposes
    the helper `hoursInactiveFromEngagement(map, fullName)` that any page
    should use. **Pages updated to use the hook:** `EngagementAlertBanner`
    (Carla), `ExceptionFeed` INACTIVE_COORDINATOR + VACANT_REGION (Liam's
    Live Exception Feed), `ManagerScorecards` response_latency. **General
    rule for any future engagement check: import the hook. Never inline
    `activityLog.filter(a => a.coordinator_name === ...)` or read
    `last_sign_in_at` directly.**
14. **Email migration shape-mismatch broke logins for 10 users** (2026-06-08/09).
    During the EdemaCare email rebrand we migrated 23 auth.users rows from
    `@axiomhealthmanagement.com` to `@edemacare.com`. For 4 users with no
    existing auth account (Walter, Abi, Liz, Marzina) we created rows via
    raw SQL INSERT using `crypt('temp', gen_salt('bf'))` — which defaults
    to **bcrypt cost 6** vs Supabase's cost 10. The cost is valid bcrypt
    so login worked... except for two row-shape issues that made the
    recovery flow silently fail:
    (a) `confirmation_token`, `email_change`, `email_change_token_new`
    were left as NULL while existing rows store empty string `''` —
    Supabase's GoTrue `/auth/v1/verify` filters on `= ''` so the recovery
    submit silently dropped without updating the password. Result: users
    typed their chosen password into the reset form, the system accepted
    the form, but the DB never received the new hash. They then tried to
    log in with the password they thought they'd set, and bcrypt.compare
    failed against the leftover `temp_xxx` hash.
    (b) Additionally, `updateUserById({ email })` left
    `email_change_token_new` populated on all 23 migrated users, which
    blocks `/auth/v1/recover` from sending recovery emails at all.
    **Permanent fixes:**
    - `clear_pending_email_change(user_id)` RPC (in
      `supabase/migrations/`) zeroes email_change fields after any email
      update. Called automatically by `bulk_user_migration` in
      `admin-user-actions/index.ts` (Edge Function v7).
    - `admin-user-actions` v7 surfaces full diagnostic block in the
      send_reset response so future email-send failures show the actual
      `builtin_status`, `resend_reason`, and whether `RESEND_API_KEY` is set.
    - `User Management → Manage → Password` Edge Function path is now the
      ONLY blessed way to provision passwords for new auth accounts. Do
      NOT use raw SQL INSERT on auth.users — it bypasses Supabase's
      password and shape conventions.
    - **Diagnostic check before declaring a user "fixed":** verify
      `crypt('chosen_password', encrypted_password) = encrypted_password`
      against the actual DB hash. If FALSE the recovery flow didn't
      persist, no matter what the user clicked. Sandbox SQL:
      `SELECT crypt('pwd', encrypted_password) = encrypted_password FROM
      auth.users WHERE email = '...'`.

15. **Marketing CRM silent save failures** (2026-06-09). Three RLS bugs
    blocked Lia Davis, Brian Roffe, and Yvonne Flores from logging
    outreach in the Marketing CRM:
    (a) `can_access_marketing_region()` required region to be in the
    user's `coordinators.regions` array. Brian Roffe's regions was `[]`
    so EVERY region check denied him. **Fix:** field-marketing roles
    (HAE, marketing_rep + marketing_rep secondary) now roam without a
    region gate. AD/RM stay gated to assigned regions for territorial
    accountability. director_payer_marketing (Yvonne) added to the
    director tier with full access.
    (b) `is_marketing_admin()` missed `director_payer_marketing` so
    Yvonne couldn't manage Special Projects. **Fix:** added.
    (c) **The React save function silently swallowed errors** — used
    `await supabase.from(...).insert(...)` without checking `error`.
    RLS denials closed the modal as if successful. **Fix:** explicit
    error capture in `MarketingCRMPage.jsx OutreachModal` surfaces a
    red banner with an actionable message. **General rule for any
    future RLS-gated write: capture and surface `error` from the
    Supabase response. Never trust silent success.**

16. **Replace mode + my own SQL insert bypassed Supabase password
    conventions** (general lesson, repeated bites). When creating
    `auth.users` rows or pre-existing-user fixes via raw SQL,
    `crypt(text, gen_salt('bf'))` defaults to cost 6 — works for login
    but causes the broader shape-mismatch problem documented in #14.
    **General rule:** use `crypt('pwd', gen_salt('bf', 10))` if you
    MUST use raw SQL. Better: use the admin-user-actions Edge Function
    or User Management page UI.

17. **Marketing page taxonomy:** four marketing pages, two of which run
    on territorial RLS via `can_access_marketing_region`:
    - `marketing-team-directory` — read-only org chart
    - `marketing-crm` — provider/contact + outreach encounter log (RLS gated)
    - `marketing-referrals` — read-only intake referral view by territory,
      FL + GA tracked together (filter dropdown shows both, tables hide
      when filter is scoped to one state)
    - `marketing-luncheon-requests` — approval workflow for provider
      luncheons/in-services. Field reps submit; ONLY Liam (super_admin)
      and Yvonne (director_payer_marketing) approve. admins (Carla,
      Ashley, Dustin, Randi) can VIEW everything but cannot approve.
      Form clinic-name field is a CRM-aware typeahead that searches
      `marketing_contacts` and auto-fills region + event address +
      provider_id FK when a CRM provider is picked.
18. **Booked-visit counts inflated ~24% by stale slots** (2026-07-21). Director
    Command v4 reported **924 booked visits** for the week of Jul 19 when Liam's
    Pariox schedule said **764**. Two separate causes, both now fixed:
    - **Unit confusion.** The page counted `(patient, date)` ENCOUNTERS and
      labelled them "visits". A co-treat is 2 visits but 1 encounter, so the
      right comparison was 749 visits / 657 encounters. `classifyWeekSlots()`
      now returns both, explicitly named. See "Visit counting" above.
    - **Stale slots.** `dedupVisitsByLatestUpload()` keys on
      `(patient_name, visit_date)`. When a later Pariox export omits a slot —
      cancelled, rescheduled, patient discharged — no newer row exists for that
      key, so the old row wins by default and never dies. For Jul 19-25 that
      left **935 slots alive vs 760 in the latest current-week export**.
      `dedupVisitsByAuthoritativeBatch()` now reproduces the export exactly
      (760 rows; Liam saw 764 live, the 4 being bookings added after our 11:24
      pull).
    **Retracted claim from the same session:** I initially reported that ~30% of
    booked slots never resolved from the week of Jun 7 onward and framed it as a
    Pariox feed regression worth ~$68K/week. That was wrong — it was this stale-slot
    artifact. Under the new rule every finished week from May 24 to Jul 12 resolves
    to 0-2 unresolved slots. There is no feed regression.
    **STILL UNVERIFIED — do not build on these without checking:** batch scopes in
    `visit_schedule_data` vary wildly (the Jul 21 batch is 760 rows spanning one
    week; the Jul 20 17:07 batch is 2,671 rows spanning Jul 2 - Aug 1 yet carries
    only 64 rows inside Jul 19-25). That is not consistent with `uploaded_at`
    meaning "rows present in that export", so it may mean "rows CHANGED by that
    export". Until someone confirms how the importer stamps `uploaded_at`, the
    authoritative-batch rule is **inference from batch shape, not fact**, and it is
    deliberately wired into **Director Command only**. Do not roll it out to the
    other seven readers, and do not restate historical revenue, until that is
    settled. The real fix is at ingest — a Pariox export should REPLACE its date
    range rather than upsert into it — which is also what incidents 10 and 11
    were circling.

## Territory model (2026-06-09)

`TERRITORIES` in `src/lib/constants.js` is the single source of truth
for the EdemaCare territory structure. Each territory has:
- `letter` — single letter (A, B, C, G, H, J, M, N, T, V)
- `counties` — comma-separated string for display
- `manager` — clinical lead (TM where dedicated, AD acting otherwise)
- `managerRole` — 'TM' or 'AD'
- `marketingLead` — HAE / marketing lead who owns the referral pipeline
- `marketingLeadRole` — set to 'HAE' when marketing lead differs from manager

`GA_TERRITORIES` is the parallel Georgia structure. Walter Holston is the
sole HAE for GA. Tagging convention: `intake_referrals.region = 'GA'` (or
`GA-N`/`GA-C`/`GA-S` for future sub-territories). Helper
`isGeorgiaRegion(region)` accepts any value matching `/^GA/i`.

Brian Roffe is the marketing lead for Territory T (Samantha Faliks is the
clinical AD). When showing "who's responsible" on marketing pages, use
`marketingLead`; on clinical/operations pages, use `manager`.

## Claude Code setup (2026-06-09)

Liam runs Claude Code at this repo as the primary development tool.
Key MCPs configured: Supabase (project `kndiyailsqrialgbozac`), Vercel,
Gmail (Liam's), Calendar, Google Drive. See `docs/CLAUDE_CODE_SETUP.md`
for the bootstrap checklist.

When picking up a session: read this CLAUDE.md fully, then check
`git log -20` for recent commits. The `ship "msg"` shell function on
Liam's Mac handles commit + push; Vercel auto-deploys main in ~60s.
