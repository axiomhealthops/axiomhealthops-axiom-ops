import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const CONTACT_TYPES = ['PCP','Podiatrist','Hospital','Specialist','Wound Care','Orthopedic','Vascular','Cardiology','Neurology','Assisted Living','SNF','Home Health Agency','Other'];
const ENCOUNTER_TYPES = ['In-Person Visit','Phone Call','Drop-In','Lunch & Learn','Event','Email','Referral Received','Follow-Up','Other'];
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TYPE_COLORS = {
  'PCP':'#1565C0','Podiatrist':'#7C3AED','Hospital':'#DC2626','Specialist':'#065F46',
  'Wound Care':'#D97706','Orthopedic':'#0E7490','Vascular':'#9D174D','Cardiology':'#C2410C',
  'Neurology':'#4338CA','Assisted Living':'#166534','SNF':'#92400E','Home Health Agency':'#374151','Other':'#6B7280'
};

// ── Contact Form Modal ──────────────────────────────────────────────────────
function ContactModal({ contact, onClose, onSaved, profile }) {
  const empty = { contact_type:'PCP', practice_name:'', contact_name:'', title:'', phone:'', email:'', address:'', city:'', state:'FL', zip:'', region:'', npi:'', referral_potential:'medium', active_referral_source:false, notes:'', assigned_to:'' };
  const [form, setForm] = useState(contact ? { ...contact } : { ...empty });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.practice_name?.trim()) return;
    setSaving(true);
    const payload = { ...form, updated_at: new Date().toISOString() };
    if (contact) {
      await supabase.from('marketing_contacts').update(payload).eq('id', contact.id);
    } else {
      await supabase.from('marketing_contacts').insert({ ...payload, created_by: profile?.full_name || profile?.email });
    }
    setSaving(false);
    onSaved();
  }

  const F = ({ label, field, type='text', required=false, half=false }) => (
    <div style={{ gridColumn: half ? 'span 1' : 'span 2' }}>
      <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>{label}{required && ' *'}</label>
      <input type={type} value={form[field]||''} onChange={e => setForm(f => ({...f,[field]:e.target.value}))}
        style={{ width:'100%', padding:'7px 10px', border:`1px solid ${required && !form[field]?'#FECACA':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
    </div>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:640, maxHeight:'90vh', overflow:'auto', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{contact ? 'Edit Contact' : 'Add New Contact'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9CA3AF' }}>×</button>
        </div>
        <div style={{ padding:22, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'span 1' }}>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Contact Type *</label>
            <select value={form.contact_type} onChange={e => setForm(f=>({...f,contact_type:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
              {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Region</label>
            <select value={form.region||''} onChange={e => setForm(f=>({...f,region:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
              <option value="">All / Multiple</option>
              {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
            </select>
          </div>
          <F label="Practice / Facility Name" field="practice_name" required />
          <F label="Contact Name" field="contact_name" half />
          <F label="Title (MD, DO, DPM, NP, etc.)" field="title" half />
          <F label="Phone" field="phone" half />
          <F label="Email" field="email" type="email" half />
          <F label="NPI Number" field="npi" half />
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Referral Potential</label>
            <select value={form.referral_potential} onChange={e => setForm(f=>({...f,referral_potential:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
              <option value="high">🔥 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">⬇ Low</option>
            </select>
          </div>
          <F label="Address" field="address" />
          <F label="City" field="city" half />
          <F label="ZIP" field="zip" half />
          <F label="Assigned To (RM / Staff)" field="assigned_to" />
          <div style={{ gridColumn:'span 2' }}>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Notes</label>
            <textarea value={form.notes||''} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
              placeholder="Specialties, patient demographics served, best time to visit, relationship notes…"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:72, background:'var(--card-bg)' }} />
          </div>
          <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', gap:8 }}>
            <input type="checkbox" id="active_ref" checked={!!form.active_referral_source} onChange={e => setForm(f=>({...f,active_referral_source:e.target.checked}))} />
            <label htmlFor="active_ref" style={{ fontSize:13, color:'var(--black)' }}>Active referral source (currently sending patients)</label>
          </div>
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.practice_name?.trim()}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', opacity:!form.practice_name?.trim()?0.5:1 }}>
            {saving ? 'Saving…' : contact ? 'Save Changes' : 'Add Contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Encounter Modal ─────────────────────────────────────────────────────────
function EncounterModal({ contact, onClose, onSaved, profile }) {
  const [form, setForm] = useState({
    encounter_type: 'In-Person Visit',
    encounter_date: new Date().toISOString().slice(0,10),
    conducted_by: profile?.full_name || '',
    region: contact?.region || '',
    summary: '',
    outcome: '',
    referrals_received: 0,
    follow_up_date: '',
    follow_up_notes: '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase.from('marketing_encounters').insert({
      ...form,
      contact_id: contact.id,
      referrals_received: parseInt(form.referrals_received) || 0,
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:560, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'16px 22px', background:'#065F46', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Log Encounter</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.7)', marginTop:2 }}>{contact.practice_name} · {contact.contact_name}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.7)' }}>×</button>
        </div>
        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Encounter Type</label>
              <select value={form.encounter_type} onChange={e => setForm(f=>({...f,encounter_type:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                {ENCOUNTER_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Date</label>
              <input type="date" value={form.encounter_date} onChange={e => setForm(f=>({...f,encounter_date:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Conducted By</label>
              <input value={form.conducted_by} onChange={e => setForm(f=>({...f,conducted_by:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Referrals Received</label>
              <input type="number" min="0" value={form.referrals_received} onChange={e => setForm(f=>({...f,referrals_received:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Summary — What was discussed?</label>
            <textarea value={form.summary} onChange={e => setForm(f=>({...f,summary:e.target.value}))}
              placeholder="Topics covered, who you met with, materials left behind…"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:64, background:'var(--card-bg)' }} />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Outcome</label>
            <input value={form.outcome} onChange={e => setForm(f=>({...f,outcome:e.target.value}))}
              placeholder="e.g. Will refer patients, requested brochures, scheduled follow-up lunch…"
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Follow-Up Date</label>
              <input type="date" value={form.follow_up_date} onChange={e => setForm(f=>({...f,follow_up_date:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Follow-Up Notes</label>
              <input value={form.follow_up_notes} onChange={e => setForm(f=>({...f,follow_up_notes:e.target.value}))}
                placeholder="What to do next visit…"
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
          </div>
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding:'8px 22px', background:'#065F46', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {saving ? 'Saving…' : 'Log Encounter'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function MarketingCRMPage() {
  const { profile } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [encounters, setEncounters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('contacts');
  const [filterType, setFilterType] = useState('ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterPotential, setFilterPotential] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');
  const [showContactModal, setShowContactModal] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [encounterContact, setEncounterContact] = useState(null);
  const [expandedContact, setExpandedContact] = useState(null);

  async function load() {
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from('marketing_contacts').select('*').order('practice_name'),
      supabase.from('marketing_encounters').select('*').order('encounter_date', { ascending: false }),
    ]);
    setContacts(c || []);
    setEncounters(e || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filteredContacts = useMemo(() => contacts.filter(c => {
    if (filterType !== 'ALL' && c.contact_type !== filterType) return false;
    if (filterRegion !== 'ALL' && c.region !== filterRegion) return false;
    if (filterPotential !== 'ALL' && c.referral_potential !== filterPotential) return false;
    if (searchQ) {
      const q = searchQ.toLowerCase();
      if (!`${c.practice_name} ${c.contact_name} ${c.city} ${c.npi}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [contacts, filterType, filterRegion, filterPotential, searchQ]);

  const totalReferrals = encounters.reduce((s, e) => s + (e.referrals_received || 0), 0);
  const thisMonth = new Date().toISOString().slice(0,7);
  const monthEncounters = encounters.filter(e => e.encounter_date?.startsWith(thisMonth));
  const followUpsDue = encounters.filter(e => e.follow_up_date && e.follow_up_date <= new Date().toISOString().slice(0,10) && !e.follow_up_completed);
  const activeRefs = contacts.filter(c => c.active_referral_source).length;

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Marketing CRM" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Marketing CRM"
        subtitle={`${contacts.length} contacts · ${encounters.length} encounters · ${totalReferrals} referrals generated`}
      />
      <div style={{ flex:1 }}>
        {/* Tabs */}
        <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', background:'var(--card-bg)', padding:'0 20px', position:'sticky', top:0, zIndex:10 }}>
          {[['contacts','📋 Contacts'],['encounters','📅 Encounter Log'],['followups','📆 Follow-Ups']].map(([k,l]) => (
            <button key={k} onClick={() => setActiveTab(k)}
              style={{ padding:'12px 16px', border:'none', borderBottom:`2px solid ${activeTab===k?'#DC2626':'transparent'}`, background:'none', fontSize:12, fontWeight:activeTab===k?700:400, color:activeTab===k?'#DC2626':'var(--gray)', cursor:'pointer' }}>
              {l} {k==='followups'&&followUpsDue.length>0&&<span style={{ background:'#DC2626', color:'#fff', borderRadius:999, fontSize:9, fontWeight:700, padding:'1px 5px', marginLeft:4 }}>{followUpsDue.length}</span>}
            </button>
          ))}
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>
          {/* KPI Cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14 }}>
            {[
              { label:'Total Contacts', val:contacts.length, icon:'📋', color:'var(--black)' },
              { label:'Active Referral Sources', val:activeRefs, icon:'🔥', color:'#065F46', bg:'#ECFDF5' },
              { label:'This Month Encounters', val:monthEncounters.length, icon:'📅', color:'#1565C0', bg:'#EFF6FF' },
              { label:'Total Referrals Generated', val:totalReferrals, icon:'👥', color:'#7C3AED', bg:'#F5F3FF' },
              { label:'Follow-Ups Due', val:followUpsDue.length, icon:'📆', color:followUpsDue.length>0?'#DC2626':'#065F46', bg:followUpsDue.length>0?'#FEF2F2':'var(--card-bg)' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg||'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{c.label}</div>
                  <span style={{ fontSize:16 }}>{c.icon}</span>
                </div>
                <div style={{ fontSize:26, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:6 }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* ── CONTACTS TAB ── */}
          {activeTab === 'contacts' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {/* Filter bar */}
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search practice, name, NPI…"
                  style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)', width:200 }} />
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                  style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
                  <option value="ALL">All Types</option>
                  {CONTACT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
                  style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
                  <option value="ALL">All Regions</option>
                  {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
                </select>
                <select value={filterPotential} onChange={e => setFilterPotential(e.target.value)}
                  style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
                  <option value="ALL">All Potential</option>
                  <option value="high">🔥 High</option>
                  <option value="medium">🟡 Medium</option>
                  <option value="low">⬇ Low</option>
                </select>
                <span style={{ fontSize:11, color:'var(--gray)' }}>{filteredContacts.length} shown</span>
                <button onClick={() => { setEditContact(null); setShowContactModal(true); }}
                  style={{ marginLeft:'auto', padding:'7px 16px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  + Add Contact
                </button>
              </div>

              {filteredContacts.length === 0 ? (
                <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:48, textAlign:'center' }}>
                  <div style={{ fontSize:32 }}>📋</div>
                  <div style={{ fontSize:15, fontWeight:600, marginTop:12, color:'var(--black)' }}>No contacts yet</div>
                  <div style={{ fontSize:13, color:'var(--gray)', marginTop:6 }}>Start building your marketing contact list</div>
                  <button onClick={() => setShowContactModal(true)}
                    style={{ marginTop:16, padding:'8px 20px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                    + Add First Contact
                  </button>
                </div>
              ) : filteredContacts.map(c => {
                const contactEncounters = encounters.filter(e => e.contact_id === c.id);
                const isExpanded = expandedContact === c.id;
                const typeColor = TYPE_COLORS[c.contact_type] || '#6B7280';
                const refCount = contactEncounters.reduce((s,e) => s+(e.referrals_received||0), 0);
                return (
                  <div key={c.id} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 18px', cursor:'pointer' }}
                      onClick={() => setExpandedContact(isExpanded ? null : c.id)}>
                      <div style={{ width:42, height:42, borderRadius:10, background:typeColor+'20', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <span style={{ fontSize:10, fontWeight:800, color:typeColor }}>{c.contact_type.slice(0,3).toUpperCase()}</span>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <div style={{ fontSize:14, fontWeight:700 }}>{c.practice_name}</div>
                          <span style={{ fontSize:10, fontWeight:700, color:typeColor, background:typeColor+'15', padding:'2px 8px', borderRadius:999 }}>{c.contact_type}</span>
                          {c.active_referral_source && <span style={{ fontSize:10, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>🔥 Active Source</span>}
                          {c.region && <span style={{ fontSize:10, color:'var(--gray)', background:'var(--border)', padding:'2px 7px', borderRadius:999 }}>Rgn {c.region}</span>}
                        </div>
                        <div style={{ fontSize:12, color:'var(--gray)', marginTop:3 }}>
                          {c.contact_name && <span style={{ marginRight:12 }}>👤 {c.contact_name}{c.title?` · ${c.title}`:''}</span>}
                          {c.phone && <span style={{ marginRight:12 }}>📞 {c.phone}</span>}
                          {c.city && <span>📍 {c.city}, {c.state}</span>}
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:16, alignItems:'center', flexShrink:0 }}>
                        <div style={{ textAlign:'center' }}>
                          <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#1565C0' }}>{contactEncounters.length}</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>encounters</div>
                        </div>
                        <div style={{ textAlign:'center' }}>
                          <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#065F46' }}>{refCount}</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>referrals</div>
                        </div>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={e => { e.stopPropagation(); setEncounterContact(c); }}
                            style={{ fontSize:11, fontWeight:600, color:'#065F46', background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
                            + Log Visit
                          </button>
                          <button onClick={e => { e.stopPropagation(); setEditContact(c); setShowContactModal(true); }}
                            style={{ fontSize:11, color:'var(--gray)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
                            Edit
                          </button>
                        </div>
                        <span style={{ fontSize:16, color:'var(--gray)' }}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ borderTop:'1px solid var(--border)', background:'var(--bg)', padding:'14px 18px' }}>
                        {c.notes && <div style={{ fontSize:12, color:'var(--gray)', marginBottom:12, fontStyle:'italic' }}>{c.notes}</div>}
                        <div style={{ fontSize:12, fontWeight:700, marginBottom:8 }}>Encounter History ({contactEncounters.length})</div>
                        {contactEncounters.length === 0 ? (
                          <div style={{ fontSize:12, color:'var(--gray)', fontStyle:'italic' }}>No encounters logged yet. Click "+ Log Visit" to add one.</div>
                        ) : contactEncounters.map(enc => (
                          <div key={enc.id} style={{ display:'flex', gap:12, padding:'8px 12px', background:'var(--card-bg)', borderRadius:7, border:'1px solid var(--border)', marginBottom:6, alignItems:'flex-start' }}>
                            <div style={{ fontSize:10, fontFamily:'DM Mono, monospace', color:'var(--gray)', flexShrink:0, marginTop:1 }}>{fmtDate(enc.encounter_date)}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:12, fontWeight:600 }}>{enc.encounter_type} <span style={{ color:'var(--gray)', fontWeight:400 }}>by {enc.conducted_by}</span></div>
                              {enc.summary && <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{enc.summary}</div>}
                              {enc.outcome && <div style={{ fontSize:11, color:'#065F46', marginTop:2 }}>→ {enc.outcome}</div>}
                              {enc.follow_up_date && <div style={{ fontSize:11, color:'#D97706', marginTop:2 }}>📆 Follow-up: {fmtDate(enc.follow_up_date)} {enc.follow_up_notes && `— ${enc.follow_up_notes}`}</div>}
                            </div>
                            {enc.referrals_received > 0 && (
                              <div style={{ fontSize:11, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999, flexShrink:0 }}>
                                +{enc.referrals_received} referral{enc.referrals_received>1?'s':''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── ENCOUNTER LOG TAB ── */}
          {activeTab === 'encounters' && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', fontSize:14, fontWeight:700 }}>All Encounters — Most Recent First</div>
              {encounters.length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>No encounters logged yet. Go to Contacts and click "+ Log Visit".</div>
              ) : encounters.map((e, i) => {
                const contact = contacts.find(c => c.id === e.contact_id);
                return (
                  <div key={e.id} style={{ display:'flex', gap:14, padding:'12px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'flex-start' }}>
                    <div style={{ fontSize:11, fontFamily:'DM Mono, monospace', color:'var(--gray)', flexShrink:0, marginTop:2, minWidth:80 }}>{fmtDate(e.encounter_date)}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>
                        {contact?.practice_name || 'Unknown'} <span style={{ fontSize:11, color:'var(--gray)', fontWeight:400 }}>· {e.encounter_type}</span>
                      </div>
                      <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>by {e.conducted_by}{e.region?` · Region ${e.region}`:''}</div>
                      {e.summary && <div style={{ fontSize:12, color:'var(--black)', marginTop:4 }}>{e.summary}</div>}
                      {e.outcome && <div style={{ fontSize:11, color:'#065F46', marginTop:2 }}>→ {e.outcome}</div>}
                    </div>
                    {e.referrals_received > 0 && (
                      <span style={{ fontSize:11, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'3px 10px', borderRadius:999, flexShrink:0 }}>
                        +{e.referrals_received} referral{e.referrals_received>1?'s':''}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── FOLLOW-UPS TAB ── */}
          {activeTab === 'followups' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {followUpsDue.length > 0 && (
                <div style={{ background:'#FEF2F2', border:'2px solid #FECACA', borderRadius:10, padding:'12px 16px' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#DC2626', marginBottom:4 }}>
                    📆 {followUpsDue.length} follow-up{followUpsDue.length>1?'s':''} overdue or due today
                  </div>
                </div>
              )}
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', fontSize:14, fontWeight:700 }}>Pending Follow-Ups</div>
                {encounters.filter(e => e.follow_up_date && !e.follow_up_completed).length === 0 ? (
                  <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>✅ No pending follow-ups</div>
                ) : encounters.filter(e => e.follow_up_date && !e.follow_up_completed)
                    .sort((a,b) => a.follow_up_date?.localeCompare(b.follow_up_date))
                    .map((e, i) => {
                  const contact = contacts.find(c => c.id === e.contact_id);
                  const overdue = e.follow_up_date <= new Date().toISOString().slice(0,10);
                  return (
                    <div key={e.id} style={{ display:'flex', gap:14, padding:'12px 20px', borderBottom:'1px solid var(--border)', background: overdue ? '#FFF5F5' : i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'flex-start' }}>
                      <div style={{ fontSize:11, fontFamily:'DM Mono, monospace', color: overdue?'#DC2626':'var(--gray)', fontWeight:overdue?700:400, flexShrink:0, marginTop:2, minWidth:80 }}>
                        {overdue ? '⚠ ' : ''}{fmtDate(e.follow_up_date)}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{contact?.practice_name || 'Unknown'}</div>
                        <div style={{ fontSize:11, color:'var(--gray)' }}>
                          {e.encounter_type} on {fmtDate(e.encounter_date)} · by {e.conducted_by}
                        </div>
                        {e.follow_up_notes && <div style={{ fontSize:12, color:'var(--black)', marginTop:3 }}>{e.follow_up_notes}</div>}
                      </div>
                      <button onClick={async () => {
                          await supabase.from('marketing_encounters').update({ follow_up_completed: true }).eq('id', e.id);
                          load();
                        }}
                        style={{ fontSize:11, fontWeight:600, color:'#065F46', background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:6, padding:'4px 10px', cursor:'pointer', flexShrink:0 }}>
                        ✅ Done
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {showContactModal && (
        <ContactModal contact={editContact} onClose={() => { setShowContactModal(false); setEditContact(null); }} onSaved={() => { setShowContactModal(false); setEditContact(null); load(); }} profile={profile} />
      )}
      {encounterContact && (
        <EncounterModal contact={encounterContact} onClose={() => setEncounterContact(null)} onSaved={() => { setEncounterContact(null); load(); }} profile={profile} />
      )}
    </div>
  );
}
