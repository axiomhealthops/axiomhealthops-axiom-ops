import React, { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const REGIONAL_MANAGERS = {
  A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks',
  H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi',
  T:'Samantha Faliks', V:'Samantha Faliks',
};

const HOLD_TYPES = [
  { value: 'On Hold',              label: 'On Hold (General)',  color: '#D97706', bg: '#FEF3C7' },
  { value: 'On Hold - Facility',   label: 'Facility',           color: '#DC2626', bg: '#FEF2F2' },
  { value: 'On Hold - Pt Request', label: 'Patient Request',    color: '#7C3AED', bg: '#F5F3FF' },
  { value: 'On Hold - MD Request', label: 'MD Request',         color: '#1565C0', bg: '#EFF6FF' },
];

function holdTypeConfig(type) {
  return HOLD_TYPES.find(h => h.value === type) || HOLD_TYPES[0];
}

function urgencyColor(days) {
  if (days >= 30) return { color: '#DC2626', bg: '#FEF2F2', label: '🔴 Overdue' };
  if (days >= 14) return { color: '#D97706', bg: '#FEF3C7', label: '🟡 Follow Up' };
  return { color: '#065F46', bg: '#ECFDF5', label: '🟢 Recent' };
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Math.floor((new Date() - d) / 86400000);
}

// ── Action Modal ─────────────────────────────────────────────────────────────
function ActionModal({ record, onClose, onSaved, profileName }) {
  const [form, setForm] = useState({
    last_contact_date: record.last_contact_date || new Date().toISOString().slice(0,10),
    last_contact_notes: record.last_contact_notes || '',
    expected_return_date: record.expected_return_date || '',
    follow_up_due: record.follow_up_due || '',
    priority: record.priority || 'normal',
    notes: record.notes || '',
    recovery_status: record.recovery_status || 'on_hold',
    recovery_date: record.recovery_date || '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const payload = {
      ...form,
      last_contact_date: form.last_contact_date || null,
      expected_return_date: form.expected_return_date || null,
      follow_up_due: form.follow_up_due || null,
      recovery_date: (form.recovery_status === 'recovered' || form.recovery_status === 'discharged')
        ? (form.recovery_date || new Date().toISOString().slice(0,10)) : null,
      updated_at: new Date().toISOString(),
      updated_by: profileName || null,
    };
    await supabase.from('on_hold_recovery').update(payload).eq('id', record.id);

    // When marking as Discharged or Recovered, also update census_data so the
    // sync logic doesn't re-insert the patient as a new on-hold record
    if (form.recovery_status === 'discharged') {
      await supabase.from('census_data')
        .update({ status: 'Discharge', updated_at: new Date().toISOString() })
        .eq('patient_name', record.patient_name);
    } else if (form.recovery_status === 'recovered') {
      await supabase.from('census_data')
        .update({ status: 'Active', updated_at: new Date().toISOString() })
        .eq('patient_name', record.patient_name);
    }

    setSaving(false);
    onSaved();
  }

  const ht = holdTypeConfig(record.hold_type);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:580, display:'flex', flexDirection:'column', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{record.patient_name}</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>
              Region {record.region} · {record.hold_type} · {record.days_on_hold || daysAgo(record.hold_date) || 0} days on hold
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9CA3AF' }}>×</button>
        </div>

        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:14 }}>
          {/* Status */}
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:6 }}>Recovery Status</label>
            <div style={{ display:'flex', gap:8 }}>
              {[['on_hold','Still On Hold','#D97706'],['recovered','Recovered ✓','#065F46'],['discharged','Discharged','#6B7280']].map(([v,l,c]) => (
                <button key={v} onClick={() => setForm(f=>({...f,recovery_status:v}))}
                  style={{ flex:1, padding:'8px 0', border:`2px solid ${form.recovery_status===v?c:'var(--border)'}`, borderRadius:7, fontSize:12, fontWeight:form.recovery_status===v?700:400, cursor:'pointer', background:form.recovery_status===v?c:'var(--card-bg)', color:form.recovery_status===v?'#fff':'var(--gray)' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {form.recovery_status === 'recovered' && (
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>Recovery Date</label>
              <input type="date" value={form.recovery_date} onChange={e=>setForm(f=>({...f,recovery_date:e.target.value}))}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>Last Contact Date</label>
              <input type="date" value={form.last_contact_date} onChange={e=>setForm(f=>({...f,last_contact_date:e.target.value}))}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>Expected Return Date</label>
              <input type="date" value={form.expected_return_date} onChange={e=>setForm(f=>({...f,expected_return_date:e.target.value}))}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>Follow-Up Due Date</label>
              <input type="date" value={form.follow_up_due} onChange={e=>setForm(f=>({...f,follow_up_due:e.target.value}))}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>Priority</label>
              <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="high">🔴 High</option>
                <option value="normal">🟡 Normal</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>Contact Notes</label>
            <textarea value={form.last_contact_notes} onChange={e=>setForm(f=>({...f,last_contact_notes:e.target.value}))}
              placeholder="What was discussed in last contact? Any updates on patient condition or return timeline?"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:64, background:'var(--card-bg)' }} />
          </div>

          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>General Notes</label>
            <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
              placeholder="Any additional context…"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:48, background:'var(--card-bg)' }} />
          </div>
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {saving ? 'Saving…' : 'Save Update'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function OnHoldRecoveryPage() {
  const { profile } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRecord, setActiveRecord] = useState(null);
  const [filterType, setFilterType] = useState('ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('on_hold');
  const [filterPriority, setFilterPriority] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');
  const [sortField, setSortField] = useState('days_on_hold');
  const [sortDir, setSortDir] = useState('desc');

  const regionScope = useAssignedRegions();

  async function load() {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setRecords([]); setLoading(false); return;
    }
    // Sync from census first — add any new on-hold patients. Scope to
    // the user's regions so a care coord doesn't inadvertently seed
    // on_hold_recovery rows for regions they don't own.
    const { data: census } = await regionScope.applyToQuery(
      supabase.from('census_data')
        .select('patient_name, region, status, insurance, first_seen_date')
        .ilike('status', '%hold%')
    );

    const { data: existing } = await regionScope.applyToQuery(
      supabase.from('on_hold_recovery')
        .select('patient_name, recovery_status')
    );

    // Track ALL patients that already have an on_hold_recovery record (any status)
    // so we don't re-insert discharged or recovered patients as new on-hold rows
    const existingAll = new Set(
      (existing || []).map(r => r.patient_name)
    );

    // Insert new patients appearing on hold (only if they have NO existing record at all)
    const newOnes = (census || []).filter(c => !existingAll.has(c.patient_name));
    if (newOnes.length > 0) {
      await supabase.from('on_hold_recovery').upsert(newOnes.map(c => ({
        patient_name: c.patient_name,
        region: c.region,
        hold_type: c.status,
        insurance: c.insurance,
        hold_date: c.first_seen_date || new Date().toISOString().slice(0,10),
        recovery_status: 'on_hold',
        hold_reason: c.status,
        priority: 'normal',
      })), { onConflict: 'patient_name', ignoreDuplicates: true });
    }

    // Mark as recovered if no longer on hold in census
    const censusOnHold = new Set((census || []).map(c => c.patient_name));
    const toRecover = (existing || []).filter(r => r.recovery_status === 'on_hold' && !censusOnHold.has(r.patient_name));
    if (toRecover.length > 0) {
      // Don't auto-recover — just flag them for coordinator review
      // Census may have removed them for other reasons
    }

    // Update days on hold
    await supabase.rpc
      ? null  // would do server-side calc here
      : null;

    const { data } = await regionScope.applyToQuery(
      supabase.from('on_hold_recovery')
        .select('*')
        .order('hold_date', { ascending: true })
    );

    // Calculate days on hold client-side
    const enriched = (data || []).map(r => ({
      ...r,
      days_on_hold: r.hold_date ? daysAgo(r.hold_date) : (r.days_on_hold || 0),
    }));

    setRecords(enriched);
    setLoading(false);
  }

  useEffect(() => { load(); }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);
  useRealtimeTable(['on_hold_recovery', 'census_data'], load);

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (filterStatus !== 'ALL' && r.recovery_status !== filterStatus) return false;
      if (filterType !== 'ALL' && r.hold_type !== filterType) return false;
      if (filterRegion !== 'ALL' && r.region !== filterRegion) return false;
      if (filterPriority !== 'ALL' && r.priority !== filterPriority) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!`${r.patient_name} ${r.region} ${r.hold_type} ${r.notes}`.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      let av = a[sortField]; let bv = b[sortField];
      if (av == null) av = sortDir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = sortDir === 'asc' ? Infinity : -Infinity;
      if (sortDir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });
  }, [records, filterStatus, filterType, filterRegion, filterPriority, searchQ, sortField, sortDir]);

  const active = records.filter(r => r.recovery_status === 'on_hold');
  const recovered = records.filter(r => r.recovery_status === 'recovered');
  const discharged = records.filter(r => r.recovery_status === 'discharged');
  const overdue = active.filter(r => (r.days_on_hold || 0) >= 30);
  const followUpDue = active.filter(r => r.follow_up_due && r.follow_up_due <= new Date().toISOString().slice(0,10));
  const noContact = active.filter(r => !r.last_contact_date);
  const resolvedCount = recovered.length + discharged.length;
  const recoveryRate = records.length > 0 ? Math.round(resolvedCount / records.length * 100) : 0;

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  function SortIcon({ field }) {
    if (sortField !== field) return <span style={{ color:'#ccc', fontSize:9 }}> ↕</span>;
    return <span style={{ color:'#1565C0', fontSize:9 }}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>;
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="On-Hold Recovery" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Syncing with census…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title="On-Hold Recovery"
        subtitle={`${active.length} active · ${recovered.length} recovered · ${discharged.length} discharged · ${recoveryRate}% resolution rate`}
      />
      <div style={{ flex:1, overflow:'auto' }}>

        {/* Filters */}
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['on_hold','On Hold'],['recovered','Recovered'],['discharged','Discharged'],['ALL','All']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterStatus(k)}
                style={{ padding:'6px 12px', border:'none', fontSize:11, fontWeight:filterStatus===k?700:400, cursor:'pointer',
                  background:filterStatus===k?'#0F1117':'var(--card-bg)', color:filterStatus===k?'#fff':'var(--gray)' }}>
                {l}
              </button>
            ))}
          </div>

          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Hold Types</option>
            {HOLD_TYPES.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>

          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r} — {REGIONAL_MANAGERS[r]}</option>)}
          </select>

          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Priorities</option>
            <option value="high">🔴 High</option>
            <option value="normal">🟡 Normal</option>
            <option value="low">🟢 Low</option>
          </select>

          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search patient…"
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', width:160 }} />
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPI cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:14 }}>
            {[
              { label:'Active On Hold', value:active.length, color:'#D97706', bg:'#FEF3C7', icon:'⏸' },
              { label:'≥30 Days (Overdue)', value:overdue.length, color:'#DC2626', bg:'#FEF2F2', icon:'🔴', alert:overdue.length>0 },
              { label:'Follow-Up Due', value:followUpDue.length, color:'#D97706', bg:'#FEF3C7', icon:'📅', alert:followUpDue.length>0 },
              { label:'No Contact Logged', value:noContact.length, color:'#6B7280', bg:'var(--bg)', icon:'📞' },
              { label:'Recovered', value:recovered.length, color:'#065F46', bg:'#ECFDF5', icon:'✅', sub:recoveryRate+'% rate' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg, border:`1px solid ${c.alert?'#FECACA':'var(--border)'}`, borderRadius:10, padding:'14px 16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{c.label}</div>
                  <span style={{ fontSize:16 }}>{c.icon}</span>
                </div>
                <div style={{ fontSize:26, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:6 }}>{c.value}</div>
                {c.sub && <div style={{ fontSize:11, color:c.color, marginTop:2 }}>{c.sub}</div>}
              </div>
            ))}
          </div>

          {/* Alert banners */}
          {overdue.length > 0 && (
            <div style={{ background:'#FEF2F2', border:'2px solid #FECACA', borderRadius:10, padding:'12px 16px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#DC2626', marginBottom:8 }}>
                🔴 {overdue.length} patients on hold for 30+ days — immediate follow-up required
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {overdue.slice(0,10).map(r => (
                  <button key={r.id} onClick={() => setActiveRecord(r)}
                    style={{ fontSize:11, fontWeight:600, color:'#DC2626', background:'white', border:'1px solid #FECACA', borderRadius:6, padding:'3px 10px', cursor:'pointer' }}>
                    {r.patient_name} ({r.days_on_hold}d)
                  </button>
                ))}
                {overdue.length > 10 && <span style={{ fontSize:11, color:'#DC2626' }}>+{overdue.length-10} more</span>}
              </div>
            </div>
          )}

          {followUpDue.length > 0 && (
            <div style={{ background:'#FEF3C7', border:'2px solid #FCD34D', borderRadius:10, padding:'12px 16px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#92400E', marginBottom:6 }}>
                📅 {followUpDue.length} follow-up(s) due today
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {followUpDue.map(r => (
                  <button key={r.id} onClick={() => setActiveRecord(r)}
                    style={{ fontSize:11, fontWeight:600, color:'#92400E', background:'white', border:'1px solid #FCD34D', borderRadius:6, padding:'3px 10px', cursor:'pointer' }}>
                    {r.patient_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* By hold type + by region summary */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>By Hold Type</div>
              {HOLD_TYPES.map(ht => {
                const cnt = active.filter(r => r.hold_type === ht.value).length;
                if (!cnt) return null;
                const max = Math.max(...HOLD_TYPES.map(h => active.filter(r => r.hold_type === h.value).length), 1);
                return (
                  <div key={ht.value} style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                      <span style={{ fontWeight:600, color:ht.color }}>{ht.label}</span>
                      <span style={{ fontWeight:700, fontFamily:'DM Mono, monospace' }}>{cnt}</span>
                    </div>
                    <div style={{ height:7, background:'var(--border)', borderRadius:999 }}>
                      <div style={{ height:'100%', width:(cnt/max*100)+'%', background:ht.color, borderRadius:999 }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>By Region</div>
              {REGIONS.map(r => {
                const cnt = active.filter(p => p.region === r).length;
                if (!cnt) return null;
                const overdueHere = active.filter(p => p.region === r && (p.days_on_hold||0) >= 30).length;
                const max = Math.max(...REGIONS.map(rr => active.filter(p => p.region === rr).length), 1);
                return (
                  <div key={r} style={{ marginBottom:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:2 }}>
                      <span><strong>Region {r}</strong> <span style={{ color:'var(--gray)', fontSize:10 }}>{REGIONAL_MANAGERS[r]}</span></span>
                      <span style={{ fontFamily:'DM Mono, monospace', fontWeight:700 }}>
                        {cnt} {overdueHere > 0 && <span style={{ color:'#DC2626', fontSize:10 }}>({overdueHere} overdue)</span>}
                      </span>
                    </div>
                    <div style={{ height:6, background:'var(--border)', borderRadius:999, display:'flex', overflow:'hidden' }}>
                      <div style={{ width:((cnt-overdueHere)/max*100)+'%', background:'#F59E0B' }} />
                      <div style={{ width:(overdueHere/max*100)+'%', background:'#EF4444' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Patient List</div>
              <div style={{ fontSize:11, color:'var(--gray)' }}>{filtered.length} records · click a row to update</div>
            </div>

            {/* Header */}
            <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.5fr 1fr 0.7fr 0.7fr 0.8fr 0.8fr 0.8fr 0.6fr auto', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              {[['Patient','patient_name'],['Rgn','region'],['Hold Type','hold_type'],['Days','days_on_hold'],['Priority','priority'],['On Hold Since','hold_date'],['Last Contact','last_contact_date'],['Exp. Return','expected_return_date'],['Follow-Up','follow_up_due']].map(([l,f]) => (
                <div key={f} style={{ cursor:'pointer' }} onClick={() => toggleSort(f)}>
                  {l}<SortIcon field={f} />
                </div>
              ))}
              <div></div>
            </div>

            <div style={{ maxHeight:500, overflowY:'auto' }}>
              {filtered.length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>No records match the current filters.</div>
              ) : filtered.map((r, i) => {
                const ht = holdTypeConfig(r.hold_type);
                const urgency = urgencyColor(r.days_on_hold || 0);
                const followUpOverdue = r.follow_up_due && r.follow_up_due <= new Date().toISOString().slice(0,10);
                return (
                  <div key={r.id} onClick={() => setActiveRecord(r)}
                    style={{ display:'grid', gridTemplateColumns:'1.4fr 0.5fr 1fr 0.7fr 0.7fr 0.8fr 0.8fr 0.8fr 0.6fr auto', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', cursor:'pointer', gap:8, transition:'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background='#EFF6FF'}
                    onMouseLeave={e => e.currentTarget.style.background = i%2===0?'var(--card-bg)':'var(--bg)'}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600 }}>{r.patient_name}</div>
                      {r.last_contact_notes && <div style={{ fontSize:10, color:'var(--gray)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:180 }}>{r.last_contact_notes}</div>}
                    </div>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--gray)' }}>{r.region}</div>
                    <div>
                      <span style={{ fontSize:10, fontWeight:700, color:ht.color, background:ht.bg, padding:'2px 7px', borderRadius:999 }}>{ht.label}</span>
                    </div>
                    <div>
                      <span style={{ fontSize:11, fontWeight:700, color:urgency.color, background:urgency.bg, padding:'2px 7px', borderRadius:999 }}>{r.days_on_hold || 0}d</span>
                    </div>
                    <div>
                      <span style={{ fontSize:11, fontWeight:700, color:r.priority==='high'?'#DC2626':r.priority==='low'?'#065F46':'#D97706' }}>
                        {r.priority === 'high' ? '🔴 High' : r.priority === 'low' ? '🟢 Low' : '🟡 Normal'}
                      </span>
                    </div>
                    <div style={{ fontSize:11, color:'var(--gray)' }}>{fmtDate(r.hold_date)}</div>
                    <div style={{ fontSize:11, color: r.last_contact_date ? 'var(--black)' : '#DC2626' }}>
                      {r.last_contact_date ? fmtDate(r.last_contact_date) : '⚠ None'}
                    </div>
                    <div style={{ fontSize:11, color: r.expected_return_date ? '#065F46' : 'var(--gray)' }}>
                      {r.expected_return_date ? fmtDate(r.expected_return_date) : '—'}
                    </div>
                    <div style={{ fontSize:11, color: followUpOverdue ? '#DC2626' : r.follow_up_due ? '#D97706' : 'var(--gray)', fontWeight: followUpOverdue ? 700 : 400 }}>
                      {r.follow_up_due ? fmtDate(r.follow_up_due) : '—'}
                    </div>
                    <div>
                      <span style={{ fontSize:10, fontWeight:600, color:'#1565C0', background:'#EFF6FF', padding:'3px 8px', borderRadius:5 }}>Update</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {activeRecord && (
        <ActionModal
          record={activeRecord}
          profileName={profile?.full_name || profile?.email}
          onClose={() => setActiveRecord(null)}
          onSaved={() => { setActiveRecord(null); load(); }}
        />
      )}
    </div>
  );
}
