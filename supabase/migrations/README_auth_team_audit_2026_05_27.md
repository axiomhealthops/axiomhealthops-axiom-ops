# Auth Team Workflow Audit (2026-05-27)

## Why this exists

Liam reported two problems from the Authorization team:

1. **Page-purpose confusion.** Auth team can't tell what each of the four AUTHORIZATION sidebar entries is for (Auth Over Limit, Auth Dashboard, Auth Tracker, Auth Renewals).
2. **Data not propagating.** When a coordinator updates a patient's authorization or uploads a new auth letter, the change appears on the patient chart but does NOT update on Auth Tracker, Auth Dashboard, or Auth Over Limit.

Problem 2 is the same class of issue as the Phase 3 rollout: there is a master sync function (`sync_visits_to_auth_for_patient`) that nobody is calling from the relevant frontend write paths. Phase 3 fixed the visit-data → auth-tracker sync. This audit fixes the auth_tracker-edit → auth-tracker-state sync.

---

## Section A — The four pages (current state)

| Page | File | Underlying table | Purpose (what it does today) |
|---|---|---|---|
| **Auth Over Limit** | `AuthOverLimitPage.jsx` | `auth_tracker` filtered to `auth_health='over_limit'` | Read-only triage: shows 85+ over-limit auths with overage size, region, assignee. XLSX export. |
| **Auth Dashboard** | `AuthCoordDashboard.jsx` | `auth_tracker` + `auth_renewal_tasks` + `coordinator_activity_log` | Personal "my queue" landing page for an individual coordinator. KPI widget, my-assignments, my activity log. |
| **Auth Tracker** | `AuthTrackerPage.jsx` | `auth_tracker` + `auth_documents` | Master CRUD database. All auths, full edit form, document upload (PDFs), AI extraction. |
| **Auth Renewals** | `AuthRenewalsPage.jsx` | `auth_renewal_tasks` (different table) | Task-list view of expiring/exhausting auths needing a renewal action. |

**Why the team is confused:** "Dashboard" and "Tracker" are interchangeable nouns. "Over Limit" sounds like a state but reads like a separate workflow. None of the labels tell a coordinator *when* they should be on that page.

---

## Section B — Data integrity break (root cause)

`auth_tracker.visits_used` is the source of truth for `auth_health` (the column that drives Auth Over Limit and all alert tiers). It can drift in two ways:

- **Visit-data drift:** `visit_schedule_data` or `scheduled_visits` rows change. **Already fixed** in Phase 3 via per-row triggers + `auth_sync_pending` queue + `sync_pending_auths()` drain + 15-min cron.
- **Auth-tracker drift:** A coordinator edits `visits_authorized` (e.g. uploads a new auth letter that approves 48 visits instead of 24), or inserts a brand-new auth_tracker row. The math changes but `visits_used` is never recounted from `visit_schedule_data`, and the cascading flags (`auth_health`, `effective_visits_remaining`, alerts) are never refreshed.

There are **five frontend write paths to `auth_tracker`**. Pre-audit state:

| # | File | Function | `recompute_auth_sequence`? | `sync_visits_to_auth_for_patient`? |
|---|---|---|---|---|
| 1 | `AuthTrackerPage.jsx` | `AddEditModal.handleSave` (L336) | ✓ | ✗ |
| 2 | `AuthTrackerPage.jsx` | `DocumentPanel.handleUpload` (L171) — writes `auth_documents` only | — | ✗ |
| 3 | `AuthCoordDashboard.jsx` | `EditModal` save (L107) | ✓ | ✗ |
| 4 | `AIDocExtractor.jsx` | Save flow (L323) — inserts new auth with `visits_used=0` | ✓ | ✗ |
| 5 | `PatientCensusPage.jsx` | Edit save (L480/L512) | ✗ | ✗ |

PatientCensusPage is the worst — it writes the full auth record but invokes neither sync function. Its writes will only propagate when the 15-min `sync_pending_auths` cron runs, and only if the visit data also changed (which it usually didn't).

This is exactly the user-reported symptom: "I updated the auth on the patient chart, but Auth Tracker / Auth Dashboard still show the old numbers." The patient chart edit (PatientCensusPage) wrote `visits_authorized=48`, but `auth_health` stayed `over_limit` because `visits_used` was never recounted and the enum was never recomputed.

---

## Section C — Fix specification

### C.1 — Add explicit sync calls to every auth_tracker write path

Every frontend write to `auth_tracker` must call **both** of these RPCs, in order, after the write succeeds:

```javascript
await supabase.rpc('sync_visits_to_auth_for_patient', { p_patient_name: name });
await supabase.rpc('recompute_auth_sequence',         { p_patient_name: name });
```

`sync_visits_to_auth_for_patient` recounts `visits_used` from current `visit_schedule_data` + refreshes `auth_health` enum + fires alerts. `recompute_auth_sequence` then chains predecessor → successor and updates `is_currently_active`. Both must run; sync alone doesn't reorder the sequence, recompute alone doesn't recount visits.

Note: `sync_visits_to_auth_for_patient` already calls `recompute_auth_sequence` internally per the Phase 3 spec. The explicit second call is belt-and-suspenders for any future change where the sync function might be reduced to pure recount. Cost is one extra RPC round-trip (~30ms), worth the protection.

### C.2 — Sidebar relabeling (DB-side)

Update `page_permissions.page_label` to be job-task-oriented:

| Page key | Old label | New label | Tooltip |
|---|---|---|---|
| `auth-coordinator` | Auth Dashboard | My Auth Queue | Your personal queue — start your day here |
| `auth` | Auth Tracker | All Authorizations | Master database — search, edit, upload any auth |
| `auth-over-limit` | Auth Over Limit | Compliance: Over Limit | Patients exceeding their authorized visit count |
| `auth-renewals` | Auth Renewals | Renewal Tasks | Auths expiring soon — submit renewals here |

This is the minimum-risk consolidation. No code refactor, just labels.

### C.3 — Page header banners (frontend)

Each of the four auth pages gets a one-line banner under the page title explaining its job-to-be-done, so the team has zero ambiguity about which page they're on:

- **My Auth Queue:** "Your assigned auths needing action today. Use the inline status toggle to advance pending → submitted → active."
- **All Authorizations:** "The full authorization database. Search, edit, upload PDFs, or create a new auth from an uploaded letter via AI Extraction."
- **Compliance: Over Limit:** "Patients whose visit count exceeds their authorized total. Triage and prioritize emergency renewals from here."
- **Renewal Tasks:** "Auths expiring in ≤14 days or with ≤7 visits remaining. Complete renewal tasks and update status."

### C.4 — Phase 5 candidates (not in this audit)

- Collapse Auth Over Limit into Auth Tracker as a filter chip — same underlying table.
- Single "Authorization" landing page with tabs (My Queue | All Auths | Compliance | Renewals).
- Real-time data subscription via Supabase Realtime so all four pages reflect changes from any other page without manual refresh.

Defer these to a dedicated UI refactor. Out of scope for the compliance fix.

---

## Section C.5 — My Day landing page (added in same ship)

A new "My Day" page sits at the top of the AUTHORIZATION section as the default landing page for auth coordinators. It combines all four task sources into a single prioritized list with a clear daily-zero metric.

**Task sources (per coordinator, filtered by `assigned_to`):**
1. `auth_renewal_tasks` where `task_status` IN ('open', 'in_progress')
2. `auth_tracker` where `auth_status` IN ('pending', 'submitted')
3. `auth_tracker` where `auth_health` IN ('over_limit', 'low_visits')
4. `auth_tracker` where `auth_expiry_date <= today + 7 days`

Tier classification (descending urgency):
- **CRITICAL:** over_limit, expiring in ≤3 days, expired, urgent renewal task
- **HIGH:** low_visits, expiring in 4-7 days, high-priority renewal task
- **OPEN:** pending/submitted auths, normal-priority renewal tasks

**Daily snapshot** stored in `coordinator_daily_metrics` (new table). On the first page load of the day, the EXACT set of currently-open task keys is recorded in `start_task_keys TEXT[]` (composite keys: `'rt:<id>'` for renewal tasks, `'at:<id>'` for auth_tracker rows). Subsequent loads compute precise set-based diffs:

| Metric | Formula |
|---|---|
| `cleared_from_morning` | `\|start_task_keys \ current_keys\|` — started open, now closed |
| `remaining_from_morning` | `\|start_task_keys ∩ current_keys\|` — started open, still open |
| `new_today` | `\|current_keys \ start_task_keys\|` — arrived after first load |
| `total_open_right_now` | `remaining_from_morning + new_today` = `current_keys.length` |

The "% cleared" progress bar reflects what was actually closed FROM this morning's queue, unaffected by new tasks arriving mid-day. The metric is gameable-resistant on two axes:

1. **No "mark done" button** — a task only drops off when its real underlying status changes (auth_status, task_status, auth_health).
2. **Exact set tracking** — a coordinator can't game the count by waiting for new tasks to roll in to inflate the denominator. The denominator is locked at start-of-day.

There are two zero states with different messages:
- **"This morning's queue cleared"** — `remaining_from_morning = 0` but `new_today > 0`. Green-light, but acknowledge the new work that came in.
- **"Inbox zero. Day complete."** — `total_open_right_now = 0`. The fully-clean state.

**Default landing for auth_coordinator role** changed from `auth-coordinator` to `my-day`. Existing pages remain accessible.

**Migration:** `supabase/migrations/20260527130000_coordinator_my_day.sql` — creates the snapshot table (including `start_task_keys TEXT[]`), RLS policies (coordinators see own row; super_admin/admin/director see all for future trend view), and the page_permissions entry.

## Section D — What this audit does NOT fix

- **Page consolidation.** Four pages remain, just relabeled. A unification refactor is Phase 5.
- **Cross-page real-time refresh.** If Coordinator A edits in Auth Tracker, Coordinator B viewing Auth Dashboard still sees stale data until they refresh. The data layer is now consistent — but the UI subscriptions aren't. Phase 5.
- **Chronological visit allocation across sequenced auths.** Carried over from the Phase 3 README as a known limitation. Still Phase 4.

---

## Verification after deploy

1. Open Auth Tracker, edit a patient's `visits_authorized` from 24 → 48, save.
2. Within 1 page refresh: Auth Dashboard should show updated `effective_visits_remaining`, Auth Over Limit should drop the patient if they were over before, AlertsBell badge should update.
3. Repeat from PatientCensusPage (the historically broken path).
4. Repeat from AIDocExtractor (upload a PDF and let AI extract a new auth row).
5. Confirm `auth_health` on the affected `auth_tracker` row matches the math (over_limit / low_visits / expiring / ok) before and after.
