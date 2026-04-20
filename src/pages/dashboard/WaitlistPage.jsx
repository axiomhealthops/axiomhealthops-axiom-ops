import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

// NOTE: A ZIP_REGION_MAP constant previously lived here but was unused
// throughout the codebase. It is removed to unblock the build (it had
// duplicate object-literal keys for ZIP prefixes 346 and 336, which are
// REAL multi-region overlaps in Florida — Hillsborough/Manatee for 346,
// Pinellas/Tampa-South for 336). When waitlist auto-routing by ZIP is
// implemented, restore this as a multi-value resolver, not a flat map.

const PRIORITIES = [
  { key: 'urgent', label: '🔴 Urgent',  color: '#DC2626', bg: '#FEF2F2' },
  { key: 'high',   label: '🟠 High',    color: '#D97706', bg: '#FEF3C7' },
  { key: 'normal', label: '🟡 Normal',  color: '#059669', bg: '#ECFDF5' },
  { key: 'low',    label: '⬇ Low',     color: '#6B7280', bg: '#F3F4F6' },
];

const STATUSES = [
  { key: 'pending',   label: 'Pending',   color: '#D97706', bg: '#FEF3C7' },
  { key: 'assigned',  label: 'Assigned',  color: '#1565C0', bg: '#EFF6FF' },
  { key: 'scheduled', label: 'Scheduled', color: '#7C3AED', bg: '#F5F3FF' },
  { key: 'converted', label: 'Converted ✅', color: '#065F46', bg: '#ECFDF5' },
  { key: 'removed',   label: 'Removed',   color: '#6B7280', bg: '#F3F4F6' },
];

function prioConfig(key) { return PRIORITIES.find(p => p.key === key) || PRIORITIES[2]; }
function statusConfig(key) { return STATUSES.find(s => s.key === key) || STATUSES[0]; }

function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date() - new Date(dateStr + 'T00:00:00')) / 86400000);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function urgencyColor(days) {
  if (days === null) return '#6B7280';
  if (days >= 30) return '#DC2626';
  if (days >= 14) return '#D97706';
  if (days >= 7)  return '#059669';
  return '#1565C0';
}

// ── Assignment Modal ──────────────────────────────────────────────────────────
function AssignModal({ patient, clinicians, onClose, onSaved, profile }) {
  const [form, setForm] = useState({
    assigned_clinician: patient.assigned_clinician || '',
    assignment_status: patient.assignment_status || 'pending',
    priority: patient.priority || 'normal',
    priority_reason: patient.priority_reason || '',
    outreach_notes: patient.outreach_notes || '',
    target_start_date: patient.target_start_date || '',
    removal_reason: patient.removal_reason || '',
  });
  const [saving, setSaving] = useState(false);

  // Filter clinicians to same region as patient (supports comma-separated multi-region, e.g. "M,N")
  const regionClinicians = clinicians.filter(c =>
    c.region === 'All' || c.region === patient.region || (c.region && c.region.split(',').map(r => r.trim()).includes(patient.region))
  ).sort((a, b) => (b.capacity || 0) - (a.capacity || 0));

  async function save() {
    setSaving(true);
    const now = new Date().toISOString();
    const payload = {
      ...form,
      assigned_by: profile?.full_name || profile?.email,
      assigned_at: form.assigned_clinician ? now : null,
      updated_at: now,
    };
    await supabase.from('waitlist_assignments').update(payload).eq('patient_name', patient.patient_name);
    setSaving(false);
    onSaved();
  }

  async function logOutreach() {
    setSaving(true);
    await supabase.from('waitlist_assignments').update({
      outreach_count: (patient.outreach_count || 0) + 1,
      last_outreach_date: new Date().toISOString().slice(0,10),
      last_outreach_by: profile?.full_name || profile?.email,
      outreach_notes: form.outreach_notes,
      updated_at: new Date().toISOString(),
    }).eq('patient_name', patient.patient_name);
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:560, boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{patient.patient_name}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', marginTop:2 }}>
              Region {patient.region} · {patient.city || '?'}{patient.zip_code ? `, ${patient.zip_code}` : ''} · {patient.insurance}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.6)' }}>×</button>
        </div>

        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:16 }}>
          {/* Time on waitlist alert */}
          {patient.daysOnWaitlist >= 14 && (
            <div style={{ background:patient.daysOnWaitlist>=30?'#FEF2F2':'#FEF3C7', border:`1px solid ${patient.daysOnWaitlist>=30?'#FECACA':'#FCD34D'}`, borderRadius:8, padding:'10px 14px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:patient.daysOnWaitlist>=30?'#DC2626':'#92400E' }}>
                ⚠ {patient.daysOnWaitlist} days on waitlist{patient.daysOnWaitlist>=30?' — OVERDUE for action':''}
              </div>
            </div>
          )}

          {/* Priority */}
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>Priority</label>
            <div style={{ display:'flex', gap:8 }}>
              {PRIORITIES.map(p => (
                <button key={p.key} onClick={() => setForm(f=>({...f, priority:p.key}))}
                  style={{ flex:1, padding:'7px 8px', borderRadius:7, border:`2px solid ${form.priority===p.key?p.color:'var(--border)'}`, background:form.priority===p.key?p.bg:'var(--card-bg)', cursor:'pointer', fontSize:11, fontWeight:form.priority===p.key?700:400, color:form.priority===p.key?p.color:'var(--gray)' }}>
                  {p.label}
                </button>
              ))}
            </div>
            {(form.priority === 'urgent' || form.priority === 'high') && (
              <input value={form.priority_reason} onChange={e => setForm(f=>({...f,priority_reason:e.target.value}))}
                placeholder="Reason for elevated priority…"
                style={{ marginTop:6, width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            )}
          </div>

          {/* Clinician Assignment */}
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>
              Assign Clinician
              <span style={{ fontSize:10, fontWeight:400, color:'var(--gray)', marginLeft:8 }}>Sorted by available capacity</span>
            </label>
            <select value={form.assigned_clinician} onChange={e => setForm(f=>({...f, assigned_clinician:e.target.value, assignment_status:e.target.value?'assigned':'pending'}))}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
              <option value="">— Unassigned —</option>
              {regionClinicians.map(c => (
                <option key={c.full_name} value={c.full_name}>
                  {c.full_name} ({c.discipline}) · Region {c.region} · {c.capacity > 0 ? `${c.capacity} visits available` : 'Near capacity'}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>Status</label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {STATUSES.map(s => (
                <button key={s.key} onClick={() => setForm(f=>({...f, assignment_status:s.key}))}
                  style={{ padding:'5px 12px', borderRadius:6, border:`2px solid ${form.assignment_status===s.key?s.color:'var(--border)'}`, background:form.assignment_status===s.key?s.bg:'var(--card-bg)', cursor:'pointer', fontSize:11, fontWeight:form.assignment_status===s.key?700:400, color:form.assignment_status===s.key?s.color:'var(--gray)' }}>
                  {s.label}
                </button>
              ))}
            </div>
            {form.assignment_status === 'removed' && (
              <input value={form.removal_reason} onChange={e => setForm(f=>({...f,removal_reason:e.target.value}))}
                placeholder="Removal reason (declined, unreachable, moved, etc.)…"
                style={{ marginTop:6, width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            )}
          </div>

          {/* Target start date */}
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--black)', display:'block', marginBottom:4 }}>Target Start Date</label>
            <input type="date" value={form.target_start_date} onChange={e => setForm(f=>({...f,target_start_date:e.target.value}))}
              style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }} />
          </div>

          {/* Outreach notes */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--black)' }}>Outreach Notes</label>
              <span style={{ fontSize:10, color:'var(--gray)' }}>
                {patient.outreach_count || 0} contact{(patient.outreach_count||0)!==1?'s':''} made
                {patient.last_outreach_date ? ` · last ${fmtDate(patient.last_outreach_date)}` : ''}
              </span>
            </div>
            <textarea value={form.outreach_notes} onChange={e => setForm(f=>({...f,outreach_notes:e.target.value}))}
              placeholder="Call notes, patient availability, barriers to starting, etc."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:72, background:'var(--card-bg)' }} />
          </div>
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', gap:8, background:'var(--bg)' }}>
          <button onClick={logOutreach} disabled={saving}
            style={{ padding:'8px 14px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, background:'var(--card-bg)', cursor:'pointer', color:'var(--black)' }}>
            📞 Log Outreach Contact
          </button>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving}
              style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WaitlistPage() {
  const { profile } = useAuth();
  const [waitlist, setWaitlist] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [intake, setIntake] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterPriority, setFilterPriority] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('daysOnWaitlist');
  const [sortDir, setSortDir] = useState('desc');
  const [editModal, setEditModal] = useState(null);

  const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

  // Region scoping — users only see rows for their assigned regions.
  const regionScope = useAssignedRegions();

  const load = useCallback(async () => {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setWaitlist([]); setClinicians([]); setIntake([]); setVisits([]);
      setLoading(false);
      return;
    }
    const [wl, cl, ir, vs] = await Promise.all([
      fetchAllPages(regionScope.applyToQuery(supabase.from('waitlist_assignments').select('*'))),
      fetchAllPages(regionScope.applyToQuery(supabase.from('clinicians').select('full_name,region,discipline,weekly_visit_target,is_active,zip,lat,lng').eq('is_active', true))),
      // intake_referrals has a region column — scope it too, and include
      // region in the select so downstream UI code can show it.
      fetchAllPages(regionScope.applyToQuery(supabase.from('intake_referrals').select('patient_name,city,zip_code,county,diagnosis,contact_number,pcp_name,location,region').order('date_received', { ascending: false }))),
      // visit_schedule_data needs region filtering too (even with limited
      // selected columns) so we don't leak cross-region staff activity.
      fetchAllPages(regionScope.applyToQuery(supabase.from('visit_schedule_data').select('staff_name,visit_date,status,region').gte('visit_date', new Date(Date.now()-7*86400000).toISOString().slice(0,10)))),
    ]);
    setWaitlist(wl);
    setClinicians(cl);
    setIntake(ir);
    setVisits(vs);
    setLoading(false);
  }, [regionScope.isAllAccess, regionScope.loading, JSON.stringify(regionScope.regions)]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['waitlist_assignments', 'intake_referrals', 'clinicians', 'visit_schedule_data'], load);

  // Build enriched patient list
  const patients = useMemo(() => {
    // Build intake lookup (most recent referral per patient)
    const intakeMap = {};
    intake.forEach(r => {
      const key = r.patient_name?.toLowerCase().trim();
      if (key && !intakeMap[key]) intakeMap[key] = r;
    });

    // Build clinician capacity map
    const visitCount = {};
    visits.forEach(v => {
      if (v.staff_name && /completed/i.test(v.status||'')) {
        visitCount[v.staff_name] = (visitCount[v.staff_name] || 0) + 1;
      }
    });

    const enrichedClinicians = clinicians.map(c => ({
      ...c,
      visitsThisWeek: visitCount[c.full_name] || 0,
      capacity: Math.max(0, (c.weekly_visit_target || 0) - (visitCount[c.full_name] || 0)),
    }));

    return waitlist.map(w => {
      const iKey = w.patient_name?.toLowerCase().trim();
      const ir = intakeMap[iKey] || {};
      const daysOnWaitlist = w.waitlisted_since ? daysAgo(w.waitlisted_since) : null;

      // Find best matched clinician candidates (same region, has capacity — supports multi-region e.g. "M,N")
      const regionClinicians = enrichedClinicians
        .filter(c => (c.region === 'All' || c.region === w.region || (c.region && c.region.split(',').map(r => r.trim()).includes(w.region))) && c.capacity > 0)
        .sort((a, b) => b.capacity - a.capacity);

      return {
        ...w,
        city: ir.city || null,
        zip_code: ir.zip_code || null,
        county: ir.county || null,
        diagnosis: ir.diagnosis || null,
        contact_number: ir.contact_number || null,
        pcp_name: ir.pcp_name || null,
        daysOnWaitlist,
        regionClinicians,
        topClinician: regionClinicians[0] || null,
        availableClinicianCount: regionClinicians.length,
      };
    });
  }, [waitlist, clinicians, intake, visits]);

  // Enriched clinicians for modal
  const enrichedClinicians = useMemo(() => {
    const visitCount = {};
    visits.forEach(v => {
      if (v.staff_name && /completed/i.test(v.status||'')) {
        visitCount[v.staff_name] = (visitCount[v.staff_name] || 0) + 1;
      }
    });
    return clinicians.map(c => ({
      ...c,
      visitsThisWeek: visitCount[c.full_name] || 0,
      capacity: Math.max(0, (c.weekly_visit_target || 0) - (visitCount[c.full_name] || 0)),
    }));
  }, [clinicians, visits]);

  const filtered = useMemo(() => {
    return patients.filter(p => {
      if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
      if (filterPriority !== 'ALL' && p.priority !== filterPriority) return false;
      if (filterStatus !== 'ALL' && p.assignment_status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${p.patient_name} ${p.city} ${p.county} ${p.insurance} ${p.assigned_clinician}`.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (av == null) av = sortDir === 'asc' ? Infinity : -Infinity;
      if (bv == null) bv = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [patients, filterRegion, filterPriority, filterStatus, search, sortField, sortDir]);

  const stats = useMemo(() => {
    const active = patients.filter(p => !['converted','removed'].includes(p.assignment_status));
    return {
      total: active.length,
      urgent: active.filter(p => p.priority === 'urgent' || p.daysOnWaitlist >= 30).length,
      unassigned: active.filter(p => !p.assigned_clinician).length,
      over14days: active.filter(p => p.daysOnWaitlist >= 14).length,
      over30days: active.filter(p => p.daysOnWaitlist >= 30).length,
      avgDays: active.length > 0 ? Math.round(active.reduce((s,p) => s + (p.daysOnWaitlist||0), 0) / active.length) : 0,
      byRegion: REGIONS.reduce((acc, r) => ({ ...acc, [r]: active.filter(p=>p.region===r).length }), {}),
    };
  }, [patients]);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Waitlist Management" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading waitlist data…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Waitlist Management"
        subtitle={`${stats.total} active · ${stats.unassigned} unassigned · ${stats.over14days} waiting 14+ days`}
      />
      <div style={{ flex:1 }}>

        {/* Urgent alert bar */}
        {stats.over30days > 0 && (
          <div style={{ background:'#FEF2F2', borderBottom:'2px solid #FECACA', padding:'8px 20px', display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:16 }}>🚨</span>
            <span style={{ fontSize:12, fontWeight:700, color:'#DC2626' }}>
              {stats.over30days} patient{stats.over30days>1?'s':''} have been on the waitlist 30+ days — immediate action needed
            </span>
            <button onClick={() => { setSortField('daysOnWaitlist'); setSortDir('desc'); setFilterStatus('pending'); }}
              style={{ marginLeft:'auto', fontSize:11, fontWeight:600, color:'#DC2626', background:'white', border:'1px solid #FECACA', borderRadius:5, padding:'3px 10px', cursor:'pointer' }}>
              Show Oldest First
            </button>
          </div>
        )}

        {/* Filter bar */}
        <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['ALL','All'],['pending','⏳ Pending'],['assigned','👤 Assigned'],['scheduled','📅 Scheduled'],['converted','✅ Converted'],['removed','❌ Removed']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterStatus(k)}
                style={{ padding:'5px 10px', border:'none', fontSize:11, fontWeight:filterStatus===k?700:400, cursor:'pointer', background:filterStatus===k?'#0F1117':'var(--card-bg)', color:filterStatus===k?'#fff':'var(--gray)' }}>
                {l}
              </button>
            ))}
          </div>
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r} ({stats.byRegion[r] || 0})</option>)}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Priorities</option>
            {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, city, clinician…"
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:180 }} />
          {(filterRegion!=='ALL'||filterPriority!=='ALL'||search) && (
            <button onClick={() => { setFilterRegion('ALL'); setFilterPriority('ALL'); setSearch(''); }}
              style={{ fontSize:10, color:'var(--gray)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Clear</button>
          )}
          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} shown</div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPI Cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12 }}>
            {[
              { label:'Active Waitlist', val:stats.total, color:'var(--black)', bg:'var(--card-bg)', sub:'Total patients waiting' },
              { label:'🚨 30+ Days', val:stats.over30days, color:'#DC2626', bg:stats.over30days>0?'#FEF2F2':'var(--card-bg)', sub:'Critical — overdue action' },
              { label:'⚠ 14+ Days', val:stats.over14days, color:'#D97706', bg:'#FEF3C7', sub:'Need assignment soon' },
              { label:'👤 Unassigned', val:stats.unassigned, color:'#7C3AED', bg:'#F5F3FF', sub:'No clinician assigned' },
              { label:'📊 Avg Wait', val:stats.avgDays + 'd', color:'#1565C0', bg:'#EFF6FF', sub:'Average days on waitlist' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg, border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                <div style={{ fontSize:26, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:4 }}>{c.val}</div>
                <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Region distribution bar */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>Waitlist by Region</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {REGIONS.map(r => {
                const cnt = stats.byRegion[r] || 0;
                if (!cnt) return null;
                return (
                  <div key={r} onClick={() => setFilterRegion(filterRegion===r?'ALL':r)}
                    style={{ padding:'8px 14px', borderRadius:8, background:filterRegion===r?'#0F1117':'#F3F4F6', border:`2px solid ${filterRegion===r?'#0F1117':'transparent'}`, cursor:'pointer', textAlign:'center', minWidth:60 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:filterRegion===r?'#fff':'var(--gray)' }}>Region {r}</div>
                    <div style={{ fontSize:20, fontWeight:900, fontFamily:'DM Mono, monospace', color:filterRegion===r?'#fff':'var(--black)' }}>{cnt}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main patient table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Waitlist Patients</div>
              <div style={{ fontSize:11, color:'var(--gray)' }}>{filtered.length} patients · click row to manage</div>
            </div>

            {/* Table header */}
            <div style={{ display:'grid', gridTemplateColumns:'1.6fr 0.4fr 0.7fr 0.7fr 0.7fr 0.9fr 1.1fr 0.9fr 0.8fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              {[['Patient','patient_name'],['Rgn','region'],['Days','daysOnWaitlist'],['Priority','priority'],['Status','assignment_status'],['Location','city'],['Assigned To','assigned_clinician'],['Available','availableClinicianCount'],['Last Contact','']].map(([l,f]) => (
                <div key={l} style={{ cursor:f?'pointer':'default' }} onClick={() => f && toggleSort(f)}>
                  {l}{f && <span style={{ fontSize:9, color:sortField===f?'#1565C0':'#ccc', marginLeft:2 }}>{sortField===f?(sortDir==='asc'?'↑':'↓'):'↕'}</span>}
                </div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding:48, textAlign:'center', color:'var(--gray)' }}>
                {patients.length === 0 ? 'No waitlist patients found.' : 'No patients match current filters.'}
              </div>
            ) : filtered.map((p, i) => {
              const pc = prioConfig(p.priority);
              const sc = statusConfig(p.assignment_status);
              const dColor = urgencyColor(p.daysOnWaitlist);
              const rowBg = p.daysOnWaitlist >= 30 ? '#FFF5F5' : p.daysOnWaitlist >= 14 ? '#FFFBEB' : i%2===0 ? 'var(--card-bg)' : 'var(--bg)';
              return (
                <div key={p.id || p.patient_name}
                  onClick={() => setEditModal(p)}
                  style={{ display:'grid', gridTemplateColumns:'1.6fr 0.4fr 0.7fr 0.7fr 0.7fr 0.9fr 1.1fr 0.9fr 0.8fr', padding:'11px 20px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8, cursor:'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background='#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background=rowBg}>

                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                    <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>{p.insurance} · {p.diagnosis?.replace('I89.0 ','') || '—'}</div>
                  </div>

                  <span style={{ fontSize:12, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>

                  <div>
                    <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:dColor }}>
                      {p.daysOnWaitlist !== null ? p.daysOnWaitlist : '—'}
                    </div>
                    <div style={{ fontSize:9, color:dColor }}>{p.daysOnWaitlist !== null ? 'days' : ''}</div>
                  </div>

                  <span style={{ fontSize:10, fontWeight:700, color:pc.color, background:pc.bg, padding:'2px 8px', borderRadius:999 }}>
                    {pc.label}
                  </span>

                  <span style={{ fontSize:10, fontWeight:700, color:sc.color, background:sc.bg, padding:'2px 8px', borderRadius:999 }}>
                    {sc.label}
                  </span>

                  <div>
                    <div style={{ fontSize:11, fontWeight:600 }}>{p.city || '—'}</div>
                    {p.zip_code && <div style={{ fontSize:10, color:'var(--gray)' }}>{p.zip_code}</div>}
                  </div>

                  <div>
                    {p.assigned_clinician ? (
                      <div>
                        <div style={{ fontSize:11, fontWeight:600, color:'#1565C0' }}>{p.assigned_clinician.split(',')[0] || p.assigned_clinician}</div>
                        {p.target_start_date && <div style={{ fontSize:10, color:'var(--gray)' }}>Start: {fmtDate(p.target_start_date)}</div>}
                      </div>
                    ) : (
                      <span style={{ fontSize:10, color:'#9CA3AF', fontStyle:'italic' }}>Unassigned</span>
                    )}
                  </div>

                  <div>
                    {p.availableClinicianCount > 0 ? (
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:'#065F46' }}>{p.availableClinicianCount}</div>
                        <div style={{ fontSize:9, color:'#065F46' }}>with capacity</div>
                        {p.topClinician && <div style={{ fontSize:9, color:'var(--gray)', marginTop:1 }}>Best: {p.topClinician.full_name.split(' ').slice(-1)[0]}</div>}
                      </div>
                    ) : (
                      <span style={{ fontSize:10, color:'#DC2626', fontWeight:600 }}>None available</span>
                    )}
                  </div>

                  <div>
                    {p.last_outreach_date ? (
                      <div>
                        <div style={{ fontSize:11 }}>{fmtDate(p.last_outreach_date)}</div>
                        <div style={{ fontSize:9, color:'var(--gray)' }}>{p.outreach_count} contact{p.outreach_count!==1?'s':''}</div>
                      </div>
                    ) : (
                      <span style={{ fontSize:10, color:'#DC2626', fontWeight:600 }}>No contact</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Clinician capacity reference panel */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', fontSize:14, fontWeight:700 }}>
              Clinician Capacity — This Week
              <span style={{ fontSize:11, fontWeight:400, color:'var(--gray)', marginLeft:8 }}>PT/PTA/OT with open slots for new patients</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:0 }}>
              {['A','B','C','G','H','J','M','N','T','V'].map(region => {
                const regionClinicians = enrichedClinicians
                  .filter(c => c.region === region || c.region === 'All')
                  .sort((a,b) => b.capacity - a.capacity)
                  .slice(0, 4);
                if (regionClinicians.length === 0) return null;
                return (
                  <div key={region} style={{ padding:'12px 14px', borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ fontSize:11, fontWeight:800, color:'var(--gray)', marginBottom:8 }}>Region {region}</div>
                    {regionClinicians.map(c => (
                      <div key={c.full_name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:600 }}>{c.full_name.split(' ').slice(-1)[0]}, {c.full_name.split(' ')[0][0]}.</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>{c.discipline}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:12, fontWeight:700, color:c.capacity>5?'#065F46':c.capacity>0?'#D97706':'#DC2626' }}>
                            {c.capacity > 0 ? `+${c.capacity}` : 'Full'}
                          </div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>{c.visitsThisWeek}/{c.weekly_visit_target}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {editModal && (
        <AssignModal
          patient={editModal}
          clinicians={enrichedClinicians}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); load(); }}
          profile={profile}
        />
      )}
    </div>
  );
}
