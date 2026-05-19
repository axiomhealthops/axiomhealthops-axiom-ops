import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import PatientNotesPanel from '../../components/PatientNotesPanel';
import { supabase, safeUpdate, logActivity, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
 
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
}
function urgencyColor(days) {
  if (days === null) return '#6B7280';
  if (days <= 0)  return '#DC2626';
  if (days <= 7)  return '#DC2626';
  if (days <= 14) return '#D97706';
  return '#059669';
}
 
function AuthEditModal({ auth, onClose, onSaved, profileName, allAuths }) {
  const [form, setForm] = useState({
    auth_status: auth.auth_status || 'pending',
    auth_number: auth.auth_number || '',
    auth_discipline: auth.auth_discipline || '',
    auth_submitted_date: auth.auth_submitted_date || '',
    auth_approved_date: auth.auth_approved_date || '',
    auth_expiry_date: auth.auth_expiry_date || '',
    visits_authorized: auth.visits_authorized || '',
    visits_used: auth.visits_used || '',
    notes: auth.notes || '',
    denial_reason: auth.denial_reason || '',
    assigned_to: auth.assigned_to || profileName || '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [dupWarning, setDupWarning] = useState(null);

  // Escape-to-close (disabled while saving)
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);
 
  // ── Duplicate detection ──────────────────────────────────────────────────
  function checkForDuplicates() {
    if (!allAuths || !allAuths.length) return null;
    const dupes = allAuths.filter(a => {
      if (a.id === auth.id) return false; // skip self
      const nameMatch = a.patient_name && auth.patient_name &&
        a.patient_name.toLowerCase().trim() === auth.patient_name.toLowerCase().trim();
      const authNumMatch = form.auth_number && a.auth_number &&
        a.auth_number.trim().toLowerCase() === form.auth_number.trim().toLowerCase();
      const dobMatch = a.dob && auth.dob && a.dob === auth.dob;
      // Flag if: same auth number, OR same patient + same DOB + same discipline
      if (authNumMatch && form.auth_number.trim()) return true;
      if (nameMatch && dobMatch && form.auth_discipline && a.auth_discipline === form.auth_discipline) return true;
      return false;
    });
    return dupes.length > 0 ? dupes : null;
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setDupWarning(null);

    // Client-side validation — catches the data integrity issues the audit surfaced
    const va = form.visits_authorized ? parseInt(form.visits_authorized) : null;
    const vu = form.visits_used ? parseInt(form.visits_used) : null;
    if (va !== null && va < 0) { setSaveError('Visits authorized cannot be negative.'); setSaving(false); return; }
    if (vu !== null && vu < 0) { setSaveError('Visits used cannot be negative.'); setSaving(false); return; }
    if (va !== null && vu !== null && vu > va) {
      setSaveError(`Visits used (${vu}) exceeds visits authorized (${va}). Correct before saving.`);
      setSaving(false); return;
    }
    if (form.auth_approved_date && form.auth_expiry_date && form.auth_approved_date > form.auth_expiry_date) {
      setSaveError('Auth approved date is after expiry date. Check for typos (e.g. year).');
      setSaving(false); return;
    }
    if (form.auth_submitted_date && form.auth_approved_date && form.auth_submitted_date > form.auth_approved_date) {
      setSaveError('Auth submitted date is after approved date. Check for typos.');
      setSaving(false); return;
    }
    // Reject obviously bad year typos (e.g. 20226-03-31)
    for (const f of ['auth_submitted_date','auth_approved_date','auth_expiry_date']) {
      const v = form[f];
      if (v && (v.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(v))) {
        setSaveError(`Invalid date format on ${f.replace(/_/g,' ')}: "${v}". Use YYYY-MM-DD.`);
        setSaving(false); return;
      }
    }

    // ── Duplicate check before saving ──
    const dupes = checkForDuplicates();
    if (dupes && !dupWarning) {
      setDupWarning(dupes);
      setSaving(false);
      return; // user must confirm to proceed
    }

    const { error, rowCount } = await safeUpdate('auth_tracker', {
      ...form,
      auth_discipline: form.auth_discipline || null,
      visits_authorized: va,
      visits_used: vu,
      auth_submitted_date: form.auth_submitted_date || null,
      auth_approved_date: form.auth_approved_date || null,
      auth_expiry_date: form.auth_expiry_date || null,
      updated_at: new Date().toISOString(),
      updated_by: profileName || null,
    }, { id: auth.id });
 
    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }
 
    // Recompute sequence so visits_used / status changes propagate to is_currently_active
    if (auth.patient_name) {
      const { error: rpcErr } = await supabase.rpc('recompute_auth_sequence', { p_patient_name: auth.patient_name });
      if (rpcErr) console.warn('recompute_auth_sequence failed:', rpcErr.message);
    }
 
    setSaving(false);
    onSaved();
  }
 
  const STATUSES = [
    { k: 'active',         l: 'Active',          c: '#059669', bg: '#ECFDF5' },
    { k: 'pending',        l: 'Pending',         c: '#D97706', bg: '#FEF3C7' },
    { k: 'submitted',      l: 'Submitted',       c: '#1E40AF', bg: '#EFF6FF' },
    { k: 'renewal_needed', l: 'Renewal Needed',  c: '#991B1B', bg: '#FEF2F2' },
    { k: 'appealing',      l: 'Appealing',       c: '#7C3AED', bg: '#EDE9FE' },
    { k: 'on_hold',        l: 'On Hold',         c: '#374151', bg: '#F3F4F6' },
    { k: 'denied',         l: 'Denied',          c: '#DC2626', bg: '#FEF2F2' },
    { k: 'discharged',     l: 'Discharged',      c: '#6B7280', bg: '#F3F4F6' },
  ];
 
  return (
    // 2026-05-18: Modal rebuilt for responsive fit on all viewports.
    // Outer overlay = fixed positioning (no page scroll). Inner modal caps at
    // 92vw / 90vh and scrolls INTERNALLY via the body section. Header + footer
    // stay pinned so Save button is always reachable.
    <div onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:2000,
        display:'flex', alignItems:'center', justifyContent:'center',
        padding:'clamp(8px, 2vw, 24px)',
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background:'var(--card-bg)', borderRadius:14,
          width:'100%',
          maxWidth: 820,           // wide enough on desktop for the 2-column grid + notes
          maxHeight: '92vh',       // cap height; body scrolls if content overflows
          display:'flex', flexDirection:'column',
          boxShadow:'0 24px 60px rgba(0,0,0,0.4)',
          overflow:'hidden',
        }}>
        {/* HEADER — pinned */}
        <div style={{ padding:'14px 20px', background:'#0F1117', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{auth.patient_name}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {auth.insurance} · Region {auth.region} · Member ID: {auth.member_id || '—'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.5)', marginLeft:8, flexShrink:0 }}>×</button>
        </div>

        {/* BODY — scrolls internally. 2-col grid drops to 1-col below 640px via the auto-fit minmax. */}
        <div style={{
          padding:'16px 20px',
          display:'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap:12,
          flex:1, overflowY:'auto', minHeight:0,
        }}>
          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:8 }}>Auth Status</label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {STATUSES.map(s => (
                <button key={s.k} onClick={() => setForm(f=>({...f, auth_status:s.k}))}
                  style={{ padding:'6px 10px', borderRadius:6, border:`2px solid ${form.auth_status===s.k?s.c:'var(--border)'}`, background:form.auth_status===s.k?s.bg:'var(--card-bg)', fontSize:10, fontWeight:700, color:form.auth_status===s.k?s.c:'var(--gray)', cursor:'pointer', whiteSpace:'nowrap' }}>
                  {s.l}
                </button>
              ))}
            </div>
          </div>
 
          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:8 }}>Auth Discipline</label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[
                { k: 'PT',    l: 'PT',    c: '#1565C0', bg: '#EFF6FF', desc: 'Physical Therapy' },
                { k: 'OT',    l: 'OT',    c: '#7C3AED', bg: '#EDE9FE', desc: 'Occupational Therapy' },
                { k: 'PT/OT', l: 'PT/OT', c: '#059669', bg: '#ECFDF5', desc: 'Both PT & OT' },
                { k: 'PTA',   l: 'PTA',   c: '#0891B2', bg: '#ECFEFF', desc: 'PT Assistant' },
                { k: 'COTA',  l: 'COTA',  c: '#DB2777', bg: '#FDF2F8', desc: 'OT Assistant' },
              ].map(d => (
                <button key={d.k} onClick={() => setForm(f=>({...f, auth_discipline:f.auth_discipline===d.k?'':d.k}))}
                  title={d.desc}
                  style={{ padding:'6px 12px', borderRadius:6, border:`2px solid ${form.auth_discipline===d.k?d.c:'var(--border)'}`, background:form.auth_discipline===d.k?d.bg:'var(--card-bg)', fontSize:11, fontWeight:700, color:form.auth_discipline===d.k?d.c:'var(--gray)', cursor:'pointer', whiteSpace:'nowrap' }}>
                  {d.l}
                </button>
              ))}
            </div>
            {!form.auth_discipline && (
              <div style={{ fontSize:10, color:'#D97706', marginTop:6, fontWeight:500 }}>⚠ Discipline not set — specify PT or OT so clinician assignments are correct</div>
            )}
          </div>

          {[
            { label:'Auth Number', field:'auth_number', type:'text', placeholder:'Auth #...' },
            { label:'Assigned To', field:'assigned_to', type:'text', placeholder:'Coordinator name...' },
            { label:'Auth Requested / Submit Date', field:'auth_submitted_date', type:'date' },
            { label:'Approved Date', field:'auth_approved_date', type:'date' },
            { label:'Expiry Date', field:'auth_expiry_date', type:'date' },
            { label:'Visits Authorized', field:'visits_authorized', type:'number' },
            { label:'Visits Used', field:'visits_used', type:'number' },
            { label:'Denial Reason', field:'denial_reason', type:'text', placeholder:'If denied...' },
          ].map(f => (
            <div key={f.field}>
              <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>{f.label}</label>
              <input type={f.type} value={form[f.field]} onChange={e => setForm(p=>({...p,[f.field]:e.target.value}))}
                placeholder={f.placeholder}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
          ))}
 
          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p=>({...p, notes:e.target.value}))}
              placeholder="Payer call notes, auth number, submission portal used, follow-up needed..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:70, background:'var(--card-bg)' }} />
          </div>

          {/* Patient chart notes — moved INSIDE scrollable body (was in footer,
              which pushed Save button off-screen on small viewports). */}
          <div style={{ gridColumn:'1/-1', marginTop:4 }}>
            <PatientNotesPanel patientName={auth.patient_name} maxHeight="220px" />
          </div>
        </div>

        {/* FOOTER — pinned. Compact. Errors + duplicate warnings + Save/Cancel only. */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:8, background:'var(--bg)', flexShrink:0 }}>
          {saveError && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FCA5A5', color:'#991B1B', padding:'7px 11px', borderRadius:6, fontSize:12, fontWeight:600 }}>
              ⚠ {saveError}
            </div>
          )}
          {dupWarning && (
            <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', color:'#92400E', padding:'10px 12px', borderRadius:8, fontSize:12 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>⚠ Potential Duplicate Detected</div>
              <div style={{ fontSize:11, marginBottom:8, maxHeight:120, overflowY:'auto' }}>
                {dupWarning.map((d, i) => (
                  <div key={i} style={{ padding:'4px 0', borderBottom: i < dupWarning.length-1 ? '1px solid #FDE68A' : 'none' }}>
                    <strong>{d.patient_name}</strong> — Auth #{d.auth_number || 'N/A'} · {d.auth_discipline || 'No discipline'} · {d.auth_status} · Expires {d.auth_expiry_date || 'N/A'}
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                <button onClick={() => { setDupWarning(null); setSaving(true); save(); }}
                  style={{ padding:'5px 12px', background:'#92400E', color:'#fff', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                  Save Anyway — Not a Duplicate
                </button>
                <button onClick={() => setDupWarning(null)}
                  style={{ padding:'5px 12px', background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  Cancel — I'll Review
                </button>
              </div>
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, flexWrap:'wrap' }}>
            <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, cursor:'pointer', background:'var(--card-bg)' }}>Cancel</button>
            <button onClick={save} disabled={saving}
              style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:saving?'wait':'pointer', opacity:saving?0.7:1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
 
// =====================================================================
// AuthCoordDashboard — REBUILT 2026-05-17
//
// Mirrors the CoordinatorPage 2-column workflow pattern Mary uses, but
// adapted for the auth team's actual job (manage authorizations, not
// patient care). Per Liam:
//   - Auth coords are assigned by REGION
//   - Renewal pipeline is their most painful daily task
//   - They want INLINE EDITING to replace modal-heavy workflow
//   - This is their LANDING PAGE
//
// Layout:
//   LEFT col (2/3, scrolls):
//     - "My Queue" — auths assigned to me, sorted by urgency
//     - Insurance carrier tabs (Medicare / Aetna / Humana / CarePlus / Other)
//     - Inline status toggle on each row (no modal for status changes)
//     - Click row for full edit modal (for non-status fields)
//   RIGHT col (340px, sticky):
//     - Today's Actions checklist (renewals 7d / stalled / denials / unassigned)
//     - Personal KPIs (my queue size, approval rate, median days)
//     - Recent activity feed (last 10 actions I took today)
// =====================================================================

// Insurance carrier groupings — used for the carrier-tab filter.
// Lowercased substring matching: "Medicare" matches "M - Medicare", etc.
const INSURANCE_BUCKETS = [
  { key: 'ALL',       label: 'All' },
  { key: 'MEDICARE',  label: 'Medicare',  patterns: ['medicare'] },
  { key: 'AETNA',     label: 'Aetna',     patterns: ['aetna'] },
  { key: 'HUMANA',    label: 'Humana',    patterns: ['humana', 'careplus'] }, // CarePlus is Humana-owned
  { key: 'CIGNA',     label: 'Cigna',     patterns: ['cigna'] },
  { key: 'DEVOTED',   label: 'Devoted',   patterns: ['devoted'] },
  { key: 'BCBS',      label: 'BCBS',      patterns: ['bcbs', 'blue cross', 'blue shield'] },
  { key: 'OTHER',     label: 'Other',     patterns: null }, // catch-all
];
function bucketFor(insurance) {
  if (!insurance) return 'OTHER';
  var lo = String(insurance).toLowerCase();
  for (var i = 1; i < INSURANCE_BUCKETS.length - 1; i++) { // skip ALL + OTHER
    if (INSURANCE_BUCKETS[i].patterns.some(function(p) { return lo.indexOf(p) >= 0; })) {
      return INSURANCE_BUCKETS[i].key;
    }
  }
  return 'OTHER';
}

export default function AuthCoordDashboard() {
  const { profile } = useAuth();
  const [auths, setAuths] = useState([]);
  const [renewalTasks, setRenewalTasks] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [loading, setLoading] = useState(true);
  // Filter state — "My Queue" toggle, insurance carrier, action filter
  const [myQueueOnly, setMyQueueOnly] = useState(true);
  const [carrierTab, setCarrierTab] = useState('ALL');
  const [actionFilter, setActionFilter] = useState(null); // null | 'renewals_7d' | 'stalled' | 'unassigned' | 'denied'
  const [search, setSearch] = useState('');
  const [editAuth, setEditAuth] = useState(null);
  const [savingStatusId, setSavingStatusId] = useState(null);

  const profileName = profile?.full_name || profile?.email || '';
  const isAdminView = ['super_admin','admin','ceo','director'].indexOf(profile?.role) >= 0;
  const regionScope = useAssignedRegions();

  const load = useCallback(async () => {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setAuths([]); setRenewalTasks([]); setLoading(false); return;
    }
    // Pull auths, renewal tasks, AND today's activity (for self-accountability widget)
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const [a, r, al] = await Promise.all([
      fetchAllPages(regionScope.applyToQuery(supabase.from('auth_tracker').select('*').order('auth_expiry_date', { ascending: true }))),
      fetchAllPages(regionScope.applyToQuery(supabase.from('auth_renewal_tasks').select('*').not('task_status', 'in', '("approved","denied","closed")').order('days_until_expiry', { ascending: true }))),
      // 2026-05-19: use canonical column names (table_name, record_id, action_detail).
      // Legacy aliases (resource_type, resource_id, detail) are still maintained
      // by a DB trigger as a safety net but new code should use canonical names.
      fetchAllPages(supabase.from('coordinator_activity_log')
        .select('coordinator_name,action_type,table_name,record_id,action_detail,created_at')
        .eq('coordinator_name', profileName)
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: false })),
    ]);
    setAuths(a || []);
    setRenewalTasks(r || []);
    setActivityLog(al || []);
    setLoading(false);
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions), profileName]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['auth_tracker', 'auth_renewal_tasks', 'coordinator_activity_log'], load);

  // ── Inline status toggle — no modal needed for the common case ─────────
  // Used by the row-level status pill buttons. Updates auth_status and
  // logs the change so it shows in the Recent Activity widget immediately.
  async function quickToggleStatus(authId, currentStatus, newStatus) {
    if (currentStatus === newStatus) return;
    setSavingStatusId(authId);
    try {
      // 2026-05-19 BUG FIX: safeUpdate signature is (table, payload, matchObj).
      // Previously called with (table, authId, payload) which silently failed
      // because authId-as-payload is a string, and safeUpdate rejects non-object
      // payloads. UI updated optimistically but DB never changed.
      const { error: updErr, rowCount } = await safeUpdate(
        'auth_tracker',
        {
          auth_status: newStatus,
          updated_at: new Date().toISOString(),
          updated_by: profileName,
        },
        { id: authId }
      );
      if (updErr || rowCount === 0) {
        throw new Error(updErr?.message || 'No row updated — refresh and retry');
      }
      // Optimistic UI update so the change is instant
      setAuths(function(prev) { return prev.map(function(a) { return a.id === authId ? Object.assign({}, a, { auth_status: newStatus }) : a; }); });
      // Log so it shows in Recent Activity sidebar — use canonical field names.
      try {
        await logActivity({
          coordinatorId: profile?.id,
          coordinatorName: profileName,
          coordinatorRole: profile?.role,
          actionType: 'auth_status_change',
          tableName: 'auth_tracker',
          recordId: authId,
          actionDetail: 'Status: ' + currentStatus + ' -> ' + newStatus,
        });
      } catch (e) { /* non-blocking */ }
    } catch (err) {
      console.error('quickToggleStatus failed:', err);
      alert('Status update failed: ' + (err.message || err));
    }
    setSavingStatusId(null);
  }

  const enriched = useMemo(() => auths.map(a => ({
    ...a,
    daysUntilExpiry: daysUntil(a.auth_expiry_date),
    daysSinceSubmitted: a.auth_submitted_date ? Math.floor((Date.now() - new Date(a.auth_submitted_date + 'T00:00:00').getTime()) / 86400000) : null,
    visitsRemaining: Math.max(0, (a.visits_authorized || 0) - (a.visits_used || 0)),
    utilizationPct: a.visits_authorized > 0 ? Math.round((a.visits_used / a.visits_authorized) * 100) : 0,
    carrier: bucketFor(a.insurance),
    isMine: !!(a.assigned_to && profileName && a.assigned_to.toLowerCase().trim() === profileName.toLowerCase().trim()),
  })), [auths, profileName]);

  // Personal stats for the right-sidebar KPI block
  const myStats = useMemo(() => {
    const mine = enriched.filter(a => a.isMine);
    const approved = mine.filter(a => /^(active|approved)$/i.test(a.auth_status || '')).length;
    const totalDecided = mine.filter(a => /^(active|approved|denied)$/i.test(a.auth_status || '')).length;
    const lags = mine
      .filter(a => a.auth_submitted_date && a.auth_approved_date)
      .map(a => {
        const s = new Date(a.auth_submitted_date + 'T00:00:00');
        const e = new Date(a.auth_approved_date + 'T00:00:00');
        return Math.round((e - s) / 86400000);
      })
      .filter(d => d >= 0);
    const medianLag = lags.length > 0 ? lags.sort((x,y) => x-y)[Math.floor(lags.length/2)] : null;
    return {
      myQueueSize: mine.length,
      myApprovalRate: totalDecided > 0 ? Math.round((approved / totalDecided) * 100) : null,
      myMedianDays: medianLag,
      myActionsToday: activityLog.length,
    };
  }, [enriched, activityLog]);

  // Counts for "Today's Actions" checklist (right sidebar)
  const actionCounts = useMemo(() => {
    const scope = myQueueOnly ? enriched.filter(a => a.isMine) : enriched;
    return {
      renewals_7d:  scope.filter(a => /^(active|approved)$/i.test(a.auth_status || '') && a.daysUntilExpiry !== null && a.daysUntilExpiry <= 7).length,
      stalled:      scope.filter(a => /^(submitted|pending)$/i.test(a.auth_status || '') && a.daysSinceSubmitted !== null && a.daysSinceSubmitted > 5).length,
      unassigned:   enriched.filter(a => !a.assigned_to && /^(submitted|pending)$/i.test(a.auth_status || '')).length, // always all, since these need triage
      denied:       scope.filter(a => /^(denied|denial)$/i.test(a.auth_status || '')).length,
    };
  }, [enriched, myQueueOnly]);

  // Top stats for the urgent banner / header
  const stats = useMemo(() => {
    const active = enriched.filter(a => /^(active|approved)$/i.test(a.auth_status || ''));
    return {
      totalActive: active.length,
      expiringToday: active.filter(a => a.daysUntilExpiry !== null && a.daysUntilExpiry <= 0).length,
      expiring7: active.filter(a => a.daysUntilExpiry !== null && a.daysUntilExpiry > 0 && a.daysUntilExpiry <= 7).length,
      urgentRenewals: renewalTasks.filter(r => r.priority === 'urgent').length,
    };
  }, [enriched, renewalTasks]);

  // Main filtered list — what shows in the LEFT column
  const filtered = useMemo(() => {
    let list = enriched;
    if (myQueueOnly && !isAdminView) list = list.filter(a => a.isMine);
    if (myQueueOnly && isAdminView)  list = list.filter(a => a.isMine);
    if (carrierTab !== 'ALL')        list = list.filter(a => a.carrier === carrierTab);
    if (actionFilter === 'renewals_7d') list = list.filter(a => /^(active|approved)$/i.test(a.auth_status || '') && a.daysUntilExpiry !== null && a.daysUntilExpiry <= 7);
    if (actionFilter === 'stalled')     list = list.filter(a => /^(submitted|pending)$/i.test(a.auth_status || '') && a.daysSinceSubmitted !== null && a.daysSinceSubmitted > 5);
    if (actionFilter === 'unassigned')  list = list.filter(a => !a.assigned_to && /^(submitted|pending)$/i.test(a.auth_status || ''));
    if (actionFilter === 'denied')      list = list.filter(a => /^(denied|denial)$/i.test(a.auth_status || ''));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a => `${a.patient_name} ${a.insurance} ${a.auth_number||''} ${a.region||''}`.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (a.daysUntilExpiry ?? 999) - (b.daysUntilExpiry ?? 999));
  }, [enriched, myQueueOnly, isAdminView, carrierTab, actionFilter, search]);

  // Carrier tab counts for the carrier strip
  const carrierCounts = useMemo(() => {
    var pre = enriched;
    if (myQueueOnly && !isAdminView) pre = pre.filter(a => a.isMine);
    if (myQueueOnly && isAdminView)  pre = pre.filter(a => a.isMine);
    var out = { ALL: pre.length };
    INSURANCE_BUCKETS.forEach(b => { if (b.key !== 'ALL') out[b.key] = pre.filter(a => a.carrier === b.key).length; });
    return out;
  }, [enriched, myQueueOnly, isAdminView]);

  // Pending Follow-Up list — auths submitted but not approved, with last-touch info
  const followUpList = useMemo(() => {
    var scope = myQueueOnly ? enriched.filter(a => a.isMine) : enriched;
    return scope
      .filter(a => /^(submitted|pending)$/i.test(a.auth_status || '') && a.daysSinceSubmitted !== null && a.daysSinceSubmitted >= 3)
      .sort((a, b) => (b.daysSinceSubmitted || 0) - (a.daysSinceSubmitted || 0))
      .slice(0, 12);
  }, [enriched, myQueueOnly]);
 
  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Auth Coordinator Dashboard" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading authorization data...</div>
    </div>
  );

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

  // Render the new 2-column workflow layout
  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Auth Coordinator"
        subtitle={`${today} · ${stats.urgentRenewals} urgent · ${stats.expiring7} expiring this week`}
        actions={
          <button onClick={load} style={{ padding:'6px 14px', background:'#0F1117', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>↻ Refresh</button>
        }
      />
 
      {/* Urgent banner */}
      {(stats.expiringToday > 0 || stats.urgentRenewals > 0) && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #FECACA', padding:'8px 20px', display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:16 }}>🚨</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#DC2626' }}>
            {stats.expiringToday > 0 && `${stats.expiringToday} auth(s) expired TODAY. `}
            {stats.urgentRenewals > 0 && `${stats.urgentRenewals} urgent renewal task(s) need action now.`}
          </span>
        </div>
      )}
 
      {/* ─── 2-COLUMN WORKFLOW LAYOUT ────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', background:'var(--bg)' }}>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0, 1fr) 340px', gap:16, padding:16, alignItems:'start' }}>

          {/* ═══ LEFT COLUMN — My Queue + Pending Follow-Up ═══ */}
          <div style={{ display:'flex', flexDirection:'column', gap:12, minWidth:0 }}>

            {/* My Queue / All Queue toggle + search */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 14px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <button onClick={() => setMyQueueOnly(true)}
                style={{ padding:'5px 12px', border:'1px solid '+(myQueueOnly?'#1565C0':'var(--border)'), background:myQueueOnly?'#1565C0':'var(--card-bg)', color:myQueueOnly?'#fff':'var(--gray)', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                👤 My Queue ({enriched.filter(a => a.isMine).length})
              </button>
              <button onClick={() => setMyQueueOnly(false)}
                style={{ padding:'5px 12px', border:'1px solid '+(!myQueueOnly?'#1565C0':'var(--border)'), background:!myQueueOnly?'#1565C0':'var(--card-bg)', color:!myQueueOnly?'#fff':'var(--gray)', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                🌐 All Auths ({enriched.length})
              </button>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, insurance, auth #..."
                style={{ padding:'5px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--bg)', flex:1, minWidth:180 }} />
              {actionFilter && (
                <button onClick={() => setActionFilter(null)} style={{ padding:'4px 10px', background:'#FEF3C7', color:'#92400E', border:'1px solid #FCD34D', borderRadius:5, fontSize:10, fontWeight:700, cursor:'pointer' }}>
                  ✕ Clear action filter
                </button>
              )}
              <div style={{ marginLeft:'auto', fontSize:10, color:'var(--gray)' }}>{filtered.length} records</div>
            </div>

            {/* Insurance carrier tabs — auth rules vary by carrier */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'8px 10px', display:'flex', gap:4, flexWrap:'wrap' }}>
              {INSURANCE_BUCKETS.map(b => (
                <button key={b.key} onClick={() => setCarrierTab(b.key)}
                  style={{
                    padding:'5px 10px', border:'1px solid '+(carrierTab===b.key?'#7C3AED':'transparent'),
                    background:carrierTab===b.key?'#F5F3FF':'transparent',
                    color:carrierTab===b.key?'#7C3AED':'var(--gray)',
                    borderRadius:5, fontSize:10, fontWeight:700, cursor:'pointer',
                  }}>
                  {b.label} <span style={{ opacity:0.6, fontWeight:400 }}>{carrierCounts[b.key] || 0}</span>
                </button>
              ))}
            </div>

            {/* My Queue (or All Queue) table with INLINE STATUS TOGGLES */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                <div style={{ fontSize:12, fontWeight:800, color:'var(--black)' }}>
                  {actionFilter === 'renewals_7d' ? '⏰ Renewals expiring in 7 days'
                   : actionFilter === 'stalled' ? '🪦 Stalled auths (submitted >5d)'
                   : actionFilter === 'unassigned' ? '⚠ Unassigned (needs triage)'
                   : actionFilter === 'denied' ? '✗ Denied auths'
                   : myQueueOnly ? '👤 My Auth Queue' : '🌐 All Authorizations'}
                </div>
                <span style={{ fontSize:10, color:'var(--gray)' }}>sorted by days-to-expiry</span>
              </div>
              {filtered.length === 0 ? (
                <div style={{ padding:30, textAlign:'center', color:'#10B981', fontSize:12 }}>
                  ✅ Nothing to action here right now.
                </div>
              ) : (
                <div style={{ maxHeight:540, overflowY:'auto' }}>
                  {filtered.slice(0, 60).map((a, i) => {
                    const dc = urgencyColor(a.daysUntilExpiry);
                    const rowBg = a.daysUntilExpiry !== null && a.daysUntilExpiry <= 7 ? '#FFF5F5'
                                : a.daysUntilExpiry !== null && a.daysUntilExpiry <= 14 ? '#FFFBEB'
                                : i%2===0?'var(--card-bg)':'var(--bg)';
                    const isSaving = savingStatusId === a.id;
                    return (
                      <div key={a.id} style={{ borderBottom:'1px solid var(--border)', background:rowBg, padding:'10px 14px' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1.5fr 80px 90px 1fr auto', gap:8, alignItems:'center' }}>
                          {/* Patient + region */}
                          <div onClick={() => setEditAuth(a)} style={{ cursor:'pointer', minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {a.patient_name}
                            </div>
                            <div style={{ fontSize:10, color:'var(--gray)' }}>
                              Region {a.region} · {a.insurance || '—'}
                            </div>
                          </div>
                          {/* Days to expiry */}
                          <div style={{ textAlign:'center' }}>
                            <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:dc }}>
                              {a.daysUntilExpiry !== null ? (a.daysUntilExpiry <= 0 ? 'EXP' : a.daysUntilExpiry + 'd') : '—'}
                            </div>
                            <div style={{ fontSize:8, color:'var(--gray)', textTransform:'uppercase' }}>to expiry</div>
                          </div>
                          {/* Visits remaining */}
                          <div style={{ textAlign:'center' }}>
                            <div style={{ fontSize:14, fontWeight:800, fontFamily:'DM Mono, monospace', color:a.visitsRemaining<=4?'#DC2626':a.visitsRemaining<=8?'#D97706':'#059669' }}>
                              {a.visitsRemaining}/{a.visits_authorized || 0}
                            </div>
                            <div style={{ fontSize:8, color:'var(--gray)', textTransform:'uppercase' }}>visits left</div>
                          </div>
                          {/* INLINE STATUS TOGGLE — no modal */}
                          <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                            {['pending','submitted','active','denied'].map(st => {
                              const isCurrent = (a.auth_status || '').toLowerCase() === st;
                              const stColors = { pending:'#1565C0', submitted:'#D97706', active:'#059669', denied:'#DC2626' };
                              return (
                                <button key={st}
                                  disabled={isSaving}
                                  onClick={() => quickToggleStatus(a.id, a.auth_status, st)}
                                  title={'Set status to ' + st}
                                  style={{
                                    padding:'3px 7px', fontSize:9, fontWeight:700, textTransform:'uppercase',
                                    border:'1px solid '+(isCurrent?stColors[st]:'var(--border)'),
                                    background:isCurrent?stColors[st]:'var(--card-bg)',
                                    color:isCurrent?'#fff':stColors[st],
                                    borderRadius:4, cursor:isSaving?'wait':'pointer', opacity:isSaving?0.5:1,
                                  }}>
                                  {st}
                                </button>
                              );
                            })}
                          </div>
                          {/* Edit button (modal for everything else) */}
                          <button onClick={() => setEditAuth(a)}
                            style={{ padding:'4px 10px', background:'#0F1117', color:'#fff', border:'none', borderRadius:5, fontSize:10, fontWeight:700, cursor:'pointer' }}>
                            Edit →
                          </button>
                        </div>
                        {/* Sub-row: assigned + auth # + submitted-days */}
                        <div style={{ marginTop:5, display:'flex', gap:14, fontSize:9, color:'var(--gray)' }}>
                          {a.assigned_to && <span>👤 {a.assigned_to}</span>}
                          {!a.assigned_to && <span style={{ color:'#DC2626', fontWeight:700 }}>⚠ Unassigned</span>}
                          {a.auth_number && <span style={{ fontFamily:'DM Mono, monospace' }}>#{a.auth_number}</span>}
                          {a.daysSinceSubmitted !== null && <span>Submitted {a.daysSinceSubmitted}d ago</span>}
                          {a.auth_expiry_date && <span>Expires {fmtDate(a.auth_expiry_date)}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {filtered.length > 60 && (
                    <div style={{ padding:10, textAlign:'center', fontSize:10, color:'var(--gray)' }}>
                      Showing 60 of {filtered.length} · refine filters or search
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pending Follow-Up panel — chase list */}
            {followUpList.length > 0 && (
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between' }}>
                  <div style={{ fontSize:12, fontWeight:800, color:'var(--black)' }}>📞 Pending Follow-Up</div>
                  <span style={{ fontSize:10, color:'var(--gray)' }}>Submitted ≥3d ago, no approval · chase list</span>
                </div>
                {followUpList.map(a => (
                  <div key={a.id} onClick={() => setEditAuth(a)}
                    style={{ display:'grid', gridTemplateColumns:'1.5fr 80px 90px 90px auto', padding:'8px 14px', borderBottom:'1px solid var(--border)', cursor:'pointer', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700 }}>{a.patient_name}</div>
                      <div style={{ fontSize:9, color:'var(--gray)' }}>{a.insurance} · Rgn {a.region}</div>
                    </div>
                    <span style={{ fontSize:10, color:'var(--gray)' }}>{fmtDate(a.auth_submitted_date)}</span>
                    <span style={{ fontSize:13, fontFamily:'DM Mono, monospace', fontWeight:800, color: a.daysSinceSubmitted > 10 ? '#DC2626' : '#D97706' }}>
                      {a.daysSinceSubmitted}d
                    </span>
                    <span style={{ fontSize:10, color: a.assigned_to ? '#1565C0' : '#DC2626', fontWeight: a.assigned_to ? 400 : 700 }}>
                      {a.assigned_to || '⚠ Unassigned'}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); quickToggleStatus(a.id, a.auth_status, 'active'); }}
                      title="Mark approved (auth received)"
                      style={{ padding:'3px 8px', background:'#059669', color:'#fff', border:'none', borderRadius:4, fontSize:9, fontWeight:700, cursor:'pointer' }}>
                      ✓ Approved
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ═══ RIGHT COLUMN — Sticky Actions + Stats + Activity ═══ */}
          <div style={{ position:'sticky', top:16, display:'flex', flexDirection:'column', gap:12 }}>

            {/* Today's Actions checklist */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', background:'#0F1117', color:'#fff' }}>
                <div style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em' }}>Today's Actions</div>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.6)', marginTop:2 }}>Click any item to filter the queue</div>
              </div>
              {[
                { key:'renewals_7d', icon:'⏰', label:'Renewals expiring ≤7d', count:actionCounts.renewals_7d, color:'#DC2626' },
                { key:'stalled',     icon:'🪦', label:'Stalled (>5d no approval)', count:actionCounts.stalled, color:'#D97706' },
                { key:'unassigned',  icon:'⚠',  label:'Unassigned (needs triage)', count:actionCounts.unassigned, color:'#991B1B' },
                { key:'denied',      icon:'✗',  label:'Denied — appeal/replace', count:actionCounts.denied, color:'#7C3AED' },
              ].map(item => {
                const isActive = actionFilter === item.key;
                return (
                  <div key={item.key} onClick={() => setActionFilter(isActive ? null : item.key)}
                    style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', cursor:'pointer', background:isActive?'#FEF3C7':'transparent', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:14 }}>{item.icon}</span>
                      <span style={{ fontSize:11, fontWeight:600, color:'var(--black)' }}>{item.label}</span>
                    </div>
                    <span style={{ fontSize:14, fontWeight:900, fontFamily:'DM Mono, monospace', color:item.count>0?item.color:'#9CA3AF' }}>
                      {item.count}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* My Personal Stats */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:11, fontWeight:800, color:'var(--black)', textTransform:'uppercase', letterSpacing:'0.06em' }}>My Performance</div>
                <div style={{ fontSize:9, color:'var(--gray)', marginTop:2 }}>{profileName || 'unknown'}</div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:1, background:'var(--border)' }}>
                <div style={{ padding:'10px 12px', background:'var(--card-bg)', textAlign:'center' }}>
                  <div style={{ fontSize:8, color:'var(--gray)', fontWeight:700, textTransform:'uppercase' }}>Queue Size</div>
                  <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', marginTop:2 }}>{myStats.myQueueSize}</div>
                </div>
                <div style={{ padding:'10px 12px', background:'var(--card-bg)', textAlign:'center' }}>
                  <div style={{ fontSize:8, color:'var(--gray)', fontWeight:700, textTransform:'uppercase' }}>Approval Rate</div>
                  <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', marginTop:2, color: myStats.myApprovalRate >= 80 ? '#059669' : myStats.myApprovalRate >= 60 ? '#D97706' : '#DC2626' }}>
                    {myStats.myApprovalRate !== null ? myStats.myApprovalRate + '%' : '—'}
                  </div>
                </div>
                <div style={{ padding:'10px 12px', background:'var(--card-bg)', textAlign:'center' }}>
                  <div style={{ fontSize:8, color:'var(--gray)', fontWeight:700, textTransform:'uppercase' }}>Median Days</div>
                  <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', marginTop:2 }}>
                    {myStats.myMedianDays !== null ? myStats.myMedianDays + 'd' : '—'}
                  </div>
                  <div style={{ fontSize:8, color:'var(--gray)' }}>submit → approve</div>
                </div>
                <div style={{ padding:'10px 12px', background:'var(--card-bg)', textAlign:'center' }}>
                  <div style={{ fontSize:8, color:'var(--gray)', fontWeight:700, textTransform:'uppercase' }}>Actions Today</div>
                  <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', marginTop:2, color:'#1565C0' }}>{myStats.myActionsToday}</div>
                </div>
              </div>
            </div>

            {/* Recent Activity feed */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:11, fontWeight:800, color:'var(--black)', textTransform:'uppercase', letterSpacing:'0.06em' }}>My Recent Activity</div>
                <div style={{ fontSize:9, color:'var(--gray)' }}>Last actions you took today</div>
              </div>
              {activityLog.length === 0 ? (
                <div style={{ padding:20, textAlign:'center', fontSize:11, color:'var(--gray)' }}>
                  No activity logged yet today.
                </div>
              ) : (
                <div style={{ maxHeight:240, overflowY:'auto' }}>
                  {activityLog.slice(0, 10).map((act, i) => {
                    const time = new Date(act.created_at).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
                    return (
                      <div key={i} style={{ padding:'7px 14px', borderBottom:'1px solid var(--border)', fontSize:10 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                          <span style={{ fontWeight:600, color:'var(--black)' }}>{(act.action_type || '').replace(/_/g, ' ')}</span>
                          <span style={{ color:'var(--gray)', fontFamily:'DM Mono, monospace', fontSize:9 }}>{time}</span>
                        </div>
                        {act.detail && <div style={{ color:'var(--gray)', marginTop:2 }}>{act.detail}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Renewal Tasks quick-jump */}
            {renewalTasks.length > 0 && (
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--black)' }}>🔄 Renewal Tasks</div>
                  <div style={{ fontSize:9, color:'var(--gray)' }}>
                    {renewalTasks.length} open · {renewalTasks.filter(r=>r.priority==='urgent').length} urgent
                  </div>
                </div>
                <button onClick={() => window.dispatchEvent(new CustomEvent('axiom-navigate', { detail:{ page:'auth-renewals' } }))}
                  style={{ padding:'5px 10px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:5, fontSize:10, fontWeight:700, cursor:'pointer' }}>
                  Open →
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {editAuth && (
        <AuthEditModal
          auth={editAuth}
          allAuths={auths}
          profileName={profile?.full_name || profile?.email}
          onClose={() => setEditAuth(null)}
          onSaved={() => { setEditAuth(null); load(); }}
        />
      )}
    </div>
  );
}
 
