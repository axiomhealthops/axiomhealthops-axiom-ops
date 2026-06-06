# Phase 2 Build — Ship Command (staged, not executed)

**Built:** 2026-06-05
**Per Liam's instruction:** files land on the Mac, do NOT push to git. When ready, run the command below from the repo root.

## Suggested ship command

```bash
ship "Reassessments + Evaluations Monitor + new Telehealth Team page

- Repurpose SchedulingAlertsPage.jsx into R+E Monitor (URL slug
  preserved as scheduling-alerts so internal links keep working).
  Two tabs: Reassessments (existing 30/45d engine) + Evaluations
  (new — 48h SLA tracking on census Eval Pending status).
- New TelehealthMonitorPage.jsx with roster scorecard (weekly
  target vs actual, completion %, eval/reassess split), period
  selector (Week/Month/Quarter/YTD), and XLSX export.
- Sidebar: both pages moved/added under CLINICAL DEPARTMENT.
- Schema migrations applied:
    1. add_weekly_visit_target_and_telehealth_clinicians_2026_06_05
       - ALTER coordinators ADD COLUMN weekly_visit_target INT
       - INSERT 5 missing telehealth clinicians (Liz Seely, Abi
         Balogun, Marzina Tejani, Kelsey Downing, Carrie Lucero)
         all role='telehealth', weekly_visit_target=30
       - UPDATE Alexis Giordano weekly_visit_target=30
       - UPDATE page_permissions scheduling-alerts: section ->
         CLINICAL DEPARTMENT, label -> 'Reassessments & Evals'
       - INSERT page_permissions row for telehealth-monitor
         (CLINICAL DEPARTMENT, sort_order 545, all clinical/coord
          roles + admin + super_admin)
    2. eval_pending_sla_breach_alert_engine_2026_06_05
       - census_data BEFORE INSERT/UPDATE trigger stamps
         status_first_seen on Eval Pending transitions
       - AFTER UPDATE trigger auto-dismisses open SLA alerts
         when status moves away from Eval Pending
       - fire_eval_pending_sla_breach_alerts() function, idempotent
       - pg_cron job 'eval_pending_sla_breach_hourly' (:07 each hour)
- Initial fire seeded 9 alerts for chronic Eval Pending patients.
- Uses corrected per-(patient, date) latest-uploaded_at Pariox
  dedup per CLAUDE.md #10.
- All visit classification uses visitMath.js helpers (no
  hardcoded /completed/i checks).

Docs: docs/Reassess_Eval_Telehealth_Design.md"
```

## Files changed

```
M src/components/Sidebar.jsx                          ( +2)
M src/pages/Dashboard.jsx                             ( +4)
M src/pages/dashboard/SchedulingAlertsPage.jsx       (+499 / -157)
A src/pages/dashboard/TelehealthMonitorPage.jsx     (NEW, 312 LOC)
A docs/Reassess_Eval_Telehealth_Design.md            (NEW, design)
A docs/SHIP_COMMAND_2026_06_05.md                    (this file)
```

## Schema changes (already applied to prod via Supabase MCP)

- `coordinators.weekly_visit_target` INT (nullable)
- 5 new rows in `coordinators` (role='telehealth')
- 1 row updated in `coordinators` (Alexis target)
- 1 row updated in `page_permissions` (scheduling-alerts rebrand)
- 1 row inserted in `page_permissions` (telehealth-monitor)
- 2 triggers + 1 function on `census_data`
- 1 function for alert firing
- 1 pg_cron job scheduled hourly

## Verification (post-deploy)

After Vercel deploys, hit:
1. `/scheduling-alerts` — confirms R+E Monitor loads. Click the **Evaluations** tab. 9 SLA breach rows should appear (priority high — all in Region A/B/C/G/J/M/V).
2. `/telehealth-monitor` — confirms Telehealth page loads. Roster should show 6 clinicians. Abi Balogun and Marzina Tejani should be in green band when measured 4-week, yellow band in current week (caught mid-week). Liz Seely's completion % will read 74% — flag her under 80% threshold.
3. AlertsBell — 9 new alerts visible with type `eval_pending_sla_breach`.

## Known follow-ups (not blocking)

- Telehealth clinician emails are placeholder `(initial+lastname)@axiomhealthmanagement.com`. Liam to confirm or HR to UPDATE.
- Liz Seely's 74% completion rate is a real finding the page surfaces — recommend Liam ask Carla about it.
- `dist-rev-2026-06-05/` test build directory in the repo root — Vercel ignores it; can be deleted from your Mac if you want (sandbox can't touch it due to macOS extended attrs).
- Old left-over `dist*` directories (dist, dist-check, dist-final, dist-v3, dist-v4, dist_verify) predate this build.
