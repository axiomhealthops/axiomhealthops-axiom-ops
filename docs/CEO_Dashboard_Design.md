# CEO Dashboard — Consolidation & Director Command Redesign

**Phase 1 — design only.** No code changes proposed in this document.
**Author:** Claude (advisor) for Liam O'Brien
**Date:** 2026-05-31
**Companion docs:** `docs/AHM_Operations_Dashboard_Audit.docx` (29 May, structural), `docs/EdemaCare_UX_Audit_2026-05-31.docx` (31 May, experience).

---

## TL;DR — recommendation

1. **Retire 4 surfaces, fold 3 into Reports, leave 4 role-specific dashboards alone.** Net: 14 leadership-orbit pages → 8 pages, with Director Command as the only CEO-facing one. Detailed table in §2.
2. **Cut Director Command, don't add to it.** It is already the densest page in the app — the 31 May UX audit specifically flagged this. CEO-level means *less* on screen, not more. Proposed layout in §3 strips it to **Hero + 5 KPI tiles + 1 "Needs You Today" panel + 1 collapsible Detail block**. Region Health and Manager Scorecards move into tabs.
3. **Build the FL/GA toggle plumbing now, hide the UI control until GA has real volume.** Today: Georgia Territory has **0 counties, 0 legacy region letters, 0 coordinators with GA assignments, 0 patients in operational tables**. Shipping a visible toggle with an empty GA tab signals expansion sooner than it's true. Detail in §4.
4. **Three things I'm pushing back on.** Liam's instinct to consolidate is right but the framing has three flaws — see §5.
5. **Five questions Liam must answer** before any build starts — §6.

---

## 1. Inventory — the 8 leadership dashboards

Two audits both used "8 leadership dashboards." That count was the original Q3 framing. Today the actual leadership-orbit count is **14 surfaces** (sidebar grep against `Dashboard.jsx` + `page_permissions` rows where any of `super_admin`, `admin`, `assoc_director`, `regional_manager`, `pod_leader` = true). Treating the larger list honestly is the only way to make consolidation decisions stick.

| # | Page | File · LOC | Sidebar section | Roles allowed (super/admin/AD/RM/PL) | What it does | 30-day signal |
|---|---|---|---|---|---|---|
| 1 | **Director Command** | `DirectorDashboard.jsx` · 948 | OVERVIEW | ✓ ✓ ✗ ✓ ✗ | Liam's hero — revenue pace, triage 5, region heat, manager scorecards, exception feed, WeekSelector. Already the strongest leadership surface. | Liam: 1,469 mutations |
| 2 | **Operations Manager** | `OperationsManagerDashboard.jsx` · 1,176 | OVERVIEW | ✓ ✗ ✗ ✗ ✓ | Carla's pipeline triage — engagement banner, team grid, today's standups, pipeline stage cards. | Carla: 873 mutations; Hervylie: 1,526 |
| 3 | **AD Dashboard** | `AssociateDirectorDashboard.jsx` · 774 | OVERVIEW | ✓ ✗ ✓ ✗ ✗ | Lia/Ariel/Samantha multi-region rollup, vacancy banner, auth lag. The only page with a "Last refresh" timestamp (line 526). | 0 mutations by any AD in 30d |
| 4 | **RM Dashboard** | `RegionalManagerDashboard.jsx` · 1,045 | OVERVIEW | ✓ ✓ ✓ ✗ ✗ | Per-RM tabbed view (Overview/Trends/Performance). Hand-rolls `getWeekStart` and `getQuarter` (29 May audit, lines 27–41). | 0 RM mutations in 30d |
| 5 | **RM Daily** | `RMDailyDashboard.jsx` · 356 | OVERVIEW (default for `regional_manager` per `Dashboard.jsx:154`) | ✓ ✓ ✓ ✓ ✗ | RM's at-a-glance: census/visits/auths/onHold for their regions, tabs. | 0 RM mutations in 30d |
| 6 | **Overview** | `OverviewPage.jsx` · 296 | OVERVIEW | ✓ ✓ ✓ ✗ ✓ | Legacy multi-section landing page — hardcodes `RATE = 230` (line 8) instead of importing `BLENDED_RATE`. Pre-Director-Command era. | likely <20 page opens/wk (proxy only — no telemetry) |
| 7 | **Live Alerts** | `LiveAlertsPage.jsx` · 237 | OVERVIEW | ✓ ✓ ✓ ✗ ✓ | Standalone alerts feed. 29 May audit recommended deletion ("alert/action consolidation first, delete LiveAlertsPage + absorb ActionListPage into a backend service feeding Director"). | low |
| 8 | **Revenue Actions** | `ActionListPage.jsx` · 696 | OVERVIEW | ✓ ✓ ✓ ✗ ✓ | Auto-generated revenue actions. 29 May audit: "absorb ActionListPage into [Director Command]" — same source, same ranking logic. | low |
| 9 | **My Region** | `MyRegionPage.jsx` · — | OVERVIEW | ✓ ✓ ✓ ✓ ✗ | Per-user region view, tabs, hardcodes `RATE = 230` (line 7). | RM-tier |
| 10 | **Executive Report** | `ExecutiveReportPage.jsx` · 398 | ADMIN | ✓ ✓ ✓ ✗ ✗ | Tabular weekly metrics with status pills. Substantially overlaps Director Command's data layer. | low |
| 11 | **Daily Reports** | `DailyReportsPage.jsx` · 330 | ADMIN | ✓ ✓ ✓ ✗ ✗ | Daily check-in form + report list. *Write* surface (coordinators submit), not a *read* surface. | medium |
| 12 | **Dept Reports** | `DepartmentReportsPage.jsx` · 527 | ADMIN | ✗ ✗ ✗ ✗ ✗ | **Dead.** Commented out at `Dashboard.jsx:67,128`; `page_permissions.dept-reports` row has all 11 role flags = FALSE. 29 May audit confirmed. | 0 — unreachable |
| 13 | **Pipeline Tracker** | `PipelineTrackerPage.jsx` · 414 | OPERATIONS | ✓ ✓ ✓ ✓ ✓ | SOC → Active workflow. Operational tool, not a CEO summary. | medium |
| 14 | **Revenue** + **Scorecard** | `RevenuePage.jsx` · 325 + `ScorecardPage.jsx` · 228 | PERFORMANCE | ✓ ✗ ✗ ✗ ✗ | Two analytical views Liam-only. Math is OK but they reproduce slices Reports already covers. | low |

Sources for the usage column: 30-day mutation counts from `coordinator_activity_log` (the audit's own proxy — true page-view telemetry doesn't exist in the platform yet). Mutation distribution by role for the last 30 days: super_admin 1,469 · pod_leader 1,526 · admin 874 · auth_coord 5,735 · care_coord 3,766 · intake_coord 55 · **assoc_director 0 · regional_manager 0.** That zero is worth a separate conversation (§5).

---

## 2. Consolidation plan — classify each

| Page | Verdict | Rationale |
|---|---|---|
| **Director Command** | **KEEP — but cut, don't grow.** | Already correct hero; UX audit's Journey 4 explicitly flagged density. CEO redesign is subtractive (§3). |
| **Operations Manager** | **KEEP as-is.** | Carla owns it. Most active leadership surface (Carla 873 + Hervylie 1,526 mutations). Different chair, different question ("where are patients stuck?"). UX audit says it's "the right surface." |
| **AD Dashboard** | **KEEP, polish.** | Different chair (3 ADs). Multi-region rollup logic doesn't belong on a CEO page. **Push-back on Liam's instinct here in §5.** |
| **RM Dashboard** | **MERGE INTO RM Daily as a "Trends" tab.** | 29 May audit's recommendation: "Regional Manager Multi-View (Daily / Weekly / Performance tabs)." Both pages serve the same chair (RMs), so two routes is the bug. |
| **RM Daily** | **KEEP, absorb RM Dashboard as a tab.** | This is the actual RM default landing (`Dashboard.jsx:154`). Make it the only RM surface. |
| **Overview** | **RETIRE.** | Predecessor of Director Command. Hardcodes `RATE = 230` instead of importing — drift surface waiting to happen. No unique value. |
| **Live Alerts** | **RETIRE.** | 29 May audit recommended exactly this: "delete LiveAlertsPage." Its content is already in Director Command's exception feed. |
| **Revenue Actions** | **RETIRE — fold logic into Director Command "Needs You Today."** | 29 May audit: "absorb ActionListPage into [Director]." The action-generation code (`buildAutoActions`, `ActionListPage.jsx:30`) becomes a shared `action_items` table the audit also recommended. |
| **My Region** | **KEEP.** | RM-tier work surface, role-scoped. Hardcoded `RATE = 230` (line 7) — flag for the same fix as Overview. |
| **Executive Report** | **FOLD INTO `ReportsExportPage`.** | Tabular weekly metrics already overlap the 27 reports there. Same pattern as `DepartmentReportsPage` (which was folded 2026-05-17 successfully). |
| **Daily Reports** | **KEEP — it's a write surface, not a dashboard.** | Coordinators submit daily check-ins here. Mis-classified as a "dashboard" in earlier framing. Should arguably move out of ADMIN into MY DAY siblings. |
| **Dept Reports** | **DELETE THE FILE.** | Already dead in router (`Dashboard.jsx:67`) and `page_permissions` (all FALSE). 527 LOC of nothing. 29 May audit confirmed. |
| **Pipeline Tracker** | **KEEP — operational tool.** | Not a CEO/leadership surface despite OVERVIEW-adjacent permissions. Used by RM/AD/admin for SOC → Active workflow. |
| **Revenue + Scorecard** | **FOLD BOTH INTO `ReportsExportPage`.** | Both are analytical slices super_admin-only. The 27-report consolidation hub is where new analytics belong (29 May audit principle). |

**Net change:** 14 leadership-orbit surfaces → **8 surfaces.** Routes retired: Overview, Live Alerts, Revenue Actions, RM Dashboard (merged), Executive Report (folded), Revenue (folded), Scorecard (folded), Dept Reports (deleted). LOC retired: ~3,000.

**Order of operations matters** (29 May audit recommended): kill Dept Reports first (zero risk — already dead), then fold Exec/Revenue/Scorecard into Reports (mechanical), then retire Overview + Live Alerts, then do the harder Revenue Actions → Director Command absorption with the shared `action_items` table the audit asked for. Save the Director Command redesign for last because every other consolidation feeds it.

---

## 3. CEO-level Director Command — proposed layout

The 31 May UX audit Journey 4 reads, verbatim: *"By the time you have scrolled this far, the screen is dense. The bottom third of the page competes with the top third for attention."* CEO redesign is **subtractive**.

**Layout — top to bottom, no scrolling required to answer "are we hitting revenue this week?":**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar | EdemaCare · ● Live · refreshed 8s ago | [Week pill ‹ May 24–30 ›]│  ← uses existing WeekSelector
├──────────────────────────────────────────────────────────────────────────┤
│ ┌─────────── HERO ─────────────────────┐ ┌─── OPS SCORE ──┐               │
│ │ $128,440  of $200,000  64%           │ │      72        │               │
│ │ ▲ $14,200 (+12%) vs prior week       │ │   NEEDS WORK    │               │
│ │ ████████████████░░░░░░░░░░░░ 64%     │ │  (hover trail)  │               │
│ └──────────────────────────────────────┘ └─────────────────┘               │
│ ✓ On pace · 3 P1 issues · 2 managers in red                               │
├──────────────────────────────────────────────────────────────────────────┤
│ FIVE KPI TILES (all clickable, all with WoW delta chip)                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│ │ Visits   │ │ Active   │ │ Pipeline │ │ Auth     │ │ Team     │         │
│ │   558    │ │ Census   │ │ Stalled  │ │ Renewals │ │ Engagement│        │
│ │ ▲ 8%     │ │   872    │ │   23     │ │ Urgent: 7│ │ 19/22 ✓   │        │
│ │ vs prior │ │ ▼ 2%     │ │ ▲ 4 wk/wk│ │ ⚠ stable │ │ 3 quiet   │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
├──────────────────────────────────────────────────────────────────────────┤
│ NEEDS YOU TODAY — top 5, ranked. Each row: 1 line, 1 action button.       │
│   ⓘ P1 · Auth #4421 expires in 2 days, $1,840 at risk    [Open ▾]        │
│   ⓘ P1 · Lia's region completion 58% (red 3rd day)       [Message ▾]     │
│   …                                                                       │
├──────────────────────────────────────────────────────────────────────────┤
│ ▾ Detail — Region Health · Manager Scorecards · Exception Feed (collapsed)│
└──────────────────────────────────────────────────────────────────────────┘
```

**What's in vs. out of the above-the-fold view:**

*In* — Hero (revenue + WoW + ops score + summary sentence), 5 KPI tiles (all clickable, all with WoW%), "Needs You Today" (max 5 items). That's the entire CEO surface.

*Out of above-the-fold* (moved into the `<details>` block at bottom): Region Health table, Manager Scorecards grid, Exception Feed, Auth Renewals snapshot, Clinician Underutilization list, Path to $200K breakdown. All retained, all reachable in one click.

**Drill-through map** (every KPI tile clicks to an existing page — nothing new gets built):

| KPI tile | Click target | Why |
|---|---|---|
| Revenue (hero) | `revenue` page (will fold to Reports) | Liam already has this habit |
| Visits | `visits` (VisitSchedulePage) | Existing |
| Active Census | `census` (PatientCensusPage) | Existing |
| Pipeline Stalled | `pipeline` (PipelineTrackerPage) | Existing |
| Auth Renewals | `auth-renewals` | Existing |
| Team Engagement | `ops-dashboard` (Carla's page — engagement banner already lives here) | Cross-link, not duplication |

**Mobile** — the same hero stacks vertically; KPI tiles wrap to 2-col grid; "Needs You Today" stays full-width. The 31 May UX audit dimension F (Mobile responsiveness) calls out a brittle `index.css` `!important` hack that should be replaced — that's the prerequisite work before this layout renders well on Liam's phone.

**"Since you last opened" strip** (UX audit Journey 4, Recommendation #1): tiny line between hero and KPI tiles. *"Since you opened this yesterday at 7:14 AM: +14 visits, +3 referrals, 2 P1s cleared, 1 new P1."* Costs ~half a day to add a `last_viewed_at` column on `coordinators`. Worth every line.

**Week toggle** — keep the existing `WeekSelector` from `src/components/WeekSelector.jsx` (already wired, persists to localStorage, mobile-ready). It already lives on Director Command. No change.

---

## 4. FL/GA state toggle — data wiring + the harder question

**The mapping is clean — all 10 legacy region letters map to FL via the existing `marketing_territories` table (queried 2026-05-31):**

```
FL North → B, C, G        (Duval/Clay; Flagler/St. Johns)
FL Central → A, H, M, N   (Orange/Osceola/Seminole; Lake/Sumter/Marion; Tampa Bay/Polk)
FL South → J, T, V        (Brevard/Indian River; Palm Beach/Martin/St. Lucie)
GA       → (none)         Georgia Territory: 0 counties, 0 legacy_region_letters
```

Schema confirmed: `marketing_territories.state` ∈ {FL, GA}, `marketing_territories.legacy_region_letters text[]`. So the wiring is a one-liner — `REGION_TO_STATE = { A:'FL', B:'FL', ..., V:'FL' }` derived from `marketing_territories` at build time or load time. Persist to localStorage like the week toggle.

**Note: the prompt referenced `marketing_states` and `marketing_regions` tables. Neither exists.** Only `marketing_territories` exists. Fine for the toggle, but anything that depends on a separate `marketing_states` table needs to be re-spec'd against the actual schema.

**Data integrity flag found while mapping:** the `coordinators` table has 2 rows with region letter `"I"` in their `regions` array (one with the full FL list including `I`, one with `A,C,B,G,H,I,J,M,N,T,V`). `I` does not appear in `REGIONS` (`src/lib/constants.js:51`), is not a legacy letter in `marketing_territories`, and was never mentioned in the May 15 reorg notes. Either typo for `J` or stale data. Flag for cleanup — one-line fix, but every region-scoped filter currently silently treats `I` as "phantom region with no data."

**Now the harder question — is the toggle worth building today?**

| Today's GA state | Numbers |
|---|---|
| `marketing_territories` rows where state='GA' | 1 (Georgia Territory) |
| Counties assigned | 0 |
| Legacy region letters assigned | 0 |
| Coordinators with GA-only regions | 0 |
| Patients in `census_data` from GA | 0 (no state column on operational tables — implied via region letters → all FL) |
| `EXPANSION` constants (`src/lib/constants.js:258`) say | "Georgia · In Progress · 60% credentialing · 2 staff hired · target May 2026" |

Today is **May 31, 2026** — the GA target date. The expansion table claims 2 staff hired; the `coordinators` table contradicts that (no GA-assigned coordinator rows). Whichever is right, **operational data for GA is empty**, and will remain so until the first GA patient lands in `census_data`.

**Recommendation:**

1. **Build the abstraction** — `getRegionsForState(stateCode)` helper sourced from `marketing_territories`. Cheap, future-proof, used by other surfaces (Marketing CRM, Expansion page) too.
2. **Hide the visible toggle until GA has ≥10 active patients.** Show it the moment data crosses that threshold (e.g., `census_data.region IN (territories_for_state('GA'))` returns ≥10). Until then, every Director Command query runs the same way it does today and the page reads "FL operations" implicitly.
3. **When the toggle ships**, default to **All states** so Liam sees the total picture (matches his prompt).
4. **Add a small "expansion status" tile on Director Command** (replaces one of the 5 KPI tiles when stateView=All, or pin it at the bottom) — credentialing %, staff hired, first-patient date target. That gives Liam executive context on GA without faking operational data that doesn't exist yet.

**The push-back here:** a visible FL/GA toggle with a permanently-empty GA tab is worse than no toggle — it signals progress that isn't real, and the first time you click it during a board demo and see all zeros, the credibility hit lands on the dashboard, not on the expansion timeline.

---

## 5. Push-back — three things I'd reframe before building

**(1) "Consolidate the 8 leadership dashboards into Director Command" overreaches.** Of the 14 leadership-orbit surfaces, only **3** belong inside Director Command (Overview, Live Alerts, Revenue Actions — all already flagged by the 29 May audit). **4** belong inside Reports (Executive Report, Revenue, Scorecard, Dept Reports). **4** are role-specific work surfaces that should NOT merge in (Operations Manager = Carla, AD Dashboard = ADs, RM Daily = RMs, My Region = RM/AD). The CEO view is one of the surfaces, not the union of all of them.

**(2) "Make it CEO-level" should mean less, not more.** The instinct is to bake the AD's auth-lag panel, the RM's region cards, and Carla's pipeline triage all into one mega-page. The 31 May UX audit already says Director Command is the densest page in the app. Pushing more sections onto it makes Liam's morning standup worse, not better. The redesign in §3 is **subtractive** — half of what's on Director Command today goes into a collapsed `<details>` block, and the visible surface drops to hero + 5 tiles + 5 actions. If "CEO-level" means scannable in 5 seconds, density is the enemy.

**(3) The 0-mutation-by-AD/RM signal needs its own conversation.** In 30 days of activity logs: AD = 0 mutations, RM = 0 mutations. That's 4 ADs (Lia, Ariel, Samantha) and ~6 RMs producing zero writes. Two readings:

- *Most charitable:* their dashboards are read-only by design, so they don't show up in a mutation log.
- *Less charitable:* the AD/RM dashboards aren't actually being opened. The mutations these roles SHOULD generate (status changes via the dashboards' drill-throughs, region task assignments, vacancy banner acknowledgments) aren't happening.

Either way, the 29 May audit's #1 recommendation — **build page-view telemetry** — is the unlock. Without it, we're cutting on opinion. With it (half a day of work, one `page_views` table), the next round of cuts is evidence-based. I'd put telemetry **before** the Director Command redesign in the sequence.

---

## 6. Five questions Liam must answer before any build

1. **Is the AD Dashboard staying or going?** I'm recommending **keep**, but the data signal (0 AD mutations in 30 days) cuts the other way. If we keep it, do we invest a sprint into making it sticky (clickable KPIs, drill-throughs, in-app messaging — UX audit Journey 2 covers exactly this)? Or do we accept that ADs work from Director Command + region drilldowns and retire AD Dashboard with the rest of the dead surfaces?
2. **FL/GA toggle — ship hidden, or wait?** Recommendation: **build the plumbing now, hide the UI until GA has ≥10 patients.** Confirm. Alternative: ship visible with a tasteful "Georgia launches Q3 — credentialing 60%" placeholder card in the GA view.
3. **Page-view telemetry first?** A `page_views` table + `useTrackPageView()` hook is half a day of work. It would let every subsequent consolidation decision be evidence-based instead of mutation-proxy. Do we sequence it **before** the Director Command redesign, or in parallel?
4. **Revenue Actions consolidation — sync with backend `action_items` table?** The 29 May audit's "shared `action_items` pipeline" recommendation says action generation should move from per-page front-end render to a backend hourly upsert. That's a bigger build than the redesign. Two options: (a) absorb ActionListPage's front-end logic into Director Command now, build the backend table later; (b) do them together, ~2-week sprint. I'd recommend (a) because it unblocks the consolidation and the backend table can land independently.
5. **"Director" sidebar default for super_admin** routes to `director`; **"admin" routes to** `ops-dashboard`; **AD routes to `ad-dashboard`** (`Dashboard.jsx:152–166`). If we retire AD Dashboard, where do ADs land — Director Command? RM Daily? A new "Pick a region" splash? Need an answer before the AD-retirement scenario, but not before the retire-Overview/Live-Alerts/Revenue-Actions scenario.

---

**Out of scope for this design** (per `CLAUDE.md`): renaming `axiomhealth` code-internal identifiers, touching the 22 `@axiomhealthmanagement.com` coordinator emails, rewriting historical `daily_ops_reports.report_html` or `patient_notes.note_text`. None of that touches the CEO view, all of it is Phase 3 rebrand work.

**Not touched in this design**: the 8-component shared UI library the 31 May UX audit recommends (KpiTile, PageHeader, FilterChips, etc.). That work is the right substrate for this redesign — the new Director Command should be the first page to consume the new library. If we're sequencing tight, the library can land in parallel: Week 1 build the components against the existing Director Command, Week 2 ship the new layout on top.
