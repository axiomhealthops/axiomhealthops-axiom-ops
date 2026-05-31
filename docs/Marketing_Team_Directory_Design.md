# Marketing Team Directory — Phase 1 Design Proposal

**Author:** Claude (acting as senior business advisor) for Liam O'Brien, Director of Operations
**Date:** 2026-05-30
**Status:** Phase 1 audit + design — awaiting your sign-off before any code is written
**Scope:** 10-person marketing team directory, role/territory/auth model, and 8 dashboard additions for the Marketing CRM

---

## TL;DR — what I'm recommending and what I'd push back on

1. **Don't build a 4-table territory hierarchy.** With ~10 people and ~9 territories, the normalized State → Region → Territory → County model is over-engineering. I recommend a flat `marketing_territories` table with `state` and `region_group` as columns plus a `counties text[]` column. Two tables (territory + assignment), not four. We get the same filters and far less migration risk. If you ever scale to 100+ territories, you can normalize then — splitting is cheaper than building speculatively.
2. **Add `healthcare_account_executive` as a new primary role.** It's first-class enough to deserve its own row and label. Do **not** rename `assoc_director` to `assoc_clinical_director` — the user-facing label is already correct ("Assoc. Director of Clinical Ops"). Renaming the code key is a 12+ file blast radius for zero functional gain.
3. **Endorse Option B for dual email**, with a concrete Phase 2 cutover plan to Option A in mid-July (after 6 weeks of dual-write stability). I'd push back on Option C — building a custom pre-auth Edge Function for multi-email login is expensive maintenance for the next person who has to debug a login failure at 2am.
4. **HAE = primary, RMP/ADC = supervisory on overlapping territories.** Don't go co-equal. One owner per outreach metric or every dashboard double-counts. Robby owns Orange/Osceola/Seminole metrics, Uma shows as partner. Brian owns Palm Beach/Martin/St. Lucie, Samantha shows as partner/ADC overlay.
5. **Don't onboard Walter Holston yet.** No email = no Supabase Auth user. Create a "pending hire" row in the directory (display-only, no login) and provision him in one shot when his @edemacare.com email lands June 1. Creating a placeholder account with a TBD email is the kind of thing that bites in 4 months when nobody remembers why a user can't sign in.
6. **Flag: your existing single-letter region system is dead weight.** This proposal is a good moment to formally deprecate it for the marketing surface (it's already drifted — Hollie is on letter J which `constants.js` groups under FL South, but the new spec puts her in FL Central). Operations/Auth/Care Coord still need the letters; Marketing should move to named territories cleanly.

Also a small data hygiene note: `CLAUDE.md` calls your pod leader "Hervylie Manaay." Database says "Hervylie Senica." Not blocking, but worth fixing the doc.

---

## 1. Current state vs. new spec — diff per person

Source: `coordinators` table, queried 2026-05-30. All current emails are `@axiomhealthmanagement.com`.

| # | Name | Today's Role | Today's Regions | New Role | New Territory | New Region | Δ |
|---|---|---|---|---|---|---|---|
| 1 | Lia Davis | `assoc_director` | B, C, G | ADC | Duval & Clay | North FL | role unchanged; territory definition changes (from letters B/C/G to a named county list); she remains ADC over the whole North FL region |
| 2 | Earl Dimaano | `regional_manager` | C | RMP | Flagler & St. Johns | North FL | role label changes (RM → RMP — same code key); territory changes from "C" to named counties |
| 3 | Kaylee Ramsey | `regional_manager` | H | RMP | Lake, Sumter & Marion | Central FL | role label changes; territory letter H → named counties |
| 4 | Hollie Fincher | `regional_manager` | J | RMP | Brevard & Indian River | Central FL | **region group changes**: letter J is currently grouped under FL South in `constants.js` but new spec puts her in Central FL — confirms the letter system is stale |
| 5 | Ariel Maboudi | `assoc_director` | A, H, M, N | ADC | Manatee, Tampa, Pinellas & Polk (Lakeland) | Central FL | drop region A (now Uma/Robby territory); territory definition changes |
| 6 | Samantha Faliks | `assoc_director` | J, T, V | ADC | Palm Beach, Martin & St. Lucie | South FL | drop region J (now Hollie under Central FL); territory definition changes; she also gains a co-coverage relationship with Brian (HAE) |
| 7 | Uma Jacobs | `regional_manager` | A | RMP | Orange, Osceola & Seminole | Central FL | role label changes; co-coverage with Robby (HAE) — Robby = primary |
| 8 | Robby Robinson | **NEW** | — | HAE | Orange, Osceola & Seminole | Central FL | net-new user; needs @axiomhealthmanagement.com mailbox + @edemacare.com mailbox + Auth account |
| 9 | Brian Roffe | **NEW** | — | HAE | Palm Beach, Martin & St. Lucie | South FL | net-new user; same provisioning as Robby |
| 10 | Walter Holston | **NEW** | — | HAE | Georgia Territory | Georgia | net-new; **no email yet** — provision as pending-hire only until June 1 |

Confirmed via DB query: none of Robby, Brian, or Walter exist in `coordinators` in any form (active or inactive). Safe to create from scratch.

A few specific cleanups your spec implies:

- Ariel's `regions` array currently includes `A`. New spec removes A (now Uma + Robby). Update Ariel's array.
- Samantha's `regions` array currently includes `J`. New spec removes J (now Hollie). Update Samantha's array.
- The Sidebar role label map (`Sidebar.jsx` line 105) shows "Regional Manager" for `regional_manager`. Your spec says these people are "Regional Marketing Partner (RMP)." Either rename the displayed label (low risk, single-file) or — better — give RMPs a `marketing_rep` secondary role and add a `marketing_partner` primary role distinct from operations `regional_manager`. **My recommendation:** simpler — just relabel the displayed string for marketing context. The current `regional_manager` code key is also used for operations roles in the codebase; don't split it.

---

## 2. Current territory model — what exists and what's missing

**Code-level (`src/lib/constants.js`):**

- `REGIONS` map — single-letter keys A, B, C, G, H, J, M, N, T, V → display name of person responsible. Display convenience, not source of truth.
- `FL_PARENT_REGIONS` — hardcoded `{ 'FL North': [B,C,G], 'FL Central': [A,H,M,N], 'FL South': [J,T,V] }`.
- `ASSOC_DIRECTORS` — hardcoded `{ 'FL North': 'Lia Davis', 'FL Central': 'Ariel Maboudi', 'FL South': 'Samantha Faliks' }`.
- `REGION_TO_PARENT`, `REGION_TO_AD` — derived lookups.
- `EXPANSION` — mentions Georgia as "In Progress, target May 2026" — but no operational structure yet.

**Database-level:**

- `coordinators.regions text[]` — single-letter array.
- `marketing_contacts.region text` — single letter, used by RLS function `can_access_marketing_region(p_region text)`.
- `marketing_encounters.region text` — same.
- `marketing_contact_people.region text` — same.

**Nothing exists today for:**

- State (FL vs GA) as structured data — only mentioned in the `EXPANSION` array.
- Named human-readable territories ("Duval & Clay") — only single letters.
- County granularity — never tracked.
- Many-to-one rep → territory assignment with primary/secondary roles.

The letter system also has bit-rot: Hollie's letter is J, grouped under FL South. New spec puts her under Central FL. Either J was wrong before, or the grouping has drifted, or the new geographic cut is different. This is the practical case for moving Marketing off letters.

---

## 3. Proposed data model — **simpler than what was sketched in the brief**

### What you proposed (4 tables)

```
marketing_states (id, code, name)
marketing_regions (id, state_id FK, name, sort_order)
marketing_territories (id, region_id FK, name, counties text[], is_active)
marketing_team_assignments (id, user_id FK, territory_id FK, primary, started_at, ended_at)
```

### What I'd push back to (2 tables)

```sql
-- Flat territory dimension. State + region_group are columns, not FK relations.
CREATE TABLE marketing_territories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,          -- "Duval & Clay", "Georgia Territory"
  state              text NOT NULL,          -- "FL", "GA"
  region_group       text NOT NULL,          -- "North FL", "Central FL", "South FL", "Georgia"
  counties           text[] NOT NULL DEFAULT '{}',
  legacy_region_letters text[] NOT NULL DEFAULT '{}',  -- backfill helper: ["B","C"] etc.
  is_active          boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Assignment table — supports HAE/RMP/ADC co-coverage and primary ownership.
CREATE TABLE marketing_team_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordinator_id  uuid NOT NULL REFERENCES coordinators(id) ON DELETE CASCADE,
  territory_id    uuid NOT NULL REFERENCES marketing_territories(id) ON DELETE CASCADE,
  assignment_role text NOT NULL,             -- 'primary' | 'partner' | 'supervisor'
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

**Why flatter is better here:**

- 10 people, 9 territories, 2 states. A FK chain three levels deep buys you nothing at this scale.
- State and region_group are stable enough that a `CHECK` constraint or lookup function gives you the same data quality as a foreign key, without the JOIN overhead and migration choreography.
- You keep the option open: if you hit 100 territories or start managing region-group ACLs, you can normalize state and region_group into their own tables in a single migration with a backfill `INSERT ... SELECT DISTINCT`.
- Two tables is one Supabase apply + one backfill, not four.

**`assignment_role` enum** — three values cover every case Liam described:

- `primary` — owns the metrics. The single person whose dashboard scorecard reflects this territory's results. On overlapping territories (Orange/Osceola/Seminole, Palm Beach/Martin/St. Lucie), the HAE is primary.
- `partner` — actively works the territory alongside primary. Shows up in filter dropdowns, included in activity log views, but does NOT own the referral count for ADC scorecards. RMPs in overlapping territories.
- `supervisor` — ADC oversight. Reports roll up here; doesn't carry quota; appears in the territory card's "supervised by" line.

This gives you accurate per-rep metrics without double-counting and lets the ADC dashboard roll up everything in their region_group cleanly.

### Initial territory seed

```
North FL (FL)
  Duval & Clay                  — primary: Lia Davis (ADC) [legacy letters: B]
  Flagler & St. Johns           — primary: Earl Dimaano (RMP) [legacy letters: C]
  (Region G stays as-is until you clarify which territory absorbs it — see Q4 below)

Central FL (FL)
  Lake, Sumter & Marion         — primary: Kaylee Ramsey (RMP) [legacy letters: H]
  Brevard & Indian River        — primary: Hollie Fincher (RMP) [legacy letters: J — note: was grouped under FL South]
  Manatee, Tampa, Pinellas & Polk (Lakeland) — primary: Ariel Maboudi (ADC) [legacy letters: M, N]
  Orange, Osceola & Seminole    — primary: Robby Robinson (HAE), partner: Uma Jacobs (RMP) [legacy letters: A]

South FL (FL)
  Palm Beach, Martin & St. Lucie — primary: Brian Roffe (HAE), partner/supervisor: Samantha Faliks (ADC) [legacy letters: T, V]

Georgia (GA)
  Georgia Territory             — primary: Walter Holston (HAE — pending hire, no login until 6/1)
```

ADC supervision is captured separately: Lia → all North FL territories (supervisor role), Ariel → all Central FL, Samantha → all South FL. That single rule lets the AD dashboard roll up cleanly without hardcoding region letters anywhere.

### Migration path — `coordinators.regions` becomes deprecated mirror

1. Apply migration creating both new tables.
2. Seed territories and `legacy_region_letters` arrays from the table above.
3. Insert `marketing_team_assignments` rows for the 7 existing people based on current coverage + the new spec.
4. Leave `coordinators.regions` populated as-is for now — Operations / Auth / Care Coord still depend on it. Marketing reads ignore it going forward.
5. Update `can_access_marketing_region(p_region text)` → new function `can_access_marketing_territory(p_territory_id uuid)`. Old function stays in place during the cutover; new function is what `marketing_contacts.territory_id` RLS uses.
6. Add `territory_id uuid REFERENCES marketing_territories(id)` to `marketing_contacts`, `marketing_encounters`, `marketing_contact_people`. Backfill from existing `region` letter via `legacy_region_letters` lookup.
7. Run dashboards in parallel for ~2 weeks (old letter-based queries + new territory-based queries) to validate before deleting the old paths.

**Risk callouts:**

- Backfill ambiguity for letters that span multiple territories. The clearest case: letters M and N both map to "Manatee, Tampa, Pinellas & Polk." Tractable. The murkiest: legacy region G — your reorg notes have it under FL North (Lia acting) but the new spec doesn't name a Duval/Clay/Flagler/St. Johns successor for it. **Question for you below.**
- Old `marketing_contacts` rows have `region` as a single letter. A pre-cutover audit query should show how many rows fall into each new territory, with anything ambiguous (e.g. region G) flagged for manual mapping.

---

## 4. Role enum changes

**Current** (`useAuth.jsx` line 100-118 + `Sidebar.jsx` line 67-83):

```
super_admin, ceo, admin, assoc_director, regional_manager, pod_leader,
team_member, auth_coordinator, intake_coordinator, care_coordinator,
clinician, telehealth, marketing_rep (secondary only)
```

**Changes needed:**

1. **Add primary role:** `healthcare_account_executive` (HAE). New column on `page_permissions`. New branch in `pageAllowsRole()` in both `useAuth.jsx` and `Sidebar.jsx`. Add label "Healthcare Account Executive" to the role label map.
2. **Page permissions for HAE:** mirror RMP grants initially — Marketing CRM, plus any reports the HAEs need. (Specifically: HAEs should NOT see Auth Tracker or Care Coord workflows. Same restriction RMPs already have.) `page_permissions` rows for HAE-specific pages get `healthcare_account_executive=true`.
3. **`marketing_rep` secondary role stays as-is.** HAEs, RMPs (`regional_manager`), and ADCs (`assoc_director`) all get `marketing_rep` as a secondary role too, so the existing `marketing_rep` permission grants on Marketing CRM keep working without rewriting them. Don't deprecate the secondary; you've already built the dual-role plumbing on 2026-05-29 and it works.
4. **DO NOT rename `assoc_director`.** The displayed label in `Sidebar.jsx` line 106 is already "Assoc. Director of Clinical Ops" — the full title Liam's spec wants. The code key is just a key. Renaming it forces edits to:
   - `page_permissions.assoc_director` column (DDL rename, blast-radius migration)
   - `useAuth.jsx` and `Sidebar.jsx` (2 places each)
   - `coordinators.role` value updates for 3 users
   - Every RLS policy that hardcodes `'assoc_director'` (search hits in `can_access_marketing_region`, others)
   - `constants.js` `DIRECTOR_ROLES` array
   - The Associate Director dashboard and AD-acting-region logic in `constants.js`

   Zero functional benefit. Skip it.

5. **Don't rename `regional_manager` either**, even though new spec calls these people "Regional Marketing Partners." Same logic. Just relabel the displayed string for marketing-context pages or add a secondary `marketing_partner` role if you want a clean "this person is on the marketing team and is an RMP specifically" distinction.

---

## 5. Dual-email recommendation

**Constraint:** Supabase Auth uses `auth.users.email` as the unique login identifier. No native multi-email login. Changing the email on an existing Auth user is a one-step UPDATE that triggers an email confirmation by default (configurable).

**Option B — recommended for June 1:**

```sql
ALTER TABLE coordinators
  ADD COLUMN primary_email  text,    -- @edemacare.com — display + future canonical
  ADD COLUMN legacy_email   text;    -- @axiomhealthmanagement.com — keeps Auth working
-- Then backfill: legacy_email = email, primary_email = NULL until provisioned.
-- After June 1, primary_email is set for everyone with a new mailbox.
```

`email` (the existing column tied to Auth) stays untouched for now. UI changes:

- User Management page: display `primary_email` prominently with `legacy_email` underneath in muted text.
- Staff Directory and Sidebar footer: show whichever of `primary_email`/`legacy_email` is non-null, with preference for primary.
- Login page header copy: explicitly tell users "log in with your @axiomhealthmanagement.com email — your new @edemacare.com inbox forwards here for now."

**Phase 2 cutover (Option A) — mid-to-late July:**

1. After 4-6 weeks of dual-email stability (every employee confirms their @edemacare.com mailbox works), schedule a Saturday morning window.
2. Loop through `coordinators`, call `supabase.auth.admin.updateUserById(user_id, { email: primary_email })` for each.
3. Update `coordinators.email = primary_email` to match.
4. Force-reset all sessions (`auth.admin.signOut`) — users log back in with new email.
5. Keep `legacy_email` indefinitely as historical record + forwarding safety net.

**Why I'm pushing back on Option C:**

A custom pre-auth Edge Function that resolves email aliases sounds elegant but it's a maintenance liability. The next time Supabase ships an Auth update and your hook breaks, every employee fails to log in until someone debugs an Edge Function. Auth is the worst place to put bespoke logic. The 6-week window with dual visibility (Option B → A) does the same job with vanilla Supabase Auth.

**Risk on Option B:** users get confused which email is "their" email when they need to give it to vendors. Mitigation: pick one. Pin the display to `primary_email` (the @edemacare.com one) everywhere user-facing, treat `legacy_email` as internal-only metadata.

---

## 6. Territory overlap — clarifying questions

**These are non-negotiable to lock down before build:**

**Q1: Orange/Osceola/Seminole (Robby HAE + Uma RMP).** Recommended default: Robby = primary, Uma = partner. Confirm or correct?

**Q2: Palm Beach/Martin/St. Lucie (Brian HAE + Samantha ADC).** Recommended default: Brian = primary, Samantha = supervisor (since she's also their ADC). Confirm or correct?

**Q3: ADCs and quota.** When the dashboard says "Lia's referrals MTD," does that mean (a) only what Lia personally generated, or (b) everything generated in any North FL territory she supervises? My recommendation: (b) is the right number for AD scorecards, (a) is the right number for individual coaching. Show both, label them clearly.

**Q4: Legacy region G.** Your reorg has Lia covering region G as acting AD. The new territory list doesn't name a successor for region G. Two interpretations:

- G's geography is absorbed into Duval & Clay (Lia's territory). One territory now covers both old letters B and G.
- G is going dormant / no longer marketed.

Tell me which. If G is staying alive, what counties does it map to?

**Q5: Hollie's region group.** Old `constants.js` puts letter J under FL South. New spec puts Hollie under Central FL. Confirming: Brevard and Indian River are now Central FL for marketing purposes, even if operations still treats J as part of FL South. (This is a marketing-only re-classification, not an operations re-org.) Correct?

**Q6: Hervylie's role.** Sidebar/Operations bookkeeping. He's `pod_leader` (covers Region A care coord). He is NOT in the 10-person marketing directory. Confirm we leave him out of marketing entirely.

---

## 7. The 8 dashboard additions — what exists, what extends, what's new

The existing Marketing CRM (`src/pages/dashboard/MarketingCRMPage.jsx`, 1,266 lines) already has more than the brief implies. Detailed mapping:

| # | New ask | Status | What it takes |
|---|---|---|---|
| 1 | Territory assignments by county | **Net new** | New territory model (section 3) + new "Territories" tab on Marketing CRM showing each territory with its primary/partner/supervisor and county list. Add a "Territories Admin" page (admin-only) for managing rows. |
| 2 | State + region filters | **Extend existing** | Filter bar already has `Region` (single letter). Replace with `State`, `Region Group`, `Territory` cascading dropdowns. Keep `Rep`, `Provider Type`, etc. unchanged. |
| 3 | Active provider accounts by territory | **Extend** | The Providers tab already groups by `region`. Reslice by territory. Reports tab already has provider depth — group those rollups by territory_id instead of region. |
| 4 | Referral activity by rep | **Already exists** | KPI strip + filterable activity log + Reports tab already track referrals (`referrals_received` on encounters, `filterRep`). New: add a per-rep scorecard view (table with each rep's MTD/YTD referrals + success rate). |
| 5 | In-service + luncheon activity | **Already exists** | KPI "In-Service + L&L MTD" exists. Outreach types `in_service` and `lunch_and_learn` already filterable. New: add a per-territory rollup of these specifically. |
| 6 | Career fair + recruiting activity | **Partial** | `job_fair` outreach type exists. No dedicated view. Build: a "Recruiting" tab grouping `job_fair`, school-targeted encounters (`target_clinic_or_school`), and outreach to therapy program directors. |
| 7 | Marketing goals + progress toward accepted referral targets | **Net new** | Empty `rm_kpi_goals` table exists but unused. Build: a goals table keyed on territory + period (month/quarter), plus a "Goals & Progress" tab showing pacing vs. target. Recommended: per-territory monthly referral goal + per-rep weekly outreach goal. |
| 8 | Provider feedback + follow-up opportunities | **Extend** | `follow_up_date`, `follow_up_completed`, `follow_up_needed` outcome rating already exist. Provider notes exist. New: a "Feedback Summary" panel per provider aggregating outreach notes tagged as feedback (add a `feedback_excerpt text` column to encounters, or add a `feedback boolean` flag). |

**Summary effort:**

- Item 1: ~1 day (data model + tab UI)
- Item 2: ~0.5 day (refactor filter bar + cascading state)
- Item 3: ~0.5 day (rewire groupings)
- Item 4: ~0.5 day (new view, all data exists)
- Item 5: ~0.25 day (new KPI tile + rollup)
- Item 6: ~0.75 day (new tab; sparse data so it's mostly UI)
- Item 7: ~1.5 days (goals data model + entry UI + progress component)
- Item 8: ~0.5 day (encounter column + summary panel)

Plus the foundational territory model + assignments + RLS rewrite from section 3: ~1.5 days. Plus the dual-email columns + user management UI updates: ~0.5 day. Plus the 3 new users (Robby, Brian, Walter-pending): ~0.5 day for provisioning UI.

**Total Phase 2 estimate: ~7-8 working days** if no scope creep. Plan for 2.5 weeks of clock time to allow for review cycles and the Operations rebrand work running concurrently.

---

## 8. Proposed Phase 2 build sequence

Order matters here — each step unlocks the next without leaving the system half-migrated.

**Day 1 — Foundation (no UI changes):**

1. Apply migration: `marketing_territories` + `marketing_team_assignments` + `can_access_marketing_territory()` function + `territory_id` columns on the three marketing tables.
2. Apply migration: add `primary_email`, `legacy_email` columns to `coordinators`. Backfill `legacy_email = email`.
3. Apply migration: add `healthcare_account_executive` column to `page_permissions`. Backfill `false` for existing rows; will set `true` selectively when HAE-relevant pages are tagged.
4. Seed territories from section 3.

**Day 2 — Assignments + role wiring:**

1. Insert assignments for 7 existing people based on the new spec.
2. Create the 3 new `coordinators` rows: Robby Robinson (HAE), Brian Roffe (HAE). Walter Holston goes in with `is_active=false` and a "pending hire" flag in `team` column or `job_title`.
3. Create Supabase Auth users for Robby and Brian (legacy email = `@axiomhealthmanagement.com`, primary = `@edemacare.com`).
4. Update `useAuth.jsx` and `Sidebar.jsx` to recognize `healthcare_account_executive` role.
5. Backfill `marketing_contacts.territory_id` from `legacy_region_letters`. Manually map ambiguous rows.

**Day 3 — Dual email visibility:**

1. User Management page: show both emails, edit either.
2. Staff Directory: prefer `primary_email` in display.
3. Login page copy: explainer banner.

**Day 4-6 — Dashboard additions:**

Build items 2, 3, 1 in that order (filters first because everything else depends on territory filter behavior, then existing-data slices, then the new Territories tab).

**Day 7 — Goals + feedback:**

Build items 7 and 8 together — both need new schema, can share the migration.

**Day 8 — Recruiting + polish:**

Item 6, item 4 scorecards, walk through every page with you.

**Day 9-10 — Buffer / cleanup / Phase 2 prep for the email cutover.**

The email cutover (Option B → A) is a separate Phase 3 in mid-July, not in this sequence.

---

## 9. What I'd want to confirm before code

1. Q1-Q6 answered (section 6).
2. Confirm `assignment_role` enum values (`primary` / `partner` / `supervisor`) are what you'd call them. If you prefer different language ("lead" / "support" / "oversight"), say so now — easier than renaming after the dashboard ships.
3. Confirm you want to keep `marketing_rep` as a secondary role on all three (HAE + RMP + ADC). Alternative: drop it entirely and let primary role + `marketing_team_assignments` membership grant Marketing CRM access. Cleaner long-term but it's a bigger refactor of the RLS function.
4. Confirm Walter's "pending hire" treatment — display in the directory but no Auth account until June 1. Or do you want him fully provisioned with a placeholder email immediately?
5. Confirm dashboard goal definition for item 7. My default: monthly accepted-referral target per territory + weekly outreach-count target per rep. If you have different metrics in mind, list them.

---

## 10. Data hygiene side-quests (low priority but worth fixing)

- `CLAUDE.md` lists pod leader as "Hervylie Manaay." DB says "Hervylie Senica." Update the doc.
- `coordinators.regions` for the 5 admins (Carla, Ashley, Dustin, Randi, Yvonne) includes letter `I`. There is no region I in the new spec. Either it's a no-op legacy entry or it should be removed.
- 3 staging tables in your DB have RLS disabled (`intake_import_staging_2026_05_20`, `auth_sync_pending`, `_auth_backfill_snapshot_2026_05_20`). Not blocking but flagging — these are fully exposed to the anon key. Worth scheduling an RLS sweep separately.

---

## Standby

Phase 2 is on hold pending your sign-off on:

1. The flatter 2-table territory model (vs. the 4-table version in the brief).
2. The `healthcare_account_executive` role plan + leaving `assoc_director` / `regional_manager` keys unchanged.
3. Option B for dual email with a planned Phase 3 cutover.
4. HAE-primary / RMP-partner / ADC-supervisor on overlapping territories.
5. Walter as pending-hire row, no Auth account yet.
6. Answers to Q1-Q6 in section 6.

Push back on any of these. I'd rather hear "no, do it this way" now than rebuild it in July.
