# Marketing Team Directory — Phase 1 Design Proposal (v2)

**Author:** Claude, advisor to Liam O'Brien (Director of Operations)
**Date:** 2026-05-30
**Status:** Revised post-clarification. Phase 2 build still on hold pending Q1.5, Q3, Q4, Q5, Q6, Q7, Q8, Q9.
**Supersedes:** `Marketing_Team_Directory_Design.md` (v1, 2026-05-30 earlier today). v1 is preserved as the historical record.

---

## What's different from v1 (read this first)

Liam clarified the role structure after seeing v1:

> "Uma is the **Regional Manager**. Robby is the **Central Florida marketing rep**."
> "Samantha is the **Associate Clinical Director (also acting RMP in those territories)** and Brian is the **South Florida Regional Marketing rep**."

This reshapes the role taxonomy in three ways v1 got wrong or didn't anticipate:

1. **There's a senior tier above the field reps.** "Regional Manager" in Liam's wording is a marketing oversight role, distinct from the ground-level rep. Uma holds it. v1 collapsed Uma into the RMP tier — that was wrong.
2. **HAE may not be a separate role at all.** Liam called Robby a "Central Florida marketing rep" and Brian a "South Florida Regional Marketing rep" — same phrasing as Earl/Hollie/Kaylee. The "Healthcare Account Executive" title from the brief may just be a fancier external-facing label, not a distinct seniority tier. v1 treated HAE as its own role. **This needs lock-down — Q1.5 below.**
3. **ADCs can hold dual capacity.** Samantha is ADC AND acting RMP in her territories until Brian ramps. v1 only modeled supervisor relationships for ADCs. We need a way to track "ADC who is ALSO doing day-to-day outreach right now."

v2 also raises a **name collision** that v1 missed: the existing `regional_manager` role code key is already used by 4 operational users (Earl, Hollie, Kaylee, Uma). If we redefine "Regional Manager" to mean Uma's new marketing oversight role, we collide with what the code key means elsewhere. Fix below in section 4.

Everything else from v1 stands: the flat 2-table territory model, dual-email Option B, Walter as pending-hire, the 8 dashboard additions mapping, the build sequence. The deltas in this doc are all in sections 1, 4, 6, and 9.

---

## TL;DR — what I'm now recommending (v2)

1. **Don't reuse the code key `regional_manager`.** Pick a new key for Uma's role: my recommendation is `regional_marketing_manager` (RMM). The existing `regional_manager` role becomes a no-op once Earl/Hollie/Kaylee migrate to RMR and Uma migrates to RMM. Less ambiguity, no cross-codebase blast radius.
2. **Collapse HAE and RMP into one role, `regional_marketing_rep` (RMR), pending Liam's confirmation.** Liam's own clarification uses "Regional Marketing rep" for both Robby and Brian. The "Healthcare Account Executive" label looks like external-facing title polish, not a distinct seniority/comp tier. Store the displayed title in `coordinators.job_title` (column already exists). If Liam confirms HAE is genuinely a different tier (different comp band, different quota, different reporting), we keep two roles. Until then, one role.
3. **Use the `assignment_role` enum to model relationships, not job titles.** v1's enum (`primary` / `partner` / `supervisor`) doesn't capture "acting outreach coverage." v2 expands to: `primary` / `oversight` / `acting` / `supervisor`. Job title stays on `coordinators`; what the person does for *this specific territory* lives on the assignment row.
4. **Samantha gets two assignment rows in the same territory.** One for her ongoing ADC supervisor relationship (with no `ended_at`), one for her temporary acting-rep coverage (with an `ended_at` set when Brian fully ramps). Two rows is cleaner than one row with overloaded semantics.
5. **Optionally derive ADC supervision instead of materializing it.** Lia → all North FL territories, Ariel → all Central FL, Samantha → all South FL. This is a deterministic rule from the ADC's region_group; we don't need to insert a supervisor row per territory unless we want each ADC's assignments to be queryable as a flat list. I'd materialize them anyway — explicit rows are easier to reason about than functions that infer relationships.

---

## 1. Updated role taxonomy (v2)

**Three job-title roles for the marketing surface:**

| Code key | Display label | Who holds it | Acts as |
|---|---|---|---|
| `assoc_clinical_director` (existing key: `assoc_director`) | Associate Clinical Director (ADC) | Lia, Ariel, Samantha | Clinical oversight over their region group; can also primary a territory (Ariel does); can act as RMR temporarily (Samantha does) |
| `regional_marketing_manager` (NEW) | Regional Marketing Manager (RMM) | Uma (initially); architecturally room for North FL and South FL RMMs later | Senior marketing oversight per region group; not day-to-day outreach |
| `regional_marketing_rep` (NEW; HAE collapsed in pending Q1.5) | Regional Marketing Rep (RMR) | Earl, Kaylee, Hollie, Robby, Brian, Walter (when provisioned) | Day-to-day outreach owner for a named territory |

**One secondary role kept:**

- `marketing_rep` (existing, unchanged) — granted to anyone who should see Marketing CRM. ADCs, RMMs, and RMRs all get this so the existing RLS keeps working without rewriting.

**Roles I'd push back on:**

- ~~`healthcare_account_executive` as a separate primary role~~ — collapsing into `regional_marketing_rep` pending Liam's answer to Q1.5. If kept distinct, it's a 3rd marketing job-title role and a 5th column on `page_permissions` for no behavioral difference.
- ~~Renaming the existing code key `assoc_director` → `assoc_clinical_director`~~ — same argument as v1. The displayed label is already "Assoc. Director of Clinical Ops." The code key change costs 12+ files of edits including RLS policies for zero functional benefit. **Keep the existing `assoc_director` code key. Just rename the *displayed* label** to "Associate Clinical Director (ADC)" on marketing-context pages.
- ~~Reusing the `regional_manager` code key for Uma's role~~ — name collision with the existing operational meaning. Use `regional_marketing_manager` instead.

**What happens to the existing `regional_manager` role:**

Today, Earl/Hollie/Kaylee/Uma all hold `coordinators.role = 'regional_manager'`. All 4 are on the marketing team. After migration:

- Earl, Hollie, Kaylee → `regional_marketing_rep`
- Uma → `regional_marketing_manager`
- Result: zero users left with `regional_manager`.

The `regional_manager` column on `page_permissions` stays as a no-op for now (don't drop columns mid-migration — it can be cleaned up in a Phase 4 housekeeping pass). Update `useAuth.jsx` and `Sidebar.jsx` to add branches for `regional_marketing_rep` and `regional_marketing_manager`. Old `regional_manager` branch can stay or be removed — see Q9 below.

---

## 2. Person-by-person diff (v2 — updated for new roles)

| # | Name | Today's Role | Today's Regions | NEW Role (v2) | NEW Territory | NEW Region Group | Δ |
|---|---|---|---|---|---|---|---|
| 1 | Lia Davis | `assoc_director` | B, C, G | `assoc_director` (label "ADC") | Duval & Clay | North FL | role unchanged; named territory + ADC supervisor over all North FL |
| 2 | Earl Dimaano | `regional_manager` | C | `regional_marketing_rep` (RMR) | Flagler & St. Johns | North FL | **role key changes** (regional_manager → regional_marketing_rep); territory changes |
| 3 | Kaylee Ramsey | `regional_manager` | H | `regional_marketing_rep` (RMR) | Lake, Sumter & Marion | Central FL | role key changes; territory changes |
| 4 | Hollie Fincher | `regional_manager` | J | `regional_marketing_rep` (RMR) | Brevard & Indian River | Central FL | role key changes; region group changes (was J=South, now Central) |
| 5 | Ariel Maboudi | `assoc_director` | A, H, M, N | `assoc_director` (label "ADC") | Manatee, Tampa, Pinellas & Polk (Lakeland) | Central FL | role unchanged; drop region A; primaries her own territory + supervisor over Central FL |
| 6 | Samantha Faliks | `assoc_director` | J, T, V | `assoc_director` (label "ADC + acting RMR") | Palm Beach, Martin & St. Lucie | South FL | role unchanged; drop region J; dual capacity: ADC supervisor + acting RMR until Brian ramps |
| 7 | Uma Jacobs | `regional_manager` | A | `regional_marketing_manager` (RMM) | Orange, Osceola & Seminole (oversight, not primary) | Central FL | **role key changes** to NEW key `regional_marketing_manager`; not the day-to-day outreach owner |
| 8 | Robby Robinson | **NEW** | — | `regional_marketing_rep` (RMR) — pending Q1.5 | Orange, Osceola & Seminole | Central FL | net-new user; primary outreach owner |
| 9 | Brian Roffe | **NEW** | — | `regional_marketing_rep` (RMR) — pending Q1.5 | Palm Beach, Martin & St. Lucie | South FL | net-new user; primary outreach owner |
| 10 | Walter Holston | **NEW** | — | `regional_marketing_rep` (RMR) — pending Q1.5 | Georgia Territory | Georgia | net-new; **pending hire, no Auth account until June 1** |

`job_title` on each row stores the displayed title — "Regional Marketing Partner" for Earl/Kaylee/Hollie/Uma's old context, "Healthcare Account Executive" for Robby/Brian/Walter if Liam confirms that title stays in external comms. Different displayed title, same code role.

---

## 3. Data model — unchanged from v1 (still recommending 2 tables)

The flatter two-table model (`marketing_territories` + `marketing_team_assignments`) from v1 still holds. The only change in v2 is the `assignment_role` enum values.

### Updated `assignment_role` enum

```sql
-- assignment_role text NOT NULL CHECK (assignment_role IN
--   ('primary', 'oversight', 'acting', 'supervisor', 'partner'))
```

| Value | Meaning | Who uses it |
|---|---|---|
| `primary` | The day-to-day outreach owner for this territory. One per territory. Metrics roll up to this person's scorecard. | Earl, Kaylee, Hollie, Ariel (her own), Robby, Brian, Walter, Lia (her own) |
| `oversight` | RMM-tier senior oversight. Not doing the outreach; reviewing and managing the rep. | Uma (Orange/Osceola/Seminole) |
| `acting` | Temporary outreach coverage by someone whose primary role is something else. Has an `ended_at` planned. | Samantha (Palm Beach/Martin/St. Lucie acting RMR coverage) |
| `supervisor` | ADC supervisor relationship — clinical oversight over the territory. Long-running, no `ended_at`. | Lia → all North FL, Ariel → all Central FL, Samantha → all South FL |
| `partner` | Reserved for future use — e.g., if two reps split a large territory permanently. Not used in initial seed. | — |

**Why two rows for Samantha:** in Palm Beach/Martin/St. Lucie she's both the long-running ADC supervisor AND the temporary acting RMR. Two rows means each metric rolls up cleanly:

- ADC scorecard for South FL: sums everything where Samantha is `supervisor` (her ongoing role).
- Acting RMR coverage report: queries `assignment_role='acting'` and shows the timeline.
- When Brian fully ramps, set `ended_at` on the acting row. The supervisor row stays untouched.

### Updated initial seed (showing only the changed rows from v1)

```
Central FL
  Orange, Osceola & Seminole
    - Robby Robinson  (assignment_role='primary')      ← was v1: primary
    - Uma Jacobs      (assignment_role='oversight')    ← was v1: partner — CHANGED
    - Ariel Maboudi   (assignment_role='supervisor')   ← ADC supervisor for all Central FL

  Lake, Sumter & Marion
    - Kaylee Ramsey   (assignment_role='primary')
    - Ariel Maboudi   (assignment_role='supervisor')

  Brevard & Indian River
    - Hollie Fincher  (assignment_role='primary')
    - Ariel Maboudi   (assignment_role='supervisor')

  Manatee, Tampa, Pinellas & Polk (Lakeland)
    - Ariel Maboudi   (assignment_role='primary')      ← Ariel primaries her own territory
                                                       (no separate supervisor row — she's both)

South FL
  Palm Beach, Martin & St. Lucie
    - Brian Roffe     (assignment_role='primary')
    - Samantha Faliks (assignment_role='acting',     notes='Acting RMR until Brian fully ramps')  ← NEW row v2
    - Samantha Faliks (assignment_role='supervisor', notes='Ongoing ADC oversight')              ← also present

Georgia
  Georgia Territory
    - Walter Holston  (assignment_role='primary', is_active=false until June 1)
                      No supervisor row yet — Georgia has no ADC or RMM. Flagged for Liam.
```

### Edge case: who supervises Walter in Georgia?

No ADC and no RMM exists for Georgia today. Three options for the structure:

- (a) Leave the supervisor slot empty until you hire/assign a Georgia ADC. Walter rolls up to Liam directly via the chain `super_admin → Walter`.
- (b) Designate Carla (Operations Manager) as interim supervisor for Georgia outreach. She already has admin role, can be added with `assignment_role='supervisor'`.
- (c) Designate Liam himself as Walter's interim supervisor (a row for `super_admin` would be visually noisy but technically clean).

My recommendation: **(b)** — Carla is the most natural fit and keeps reporting clean. Flagged as Q8 below.

---

## 4. Role enum changes (v2 — replaces v1 section 4)

**Migrations needed:**

1. **`page_permissions` schema:**
   - Add column `assoc_director` — already exists, no-op.
   - Add column `regional_marketing_manager` boolean default false.
   - Add column `regional_marketing_rep` boolean default false.
   - Add column `healthcare_account_executive` — only if Q1.5 resolves to "HAE is distinct." Otherwise skip.
   - Keep column `regional_manager` for now as a no-op.
   - Keep column `marketing_rep` (secondary-role grant column).

2. **Seed the new columns:** for any `page_permissions` row where `regional_manager=true`, set `regional_marketing_manager=true` and `regional_marketing_rep=true` (mirror the current grants to both new roles).

3. **Migrate user rows in `coordinators`:**
   ```
   UPDATE coordinators SET role = 'regional_marketing_rep'
   WHERE id IN (Earl, Kaylee, Hollie);

   UPDATE coordinators SET role = 'regional_marketing_manager'
   WHERE id = Uma;
   ```

4. **`useAuth.jsx` and `Sidebar.jsx`:** add branches for `regional_marketing_manager` and `regional_marketing_rep` in `pageAllowsRole()`. Add labels to the role label map:
   - `regional_marketing_manager` → "Regional Marketing Manager"
   - `regional_marketing_rep` → "Regional Marketing Rep" (or "Regional Marketing Partner" / "Healthcare Account Executive" if displayed title varies per person — but that lives on `coordinators.job_title`, not on the role label map)

5. **RLS function `can_access_marketing_region` / `can_access_marketing_territory`:** today it checks `role IN ('assoc_director','regional_manager','marketing_rep')`. Replace with `role IN ('assoc_director','regional_marketing_manager','regional_marketing_rep','marketing_rep')`. Keep `'regional_manager'` in the list temporarily for backward compat — remove in Phase 4 cleanup.

---

## 5. Dual-email — unchanged from v1

Option B (`primary_email` + `legacy_email` columns) for June 1, with a planned Option A cutover (Auth email migration) in mid-July after 6 weeks of stability. Full reasoning in v1 section 5; nothing in Liam's clarification changes it.

---

## 6. Territory overlap & supervisory model — RESOLVED + NEW

**Resolved by Liam's clarification:**

- **Q1 (Orange/Osceola/Seminole):** Robby = `primary` (day-to-day outreach), Uma = `oversight` (RMM senior management). Ariel = `supervisor` (ADC clinical oversight, automatic by region group). ✓
- **Q2 (Palm Beach/Martin/St. Lucie):** Brian = `primary`, Samantha holds two rows (`supervisor` as ongoing ADC + `acting` as temporary outreach coverage). ✓

**Still open from v1:**

- **Q3 — ADC scorecard semantics.** When the dashboard says "Lia's referrals MTD," does that mean (a) only what Lia personally generated in her own territory, or (b) everything generated in any North FL territory she supervises? Recommendation: surface both, labeled clearly. Confirm.
- **Q4 — Legacy region G successor.** Your new territory list doesn't name a successor for region G. Is it absorbed into Duval & Clay (Lia keeps it), going dormant, or becoming its own named territory? Tell me the counties if it stays alive.
- **Q5 — Hollie's region group.** Letter J is grouped under FL South in `constants.js` today. New spec puts her in Central FL. Confirming: this is a marketing-only re-classification, operations still treats J as FL South. Correct?
- **Q6 — Hervylie out of marketing entirely.** Confirm.

**New questions raised by v2 clarification:**

- **Q1.5 — IS Healthcare Account Executive a distinct role from Regional Marketing Rep?** Liam's clarification used "marketing rep" for Robby AND Brian, suggesting they're the same role as Earl/Hollie/Kaylee. But the original brief listed "Healthcare Account Executive" as a NEW role with the note "1 NEW role: Healthcare Account Executive (HAE) — separate from RMP and ADC." These two statements contradict. Lock-down options:
  - **(a)** HAE and RMR are the same code role. Title difference ("Healthcare Account Executive" vs "Regional Marketing Partner") lives on `coordinators.job_title`, displayed in directory/business cards/email signatures. **(my recommendation)**
  - **(b)** HAE is a distinct seniority tier — different comp band, different quota, different reporting line, different page permissions. Then we add `healthcare_account_executive` as a separate primary role and column on `page_permissions`.
  - Pick (a) or (b). If (b), tell me what's actually different about how HAEs operate vs. RMRs so the model reflects it.

- **Q7 — RMM vs ADC seniority in shared region groups.** Central FL now has BOTH an RMM (Uma) and an ADC (Ariel). Who is senior to whom? Three plausible answers:
  - RMM > ADC (Uma is Ariel's senior for marketing matters).
  - ADC > RMM (Ariel is Uma's senior; Uma is a marketing specialist reporting up).
  - Peers (Uma owns marketing oversight, Ariel owns clinical oversight, neither reports to the other; both report to Carla or Liam).
  - Affects org-chart UI and "report to" arrows. My default: **peers, both report to Carla.** Confirm.

- **Q8 — Who supervises Walter in Georgia?** Georgia has no ADC and no RMM yet. Options: (a) leave supervisor blank, (b) Carla as interim, (c) Liam as interim. **My recommendation: (b) Carla.** Confirm.

- **Q9 — Should we deprecate the legacy `regional_manager` code key entirely?** After migration, zero users hold it. Two options:
  - **(a)** Drop the column in Phase 4 housekeeping. Cleanest long-term. Mid-blast-radius (RLS function references, `useAuth.jsx`, `Sidebar.jsx`, `page_permissions`).
  - **(b)** Keep the column as a tombstone. Lowest blast radius. Slightly sloppy schema. **(my recommendation)**

---

## 7. The 8 dashboard additions — unchanged from v1

Mapping in v1 section 7 still holds. The role-key changes don't affect what gets built, only what the filter "Role" dropdown shows. The dropdown will now list: ADC, RMM, RMR (+ HAE if Q1.5 keeps it distinct).

---

## 8. Phase 2 build sequence — updated

The order in v1 section 8 still holds, with two adjustments:

**Day 1 additions:**

- Migration also adds `regional_marketing_manager` and `regional_marketing_rep` columns on `page_permissions` and seeds them from the current `regional_manager` grants.
- `coordinators` migrations update Earl/Kaylee/Hollie/Uma roles per section 4.

**Day 2 additions:**

- Insert Samantha's second assignment row (one `supervisor`, one `acting`).
- If Q1.5 → (b), provision Robby and Brian as `healthcare_account_executive`. If Q1.5 → (a), provision as `regional_marketing_rep` with `job_title='Healthcare Account Executive'`.

**No change to total effort estimate.** ~7-8 working days of build, ~2.5 weeks clock time.

---

## 9. What I need from you before code

Sign-off on the v2 deltas:

1. New role keys `regional_marketing_manager` and `regional_marketing_rep`. **Yes / change names.**
2. Existing `assoc_director` code key stays, displayed label becomes "Associate Clinical Director (ADC)". **Yes / no.**
3. The expanded `assignment_role` enum: `primary` / `oversight` / `acting` / `supervisor` / `partner`. **Yes / different terms.**
4. Samantha gets two assignment rows for Palm Beach/Martin/St. Lucie. **Yes / single row with overloaded notes.**

Plus answers to the open questions:

- **Q1.5** — HAE distinct from RMR, or collapse? **Critical — locks role count.**
- **Q3** — ADC scorecard: personal vs. supervised aggregate, or both?
- **Q4** — Region G: successor territory, or going dormant?
- **Q5** — Hollie's region group is marketing-only Central FL? Confirm.
- **Q6** — Hervylie stays out of marketing entirely? Confirm.
- **Q7** — RMM vs. ADC seniority in shared region groups (Central FL)?
- **Q8** — Walter's interim supervisor in Georgia (recommend Carla)?
- **Q9** — Drop legacy `regional_manager` column in Phase 4, or tombstone it?

---

## 10. Data hygiene side-quests (unchanged from v1)

- `CLAUDE.md` says "Hervylie Manaay," DB says "Hervylie Senica." Update the doc.
- Admin users (Carla, Ashley, Dustin, Randi, Yvonne) have legacy letter `I` in their `regions` arrays. No region I exists. Drop it.
- 3 staging tables have RLS disabled (`intake_import_staging_2026_05_20`, `auth_sync_pending`, `_auth_backfill_snapshot_2026_05_20`). Exposed to anon key. Schedule an RLS sweep.

---

## Standby

v1 stays parked for the record. Phase 2 build holds until you answer Q1.5, Q3-Q9 and sign off on the role-key choices in section 9. I'd particularly like Q1.5 answered first — if HAE collapses into RMR, the role taxonomy is final and everything else falls into place. If HAE stays distinct, I want to know the operational reason so the data model reflects it.
