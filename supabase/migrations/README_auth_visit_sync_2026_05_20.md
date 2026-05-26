# Auth Visit-Count Integrity (2026-05-20)

## Why this exists

Liam reported the Auth Tracker's `visits_remaining` count wasn't decrementing
as visits completed. Phase 1 diagnosis found:

- `auth_tracker` had `visits_authorized`, `visits_used`, `effective_visits_remaining`
  columns and the math function `sync_visits_to_auth()` already existed and was correct
- **But nothing automatically called it** — no trigger on `visit_schedule_data`,
  no scheduled job, only one manual call path from the AuthEditModal save button
- 296 of 450 active auths had drifted (66%), 65 were already over their authorized
  count (compliance / billing exposure), and 11 alerts that should have been firing
  were silent

## Architecture

```
┌────────────────────────────┐         ┌─────────────────────────────┐
│  visit_schedule_data       │         │  scheduled_visits           │
│  (Pariox bulk upload, 15K) │         │  (in-app scheduling, 372)   │
└────────────┬───────────────┘         └─────────────┬───────────────┘
             │                                       │
             │ per-row trigger:                      │ per-row trigger:
             │ trg_visit_data_flag                   │ trg_scheduled_visit_sync
             │                                       │
             ▼                                       │
  ┌─────────────────────┐                            │
  │  auth_sync_pending  │   queue of dirty patients  │
  │  (pname_key PK)     │                            │
  └──────────┬──────────┘                            │
             │                                       │
   sync_pending_auths()                              │
   ─ called at end of upload by UploadsPage          │
   ─ also cron @ */15 minutes (safety net)           │
             │                                       │
             ▼                                       ▼
       ┌──────────────────────────────────────────────────┐
       │     sync_visits_to_auth_for_patient(name)        │
       │  ─ recount visits/evals/reassesses               │
       │  ─ update auth_tracker.visits_used               │
       │  ─ call recompute_auth_sequence(name)            │
       │  ─ refresh auth_tracker.auth_health enum         │
       │  ─ call fire_auth_health_alerts(auth_id) per auth│
       └──────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │  alerts table          │
                  │  ─ auth_over_limit     │ critical
                  │  ─ auth_low_visits     │ high
                  │  ─ auth_expiring       │ medium
                  └────────────────────────┘
                              │
                              ▼
                       AlertsBell badge
```

## auth_health enum

Single column on `auth_tracker` derived from `visits_used` / `visits_authorized` /
`auth_expiry_date`. Replaces juggling three booleans.

| Value | Trigger condition | Alert priority |
|---|---|---|
| `ok` | None of the below | (auto-dismisses prior alerts) |
| `expiring` | `auth_expiry_date - today` in 0..14 days, not low/over | medium |
| `low_visits` | `visits_remaining < 7`, not over | high |
| `over_limit` | `visits_used >= visits_authorized`, not yet past expiry | critical |
| `exhausted` | over limit AND past expiry | (classification only) |

`low_visits` and `expiring` fire **independently** when both apply (Liam's spec).

## Alert scoping rule

- `over_limit` alerts fire for **every** auth in over_limit state, active or
  historical predecessor. Compliance is a fact regardless of sequence position.
- `low_visits` and `expiring` alerts fire **only for currently_active** auths.
  These are predictive operational signals — coordinators only need to act on
  the current renewal timeline.

## Idempotency

`fire_auth_health_alerts` dedups on `(alert_type, metadata->>'auth_id')` where
`is_dismissed = FALSE`. Re-running sync produces no duplicate alerts. When an
auth recovers to `auth_health='ok'`, all open tier alerts for that auth_id are
auto-dismissed.

## Pariox upload batch path

A per-row trigger on `visit_schedule_data` would fire hundreds of times per
weekly upload. Instead the trigger appends `LOWER(TRIM(patient_name))` to
`auth_sync_pending` (a 1-column dedup table). The Pariox upload completion
calls `sync_pending_auths()` which drains the queue, syncing only the
patients actually touched by the upload. A cron job runs `sync_pending_auths()`
every 15 minutes as a safety net in case the upload code path is bypassed.

## DELETE handling

Pariox uses Replace Mode (DELETE-and-replace per date range). The trigger
fires on DELETE too, flagging the OLD patient_name. Re-credits happen
automatically because `sync_visits_to_auth_for_patient` recounts from
current visit_schedule_data state.

## Known limitation: visit allocation across auth sequence

`sync_visits_to_auth_for_patient` writes the **same** total visit count to
every auth in a patient's sequence (bounded by each auth's soc_date/expiry).
For patients with multiple sequenced auths, this produces multiple over_limit
predecessors with the same count when ideally each auth should chronologically
consume visits 1..visits_authorized, with overflow flowing to the next auth.

The existing `recompute_auth_sequence` flags the first non-exhausted auth as
currently_active. For patients where every auth ran over (because the team
kept seeing them after exhausting one auth before the next was approved),
this means there is NO currently_active auth — which is why over_limit
alerts must fire regardless of is_currently_active. Proper chronological
allocation is a Phase 4 task — non-blocking for this fix.

## Tests

See migration `auth_health_enum_and_sync_triggers` for the trigger logic.
End-to-end test suite (insert visit → decrement; delete → re-credit; cross
the low_visits threshold → alert fires; cross over_limit → alert fires;
dedup re-run → no duplicate alerts) lives in the ship commit, passes 5/5.

## Backfill results (one-time, deploy day)

Run: `SELECT sync_visits_to_auth_for_patient(pname) FOR EACH distinct patient`.

Before → after:
- 296 of 450 active auths had drift; backfill bumped 188 up, 29 down,
  added 905 visits across the system to make stored counts match actual
- Worst case: Stepanian Sr (0 → 57 visits_used, auth_health=over_limit)
- Snapshot saved at `_auth_backfill_snapshot_2026_05_20` for audit

## Alert tier counts after backfill

| Tier | Count |
|---|---|
| critical: auth_over_limit | 85 |
| high: auth_low_visits | 142 |
| medium: auth_expiring | 20 |
