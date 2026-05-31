# Marketing Team Directory — Phase 1 Design Proposal (v3)

**Author:** Claude, advisor to Liam O'Brien (Director of Operations)
**Date:** 2026-05-30
**Status:** Liam answered Q1–Q6. v3 locks those in. Phase 2 still on hold pending **Q1.5, Q7, Q8, Q9** only.
**Supersedes:** `Marketing_Team_Directory_Design_v2.md` (kept for the audit trail). v1 also preserved.

---

## Liam's locked answers (2026-05-30)

| Q | Liam's answer | What it means | Heads-up |
|---|---|---|---|
| **Q1 — Orange/Osceola/Seminole** | Robby = Marketing Rep for FL Central, Uma = Regional Manager | Robby is primary outreach. Uma is RMM (senior oversight). Same pattern v2 had. **Locked.** | — |
| **Q2 — Palm Beach/Martin/St. Lucie** | Brian = Marketing Rep for FL South, Samantha = ADC / Regional Manager | Brian is primary outreach. Samantha holds **both** ADC and RMM for South FL — same person, dual capacity. Simpler than v2's "acting RMR" model. **Locked.** | I'm dropping the `acting` enum value from `assignment_role` — no longer needed. |
| **Q3 — ADC scorecard semantics** | All supervised territories | ADC's MTD scorecard rolls up everything in their region group. Personal-territory metrics are a sub-view. **Locked.** | — |
| **Q4 — Region G** | Falls under Lia Davis | Lia covers it. Cleanest model: merge G into Duval & Clay territory under Lia, with `legacy_region_letters = ['B', 'G']` for backfill. **Locked, but see note.** | If you'd rather have G as its own named territory under Lia, tell me. Default is to merge. Either works; merge is simpler. |
| **Q5 — Hollie's region group** | Stays under South Florida | **This contradicts the original brief**, which listed Hollie under "Central Florida." Taking Liam's clarification as authoritative. **Locked.** | See callout below — worth a quick gut-check that this was the intended call. |
| **Q6 — Hervylie** | Stays out of marketing entirely | No marketing assignments, no marketing role. **Locked.** | — |

### Brief vs. clarification mismatch — flagging for Liam

The original spec table had:

```
Hollie Fincher | RMP | Brevard & Indian River | Central Florida | FL
```

Today's clarification:

> "Hollies territory will stay under South Florida Region"

Two interpretations:

1. The original brief was a typo, Hollie has always belonged to South FL, "stay" = "stay where she is in our heads." This is consistent with the legacy region letter J being under FL South in `constants.js`. **Most likely.**
2. The brief was right and Liam misspoke today. Hollie should be Central FL.

I'm going with (1) — Hollie stays in FL South. If that's wrong, easy to flip. Either way it's a single assignment-row edit, not a structural change.

---

## What v3 changes vs. v2

### 1. `assignment_role` enum — simplified

v2 had: `primary` / `oversight` / `acting` / `supervisor` / `partner`.

v3: **drop `acting`.** Samantha is the RMM for South FL (not "acting until Brian ramps") — she holds the role ongoing. The acting-role gymnastics aren't needed.

Final enum: `primary` / `oversight` / `supervisor` / `partner`.

| Value | Meaning | Who uses it |
|---|---|---|
| `primary` | Day-to-day outreach owner for the territory. One per territory. Owns the scorecard. | Earl, Kaylee, Hollie, Ariel (her own), Robby, Brian, Walter, Lia (her own) |
| `oversight` | Regional Marketing Manager (RMM) senior management. Not doing the outreach. | Uma (Central FL territories), Samantha (South FL territories) |
| `supervisor` | ADC clinical oversight. Long-running, no `ended_at`. | Lia → all North FL, Ariel → all Central FL, Samantha → all South FL |
| `partner` | Reserved for two-rep splits if you ever need them. Not used in initial seed. | — |

### 2. Samantha is ADC **and** RMM — modeled via secondary roles

Coordinators row for Samantha:

```
role            = 'assoc_director'                        -- primary
secondary_roles = ['marketing_rep', 'regional_marketing_manager']
```

This makes her show up in role-filter dropdowns as both ADC and RMM, but she has one canonical primary role. The RMM responsibility lives in her assignment rows (`oversight` rows for each South FL territory).

Uma in Central FL stays single-role: `regional_marketing_manager` as primary. She's the cleanest case.

### 3. Hollie moves to FL South (reverting v2's region-group change)

v2 had Hollie under Central FL per the original brief. Now flipped back to South FL per Q5.

Updated FL South territory list:

```
South FL (FL)
  Brevard & Indian River          — primary: Hollie Fincher (RMR)   [legacy: J]
  Palm Beach, Martin & St. Lucie  — primary: Brian Roffe (RMR)      [legacy: T, V]
                                    oversight: Samantha (RMM)
                                    supervisor: Samantha (ADC)
```

Updated FL Central:

```
Central FL (FL)
  Lake, Sumter & Marion           — primary: Kaylee Ramsey (RMR)    [legacy: H]
  Manatee, Tampa, Pinellas & Polk — primary: Ariel Maboudi (ADC)    [legacy: M, N]
  Orange, Osceola & Seminole      — primary: Robby Robinson (RMR)   [legacy: A]
                                    oversight: Uma Jacobs (RMM)
                                    supervisor: Ariel Maboudi (ADC)
```

### 4. Region G merges into Duval & Clay

Per Q4. Updated FL North:

```
North FL (FL)
  Duval & Clay                    — primary: Lia Davis (ADC)        [legacy: B, G]
  Flagler & St. Johns             — primary: Earl Dimaano (RMR)     [legacy: C]
```

`legacy_region_letters = ['B','G']` on the Duval & Clay row drives the backfill of any historical `marketing_contacts.region IN ('B','G')` rows to this territory_id.

If you decide G should be its own named territory later, splitting is a single migration: insert a new row, move the relevant `marketing_contacts.territory_id`. Reversible.

### 5. ADC scorecard rendering — per Q3

Default dashboard view for ADCs shows the **supervised aggregate**:

> "Lia Davis — North FL: 47 referrals MTD across Duval & Clay + Flagler & St. Johns"

A drill-down expands to per-territory breakdown:

> Duval & Clay (Lia, primary): 31 referrals
> Flagler & St. Johns (Earl, primary): 16 referrals

This gives the ADC the right number for her own scorecard AND visibility into her reps' contributions, without needing two separate dashboards.

---

## 6. Final person/role table (v3)

| # | Name | Role (primary) | Secondary roles | Territory | Region Group | Assignment role(s) for that territory |
|---|---|---|---|---|---|---|
| 1 | Lia Davis | `assoc_director` (ADC) | `marketing_rep` | Duval & Clay (incl. legacy G) | North FL | `primary` (her own) + `supervisor` for Flagler & St. Johns |
| 2 | Earl Dimaano | `regional_marketing_rep` (RMR) | `marketing_rep` | Flagler & St. Johns | North FL | `primary` |
| 3 | Kaylee Ramsey | `regional_marketing_rep` (RMR) | `marketing_rep` | Lake, Sumter & Marion | Central FL | `primary` |
| 4 | Hollie Fincher | `regional_marketing_rep` (RMR) | `marketing_rep` | Brevard & Indian River | **South FL** (per Q5) | `primary` |
| 5 | Ariel Maboudi | `assoc_director` (ADC) | `marketing_rep` | Manatee/Tampa/Pinellas/Polk | Central FL | `primary` (her own) + `supervisor` for Kaylee's, Hollie-not-applicable, Robby's territories |
| 6 | Samantha Faliks | `assoc_director` (ADC) | `marketing_rep`, **`regional_marketing_manager`** | Palm Beach/Martin/St. Lucie | South FL | `oversight` (RMM) + `supervisor` (ADC) for PB/M/SL; `supervisor` for Brevard & Indian River (Hollie's) |
| 7 | Uma Jacobs | `regional_marketing_manager` (RMM) | `marketing_rep` | Orange/Osceola/Seminole | Central FL | `oversight` |
| 8 | Robby Robinson | `regional_marketing_rep` (RMR) — *pending Q1.5* | `marketing_rep` | Orange/Osceola/Seminole | Central FL | `primary` |
| 9 | Brian Roffe | `regional_marketing_rep` (RMR) — *pending Q1.5* | `marketing_rep` | Palm Beach/Martin/St. Lucie | South FL | `primary` |
| 10 | Walter Holston | `regional_marketing_rep` (RMR) — *pending Q1.5* | `marketing_rep` | Georgia Territory | Georgia | `primary` (is_active=false until 6/1) |

---

## 7. Remaining open questions

Four left. Phase 2 still parked until these are answered.

- **Q1.5 — Is HAE distinct from RMR?** Liam's clarification used "marketing rep" for Robby/Brian, suggesting same role as Earl/Kaylee/Hollie. The original brief listed HAE as a new distinct role. Pick:
  - **(a)** Collapse. HAE and RMR are the same code role. Title difference lives on `coordinators.job_title`. **(my recommendation — Liam's own wording supports this)**
  - **(b)** Keep HAE distinct as a separate primary role with its own `page_permissions` column. If you go this way, tell me what's actually operationally different (comp band, quota, reporting line, page access).

- **Q7 — RMM vs. ADC seniority where both exist.** Central FL has Uma (RMM) and Ariel (ADC). My default: **peers, both report to Carla.** Affects org-chart UI and reporting arrows. Confirm or set a hierarchy.

- **Q8 — Walter's interim supervisor in Georgia.** No ADC, no RMM there. My recommendation: **Carla as interim supervisor.** Alternative: leave supervisor empty, Walter reports straight to Liam.

- **Q9 — Drop the legacy `regional_manager` code key in Phase 4?** After migration: zero users hold it. Default: **tombstone it** (keep the column as a no-op). Cleaner schema vs. lower blast radius trade-off.

---

## 8. Data model — final shape (v3, ready to build once Q1.5 lands)

Two tables, unchanged from v2 section 3 (still flat, still 2 tables, not 4):

```sql
CREATE TABLE marketing_territories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,           -- "Duval & Clay"
  state                 text NOT NULL,           -- "FL" | "GA"
  region_group          text NOT NULL,           -- "North FL" | "Central FL" | "South FL" | "Georgia"
  counties              text[] NOT NULL DEFAULT '{}',
  legacy_region_letters text[] NOT NULL DEFAULT '{}',
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_team_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordinator_id  uuid NOT NULL REFERENCES coordinators(id) ON DELETE CASCADE,
  territory_id    uuid NOT NULL REFERENCES marketing_territories(id) ON DELETE CASCADE,
  assignment_role text NOT NULL CHECK (assignment_role IN
                    ('primary','oversight','supervisor','partner')),
  started_at      date NOT NULL DEFAULT CURRENT_DATE,
  ended_at        date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coordinator_id, territory_id, assignment_role, ended_at)
);

CREATE INDEX idx_mta_active ON marketing_team_assignments(territory_id, assignment_role)
  WHERE ended_at IS NULL;
CREATE INDEX idx_mta_by_coordinator ON marketing_team_assignments(coordinator_id)
  WHERE ended_at IS NULL;
```

Initial territory seed (8 territories):

```
North FL:
  Duval & Clay                    [legacy: B, G]
  Flagler & St. Johns             [legacy: C]

Central FL:
  Lake, Sumter & Marion           [legacy: H]
  Manatee, Tampa, Pinellas & Polk [legacy: M, N]
  Orange, Osceola & Seminole      [legacy: A]

South FL:
  Brevard & Indian River          [legacy: J]
  Palm Beach, Martin & St. Lucie  [legacy: T, V]

Georgia:
  Georgia Territory               [legacy: (none)]
```

Initial assignment seed (~16 rows):

| # | Coordinator | Territory | role |
|---|---|---|---|
| 1 | Lia | Duval & Clay | primary |
| 2 | Lia | Flagler & St. Johns | supervisor |
| 3 | Earl | Flagler & St. Johns | primary |
| 4 | Kaylee | Lake, Sumter & Marion | primary |
| 5 | Ariel | Lake, Sumter & Marion | supervisor |
| 6 | Ariel | Manatee/Tampa/Pinellas/Polk | primary |
| 7 | Robby | Orange/Osceola/Seminole | primary |
| 8 | Uma | Orange/Osceola/Seminole | oversight |
| 9 | Ariel | Orange/Osceola/Seminole | supervisor |
| 10 | Hollie | Brevard & Indian River | primary |
| 11 | Samantha | Brevard & Indian River | supervisor |
| 12 | Brian | Palm Beach/Martin/St. Lucie | primary |
| 13 | Samantha | Palm Beach/Martin/St. Lucie | oversight |
| 14 | Samantha | Palm Beach/Martin/St. Lucie | supervisor |
| 15 | Walter | Georgia Territory | primary (is_active=false until 6/1) |
| 16 | (TBD per Q8) | Georgia Territory | supervisor — recommend Carla |

---

## 9. What I still need from you

1. **Q1.5** — collapse HAE into RMR, or keep distinct? **Critical, locks role count.**
2. **Q7** — RMM/ADC seniority for Central FL?
3. **Q8** — Walter's interim supervisor (recommend Carla)?
4. **Q9** — Tombstone `regional_manager` column, or drop in Phase 4?

Once those four land, the design is final and Phase 2 build can start.

---

## 10. Unchanged from v1/v2

Carrying forward without modification: the 2-table model (section 8), dual-email Option B for June 1 → planned Option A cutover mid-July, 8-dashboard-addition mapping, 7-8 working day build estimate over 2.5 weeks clock time, data hygiene side-quests (`CLAUDE.md` Hervylie last name fix, region `I` cleanup, RLS sweep on 3 staging tables).
