# EdemaCare Operations System

React + Vite + Supabase healthcare operations dashboard for AxiomHealth (rebranding to EdemaCare).
Deploys to Vercel automatically from the `main` branch within ~60 seconds of a push.

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
