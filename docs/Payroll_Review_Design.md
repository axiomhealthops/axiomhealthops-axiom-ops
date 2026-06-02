# Payroll Review & Audit — Phase 1 Design (REV 2)

**Status:** Re-scoped after discovery of existing axiom-payroll portal. Awaiting Liam sign-off before any code or schema change.
**Author:** Claude (top-0.1% advisor mode), 2026-06-01, revised 2026-06-02 after Liam's Q&A
**Owner:** Liam O'Brien, Director of Operations
**Revision:** v2 — original v1 underestimated what was already built. The CEO's "mileage portal" is in fact a near-complete payroll system. This rev is a corrective course change.

---

## 0. TL;DR — read this first, the situation has changed

When you said "mileage portal," I assumed a single-purpose mileage logger. **It isn't.** `axiom-payroll.web.app` is a near-complete payroll system your CEO has already built. It already does the import work I was proposing to build. Specifically, the portal already has:

- **Paylocity PDF import** — both Pre-Process Payroll Register and per-day Time Card PDFs are parsed into a hours table with categories (Regular, OT, PTO, Training, Documentation, Meaningful Work, Meetings, Level Pay, Bonus)
- **Mileage submissions** with MileIQ / Stride / Everlance / screenshot upload OR manual entry, weekly, with a review queue
- **Visit data upload** (CSV/XLSX/PDF with column mapping) and a visits table with patient, discipline, miles, rate, verified flag
- **Hours & Approvals workflow** — pending/approved/denied per category
- **Mileage Review queue** — pending/approved/rejected per submission
- **Pay Per Visit Report**, **Mileage Reimbursement Report**, **Payroll Report** with CSV + Paylocity CSV + 1099 CSV export
- **Bonus & Retainer logic** — preceptor retainers, productivity bonuses with calculate-and-approve workflow
- **LS Level Pay Rates** (LS 1-5, PT/OT, PTA/OTA, Assessment, Hourly), **Rate Matrix (Role × Visit Type)**, **Virtual Visit hourly rates**, **PTO/Vacation rate**, **FLSA blended-rate OT logic**
- **Pay Periods History** with auto-tagging from Paylocity/1099 export
- **Analytics & Trends**, **Per-Clinician Metrics**, **Productivity vs Weekly Goal**
- **Firebase Auth** with owner/admin/pending approval gating

**This means 80% of what I scoped in rev 1 is already done.** What is missing — and what you actually need — is the **variance/audit flagging layer**. The portal collects all three data streams but doesn't compare them to flag clinicians whose clock hours don't match their visit volume. That is the gap.

**Hard recommendation:** do **not** rebuild Paylocity import or mileage import or visits import inside EdemaCare Ops. That work is done. Instead, pick one of the three options below and execute. My strong recommendation is **Option A (build the variance layer inside the portal, with your CEO)** — it's the cheapest, fastest, and avoids data duplication.

**Action you should take this hour:** message your CEO with this doc. He built the portal — he needs to be in the conversation before any code is written, period.

---

## 1. Three options for where the audit layer lives

| | A. Add to axiom-payroll portal | B. Mirror into EdemaCare Ops | C. Hybrid (portal pushes, ops consumes) |
|---|---|---|---|
| Where the new "Payroll Review" screen lives | Inside the portal (new tab) | Inside `edemacare-ops` (new section) | Inside `edemacare-ops` (read-only mirror) |
| Who builds it | CEO (in Claude, same as the rest of the portal) | You / me, in this repo | Both — CEO writes the push, I write the consumer |
| Data flow | All three sources already in Firestore; just read + flag | Pull Firestore → Supabase nightly via Edge Function (Firebase Admin SDK) | Cloud Function in portal POSTs weekly snapshot to an Edge Function in this repo |
| Pariox join | Portal needs a Pariox import OR a Firestore sync from `visit_schedule_data` | Already in Supabase | Already in Supabase |
| Duplication | None | Yes (portal data mirrored to Supabase) | Snapshot-only (lighter) |
| Auth | Firebase Auth (already gated) | Existing EdemaCare Ops `page_permissions` | Existing EdemaCare Ops `page_permissions` |
| Effort | **~2 days** of CEO time | **~5-7 dev days** (Firebase Admin SDK + reconciliation engine + UI) | **~3-4 days** split between CEO and me |
| Pros | Cheapest. No duplication. Tool lives where the data already lives. CEO is already in this codebase daily. | Audit lives in your ops dashboard alongside everything else you already use. | Decouples portal from ops repo. Good if CEO's involvement is uncertain. |
| Cons | Requires CEO bandwidth. You'd be navigating to a separate URL to run the audit. | Two copies of payroll data — a real liability if they drift. Firebase Admin SDK key handling. | Most moving pieces. Two teams have to ship together. |

**My recommendation: A.** It's the cleanest. The data already lives there. Your CEO already maintains it. Adding a "Variance Audit" tab is a 1-2 day exercise.

**Pick B only if** you've decided the portal is not the long-term home for payroll and you want EdemaCare Ops to gradually absorb its functionality. That's a real strategic decision, not a tactical one.

**Pick C if** CEO can give you a Cloud Function trigger but not a full audit UI build.

---

## 2. Liam's answers to v1 questions, with my response

| Q | Your answer | What it means |
|---|---|---|
| Q1 — mileage app | "Not an app, portal built by CEO in Claude — axiom-payroll.web.app" | **This reframes everything** (see §0). Not a mileage tracker — a payroll system. |
| Q2 — Paylocity API access | (no answer) | I'll assume you have not yet provisioned API credentials. The portal already imports Paylocity via PDF upload, so API access is **no longer on the critical path**. Defer it. |
| Q3 — visit duration assumption | "Minimum 60 minutes per visit" | Locked. Reconciliation = (completed visits × 60 min) = minimum expected clinical-time hours. Real clock hours that fall below this are fine; clock hours **above** by N% are the flag. (Plus mileage/no-visits and PTO/visits-same-day flags from §5.) |
| Q6 — existing workflow | "Paylocity report → compare to Pariox Activity report (clinician completed visits) → once approved, mileage is added on" | Sequential, two-stage approval. Hours approve first, mileage approves after. The portal's existing screens already separate Hours & Approvals from Review Mileage, which matches this. The audit layer should sit **between Paylocity import and Hours approval** — flag suspicious rows before you approve them. |

---

## 3. What the variance/audit layer actually needs to do

(Same logic whether it lives in the portal, in EdemaCare Ops, or in a hybrid.)

### 3.1 Inputs

- **Paylocity** clock hours per clinician per week, by category — *already imported into the portal's Hours table*
- **Pariox** completed visits per clinician per week, deduped via `dedupEncounters()` in `src/lib/visitMath.js:82` — lives in `visit_schedule_data` in Supabase
- **Mileage** per clinician per week — *already in the portal's Mileage Review queue*

### 3.2 The single core calculation

```
expected_clinic_hours[clinician, week] =
    count(completed_visits in week) × 60 min
```

(Q3 locked at 60 min/visit minimum.)

```
variance_pct[clinician, week] =
    (paylocity_regular_hours - expected_clinic_hours) / expected_clinic_hours
```

This is the headline number. Above +20% = flag.

A few wrinkles to handle:
- **PTO + visits same day** — if PTO hours > 0 on a day where Pariox has completed visits, flag (this catches double-dipping)
- **Mileage with no visits** — if mileage > 0 on a day with zero completed visits, flag
- **OT with flat-or-down volume** — OT hours > 0 AND WoW completed-visits change ≤ 0%, flag
- **Zero visits, no PTO, no training** — clinician absent without leave, flag
- **Training hours** — already a category in the portal's Hours table; treat training time as "clock hours used" against the expected-clinic-hours bucket (training time legitimately reduces visit hours)

### 3.3 Flag rules table (proposed, editable)

| Rule | Trigger | Severity | Dollar-impact calc |
|---|---|---|---|
| `hours_variance_high` | Reg+OT clock hrs > (visits × 60 min) by ≥20%, excluding PTO/Training/Meetings hours | hard | (clock_hrs − expected_hrs) × hourly_rate |
| `pto_with_visits_same_day` | PTO claimed AND ≥1 completed visit on same day | hard | day's PTO + day's visit revenue (potential double-pay) |
| `mileage_no_visits` | Mileage > 0 AND completed visits = 0 on a day | hard | miles × portal mileage rate |
| `ot_no_volume` | OT > 0 AND visits WoW change ≤ 0% | hard | OT_hrs × rate × 1.5 |
| `zero_visits_no_leave` | 0 completed visits, 0 PTO, 0 Training, 0 Meetings in week | hard | full clock hrs × rate |
| `mileage_outlier` | Claimed miles > 2× clinician's 8-week rolling median | soft | excess miles × portal rate |
| `unverified_visits` | Imported visits with `verified=false` AND used in revenue calc | soft | unverified count × $230 |

Each flag carries a $ at-risk so Liam can see "$ at risk this period" as the headline KPI.

### 3.4 What the UI screen needs

A weekly/biweekly table, one row per clinician, columns:

```
Clinician | Reg hrs | OT | PTO | Training | Visits | Expected hrs | Variance % | Mileage | Flags | $ at risk | Status
```

Row click → drawer with the same day-by-day breakdown described in rev 1 (§5.2), showing each day's clock-vs-visit reconciliation. Approve / Hold / Send back to clinician actions, with a notes field that gets logged.

**Critical:** the screen should be **read-only on Paylocity values and mileage values** — never write back. Updates flow upstream to the source (portal or Paylocity), not downstream from the audit layer. This is a hard constraint: an audit tool that modifies its source is no longer an audit tool.

---

## 4. Effort estimate (revised — much smaller)

### Option A — in-portal (recommended)
| Piece | Owner | Effort |
|---|---|---|
| Pariox import into portal Firestore (one-time CSV upload of visits using existing visit-upload tab, OR small Cloud Function that reads from Supabase) | CEO | 0.5 day |
| `payroll_flag_rules` collection + seed | CEO | 0.5 day |
| Variance computation logic (the math in §3.2) | CEO | 0.5 day |
| New "Variance Audit" tab UI (table + drawer + approve/hold/send-back) | CEO | 1 day |
| **Total** | | **~2.5 days of CEO time** |

### Option B — in EdemaCare Ops (read-from-Firestore)
| Piece | Owner | Effort |
|---|---|---|
| Firebase Admin SDK setup + service-account credential | Me + Liam | 0.5 day (credential is the slow part) |
| Edge Function that pulls Firestore collections nightly | Me | 1 day |
| New Supabase tables to mirror payroll data (5 tables; rev 1 §3.4 schema, minus `clinician_payroll_map` which lives in portal) | Me | 0.5 day |
| Sidebar wiring + PAYROLL section + page_permissions | Me | 0.5 day |
| Variance engine | Me | 0.5 day |
| Table + drawer UI | Me | 1.5 days |
| Approve/Hold/Send-back actions (write back to Firestore via Edge Function) | Me | 1 day |
| **Total** | | **~5.5 dev days** |

### Option C — hybrid
| Piece | Owner | Effort |
|---|---|---|
| Cloud Function in portal that writes weekly snapshot to a Supabase endpoint | CEO | 1 day |
| Supabase Edge Function receiver + snapshot table | Me | 0.5 day |
| Sidebar/page wiring + UI | Me | 2 days |
| **Total** | | **~3.5 days split between us** |

---

## 5. Risks I want flagged before we start

1. **Duplication risk.** Option B mirrors payroll data into Supabase. If Firestore changes and the mirror doesn't (or vice versa) you have two sources of truth — exactly the problem the audit tool is supposed to detect, ironically. Option A avoids this entirely.
2. **Pariox visit duration is still an assumption.** Q3 sets a minimum at 60 min. The "Variance %" flag is therefore an *estimate*; the day-by-day drawer should label it "Estimated" not "Actual". This is a defensible posture for review-and-discuss but not for discipline-without-discussion.
3. **Wage-and-hour exposure (FLSA).** I'm dropping the `hours_variance_low` rule from rev 1 — that's an HR/legal concern, not an operations concern, and putting it in your hands surfaces a duty to act. Push that to HR if/when you have one. Your `hours_variance_high` rule is the right one for your seat.
4. **The portal has unverified visits in its visits table** (column: `Verified`). The audit should distinguish between flagging "clinician visit unverified" vs "real variance." Surface unverified count as a soft flag, not a hard one.
5. **CEO bandwidth.** Option A depends on it. If your CEO is too busy to spend 2-3 days on this in the next 2-3 weeks, default to Option B and accept the dev cost.
6. **Paylocity PDF parsing fragility.** The portal parses Paylocity PDFs. PDF parsers break when Paylocity ships a new report format. Owns the same risk regardless of option, but worth noting.
7. **Pay cadence.** Portal already has "Pay Period" concept. Use the portal's pay-period dates as the authoritative time window — don't compute a separate Sun-Sat in this audit layer.
8. **The 22 `@axiomhealthmanagement.com` coordinator rows** in Supabase stay as-is per `CLAUDE.md`. The portal already has its own employee table with Paylocity IDs — that's the authoritative mapping table for payroll, not `coordinators`.

---

## 6. What I need from Liam to greenlight

A reply of the form:

> "Option A — I'll loop in the CEO."
> "Option B — build it inside EdemaCare Ops, mirror Firestore."
> "Option C — let me ask the CEO if he can push snapshots."

Plus, if Option B or C:
- Confirm we can get a Firebase service-account key for the `axiom-payroll` project (you or CEO generates it in [Firebase Console → Project Settings → Service Accounts](https://console.firebase.google.com/project/axiom-payroll/settings/serviceaccounts/adminsdk))

If Option A — I'm out of the build path. I'd be available for a code review on what CEO produces, but the work happens in his Claude instance against the Firebase project.

---

## 7. What to tell your CEO if you go with Option A

> "Liam wants a weekly variance/audit screen in the portal. Three sources are already in the portal (Paylocity hours, mileage, visits) plus Pariox visits in our Supabase. The variance flag math is in `docs/Payroll_Review_Design.md` §3 of the EdemaCare Ops repo. Goal: one screen, one row per clinician per period, flag rows where clock hours don't match visit volume. ~2.5 days. Can you scope?"

That message + this doc is enough for him to start.

---

## 8. Things I am *not* recommending you do

- ❌ Build Paylocity API integration in EdemaCare Ops. Portal already handles Paylocity import via PDF. API would be a v3 nice-to-have.
- ❌ Build mileage import in EdemaCare Ops. Portal already does it.
- ❌ Build a second Hours & Approvals workflow in EdemaCare Ops. Portal already does it.
- ❌ Rename `axiomhealth*` identifiers in this repo per `CLAUDE.md`.
- ❌ Start any of this without first looping in the CEO. He owns the portal.

---

*This is a design doc, not an implementation plan. No code, schema, or config has been changed in `~/Documents/GitHub/edemacare-ops`. The working tree is untouched as of 2026-06-02.*
