# Marketing Team Directory — Phase 1 Design Proposal (v5)

**Author:** Claude, advisor to Liam O'Brien (Director of Operations)
**Date:** 2026-05-30
**Status:** Final taxonomy locked. Phase 2 ready pending **Q3, Q5, Q8** only.
**Supersedes:** `Marketing_Team_Directory_Design_v4.md`. v1–v4 preserved.

---

## Liam's clarification

> "Earl, Kaylee and Hollie should be same as Uma's breakdown — Clinical primary marketing secondary."

This locks the taxonomy. "Regional Marketing Partner" was a colloquial description, not a code role. All four (Earl, Kaylee, Hollie, Uma) are `regional_manager` — clinical-primary, contributing marketing as secondary in their assigned territories.

The result is genuinely simpler than v4: **the migration is now almost entirely additive.** No existing user records get their roles changed. Only Robby, Brian, and Walter get inserted with a single new role (`healthcare_account_executive`).

---

## Final role taxonomy

Three roles touch the marketing surface. Two are clinical-primary, one is marketing-primary.

| Code key | Display label | Primary category | Who holds it |
|---|---|---|---|
| `assoc_director` (existing) | Associate Clinical Director (ADC) | Clinical | Lia, Ariel, Samantha |
| `regional_manager` (existing) | Regional Manager (RM) | Clinical | Uma, Earl, Kaylee, Hollie |
| `healthcare_account_executive` (**NEW** — only addition) | Healthcare Account Executive (HAE) | Marketing | Robby, Brian, Walter |

The `marketing_rep` secondary role stays — granted to all 10 people so the existing RLS keeps working.

### Primary-category classification (no new column)

Same approach as v4 — derive from the role itself via a lookup in `constants.js`. v5 just has cleaner inputs:

```js
// Clinical-primary roles: marketing contributions count as "secondary"
// on dashboards; not held to the same volume metrics as marketing-primary.
export const CLINICAL_PRIMARY_ROLES = ['assoc_director', 'regional_manager'];

// Marketing-primary roles: full-volume marketing scorecard weight.
export const MARKETING_PRIMARY_ROLES = ['healthcare_account_executive'];

export function isMarketingPrimary(role) {
  return MARKETING_PRIMARY_ROLES.includes(role);
}

export function isClinicalPrimaryWithMarketingSecondary(role, secondary_roles) {
  return CLINICAL_PRIMARY_ROLES.includes(role)
      && Array.isArray(secondary_roles)
      && secondary_roles.includes('marketing_rep');
}
```

---

## What changed from v4

1. **No role reassignment.** Earl, Kaylee, Hollie, Uma all keep `regional_manager`. v4's `regional_marketing_partner` role is **not added**.
2. **HAE is the only NEW role.** Robby/Brian/Walter get it; that's the entire new-role surface area.
3. **`acting` enum value dropped.** v4 carried `acting` to model Samantha "acting RMP." Since RMP isn't a code role in v5, there's no role for her to be acting in. Her marketing-secondary contribution in her own territory is just `oversight` — same as Uma's pattern. If you want to flag the "she's pulling extra coverage in lieu of a dedicated marketing-primary hire" framing, that goes in the `notes` text column on the assignment row, not in a separate enum value.
4. **Cleaner `primary` vs. `oversight` rule** (see assignment seed below): a territory's `primary` is whoever owns the outreach metrics — could be marketing-primary (HAE) or clinical-primary (RM/ADC) depending on who's actually doing the work. Their job category (clinical vs. marketing) is captured in `coordinators.role` and is read separately when scorecards split rollups.

---

## Final person table (v5)

| # | Name | Code role | Primary category | Display title | Territory | Region Group |
|---|---|---|---|---|---|---|
| 1 | Lia Davis | `assoc_director` | Clinical | Associate Clinical Director (ADC) | Duval & Clay (legacy: B, G) | North FL |
| 2 | Earl Dimaano | `regional_manager` | Clinical | Regional Manager (RM) | Flagler & St. Johns | North FL |
| 3 | Kaylee Ramsey | `regional_manager` | Clinical | Regional Manager (RM) | Lake, Sumter & Marion | Central FL |
| 4 | Hollie Fincher | `regional_manager` | Clinical | Regional Manager (RM) | Brevard & Indian River | *pending Q5* |
| 5 | Ariel Maboudi | `assoc_director` | Clinical | ADC | Manatee/Tampa/Pinellas/Polk | Central FL |
| 6 | Samantha Faliks | `assoc_director` | Clinical | ADC (also covering senior marketing oversight in South FL) | Palm Beach/Martin/St. Lucie | South FL |
| 7 | Uma Jacobs | `regional_manager` | Clinical | RM | Orange/Osceola/Seminole | Central FL |
| 8 | Robby Robinson | `healthcare_account_executive` (NEW) | Marketing | Healthcare Account Executive (HAE) | Orange/Osceola/Seminole | Central FL |
| 9 | Brian Roffe | `healthcare_account_executive` (NEW) | Marketing | HAE | Palm Beach/Martin/St. Lucie | South FL |
| 10 | Walter Holston | `healthcare_account_executive` (NEW, is_active=false until 6/1) | Marketing | HAE | Georgia Territory | Georgia |

---

## Migration plan — additive only

This is meaningfully smaller than v4. Showing the SQL inline so you can review.

```sql
-- 1. Add the single new role to page_permissions.
ALTER TABLE page_permissions ADD COLUMN healthcare_account_executive boolean NOT NULL DEFAULT false;

-- 2. Grant HAE access to Marketing CRM (mirrors the existing regional_manager grant).
UPDATE page_permissions
   SET healthcare_account_executive = true
 WHERE page_key = 'marketing-crm';

-- 3. Insert NEW users: Robby and Brian. Walter waits until June 1.
INSERT INTO coordinators (full_name, email, role, secondary_roles, regions, is_active, job_title)
VALUES
  ('Robby Robinson', 'robby.robinson@axiomhealthmanagement.com',
     'healthcare_account_executive', ARRAY['marketing_rep'], ARRAY['A'], true,
     'Healthcare Account Executive'),
  ('Brian Roffe', 'brianr@axiomhealthmanagement.com',
     'healthcare_account_executive', ARRAY['marketing_rep'], ARRAY['T','V'], true,
     'Healthcare Account Executive');

-- 4. Add marketing_rep secondary to the 7 clinical-primary marketing contributors
--    so they show up in marketing-context UIs and pass the marketing-crm permission check
--    even if their primary role permission grants change later.
UPDATE coordinators
   SET secondary_roles = ARRAY(
     SELECT DISTINCT unnest(coalesce(secondary_roles, '{}'::text[]) || ARRAY['marketing_rep'])
   )
 WHERE id IN (
   'dae4e60a-dce0-4176-9624-db24c35893c5',  -- Lia
   'eb0f69cb-6c0d-4bb4-bf24-ade9c8707e9e',  -- Ariel
   '77c8de92-f40b-43c7-88f8-1b77c7fae4bc',  -- Samantha
   'e0f22bf3-cb28-4662-bb6e-4fe47ae3c329',  -- Uma
   '9ce2bbc6-c4eb-49de-8634-62f1f82b44bb',  -- Earl
   '0a355f0f-4321-45ff-b6e4-94938cdd0214',  -- Kaylee
   '9f49714c-6ab1-4049-8bb5-9600595fe3a7'   -- Hollie
 );

-- 5. useAuth.jsx + Sidebar.jsx: add one branch each for healthcare_account_executive
--    in pageAllowsRole(). No other role-keys touched.

-- 6. RLS function update — add 'healthcare_account_executive' to the allowed roles:
CREATE OR REPLACE FUNCTION public.can_access_marketing_region(p_region text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.coordinators
    WHERE user_id = (SELECT auth.uid())
      AND is_active = true
      AND (
        role IN ('super_admin','admin','director','ceo')
        OR 'marketing_manager' = ANY(coalesce(secondary_roles, '{}'::text[]))
        OR (
          (
            role IN ('assoc_director','regional_manager','marketing_rep','healthcare_account_executive')
            OR 'marketing_rep' = ANY(coalesce(secondary_roles, '{}'::text[]))
          )
          AND (p_region IS NULL OR p_region = ANY(regions))
        )
      )
  );
$function$;

-- 7. Supabase Auth user provisioning — out-of-band:
--    supabase.auth.admin.createUser({ email: 'robby.robinson@axiomhealthmanagement.com', ... })
--    supabase.auth.admin.createUser({ email: 'brianr@axiomhealthmanagement.com', ... })
--    Link to coordinators.user_id afterward.
```

**Verification after migration:**

```sql
-- Should return 4 rows: Uma, Earl, Kaylee, Hollie.
SELECT full_name FROM coordinators WHERE role='regional_manager' AND is_active=true;

-- Should return 3 rows: Lia, Ariel, Samantha.
SELECT full_name FROM coordinators WHERE role='assoc_director' AND is_active=true;

-- Should return 2 rows initially (Robby, Brian), 3 after Walter is provisioned.
SELECT full_name FROM coordinators WHERE role='healthcare_account_executive' AND is_active=true;
```

---

## Data model — territory + assignment tables (v5 final)

```sql
CREATE TABLE marketing_territories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  state                 text NOT NULL,           -- 'FL' | 'GA'
  region_group          text NOT NULL,           -- 'North FL' | 'Central FL' | 'South FL' | 'Georgia'
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
  -- v5 enum: 'acting' dropped (no separate role to act for).
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

### `assignment_role` semantics (v5)

| Value | Meaning |
|---|---|
| `primary` | The day-to-day outreach owner for this territory. Owns scorecard metrics. Could be marketing-primary (HAE) or clinical-primary (RM/ADC) — the role distinction lives on `coordinators.role`. |
| `oversight` | A clinical-primary person providing marketing-secondary involvement in their own territory, where an HAE holds the `primary` row. Uma's pattern. |
| `supervisor` | ADC clinical oversight across a territory. Long-running. Lia → all North FL, Ariel → all Central FL, Samantha → all South FL. |
| `partner` | Reserved. Not used in initial seed. |

### Initial assignment seed (16 rows)

| # | Coordinator | Territory | role | notes |
|---|---|---|---|---|
| 1 | Lia | Duval & Clay | `primary` | clinical-primary outreach owner; territory absorbs legacy region G |
| 2 | Lia | Flagler & St. Johns | `supervisor` | ADC clinical oversight |
| 3 | Earl | Flagler & St. Johns | `primary` | clinical-primary outreach owner |
| 4 | Kaylee | Lake, Sumter & Marion | `primary` | clinical-primary outreach owner |
| 5 | Ariel | Lake, Sumter & Marion | `supervisor` | ADC clinical oversight |
| 6 | Ariel | Manatee/Tampa/Pinellas/Polk | `primary` | clinical-primary outreach owner |
| 7 | Robby | Orange/Osceola/Seminole | `primary` | HAE (marketing-primary) outreach owner |
| 8 | Uma | Orange/Osceola/Seminole | `oversight` | clinical-primary RM, marketing-secondary in own territory |
| 9 | Ariel | Orange/Osceola/Seminole | `supervisor` | ADC clinical oversight |
| 10 | Hollie | Brevard & Indian River | `primary` | clinical-primary outreach owner |
| 11 | Samantha or Ariel | Brevard & Indian River | `supervisor` | depends on Q5 (if Hollie = South FL → Samantha; if Central FL → Ariel) |
| 12 | Brian | Palm Beach/Martin/St. Lucie | `primary` | HAE outreach owner |
| 13 | Samantha | Palm Beach/Martin/St. Lucie | `oversight` | clinical-primary ADC, marketing-secondary in own territory; `notes` = "Covering senior marketing oversight in lieu of a dedicated South FL marketing-primary hire" |
| 14 | Samantha | Palm Beach/Martin/St. Lucie | `supervisor` | ADC clinical oversight (ongoing) |
| 15 | Walter | Georgia Territory | `primary` | HAE; is_active=false on user record until 6/1 |
| 16 | (TBD per Q8) | Georgia Territory | `supervisor` | recommend Carla as interim |

Samantha now has 2 rows in PB/M/SL (`oversight` + `supervisor`), not 3 — `acting` is folded into `oversight` with a notes string. Cleaner.

---

## Marketing scorecard rules (v5)

The split-rollup logic from v4 stands. Restating with v5's cleaner role inputs:

1. **Marketing-primary contribution** = sum of outreach/referrals attributed to anyone where `isMarketingPrimary(role)` is true (HAEs).
2. **Clinical-secondary contribution** = sum from anyone where `isClinicalPrimaryWithMarketingSecondary(role, secondary_roles)` is true (RMs and ADCs).
3. **Territory rollup** displays both bands distinctly. Example:

   ```
   Orange, Osceola & Seminole — September MTD
     Marketing-primary:
       Robby Robinson (HAE):  18 referrals, 24 outreach events
     Clinical-secondary:
       Uma Jacobs (RM):        3 referrals,  4 outreach events
       Ariel Maboudi (ADC):    1 referral,   2 outreach events  (supervisor)
     Total:                   22 referrals, 30 outreach events
   ```

4. **ADC region-group scorecard** (per Q3 lock in v3): sums all supervised territories, with the same primary/secondary split.

5. **Director / Carla view** has a toggle: "By territory" (default) or "By primary type" (separates HAE primary output from clinical-secondary contribution across the whole company). The second view is the honest "who's doing the volume" picture.

This makes accountability legible: an RM's 3-referral month isn't a red flag (it's secondary to their clinical work); an HAE's 3-referral month is a real signal.

---

## Marketing Team Directory page

Spec is unchanged from v4 section "Marketing Team Directory page — new spec." Cards show:

- Title + name
- Badge: "Marketing Primary" (HAEs) OR "Clinical Primary + Marketing Secondary" (RMs and ADCs). For Samantha: an additional "Covering senior marketing oversight (South FL)" amber tag based on her `oversight` row's notes field.
- Territory + region group
- Co-coverage line listing other people active in the same territory and their assignment roles
- Quick stats: outreach events MTD, referrals MTD, follow-ups overdue
- Click-through to Marketing CRM activity log filtered to that person

Plus a collapsible "Standard Duties" reference block on the right, and a "Territories" section below the cards (one row per territory with all assignments listed).

---

## Question status (v5)

| Q | Status | Notes |
|---|---|---|
| Q1 | LOCKED | Robby = primary, Uma = oversight in Orange/Osceola/Seminole |
| Q2 | LOCKED | Brian = primary, Samantha = oversight + supervisor in PB/M/SL |
| **Q3** | **Open** | ADC scorecard semantics. v3 said "all supervised territories." Section 5 above proposes splitting marketing-primary vs. clinical-secondary contribution. **Confirm this split-display is what you want, or do you prefer a single combined number?** |
| Q4 | LOCKED | Region G merges into Duval & Clay |
| **Q5** | **Open — needs final** | Hollie's region group: South FL (matches legacy letter J grouping) or Central FL (matches original brief table)? Re-asking because you flagged it again. **My read: South FL. Confirm.** |
| Q6 | LOCKED | Hervylie out of marketing |
| Q7 | MOOT | Uma and Ariel are both clinical-primary; neither is the marketing lead for Central FL |
| **Q8** | **Open** | Walter's interim supervisor in Georgia. **Recommendation: Carla.** Alternative: Liam direct or empty. |
| Q9 | MOOT | `regional_manager` code key stays live (4 users hold it) |
| Q1.5 | LOCKED | HAE distinct from RMP. RMP is colloquial-only, not a code role. Only HAE gets added. |

**Three questions left:** Q3 (scorecard display preference), Q5 (Hollie region group final), Q8 (Walter interim supervisor).

---

## Effort re-estimate

v4 was ~10 working days. v5 saves work in two places:

| Scope change vs. v4 | Effort delta |
|---|---|
| No role reassignment for Earl/Kaylee/Hollie | −0.25 day |
| No `regional_marketing_partner` column added to `page_permissions` | −0.1 day |
| Drop `acting` enum value | −0.1 day (less UI conditional logic) |
| Samantha's assignment row count drops from 3 to 2 | −0.05 day |

**Revised total: ~9 working days of build, ~3 weeks clock time** alongside the rebrand work.

---

## What I still need from you

Three questions left:

1. **Q3** — Marketing scorecard for ADCs: split display (marketing-primary vs. clinical-secondary contribution) per section 5 above, or single combined number?
2. **Q5** — Hollie's region group, final: South FL or Central FL?
3. **Q8** — Walter's interim supervisor in Georgia: Carla, Liam direct, or empty?

Plus two confirmations:

4. The `CLINICAL_PRIMARY_ROLES` / `MARKETING_PRIMARY_ROLES` constants approach (Option A in your prior brief). Yes / change.
5. The Marketing Team Directory page layout (card grid + filter strip + co-coverage + territories section + standard duties block). Yes / different shape.

---

## Unchanged from v1/v2/v3/v4

- The 2-table data model (flat territories + assignments — not the 4-table version)
- Dual-email Option B for June 1 → planned Option A cutover mid-July
- The 8-dashboard-addition mapping (with split-rollup scorecard updates from section 5)
- Data hygiene side-quests:
  - `CLAUDE.md` says "Hervylie Manaay"; DB says "Hervylie Senica." Update the doc.
  - 5 admins have legacy letter `I` in their `regions` array — no region I exists. Drop it.
  - 3 staging tables have RLS disabled (`intake_import_staging_2026_05_20`, `auth_sync_pending`, `_auth_backfill_snapshot_2026_05_20`). Schedule an RLS sweep separately.

---

## Standby

This taxonomy should hold. Phase 2 build can start once Q3, Q5, and Q8 are answered and you sign off on the additive-migration approach. Estimate: ~9 working days, ~3 weeks clock time.
