import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

// ── Constants ─────────────────────────────────────────────────────────────────
const WOUND_TYPES = [
  { k: 'venous_ulcer',    l: 'Venous Ulcer',      color: '#1565C0', bg: '#EFF6FF', icon: '🔵' },
  { k: 'arterial_ulcer',  l: 'Arterial Ulcer',    color: '#DC2626', bg: '#FEF2F2', icon: '🔴' },
  { k: 'diabetic_ulcer',  l: 'Diabetic Ulcer',    color: '#D97706', bg: '#FEF3C7', icon: '🟠' },
  { k: 'pressure_injury', l: 'Pressure Injury',   color: '#7C3AED', bg: '#F5F3FF', icon: '🟣' },
  { k: 'surgical_wound',  l: 'Surgical Wound',    color: '#059669', bg: '#ECFDF5', icon: '🟢' },
  { k: 'traumatic_wound', l: 'Traumatic Wound',   color: '#92400E', bg: '#FEF3C7', icon: '🟡' },
  { k: 'lymphedema_wound',l: 'Lymphedema Wound',  color: '#065F46', bg: '#ECFDF5', icon: '💚' },
  { k: 'other',           l: 'Other/Unclassified', color: '#6B7280', bg: '#F3F4F6', icon: '⚪' },
];
const SEVERITIES = [
  { k: 'stage_1',       l: 'Stage 1' },    { k: 'stage_2',       l: 'Stage 2' },
  { k: 'stage_3',       l: 'Stage 3' },    { k: 'stage_4',       l: 'Stage 4' },
  { k: 'unstageable',   l: 'Unstageable' },{ k: 'suspected_dti', l: 'Suspected DTI' },
  { k: 'partial',       l: 'Partial Thickness' },  { k: 'full', l: 'Full Thickness' },
  { k: 'other',         l: 'Other' },
];
const STATUSES = [
  { k: 'active',       l: 'Active',        color: '#DC2626', bg: '#FEF2F2' },
  { k: 'improving',    l: '↑ Improving',   color: '#059669', bg: '#ECFDF5' },
  { k: 'stalled',      l: '→ Stalled',     color: '#D97706', bg: '#FEF3C7' },
  { k: 'deteriorating',l: '↓ Worsening',   color: '#7C3AED', bg: '#FEF2F2' },
  { k: 'healed',       l: '✅ Healed',      color: '#065F46', bg: '#ECFDF5' },
  { k: 'referred_out', l: 'Referred Out',  color: '#6B7280', bg: '#F3F4F6' },
  { k: 'discontinued', l: 'Discontinued',  color: '#6B7280', bg: '#F3F4F6' },
];
const REVIEW_FREQ = ['daily','twice_weekly','weekly','biweekly','monthly','prn'];
const EXUDATE_TYPES = ['none','serous','serosanguineous','sanguineous','purulent'];
const EXUDATE_AMOUNTS = ['none','scant','minimal','moderate','heavy'];
const WOUND_BEDS = ['granulation','slough','eschar','epithelial','necrotic','mixed'];
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function woundTypeCfg(k) { return WOUND_TYPES.find(w => w.k === k) || WOUND_TYPES[WOUND_TYPES.length - 1]; }
function statusCfg(k) { return STATUSES.find(s => s.k === k) || STATUSES[0]; }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
}
function daysAgo(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d + 'T00:00:00')) / 86400000);
}

// ── Flag Patient Modal (flag a census patient as wound care) ──────────────────
function FlagPatientModal({ onClose, onSaved, profileName }) {
  const [census, setCensus] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    wound_type: 'other', wound_location: '', wound_severity: '',
    wound_dimensions: '', wound_onset_date: '', wound_description: '',
    assigned_swift_clinician: '', review_frequency: 'weekly',
    next_review_date: '', referral_diagnosis: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('census_data')
      .select('patient_name, region, insurance, status')
      .not('status', 'ilike', '%discharge%')
      .order('patient_name')
      .then(({ data }) => setCensus(data || []));
  }, []);

  const filteredCensus = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return census.filter(p => p.patient_name.toLowerCase().includes(q)).slice(0, 8);
  }, [census, search]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    await supabase.from('swift_team_patients').upsert({
      patient_name: selected.patient_name,
      region: selected.region,
      insurance: selected.insurance,
      wound_flag: true,
      ...form,
      wound_onset_date: form.wound_onset_date || null,
      next_review_date: form.next_review_date || null,
      flagged_by: profileName,
      flagged_at: new Date().toISOString(),
      flagged_from: 'manual',
      wound_status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'patient_name' });
    // Also mark in census_data
    await supabase.from('census_data').update({
      has_wound: true,
      wound_flag_date: new Date().toISOString().slice(0, 10),
      wound_type: form.wound_type,
    }).eq('patient_name', selected.patient_name);
    setSaving(false);
    onSaved();
  }

  const wt = woundTypeCfg(form.wound_type);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 620, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '16px 22px', background: '#7C3AED', borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>🩹 Flag Patient for SWIFT Team</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}>×</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Patient search */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Search Patient from Census</label>
            <input value={search} onChange={e => { setSearch(e.target.value); setSelected(null); }}
              placeholder="Type patient name..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            {filteredCensus.length > 0 && !selected && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4, overflow: 'hidden' }}>
                {filteredCensus.map(p => (
                  <div key={p.patient_name} onClick={() => { setSelected(p); setSearch(p.patient_name); }}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--card-bg)'}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{p.patient_name}</span>
                    <span style={{ fontSize: 10, color: 'var(--gray)', marginLeft: 8 }}>Rgn {p.region} · {p.insurance} · {p.status}</span>
                  </div>
                ))}
              </div>
            )}
            {selected && (
              <div style={{ marginTop: 6, padding: '8px 12px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 6, fontSize: 12 }}>
                ✓ <strong>{selected.patient_name}</strong> — Region {selected.region} · {selected.insurance}
              </div>
            )}
          </div>

          {/* Wound type */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 8 }}>Wound Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {WOUND_TYPES.map(w => (
                <button key={w.k} onClick={() => setForm(f => ({ ...f, wound_type: w.k }))}
                  style={{ padding: '6px 4px', borderRadius: 7, border: `2px solid ${form.wound_type === w.k ? w.color : 'var(--border)'}`, background: form.wound_type === w.k ? w.bg : 'var(--card-bg)', fontSize: 10, fontWeight: 700, color: form.wound_type === w.k ? w.color : 'var(--gray)', cursor: 'pointer' }}>
                  {w.icon} {w.l}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Wound Location</label>
              <input value={form.wound_location} onChange={e => setForm(f => ({ ...f, wound_location: e.target.value }))}
                placeholder="e.g. Left lateral malleolus"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Wound Dimensions</label>
              <input value={form.wound_dimensions} onChange={e => setForm(f => ({ ...f, wound_dimensions: e.target.value }))}
                placeholder="e.g. 3cm x 2cm x 0.5cm"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Severity/Stage</label>
              <select value={form.wound_severity} onChange={e => setForm(f => ({ ...f, wound_severity: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)' }}>
                <option value="">— Select —</option>
                {SEVERITIES.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Wound Onset Date</label>
              <input type="date" value={form.wound_onset_date} onChange={e => setForm(f => ({ ...f, wound_onset_date: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Assigned SWIFT Clinician</label>
              <input value={form.assigned_swift_clinician} onChange={e => setForm(f => ({ ...f, assigned_swift_clinician: e.target.value }))}
                placeholder="Clinician name..."
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Review Frequency</label>
              <select value={form.review_frequency} onChange={e => setForm(f => ({ ...f, review_frequency: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)' }}>
                {REVIEW_FREQ.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Next Review Date</label>
              <input type="date" value={form.next_review_date} onChange={e => setForm(f => ({ ...f, next_review_date: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Clinical Notes</label>
            <textarea value={form.wound_description} onChange={e => setForm(f => ({ ...f, wound_description: e.target.value }))}
              placeholder="Initial wound presentation, history, current treatment plan..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: 80, background: 'var(--card-bg)' }} />
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--card-bg)' }}>Cancel</button>
          <button onClick={save} disabled={saving || !selected}
            style={{ padding: '8px 22px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !selected ? 0.5 : 1 }}>
            {saving ? 'Flagging…' : '🩹 Flag for SWIFT Team'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Assessment Modal ──────────────────────────────────────────────────────────
function AssessmentModal({ patient, onClose, onSaved, profileName }) {
  const [form, setForm] = useState({
    assessment_date: new Date().toISOString().slice(0, 10),
    assessed_by: profileName || '',
    length_cm: '', width_cm: '', depth_cm: '',
    wound_status: patient.wound_status || 'active',
    exudate_type: '', exudate_amount: '',
    wound_bed: '', periwound_skin: '', odor: '', pain_score: '',
    treatment_applied: '', dressing_type: '',
    next_change_date: '', next_review_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const today = form.assessment_date;
    await supabase.from('swift_wound_assessments').insert({
      swift_patient_id: patient.id,
      patient_name: patient.patient_name,
      ...form,
      length_cm: form.length_cm ? parseFloat(form.length_cm) : null,
      width_cm: form.width_cm ? parseFloat(form.width_cm) : null,
      depth_cm: form.depth_cm ? parseFloat(form.depth_cm) : null,
      pain_score: form.pain_score !== '' ? parseInt(form.pain_score) : null,
      next_change_date: form.next_change_date || null,
      next_review_date: form.next_review_date || null,
    });
    // Update patient record
    await supabase.from('swift_team_patients').update({
      wound_status: form.wound_status,
      last_assessment_date: today,
      last_assessment_by: form.assessed_by,
      last_assessment_notes: form.notes,
      next_review_date: form.next_review_date || null,
      updated_at: new Date().toISOString(),
    }).eq('id', patient.id);
    setSaving(false);
    onSaved();
  }

  const sc = statusCfg(form.wound_status);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 640, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '16px 22px', background: '#065F46', borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>📋 Wound Assessment — {patient.patient_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              {woundTypeCfg(patient.wound_type).icon} {woundTypeCfg(patient.wound_type).l}
              {patient.wound_location && ` · ${patient.wound_location}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}>×</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Status + date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Assessment Date</label>
              <input type="date" value={form.assessment_date} onChange={e => setForm(f => ({ ...f, assessment_date: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Assessed By</label>
              <input value={form.assessed_by} onChange={e => setForm(f => ({ ...f, assessed_by: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Wound status */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 8 }}>Wound Status</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUSES.slice(0, 5).map(s => (
                <button key={s.k} onClick={() => setForm(f => ({ ...f, wound_status: s.k }))}
                  style={{ padding: '6px 12px', borderRadius: 7, border: `2px solid ${form.wound_status === s.k ? s.color : 'var(--border)'}`, background: form.wound_status === s.k ? s.bg : 'var(--card-bg)', fontSize: 11, fontWeight: 700, color: form.wound_status === s.k ? s.color : 'var(--gray)', cursor: 'pointer' }}>
                  {s.l}
                </button>
              ))}
            </div>
          </div>

          {/* Measurements */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 8 }}>Wound Measurements (cm)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[['Length', 'length_cm'], ['Width', 'width_cm'], ['Depth', 'depth_cm']].map(([l, f]) => (
                <div key={f}>
                  <label style={{ fontSize: 10, color: 'var(--gray)', display: 'block', marginBottom: 2 }}>{l}</label>
                  <input type="number" step="0.1" value={form[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))}
                    placeholder="0.0"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box', fontFamily: 'DM Mono, monospace' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Clinical findings */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Exudate Type', field: 'exudate_type', opts: EXUDATE_TYPES },
              { label: 'Exudate Amount', field: 'exudate_amount', opts: EXUDATE_AMOUNTS },
              { label: 'Wound Bed', field: 'wound_bed', opts: WOUND_BEDS },
            ].map(item => (
              <div key={item.field}>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>{item.label}</label>
                <select value={form[item.field]} onChange={e => setForm(f => ({ ...f, [item.field]: e.target.value }))}
                  style={{ width: '100%', padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
                  <option value="">— Select —</option>
                  {item.opts.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Pain Score (0–10)</label>
              <input type="number" min="0" max="10" value={form.pain_score} onChange={e => setForm(f => ({ ...f, pain_score: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box', fontFamily: 'DM Mono, monospace' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Odor</label>
              <select value={form.odor} onChange={e => setForm(f => ({ ...f, odor: e.target.value }))}
                style={{ width: '100%', padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
                <option value="">— Select —</option>
                {['none','mild','moderate','strong'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Periwound Skin</label>
              <input value={form.periwound_skin} onChange={e => setForm(f => ({ ...f, periwound_skin: e.target.value }))}
                placeholder="e.g. macerated, intact"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Treatment */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Treatment Applied</label>
              <input value={form.treatment_applied} onChange={e => setForm(f => ({ ...f, treatment_applied: e.target.value }))}
                placeholder="Cleansing, debridement, etc."
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Dressing Applied</label>
              <input value={form.dressing_type} onChange={e => setForm(f => ({ ...f, dressing_type: e.target.value }))}
                placeholder="e.g. Mepilex, Aquacel Ag"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Next Dressing Change</label>
              <input type="date" value={form.next_change_date} onChange={e => setForm(f => ({ ...f, next_change_date: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Next Clinical Review</label>
              <input type="date" value={form.next_review_date} onChange={e => setForm(f => ({ ...f, next_review_date: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Clinical Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Detailed assessment findings, patient tolerance, plan changes, physician communication..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: 80, background: 'var(--card-bg)' }} />
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--card-bg)' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 22px', background: '#065F46', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving…' : '📋 Save Assessment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Patient Detail Panel ──────────────────────────────────────────────────────
function PatientDetail({ patient, assessments, onAssess, onClose }) {
  const wt = woundTypeCfg(patient.wound_type);
  const sc = statusCfg(patient.wound_status);
  const reviewDue = daysUntil(patient.next_review_date);
  const lastAssessmentDays = daysAgo(patient.last_assessment_date);

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', background: wt.bg, borderBottom: `2px solid ${wt.color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: wt.color }}>{wt.icon} {patient.patient_name}</div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>
            Rgn {patient.region} · {patient.insurance} · {wt.l}
            {patient.wound_location && ` · ${patient.wound_location}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={onAssess}
            style={{ padding: '6px 14px', background: '#065F46', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            📋 Assess
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--gray)' }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Status + alerts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          <div style={{ background: sc.bg, border: `1px solid ${sc.color}`, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: sc.color, textTransform: 'uppercase' }}>Status</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: sc.color, marginTop: 2 }}>{sc.l}</div>
          </div>
          <div style={{ background: reviewDue !== null && reviewDue <= 0 ? '#FEF2F2' : reviewDue !== null && reviewDue <= 3 ? '#FEF3C7' : '#F0FFF4', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase' }}>Next Review</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: reviewDue !== null && reviewDue <= 0 ? '#DC2626' : '#D97706', marginTop: 2 }}>
              {reviewDue === null ? '—' : reviewDue <= 0 ? 'OVERDUE' : `${reviewDue}d`}
            </div>
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase' }}>Last Assessment</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: lastAssessmentDays === null ? '#DC2626' : 'var(--black)', marginTop: 2 }}>
              {lastAssessmentDays === null ? 'Never' : `${lastAssessmentDays}d ago`}
            </div>
          </div>
        </div>

        {/* Wound info */}
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12, fontSize: 11, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['Wound Type', wt.l],
            ['Location', patient.wound_location || '—'],
            ['Dimensions', patient.wound_dimensions || '—'],
            ['Severity', patient.wound_severity ? patient.wound_severity.replace(/_/g, ' ') : '—'],
            ['Onset Date', fmtDate(patient.wound_onset_date)],
            ['SWIFT Clinician', patient.assigned_swift_clinician || '—'],
            ['Review Frequency', patient.review_frequency ? patient.review_frequency.replace(/_/g, ' ') : '—'],
            ['Flagged By', patient.flagged_by || '—'],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ color: 'var(--gray)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', marginBottom: 1 }}>{label}</div>
              <div style={{ fontWeight: 600, color: 'var(--black)' }}>{val}</div>
            </div>
          ))}
        </div>

        {patient.wound_description && (
          <div style={{ background: '#FFFBF0', border: '1px solid #FCD34D', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>Clinical Notes</div>
            <div style={{ fontSize: 12, color: 'var(--black)', lineHeight: 1.5 }}>{patient.wound_description}</div>
          </div>
        )}

        {patient.last_assessment_notes && (
          <div style={{ background: '#F0FFF4', border: '1px solid #A7F3D0', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#065F46', marginBottom: 4 }}>Last Assessment Note ({fmtDate(patient.last_assessment_date)})</div>
            <div style={{ fontSize: 12, color: 'var(--black)', lineHeight: 1.5 }}>{patient.last_assessment_notes}</div>
          </div>
        )}

        {/* Assessment history */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>Assessment History ({assessments.length})</div>
          {assessments.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--gray)', fontSize: 12, background: 'var(--bg)', borderRadius: 8 }}>
              No assessments logged yet — click Assess to record the first
            </div>
          ) : assessments.map((a, i) => {
            const sc = statusCfg(a.wound_status);
            return (
              <div key={a.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{fmtDate(a.assessment_date)}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {a.wound_status && <span style={{ fontSize: 9, fontWeight: 700, color: sc.color, background: sc.bg, padding: '1px 6px', borderRadius: 999 }}>{sc.l}</span>}
                    <span style={{ fontSize: 10, color: 'var(--gray)' }}>by {a.assessed_by || '—'}</span>
                  </div>
                </div>
                {(a.length_cm || a.width_cm) && (
                  <div style={{ fontSize: 11, color: '#1565C0', fontWeight: 600, marginBottom: 4, fontFamily: 'DM Mono, monospace' }}>
                    📐 {a.length_cm}cm × {a.width_cm}cm {a.depth_cm ? `× ${a.depth_cm}cm` : ''}
                  </div>
                )}
                {a.wound_bed && <div style={{ fontSize: 10, color: 'var(--gray)', marginBottom: 2 }}>Wound bed: {a.wound_bed} · Exudate: {a.exudate_type || '—'} ({a.exudate_amount || '—'})</div>}
                {a.dressing_type && <div style={{ fontSize: 10, color: 'var(--gray)', marginBottom: 2 }}>Dressing: {a.dressing_type}</div>}
                {a.notes && <div style={{ fontSize: 11, color: 'var(--black)', lineHeight: 1.4, marginTop: 4 }}>{a.notes}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function SwiftTeamDashboard() {
  const { profile } = useAuth();
  const [patients, setPatients] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('active_only');
  const [filterType, setFilterType] = useState('ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [assessModal, setAssessModal] = useState(null);
  const [flagModal, setFlagModal] = useState(false);

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('swift_team_patients').select('*').order('next_review_date', { ascending: true, nullsFirst: false }),
      supabase.from('swift_wound_assessments').select('*').order('assessment_date', { ascending: false }),
    ]);
    setPatients(p.data || []);
    setAssessments(a.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const assessmentMap = useMemo(() => {
    const map = {};
    assessments.forEach(a => {
      if (!map[a.swift_patient_id]) map[a.swift_patient_id] = [];
      map[a.swift_patient_id].push(a);
    });
    return map;
  }, [assessments]);

  const enriched = useMemo(() => patients.map(p => ({
    ...p,
    reviewDue: daysUntil(p.next_review_date),
    lastAssessmentDays: daysAgo(p.last_assessment_date),
    assessmentCount: assessmentMap[p.id]?.length || 0,
    isOverdue: p.next_review_date && daysUntil(p.next_review_date) <= 0,
    isDueSoon: p.next_review_date && daysUntil(p.next_review_date) > 0 && daysUntil(p.next_review_date) <= 3,
  })), [patients, assessmentMap]);

  const stats = useMemo(() => {
    const active = enriched.filter(p => !['healed','referred_out','discontinued'].includes(p.wound_status));
    return {
      total: active.length,
      overdue: active.filter(p => p.isOverdue).length,
      dueSoon: active.filter(p => p.isDueSoon).length,
      neverAssessed: active.filter(p => !p.last_assessment_date).length,
      worsening: active.filter(p => p.wound_status === 'deteriorating').length,
      healed: enriched.filter(p => p.wound_status === 'healed').length,
      byType: WOUND_TYPES.reduce((acc, w) => ({ ...acc, [w.k]: active.filter(p => p.wound_type === w.k).length }), {}),
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filterStatus === 'active_only') list = list.filter(p => !['healed','referred_out','discontinued'].includes(p.wound_status));
    if (filterStatus === 'overdue')     list = list.filter(p => p.isOverdue);
    if (filterStatus === 'healed')      list = list.filter(p => p.wound_status === 'healed');
    if (filterType !== 'ALL')           list = list.filter(p => p.wound_type === filterType);
    if (filterRegion !== 'ALL')         list = list.filter(p => p.region === filterRegion);
    if (search) { const q = search.toLowerCase(); list = list.filter(p => `${p.patient_name} ${p.wound_location||''} ${p.assigned_swift_clinician||''}`.toLowerCase().includes(q)); }
    return [...list].sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (a.wound_status === 'deteriorating' && b.wound_status !== 'deteriorating') return -1;
      return (a.reviewDue ?? 999) - (b.reviewDue ?? 999);
    });
  }, [enriched, filterStatus, filterType, filterRegion, search]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="SWIFT Team" subtitle="Loading wound patients..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  // SWIFT access: super_admin and admin always have access; others need is_swift_team flag
  const hasSWIFTAccess = ['super_admin','admin','assoc_director'].includes(profile?.role) || profile?.is_swift_team === true || profile?.role === 'telehealth';
  if (!hasSWIFTAccess) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="SWIFT Team" subtitle="Access Restricted" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>SWIFT Team Access Required</div>
          <div style={{ fontSize: 13, color: 'var(--gray)' }}>The SWIFT Team dashboard is available to credentialed wound care members only. Contact your administrator to request access.</div>
        </div>
      </div>
    </div>
  );

  const selectedAssessments = selected ? (assessmentMap[selected.id] || []) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="🩹 SWIFT Team — Wound Care"
        subtitle={`${stats.total} active wound patients · ${stats.overdue} reviews overdue · ${stats.neverAssessed} never assessed`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border)', color: 'var(--black)', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>↻</button>
            <button onClick={() => setFlagModal(true)}
              style={{ padding: '6px 16px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              🩹 Flag Patient
            </button>
          </div>
        }
      />

      {/* Alert banners */}
      {stats.overdue > 0 && (
        <div style={{ background: '#FEF2F2', borderBottom: '2px solid #FECACA', padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>🚨</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>{stats.overdue} wound review{stats.overdue > 1 ? 's' : ''} overdue — assess today</span>
          <button onClick={() => setFilterStatus('overdue')} style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#DC2626', background: 'white', border: '1px solid #FECACA', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Show Overdue</button>
        </div>
      )}
      {stats.worsening > 0 && (
        <div style={{ background: '#F5F3FF', borderBottom: '1px solid #DDD6FE', padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>↓</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED' }}>{stats.worsening} patient{stats.worsening > 1 ? 's' : ''} with deteriorating wounds — physician notification may be required</span>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
        {/* Left: patient list */}
        <div style={{ width: selected ? '45%' : '100%', display: 'flex', flexDirection: 'column', borderRight: selected ? '1px solid var(--border)' : 'none', overflowY: 'auto' }}>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
              {[
                { label: 'Active Wounds', val: stats.total, color: '#DC2626', bg: '#FEF2F2' },
                { label: '🚨 Reviews Overdue', val: stats.overdue, color: '#DC2626', bg: '#FEF2F2' },
                { label: '⚠ Due in 3 Days', val: stats.dueSoon, color: '#D97706', bg: '#FEF3C7' },
                { label: '↓ Worsening', val: stats.worsening, color: '#7C3AED', bg: '#F5F3FF' },
                { label: '✅ Healed', val: stats.healed, color: '#059669', bg: '#ECFDF5' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 2 }}>{c.val}</div>
                </div>
              ))}
            </div>

            {/* Wound type distribution */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WOUND_TYPES.filter(w => stats.byType[w.k] > 0).map(w => (
                <div key={w.k} onClick={() => setFilterType(filterType === w.k ? 'ALL' : w.k)}
                  style={{ padding: '5px 10px', borderRadius: 7, background: filterType === w.k ? w.bg : 'var(--bg)', border: `2px solid ${filterType === w.k ? w.color : 'var(--border)'}`, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: filterType === w.k ? w.color : 'var(--gray)' }}>
                  {w.icon} {w.l} ({stats.byType[w.k]})
                </div>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                {[['active_only', 'Active'], ['overdue', '🚨 Overdue'], ['healed', '✅ Healed'], ['ALL', 'All']].map(([k, l]) => (
                  <button key={k} onClick={() => setFilterStatus(k)}
                    style={{ padding: '5px 10px', border: 'none', fontSize: 10, fontWeight: filterStatus === k ? 700 : 400, cursor: 'pointer', background: filterStatus === k ? '#7C3AED' : 'var(--card-bg)', color: filterStatus === k ? '#fff' : 'var(--gray)', borderRight: '1px solid var(--border)' }}>
                    {l}
                  </button>
                ))}
              </div>
              <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
                style={{ padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, outline: 'none', background: 'var(--card-bg)' }}>
                <option value="ALL">All Regions</option>
                {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
              </select>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient..."
                style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, outline: 'none', background: 'var(--card-bg)', width: 150 }} />
              <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--gray)' }}>{filtered.length} patients</div>
            </div>

            {/* Patient cards */}
            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>
                {stats.total === 0 ? (
                  <div>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🩹</div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>No wound patients flagged yet</div>
                    <div style={{ fontSize: 12 }}>Click "Flag Patient" to add a patient to the SWIFT Team list</div>
                  </div>
                ) : 'No patients match current filters.'}
              </div>
            ) : filtered.map(p => {
              const wt = woundTypeCfg(p.wound_type);
              const sc = statusCfg(p.wound_status);
              const isSelected = selected?.id === p.id;
              const urgentRow = p.isOverdue || p.wound_status === 'deteriorating';
              return (
                <div key={p.id} onClick={() => setSelected(isSelected ? null : p)}
                  style={{ background: isSelected ? wt.bg : urgentRow ? '#FFF5F5' : 'var(--card-bg)', border: `2px solid ${isSelected ? wt.color : urgentRow ? '#FECACA' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = wt.color; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = urgentRow ? '#FECACA' : 'var(--border)'; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{wt.icon} {p.patient_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1 }}>Rgn {p.region} · {p.insurance}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sc.color, background: sc.bg, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{sc.l}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, fontSize: 10 }}>
                    <div>
                      <div style={{ color: 'var(--gray)' }}>Type</div>
                      <div style={{ fontWeight: 600, color: wt.color }}>{wt.l}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray)' }}>Location</div>
                      <div style={{ fontWeight: 600 }}>{p.wound_location || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray)' }}>Next Review</div>
                      <div style={{ fontWeight: 700, color: p.isOverdue ? '#DC2626' : p.isDueSoon ? '#D97706' : 'var(--black)' }}>
                        {p.reviewDue === null ? '—' : p.reviewDue <= 0 ? '⚠ OVERDUE' : `${p.reviewDue}d`}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray)' }}>Clinician</div>
                      <div style={{ fontWeight: 600 }}>{p.assigned_swift_clinician || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray)' }}>Last Assessed</div>
                      <div style={{ fontWeight: 600, color: !p.last_assessment_date ? '#DC2626' : 'var(--black)' }}>
                        {p.lastAssessmentDays === null ? 'Never' : `${p.lastAssessmentDays}d ago`}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray)' }}>Assessments</div>
                      <div style={{ fontWeight: 600 }}>{p.assessmentCount}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: patient detail */}
        {selected && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <PatientDetail
              patient={selected}
              assessments={selectedAssessments}
              onAssess={() => setAssessModal(selected)}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>

      {flagModal && (
        <FlagPatientModal
          profileName={profile?.full_name || profile?.email}
          onClose={() => setFlagModal(false)}
          onSaved={() => { setFlagModal(false); load(); }}
        />
      )}
      {assessModal && (
        <AssessmentModal
          patient={assessModal}
          profileName={profile?.full_name || profile?.email}
          onClose={() => setAssessModal(null)}
          onSaved={() => { setAssessModal(null); load(); if (selected) setSelected(p => ({ ...p })); }}
        />
      )}
    </div>
  );
}
