# Auth Request Form — Design (Phase 1)

**Status:** Draft for Liam review — **NO CODE CHANGES YET**
**Owner:** Liam O'Brien (Director of Ops)
**Author:** Claude (Phase 1 design)
**Last updated:** 2026-06-03 (rev 2 — scope broadened to all payors per Liam)
**Phase 2 build:** blocked until Liam answers the 6 gating questions in §7.

---

## 0. TL;DR (read this if nothing else)

We're replacing the static Humana/CarePlus/FHCP PDF with an in-app form that
works **across all payors EdemaCare services** — Humana, CarePlus, Florida
Health Care Plans, Aetna (Commercial / Medicare), Cigna (Commercial /
Medicare / PPO), Devoted Health, FENYX, Health First, Simply, Medicare
(traditional), Private Pay, plus an "Other" manual-entry option. The form
auto-populates from `intake_referrals` + `auth_tracker` + `census_data`,
lets the auth team pick CPT codes from a curated list, and produces a
polished PDF (jsPDF, client-side) carrying the new EdemaCare logo. New page
`auth-request-form` sits in the AUTHORIZATION sidebar section between
"Renewal Tasks" and "All Authorizations".

**Three material concerns I want pushed on before we build:**

1. The CPT list Liam provided is the **2025** code set and we're now in
   **June 2026**. Several CPT codes change annually; shipping a stale code
   risks denials. Recommend: ship Liam's list as-is, tag each code with
   `cpt_year = 2025`, **and put a 1-week task on someone to verify 2026
   codes via AMA / Optum before public rollout.** Don't have me cross-
   reference the 2026 list myself — I don't have authoritative source access.
2. **"All payors" includes payors that don't require prior authorization.**
   Specifically: (a) PPO plans (your codebase already treats them as
   auth-not-required — `AuthTrackerPage.jsx` short-circuits `isPPO(rec)` to
   green), (b) Traditional Medicare for outpatient PT/OT (providers bill
   direct, no prior auth needed), (c) Private Pay (no payor at all). The
   form should still be available for these — but it generates a "Service
   Order / Coverage Notification" instead of a "Prior Auth Request", and
   the UI shows a banner explaining why. We don't want auth coordinators
   wasting time on PPO prior-auth submissions that will be ignored.
3. Different payors want different fields in reality. Humana asks for
   member ID + ICD-10 + CPT + visits. Simply (Medicaid MCO) also wants
   Medicaid ID + MSP screening + sometimes the referring physician's
   Medicaid PIN. Aetna Medicare wants the MA plan number formatted a
   specific way. Two ways to handle this: (a) one form template with
   conditional sections that hide/show based on the payor picked, or
   (b) per-payor templates. **I recommend (a) for v1** — cheaper to
   maintain, less drift. Add per-payor overlays only when a specific
   payor rejects the unified layout.

**Heads-up I am NOT going to do without you saying so:**

- I'm not going to re-scrape the static PDF — it lives in a previous
  Cowork session's uploads folder and is **outside this session's mounts**.
  The field map in §2 is built from (i) `auth_tracker` columns, (ii) industry-
  standard Humana auth request layouts, and (iii) what your team already
  captures in `intake_referrals`. **Before Phase 2 ships, drop the PDF into
  `docs/inputs/` and I'll do a field-by-field reconciliation pass.** Flagged
  as Question #1.

---

## 1. Why we're doing this

| Lever | Today (static PDF) | After v1 |
|---|---|---|
| Time per form | ~6–10 min hand-entry per request | <2 min: pick patient, CPT codes, click Export |
| Resubmission rate | Driven by missing fields, illegible handwriting, wrong CPTs | Validation blocks submit on missing required fields; CPT list curated |
| Auditability | PDF lives in a network folder, no link to `auth_tracker` | Every form FK'd to `auth_tracker_id`, versioned, append-only after `sent` |
| Brand | Old AHM PDF | EdemaCare logo + brand color (#D94F2B), legal footer |
| PCP reaction | "What services does EdemaCare even do?" | One comprehensive form with full CPT menu by specialty |

Liam's stated goal verbatim: *"standardized authorization request form that
accurately reflects services EdemaCare provides, aligns with CPT codes
authorized and billable under our Humana contract, reduces delays /
resubmissions, and provides PCP offices with a clear comprehensive list of
services."*

---

## 2. Field map — current PDF → new form → data source

(Inferred from `auth_tracker` schema + standard Humana auth-request layout.
Reconciliation against the actual static PDF is Question #1.)

### 2.1 Header / clinic info (STATIC)

| Field | Source | Notes |
|---|---|---|
| Logo | `public/logo.png` | EdemaCare brand, top-left |
| Provider name | static | "EdemaCare" |
| Legal entity line | static | "EdemaCare is a service of AxiomHealth Management LLC" — required per CLAUDE.md brand convention (footer fine print) |
| Provider NPI | static | Pull from settings (new key `clinic.npi`) — confirm value with Liam |
| Provider Tax ID | static | Pull from settings (new key `clinic.tax_id`) — confirm value with Liam |
| Clinic phone / fax | static | From settings |

### 2.2 Patient demographics (AUTO from `census_data` + `intake_referrals` + `patient_master`)

| Field | Source | Fallback if missing |
|---|---|---|
| Patient legal name | `intake_referrals.patient_name` → `auth_tracker.patient_name` | Manual input (Liam's spec point #2) |
| DOB | `auth_tracker.dob` → `intake_referrals.dob` | Required |
| Address (street, city, ZIP) | `intake_referrals.location` + `.city` + `.zip_code` | Manual input |
| Phone | `intake_referrals.phone` / `.contact_number` → `auth_tracker.phone` | Manual input |
| Region | `auth_tracker.region` (display only) | — |
| County | `intake_referrals.county` | Manual input |
| Patient's PCP name | `intake_referrals.pcp_name` → `auth_tracker.pcp_name` | Manual input |
| PCP phone / fax | `intake_referrals.pcp_phone` / `.pcp_fax` → `auth_tracker.pcp_phone` / `.pcp_fax` | Manual input |
| PCP facility | `auth_tracker.pcp_facility` | Manual input |

### 2.3 Insurance (AUTO with dropdown override — Liam's spec point #1)

| Field | Source | Notes |
|---|---|---|
| Insurance carrier | dropdown sourced from `insurance_abbreviations.insurance_name` — **all 14 canonical carriers** plus `Other` manual entry | **Pin top frequency-of-use:** Humana, CarePlus, Florida Health (FHCP). Then alphabetical: Aetna Commercial, Aetna Medicare, Cigna, Cigna Commercial, Cigna Medicare, Devoted Health, FENYX, Health First, Medicare (traditional), Simply, Private Pay, Other. Do NOT use `auth_tracker.insurance` for the dropdown — that column has 56 distinct values and is contaminated with region prefixes (`"A - Humana"`, `"H - Careplus"`, etc — see §6 data-quality flag). |
| Insurance type (HMO / PPO / MA / Medicaid / Original) | `auth_tracker.insurance_type` + `intake_referrals.medicare_type` | Drives the "prior auth required?" banner (see §4.6) |
| Prior auth required for this combo? | computed: `insurance_abbreviations.requires_prior_auth` AND NOT PPO AND NOT traditional Medicare straight | If `false`, banner: "This payor does not require prior auth. This form will generate a Service Order for your records and the PCP." Form still submittable. |
| Member / policy # | `auth_tracker.member_id` → `intake_referrals.policy_number` | Manual input |
| Secondary insurance | `intake_referrals.secondary_insurance` | Optional |
| Secondary ID | `intake_referrals.secondary_id` | Optional |
| Medicare type (A/B/C/D) | `intake_referrals.medicare_type` | If Medicare primary |
| Medicaid ID | NEW field — appears only when payor is Simply (or any future Medicaid MCO) | Conditional section |
| MSP screening done | NEW field — appears for any payor where Medicare may be secondary | Yes/No |

### 2.4 Clinical (AUTO + USER)

| Field | Source | Notes |
|---|---|---|
| Primary diagnosis (ICD-10) | `auth_tracker.diagnosis_code` → `intake_referrals.diagnosis_clean` | Manual override |
| Diagnosis description | `intake_referrals.diagnosis` | Free text |
| Therapy discipline (PT/OT/SLP/Wound) | `auth_tracker.auth_discipline` / `.therapy_type` | Multi-select |
| **Wounds present** (Liam's spec point #3) | `intake_referrals.has_wound` + `census_data.has_wound` if patient already on census | Yes/No toggle; defaults to system value but editable |
| Wound type / location | `intake_referrals.wound_type` | Conditional — shown only if wounds=yes |
| Requesting / ordering provider | `auth_tracker.requesting_provider` | Manual override |
| Provider NPI | `auth_tracker.requesting_provider_npi` | Manual override |

### 2.5 Service request (USER per request)

| Field | Source | Notes |
|---|---|---|
| CPT codes requested | NEW `cpt_codes` lookup, multi-select | **Liam's spec point #4.** Filter to Wound Care category by default when wounds=yes; "show all categories" toggle |
| Visits requested | numeric | — |
| Evaluations requested | numeric | Pre-fill 1 for new SOCs |
| Reassessments requested | numeric | Pre-fill 0; defaults vary by payor |
| Frequency | text | e.g. "2x/wk x 4wk" |
| Duration / date range | start + end date | — |
| Place of service (POS) | dropdown | "12 - Home" default |
| Clinical justification | textarea | Free text — see §6 length-limit flag |
| Additional notes | textarea | Free text |

### 2.6 Footer / signature

| Field | Source | Notes |
|---|---|---|
| Clinician signature | typed name + date + auth.uid() captured | See Question #5 — do we need wet-sig parity? |
| Submission date | now() | Auto |
| Auth team member submitting | `coordinators.full_name` of `created_by` | Auto |
| Form ID / tracking # | `auth_request_forms.id` (display first 8 chars) | Auto — appears on PDF for support tickets |

---

## 3. Proposed schema

### 3.1 New tables

```sql
-- One row per auth request submitted (or in-progress draft).
CREATE TABLE auth_request_forms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_tracker_id     uuid REFERENCES auth_tracker(id),   -- nullable: form may precede tracker row
  patient_name        text NOT NULL,                       -- denormalized snapshot
  patient_dob         date,
  insurance_name      text NOT NULL,                       -- snapshot (canonical from insurance_abbreviations)
  region              text,
  -- Form payload as jsonb: holds the 30+ field values without schema churn.
  form_data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Lifecycle
  status              text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','ready_to_send','sent','amended','superseded')),
  sent_at             timestamptz,
  sent_method         text CHECK (sent_method IN ('fax','email','portal','manual')),
  sent_to             text,                                -- "Dr Smith office fax 555-1212"
  -- Versioning
  version_number      int NOT NULL DEFAULT 1,
  parent_form_id      uuid REFERENCES auth_request_forms(id), -- for amendments
  -- Audit
  created_by          uuid REFERENCES coordinators(user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Generated PDF artifact (storage path)
  pdf_storage_path    text
);
CREATE INDEX ON auth_request_forms (auth_tracker_id);
CREATE INDEX ON auth_request_forms (patient_name);
CREATE INDEX ON auth_request_forms (status, created_at DESC);

-- CPT code lookup. Liam's 60+ codes seed this verbatim from his spec.
CREATE TABLE cpt_codes (
  code                  text PRIMARY KEY,                  -- e.g. '97597'
  description           text NOT NULL,
  category              text NOT NULL                      -- 'wound_care' | 'lymphedema' | 'pt' | 'ot'
                          CHECK (category IN ('wound_care','lymphedema','pt','ot')),
  cpt_year              int  NOT NULL DEFAULT 2025,        -- ⚠ Liam's list is 2025, not 2026
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            int DEFAULT 0,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON cpt_codes (category, is_active, sort_order);

-- Per-payor billable matrix. Replaces the 3 boolean columns from rev 1.
-- Scales cleanly to all 14 payors without column churn.
-- Default behavior: if no row exists for (code, payor), assume billable=true
-- (open-by-default — auth coordinator can flag known exclusions).
CREATE TABLE cpt_payor_billable (
  cpt_code              text NOT NULL REFERENCES cpt_codes(code) ON DELETE CASCADE,
  insurance_name        text NOT NULL,                     -- matches insurance_abbreviations.insurance_name
  is_billable           boolean NOT NULL DEFAULT true,
  exclusion_reason      text,                              -- e.g. "Not covered per 2025 Humana contract"
  contract_year         int,                               -- which contract year this rule applies to
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cpt_code, insurance_name)
);
CREATE INDEX ON cpt_payor_billable (insurance_name, is_billable);
```

**Seed strategy for the join table:** start empty (everything billable by
default). Phase 2 admin UI lets you flag known exclusions as your team
encounters denials. Don't try to pre-populate from contracts — most of that
data lives in PDFs the system doesn't have.

### 3.2 Why `form_data jsonb` instead of 30 columns

Adding 30 columns to a table for a form that will gain fields every time a
payor changes their template is technical debt by month 3. jsonb keeps the
schema stable; we index the 4-5 fields we'll filter on (`status`,
`patient_name`, `auth_tracker_id`) and leave the rest as queryable jsonb.
Pattern matches how `auth_tracker.cpt_codes` is already a text column.

### 3.3 Why a separate versions concept (not a versions table)

`auth_request_form_versions` would double our row count and slow lookups.
Instead, **once `status='sent'` the row is locked** (DB trigger), and
"amending" inserts a new row with `parent_form_id = original.id` and
`version_number = original.version_number + 1`. Original is preserved
verbatim. UI shows a version history thread for the patient.

### 3.4 Insurance carriers — one new column

`insurance_abbreviations` already gives us a clean list of canonical carrier
names (Humana, CarePlus, Florida Health, Aetna Medicare, etc — 14 distinct
values today). One additive column needed to drive the "prior auth required?"
banner:

```sql
ALTER TABLE insurance_abbreviations
  ADD COLUMN requires_prior_auth boolean NOT NULL DEFAULT true,
  ADD COLUMN auth_form_variant   text DEFAULT 'standard';
-- Seed:
-- requires_prior_auth = FALSE for: Medicare (traditional), Private Pay
-- requires_prior_auth = TRUE  for: everything else (default)
-- The PPO case is computed at form-time from auth_tracker.insurance_type / is_ppo
-- because PPO-ness is per-product, not per-carrier (Cigna has both HMO and PPO).
```

Pin Humana / CarePlus / FHCP to the top of the dropdown via a hardcoded
array; everything else is alphabetical from the DB. Final "Other" option
unlocks a manual carrier-name text input.

### 3.5 RLS

- `auth_request_forms`: select/insert/update for `auth_coordinator`, `admin`,
  `super_admin`. **Tie via `coordinators.user_id = auth.uid()`** — not
  `coordinators.id` (the historical bug noted in CLAUDE.md).
- `cpt_codes`: read for all authenticated roles; write only `admin` + `super_admin`.

### 3.6 No changes to existing tables required

`auth_tracker` already has `cpt_codes` (text), `diagnosis_code`,
`requesting_provider`, `requesting_provider_npi`, `pcp_name/phone/fax/facility`,
`auth_discipline`, `request_type`. Nothing to alter — we read from there.

---

## 4. UI design

### 4.1 Sidebar placement

```
AUTHORIZATION
  ◇ My Day                (sort 20)
  ◇ Compliance: Over Limit (21)
  ◇ Auth Pending Coverage (22)
  ◇ Visit Runway          (23)
  ◇ Auth Expiry Timeline  (24)
  ◇ Stuck Auths           (25)
  ◇ My Auth Queue         (510)
  ◇ All Authorizations    (520)
  ◇ Renewal Tasks         (530)
  ◇ Auth Request Form     (540)  ← NEW
```

- `page_key`: `auth-request-form`
- `page_label`: `Auth Request Form`
- `page_icon`: `📄` (add to `PAGE_ICONS` in `Sidebar.jsx`)
- Permissions: `auth_coordinator`, `admin`, `super_admin` (mirror "All Authorizations")

### 4.2 Page layout (two-column at >1100px, stacked below)

```
┌─────────────────────────────────────────────────────────────────────┐
│  TopBar — Auth Request Form                                         │
├─────────────────────────────────────────────────────────────────────┤
│  [+ New Request]  [Drafts (4)]  [Sent (123)]  [All]                 │
├──────────────────────────────────────┬──────────────────────────────┤
│  LEFT — form (60%)                   │  RIGHT — sticky preview (40%)│
│                                      │                              │
│  ▸ Patient Selection                 │  ┌────────────────────────┐  │
│    Insurance: [Humana ▾]             │  │  PDF Preview (live)    │  │
│    Patient:   [type-to-search ▾]     │  │  ──────────────────    │  │
│      ☐ Patient not in system →       │  │  [EdemaCare logo]      │  │
│        manual entry                  │  │                        │  │
│  ──────────────────────────────────  │  │  Authorization Request │  │
│  ▸ Demographics  (auto + override)   │  │                        │  │
│    DOB / Address / Phone / PCP …     │  │  Patient: Jane Doe     │  │
│  ──────────────────────────────────  │  │  DOB: 1948-03-12       │  │
│  ▸ Insurance  (auto + override)      │  │  Insurance: Humana     │  │
│  ──────────────────────────────────  │  │  Member: H12345678     │  │
│  ▸ Clinical                          │  │                        │  │
│    Diagnosis (ICD-10): [L97.514]     │  │  CPT Codes Requested:  │  │
│    Disciplines: ☑ PT ☐ OT ☐ SLP      │  │   97597, 97598, 97605  │  │
│    Wounds present? (●) Yes (○) No    │  │                        │  │
│      ↳ Wound type/location: …        │  │  Visits: 24            │  │
│  ──────────────────────────────────  │  │  Frequency: 2x/wk x 12 │  │
│  ▸ CPT Codes (filtered: Wound Care)  │  │  ……                    │  │
│    [show all categories ☐]           │  └────────────────────────┘  │
│    ☑ 97597  Debridement, ≤20 cm²     │                              │
│    ☑ 97598  +1 cm² incremental       │  [↓ Download PDF]            │
│    ☑ 97605  NPWT pump ≤50 cm²        │  [📤 Mark as Sent]           │
│  ──────────────────────────────────  │  [💾 Save Draft]             │
│  ▸ Service Request                   │                              │
│    Visits requested: 24              │                              │
│    Frequency:  2x/wk x 12wk          │                              │
│    Start–End:  06-10 → 09-02         │                              │
│    Clinical justification: ……        │                              │
│  ──────────────────────────────────  │                              │
│  ▸ Form History for this patient     │                              │
│    v1  2026-05-12  sent (fax)   📄   │                              │
│    v2  2026-06-03  draft         📄   │                              │
└──────────────────────────────────────┴──────────────────────────────┘
```

### 4.3 Patient typeahead source

`UNION` over:
- `census_data` (current census, ~897 rows) — primary
- `intake_referrals` where `referral_status NOT IN ('Declined','Duplicate')` and `dob` populated (~3K rows after filter)

Wrap with `fetchAllPages` per CLAUDE.md rule — both tables exceed 1K rows.

Cache the union client-side for the session (5-min TTL) and search via
debounced substring match on `patient_name`. If user types something not in
the list, an inline "Use 'Jane Smith' as new patient" button appears
(Liam's spec point #2: manual override).

### 4.4 CPT picker

Two-pane: **Category tabs** across the top (Wound Care | Lymphedema | PT |
OT | All), checkbox list below. Selected codes pill at the bottom for quick
removal. Default tab = Wound Care when `wounds_present=yes`, else discipline
inferred from `auth_discipline`.

### 4.6 Prior-auth-not-required banner (new in rev 2)

When the selected (carrier × product) combination doesn't require prior
auth, the form shows a yellow banner at the top:

```
┌──────────────────────────────────────────────────────────────────┐
│ ⓘ  PPO plans / Traditional Medicare / Private Pay do not         │
│    require prior authorization.                                   │
│    This form will generate a Service Order for the patient's      │
│    record and the PCP — NOT a prior auth request to the payor.    │
└──────────────────────────────────────────────────────────────────┘
```

The PDF title in that case changes from "Authorization Request" to
"Service Order / Plan of Care Notification" and the addressee block omits
the payor. Form is still saved, still versioned, still searchable.

### 4.7 Conditional sections by payor

| Section | Shows when |
|---|---|
| Medicaid ID | `insurance_name = 'Simply'` OR carrier flagged as Medicaid MCO |
| MSP screening (Y/N) | Patient has secondary insurance OR carrier is Medicare-secondary candidate |
| Medicare Plan letter (A/B/C/D) | `insurance_name` contains "Medicare" |
| Wound type/location | `wounds_present = yes` |
| Insurance "Other" → manual carrier text input | `insurance_name = 'Other'` |

All driven by simple visibility rules in the React component, no schema
branching needed.

### 4.5 Lock-after-sent

When `status='sent'`, the form switches to a read-only view with a banner:
`This request was sent 2026-06-03 09:14. [Create amendment →]`. Amendment
button creates a new row with `parent_form_id` set; original is untouchable.

---

## 5. PDF generation — recommendation

**Use jsPDF + jspdf-autotable, client-side.**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. jsPDF client-side** *(recommended)* | Already in package.json. Zero new infra. PDF preview can use the same renderer. Works offline. Easy to iterate on layout. | No direct fax/email send. Branded fonts need embedding. | ✅ |
| B. Supabase Edge Function (pdfkit / Puppeteer) | Server-side rendering can email directly via Resend. Easier for batch generation. | New edge function to maintain. Puppeteer cold start ~3s. Resend FROM is `@axiomhealthmanagement.com` per CLAUDE.md so emails come from the legal entity — that's fine for billing-adjacent docs but worth flagging. | Defer to Phase 3 if we want email integration. |
| C. react-pdf | Component-based, easy preview. | Adds ~600KB to bundle. Duplicates jsPDF capability. | ❌ |

**Phase 2 ships:** Generate PDF in-browser, offer **Download** + **Copy to
clipboard for paste-into-portal**. Mark-as-Sent records `sent_method` +
`sent_to` manually (so we can report on delivery channels).

**Phase 3:** Edge function that takes `auth_request_form.id`, regenerates
the PDF server-side, and emails to PCP via Resend (sender remains the
verified `@axiomhealthmanagement.com` domain per CLAUDE.md — UI badging
stays EdemaCare, sender envelope is AHM).

**PDF spec:**
- Letter size, 0.5" margins.
- Header: EdemaCare logo (top-left, 40px tall, from `public/logo.png`) +
  title "Authorization Request" right-aligned.
- Sections matching the static PDF layout (so PCP offices recognize it).
- Brand color `#D94F2B` for section dividers only — keep body B&W for
  fax-readability (faxes blur color and PCP offices still fax).
- Footer on every page:
  `EdemaCare · Phone X · Fax Y · NPI Z` (line 1)
  `EdemaCare is a service of AxiomHealth Management LLC` (line 2, smaller)
  Page X of Y, right-aligned.
- Form ID first-8-chars top-right of page 1 (for tracking when PCP calls).

---

## 6. Honest caveats and known risks

1. **CPT-year drift (high impact).** Liam's list is 2025. We're in 2026.
   Several codes (especially in OT/PT) get renumbered annually. Ship as-is
   for v1 with `cpt_year=2025` tag, **but block public rollout until a
   licensed coder confirms 2026 alignment.** I am **not** the right party
   to cross-reference 2026 codes without authoritative source access.
2. **Insurance data quality (medium impact).** `auth_tracker.insurance`
   has 56 distinct values, many like `"A - Humana"` (region prefix glued
   to carrier name). Do not power the dropdown off that column. Power it
   off `insurance_abbreviations.insurance_name` (14 clean values). Phase 4
   cleanup: normalize the historical `auth_tracker.insurance` values to
   the canonical list — separate ticket.
3. **Compliance / amendment workflow.** Auth requests are
   billing-adjacent. Editing a sent form retroactively is falsification.
   The lock-after-sent + amendment-as-new-row design preserves audit
   integrity. Do not give super_admin a backdoor to edit sent forms.
4. **Signature parity.** Static PDF likely has a "Clinician Signature"
   line. Typed-name e-signature is sufficient for most Florida HMO
   submissions but **not** for Medicare appeals. Confirm payor
   requirements (Question #5).
5. **Free-text length.** Clinical justification needs a soft limit
   (~2000 chars) — payor portals truncate. UI shows live char count.
6. **PDF won't render emoji or non-ASCII glyphs cleanly.** Per
   CLAUDE.md unicode-in-JSX bug, we'll also be careful in the jsPDF
   renderer to stick to base ASCII for any auto-populated text. Patient
   names with accents (José, etc) need Latin-1 or font embedding.
7. **Payors that don't actually take prior-auth requests (new in rev 2).**
   PPO plans, Traditional Medicare for outpatient PT/OT, and Private Pay
   never receive a prior-auth request because there's no auth process to
   submit to. Form still generates as a "Service Order" so the patient
   record + PCP get a polished document, but we DO NOT bombard those
   payors' fax lines with phantom auth requests. Hard-coded into the
   "Mark as Sent" workflow: if `requires_prior_auth = false`, default
   `sent_to` is "Patient record / PCP" not the carrier.
8. **Brand naming.** Per CLAUDE.md: user-visible strings = "EdemaCare",
   legal-line footer = "EdemaCare is a service of AxiomHealth Management
   LLC". I've followed this throughout (UI header EdemaCare, PDF footer
   carries the legal-line). **Code-internal identifiers stay AHM** —
   so the page_key is `auth-request-form` not `edemacare-auth-form`,
   and any new tables stay snake_case English without brand prefixes.

---

## 7. Gating questions for Liam — please answer all 6 before Phase 2

1. **Static PDF reconciliation.** Drop the source PDF into
   `~/Documents/GitHub/edemacare-ops/docs/inputs/Auth_Request_Form_2025.pdf`
   so I can do a field-by-field check against §2. *Recommendation: do this
   before any build work — saves a rebuild.*
2. **CPT year.** Ship 2025 list as-is + audit task to verify 2026?
   *Recommendation: yes, with `cpt_year=2025` flag and a hard "Verify
   before public rollout" TODO on the rollout checklist.*
3. **Scope: per-payor form variants vs one unified form.** As of rev 2 the
   form must cover **all 14 payors** EdemaCare services. Two paths:
   (a) **one unified form** with conditional sections that show/hide based
   on the carrier picked (e.g. Medicaid ID appears only for Simply, MSP
   screening appears when there's a secondary), OR (b) per-payor templates
   maintained separately. *Recommendation: (a) for v1.* Per-payor templates
   triple our maintenance surface and 80% of fields are common across
   carriers. Add per-payor overlays only when a specific carrier rejects
   the unified PDF layout in Phase 2 testing.
4. **PCP delivery channel.** Phase 2 = Download + Mark-as-Sent (manual),
   Phase 3 = email-direct via Resend?
   *Recommendation: yes — defer email automation. 80% of FL PCP offices
   still want fax anyway.*
5. **Signature.** Typed-name e-sig acceptable, or do we need wet-sig
   parity (clinician signs DocuSign before submit)?
   *Recommendation: typed name + auth.uid() + IP-stamp for v1. Revisit
   if any payor rejects.*
6. **Amendment of a sent form.** Confirm: once sent, original is locked
   and amendments create new versioned rows (no destructive edits).
   *Recommendation: yes. This is the only defensible audit posture for
   billing-adjacent docs.*

---

## 8. Out of scope for v1 (defer to Phase 3)

- Direct email-to-PCP integration (Resend edge function).
- DocuSign / SignNow integration for wet signatures.
- Per-payor form template overlays (we ship one unified form; per-payor
  templates only built if a specific carrier rejects the unified layout).
- Per-payor CPT exclusion seed data (the `cpt_payor_billable` table ships
  empty; team flags exclusions as denials are observed).
- Historical-PDF backfill (importing the existing static PDFs that have
  already been sent — out of scope).
- Auto-populate from referral document OCR (separate AIDocExtractor
  pattern already exists; could be wired in Phase 3).
- 2026 CPT code refresh (separate licensed-coder ticket).

---

## 8a. Adding a new payor in the future (zero-code runbook)

Confirmed in rev 2: the design supports adding new payors via the existing
`InsuranceSettingsPage.jsx` admin UI (sidebar: ADMIN → Insurance
Abbreviations, gated to super_admin + admin). **No developer required.**

To onboard a new carrier (e.g. Molina, WellCare, Aetna Better Health):

1. **Insurance Settings → Add carrier.** Enter canonical `insurance_name`
   (e.g. `"Molina Healthcare"`), abbreviation (Pariox column value, e.g.
   `"MOL"`), `category` (HMO / MA / Medicaid MCO / Commercial),
   `requires_prior_auth` (true/false), `auth_form_variant` (leave as
   `"standard"` unless the carrier rejects the unified PDF).
2. **Auth Request Form picks it up automatically** — next page load, new
   carrier appears in the dropdown, alphabetized below the pinned three.
3. **Optional: seed known CPT exclusions.** ADMIN → CPT Codes (new Phase 2
   page) → pick the carrier → flag any codes the contract doesn't cover.
   Or leave empty and let the team flag exclusions reactively as denials
   come in (recommended — pre-loading contract exclusions is hard and
   often wrong).
4. **No deploy. No code change.** Phase 2 ships with the Insurance
   Settings page extended to expose the two new columns
   (`requires_prior_auth`, `auth_form_variant`). One small UI change,
   not a per-payor code path.

This is why we used a join table (`cpt_payor_billable`) instead of per-
carrier boolean columns on `cpt_codes` — adding the 15th carrier doesn't
require a migration.

---

## 9. Phase 2 build plan (preview only — for context)

If Liam green-lights this design, Phase 2 = ~3.5 working days:

1. Migration: `auth_request_forms` + `cpt_codes` + `cpt_payor_billable`
   join table + `insurance_abbreviations.requires_prior_auth` +
   `.auth_form_variant` + seed CPT codes from Liam's spec (1 day).
2. `AuthRequestFormPage.jsx` — two-column UI, patient typeahead, CPT
   picker, draft autosave, prior-auth-not-required banner, conditional
   sections (1.25 days).
3. `lib/authRequestPdf.js` — jsPDF renderer with EdemaCare logo, layout
   matching the static PDF, dynamic title (Authorization Request vs
   Service Order) (0.5 day).
4. Extend `InsuranceSettingsPage.jsx` to expose the two new columns
   (`requires_prior_auth`, `auth_form_variant`) (0.25 day).
5. Sidebar registration + page_permissions row (0.25 day).
6. Manual QA with Carla + one Auth Coordinator (0.25 day) — sign off
   before going live.

End of design doc.
