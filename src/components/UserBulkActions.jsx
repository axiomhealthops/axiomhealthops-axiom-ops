// =====================================================================
// UserBulkActions.jsx
//
// Admin-only export + import controls rendered inside the User Management
// TopBar. Replaces the "open a SQL prompt and pray" path for mass user
// changes (email rebrand, terminations, role re-orgs).
//
// 4-phase pattern (mirrors AuthAuditImportPage):
//   1. EXPORT     — download current coordinator + auth state as .xlsx
//   2. UPLOAD     — admin picks an edited .xlsx; parsed client-side
//   3. PREVIEW    — diff each row vs current DB state, side-by-side
//   4. APPLY      — single call to admin-user-actions:bulk_user_migration
//
// Spreadsheet shape (must match the export so a round-trip is lossless):
//   Sheet "User Email Mapping": one row per active coordinator
//     A  Coordinator ID         (immutable PK)
//     B  Full Name              (readonly)
//     C  Current Email          (readonly)
//     D  NEW EdemaCare Email    (editable — yellow)
//     E  Status (auto)          (readonly — informational)
//     F  Role                   (editable — restricted to known roles)
//     G  Secondary Roles        (editable — comma-separated)
//     H  Job Title              (editable)
//     I  Team                   (editable)
//     J  Regions                (editable — comma-separated letters)
//     K  Has Auth Login         (readonly)
//     L  Last Sign-in           (readonly)
//     M  Notes (optional)       (free-text; ignored by importer)
//
//   Sheet "Terminations": one row per coordinator NOT in the email tab,
//     plus any rows where Column D contains the literal token TERMINATE.
//     Column H "DECISION" must equal TERMINATE for the row to be applied.
//
// Safety rails:
//   - Preview is mandatory. No bulk write happens without explicit confirm.
//   - Per-row Edge Function processing — a single broken row never blocks
//     the rest, and every row gets a structured status back.
//   - All actions logged to coordinator_activity_log by the Edge Function.
//   - Email collision check on both coordinators.email and auth.users.email
//     happens server-side before any write.
//   - super_admin protection: editing/terminating super_admin requires
//     the caller themselves be super_admin.
// =====================================================================

import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import {
  USER_MANAGEMENT_ROLE_KEYS as ROLES,
  ROLE_LABELS,
} from '../lib/constants';

const ALL_REGIONS = ['A','B','C','G','H','I','J','M','N','T','V'];

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtDate(s) {
  if (!s) return 'Never';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return d.toISOString().slice(0, 10);
  } catch { return String(s); }
}

function arrToCsv(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.filter(Boolean).join(', ');
}

function csvToArr(s) {
  if (s === null || s === undefined || s === '') return [];
  return String(s).split(/[,;]/).map(t => t.trim()).filter(Boolean);
}

function normRegions(s) {
  return csvToArr(s).map(r => r.toUpperCase()).filter(r => ALL_REGIONS.includes(r));
}

function eq(a, b) {
  const aa = (a ?? '').toString().trim();
  const bb = (b ?? '').toString().trim();
  return aa.toLowerCase() === bb.toLowerCase();
}

function arrEq(a, b) {
  const aa = Array.isArray(a) ? [...a].sort() : [];
  const bb = Array.isArray(b) ? [...b].sort() : [];
  return JSON.stringify(aa) === JSON.stringify(bb);
}

// ─── Export current state to .xlsx ──────────────────────────────────────

async function fetchCurrentUsers() {
  const { data: coords, error: ce } = await supabase
    .from('coordinators')
    .select('id, user_id, full_name, email, role, secondary_roles, job_title, team, regions, is_active, weekly_visit_target, home_timezone')
    .order('is_active', { ascending: false })
    .order('full_name');
  if (ce) throw new Error('Failed to load coordinators: ' + ce.message);

  // Light auth lookup for last_sign_in_at — uses RPC if available, else skips
  let authMap = {};
  try {
    const { data: authRows } = await supabase.rpc('admin_list_user_logins');
    if (Array.isArray(authRows)) {
      authRows.forEach(r => { authMap[r.user_id] = r; });
    }
  } catch {/* RPC optional — UI degrades gracefully */}

  return (coords || []).map(c => ({
    ...c,
    auth_email: authMap[c.user_id]?.email || null,
    last_sign_in_at: authMap[c.user_id]?.last_sign_in_at || null,
    has_auth: !!c.user_id,
  }));
}

function buildWorkbook(users) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: instructions ──
  const instructions = [
    ['EdemaCare User Bulk Update Workbook'],
    [''],
    ['Generated: ' + new Date().toISOString()],
    [''],
    ['How to use:'],
    ['  1. Edit the YELLOW columns on the "User Email Mapping" tab.'],
    ['  2. To migrate an email: type the new @edemacare.com address in column D.'],
    ['  3. To update role/title/team/regions: edit columns F-J.'],
    ['  4. To terminate a user: enter the literal text TERMINATE in column D.'],
    ['  5. Save the file and use Import → pick this file on the User Management page.'],
    ['  6. You will see a preview of every change before anything is written.'],
    [''],
    ['Rules:'],
    ['  - Do NOT modify column A (Coordinator ID). It is the database primary key.'],
    ['  - Leave column D blank to keep the existing email.'],
    ['  - Regions = comma-separated single letters, e.g. "A, B, C".'],
    ['  - Secondary Roles = comma-separated, e.g. "marketing_rep".'],
    ['  - Valid roles: ' + ROLES.join(', ')],
    [''],
    ['What the importer does:'],
    ['  - coordinators.email and auth.users.email are updated together so login keeps working.'],
    ['  - Existing passwords are preserved. Users log in next time with the new email.'],
    ['  - Terminated users get is_active=false and their auth login is banned (data preserved).'],
    ['  - Every change is logged to coordinator_activity_log with caller + timestamp.'],
  ];
  const wsInst = XLSX.utils.aoa_to_sheet(instructions);
  wsInst['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, wsInst, 'READ ME FIRST');

  // ── Sheet 2: User Email Mapping ──
  const header = [
    'Coordinator ID', 'Full Name', 'Current Email', 'NEW EdemaCare Email',
    'Status (auto)', 'Role', 'Secondary Roles', 'Job Title', 'Team',
    'Regions', 'Has Auth Login', 'Last Sign-in', 'Notes (optional)',
  ];
  const rows = [header];
  users.filter(u => u.is_active !== false).forEach(u => {
    const status = (u.email || '').toLowerCase().endsWith('@edemacare.com') ? 'ALREADY MIGRATED' : 'PENDING';
    rows.push([
      u.id,
      u.full_name || '',
      u.email || '',
      '',                                  // NEW email — editable
      status,
      u.role || '',
      arrToCsv(u.secondary_roles),
      u.job_title || '',
      u.team || '',
      arrToCsv(u.regions),
      u.has_auth ? 'YES' : 'NO',
      fmtDate(u.last_sign_in_at),
      '',                                  // Notes — editable
    ]);
  });
  const wsMap = XLSX.utils.aoa_to_sheet(rows);
  wsMap['!cols'] = [
    { wch: 38 }, { wch: 22 }, { wch: 42 }, { wch: 30 }, { wch: 18 },
    { wch: 22 }, { wch: 22 }, { wch: 32 }, { wch: 20 }, { wch: 24 },
    { wch: 14 }, { wch: 14 }, { wch: 30 },
  ];
  wsMap['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsMap, 'User Email Mapping');

  // ── Sheet 3: Terminations (currently-inactive + slot for new ones) ──
  const termHeader = ['Coordinator ID', 'Full Name', 'Current Email', 'Role', 'Regions', 'Has Auth Login', 'Last Sign-in', 'DECISION'];
  const termRows = [termHeader];
  users.filter(u => u.is_active === false).forEach(u => {
    termRows.push([u.id, u.full_name || '', u.email || '', u.role || '', arrToCsv(u.regions), u.has_auth ? 'YES' : 'NO', fmtDate(u.last_sign_in_at), 'ALREADY TERMINATED']);
  });
  const wsTerm = XLSX.utils.aoa_to_sheet(termRows);
  wsTerm['!cols'] = [{ wch: 38 }, { wch: 22 }, { wch: 42 }, { wch: 26 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
  wsTerm['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsTerm, 'Terminations');

  return wb;
}

function downloadWorkbook(wb, filename) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

// ─── Parse uploaded .xlsx and compute the change plan ───────────────────

function parseWorkbook(wb, currentUsers) {
  const byId = new Map(currentUsers.map(u => [u.id, u]));
  const plan = {
    emailUpdates: [],   // { coordinator_id, new_email, current_email, full_name }
    fieldUpdates: [],   // { coordinator_id, full_name, patches: {...}, diffs: [...] }
    terminations: [],   // { coordinator_id, full_name, current_email, source }
    warnings: [],
    rowsSeen: 0,
  };

  // Parse "User Email Mapping" tab
  const mapSheet = wb.Sheets['User Email Mapping'];
  if (mapSheet) {
    const rows = XLSX.utils.sheet_to_json(mapSheet, { header: 1, defval: '' });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cid = String(row[0] || '').trim();
      if (!cid) continue;
      plan.rowsSeen++;
      const cur = byId.get(cid);
      if (!cur) {
        plan.warnings.push('Row ' + (i + 1) + ': coordinator_id "' + cid + '" not found in current users (skipped)');
        continue;
      }

      const newEmailRaw = String(row[3] || '').trim();
      const newEmailLower = newEmailRaw.toLowerCase();

      // TERMINATE token in the email column
      if (newEmailLower === 'terminate') {
        plan.terminations.push({
          coordinator_id: cid,
          full_name: cur.full_name,
          current_email: cur.email,
          source: 'User Email Mapping tab (TERMINATE token)',
        });
        continue;
      }

      // Email update
      if (newEmailRaw && !eq(newEmailRaw, cur.email)) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmailRaw)) {
          plan.warnings.push(cur.full_name + ': new email "' + newEmailRaw + '" is not a valid email — skipped');
        } else {
          plan.emailUpdates.push({
            coordinator_id: cid,
            full_name: cur.full_name,
            current_email: cur.email,
            new_email: newEmailLower,
            has_auth: cur.has_auth,
          });
        }
      }

      // Field patches
      const newRole = String(row[5] || '').trim();
      const newSecondary = String(row[6] || '');
      const newJobTitle = String(row[7] || '').trim();
      const newTeam = String(row[8] || '').trim();
      const newRegionsRaw = String(row[9] || '');

      const patches = {};
      const diffs = [];

      if (newRole && newRole !== cur.role) {
        if (!ROLES.includes(newRole)) {
          plan.warnings.push(cur.full_name + ': role "' + newRole + '" is not a known role — skipped');
        } else {
          patches.role = newRole;
          diffs.push({ field: 'role', from: cur.role, to: newRole });
        }
      }

      const newSecondaryArr = csvToArr(newSecondary);
      if (!arrEq(newSecondaryArr, cur.secondary_roles || [])) {
        patches.secondary_roles = newSecondaryArr;
        diffs.push({ field: 'secondary_roles', from: arrToCsv(cur.secondary_roles), to: arrToCsv(newSecondaryArr) });
      }

      if (newJobTitle !== (cur.job_title || '')) {
        patches.job_title = newJobTitle || null;
        diffs.push({ field: 'job_title', from: cur.job_title || '(empty)', to: newJobTitle || '(empty)' });
      }

      if (newTeam !== (cur.team || '')) {
        patches.team = newTeam || null;
        diffs.push({ field: 'team', from: cur.team || '(empty)', to: newTeam || '(empty)' });
      }

      const newRegionsArr = normRegions(newRegionsRaw);
      if (!arrEq(newRegionsArr, cur.regions || [])) {
        patches.regions = newRegionsArr;
        diffs.push({ field: 'regions', from: arrToCsv(cur.regions), to: arrToCsv(newRegionsArr) });
      }

      if (diffs.length > 0) {
        plan.fieldUpdates.push({
          coordinator_id: cid,
          full_name: cur.full_name,
          patches,
          diffs,
        });
      }
    }
  } else {
    plan.warnings.push('No "User Email Mapping" sheet found in workbook.');
  }

  // Parse "Terminations" tab — only rows where DECISION column = TERMINATE
  const termSheet = wb.Sheets['Terminations'];
  if (termSheet) {
    const rows = XLSX.utils.sheet_to_json(termSheet, { header: 1, defval: '' });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cid = String(row[0] || '').trim();
      const decision = String(row[7] || '').trim().toUpperCase();
      if (!cid || decision !== 'TERMINATE') continue;
      const cur = byId.get(cid);
      if (!cur) {
        plan.warnings.push('Terminations row ' + (i + 1) + ': coordinator_id "' + cid + '" not found — skipped');
        continue;
      }
      // De-dup with email-tab terminations
      if (!plan.terminations.find(t => t.coordinator_id === cid)) {
        plan.terminations.push({
          coordinator_id: cid,
          full_name: cur.full_name,
          current_email: cur.email,
          source: 'Terminations tab',
        });
      }
    }
  }

  return plan;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function UserBulkActions({ onComplete }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [plan, setPlan] = useState(null);   // parsed change plan awaiting confirmation
  const [result, setResult] = useState(null); // edge function response after apply

  async function handleExport() {
    setBusy(true); setMsg('Building workbook...');
    try {
      const users = await fetchCurrentUsers();
      const wb = buildWorkbook(users);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadWorkbook(wb, 'EdemaCare_Users_' + stamp + '.xlsx');
      setMsg('Exported ' + users.length + ' users.');
      setTimeout(() => setMsg(''), 4000);
    } catch (e) {
      setMsg('Export failed: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function handlePickFile() {
    setResult(null);
    fileRef.current?.click();
  }

  async function handleFileChange(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = ''; // allow re-selecting same file
    if (!file) return;
    setBusy(true); setMsg('Reading ' + file.name + '...');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const users = await fetchCurrentUsers();
      const p = parseWorkbook(wb, users);
      setPlan(p);
      setMsg('');
    } catch (e) {
      setMsg('Parse failed: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!plan) return;
    setBusy(true); setMsg('Applying changes...');

    // Build payload: combine email + field updates by coordinator_id
    const merged = new Map();
    plan.emailUpdates.forEach(e => {
      merged.set(e.coordinator_id, { coordinator_id: e.coordinator_id, new_email: e.new_email });
    });
    plan.fieldUpdates.forEach(f => {
      const existing = merged.get(f.coordinator_id) || { coordinator_id: f.coordinator_id };
      existing.patches = f.patches;
      merged.set(f.coordinator_id, existing);
    });
    const updates = Array.from(merged.values());
    const terminations = plan.terminations.map(t => t.coordinator_id);

    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'bulk_user_migration', updates, terminations },
      });
      if (error) {
        let detail = error.message;
        try { detail = (await error.context?.json?.())?.error || detail; } catch {}
        setMsg('Apply failed: ' + detail);
        setBusy(false);
        return;
      }
      if (!data?.success) {
        setMsg('Apply failed: ' + (data?.error || 'Unknown error'));
        setBusy(false);
        return;
      }
      setResult(data.results);
      setPlan(null);
      setMsg('');
      if (onComplete) onComplete();
    } catch (e) {
      setMsg('Apply failed: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function closeAll() {
    setPlan(null);
    setResult(null);
    setMsg('');
  }

  // ─── Render ───
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {msg && (
          <span style={{ fontSize: 12, color: msg.includes('failed') ? '#DC2626' : '#475569', fontWeight: 500 }}>
            {msg}
          </span>
        )}
        <button
          onClick={handleExport}
          disabled={busy}
          title="Download current user list as Excel"
          style={{ padding: '7px 14px', background: 'var(--card-bg)', color: 'var(--black)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Working...' : 'Export Users'}
        </button>
        <button
          onClick={handlePickFile}
          disabled={busy}
          title="Import an edited workbook to update users in bulk"
          style={{ padding: '7px 14px', background: 'var(--card-bg)', color: 'var(--black)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          Import Users
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} style={{ display: 'none' }} />
      </div>

      {plan && <PreviewModal plan={plan} busy={busy} onCancel={closeAll} onApply={handleApply} />}
      {result && <ResultModal result={result} onClose={closeAll} />}
    </>
  );
}

// ─── Preview modal ──────────────────────────────────────────────────────

function PreviewModal({ plan, busy, onCancel, onApply }) {
  const totalChanges = plan.emailUpdates.length + plan.fieldUpdates.length + plan.terminations.length;

  return (
    <ModalShell onClose={onCancel} title="Preview Bulk Changes">
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, alignItems: 'center', fontSize: 12, color: 'var(--gray)' }}>
        <span><strong style={{ color: 'var(--black)' }}>{plan.rowsSeen}</strong> rows scanned</span>
        <span>{'•'}</span>
        <span><strong style={{ color: '#0369A1' }}>{plan.emailUpdates.length}</strong> email updates</span>
        <span>{'•'}</span>
        <span><strong style={{ color: '#7C3AED' }}>{plan.fieldUpdates.length}</strong> field updates</span>
        <span>{'•'}</span>
        <span><strong style={{ color: '#DC2626' }}>{plan.terminations.length}</strong> terminations</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {totalChanges === 0 && plan.warnings.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>
            No changes detected. The uploaded file matches the current database state.
          </div>
        )}

        {plan.warnings.length > 0 && (
          <Section title="Warnings" tint="#FFFBEB" border="#F59E0B">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#78350F' }}>
              {plan.warnings.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
            </ul>
          </Section>
        )}

        {plan.emailUpdates.length > 0 && (
          <Section title={'Email updates (' + plan.emailUpdates.length + ')'} tint="#EFF6FF" border="#0369A1">
            <DiffTable
              cols={['Name', 'Current Email', 'New Email', 'Auth?']}
              rows={plan.emailUpdates.map(e => [
                e.full_name,
                e.current_email,
                e.new_email,
                e.has_auth ? 'will update both' : 'coord only (no auth)',
              ])}
            />
          </Section>
        )}

        {plan.fieldUpdates.length > 0 && (
          <Section title={'Field updates (' + plan.fieldUpdates.length + ')'} tint="#F5F3FF" border="#7C3AED">
            {plan.fieldUpdates.map(f => (
              <div key={f.coordinator_id} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px dashed var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--black)', marginBottom: 4 }}>{f.full_name}</div>
                {f.diffs.map((d, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--gray)', display: 'flex', gap: 8, marginLeft: 12 }}>
                    <span style={{ fontWeight: 600, minWidth: 110 }}>{d.field}:</span>
                    <span style={{ textDecoration: 'line-through', color: '#9CA3AF' }}>{String(d.from) || '(empty)'}</span>
                    <span>{'→'}</span>
                    <span style={{ color: '#0369A1', fontWeight: 500 }}>{String(d.to) || '(empty)'}</span>
                  </div>
                ))}
              </div>
            ))}
          </Section>
        )}

        {plan.terminations.length > 0 && (
          <Section title={'Terminations (' + plan.terminations.length + ')'} tint="#FEF2F2" border="#DC2626">
            <DiffTable
              cols={['Name', 'Current Email', 'Source']}
              rows={plan.terminations.map(t => [t.full_name, t.current_email, t.source])}
            />
            <div style={{ marginTop: 8, fontSize: 11, color: '#991B1B' }}>
              Terminations soft-delete the coordinator (is_active=false) and ban the auth login. Historical data, patient assignments, and audit logs are preserved.
            </div>
          </Section>
        )}
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#FAFAFA' }}>
        <button onClick={onCancel} disabled={busy} style={{ padding: '8px 16px', background: 'var(--card-bg)', color: 'var(--black)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>Cancel</button>
        <button onClick={onApply} disabled={busy || totalChanges === 0}
          style={{ padding: '8px 18px', background: totalChanges === 0 ? 'var(--border)' : 'var(--red)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: busy || totalChanges === 0 ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Applying...' : 'Apply ' + totalChanges + ' Changes'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Result modal ───────────────────────────────────────────────────────

function ResultModal({ result, onClose }) {
  const sum = (arr, status) => arr.filter(r => r.status === status).length;
  const eOK = sum(result.email_updates || [], 'success');
  const eErr = sum(result.email_updates || [], 'error');
  const pOK = sum(result.patch_updates || [], 'success');
  const pErr = sum(result.patch_updates || [], 'error');
  const tOK = sum(result.terminations || [], 'success');
  const tErr = sum(result.terminations || [], 'error');
  const tWarn = sum(result.terminations || [], 'warning');

  return (
    <ModalShell onClose={onClose} title="Bulk Update Complete">
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--gray)' }}>
        Applied by <strong style={{ color: 'var(--black)' }}>{result.caller}</strong> at {fmtDate(result.completed_at)}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          <ResultCard label="Emails" ok={eOK} err={eErr} total={(result.email_updates || []).length} />
          <ResultCard label="Field Patches" ok={pOK} err={pErr} total={(result.patch_updates || []).length} />
          <ResultCard label="Terminations" ok={tOK} err={tErr} warn={tWarn} total={(result.terminations || []).length} />
        </div>

        {(result.email_updates || []).length > 0 && (
          <Section title="Email updates" tint="#EFF6FF" border="#0369A1">
            <ResultTable rows={result.email_updates} keyField="new_email" />
          </Section>
        )}
        {(result.patch_updates || []).length > 0 && (
          <Section title="Field patches" tint="#F5F3FF" border="#7C3AED">
            <ResultTable rows={result.patch_updates.map(p => ({ ...p, new_email: p.fields?.join(', ') || '' }))} keyField="new_email" />
          </Section>
        )}
        {(result.terminations || []).length > 0 && (
          <Section title="Terminations" tint="#FEF2F2" border="#DC2626">
            <ResultTable rows={result.terminations} keyField="coordinator_id" />
          </Section>
        )}
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: '#FAFAFA' }}>
        <button onClick={onClose} style={{ padding: '8px 18px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Close</button>
      </div>
    </ModalShell>
  );
}

function ResultCard({ label, ok, err, warn = 0, total }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--gray)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#065F46' }}>{ok}</span>
        <span style={{ fontSize: 11, color: 'var(--gray)' }}>of {total} succeeded</span>
      </div>
      {(err > 0 || warn > 0) && (
        <div style={{ marginTop: 4, fontSize: 11, color: err > 0 ? '#DC2626' : '#D97706', fontWeight: 600 }}>
          {err > 0 && err + ' error' + (err === 1 ? '' : 's')}
          {err > 0 && warn > 0 && ', '}
          {warn > 0 && warn + ' warning' + (warn === 1 ? '' : 's')}
        </div>
      )}
    </div>
  );
}

function ResultTable({ rows, keyField }) {
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={th}>Name</th>
          <th style={th}>Detail</th>
          <th style={th}>Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px dashed var(--border)' }}>
            <td style={td}>{r.full_name || '(unknown)'}</td>
            <td style={td}>{r[keyField] || ''}</td>
            <td style={{ ...td, color: r.status === 'success' ? '#065F46' : r.status === 'warning' ? '#D97706' : '#DC2626', fontWeight: 600 }}>
              {r.status.toUpperCase()}: {r.message}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Small UI primitives ────────────────────────────────────────────────

function ModalShell({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card-bg)', borderRadius: 14, maxWidth: 980, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--gray)' }}>{'✕'}</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ title, tint, border, children }) {
  return (
    <div style={{ background: tint, border: '1px solid ' + border, borderLeft: '4px solid ' + border, borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: border, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>
      {children}
    </div>
  );
}

function DiffTable({ cols, rows }) {
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          {cols.map((c, i) => <th key={i} style={th}>{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px dashed var(--border)' }}>
            {r.map((cell, j) => <td key={j} style={td}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 };
const td = { padding: '6px 8px', fontSize: 12, color: 'var(--black)', verticalAlign: 'top' };
