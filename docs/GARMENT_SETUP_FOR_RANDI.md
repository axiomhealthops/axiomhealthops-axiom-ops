# Connecting the Garment Order sheet to the EdemaCare dashboard

Hi Randi — this connects the garment order sheet to the ops dashboard so
orders show up there automatically instead of being re-uploaded by hand.

You own the script on that sheet, which is why it needs to be you. It
takes about 10 minutes and you can stop at any checkpoint.

**Nothing here changes how the sheet works today.** The order form, the
approval emails and everything the team already does keep working exactly
as they do now. This only adds a copy going out to the dashboard.

Liam will send you two things before you start:
- **the code** (a long block of text)
- **the password** (a long random string — keep it out of email if you can;
  a phone call or text is fine)

---

## Step 1 — Open the script editor

1. Open the sheet **_2026 MASTER Garment Order Form (Responses)_**
2. In the top menu click **Extensions**
3. Click **Apps Script**

A new browser tab opens with a code editor. The project is called
**LE Garment**. On the left you'll see a **Files** list with `Code.gs`
in it.

> Don't worry that it says "LE Garment" — that's just an old name. It is
> connected to the whole sheet, not one tab.

---

## Step 2 — Add a new file for the new code

1. Next to the word **Files**, click the small **+**
2. Choose **Script**
3. Type the name `EdemaCare Ingest` and press Enter

The editor now shows a nearly empty file containing:

```
function myFunction() {
}
```

4. Click anywhere in that code, select all of it (**Cmd+A** on Mac,
   **Ctrl+A** on Windows) and delete it
5. Paste in **the code Liam sent you**
6. Click the **save icon** (the little floppy disk near the top), or
   press **Cmd+S** / **Ctrl+S**

> You have not changed any existing code. You added a new file alongside
> it.

---

## Step 3 — Run the check, and approve access

Near the top of the screen there's a dropdown that lists function names.

1. Click it and choose **`whereAmI`**
2. Click **Run**

Google will now ask for permission. This is normal — it happens the first
time any script runs.

3. Click **Review permissions**
4. Choose your own Google account
5. You'll see a red warning: **"Google hasn't verified this app"**
6. Click **Advanced** (small grey link, bottom left)
7. Click **Go to LE Garment (unsafe)**
8. Click **Allow**

> The warning looks alarming but it only means the script wasn't
> published publicly through Google. It's our own script on our own
> sheet. "Unsafe" here means "Google didn't check this", not "something
> is wrong".

After a few seconds, click **Execution log** (top right) to see the
result.

### CHECKPOINT — send Liam what the log says

You're looking for lines like:

```
Spreadsheet : _2026 MASTER Garment Order Form (Responses)
Tabs (11): LE garments | UE garments | LE Form | ...
OK   "LE garments" found, 289 data rows
OK   "UE garments" found, 12 data rows
```

**Copy that whole log and send it to Liam before going further.** If it
says `MISS` on either line, stop here — something needs adjusting first.

---

## Step 4 — Add the two settings

1. On the far left, click the **gear icon** (Project Settings)
2. Scroll to the bottom, to **Script Properties**
3. Click **Add script property**
4. Add the first one:
   - **Property:** `EDEMACARE_INGEST_URL`
   - **Value:** `https://kndiyailsqrialgbozac.supabase.co/functions/v1/ingest-garment-submission`
5. Click **Add script property** again
6. Add the second one:
   - **Property:** `EDEMACARE_INGEST_SECRET`
   - **Value:** *the password Liam sent you* — paste it exactly, no spaces
     before or after
7. Click **Save script properties**

---

## Step 5 — Test one order

1. Click the **< >** icon on the far left to go back to the code
2. In the function dropdown, choose **`testPushOneRow`**
3. Click **Run**
4. Open **Execution log**

### CHECKPOINT

You want to see:

```
test push returned HTTP 200
```

- **200** means it worked. Carry on.
- **401** means the password doesn't match — check for a typo or a stray
  space in Step 4.
- **503** means Liam hasn't finished his half yet. Tell him and wait.

**Don't continue until you see 200.**

---

## Step 6 — Send everything across, once

This copies all the existing orders over. It takes about a minute.

1. In the function dropdown, choose **`backfillAllGarmentOrders`**
2. Click **Run**
3. Wait. The log updates as it goes.

When it finishes you'll see something like:

```
backfill complete - sent 297, skipped 4, failed 0
```

Send that line to Liam.

> "Skipped" is normal — those are blank or incomplete rows.
> "Failed" should be 0. If it isn't, send Liam the log.

---

## Step 7 — Keep it updating automatically

Two small pieces so it stays current without anyone re-running anything.

### 7a. New form submissions

1. In the **Files** list, click **`Code.gs`**
2. Find the line that starts `function onFormSubmit(e) {`
3. Click at the very end of that line and press **Enter** to make a new
   blank line directly beneath it
4. Paste this in:

```javascript
  try { pushToEdemaCare(e.range.getSheet(), e.range.getRow()); } catch (err) { console.error(err); }
```

5. Save (**Cmd+S** / **Ctrl+S**)

> This sits inside the function that already runs whenever someone
> submits the form. If the dashboard is ever offline, the `try` around it
> means your approval emails still go out exactly as normal.

### 7b. Changes typed into the sheet

Auth numbers, order numbers and costs get typed straight into the sheet
rather than submitted through the form, so those need their own trigger.

1. On the far left, click the **clock icon** (Triggers)
2. Click **+ Add Trigger** (bottom right)
3. Set:
   - **Choose which function to run:** `onGarmentEdit`
   - **Select event source:** `From spreadsheet`
   - **Select event type:** `On edit`
4. Click **Save**

You may be asked to authorize once more — same steps as before
(**Advanced → Go to → Allow**).

---

## Done

From now on, every new order and every edit flows into the dashboard
within a few seconds.

**Tell Liam you've finished** and he'll confirm the orders are showing up
correctly on his end.

---

## If something goes wrong

Nothing here can damage the sheet or lose data — the new code only
*reads* from it and sends a copy out.

If you get stuck, send Liam:
- which step number you're on
- a screenshot of the screen
- whatever the **Execution log** says

To undo everything: delete the `EdemaCare Ingest` file, delete the line
you added in Step 7a, and delete the `onGarmentEdit` trigger. The sheet
returns to exactly how it was.
