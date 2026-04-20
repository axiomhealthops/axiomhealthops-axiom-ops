import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import PatientNotesPanel from '../../components/PatientNotesPanel';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function daysAgo(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d+'T00:00:00')) / 86400000);
}

function ReferralModal({ referral, onClose, onSaved, profile }) {
  const [chartStatus, setChartStatus] = useState(referral.chart_status || '');
  const [censusStatus, setCensusStatus] = useState(referral.census_status || '');
  const [welcomeCall, setWelcomeCall] = useState(referral.welcome_call || '');
  const [firstAppt, setFirstAppt] = useState(referral.first_appt || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function save() {
    setSaving(true);
    setSaveError('');
    const { error } = await supabase.from('intake_referrals').update({
      chart_status: chartStatus || null,
      census_status: censusStatus || null,
      welcome_call: welcomeCall || null,
      first_appt: firstAppt || null,
      updated_at: new Date().toISOString(),
      updated_by: profile?.full_name || profile?.email || null,
    }).eq('id', referral.id);
    setSaving(false);
    if (error) {
      setSaveError('Save failed: ' + error.message);
      return;
    }
    onSaved();
  }

  const classColor = { 'new_patient':'#1565C0', 'existing_patient':'#065F46', 'non_admit':'#DC2626', 'unclassified':'#6B7280' };
  const classLabel = { 'new_patient':'🆕 New Patient', 'existing_patient':'🔄 Existing', 'non_admit':'❌ Non-Admit', 'unclassified':'?' };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:560, boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding:'16px 22px', background:'#065F46', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{referral.patient_name}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', marginTop:2 }}>
              Rgn {referral.region} · {referral.insurance} · Received {fmtDate(referral.date_received)}
              {referral.patient_classification && <span style={{ marginLeft:8, background:'rgba(255,255,255,0.2)', padding:'1px 6px', borderRadius:999, fontSize:9 }}>{classLabel[referral.patient_classification]||referral.patient_classification}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.6)' }}>×</button>
        </div>
        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:14 }}>
          {/* Referral info */}
          <div style={{ background:'var(--bg)', borderRadius:8, padding:12, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:11 }}>
            <div><span style={{ color:'var(--gray)' }}>Diagnosis: </span>{referral.diagnosis || '—'}</div>
            <div><span style={{ color:'var(--gray)' }}>PCP: </span>{referral.pcp_name || '—'}</div>
            <div style={{ gridColumn:'1/-1' }}><span style={{ color:'var(--gray)' }}>Source: </span>{referral.referral_source || '—'}</div>
            <div><span style={{ color:'var(--gray)' }}>Phone: </span>{referral.contact_number || '—'}</div>
            <div><span style={{ color:'var(--gray)' }}>Location: </span>{referral.city || referral.location || '—'}</div>
          </div>

          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Chart Status</label>
            <select value={chartStatus} onChange={e => setChartStatus(e.target.value)}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
              {['','Pending Intake Call','Chart In Review','Pending HH Discharge','Pending Auth','Auth In Process','Auth Approved','SOC Pending','Waitlist','Denied Referral','On Hold','Scheduled','Active','Discharged'].map(s =>
                <option key={s} value={s}>{s || '— Select —'}</option>
              )}
            </select>
          </div>

          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Welcome Call Status</label>
            <div style={{ display:'flex', gap:6 }}>
              {['Not Called','Attempted','Completed','Non-Admit','Unable to Reach'].map(s => (
                <button key={s} onClick={() => setWelcomeCall(s)}
                  style={{ flex:1, padding:'5px 4px', borderRadius:6, border:`2px solid ${welcomeCall===s?'#065F46':'var(--border)'}`, background:welcomeCall===s?'#ECFDF5':'var(--card-bg)', fontSize:9, fontWeight:700, color:welcomeCall===s?'#065F46':'var(--gray)', cursor:'pointer' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>First Appointment Date</label>
            <input type="date" value={firstAppt} onChange={e => setFirstAppt(e.target.value)}
              style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }} />
          </div>
          <PatientNotesPanel patientName={referral.patient_name} maxHeight="280px" />
        </div>
        {saveError && (
          <div style={{ padding:'8px 22px', background:'#FEF2F2', borderTop:'1px solid #FECACA' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#DC2626' }}>⚠ {saveError}</div>
          </div>
        )}
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, cursor:'pointer', background:'var(--card-bg)' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding:'8px 22px', background:'#065F46', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {saving ? 'Saving…' : 'Update Referral'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntakeCoordQueue() {
  const { profile } = useAuth();
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('action');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

  const regionScope = useAssignedRegions();

  const load = useCallback(async () => {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setReferrals([]); setLoading(false); return;
    }
    const { data } = await regionScope.applyToQuery(
      supabase.from('intake_referrals')
        .select('*')
        .order('date_received', { ascending: false })
    );
    setReferrals(data || []);
    setLoading(false);
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable('intake_referrals', load);

  const enriched = useMemo(() => referrals.map(r => ({
    ...r,
    daysSinceReceived: daysAgo(r.date_received),
    needsAction: r.referral_status === 'Accepted' && (!r.welcome_call || r.welcome_call === 'Not Called' || r.welcome_call === ''),
    isStalled: r.referral_status === 'Accepted' && r.daysSinceReceived > 7 && !r.first_appt,
  })), [referrals]);

  const stats = useMemo(() => {
    const accepted = enriched.filter(r => r.referral_status === 'Accepted');
    const thisWeek = enriched.filter(r => r.daysSinceReceived !== null && r.daysSinceReceived <= 7);
    return {
      newThisWeek: thisWeek.length,
      newPatientsWeek: thisWeek.filter(r => r.patient_classification === 'new_patient').length,
      accepted: accepted.length,
      needsWelcomeCall: accepted.filter(r => !r.welcome_call || r.welcome_call === 'Not Called').length,
      pendingFirstAppt: accepted.filter(r => !r.first_appt).length,
      denied: enriched.filter(r => r.referral_status === 'Denied').length,
      stalled: accepted.filter(r => r.daysSinceReceived !== null && r.daysSinceReceived > 7 && !r.first_appt).length,
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (activeTab === 'action')    list = list.filter(r => r.referral_status === 'Accepted' && (!r.welcome_call || r.welcome_call === 'Not Called'));
    if (activeTab === 'this_week') list = list.filter(r => r.daysSinceReceived !== null && r.daysSinceReceived <= 7);
    if (activeTab === 'stalled')   list = list.filter(r => r.referral_status === 'Accepted' && r.daysSinceReceived > 7 && !r.first_appt);
    if (activeTab === 'all')       list = list.filter(r => r.referral_status === 'Accepted');
    if (activeTab === 'denied')    list = list.filter(r => r.referral_status === 'Denied');
    if (filterRegion !== 'ALL') list = list.filter(r => r.region === filterRegion);
    if (filterType !== 'ALL') list = list.filter(r => r.patient_classification === filterType || r.referral_type === filterType);
    if (search) { const q = search.toLowerCase(); list = list.filter(r => `${r.patient_name} ${r.insurance} ${r.referral_source||''} ${r.pcp_name||''}`.toLowerCase().includes(q)); }
    return list.sort((a, b) => (b.daysSinceReceived ?? 0) - (a.daysSinceReceived ?? 0));
  }, [enriched, activeTab, filterRegion, filterType, search]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Intake Work Queue" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading referral queue...</div>
    </div>
  );

  const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const classConfig = { 'new_patient':{color:'#1565C0',bg:'#EFF6FF',label:'🆕 New'}, 'existing_patient':{color:'#065F46',bg:'#ECFDF5',label:'🔄 Existing'}, 'non_admit':{color:'#DC2626',bg:'#FEF2F2',label:'❌ Non-Admit'}, 'insurance_change':{color:'#7C3AED',bg:'#F5F3FF',label:'🔀 Ins.Change'} };

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar title="Intake Work Queue" subtitle={`${today} · ${stats.needsWelcomeCall} need welcome call · ${stats.newThisWeek} this week`}
        actions={<button onClick={load} style={{ padding:'6px 14px', background:'#065F46', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>↻ Refresh</button>} />

      {stats.needsWelcomeCall > 0 && (
        <div style={{ background:'#FEF3C7', borderBottom:'2px solid #FCD34D', padding:'7px 20px', display:'flex', alignItems:'center', gap:10 }}>
          <span>📞</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#92400E' }}>{stats.needsWelcomeCall} accepted referrals still need welcome call</span>
          <button onClick={() => setActiveTab('action')} style={{ marginLeft:'auto', fontSize:10, fontWeight:700, color:'#92400E', background:'white', border:'1px solid #FCD34D', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>View Queue</button>
        </div>
      )}

      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
            {[
              { label:'This Week',         val:stats.newThisWeek,        color:'#1565C0', bg:'#EFF6FF' },
              { label:'🆕 New Patients/Wk', val:stats.newPatientsWeek,    color:'#1565C0', bg:'#EFF6FF' },
              { label:'Total Accepted',     val:stats.accepted,            color:'#059669', bg:'#ECFDF5' },
              { label:'📞 Need Welcome Call',val:stats.needsWelcomeCall,  color:'#D97706', bg:'#FEF3C7' },
              { label:'⏳ No Appt Scheduled',val:stats.pendingFirstAppt,  color:'#7C3AED', bg:'#F5F3FF' },
              { label:'⚠ Stalled 7d+',     val:stats.stalled,             color:'#DC2626', bg:'#FEF2F2' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg, border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px', textAlign:'center' }}>
                <div style={{ fontSize:8, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:2 }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              {[
                { k:'action',    l:`🎯 Action (${stats.needsWelcomeCall})` },
                { k:'this_week', l:`📅 This Week (${stats.newThisWeek})` },
                { k:'stalled',   l:`⚠ Stalled (${stats.stalled})` },
                { k:'all',       l:'All Accepted' },
                { k:'denied',    l:'Denied' },
              ].map(t => (
                <button key={t.k} onClick={() => setActiveTab(t.k)}
                  style={{ padding:'7px 12px', border:'none', fontSize:11, fontWeight:activeTab===t.k?700:400, cursor:'pointer', background:activeTab===t.k?'#065F46':'var(--card-bg)', color:activeTab===t.k?'#fff':'var(--gray)', borderRight:'1px solid var(--border)' }}>
                  {t.l}
                </button>
              ))}
            </div>
            <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
              <option value="ALL">All Regions</option>
              {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, source, PCP..."
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:200 }} />
            <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} referrals</div>
          </div>

          {/* Referral Table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1.8fr 0.4fr 0.9fr 0.7fr 0.7fr 0.8fr 1fr 0.8fr', padding:'8px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Type</span><span>Received</span><span>Days Since</span><span>Chart Status</span><span>Welcome Call</span>
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                {activeTab === 'action' ? '✅ All accepted referrals have welcome calls logged!' : 'No referrals match current filters.'}
              </div>
            ) : filtered.map((r, i) => {
              const cc = classConfig[r.patient_classification] || { color:'#6B7280', bg:'#F3F4F6', label: r.referral_type || '—' };
              const dayColor = r.daysSinceReceived > 14 ? '#DC2626' : r.daysSinceReceived > 7 ? '#D97706' : '#059669';
              const rowBg = r.needsAction ? '#FFF8F0' : i%2===0?'var(--card-bg)':'var(--bg)';
              const wcColor = !r.welcome_call || r.welcome_call === 'Not Called' ? '#DC2626' : r.welcome_call === 'Completed' ? '#059669' : '#D97706';
              return (
                <div key={r.id} onClick={() => setSelected(r)}
                  style={{ display:'grid', gridTemplateColumns:'1.8fr 0.4fr 0.9fr 0.7fr 0.7fr 0.8fr 1fr 0.8fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8, cursor:'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background='#F0FFF4'}
                  onMouseLeave={e => e.currentTarget.style.background=rowBg}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{r.patient_name}</div>
                    <div style={{ fontSize:9, color:'var(--gray)' }}>{r.diagnosis?.replace('I89.0 ','') || r.pcp_name || '—'}</div>
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>{r.region}</span>
                  <span style={{ fontSize:11 }}>{r.insurance}</span>
                  <span style={{ fontSize:9, fontWeight:700, color:cc.color, background:cc.bg, padding:'2px 6px', borderRadius:999 }}>{cc.label}</span>
                  <span style={{ fontSize:11 }}>{fmtDate(r.date_received)}</span>
                  <span style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace', color:dayColor }}>{r.daysSinceReceived !== null ? r.daysSinceReceived+'d' : '—'}</span>
                  <span style={{ fontSize:10, color:'var(--gray)' }}>{r.chart_status || '—'}</span>
                  <span style={{ fontSize:10, fontWeight:700, color:wcColor }}>
                    {r.welcome_call || 'Not Called'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <ReferralModal referral={selected} profile={profile} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} />
      )}
    </div>
  );
}
