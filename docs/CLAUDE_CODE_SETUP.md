# Claude Code Setup — EdemaCare Operations

**Audience:** Liam, picking up the EdemaCare codebase from Claude Code (the terminal-based CLI tool) instead of Cowork mode.

**Why this doc:** Cowork conversations don't physically migrate to Claude Code — each tool has its own session storage. What DOES migrate is everything documented in `CLAUDE.md` (the project context Claude Code reads on every session) and your code + git history. This guide is the bootstrap checklist.

---

## 1. Install Claude Code

If you don't have it yet, install via your terminal:

```bash
# macOS / Homebrew
brew install claude

# Or via npm
npm install -g @anthropic-ai/claude-code
```

Verify:

```bash
claude --version
```

Sign in once at the top of your first session:

```bash
claude
```

It'll open a browser, you authenticate, and you're in.

---

## 2. Start every session from the repo root

```bash
cd ~/Documents/GitHub/edemacare-ops
claude
```

Claude Code automatically reads `CLAUDE.md` from the current directory. That file has the full project context — brand conventions, hard-won rules, broken-before patterns, key pages, deployment flow. Trust it.

---

## 3. MCP Servers to install

You've been using these MCPs in Cowork. Install them in Claude Code so you keep the same capabilities. Run each command once:

### Supabase MCP (required — heavy use)

```bash
claude mcp add supabase --transport http \
  --url "https://mcp.supabase.com" \
  --header "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN"
```

Get your access token from [Supabase Dashboard → Account → Access Tokens](https://supabase.com/dashboard/account/tokens).

Project ID for this repo: `kndiyailsqrialgbozac`

### Vercel MCP (deployments + logs)

```bash
claude mcp add vercel --transport http \
  --url "https://mcp.vercel.com" \
  --header "Authorization: Bearer YOUR_VERCEL_TOKEN"
```

Get token from [Vercel Account Settings → Tokens](https://vercel.com/account/tokens).

Project: `axiomhealthops-axiom-ops` (team `team_U9Zi2lYoYrtMpAXhrtK6k7Wd`)

### Gmail / Google Drive / Calendar (optional, when you want them)

For Google services, the simplest path is the official MCPs from [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers). Install per repo instructions and add to Claude Code with `claude mcp add`.

### Claude in Chrome (for browser ops)

This one's a Chrome extension, not an MCP. Install from the Chrome Web Store, then any Claude Code session can drive your browser the same way Cowork did.

### List what's installed

```bash
claude mcp list
```

### Remove an MCP

```bash
claude mcp remove <name>
```

---

## 4. Useful slash commands inside Claude Code

Inside a `claude` session:

- `/init` — generates a CLAUDE.md scaffold for a fresh repo (not needed here, ours is already comprehensive)
- `/clear` — clear the current conversation
- `/help` — list available commands
- `/mcp` — list configured MCP servers
- `/hooks` — configure session hooks (e.g. auto-run tests after edits)

---

## 5. How shipping works (unchanged)

`ship "commit message"` is your shell function on the Mac. Claude Code can edit files but **you run `ship` yourself** from your terminal after reviewing the diff. Same flow as Cowork:

1. Claude Code makes edits in the repo
2. `git status` to confirm
3. `npx vite build` to verify
4. `ship "your commit message"` to commit + push
5. Vercel auto-deploys main in ~60s

DB changes go directly via the Supabase MCP `apply_migration` action — no ship needed.

---

## 6. Where today's work lives

Updates made on 2026-06-09 (in case you're looking for context after the migration):

**Brand:**
- `src/index.css` — CSS variables now map to EdemaCare palette (teal/navy/indigo)
- `src/lib/constants.js` — `B` palette + new `EC` brand palette + `TERRITORIES` + `GA_TERRITORIES`
- `public/` — official EdemaCare logos (color, black, white versions)

**Pages:**
- `src/pages/dashboard/MarketingReferralsPage.jsx` — read-only referrals by territory (FL + GA on one page)
- `src/pages/dashboard/MarketingLuncheonRequestsPage.jsx` — approval workflow (Yvonne + Liam approve)
- `src/pages/dashboard/ReportsExportPage.jsx` — 6-bucket reorganization + 3 new reports (Doc Lag, Payer Performance, Conversion Funnel)
- `src/pages/dashboard/UserManagementPage.jsx` + `src/components/UserBulkActions.jsx` — Export/Import bulk user XLSX flow
- `src/pages/Login.jsx` — fully rebranded with EdemaCare logo + teal/indigo gradient button

**Edge Functions:**
- `supabase/functions/admin-user-actions/index.ts` — v7 with `bulk_user_migration` action + verbose error diagnostics

**Database migrations applied today:**
- `add_clear_pending_email_change_helper`
- `add_marketing_referrals_page` + `add_marketing_referrals_georgia_page` (then removed)
- `fix_marketing_encounters_rls_for_hae_and_director`
- `extend_marketing_admin_and_read_policies`
- `create_marketing_luncheon_requests`
- `restrict_luncheon_approvers_to_super_admin_and_director_payer_marketing`

See `git log -50` for full chronological order.

---

## 7. Critical context Claude Code should always have

These are in `CLAUDE.md` — re-read them whenever there's any new Claude Code session:

1. **Sun–Sat work week** — use `getWeekStart` / `getWeekEnd` / `getWeekRange` from `src/lib/dateUtils.js`. Never write Mon–Sun math.
2. **$230 blended rate** — import `BLENDED_RATE` from `src/lib/visitMath.js`. Never hardcode.
3. **`fetchAllPages` for high-volume tables** — supabase-js silently truncates at 1000 rows.
4. **No unicode in JSX text** — build tooling mangles them. Use ASCII or `{'×'}` JS expressions.
5. **Pariox visit dedup rule** — per `(patient_name, visit_date, staff_name)` keep latest `uploaded_at`. See CLAUDE.md item #10.
6. **Never delete clinical/billing events from `visit_schedule_data`** just because they're missing from a Pariox file. The DB is the system of record. See CLAUDE.md item #11.
7. **Engagement signals must go through `useCoordinatorEngagement` hook.** Don't inline `last_sign_in_at` checks. See CLAUDE.md item #13.
8. **Marketing RLS via `can_access_marketing_region`** — field-marketing roles roam freely; AD/RM gated to assigned regions. See CLAUDE.md item #15.
9. **Auth.users provisioning** — never use raw SQL INSERT. Use `admin-user-actions` Edge Function or User Management UI. See CLAUDE.md item #14.

---

## 8. Where to find me on the next session

I won't be there. Each Claude Code session is a fresh agent. But CLAUDE.md captures the institutional memory — every "thing that broke before" is documented so the next session doesn't repeat the same mistake.

**If you want continuity with this morning's work:** the first message you send the next Claude Code session can say "read CLAUDE.md fully, then check git log for the last 24 hours of commits to catch up on context." That's the equivalent of a Cowork conversation handoff.

---

*Last updated 2026-06-09 by Liam during the Cowork → Claude Code migration.*
