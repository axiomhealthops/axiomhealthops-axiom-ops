import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, safeUpdate } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
 
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
    <div onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:580, boxShadow:'0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{auth.patient_name}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', marginTop:2 }}>
              {auth.insurance} · Region {auth.region} · Member ID: {auth.member_id || '—'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.5)' }}>×</button>
        </div>
 
        <div style={{ padding:22, display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
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
            { label:'Submitted Date', field:'auth_submitted_date', type:'date' },
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
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:80, background:'var(--card-bg)' }} />
          </div>
        </div>
 
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:8, background:'var(--bg)' }}>
          {saveError && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FCA5A5', color:'#991B1B', padding:'8px 12px', borderRadius:6, fontSize:12, fontWeight:600 }}>
              ⚠ {saveError}
            </div>
          )}
          {dupWarning && (
            <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', color:'#92400E', padding:'10px 12px', borderRadius:8, fontSize:12 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>⚠ Potential Duplicate Detected</div>
              <div style={{ fontSize:11, marginBottom:8 }}>
                {dupWarning.map((d, i) => (
                  <div key={i} style={{ padding:'4px 0', borderBottom: i < dupWarning.length-1 ? '1px solid #FDE68A' : 'none' }}>
                    <strong>{d.patient_name}</strong> — Auth #{d.auth_number || 'N/A'} · {d.auth_discipline || 'No discipline'} · {d.auth_status} · Expires {d.auth_expiry_date || 'N/A'}
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:6 }}>
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
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
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
 
export default function AuthCoordDashboard() {
  const { profile } = useAuth();
  const [auths, setAuths] = useState([]);
  const [renewalTasks, setRenewalTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('today');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterInsurance, setFilterInsurance] = useState('ALL');
  const [search, setSearch] = useState('');
  const [editAuth, setEditAuth] = useState(null);

  const regionScope = useAssignedRegions();

  const load = useCallback(async () => {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setAuths([]); setRenewalTasks([]); setLoading(false); return;
    }
    const [a, r] = await Promise.all([
      regionScope.applyToQuery(supabase.from('auth_tracker').select('*').order('auth_expiry_date', { ascending: true })),
      regionScope.applyToQuery(supabase.from('auth_renewal_tasks').select('*').not('task_status', 'in', '("approved","denied","closed")').order('days_until_expiry', { ascending: true })),
    ]);
    setAuths(a.data || []);
    setRenewalTasks(r.data || []);
    setLoading(false);
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useEffect(() => { load(); }, [load]);
 
  const enriched = useMemo(() => auths.map(a => ({
    ...a,
    daysUntilExpiry: daysUntil(a.auth_expiry_date),
    visitsRemaining: Math.max(0, (a.visits_authorized || 0) - (a.visits_used || 0)),
    utilizationPct: a.visits_authorized > 0 ? Math.round((a.visits_used / a.visits_authorized) * 100) : 0,
  })), [auths]);
 
  const stats = useMemo(() => {
    const active = enriched.filter(a => a.auth_status === 'active');
    return {
      totalActive: active.length,
      expiringToday: active.filter(a => a.daysUntilExpiry !== null && a.daysUntilExpiry <= 0).length,
      expiring7: active.filter(a => a.daysUntilExpiry !== null && a.daysUntilExpiry > 0 && a.daysUntilExpiry <= 7).length,
      expiring14: active.filter(a => a.daysUntilExpiry !== null && a.daysUntilExpiry > 7 && a.daysUntilExpiry <= 14).length,
      lowVisits: active.filter(a => a.visitsRemaining <= 4).length,
      pending: enriched.filter(a => a.auth_status === 'pending').length,
      urgentRenewals: renewalTasks.filter(r => r.priority === 'urgent').length,
    };
  }, [enriched, renewalTasks]);
 
  const filtered = useMemo(() => {
    let list = enriched;
    if (activeTab === 'today')    list = list.filter(a => a.auth_status === 'active' && a.daysUntilExpiry !== null && a.daysUntilExpiry <= 7);
    if (activeTab === 'expiring') list = list.filter(a => a.auth_status === 'active' && a.daysUntilExpiry !== null && a.daysUntilExpiry <= 14);
    if (activeTab === 'pending')  list = list.filter(a => a.auth_status === 'pending');
    if (activeTab === 'low')      list = list.filter(a => a.auth_status === 'active' && a.visitsRemaining <= 4);
    if (activeTab === 'all')      list = list.filter(a => a.auth_status === 'active');
    if (filterRegion !== 'ALL')   list = list.filter(a => a.region === filterRegion);
    if (filterInsurance !== 'ALL') list = list.filter(a => a.insurance === filterInsurance);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a => `${a.patient_name} ${a.insurance} ${a.auth_number||''} ${a.assigned_to||''}`.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (a.daysUntilExpiry ?? 999) - (b.daysUntilExpiry ?? 999));
  }, [enriched, activeTab, filterRegion, filterInsurance, search]);
 
  const uniqueInsurances = [...new Set(auths.map(a => a.insurance).filter(Boolean))].sort();
  const uniqueRegions = [...new Set(auths.map(a => a.region).filter(Boolean))].sort();
 
  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Auth Coordinator Dashboard" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading authorization data...</div>
    </div>
  );
 
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
 
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
 
      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>
 
          {/* KPI Strip */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
            {[
              { label:'Active Auths',   val:stats.totalActive,    color:'#059669', bg:'#ECFDF5', tab:'all' },
              { label:'🔴 Expired/Today', val:stats.expiringToday, color:'#DC2626', bg:'#FEF2F2', tab:'today' },
              { label:'🟠 This Week',   val:stats.expiring7,      color:'#D97706', bg:'#FEF3C7', tab:'today' },
              { label:'⚠ Next 14 Days', val:stats.expiring14,     color:'#7C3AED', bg:'#F5F3FF', tab:'expiring' },
              { label:'⬇ Low Visits',  val:stats.lowVisits,      color:'#DC2626', bg:'#FEF2F2', tab:'low' },
              { label:'📋 Pending Auth', val:stats.pending,        color:'#1565C0', bg:'#EFF6FF', tab:'pending' },
            ].map(c => (
              <div key={c.label} onClick={() => setActiveTab(c.tab)}
                style={{ background:c.bg, border:`2px solid ${activeTab===c.tab?c.color:'var(--border)'}`, borderRadius:10, padding:'10px 12px', textAlign:'center', cursor:'pointer' }}>
                <div style={{ fontSize:8, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                <div style={{ fontSize:24, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:2 }}>{c.val}</div>
              </div>
            ))}
          </div>
 
          {/* Tabs + filters */}
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', alignSelf:'flex-start' }}>
            {[
              { k:'today',    l:'🚨 Action Today' },
              { k:'expiring', l:'⚠ Next 14 Days' },
              { k:'low',      l:'⬇ Low Visits' },
              { k:'pending',  l:'📋 Pending' },
              { k:'all',      l:'All Active' },
            ].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)}
                style={{ padding:'7px 14px', border:'none', fontSize:11, fontWeight:activeTab===t.k?700:400, cursor:'pointer', background:activeTab===t.k?'#0F1117':'var(--card-bg)', color:activeTab===t.k?'#fff':'var(--gray)', borderRight:'1px solid var(--border)' }}>
                {t.l}
              </button>
            ))}
          </div>
 
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, insurance, auth #..."
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:220 }} />
            <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
              <option value="ALL">All Regions</option>
              {uniqueRegions.map(r => <option key={r} value={r}>Region {r}</option>)}
            </select>
            <select value={filterInsurance} onChange={e => setFilterInsurance(e.target.value)}
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', maxWidth:180 }}>
              <option value="ALL">All Insurance</option>
              {uniqueInsurances.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} records</div>
          </div>
 
          {/* Auth Table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1.8fr 0.4fr 0.5fr 1fr 0.9fr 0.7fr 0.7fr 0.8fr 0.7fr 1fr', padding:'8px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              <span>Patient</span><span>Rgn</span><span>Disc.</span><span>Insurance</span><span>Auth #</span><span>Expires</span><span>Days Left</span><span>Visits Auth</span><span>Visits Left</span><span>Assigned To</span>
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                {activeTab === 'today' ? '✅ No auths expiring this week — clear!' : 'No records match filters.'}
              </div>
            ) : filtered.map((a, i) => {
              const dc = urgencyColor(a.daysUntilExpiry);
              const rowBg = a.daysUntilExpiry !== null && a.daysUntilExpiry <= 7 ? '#FFF5F5' : a.daysUntilExpiry !== null && a.daysUntilExpiry <= 14 ? '#FFFBEB' : i%2===0?'var(--card-bg)':'var(--bg)';
              return (
                <div key={a.id} onClick={() => setEditAuth(a)}
                  style={{ display:'grid', gridTemplateColumns:'1.8fr 0.4fr 0.5fr 1fr 0.9fr 0.7fr 0.7fr 0.8fr 0.7fr 1fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8, cursor:'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background='#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background=rowBg}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{a.patient_name}</div>
                    <div style={{ fontSize:9, color:'var(--gray)' }}>{a.pcp_name || '—'}</div>
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>{a.region}</span>
                  {(() => { const _dc = {PT:'#1565C0',OT:'#7C3AED','PT/OT':'#059669',PTA:'#0891B2',COTA:'#DB2777'}; const _bg = {PT:'#EFF6FF',OT:'#EDE9FE','PT/OT':'#ECFDF5',PTA:'#ECFEFF',COTA:'#FDF2F8'}; return (
                    <span style={{ fontSize:9, fontWeight:800, color:_dc[a.auth_discipline]||'#9CA3AF', background:a.auth_discipline?_bg[a.auth_discipline]||'#F3F4F6':'#F3F4F6', padding:'2px 6px', borderRadius:4, textAlign:'center' }}>
                      {a.auth_discipline || '—'}
                    </span>
                  ); })()}
                  <span style={{ fontSize:11 }}>{a.insurance}</span>
                  <span style={{ fontSize:11, fontFamily:'DM Mono, monospace', color:a.auth_number?'var(--black)':'#9CA3AF', fontStyle:a.auth_number?'normal':'italic' }}>
                    {a.auth_number || 'Not entered'}
                  </span>
                  <span style={{ fontSize:11, color:dc, fontWeight:a.daysUntilExpiry!==null&&a.daysUntilExpiry<=14?700:400 }}>{fmtDate(a.auth_expiry_date)}</span>
                  <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:dc }}>
                    {a.daysUntilExpiry !== null ? (a.daysUntilExpiry <= 0 ? 'EXP' : a.daysUntilExpiry) : '—'}
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{a.visits_authorized || '—'}</div>
                    <div style={{ fontSize:9, color:'var(--gray)' }}>{a.visits_used || 0} used</div>
                  </div>
                  <span style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace', color:a.visitsRemaining<=4?'#DC2626':a.visitsRemaining<=8?'#D97706':'#059669' }}>
                    {a.visitsRemaining}
                  </span>
                  <span style={{ fontSize:11, color:a.assigned_to?'#1565C0':'#9CA3AF', fontStyle:a.assigned_to?'normal':'italic' }}>
                    {a.assigned_to || 'Unassigned'}
                  </span>
                </div>
              );
            })}
          </div>
 
          {/* Renewal Tasks panel */}
          {renewalTasks.length > 0 && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between' }}>
                <div style={{ fontSize:13, fontWeight:800 }}>🔄 Open Renewal Tasks</div>
                <span style={{ fontSize:11, color:'#DC2626', fontWeight:700 }}>{renewalTasks.filter(r=>r.priority==='urgent').length} urgent</span>
              </div>
              {renewalTasks.slice(0,10).map((r,i) => {
                const pc = r.priority==='urgent' ? { color:'#DC2626', bg:'#FEF2F2' } : { color:'#D97706', bg:'#FEF3C7' };
                return (
                  <div key={r.id} style={{ display:'grid', gridTemplateColumns:'1.8fr 0.4fr 0.9fr 0.6fr 0.6fr 1fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', gap:8 }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>{r.patient_name}</div>
                    <span style={{ fontSize:11, color:'var(--gray)' }}>{r.region}</span>
                    <span style={{ fontSize:11 }}>{r.insurance}</span>
                    <span style={{ fontSize:10, fontWeight:700, color:pc.color, background:pc.bg, padding:'2px 6px', borderRadius:999 }}>{r.priority}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:urgencyColor(r.days_until_expiry) }}>{r.days_until_expiry}d</span>
                    <span style={{ fontSize:11, color:r.assigned_to?'#1565C0':'#9CA3AF', fontStyle:r.assigned_to?'normal':'italic' }}>{r.assigned_to||'Unassigned'}</span>
                  </div>
                );
              })}
            </div>
          )}
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
 
