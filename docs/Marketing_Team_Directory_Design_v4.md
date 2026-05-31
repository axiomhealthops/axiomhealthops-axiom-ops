# Marketing Team Directory — Phase 1 Design Proposal (v4)

**Author:** Claude, advisor to Liam O'Brien (Director of Operations)
**Date:** 2026-05-30
**Status:** Q1.5 locked. v4 reshapes the role model around clinical-primary vs. marketing-primary. **Phase 2 still on hold pending Q3-redux, Q5-final, Q8.** (Q7 and Q9 are now moot — see section 7.)
**Supersedes:** `Marketing_Team_Directory_Design_v3.md`. v1, v2, v3 preserved.

---

## Liam's clarification

> "If there is a staff member who is a Regional Manager, then they are a clinician first, marketing executive second. If they are a HAE, their primary job is marketing not clinical work."

This locks two things and reshapes one:

1. **HAE and RMP are distinct roles** (resolves Q1.5). HAE = entry-level marketing-primary. RMP = senior marketing-primary. Both marketing-primary, different seniority.
2. **Some roles are inherently clinical-primary, others are inherently marketing-primary.** The role itself encodes the "primary job" — no separate flag needed.
3. **v3 had Samantha modeled wrong.** v3 made her ADC + Regional Manager (RMM). She's actually ADC + **acting RMP**. RMP is a marketing-primary senior role; she's covering it temporarily (with planned `ended_at`) until a permanent South FL RMP is hired. Re-introducing the `acting` value to the `assignment_role` enum.

v3's data model holds; v3's role inventory is incorrect. v4 fixes the role inventory, brings back `acting`, and adds a Marketing Team Directory page spec.

---

## Final role taxonomy (v4 — this is the lock)

Four roles touch the marketing surface. Two are inherently clinical-primary, two are inherently marketing-primary. **The role name itself tells you which is which** — no separate `primary_role_category` column needed (going with Option A from the brief).

| Code key | Display label | Primary category | Seniority tier | Who holds it |
|---|---|---|---|---|
| `assoc_director` (existing) | Associate Clinical Director (ADC) | Clinical | Senior | Lia, Ariel, Samantha |
| `regional_manager` (existing — but reassigned) | Regional Manager | Clinical | Senior | **Uma only** (after migration) |
| `regional_marketing_partner` (**NEW**) | Regional Marketing Partner (RMP) | Marketing | Senior | Earl, Kaylee, Hollie |
| `healthcare_account_executive` (**NEW**) | Healthcare Account Executive (HAE) | Marketing | Entry | Robby, Brian, Walter (pending) |

The `marketing_rep` secondary role stays as-is — granted to all 10 people so the existing RLS keeps working without rewriting it.

### Classification helper (no new column, just a lookup)

In `src/lib/constants.js`:

```js
// Roles whose primary job is clinical. Marketing contributions from these
// people count as "secondary contribution" on marketing scorecards.
export const CLINICAL_PRIMARY_ROLES = ['assoc_director', 'regional_manager'];

// Roles whose primary job is marketing. Marketing contributions from these
// people count as "primary contribution" on marketing scorecards.
export const MARKETING_PRIMARY_ROLES = ['regional_marketing_partner', 'healthcare_account_executive'];

// Helper used everywhere the dashboard needs to split rollups.
export function isMarketingPrimary(role) {
  return MARKETING_PRIMARY_ROLES.includes(role);
}
```

Why this beats a `primary_role_category` enum column: the role itself is the source of truth. Adding a column means you can have a person where `role='healthcare_account_executive'` AND `primary_role_category='clinical'` and you're suddenly debugging which is canonical. A lookup means the answer is always derived from the role and can never drift.

---

## Final person table (v4)

| # | Name | Code role (after migration) | Primary | Display title | Territory | Region Group | Assignment role(s) for that territory |
|---|---|---|---|---|---|---|---|
| 1 | Lia Davis | `assoc_director` | Clinical | ADC | Duval & Clay (legacy: B, G) | North FL | `primary` (own) + `supervisor` for Flagler & St. Johns |
| 2 | Earl Dimaano | `regional_marketing_partner` ← migrated from `regional_manager` | Marketing | RMP | Flagler & St. Johns | North FL | `primary` |
| 3 | Kaylee Ramsey | `regional_marketing_partner` ← migrated | Marketing | RMP | Lake, Sumter & Marion | Central FL | `primary` |
| 4 | Hollie Fincher | `regional_marketing_partner` ← migrated | Marketing | RMP | Brevard & Indian River | South FL *(pending Q5 final)* | `primary` |
| 5 | Ariel Maboudi | `assoc_director` | Clinical | ADC | Manatee/Tampa/Pinellas/Polk | Central FL | `primary` (own) + `supervisor` for Lake/Sumter/Marion + Orange/Osceola/Seminole |
| 6 | Samantha Faliks | `assoc_director` | Clinical | ADC + acting RMP | Palm Beach/Martin/St. Lucie | South FL | `supervisor` (ongoing ADC) + **`acting`** (RMP-level coverage, planned `ended_at`) + `supervisor` for Brevard & Indian River (Hollie's) |
| 7 | Uma Jacobs | `regional_manager` ← unchanged | Clinical | Regional Manager | Orange/Osceola/Seminole | Central FL | `oversight` (clinical Regional Manager view of the territory; not marketing-primary) |
| 8 | Robby Robinson | `healthcare_account_executive` (NEW user) | Marketing | HAE | Orange/Osceola/Seminole | Central FL | `primary` |
| 9 | Brian Roffe | `healthcare_account_executive` (NEW user) | Marketing | HAE | Palm Beach/Martin/St. Lucie | South FL | `primary` |
| 10 | Walter Holston | `healthcare_account_executive` (NEW user, is_active=false until 6/1) | Marketing | HAE | Georgia Territory | Georgia | `primary` |

### What changed from v3

- **Samantha** — was modeled as ADC + RMM (permanent). Now ADC + **acting RMP** (temporary, with `ended_at` when permanent South FL RMP is hired).
- **Uma** — was `regional_marketing_manager` in v3. Now stays `regional_manager` (the existing code key — Liam's framework redefines what RM *means* but uses the existing key). She's clinical-primary, contributing marketing as a secondary function.
- **Earl, Kaylee, Hollie** — were `regional_manager` in the DB today, slated for `regional_marketing_partner` (NEW key). Same as v3 in intent, but now with the explicit clinical/marketing rationale.
- **Robby, Brian, Walter** — were `regional_marketing_rep` in v3. Now `healthcare_account_executive` (the v3 collapse is undone per Q1.5 lock).
- **`acting` enum value** returns to `assignment_role`.

---

## Migration plan — explicit role reassignments

This is the only DB write that touches existing user records. Worth showing it inline so you can review.

```sql
-- 1. NEW roles to enum (page_permissions columns)
ALTER TABLE page_permissions ADD COLUMN healthcare_account_executive boolean NOT NULL DEFAULT false;
ALTER TABLE page_permissions ADD COLUMN regional_marketing_partner   boolean NOT NULL DEFAULT false;

-- 2. Seed the new columns from the current regional_manager grant for marketing-crm.
-- Both new marketing-primary roles should see Marketing CRM. Other pages stay false.
UPDATE page_permissions
   SET healthcare_account_executive = regional_manager,
       regional_marketing_partner   = regional_manager
 WHERE page_key = 'marketing-crm';

-- 3. Reassign Earl, Kaylee, Hollie from regional_manager → regional_marketing_partner.
UPDATE coordinators
   SET role = 'regional_marketing_partner'
 WHERE id IN (
   '9ce2bbc6-c4eb-49de-8634-62f1f82b44bb',  -- Earl Dimaano
   '0a355f0f-4321-45ff-b6e4-94938cdd0214',  -- Kaylee Ramsey
   '9f49714c-6ab1-4049-8bb5-9600595fe3a7'   -- Hollie Fincher
 );

-- 4. Uma stays regional_manager — no UPDATE needed. (She's the only one left holding this role.)

-- 5. Insert NEW user rows for Robby and Brian (Walter waits until June 1).
--    They get healthcare_account_executive as primary role, marketing_rep as secondary.
INSERT INTO coordinators (full_name, email, role, secondary_roles, regions, is_active, job_title)
VALUES
  ('Robby Robinson', 'robby.robinson@axiomhealthmanagement.com',
     'healthcare_account_executive', ARRAY['marketing_rep'], ARRAY['A'], true,
     'Healthcare Account Executive'),
  ('Brian Roffe', 'brianr@axiomhealthmanagement.com',
     'healthcare_account_executive', ARRAY['marketing_rep'], ARRAY['T','V'], true,
     'Healthcare Account Executive');
-- Walter: insert at June 1 cutover, once his @edemacare.com email exists.
-- Until then, optionally insert with is_active=false and email=NULL for directory display.

-- 6. Add marketing_rep secondary to Lia, Ariel, Samantha, Uma if not already there.
UPDATE coordinators
   SET secondary_roles = ARRAY(SELECT DISTINCT unnest(coalesce(secondary_roles, '{}'::text[]) || ARRAY['marketing_rep']))
 WHERE id IN (
   'dae4e60a-dce0-4176-9624-db24c35893c5',  -- Lia
   'eb0f69cb-6c0d-4bb4-bf24-ade9c8707e9e',  -- Ariel
   '77c8de92-f40b-43c7-88f8-1b77c7fae4bc',  -- Samantha
   'e0f22bf3-cb28-4662-bb6e-4fe47ae3c329'   -- Uma
 );

-- 7. Auth users — Supabase Admin API call out-of-band:
--    supabase.auth.admin.createUser({ email: 'robby.robinson@axiomhealthmanagement.com', ... })
--    supabase.auth.admin.createUser({ email: 'brianr@axiomhealthmanagement.com', ... })
--    Link to coordinators.user_id afterward.
```

**Verification queries after migration:**

```sql
-- Should return: Uma only.
SELECT full_name, role FROM coordinators
WHERE role = 'regional_manager' AND is_active = true;

-- Should return: Earl, Kaylee, Hollie.
SELECT full_name FROM coordinators
WHERE role = 'regional_marketing_partner' AND is_active = true;

-- Should return: Robby, Brian (and Walter once provisioned).
SELECT full_name FROM coordinators
WHERE role = 'healthcare_account_executive' AND is_active = true;
```

---

## Marketing scorecard rules (Q3 redux)

Q3 was "all supervised territories" in v3. The new clinical/marketing primary distinction adds nuance: **same person can contribute as both, and the scorecard needs to separate them.**

### Rules

1. **Marketing-primary person's scorecard** = full credit for everything they produce. This is their job; the volume is theirs.
2. **Clinical-primary person's marketing scorecard** = shown as a separate "secondary contribution" row. Their referrals/outreach count, but they're not held to the same quota.
3. **Territory rollup** shows both bands distinctly. Example for Orange/Osceola/Seminole MTD:

   ```
   Orange, Osceola & Seminole — September MTD
     PRIMARY (marketing):
       Robby Robinson (HAE):      18 referrals, 24 outreach events
     SECONDARY (clinical):
       Uma Jacobs (Regional Mgr): 3 referrals, 4 outreach events
       Ariel Maboudi (ADC):       1 referral, 2 outreach events (supervisor context)
     TOTAL:                       22 referrals, 30 outreach events
   ```

4. **ADC region-group scorecard** (per locked Q3) sums all supervised territories. Now with the primary/secondary split:

   ```
   Lia Davis — North FL — September MTD
     Marketing-primary contribution:    44 referrals  (Earl's work in Flagler/St. Johns)
     Clinical-secondary contribution:    9 referrals  (her own + supervisor touches in Duval & Clay)
     Total North FL:                    53 referrals
   ```

5. **Director / Carla view** has a toggle: "Show by territory" (default — shows totals) or "Show by primary type" (breaks out marketing-primary vs. clinical-secondary across the whole company). The second view is the honest "who's actually doing the bulk of the marketing work" picture.

This makes accountability legible: an ADC's "0 secondary contribution" doesn't mean failure (it's not their job), but an HAE's low primary count is a real signal.

---

## Marketing Team Directory page — new spec

Item 1 of the original 8 dashboard additions was "Territory assignments by county." That expands to a full Marketing Team Directory page since it's now the canonical reference for the org structure.

**Page: `/marketing/team-directory`** (new `page_key='marketing-team-directory'`, section `MARKETING`).

**Layout:**

- **Top filter strip:** State (FL / GA / All), Region Group (North FL / Central FL / South FL / Georgia / All), Primary type (Marketing-primary / Clinical-primary / Both).
- **Card grid:** one card per person on the marketing team (all 10).
  - Header: Name + display title (e.g., "Samantha Faliks — Associate Clinical Director (ADC)").
  - Badge row: **"Marketing Primary"** (orange) OR **"Clinical Primary + Marketing Secondary"** (blue). For Samantha specifically: also **"Acting RMP"** (amber, with a small tooltip showing the planned end date).
  - Territory line: territory name + region group (e.g., "Palm Beach, Martin & St. Lucie · South FL").
  - Co-coverage line: "Working with: Brian Roffe (HAE — primary outreach)" — so visiting Samantha's card shows you who else is in her territory and in what role. Visiting Brian's card shows Samantha as supervisor + acting RMP.
  - Quick stats: outreach events MTD, referrals MTD, follow-ups overdue.
  - Click → drill into that person's filter on the Marketing CRM activity log.

- **Standard Duties reference block** (collapsible, sticky on right side): the 10 standard marketing duties from Liam's brief, rendered as a static list. Visible from the directory at all times so reps can quickly self-check responsibilities.

- **Territories section** below the cards: one row per territory with its assignments listed (primary, supervisor, oversight, acting). This is the inverse view — "who covers what" by territory rather than "what does each person cover" by person.

Permissions: all 4 marketing-touching roles get read access. Admin tier (super_admin + admin) gets edit (territory + assignment management).

Effort: ~1.5 days for the page (card grid + filter strip + co-coverage line + territories section + standard duties block).

---

## Data model — final shape (v4)

Two tables, same as v3. Only the enum changes:

```sql
CREATE TABLE marketing_territories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  state                 text NOT NULL,
  region_group          text NOT NULL,
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
  -- 'acting' is back in v4.
  assignment_role text NOT NULL CHECK (assignment_role IN
                    ('primary','oversight','supervisor','acting','partner')),
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

`assignment_role` final enum: `primary`, `oversight`, `supervisor`, `acting`, `partner` (partner reserved for future use).

### Initial assignment seed (17 rows)

| # | Coordinator | Territory | role | notes |
|---|---|---|---|---|
| 1 | Lia | Duval & Clay | `primary` | covers legacy regions B and G |
| 2 | Lia | Flagler & St. Johns | `supervisor` | ADC oversight |
| 3 | Earl | Flagler & St. Johns | `primary` | |
| 4 | Kaylee | Lake, Sumter & Marion | `primary` | |
| 5 | Ariel | Lake, Sumter & Marion | `supervisor` | ADC oversight |
| 6 | Ariel | Manatee/Tampa/Pinellas/Polk | `primary` | her own territory; she's clinical-primary but the territory's primary outreach owner |
| 7 | Robby | Orange/Osceola/Seminole | `primary` | |
| 8 | Uma | Orange/Osceola/Seminole | `oversight` | clinical Regional Manager oversight |
| 9 | Ariel | Orange/Osceola/Seminole | `supervisor` | ADC oversight |
| 10 | Hollie | Brevard & Indian River | `primary` | |
| 11 | Samantha | Brevard & Indian River | `supervisor` | ADC oversight |
| 12 | Brian | Palm Beach/Martin/St. Lucie | `primary` | |
| 13 | Samantha | Palm Beach/Martin/St. Lucie | `acting` | covering RMP-level senior marketing role; `ended_at` set when a permanent South FL RMP is hired |
| 14 | Samantha | Palm Beach/Martin/St. Lucie | `supervisor` | ongoing ADC oversight |
| 15 | Walter | Georgia Territory | `primary` | is_active=false until 6/1 |
| 16 | (TBD per Q8) | Georgia Territory | `supervisor` | recommend Carla as interim |
| 17 | — reserved — | — | — | |

---

## Question status (v4)

| Q | Status | Notes |
|---|---|---|
| Q1 | **LOCKED** (v3) | Robby primary, Uma oversight |
| Q2 | **LOCKED + corrected** (v4) | Brian primary; Samantha = ADC supervisor + **acting RMP** (not RMM as v3 said) |
| Q3 | **REOPENED → answered** (v4 section 5) | "All supervised territories" still holds, but rollups now split primary-marketing vs. secondary-clinical contribution |
| Q4 | **LOCKED** (v3) | Region G merges into Duval & Clay under Lia |
| Q5 | **Still need final** | v3 said Hollie = South FL. Brief originally said Central FL. Confirming once more: South FL stays? |
| Q6 | **LOCKED** (v3) | Hervylie stays out of marketing |
| Q7 | **MOOT** (v4) | Uma and Ariel are both clinical-primary in Central FL — neither is the marketing lead. Marketing primaries are Kaylee, Ariel (her own), Robby. No seniority question between Uma and Ariel for marketing context. |
| Q8 | **Still open** | Walter's interim supervisor in Georgia (recommendation: Carla) |
| Q9 | **MOOT** (v4) | `regional_manager` code key stays live — Uma holds it. No tombstone decision needed. |
| **Q1.5** | **LOCKED** (v4) | HAE and RMP are distinct roles. HAE = entry-level marketing-primary, RMP = senior marketing-primary. |

**Only 2 questions still need answers:** Q5 (Hollie's region group final confirmation) and Q8 (Walter's interim supervisor).

---

## Effort re-estimate

v3 had ~7-8 working days. v4 adds:

| Scope add | Effort |
|---|---|
| Two new role columns on `page_permissions` + seed + branches in `useAuth.jsx` / `Sidebar.jsx` | ~0.25 day |
| Role-reassignment migration for Earl/Kaylee/Hollie | ~0.25 day |
| Re-introduce `acting` enum value + Samantha's third assignment row | ~0.1 day |
| Marketing scorecard split logic (primary vs. secondary contribution rollups across dashboards) | ~1 day |
| Marketing Team Directory page (card grid + filter strip + co-coverage line + territories section + standard duties block) | ~1.5 days |

**Revised total: ~10 working days of build, ~3 weeks clock time** alongside the rebrand work.

The two biggest adds are the scorecard split (item 4 above) and the new directory page (item 5). Both are user-facing wins that justify the day each.

---

## What I still need from you (final pass)

1. **Q5** — Hollie's region group: confirm one last time. I have her as South FL (matches legacy letter J grouping; contradicts the original brief table that said Central FL). Yes/flip.
2. **Q8** — Walter's interim supervisor in Georgia: Carla, Liam, or empty until a Georgia ADC is hired? Recommendation: **Carla.**

Plus two design-choice confirms that didn't make the formal question list but matter:

3. The `CLINICAL_PRIMARY_ROLES` / `MARKETING_PRIMARY_ROLES` constants in `constants.js` (Option A from your brief) — agree that's better than a `primary_role_category` column? My read: yes.
4. The Marketing Team Directory page layout (cards by person + territories section + standard duties block) — match what you had in mind, or do you want a different shape? Easier to change now than after it's built.

---

## Unchanged from v1/v2/v3

Carrying forward: the 2-table model, dual-email Option B for June 1 → Option A cutover mid-July, 8-dashboard-addition mapping (with split-rollup updates from section 5 above), data hygiene side-quests (Hervylie last name in `CLAUDE.md`, legacy region letter `I` cleanup, RLS sweep on 3 staging tables).

---

## Standby

Q5 and Q8 answers will lock the design. Sign off on the role taxonomy + Marketing Team Directory page shape and Phase 2 is ready to start. New estimate: ~10 working days, ~3 weeks clock time.
