# EdemaCare Operations System

React + Vite + Supabase healthcare operations dashboard for **EdemaCare** (the public-facing
brand / d/b/a as of 2026-06-01). The underlying legal entity is **AxiomHealth Management LLC**.
Deploys to Vercel automatically from the `main` branch within ~60 seconds of a push.

---

## Brand naming conventions — read before renaming anything

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
| Director Command | Liam | Hero revenue + exceptions + manager scorecards |
| Operations Manager Dashboard | Carla | Pipeline bottlenecks across Intake/Auth/Care Coord |
| Coordinator Portal | Mary (and care coords) | 2-col workflow: pipeline left, sticky tasks right |
| Auth Coordinator Dashboard | Auth team | My Queue + insurance tabs + inline status toggle |
| Auth Tracker | Auth team | Full inventory with expandable rows + doc upload |
| Auth Renewals | Auth team | Renewal task workflow with inline status |
| Productivity Tracker | Care coords | Per-clinician scheduled vs target capacity |
| Clinician Accountability | Director/RM | Per-clinician metrics for accountability |
| Audit Import | Admin | Weekly audit XLSX → preview → apply with audit log |
| Reports & Export | Admin/AD/RM | 27 reports grouped by department |

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
