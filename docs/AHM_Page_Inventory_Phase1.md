# EdemaCare Operations Dashboard — Phase 1 Page Inventory

> **Note:** AxiomHealth Management is the legal entity; EdemaCare is the public-facing
> brand (effective June 1, 2026). The filename is preserved to keep links stable.
> EdemaCare is a service of AxiomHealth Management LLC.

**Audit date:** 2026-05-29
**Auditor:** Claude (read-only)
**Scope:** Every page registered in `src/pages/Dashboard.jsx` router + cross-reference to `Sidebar.jsx` + `page_permissions` table
**Files audited:** 63 `.jsx` files under `src/pages/` (57 registered routes + 4 auth/layout + 2 orphans)

---

## Headline numbers

| Metric | Value |
|---|---|
| Page components registered in router (`PAGE_COMPONENTS`) | **57** |
| Rows in `page_permissions` table | **57** (1:1 with router) |
| Page files on disk under `src/pages/dashboard/` | **59** (2 orphaned — see below) |
| Active coordinators (DB) | **22** |
| Distinct users producing activity in last 30 days | **13** (across 6 roles) |
| Total mutation events in last 30 days | **~28,800** |
| Largest page file | `CoordinatorPage.jsx` — **2,210 lines** (deprecated, not in router) |
| Largest page in router | `IntakeDashboardPage.jsx` — **1,798 lines** |
| Smallest pages in router | `ExpansionPage.jsx` (102), `SettingsPage.jsx` (138) |

---

## Critical finding — telemetry gap

There is **no page-view telemetry**. `coordinator_activity_log` records only data mutations (referral updates, auth updates, notes, task completion, etc.). I cannot give you "page opens per user." I CAN give you mutation volume by underlying resource, which is a proxy for which workflows are live.

**Recommendation (carry into Phase 2):** add a lightweight `page_views` table + a `useTrackPageView()` hook fired in each page's mount effect. ~30 min of work, will pay back forever in audit & UX clarity.

---

## Inventory table (57 registered routes)

Sorted by `page_section` then `sort_order`. **`Workflow Activity (30d)`** = mutation events against the page's primary table over the last 30 days. **"—"** means no underlying mutation activity captured (page may be read-only or dead). **"Modified"** = file's `git log -1` author date.

### OVERVIEW

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 1 | `director` | Director Command | DirectorDashboard.jsx | 866 | May 17 | Landing/dash | Read-only roll-up | Liam (super_admin) |
| 2 | `ops-dashboard` | Operations Manager | OperationsManagerDashboard.jsx | 1,176 | May 28 | Landing/dash | Read-only roll-up | Carla (admin / pod_leader) |
| 3 | `overview` | Overview | OverviewPage.jsx | 296 | Apr 20 | Landing/dash | Read-only roll-up | All non-RM roles |
| 4 | `ad-dashboard` | AD Dashboard | AssociateDirectorDashboard.jsx | 785 | May 15 | Landing/dash | Read-only roll-up | assoc_director (Lia, Sam, Ariel) |
| 5 | `my-region` | My Region | MyRegionPage.jsx | 716 | May 17 | Landing/dash | Read-only roll-up | regional_manager |
| 6 | `rm-daily` | Daily View | RMDailyDashboard.jsx | 356 | May 17 | Landing/dash | Read-only roll-up | regional_manager |
| 7 | `rm-dashboard` | RM Dashboard | RegionalManagerDashboard.jsx | 1,051 | May 17 | Landing/dash | Read-only roll-up | admin/assoc_director (not RM) |
| 8 | `alerts` | Live Alerts | LiveAlertsPage.jsx | 237 | May 17 | Table-list | 4,219 alert rows | Most non-RM roles |
| 9 | `actions` | Revenue Actions | ActionListPage.jsx | 695 | May 17 | Table-list | 240 action_responses | admin / pod_leader / team_member |

### MAIN OPERATIONS

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 10 | `census` | Patient Census | PatientCensusPage.jsx | 1,341 | May 27 | Table-list | 885 patient rows / heavy reads | All ops roles |
| 11 | `visits` | Visit Schedule | VisitSchedulePage.jsx | 604 | Apr 20 | Table-list | 15,405 visit rows / read-heavy | All ops + clinicians + telehealth |
| 12 | `waitlist` | Waitlist | WaitlistPage.jsx | 606 | Apr 23 | Table-list | 0 waitlist_assignments | care_coord, ops |
| 13 | `pipeline` | SOC → Active Pipeline | PipelineTrackerPage.jsx | 413 | May 17 | Table-list | (mirrors intake_referrals) | intake/care_coord |
| 14 | `on-hold` | On-Hold Recovery | OnHoldRecoveryPage.jsx | 536 | Apr 21 | Table-list | **218 events** (active) | care_coord/admin |
| 15 | `discharges` | Discharge Tracker | DischargeTrackerPage.jsx | 264 | Apr 20 | Table-list | 0 patient_discharges | care_coord/telehealth |

### INTAKE

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 16 | `intake` | Intake Dashboard | IntakeDashboardPage.jsx | **1,798** | Apr 21 | Landing/dash | **17,019 events** on intake_referrals | intake_coordinator |
| 17 | `intake-queue` | Intake Queue | IntakeCoordQueue.jsx | 296 | Apr 20 | Table-list | (same source) | intake_coordinator (default page) |

### AUTHORIZATION

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 18 | `my-day` | My Day | MyDayPage.jsx | **1,147** | May 28 | Landing/dash (hub) | (read-only roll-up of auths/renewals) | auth_coordinator (default page) |
| 19 | `auth-over-limit` | Compliance: Over Limit | AuthOverLimitPage.jsx | 343 | May 28 | Drill-down | (filtered slice of auth_tracker) | auth team |
| 20 | `auth-pending-coverage` | Auth Pending Coverage | AuthPendingCoveragePage.jsx | 285 | May 28 | Drill-down | (filtered slice) | auth team |
| 21 | `visit-runway` | Visit Runway | VisitRunwayPage.jsx | 297 | May 28 | Drill-down | (computed from visits + auth) | auth team |
| 22 | `auth-expiry-timeline` | Auth Expiry Timeline | AuthExpiryTimelinePage.jsx | 270 | May 28 | Drill-down | (filtered slice) | auth team |
| 23 | `stuck-auths` | Stuck Auths | StuckAuthsPage.jsx | 269 | May 29 | Drill-down | (filtered slice) | auth team |
| 24 | `auth-coordinator` | My Auth Queue | AuthCoordDashboard.jsx | 858 | May 28 | Landing/dash | (predecessor of My Day) | auth_coordinator |
| 25 | `auth` | All Authorizations | AuthTrackerPage.jsx | **1,076** | May 28 | Table-list | **7,338 events** on auth_tracker | auth team + admin |
| 26 | `auth-renewals` | Renewal Tasks | AuthRenewalsPage.jsx | 367 | May 28 | Table-list | **62 events** on auth_renewal_tasks | auth team |

### CARE COORDINATION

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 27 | `productivity` | Productivity | ProductivityPage.jsx | 537 | May 18 | Report | (computed) | broad |
| 28 | `care-coord-patients` | My Patients | CareCoordMyPatients.jsx | 888 | May 19 | Table-list | (mirrors coordinator_tasks) | care_coordinator (default page) |
| 29 | `coordinator-portal` | Coordinator Portal | CoordinatorPage.jsx (via Router) | **2,210** | May 18 | Landing/dash | **1,742 events** on coordinator_tasks | care_coordinator |
| 30 | `missed-cancelled` | Missed & Cancelled | MissedCancelledReportPage.jsx | 422 | May 17 | Report | (computed) | admin/AD/RM/pod_leader |
| 31 | `clinician-assignment` | Clinician Assignment | ClinicianAssignmentPage.jsx | 399 | May 17 | Form-entry | (patient_clinician_assignments — 2 rows) | care_coord/RM |
| 32 | `scheduling-alerts` | Scheduling Alerts | SchedulingAlertsPage.jsx | 402 | Apr 20 | Table-list | (computed) | broad |
| 33 | `stale-frequency` | Stale Frequency Review | StaleFrequencyPage.jsx | 537 | Apr 21 | Table-list | (filtered slice) | care_coord/AD/RM |
| 34 | `frequency-review` | Frequency Review Queue | FrequencyReviewPage.jsx | 254 | Apr 20 | Table-list | (filtered slice) | super_admin/admin/AD |

### CLINICAL DEPARTMENT

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 35 | `clinical-progression` | Clinical Progression | ClinicalProgressionPage.jsx | 741 | Apr 21 | Report | (read-only) | clinicians/AD/RM |
| 36 | `clinician-schedule` | Clinician Schedule | ClinicianSchedulePage.jsx | 417 | Apr 23 | Table-list | (mirrors visits) | clinicians/telehealth |
| 37 | `hospitalizations` | Hospitalization Tracker | HospitalizationTrackerPage.jsx | 697 | May 19 | Table-list | 24 hospitalizations rows | clinicians/AD/RM |
| 38 | `swift-team` | SWIFT Team | SwiftTeamDashboard.jsx | 820 | May 19 | Landing/dash | 0 swift_team_patients / 0 wound assessments | super_admin/admin/AD |
| 39 | `high-risk-patients` | High Risk Patients | HighRiskPatientsPage.jsx | 612 | May 19 | Table-list | 186 risk_factor rows | broad |
| 40 | `medicare-tracker` | Medicare Tracker | MedicareTrackerPage.jsx | 652 | May 19 | Table-list | 106 medicare flags | clinicians/AD/RM |
| 41 | `staff` | Staff Directory | StaffDirectoryPage.jsx | 270 | Apr 20 | Table-list | (clinicians table — 0 rows) | admin/AD/RM/clinician |

### MARKETING

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 42 | `marketing-crm` | Marketing CRM | MarketingCRMPage.jsx | **1,266** | May 29 | Landing/dash | 0 marketing_contacts / 0 encounters / 3 special projects | marketing_rep + admin |

### PERFORMANCE

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 43 | `scorecard` | Scorecard | ScorecardPage.jsx | 228 | Apr 20 | Report | (read-only) | **super_admin only** |
| 44 | `clinician-accountability` | Clinician Accountability | ClinicianAccountabilityPage.jsx | 501 | May 19 | Report | (read-only) | **super_admin only** |
| 45 | `growth` | Growth Tracker | GrowthTrackerPage.jsx | 212 | May 17 | Report | (read-only) | **super_admin only** |
| 46 | `revenue` | Revenue | RevenuePage.jsx | 325 | May 17 | Report | (read-only) | **super_admin only** |
| 47 | `ops-reports` | Ops Reports | OpsReportsPage.jsx | 670 | Apr 20 | Report | (computed) | broad |

### ADMIN

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 48 | `exec-report` | Executive Report | ExecutiveReportPage.jsx | 397 | May 17 | Report | (read-only) | admin/AD |
| 49 | `regions` | Regions | RegionsPage.jsx | 234 | Apr 20 | Admin utility | (config) | admin/AD |
| 50 | `daily-reports` | Daily Reports | DailyReportsPage.jsx | 329 | Apr 20 | Report | 114 daily_ops_reports rows | admin/AD |
| 51 | `reports` | Reports & Export | ReportsExportPage.jsx | 1,201 | May 19 | Report | (read-only) | admin/AD |
| 52 | `users` | User Management | UserManagementPage.jsx | 496 | May 14 | Admin utility | (config) | admin |
| 53 | `uploads` | Data Uploads | UploadsPage.jsx | 780 | May 26 | Admin utility | 150 upload_batches | admin |
| 54 | `insurance-settings` | Insurance Abbreviations | InsuranceSettingsPage.jsx | 534 | May 15 | Admin utility | 118 lookup rows | admin |
| 55 | `audit-import` | Audit Import | AuthAuditImportPage.jsx | 619 | May 16 | Admin utility | 1,516 staging / 1,744 audit_log | admin/super_admin/pod_leader |
| 56 | `settings` | Settings | SettingsPage.jsx | 138 | Apr 20 | Admin utility | (config) | **super_admin only** |

### Misc / not categorized in DB section

| # | page_key | Label | File | Lines | Modified | Surface | Workflow Activity (30d) | Primary Audience |
|---|---|---|---|---|---|---|---|---|
| 57 | `expansion` | Expansion | ExpansionPage.jsx | 102 | Mar 31 | Landing/dash | none — **2 months untouched** | unclear (no row in page_permissions for this section) |

---

## Categorization summary

### By workflow domain

| Domain | Pages | % of catalog |
|---|---|---|
| Overview / leadership dashboards | 9 | 16% |
| Main Operations (census/visits/lifecycle) | 6 | 11% |
| Intake | 2 | 4% |
| Authorization | 9 | 16% |
| Care Coordination | 8 | 14% |
| Clinical Department | 7 | 12% |
| Marketing | 1 | 2% |
| Performance / Reporting | 5 | 9% |
| Admin / utilities | 9 | 16% |
| Misc | 1 | 2% |

### By surface type

| Surface | Count | Comment |
|---|---|---|
| Landing/dashboard | 13 | **High — too many "homepages"** |
| Table-list | 22 | Volume center of gravity |
| Drill-down / detail | 5 | All in Authorization (the recent wave) |
| Report | 9 | Mostly read-only |
| Form-entry | 1 | Clinician Assignment only |
| Admin utility | 7 | Reasonable |

### By role-gating (number of pages each role can see)

| Role | Pages visible | Notes |
|---|---|---|
| super_admin | 56 | Liam — sees almost everything |
| admin | 41 | Carla — broad |
| assoc_director | 33 | Lia / Sam / Ariel |
| regional_manager | 19 | |
| pod_leader | 27 | Hervylie |
| team_member | 14 | |
| auth_coordinator | 17 | |
| intake_coordinator | 9 | Lean — good |
| care_coordinator | 16 | |
| clinician | 9 | Lean — good |
| telehealth | 8 | Lean — good |
| marketing_rep | 1 | Marketing CRM only |

---

## Cross-page redundancy (clusters)

I identified **seven** clusters where multiple pages slice the same data. Phase 2 will recommend mergers/deprecations.

### Cluster A — Leadership homepages (9 pages, 5,900+ LOC)
`director`, `ops-dashboard`, `overview`, `ad-dashboard`, `my-region`, `rm-daily`, `rm-dashboard`, `intake` (also serves as intake-coord landing), `coordinator-portal`.
**Issue:** Each role has its OWN dashboard. Director / Ops Manager / AD / RM-Daily / RM-Dashboard / My-Region all show overlapping revenue, exception, and pipeline tiles with subtly different breakdowns. ~70% of the data layer is duplicated.

### Cluster B — Auth drill-downs (5 pages added late May)
`auth-over-limit`, `auth-pending-coverage`, `visit-runway`, `auth-expiry-timeline`, `stuck-auths`. All five are filtered slices of `auth_tracker`. Combined: 1,464 LOC.
**Issue:** Five distinct routes for what is fundamentally **one table with five filter presets**. Compounding: `auth` (All Authorizations, 1,076 LOC) shows the same table unfiltered. And `my-day` (1,147 LOC) is the hub-and-spoke that links to them all. **Total: ~5,000 LOC for auth surfaces.**

### Cluster C — Auth landings: `my-day` vs `auth-coordinator`
Both are auth-coord homepages. `auth-coordinator` (My Auth Queue, 858 LOC) predates `my-day` (1,147 LOC). `my-day` is the newer hub-and-spoke. Both are still in the router and visible to auth_coordinator role. **One should be deprecated.**

### Cluster D — Care coord landings: `coordinator-portal` vs `care-coord-patients`
`coordinator-portal` → `CoordinatorPage.jsx` is **2,210 lines** (the largest file in the app). `care-coord-patients` (888 LOC) is the newer "My Patients" view. Both visible to care_coordinator. Same data. **`CoordinatorPage` should be retired.**

### Cluster E — Intake landings: `intake` vs `intake-queue`
`intake` (Intake Dashboard, 1,798 LOC, mostly untouched since Apr 21) vs `intake-queue` (296 LOC, the newer default). Same data, two different surfaces.

### Cluster F — Frequency review: `stale-frequency` vs `frequency-review`
`StaleFrequencyPage` (537 LOC) and `FrequencyReviewPage` (254 LOC). Different role-gating (`stale-frequency` is broader; `frequency-review` is super_admin/admin/AD only). Looks like one evolved from the other.

### Cluster G — Reporting: `reports` vs `daily-reports` vs `ops-reports` vs `exec-report`
Four reporting hubs. `dept-reports` was already merged into `reports` per the May 17 commit (good). But `daily-reports`, `ops-reports`, `exec-report`, and `reports` are still four separate surfaces. Some have role differences, some don't.

---

## Orphaned files & dead rows

### Orphaned files (exist on disk, NOT in router)
| File | Lines | Modified | Notes |
|---|---|---|---|
| `src/pages/dashboard/AIDocExtractor.jsx` | 532 | May 27 | Likely a component imported by `audit-import` flow — verify in Phase 2 |
| `src/pages/dashboard/ManualIntakeEntry.jsx` | 611 | May 26 | Likely a component imported by `intake-queue` — verify in Phase 2 |
| `src/pages/dashboard/DepartmentReportsPage.jsx` | 527 | May 16 | **Dead code** — explicitly commented out of router, "merged into ReportsExportPage" |
| `src/pages/CoordinatorPage.jsx` | 2,210 | May 18 | Router-loaded via CoordinatorRouter wrapper — not directly orphaned, but the wrapper itself wraps a single page |

### Dead row in `page_permissions`
| page_key | Label | Notes |
|---|---|---|
| `dept-reports` | Department Reports | **All 11 role flags are FALSE**. No one can see it. It's tombstoned in the DB but never deleted. Recommend hard-delete in Phase 2 cleanup. |

### Pages with zero workflow activity in 30 days (likely dead)
Based on either (a) the underlying table has 0 rows or (b) the table exists but has had no mutations in 30 days:

| page_key | Why flagged | Recommendation (Phase 2) |
|---|---|---|
| `swift-team` | `swift_team_patients` = 0 rows, `swift_wound_assessments` = 0 rows | Either onboard SWIFT data or hide |
| `marketing-crm` | `marketing_contacts` = 0, `marketing_encounters` = 0, only 3 special_projects | Dashboard exists, data layer empty — needs adoption push or freeze |
| `waitlist` | `waitlist_assignments` = 0 | Hide until used |
| `discharges` | `patient_discharges` = 0, `care_coord_discharges` = 0 | Reads from another table? Verify, may be live via different source |
| `clinician-assignment` | `patient_clinician_assignments` = 2 rows total | Form exists but barely used — verify if workflow shifted elsewhere |
| `staff` | `clinicians` = 0 rows | Reads from `coordinators`? Verify |
| `expansion` | No DB section, untouched since Mar 31 | Deprecate or move to ADMIN |
| `frequency-review` | `frequency-review` route narrowly role-gated, overlaps `stale-frequency` | Pick one |

---

## Sidebar/router/DB sync check

| Check | Result |
|---|---|
| All 57 router keys have a `page_permissions` row | ✅ |
| All sidebar `ALL_SECTIONS` keys match DB `page_section` values | ✅ (fixed May 18 per code comment) |
| Pages with `page_section` NOT in `ALL_SECTIONS` | None (expansion's section is unclear but it's role-gated separately) |
| `dept-reports` row in DB but no router entry | ⚠ Dead row, all flags FALSE — safe to delete |
| `expansion` route in router but not in sidebar default `ALL_SECTIONS` mapping | ⚠ Reachable only via direct page_key — possible orphan |

---

## Engineer time signals (proxy)

Last-modified date distribution across the 57 pages:

| Window | # pages | What it tells us |
|---|---|---|
| May 26–29 | **15 pages** | The auth-tracker fix wave + My Day + drill-downs + Marketing CRM + Census + Uploads |
| May 14–25 | 12 pages | OperationsManagerDashboard, Hospitalization, HighRisk, AIDocExtractor, ManualIntakeEntry, Care Coord |
| Apr 20–May 17 | 21 pages | The April-May body of work |
| Mar–early Apr | 9 pages | Foundational pages, mostly untouched: Overview, IntakeDashboard, Visits, Login, ResetPassword, Expansion, CoordinatorRouter |

**Honest read:** the recent build wave was heavily concentrated in **Authorization (5 new drill-downs + My Day) and Carla's Ops dashboard**. Care Coord, Clinical, and Reporting surfaces haven't moved in weeks. Intake's main dashboard hasn't been touched since April 21.

---

## What I'm flagging for Phase 2 (no analysis yet — just the list)

1. **Auth surface bloat** — 9 routes, ~5,000 LOC, almost all 1:1 with filter presets. Likely the highest-impact consolidation target.
2. **Dashboard explosion** — 13 landing surfaces. There are NOT 13 distinct mental models in this business. Some should be one page with a role-aware section toggle.
3. **`my-day` vs `auth-coordinator`** — pick one.
4. **`coordinator-portal` (CoordinatorPage.jsx, 2,210 lines)** — almost certainly the single largest legacy file. Likely splittable.
5. **`intake` Dashboard** — 1,798 lines, no edits in 5 weeks. Either stale or feature-complete. Either way needs a look.
6. **Marketing CRM** — 1,266 LOC of UI sitting on an empty data layer. Either adoption is the issue or scope was over-built.
7. **SWIFT Team** — 820 LOC, no data. Same problem.
8. **Telemetry gap** — add `page_views` tracking BEFORE the next major consolidation so we can measure impact.
9. **Two RLS-disabled staging tables** (security advisor) — `intake_import_staging_2026_05_20`, `auth_sync_pending`, `_auth_backfill_snapshot_2026_05_20`. Liam should decide whether to enable RLS or drop the tables.

---

## Files & paths cited

- `/Users/geoffreyaibot/Documents/GitHub/edemacare-ops/src/pages/Dashboard.jsx`
- `/Users/geoffreyaibot/Documents/GitHub/edemacare-ops/src/components/Sidebar.jsx`
- All 59 `.jsx` files under `src/pages/dashboard/`
- Supabase tables: `page_permissions`, `coordinator_activity_log`, `coordinators`, and every domain table referenced in the activity counts.

**Phase 1 complete.** Phase 2 follows: per-page (per-cluster) deep dive + 30/60/90 plan, delivered as a Word doc.
