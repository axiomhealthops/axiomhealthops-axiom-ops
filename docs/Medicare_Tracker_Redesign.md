# Medicare Tracker Redesign — Phase 1 Design Doc

**Author:** Claude (for Liam)
**Date:** 2026-06-01
**Status:** Phase 1 / recon — NO CODE CHANGES YET
**File under review:** `src/pages/dashboard/MedicareTrackerPage.jsx` (652 LOC)
**Related infra:** `medicare_visit_flags` table, `alerts`, `coordinator_tasks`, `insurance_abbreviations`, `visit_schedule_data`, `census_data`, `src/lib/alertEngine.js`, `src/components/AlertsBell.jsx`

---

## 0. TL;DR — read this first

1. The current page already does most of the *math* right — it correctly filters to **straight Medicare only** (not Medicare Advantage), counts completed visits, and runs a rolling 10-visit / 30-day progress-note clock. The math is keeper-grade. Don't throw it away.
2. What's confusing is the **UI shape** (accordion-grouped-by-PT) and **the missing columns** from Liam's spec (address, discipline, ref source, eval date, assistant therapist, projected 10th/20th visit dates). That's the rebuild.
3. **Critical compliance issue, surface to Liam before any code goes in:** 18 of the 106 tracked Medicare patients are *already* past 20 visits. One is at **36 visits** (Madden, Carole Ann). 10 more are at 18–19. The horse has left the barn — a redesigned tracker doesn't solve the breach that already exists. Recommend a separate one-time cap-breach triage runs in parallel with this rebuild.
4. **Push back on the "hard stop at 20" framing.** The 20-visit limit is a clinic-internal compliance policy, not a federal Medicare rule. A blunt DB trigger creates worse problems than it solves (breaks Pariox imports, blocks audit trail, may refuse medically-necessary KX-modifier care). Recommendation in §6 is a 3-layer soft stop, not a DB block. Liam needs to choose.

---

## 1. Current state — what the page does today

### Data flow
1. **Filter Medicare patients** — `recalculate()` at `MedicareTrackerPage.jsx:89`. Pulls `insurance_abbreviations`, builds a classifier that maps each `census_data.insurance` value (e.g. `Medicare`, `M - Medicare`, `MEDJ`, `Aetna Medicare`) to its `category`. Keeps only `category = 'Medicare'` (straight/Original Medicare). **Correctly excludes** Medicare Advantage carriers (Aetna Medicare, Cigna Medicare, CarePlus, Humana, Devoted) because those plans have private rules, not Medicare's 10-visit / 20-visit cap. This filter is correct and load-bearing — keep it.
2. **Count visits** — `MedicareTrackerPage.jsx:114`. Pulls all `visit_schedule_data` rows where `status ILIKE '%completed%'`, excludes any with `event_type` matching `/cancel/i`. Notably this does **not** call the canonical `classifyVisits()` from `src/lib/visitMath.js`. Risk: a Pariox quirk row with `status='Completed'` + `event_type='Cancelled Treatment'` is correctly dropped here, but the dedupe-by-slot logic from `visitMath.dedupEncounters()` is NOT applied, so co-treat slots can inflate counts by ~3–5%. **Worth wiring into `classifyVisits` for the redesign.**
3. **Identify evaluating PT** — `MedicareTrackerPage.jsx:153`. Cross-references `clinicians.discipline` to ensure only PT/OT lead therapists are listed (PTAs/COTAs blocked because they don't perform evaluations). Correct. PTA/COTA is *currently discarded* — but Liam's spec asks for it as a separate column.
4. **Rolling progress-note clock** — `MedicareTrackerPage.jsx:166`. Tracks `last_progress_note_date` + `last_progress_note_visit` per patient. Next due = `last_visit + 10` OR `last_date + 30 days`, whichever comes first. This is **more nuanced than Liam's spec** ("alert at visit 10") and matches CMS Pub 100-02 Ch 15 §220.3. Keep.
5. **Persist state** — writes to `medicare_visit_flags` (106 rows today). Insert if new, update if existing.
6. **Sync alerts** — delete-then-insert of `alerts` + `coordinator_tasks` rows of type `medicare_progress_note`. 119 such alerts live in the system today.

### What works (preserve)
- Insurance classifier (`isStraightMedicare()`, `buildInsuranceClassifier()`).
- Discipline lookup for PT/OT eligibility (`isPtOt()`).
- Rolling 10/30 progress-note clock — this is more clinically correct than Liam's pure "visit 10" alert.
- Alert + task fan-out via existing `alerts` + `coordinator_tasks` tables.
- Realtime resubscribe via `useRealtimeTable()` on `census_data`, `visit_schedule_data`, `medicare_visit_flags`.
- The `medicare_visit_flags` schema already has `last_progress_note_*`, `next_due_*`, `progress_note_due*` columns.

### What's broken / confusing (replace)
| Issue | Where | Fix |
|---|---|---|
| Grouped-by-PT accordion view buries each patient behind a click | `MedicareTrackerPage.jsx:516-597` | Flat roster — one row per patient |
| Missing columns: address, discipline, ref source, eval date, PTA/COTA, projected 10th/20th visit dates | All over | Add to roster + cache on `medicare_visit_flags` where computed |
| `flag_20th_acknowledged` conflates "system noticed" with "patient was actually discharged" | Acknowledge modal `MedicareTrackerPage.jsx:355` | Replace with explicit "discharge note submitted" event + link to `patient_discharges` |
| No filter for visits-remaining, no color-coded rows | Filter bar `MedicareTrackerPage.jsx:420` | New filter + row coloring per §7 |
| No drill-down to patient detail | All rows are inert | Click row → open right-side drawer with full visit history |
| Alert type `medicare_progress_note` is **not** in `AlertsBell.jsx` `TYPE_ICONS` map | `AlertsBell.jsx:11–23` | Add icon + label; add new `medicare_discharge_note_due` type |
| Page only does manual recalc-on-click, no scheduled daily refresh | `recalculate()` only runs on button press | Move to a scheduled edge function that runs after each Pariox upload completes |
| 18 patients are past cap with NULL `last_progress_note_date` | DB state | Out-of-band: triage breach independently |

---

## 2. Medicare patient identification — confirmed

**Canonical filter:** `insurance_abbreviations.category = 'Medicare'`. The codebase already does this correctly via `isStraightMedicare()` at `MedicareTrackerPage.jsx:50`.

Validation against live data (today):
- 111 `census_data` rows match. The page tracks 106 — the 5 deltas are likely patients dropped from census between recalcs.
- Straight Medicare insurance values seen: `Medicare` (97), `M - Medicare` (4), `A/B/G/H - Medicare` (2 each), `J/N - Medicare` (1 each). All map to category `Medicare`.
- Medicare Advantage values (Aetna Medicare, Cigna Medicare, CarePlus, Humana, Devoted) are correctly excluded.
- `ref_source` codes follow a `MED{region}` pattern: MEDA, MEDB, MEDC, MEDG, MEDH, MEDJ, MEDM, MEDN, MEDT, MEDV. These can serve as a redundancy check on insurance, but `insurance_abbreviations.category` is the authoritative source. Don't switch to `ref_source` filtering — some patients have a non-MED ref source but Medicare primary insurance.

All 111 candidate rows have non-NULL `address`, `discipline`, `ref_source`, `status`, `region` — every spec column has a value to render.

---

## 3. Progress note + discharge note fields — where they live, where they should live

### What exists today
- **No dedicated `clinical_notes` table.** Pariox visit_schedule_data has no "Progress Note" or "Discharge" event types — only Lymphedema Visit / Evaluation / 30-Day Reassessment / Cancelled / Attempted. Verified by event_type DISTINCT query.
- **Notes table inventory:** `patient_notes` (generic threaded notes), `care_coord_notes` (typed care-coord notes with `note_type`), `care_coord_discharges` (light discharge log), `patient_discharges` (full discharge record with `total_visits_completed`, `outcome`, 30-day follow-up flags).
- **Current proxy for "Medicare progress note submitted":** `medicare_visit_flags.last_progress_note_date` + `last_progress_note_visit` + `last_progress_note_submitted_by` + `last_progress_note_notes`. These are set when a coordinator clicks "Confirm Note Submitted" in the acknowledge modal. There's no link to the actual clinical document — it's a manual attestation.
- **Current proxy for "20th visit discharge note":** `flag_20th_acknowledged` boolean. Conflates "we saw it" with "the discharge actually happened." No date column.

### Recommended schema additions (Phase 2 migration)
Add columns to `medicare_visit_flags` — same table, same `patient_name` key, no new table needed:

```sql
ALTER TABLE medicare_visit_flags
  ADD COLUMN evaluation_date date,               -- duplicates care_start_date but explicit per spec
  ADD COLUMN assistant_therapist text,           -- PTA/COTA name
  ADD COLUMN tenth_visit_actual_date date,       -- date of completed visit #10, NULL if not hit
  ADD COLUMN tenth_visit_projected_date date,    -- forecast from cadence, NULL if hit
  ADD COLUMN tenth_visit_note_submitted_date date,
  ADD COLUMN twentieth_visit_actual_date date,
  ADD COLUMN twentieth_visit_projected_date date,
  ADD COLUMN twentieth_visit_discharge_note_date date,
  ADD COLUMN roster_notes text,                  -- manual notes column for the spec
  ADD COLUMN cap_breach_acknowledged_at timestamptz,
  ADD COLUMN cap_breach_acknowledged_by text,
  ADD COLUMN over_cap_billable boolean DEFAULT true;
```

Keep `last_progress_note_*` columns — they drive the rolling 30-day clock and shouldn't be removed.

Projected-date math: take the patient's last-12-week visit cadence (visits / week), divide remaining visits, add to today. Cap at 90 days forward. NULL out once the actual date lands.

---

## 4. Column-to-source map (Liam's 15-column spec)

| # | Column | Source | Notes |
|---|---|---|---|
| 1 | Patient Name | `census_data.patient_name` | Already in roster. |
| 2 | Address | `census_data.address` | Stored as `"ZIP: City"` (e.g. `32703: Apopka`). Don't reformat. |
| 3 | Disc | `census_data.discipline` | Values today: LYMPHEDEMA PT (769), OT (122), PT (2). |
| 4 | Ref Source | `census_data.ref_source` | MEDA / MEDB / etc. |
| 5 | Status | `census_data.status` | Active / Discharge / SOC Pending / etc. |
| 6 | Region | `census_data.region` | Single letter. |
| 7 | Evaluation Date | `visit_schedule_data` first eval visit | Cache as `medicare_visit_flags.evaluation_date`. Already computed as `care_start_date` (`MedicareTrackerPage.jsx:148`) — re-use. |
| 8 | PT / OT | `visit_schedule_data.staff_name_normalized` × `clinicians.discipline` filter | Already computed as `medicare_visit_flags.evaluating_pt`. |
| 9 | PTA / COTA | Same as col 8 but filter discipline ∈ {PTA, COTA} | **NEW.** Most-frequent PTA/COTA on the patient's visit list; NULL if none. Persist as `medicare_visit_flags.assistant_therapist`. |
| 10 | 10th Visit Progress Note Date | If `total_completed_visits >= 10`: `tenth_visit_actual_date` (= date of the 10th completed visit). Else: projected. Plus optional `tenth_visit_note_submitted_date`. | **NEW.** Renders as a stacked cell: top line = "Visit: <date>", bottom line = "Note: <date>" or "Note: pending". |
| 11 | # Allowed | Constant `20` | **Not a column** — render in same cell as col 12, e.g. `20 / 14 / 6`. Saves horizontal space and reduces confusion. Liam may want it as a column anyway — flag in §9. |
| 12 | # Consumed | `medicare_visit_flags.total_completed_visits` | Already computed. |
| 13 | Visits Remaining | `20 - total_completed_visits` | Derived. Can be negative (over-cap patients) — show negative explicitly: `-16`. |
| 14 | 20th Visit Discharge Note Date | Same pattern as col 10: actual / projected / note submitted. | **NEW.** |
| 15 | Notes | `medicare_visit_flags.roster_notes` | **NEW.** Editable inline (textarea-in-cell, autosaves). |

**No spec column lacks a clean source.** Cols 9, 10, 14, 15 need schema additions but the data is derivable from existing tables.

---

## 5. Alert rules (proposed)

Two alert types: `medicare_progress_note_due` and `medicare_discharge_note_due`. Both go through existing `alerts` + `coordinator_tasks` infra. Both route to the region's care coordinator (via `REGION_COORD` map at `src/lib/alertEngine.js:3`) AND to the assigned AD (via `assigned_to_region`). Add admin-broadcast logic for critical-severity only.

### Progress note (10-visit threshold)

| Visit count | Severity | Title | Who sees it |
|---|---|---|---|
| 8 | medium | "Medicare progress note coming due: <name>" | Care coord + AD |
| 9 | high | "Progress note required next visit: <name>" | Care coord + AD |
| 10 (note not yet submitted) | critical | "Progress note OVERDUE: <name>" | Care coord + AD + admin (Carla) |
| 11+ (note still not submitted) | critical | Recurring daily until acked | Same + Liam if 14+ days overdue |

Plus: 30-day rolling rule continues as today (alert fires if 30 days since last note even before visit 10) — keep this layered.

### Discharge note (20-visit threshold)

| Visit count | Severity | Title | Who sees it |
|---|---|---|---|
| 18 | medium | "Discharge planning required: <name>" | Care coord + AD + clinician |
| 19 | high | "Discharge note must be drafted: <name>" | Care coord + AD + clinician |
| 20 | critical | "Discharge REQUIRED — 20-visit cap reached: <name>" | Care coord + AD + admin + clinician |
| 21+ | critical (over-cap) | "OVER MEDICARE CAP — DO NOT SCHEDULE: <name>" | All of above + Liam |

### De-dupe rule
Today's `syncProgressNoteAlerts()` deletes all unread `medicare_progress_note` alerts and re-inserts the current due set. Keep that pattern, extend to discharge alerts. **Don't insert dupes** — alert engine should key on `(alert_type, patient_name)` and skip if an unread alert already exists.

### `AlertsBell.jsx` updates
Add to `TYPE_ICONS` map (`AlertsBell.jsx:11`):
- `medicare_progress_note_due`: 📋
- `medicare_discharge_note_due`: 🚨
- `medicare_over_cap`: ⛔

Today these fall through to a default bell icon — small fix, ships with Phase 2.

---

## 6. Hard-stop enforcement — RECOMMENDATION + PUSHBACK

### Liam's spec
> "WE CANNOT see medicare patients for longer than 20 visits."

### My honest read (top 0.1% advisor mode)
The 20-visit hard cap is a **clinic-internal policy**, not a federal Medicare rule. Real Medicare Part B outpatient therapy has:
- An **annual KX-modifier threshold** (~$2,410 combined PT+SLP for CY 2025, ~$2,500 by 2026) — over this, clinician must attest medical necessity with KX modifier on each claim.
- A **targeted medical review threshold** (~$3,000) — claims may be reviewed.
- **Progress reports required every 10 treatment days** (CMS Pub 100-02, Ch 15 §220.3) — this is real, and matches your spec.
- A **discharge summary at end of episode** — also real.

There is **no federal Medicare 20-visit cap**. If your clinic has a 20-visit policy, fine — but I want to flag three risks before the codebase enforces it:

1. **18 patients are already past 20 visits today.** One is at 36 (Madden, Carole Ann), one at 33, three at 23+. Whatever rule you enforce going forward, those 18 already happened. If those visits were billed to Medicare without KX modifier and the patient's annual threshold was exceeded, you have potential CMS overpayments subject to clawback under the 60-day rule (42 CFR §401.305). **This needs a separate billing-audit work item independent of the UI rebuild.**

2. **A naïve DB trigger that blocks `visit_schedule_data` inserts past visit 20 would break Pariox imports.** Pariox tells you what *happened*, not what *should have* — your audit trail depends on recording every visit, including over-cap ones. Block the insert and you lose visibility into the breach.

3. **A hard block may refuse medically-necessary care.** If a Medicare patient legitimately needs visit 21+ with KX modifier and ABN documentation, the system should let you record and bill it under appropriate documentation, not silently refuse.

### Recommended pattern — 3-layer soft stop (no DB block)

| Layer | Where | Behavior |
|---|---|---|
| **L1: UI guard in scheduler** | Wherever new visits are scheduled (currently Pariox-driven; if a manual scheduler is added) | Visits 21+ require an admin override modal: reason + ABN reference + KX-modifier confirmation. Default = block. |
| **L2: Roster + alerts** | This redesigned page | Rows ≥ 20 visits get the OVER CAP badge and rise to the top sorted by overage. `medicare_over_cap` alert fires daily until discharged. |
| **L3: Billing flag** | `medicare_visit_flags.over_cap_billable` boolean, default TRUE for visit ≤ 20, FALSE for visit ≥ 21 | Reports & Export filters by this so over-cap visits get a manual review queue before they hit any billing export. |

**This is the question to answer in §9.** Hard DB block, or 3-layer soft stop? My strong recommendation is the soft stop. A hard block sounds safe but in practice creates worse problems than it solves.

---

## 7. Roster UI mockup

### Header
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Medicare Visit Tracker            106 patients · 18 OVER CAP · 24 progress note due · 21 → DC   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Action / filter strip (one row)
```
[ All | ⛔Over Cap | 🟥 Discharge | 🟪 18-19 | 🟧 Note Due | 🟨 Note Soon ]
[ Region ▼ ]  [ Discipline ▼ ]  [ Status ▼ ]  [ Visits Remaining ▼ ]  [ 🔍 Search ]
                                                                                  [ ⟳ Recalculate ]  [ ⤓ Export ]
```

### Roster table (single flat list, one row per patient, sortable on every column)
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ⛔  Patient                  Address              Disc        Ref   Status   Rgn  Eval Date    PT / OT             PTA / COTA       │
│     10th Visit Date          Allowed/Used/Left    20th Visit Date    Notes                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⛔  Madden, Carole Ann       32958: Sebastian     LYMPH PT    MEDJ  Active   J    2026-01-05   J. Robles (OT)      M. Singh (COTA) │
│     ◉ 2026-02-19 · note ✗   20 / 36 / -16        2026-03-30 · DC note ✗     CAP BREACH — escalate to compliance                    │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🟥  Brooks, Cynthia M        34737: Howey         LYMPH PT    MEDH  Active   H    2026-03-15   T. Brown (PT)       A. Diaz (PTA)   │
│     ◉ 2026-04-22 · note ✓   20 / 20 / 0         ◉ 2026-05-30 · DC note ✗   Discharge note required NOW                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🟪  Smith, John              33458: Jupiter       LYMPH PT    MEDV  Active   V    2026-04-01   K. Lee (PT)         —               │
│     ◉ 2026-04-30 · note ✓   20 / 19 / 1         projected 2026-06-08        DC planning — last visit 5 days ago                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🟧  Jones, Mary              33401: West Palm     LYMPH PT    MEDT  Active   T    2026-04-12   J. Park (PT)        L. Cruz (PTA)   │
│     ◉ 2026-05-21 · note ✗   20 / 10 / 10        projected 2026-07-05        Progress note overdue                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🟨  Davis, Anne              32703: Apopka        OT          MEDA  Active   A    2026-05-04   J. Robles (OT)      —               │
│     projected 2026-06-11    20 / 8 / 12         projected 2026-08-02        Progress note due in 2 visits                          │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⬜  Williams, Peter          32958: Sebastian     LYMPH PT    MEDJ  Active   J    2026-05-20   K. Park (PT)        M. Singh (COTA) │
│     projected 2026-06-25    20 / 3 / 17         projected 2026-08-30        —                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Each row is two visual lines but one logical row. Click anywhere on the row → opens a right-side drawer with full visit history, ack history, and discharge actions.

### Row color codes
| Color | Trigger | Meaning |
|---|---|---|
| ⛔ Black/dark | visits ≥ 21 | OVER CAP — escalate |
| 🟥 Red | visits = 20 AND discharge note not submitted | Discharge required NOW |
| 🟪 Purple | visits 18–19 | Discharge planning |
| 🟧 Orange | visits ≥ 10 AND progress note not submitted (or 30-day rolling rule fired) | Progress note overdue |
| 🟨 Yellow | visits 8–9 | Progress note coming due |
| ⬜ Default | visits ≤ 7 | Normal |

### Sort defaults
Primary sort: severity bucket (Black > Red > Purple > Orange > Yellow > Default). Within bucket: visits descending. All columns user-sortable.

### Drill-down drawer (right side, slides in on row click)
- Full visit history with date, clinician, event type
- Progress note + discharge note audit log (submitted by, when, free-text)
- "Submit Progress Note" + "Submit Discharge Note" buttons (replaces today's acknowledge modal)
- Link to patient's `auth_tracker` row (if any) — Medicare patients normally don't have auths, but if they do, surface it
- "Mark Cap Breach Acknowledged" button (admin only) — drops the cap-breach alert without dismissing the discharge requirement

### What's gone from the old page
- The PT-grouping accordion (`MedicareTrackerPage.jsx:516-597`). Move PT/OT identity to a column.
- The top-of-page summary banner cards. Keep the counts in the header subtitle only.
- The two "Critical 20th visit alerts" + "Progress note alerts" banner sections. Redundant with row color coding.
- The acknowledge modal stays but moves into the drawer.

---

## 8. Compliance + operational issues to flag

1. **18 patients past 20-visit cap, NULL last_progress_note_date.** Independent of this redesign, those 18 need triage. Suggest a one-time "cap breach audit" report: for each, pull billing detail and confirm whether visits 21+ were billed to Medicare and whether KX modifier / ABN exists. If not, may trigger CMS 60-day overpayment self-report obligation.
2. **No KX-modifier tracking.** Medicare's real cost-of-care control is the annual KX threshold, not a hard 20-visit cap. If you're not tracking KX or annual therapy spend per patient, you have no visibility into the actual federal compliance boundary. Worth a future tracker column (or a separate "Medicare Annual Spend" report).
3. **`auth_tracker.insurance_type` is NOT populated for the 68 Medicare auth rows.** ILIKE-on-`insurance` finds 68 but `insurance_type='Medicare'` returns 0. Either fix the field or stop relying on it for filters. Minor data-hygiene flag.
4. **Discipline=`LYMPHEDEMA PT` is 86% of Medicare patients.** Liam's spec column header is `PT/OT`, but if 769/893 (86%) of all census patients are LYMPHEDEMA PT and 122 are OT, the column should probably read `PT / OT / Lymph` to be honest about the distribution. Cosmetic but worth deciding.
5. **`medicare_progress_note` alerts (119 of them) all render with a default bell icon today** — `AlertsBell.jsx:11–23` `TYPE_ICONS` map doesn't include the type. Trivial fix, ships with Phase 2.
6. **No scheduled job** keeps `medicare_visit_flags` fresh — `recalculate()` only runs when someone clicks the button. Pariox uploads happen on a known cadence; the recalc should chain off the upload completion (or run hourly).
7. **`coordinators.email` rows on `@axiomhealthmanagement.com`** — out-of-scope per CLAUDE.md, but the daily Medicare alert email-out (if added) should use the verified Resend sender `axiomhealthmanagement.com`, not `edemacare.com` (DKIM/SPF only verified on the former).

---

## 9. Questions for Liam (need answers before Phase 2)

1. **Hard stop or soft stop at 20 visits?** I strongly recommend the 3-layer soft stop in §6 (UI override + roster banner + billing flag). A hard DB block creates worse problems than it solves. Your call — go / no-go on the soft-stop pattern?

2. **What do we do about the 18 patients already past 20 visits?** They include one at 36 visits. This is a billing-compliance question independent of the redesign. Do you want me to (a) pull a one-time breach report for billing to audit, (b) leave as-is and let the new tracker surface it, or (c) both?

3. **Is `20` actually the right cap?** Real Medicare Part B threshold is the annual KX-modifier amount (~$2,410 in CY2025). If `20` is a clinic-internal rule, fine — but I want to confirm it's not just folklore. Where did the 20-visit number come from? (Provider agreement? MAC LCD? Internal policy?)

4. **Progress note rolling 30-day rule — keep it or drop it?** Current code fires the progress-note alert when EITHER 10 visits OR 30 days has passed. Your spec only mentions visits. CMS Pub 100-02 Ch 15 §220.3 actually says "every 10 treatment days OR every 30 calendar days" — current code is correct. Want to keep the layered rule, or simplify to your "visit 10" framing only?

5. **PTA/COTA column population — required or nice-to-have?** Many Medicare patients have a single PT or OT only, no assistant. If the assistant column is empty for >50% of rows, it adds visual weight. Show NULL as `—`, or hide the column when filter shows only PT-only patients?

6. **(Optional) Should `medicare_visit_flags` get a soft `is_active` flag** so we can preserve history for patients who've been discharged from Medicare but are still in the system? Today they get purged from the table (`MedicareTrackerPage.jsx:107-112`). That's destructive — recommend soft-archive instead.

---

## 10. What does NOT change in Phase 2

- Insurance classifier (`isStraightMedicare()`, `buildInsuranceClassifier()`) — keep as-is.
- The 10-visit / 30-day rolling progress-note math — keep as-is.
- `medicare_visit_flags` table — additive ALTERs only, no destructive migration.
- `alerts` + `coordinator_tasks` plumbing — additive only.
- `REGION_COORD` map — already correct.
- `useAuth` / RLS — already correct (`coordinators.user_id = auth.uid()`).

---

## 11. Phase 2 scope preview (do not start yet — Liam approval gate)

1. ALTER `medicare_visit_flags` per §3.
2. Rewrite `MedicareTrackerPage.jsx` as roster shape (no accordion).
3. Compute PTA/COTA + projected 10th/20th visit dates in `recalculate()`.
4. Add `medicare_discharge_note_due` + `medicare_over_cap` alert types to `alertEngine` + `AlertsBell.jsx` `TYPE_ICONS`.
5. Add 3-layer soft stop (no DB trigger).
6. Add right-side drawer for drill-down + note submission.
7. Wire `recalculate()` into a scheduled job (edge function on Pariox upload completion + hourly fallback).
8. Add Export CSV + Print Roster.
9. Cap-breach acknowledgement flow for the 18 existing breach patients.

**Estimated effort:** ~1.5 days of focused work; longer if Liam wants admin-overridable hard stop in the scheduler instead of soft stop.

---

*End of Phase 1 design. Waiting on Liam's answers to §9 before any code goes in.*
