# Payer + Marketing Report — Phase 1 Design

**Audience:** Liam (Director of Operations) — gating sign-off only.
**Owner once shipped:** Yvonne Flores (job title to be updated to *Director of Payer Relations and Marketing*).
**Status:** Phase 1 design. No code changes in this pass. Phase 2 build is blocked on Liam's answers to the gating questions at the end of this doc.

---

## 1. Recon summary — what the data can and can't support today

Before designing anything, I audited every table in scope so we don't ship a report that silently lies. The short version:

| Section | Source table(s) | Production data quality | Verdict |
|---|---|---|---|
| 1. Referrals by region | `intake_referrals` | Clean status enum (Accepted / Denied / Pending / On Hold). Region column is mostly clean (canonical A-V codes), but has **251 NULL regions** + **~50 rows in non-canonical codes** (I, O, R, L, F, U, K, P, S, OOA, "Out of Network"). | Ship. Bucket bad regions as "Other / Unknown". |
| 2. Regional census growth/decline (MoM) | `census_status_log` | **Earliest row is 2026-04-03** — only ~2 months of history. `new_status` enum truncation bug ("Discharge - Change I" instead of "Discharge - Change Insurance") + ~500 rows where a timestamp string got stuffed into the status field (parser bug somewhere upstream). | Ship with caveats. Surface "data starts 2026-04" prominently. Filter the timestamp-stuffed rows out. Optionally add a monthly snapshot table to make future history airtight. |
| 3. Visit status by region per month | `visit_schedule_data` | Clean enum (Completed / Scheduled / Missed / Missed (Active)). Region column is clean (only canonical A-V codes appear). Pariox quirks (cancelled-as-completed, attempted-as-completed) **must** be handled via `visitMath.js`. | Ship. Use the per-(patient,date) latest-`uploaded_at` dedup rule from the 2026-06-03 ProductivityPage fix. |
| 4. RM visit tracking | `visit_schedule_data` join `coordinators` on `staff_name_normalized = full_name` where `coordinators.role = 'regional_manager'` | 4 RMs in DB: Earl Dimaano (C), Hollie Fincher (J), Kaylee Ramsey (H), Uma Jacobs (A). **Earl's normalized name is "Earl Norbert Dimaano" in visit data** but "Earl Dimaano" in `coordinators.full_name` — naive join misses 93 of his visits. **Kaylee has only 8 lifetime visits.** RMs are field managers, not primarily treating clinicians. | Ship, but resolve the Earl alias first and clarify with Liam what "visits scheduled with an RM" actually means (see Q4). |

I also confirmed Yvonne's record: she's already `role='admin'` with all 10 operational regions in her `regions` array and `marketing_rep` in her `secondary_roles`. Her current `job_title` is "Director of Payor Relations" — needs a one-line update to "Director of Payer Relations and Marketing". **No new role enum is required**, and adding one would cascade into `page_permissions`, `useAuth.canAccess()`, `Sidebar.jsx`, and every report that filters by role. Strong recommendation: don't.

---

## 2. Section-by-section data source map

### Section 1 — Referrals by Region (Accepted / Denied, Week / Month / Quarter / Year)

```
SELECT
  COALESCE(NULLIF(region, ''), 'Unknown') AS region_bucket,
  referral_status,
  date_received
FROM intake_referrals
WHERE date_received BETWEEN :period_start AND :period_end
  AND referral_status IN ('Accepted','Denied')        -- ignore Pending / On Hold
```

Aggregations: count, then pivot region × status. Period selector drives `:period_start` / `:period_end`. Non-canonical regions (I, O, R, OOA, etc.) get bucketed into "Other" and shown as a separate row that footnotes which raw codes feed it — so we don't lie by dropping them.

### Section 2 — Regional Census Growth / Decline (MoM)

`census_status_log` is the right source. I recommend NET growth math (admits minus exits):

```
admissions  = COUNT(*) WHERE new_status IN ('Active', 'Active - Auth Pendin')
exits       = COUNT(*) WHERE new_status LIKE 'Discharge%' OR new_status = 'Non-Admit'
net_growth  = admissions - exits
pct_change  = net_growth / (active_census_at_month_start) * 100
```

Active census at month start = `census_data` snapshot reverse-engineered from `census_status_log` (cumulative running tally). This works from 2026-04-03 forward. **For months prior, we'd have to fall back to a coarser proxy** — either flag "data unavailable" or backfill from `upload_batches.census_data` history if it's retained (have not yet confirmed it is).

Filter out the parser-bug rows: `WHERE new_status NOT SIMILAR TO '\d{4}-\d{2}-\d{2}%'` (drops the ~500 timestamp-stuffed rows). I'll also normalize "Discharge - Change I" -> "Discharge - Change Insurance" in the report query so the rollup is clean even before the upstream parser is fixed.

### Section 3 — Visit Status by Region per Month

```
WITH latest AS (
  SELECT DISTINCT ON (patient_name, visit_date)
         patient_name, visit_date, region, status, event_type, staff_name_normalized
  FROM visit_schedule_data
  WHERE visit_date BETWEEN :period_start AND :period_end
  ORDER BY patient_name, visit_date, uploaded_at DESC
)
SELECT region, DATE_TRUNC('month', visit_date) AS month, COUNT(*) ...
```

**Classification uses `visitMath.js` (`isCompleted`, `isCancelled`, `isMissed`)** — not a hand-rolled status regex. This is non-negotiable. The Pariox quirk where `status='Completed' AND event_type='Cancelled Treatment'` would silently inflate completed counts otherwise.

Co-treat dedup: the `DISTINCT ON (patient_name, visit_date)` already collapses co-treats to one row for region-level visit math. (Per-clinician views need a different aggregation — out of scope here.)

### Section 4 — Regional Manager Visit Tracking

```
SELECT v.region,
       v.staff_name_normalized AS rm_name,
       DATE_TRUNC(:bucket, v.visit_date) AS period,
       COUNT(*) FILTER (WHERE isCompleted)  AS completed,
       COUNT(*) FILTER (WHERE isMissedOrCancelled) AS missed_cancelled
FROM (
  SELECT DISTINCT ON (patient_name, visit_date, staff_name_normalized) ...   -- same latest-uploaded_at rule
  FROM visit_schedule_data
  WHERE visit_date BETWEEN :period_start AND :period_end
) v
JOIN coordinators c
  ON c.full_name = v.staff_name_normalized
WHERE c.role = 'regional_manager' AND c.is_active = true
```

Earl Dimaano alias must be handled. Two options: (a) add an alias mapping table; (b) update `coordinators.full_name` to "Earl Norbert Dimaano" to match Pariox. Option (b) is a one-row change and avoids a new table. Strong recommendation: (b), and add a `coordinators.aliases text[]` column later if other staff need it.

---

## 3. Schema additions

Minimal, two items:

1. **No new role enum.** Update Yvonne's `coordinators.job_title` from "Director of Payor Relations" to "Director of Payer Relations and Marketing". One row update.
2. **One new `page_permissions` row** for the report page (likely `page_key = 'payer_marketing_report'`, `page_section = 'MARKETING'`). Grant: super_admin, admin, assoc_director. Deny everyone else.
3. **(Optional, recommended)** A `census_monthly_snapshot` table written by a nightly job, so future MoM math doesn't depend on the lossy status-log derivation. Schema: `(month date, region text, active_count int, admissions int, exits int, net_growth int, computed_at timestamptz, primary key (month, region))`. Phase 2 stretch.
4. **(Optional)** Fix Earl Dimaano's `full_name` in coordinators to "Earl Norbert Dimaano" so the visits-join works without a separate alias map. One row update.

---

## 4. UI design

### Placement
- **Sidebar section:** `MARKETING` (Yvonne is Director of Payer Relations *and* Marketing; this is her primary deliverable to payers and to her own team).
- **Page label:** `Payer + Marketing Report`
- **Route key:** `payer_marketing_report`
- **Permissions:** super_admin, admin, assoc_director (Yvonne sees it as admin; Lia, Samantha, Ariel see it as AD; Carla sees it as admin). Deny pod_leader, RM, all coordinator roles, clinicians, telehealth.

### Layout (top-down)

```
┌─ Header bar ─────────────────────────────────────────────────────────────────────┐
│ Payer + Marketing Report         [PeriodSelector: Week | Month | Quarter | Year] │
│ Yvonne Flores, Director of Payer Relations and Marketing                          │
│                                  [Region multi-select: All ▾]  [Export ▾ XLSX|PDF]│
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 1 — Referrals by Region ────────────────────────────────────────────────┐
│  Region   Accepted   Denied   Total   Accept Rate                                 │
│  A        142        87       229     62.0%                                       │
│  B        48         52       100     48.0%                                       │
│  ...                                                                              │
│  Other    7          12       19      36.8%   ⓘ                                   │
│  TOTAL    ...        ...      ...     ...                                         │
│                                                                                   │
│  [Stacked bar chart: Region × Accepted/Denied]                                    │
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 2 — Regional Census Growth (MoM) ──────────────────────────────────────┐
│  ⓘ Census history begins 2026-04-03. Months prior shown as "—".                  │
│                                                                                  │
│  Region   Apr      May      Jun (MTD)                                            │
│           +12 (+8%) -3 (-2%) +6 (+4%)                                            │
│  A        ...      ...      ...                                                  │
│  B        ...      ...      ...                                                  │
│  TOTAL                                                                           │
│                                                                                  │
│  [Line chart per region with month markers]                                      │
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 3 — Visit Status by Region per Month ──────────────────────────────────┐
│  Region | Month | Scheduled | Completed | Cancelled | Missed | Complete Rate    │
│  A        Apr     412         378         24          10       91.7%             │
│  ...                                                                              │
│                                                                                  │
│  [Heatmap: Region × Month, color = complete rate]                                │
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ SECTION 4 — Regional Manager Visit Tracking ───────────────────────────────────┐
│  [Inner tab: Week | Month | Quarter | YTD]                                       │
│  RM             Region  Total  Completed  Missed/Cancelled   Complete Rate       │
│  Earl Dimaano   C       93     86         7                  92.5%               │
│  Hollie Fincher J       469    441        28                 94.0%               │
│  Kaylee Ramsey  H       8      7          1                  87.5% ⚠ low volume  │
│  Uma Jacobs     A       376    351        25                 93.4%               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Period selector
Build a new `PeriodSelector` component that wraps the existing `WeekSelector` UI vocabulary (same pill style, same localStorage persistence via `storageKey`) but adds a top-level mode toggle: **Week / Month / Quarter / Year**. Each mode renders the appropriate jump-back control:
- Week mode -> reuse existing `WeekSelector`
- Month mode -> month + year dropdown
- Quarter mode -> Q1-Q4 + year dropdown
- Year mode -> year dropdown (2026 only for now)

Persist `{mode, anchor}` in `localStorage['edemacare_yvonne_report']`. Section 2 ignores Week mode (MoM is monthly only) and pins itself to monthly regardless of the global selector — clearly indicated with a small "MoM (always)" label.

### Region filter
Multi-select chips, default "All regions". Backed by `REGIONS` constant from `src/lib/constants.js` (the canonical A-V map), plus an "Other / Unknown" bucket for the dirty referral rows.

---

## 5. Export approach

### XLSX export
One workbook with **5 sheets**:
1. `Summary` — period covered, region filter applied, generation timestamp, EdemaCare branding header, data-quality footnote ("Census history begins 2026-04-03").
2. `Referrals by Region`
3. `Census Growth (MoM)`
4. `Visit Status by Region`
5. `RM Visit Tracking`

Built with the existing `xlsx` npm package using the same pattern as `ReportsExportPage.jsx`. Sheet headers bolded, column widths auto-fit, brand red `#D94F2B` accent on the title row. Filename: `EdemaCare_Payer_Marketing_Report_<periodLabel>.xlsx`.

### PDF export
Built with `jsPDF + jspdf-autotable` reusing the `authRequestPdf.js` pattern:
- Header: EdemaCare logo + "Payer + Marketing Report" + period label + Yvonne's name and title.
- One page per section with `autoTable` rendering.
- Footer on every page: page number + legal line `"EdemaCare is a service of AxiomHealth Management LLC"` + generation timestamp.
- Brand color `BRAND_RED = [217, 79, 43]` for accent rules only; body B&W for print legibility.
- Filename: `EdemaCare_Payer_Marketing_Report_<periodLabel>.pdf`.

PDF is "executive ready" — the kind of artifact Yvonne can email a payer rep or take into a quarterly business review without further editing.

---

## 6. Permissions registration

Insert one row into `page_permissions`:

```
page_key:          'payer_marketing_report'
page_label:        'Payer + Marketing Report'
page_section:      'MARKETING'
sort_order:        (next available in MARKETING section)
super_admin:       true
admin:             true   -- Yvonne, Carla, others
assoc_director:    true   -- Lia, Samantha, Ariel
regional_manager:  false
pod_leader:        false
team_member:       false
auth_coordinator:  false
intake_coordinator:false
care_coordinator:  false
clinician:         false
telehealth:        false
marketing_rep:     false  -- explicitly NOT marketing_rep
healthcare_account_executive: false
```

The CLAUDE.md "director" -> super_admin map in `Sidebar.jsx` / `useAuth.canAccess()` handles Liam automatically. Yvonne's `admin` role is enough.

---

## 7. Pushback / clarifying judgment calls (TL;DR Liam, please react)

These are the calls I'd make as your advisor if you said "go with your best judgment":

1. **Census growth = NET (admits − exits), not gross.** Gross is misleading because a region can take 30 admits and lose 35 patients and look like it's "growing" if you only count admits. Net is what shareholders, payers, and ADs all expect.
2. **Section 2 starts 2026-04-03.** History before that doesn't exist at the right grain. We surface this with a banner. I do **not** recommend backfilling from `daily_ops_reports.report_html` audit history — that's audit trail per CLAUDE.md and rewriting it would be falsification. If you want pre-April MoM, we should build it forward from a monthly snapshot table starting now.
3. **"Visits scheduled with a regional manager" almost certainly means visits where the RM is the treating clinician of record** (i.e. their normalized name is in `staff_name`). Kaylee has 8 lifetime visits, which is the signal that this metric will look sparse for RMs who don't carry a personal caseload. I'd recommend we still ship as-is but add a sidebar tooltip: "Counts visits where the RM is the assigned staff member, not all visits in their region."
4. **Use legacy single-letter region codes, not the new state/territory model.** The marketing surface model (`marketing_territories`) is for HAE assignments. Operational data (`intake_referrals.region`, `visit_schedule_data.region`, `coordinators.regions`) all uses the A-V codes. Mixing them would break joins. Yvonne's report is operational data.
5. **No new role enum for "Director of Payer Relations and Marketing".** Update `job_title` only. Adding a new role would cascade into `page_permissions`, every `useAuth.canAccess` site, the Sidebar, and 27 reports. Not worth it for a title display.
6. **Fix Earl Dimaano's coordinator name to match Pariox's "Earl Norbert Dimaano".** One-row update. Avoids needing an alias mapping table and unblocks 93 of his visits showing up in his RM tracking row.

---

## 8. Gating questions for Liam (Phase 2 cannot start until answered)

1. **Census growth math:** confirm NET (admits − exits) vs gross adds. My recommendation: NET.
2. **"Visits scheduled with an RM"** — confirm this means "visits where the RM is the treating staff" (the `staff_name_normalized` join I'm proposing), and NOT "all visits in the RM's region". Sanity check via Kaylee's count of 8.
3. **Census history backfill:** ship with "data starts 2026-04-03" caveat, or invest in a backfill + a `census_monthly_snapshot` nightly job before launch? I lean towards "ship with caveat now, snapshot job in a follow-up sprint."
4. **Dirty region codes on referrals** (I, O, R, L, F, U, K, P, S, OOA, NULL): bucket as "Other / Unknown" with a footnote, or run a normalization pass first? My recommendation: bucket and footnote. Normalizing 300 rows of historical data is its own project.
5. **Yvonne's role/title update:** confirm we update `job_title` to "Director of Payer Relations and Marketing" only (no role enum change). Also confirm spelling — Liam's spec says "Payer", her DB row says "Payor". I'll use "Payer" everywhere.
6. **Earl Dimaano name normalization:** approve renaming `coordinators.full_name` from "Earl Dimaano" to "Earl Norbert Dimaano" to match Pariox? Required for his RM tracking row to populate correctly.

---

**Phase 1 deliverable ends here. Awaiting your answers on questions 1-6.**

Once you sign off, Phase 2 build is roughly:
1. Update Yvonne's `job_title`, fix Earl's `full_name`, add the `page_permissions` row (one migration).
2. Build `src/components/PeriodSelector.jsx` extending the WeekSelector vocabulary.
3. Build `src/pages/dashboard/PayerMarketingReportPage.jsx` with the 4 sections.
4. Build `src/lib/payerMarketingExports.js` for XLSX (sheets) and PDF (autoTable) generation.
5. Wire the route into `App.jsx` and the new sidebar entry.
6. End-to-end smoke test as Yvonne, Lia, and Liam.

Estimated Phase 2 effort: 1.5 days. The `census_monthly_snapshot` job is optional and adds another half day if you greenlight it.
