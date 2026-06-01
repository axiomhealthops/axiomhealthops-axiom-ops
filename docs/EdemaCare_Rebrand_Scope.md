# EdemaCare Rebrand — Phase 1 Scope Audit

**Prepared for:** Liam O'Brien, Director of Operations
**Prepared by:** Claude (commissioned 2026-05-29)
**Trigger:** Rebrand from "AxiomHealth Management" / "AHM" → "EdemaCare", effective Monday 2026-06-01
**Audit only — zero code, asset, or text changes made.**

---

## 1. Executive summary

The surface area is small, well-bounded, and easy to ship cleanly by Monday — **but only if you make three calls in the next 24 hours**. The build-time string changes are trivial. The risk lives in three places nobody can fix with find-and-replace: email infrastructure, the Vercel production URL, and the legal/entity question.

**What I found:**

| Category | Count | Lift | Risk |
|---|---|---|---|
| UI strings in repo (`src/`, `index.html`, `public/manifest.json`, `package.json`) | 14 occurrences across 11 files | **S** | Low — pure copy |
| Visual assets (`public/logo.png`, 3 icons, favicon) | 5 image files | **S–M** | Need an EdemaCare logo file from you |
| Supabase edge-function source (sends production email + has hardcoded Vercel URL) | 3 functions, ~10 occurrences | **M** | **Production emails — needs Resend domain verified before flipping** |
| Supabase project name | 1 (`axiom-ops`) | S | Cosmetic; safe |
| GitHub repo + org | 1 repo, 1 org (`axiomhealthops/axiomhealthops-axiom-ops`) | M | Renaming the repo changes the canonical Vercel URL — cascades |
| Vercel project + canonical domain (`axiomhealthops-axiom-ops.vercel.app`) | 1 project, hardcoded in 3 places | M | **Reset-password links break if URL changes without code updates** |
| Documentation (`CLAUDE.md`, 2 docx training guides, 1 audit MD, MARKETING_CRM_DESIGN.md) | 4 files | S–M | Training guides are PDFs in circulation — version, don't edit silently |
| Database content (archival `daily_ops_reports.report_html`, `patient_notes.note_text`) | 114 + 58 rows containing brand string | — | **Leave alone — these are historical records.** |
| Email domain (`@axiomhealthmanagement.com`) | 22 coordinator accounts, all Resend FROM addresses, Supabase auth sender | L | **OUT OF SCOPE for Monday unless you've already started Google Workspace migration.** |
| Legal entity name (LLC, contracts, 1099s, invoices) | unknown | L | **Confirm with you + CPA before any user-facing claim changes** |

**Total estimated effort to ship the safe UI-only rebrand by Monday:** ~2–3 hours of focused work (Phase 2). Plus 24–48h lead time on logo asset + Resend domain verification if you go all the way.

**Honest pushback up front — the parts you should not rush:**

1. **Do not flip the Vercel canonical URL on Monday.** The current production URL `axiomhealthops-axiom-ops.vercel.app` is hardcoded in 3 places (Login.jsx reset redirect, 2 edge functions). Password-reset emails sent before the cut will deep-link to the old URL; reset emails sent from new code will deep-link to the new URL. If you switch URLs without a 7+ day overlap, you will brick password-reset for any user who clicks an in-flight link. **Recommendation: keep the existing Vercel URL alive as an alias for ≥30 days, OR buy a custom domain (`app.edemacare.com`) before Monday and cut to that instead.** Custom domain is the right answer long-term.
2. **Do not change the Resend FROM address without 24–48h to verify the new domain.** Resend requires DKIM/SPF DNS records on the sending domain. If you change `reports@axiomhealthmanagement.com` → `reports@edemacare.com` without verifying first, the daily ops report stops landing in your inbox and password-reset emails bounce.
3. **Do not touch employee email addresses on Monday.** That's a multi-week Google Workspace project. The visible-brand changes can ship without it; the team can keep `@axiomhealthmanagement.com` addresses while the platform says "EdemaCare" everywhere.

The recommended Monday cut is **internal/visible-UI only**: app title, sidebar, login screen, PDF/XLSX export headers, edge-function HTML email body copy, repo file/identifier names. Everything else gets staged for a Phase 3 (Q3) cleanup.

---

## 2. In-scope (auto-rename safe)

Everything in this section is a string change. No data migration, no DNS, no third-party reconfiguration. Total: **11 source files, 14 string replacements, 4–5 visual asset swaps**.

### 2.1 Code + config find-replace table

| # | File | Line | Current | Proposed |
|---|---|---|---|---|
| 1 | `index.html` | 6 | `<title>AxiomHealth Operations</title>` | `<title>EdemaCare Operations</title>` |
| 2 | `index.html` | 7 | `meta description "AxiomHealth Management Care Coordination..."` | `"EdemaCare Care Coordination Operations Platform"` |
| 3 | `public/manifest.json` | 2 | `"name": "AxiomHealth Operations"` | `"name": "EdemaCare Operations"` |
| 4 | `public/manifest.json` | 3 | `"short_name": "AHM Ops"` | `"short_name": "EdemaCare Ops"` |
| 5 | `public/manifest.json` | 4 | `description "AxiomHealth Management..."` | `description "EdemaCare..."` |
| 6 | `package.json` | 2 | `"name": "axiomhealth-ops"` | `"name": "edemacare-ops"` |
| 7 | `src/components/Sidebar.jsx` | 121 | `alt="AHM"` | `alt="EdemaCare"` |
| 8 | `src/components/Sidebar.jsx` | 124 | `<div>AxiomHealth</div>` | `<div>EdemaCare</div>` |
| 9 | `src/pages/Login.jsx` | 41, 94 | `<div>AxiomHealth</div>` ×2 | `<div>EdemaCare</div>` ×2 |
| 10 | `src/pages/Login.jsx` | 71, 105 | `placeholder="you@axiomhealthmanagement.com"` ×2 | `placeholder="you@axiomhealthmanagement.com"` *(leave — emails unchanged)* OR `"you@edemacare.com"` if doing email cutover |
| 11 | `src/pages/ResetPassword.jsx` | 73, 98, 124 | `<div>AxiomHealth</div>` ×3 | `<div>EdemaCare</div>` ×3 |
| 12 | `src/pages/CoordinatorPage.jsx` | 1075 | `<div>AxiomHealth</div>` | `<div>EdemaCare</div>` |
| 13 | `src/pages/dashboard/ExecutiveReportPage.jsx` | 191, 230, 391 | 3× "AxiomHealth" in printed weekly-report HTML | `"EdemaCare"` |
| 14 | `src/pages/dashboard/ReportsExportPage.jsx` | 670 | XLSX header `"AxiomHealth Patient Census Export"` | `"EdemaCare Patient Census Export"` |
| 15 | `src/pages/dashboard/HospitalizationTrackerPage.jsx` | 217 | Form label `"Returned to AxiomHealth Service"` | `"Returned to EdemaCare Service"` |
| 16 | `src/pages/dashboard/IntakeDashboardPage.jsx` | 1196 | Body copy `"demand for AxiomHealth in new geographies"` | `"demand for EdemaCare in new geographies"` |
| 17 | `src/lib/dateUtils.js` | 36 | Comment `"// AxiomHealth's work week..."` | `"// EdemaCare's work week..."` *(cosmetic only)* |

### 2.2 Edge function source (Supabase) — text changes only

These are still source-code string changes, but the cut happens on the Supabase side, not via `git push`. They send live production email through Resend.

| # | Function | Strings to change | Notes |
|---|---|---|---|
| 18 | `daily-ops-report` | 4× footer "AxiomHealth Operations Platform — Auto-generated report"; FROM `"AxiomHealth Ops <reports@axiomhealthmanagement.com>"` | FROM domain change blocked on Resend verification (see §3) |
| 19 | `notify-mention` | Header banner "AxiomHealth Ops", body "Open AxiomHealth Ops" CTA, FROM `notifications@axiomhealthmanagement.com`, `APP_URL` constant | Same Resend blocker |
| 20 | `admin-user-actions` | Email header "AxiomHealth Ops", body "AxiomHealth Ops account", footer "Sent by AxiomHealth Ops", subject `"AxiomHealth Ops — Password reset"`, FROM constant, `APP_URL` constant | Same Resend blocker + URL blocker (see §3) |

### 2.3 Visual assets

| File | Dimensions | Action |
|---|---|---|
| `public/logo.png` | 1668×1668 JPEG | **Need EdemaCare logo from you.** Use same dimensions or larger. |
| `public/icon-192.png` | 192×192 PNG | PWA icon — regenerate from new logo |
| `public/icon-512.png` | 512×512 PNG | PWA icon — regenerate from new logo |
| `public/favicon.ico` | 16×16 | Regenerate from new logo |
| `public/apple-touch-icon.png` | 180×180 | Regenerate from new logo |

The theme color `#C0392B` (the deep red used throughout the app and in `<meta name="theme-color">`) is unchanged by the rebrand unless you also want a new color palette — flagging as a question, not assuming.

### 2.4 Documentation

| File | Action | Notes |
|---|---|---|
| `CLAUDE.md` | Update brand reference on line 3 | Internal — affects every future Claude session. Ship Monday. |
| `MARKETING_CRM_DESIGN.md` | Replace 7 example employee emails | Internal design doc. Low priority. |
| `docs/AHM_Workflow_System_Audit.md` | Rename file → `EdemaCare_Workflow_System_Audit.md`; update title, frontmatter | This is the audit doc Claude wrote 2026-05-28. Internal. |
| `docs/AHM_Authorization_Training_Guide_v1.docx` | **Leave v1 alone.** Create `EdemaCare_Authorization_Training_Guide_v3.docx`. | v1/v2 are versioned training artifacts you've already distributed to staff. Treat as historical. |
| `docs/AHM_Authorization_Training_Guide_v2.docx` | **Leave alone.** Reissue as v3 with EdemaCare branding. | Same reason. |

---

## 3. Needs decision — Liam, these are yours

These are the calls only you can make. My recommendation is listed first; rationale follows.

### Q1. Vercel canonical URL — what's the production URL after Monday?

**Recommendation: buy `edemacare.com` (or `app.edemacare.com`) before Monday and cut to a custom domain. Keep `axiomhealthops-axiom-ops.vercel.app` alive as an alias for 60 days.**

**Why this matters:** The current URL is hardcoded in `src/pages/Login.jsx:26`, `supabase/functions/notify-mention/index.ts:5`, and `supabase/functions/admin-user-actions/index.ts:30`. Reset-password emails contain deep links to this URL. If you change the URL without code updates AND a 60-day alias overlap, anyone clicking an old reset link gets a 404.

**Bigger reason:** `axiomhealthops-axiom-ops.vercel.app` is an embarrassing URL for a rebrand. A custom domain (`app.edemacare.com` or just `edemacare.com`) is what a professional ops platform looks like. Costs ~$12/yr. Vercel custom-domain setup is 15 min once DNS resolves.

**Options I see:**
- (a) **Custom domain now** — best long-term answer. ~24h DNS propagation + 15min Vercel config.
- (b) **Rename Vercel project + keep `.vercel.app`** — gets URL to `edemacare-ops.vercel.app`. Cosmetic improvement. Still an unbranded URL.
- (c) **Do nothing** — keep `axiomhealthops-axiom-ops.vercel.app`. Lowest risk for Monday, but you'll regret it in Q3.

### Q2. Email infrastructure — what's the FROM address after Monday?

**Recommendation: keep `@axiomhealthmanagement.com` as the Resend sender domain on Monday. Migrate to `@edemacare.com` in a Phase 3 cutover after you've (a) bought the domain, (b) added DKIM/SPF records, (c) verified the domain in Resend, and (d) tested with a flagged employee.**

**Why:** Resend requires verified sender domains. Verifying takes ~1h to set up + 24h for DNS to propagate + you need a domain to verify. If you switch FROM before verifying, the daily ops report stops landing in your inbox, mention notifications silently fail, and admin password-reset emails bounce.

**This is decoupled from employee email migration.** You can send platform emails FROM `@edemacare.com` while your team's mailboxes still live on `@axiomhealthmanagement.com`. Those are two separate projects.

### Q3. Legal entity + patient-facing copy — what's the d/b/a story?

**Recommendation: confirm with your CPA before Monday. Do NOT change anything that implies legal identity (invoices, contracts, statements of work, EOBs, anything regulated) until you do.**

The platform has **zero patient-facing surfaces today** — every page is for staff. So the rebrand can land without touching anything patient-visible. The one place where this matters is the Hospitalization Tracker field labeled `"Returned to AxiomHealth Service"` (line 217 of `HospitalizationTrackerPage.jsx`). That field's *label* gets changed, but the *underlying data* recorded against it implies a clinical relationship between patient and the entity providing care. Once you change the label, the audit trail shows "Returned to EdemaCare Service" for visits that were clinically delivered by "AxiomHealth Management LLC." If there's an audit or readmission review, that needs to make sense to a regulator.

**Confirm with your CPA / counsel:**
- What's the LLC name? Stays as "AxiomHealth Management LLC" with EdemaCare as d/b/a? Or full legal rename?
- What goes on invoices to payors (Medicare, Medicaid MCOs, commercial insurance)? Their credentialing files reference the LLC name — that's a separate workflow with each payor.
- What goes on 1099s and W-2s in January 2027?

**If patient-facing materials exist (intake confirmation emails, appointment reminders, welcome packets — I don't see any in this codebase, but they may exist in Pariox or a separate intake tool), those are the highest-stakes UI to get right. Flag separately.**

### Q4. Sub-questions where I'm picking the default unless you say otherwise

| # | Question | My default if you don't answer |
|---|---|---|
| Q4a | Rename GitHub repo `axiomhealthops/axiomhealthops-axiom-ops` → `edemacare/edemacare-ops`? | **Yes — rename repo + create new GH org `edemacare`.** GitHub auto-redirects the old URL. Updates the Vercel-GitHub integration automatically. |
| Q4b | Rename Supabase project `axiom-ops` → `edemacare-ops`? | **Yes — cosmetic, no downstream effect.** Project ID `kndiyailsqrialgbozac` stays the same; only display name changes. |
| Q4c | Theme color — keep deep red `#C0392B`? | **Keep red.** A color change is a separate design decision. |
| Q4d | Replace 22 `@axiomhealthmanagement.com` `coordinators.email` values in DB? | **No — leave alone.** Those map to live `auth.users` accounts. Touching them risks breaking login. Migrate during Phase 3. |
| Q4e | Rewrite 114 historical `daily_ops_reports.report_html` rows and 58 historical `patient_notes.note_text` rows containing "AxiomHealth"? | **No — leave alone.** Historical records should reflect what was true at the time. Edits look like falsification. |
| Q4f | Update Supabase Dashboard → Auth → Email Templates (recovery, magic-link, invite)? | **Yes — but I need you to confirm. I can't read those via SQL; they're configured in the dashboard UI.** Tell me to update them in Phase 2 and I'll guide you through the dashboard step. |

---

## 4. Out-of-scope or risky

Listing these explicitly so we don't trip into them by mistake.

| Item | Why it's risky / out-of-scope | Recommended treatment |
|---|---|---|
| `coordinators.email` rewrites (22 rows) | Tied to `auth.uid()` via the `user_id` join. If `auth.users.email` and `coordinators.email` drift, login still works but password-reset routing breaks (Supabase recovers by email). | Defer to Phase 3. Coordinated cutover with Google Workspace migration. |
| Historical `daily_ops_reports.report_html` | These are audit records sent to you each morning since March. Rewriting them post-hoc is falsification. | Leave as historical record. |
| Historical `patient_notes.note_text` (58 rows) | Clinical/operational notes written by coordinators. They thought they were working at "AxiomHealth" — that's true. | Leave as historical record. |
| Pariox integration | Pariox is the source-of-truth EHR. If Pariox knows the LLC as "AxiomHealth Management" and we send claims under that name, payors expect that. **No code change here** — but flagging that the upstream system is unchanged. | Out of scope for this audit. Confirm Pariox configuration with vendor. |
| GitHub commit history | Old commits authored by `axiomhealthops` GitHub org. | Git history is immutable; renaming the org rewrites the URLs but not the commit authors. Don't try to rewrite history. |
| `dist/` build artifacts | Generated. Will be regenerated on next `vite build`. | Ignore — rebuilds automatically. |
| Supabase project ID `kndiyailsqrialgbozac` | The unguessable Supabase ref. Used by every API client. **Not renamable.** | Stays forever. |
| `.env.local` — `VITE_SUPABASE_ANON_KEY` etc. | Local dev env. No brand string. | No change. |
| Resend sender domain DNS | DKIM/SPF on `axiomhealthmanagement.com` is presumably already configured. Adding new records for `edemacare.com` is a 24h DNS exercise. | Phase 2 prep — start today if you want a Monday cutover on FROM addresses. |
| `data_audit_log` reversible-change records | If we rewrite UI strings as "data changes" through the audit pipeline, we'd pollute the reversible-change log. | The rebrand is code change, not data change. Audit log unaffected. |

---

## 5. Recommended sequence

This is what I'd ship if you give me the green light on the safe path. **Total active work: ~2–3 hours.**

### Today (Friday 5/29, ≤2h)
1. **You decide Q1, Q2, Q3** (custom domain yes/no, Resend cutover yes/no, CPA call yes/no).
2. **You provide an EdemaCare logo PNG** (transparent background, square, ≥512×512). I can generate the icon set from it.
3. *(if Q1 = yes)* You buy `edemacare.com`, point DNS at Vercel. ~1h.
4. *(if Q2 = yes)* You add EdemaCare to Resend, set DKIM/SPF records. ~30min.

### Saturday 5/30 (waiting on DNS + Resend)
- DNS propagates. Verify in Resend dashboard.

### Sunday 5/31 — Phase 2 execution (≤2h)
5. I do the find-replace in `src/`, `index.html`, `public/manifest.json`, `package.json` — all 17 string changes listed in §2.1.
6. I swap the 5 visual assets in `public/`.
7. I update the 3 edge functions (only if Q2 = verified) and redeploy via Supabase MCP.
8. I update CLAUDE.md and `docs/AHM_Workflow_System_Audit.md`.
9. Build locally (`npx vite build`) → verify no broken references.
10. *(NOT pushed to git yet.)*

### Monday 6/1 — cutover (≤1h)
11. **You review the staged changes** (I'll send a single PR-style diff for inspection).
12. On your "ship": `ship "feat: rebrand AxiomHealth → EdemaCare"` → Vercel auto-deploys within 60s.
13. Smoke-test: login screen, password reset (you should receive the email FROM the new address), daily ops report (next morning), one PDF export, one XLSX export.
14. If anything's wrong: `git revert HEAD && git push` rolls it back in 60s.

### Deferred to Phase 3 (Q3 2026)
- Employee email migration (`@axiomhealthmanagement.com` → `@edemacare.com`) — Google Workspace project.
- `coordinators.email` DB update — coordinated with above.
- Reissue training docs as `EdemaCare_Authorization_Training_Guide_v3.docx`.
- GitHub org rename (if Q4a deferred).

---

## 6. Top 3 questions you must answer before any execution

1. **Custom domain or `.vercel.app`?** (Q1.) Even just "yes, buy `edemacare.com`" or "no, ship to `edemacare-ops.vercel.app`" unblocks me. *My strong rec: custom domain.*
2. **Resend FROM cutover on Monday or defer?** (Q2.) Need to know whether to verify `edemacare.com` in Resend this weekend. *My strong rec: defer unless you've already got the domain and DNS access.*
3. **Have you talked to your CPA / counsel about the d/b/a vs. legal-rename question?** (Q3.) *My strong rec: 15-minute phone call with your CPA before Monday. The platform rebrand is safe to ship regardless — but you should know the answer before the team starts saying "EdemaCare" on the phone with payors.*

---

*Phase 1 scope audit complete. No code, asset, or configuration was modified. Phase 2 (execution) is a separate task and will not begin without your explicit go-ahead.*
