# Garment sheet → EdemaCare live link

Pushes every garment order from the Google Sheet into the app within
seconds of it being submitted or edited, replacing the manual .xlsx
re-import.

Before this existed, `garment_orders` held a single snapshot taken
2026-06-16 — 220 orders, latest activity Jun 12, **zero delivery dates** —
while the sheet had grown to 297 orders including **35 pending approvals
nobody could see in the app**.

---

## What is already done

- Edge function **`ingest-garment-submission`** is deployed and live at
  `https://kndiyailsqrialgbozac.supabase.co/functions/v1/ingest-garment-submission`
- It currently returns **503 for every request** because the shared
  secret is not set. That is deliberate — it fails closed, so an
  unconfigured endpoint can never accept anonymous writes.

## What a human has to do (about 5 minutes)

### 1. Pick a shared secret

Any long random string. Generate one in Terminal:

```bash
openssl rand -hex 32
```

Keep it somewhere safe. It goes in exactly two places and **should not be
emailed or pasted into chat**.

### 2. Set it in Supabase

Supabase Dashboard → **Project Settings → Edge Functions → Secrets** →
add:

| Name | Value |
|---|---|
| `GARMENT_INGEST_SECRET` | *(the string from step 1)* |

Or via CLI:

```bash
supabase secrets set GARMENT_INGEST_SECRET=paste-the-value-here --project-ref kndiyailsqrialgbozac
```

### 3. Add the script to the sheet

Open the workbook → **Extensions → Apps Script**.

In the Apps Script editor, next to **Files**, click **+ → Script** and
name it `EdemaCare Ingest`. Delete the `function myFunction() {}` stub it
creates and paste in the whole of `garment-apps-script.gs` (next to this
file).

A separate file is deliberate: Apps Script treats every `.gs` file in a
project as one shared namespace, so the new functions are callable from
`Code.gs` without touching anything already there. Nothing existing is
edited except the single line in step 4.

**Then run `whereAmI` before anything else.** Select it from the function
dropdown and click **Run**, then read the Execution log. It reports which
spreadsheet the project is actually bound to, which tabs it can see, and
whether the properties from step 4 are set.

This matters because an Apps Script project is bound to ONE spreadsheet.
A project titled "LE Garment" may be attached to the LE response sheet
rather than the master workbook holding both tabs — in which case the
backfill would quietly push half the orders. `whereAmI` catches that in
five seconds instead of after a 300-row run.

Then **Project Settings → Script Properties** → add:

| Property | Value |
|---|---|
| `EDEMACARE_INGEST_URL` | `https://kndiyailsqrialgbozac.supabase.co/functions/v1/ingest-garment-submission` |
| `EDEMACARE_INGEST_SECRET` | *(the same string from step 1)* |

### 4. Wire it into the existing trigger

Inside the existing `onFormSubmit(e)`, add this as the **first** line of
the body:

```javascript
try { pushToEdemaCare(e.range.getSheet(), e.range.getRow()); } catch (err) { console.error(err); }
```

It is wrapped in try/catch on purpose: if the app is unreachable, the
existing approval email must still go out. The sheet never becomes
dependent on us being up.

### 5. Catch manual edits too

`onFormSubmit` only fires on new form submissions — but auth numbers,
order numbers, garment codes and costs are **typed directly into the
sheet** by the coding and billing team. Those need their own trigger.

In Apps Script → **Triggers** (clock icon) → **Add Trigger**:

- Function: `onGarmentEdit`
- Event source: **From spreadsheet**
- Event type: **On edit**

### 6. Backfill everything at once

In the Apps Script editor, select `backfillAllGarmentOrders` from the
function dropdown and click **Run**. It walks both sheets and pushes
every row. Watch the execution log — it prints a count and any failures.

This replaces the .xlsx upload for the initial load. The upload card in
the app stays as a fallback for when a trigger breaks.

---

## Verifying it works

After step 6, in the app: **Supply Management → Garment Tracker**. Order
count should jump from 220 to ~297 and the pending column should show the
real queue.

To test a single row without waiting for a submission, run
`testPushOneRow` from the function dropdown — it pushes the first data
row of the LE sheet and logs the response.

## What the app will and will not overwrite

The sheet is the source of truth for the **submission** and the
**clinical approval** only.

**Final approval, vendor, tracking number, carrier and delivery
confirmation are captured in the app** and have no column in the
workbook. The ingest function never writes those fields, so a re-push
cannot erase Earl's decisions. If it wrote the whole row every time, the
first form edit would wipe the entire downstream pipeline.

## Recommended follow-up

The current script emails Earl a Google Form edit link for approval.
Once this link is live, **approvals should move into the app** — Earl
approves on the Garment Tracker and the sheet becomes submission intake
only.

If both run in parallel they will disagree within a week: Earl approves
by email, someone transcribes it, and the two drift. The Apps Script
should push submissions *in* and stop trying to manage approvals *out*.
