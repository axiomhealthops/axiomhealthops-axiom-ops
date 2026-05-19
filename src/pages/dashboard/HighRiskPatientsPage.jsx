// HighRiskPatientsPage.jsx
//
// Clinical: surfaces all patients on the LIAM COPY high-risk reassessment
// list (186 seeded 2026-05-19). Provides:
//   - 6 KPI tiles (clickable as filters): LOC 4+5, wounds, 3+ comorbidities,
//     falls in 6 mo, high compliance risk, high environmental risk
//   - LOC distribution strip (1-5 + unknown)
//   - Filterable patient list with color-coded LOC pill, CareMap, risk flags
//   - XLSX export
//   - Per-row inline edit for CareMap / risk flags (admin+ only)
//
// Data source: patient_risk_factors table. LOC level is auto-computed from
// caremap_score by a BEFORE trigger; high_compliance_risk and
// high_environmental_risk are computed at seed time from the raw scores
// (compliance > 8, environmental > 12) — those flags can be re-derived
// during the monthly Excel re-upload.
//
// Region scoping is server-side via useAssignedRegions. Super_admin and
// admin currently see all regions.
//
// JSX unicode policy (per CLAUDE.md): no inline unicode characters in JSX
// text. Use plain ASCII or wrap in JS expressions.

import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

// LOC presentation — color-coded pill. Aligns with PDF spec:
//   LOC 1: 0-19    (low)
//   LOC 2: 20-39   (mild)
//   LOC 3: 40-69   (moderate)
//   LOC 4: 70-85   (high)
//   LOC 5: 86+     (critical)
const LOC_STYLES = {
  1: { label: 'LOC 1', range: '0-19',  color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0', tier: 'Low' },
  2: { label: 'LOC 2', range: '20-39', color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE', tier: 'Mild' },
  3: { label: 'LOC 3', range: '40-69', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A', tier: 'Moderate' },
  4: { label: 'LOC 4', range: '70-85', color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74', tier: 'High' },
  5: { label: 'LOC 5', range: '86+',   color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5', tier: 'Critical' },
  unknown: { label: 'No CM', range: 'unknown', color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', tier: 'No CareMap' },
};

function locStyle(loc) {
  if (loc === null || loc === undefined) return LOC_STYLES.unknown;
  return LOC_STYLES[loc] || LOC_STYLES.unknown;
}

function LocPill({ loc, showRange = false, small = false }) {
  const s = locStyle(loc);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: small ? 10 : 11, fontWeight: 700, color: s.color,
      background: s.bg, border: `1px solid ${s.border}`,
      padding: small ? '1px 6px' : '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      {s.label}
      {showRange && <span style={{ fontWeight: 500, opacity: 0.7 }}>{s.range}</span>}
    </span>
  );
}

// KPI tile — click to filter, click again to clear. Color-coded by severity.
function KpiTile({ label, value, sub, color, bg, active, onClick, count }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? color : bg,
        border: `1px solid ${active ? color : '#E5E7EB'}`,
        borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
        textAlign: 'left', display: 'flex', flexDirection: 'column',
        gap: 4, minHeight: 86,
        boxShadow: active ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
        transition: 'all 0.12s ease',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: active ? '#fff' : '#6B7280',
        }}>{label}</div>
        {count !== undefined && count !== value && (
          <div style={{ fontSize: 9, color: active ? '#fff' : '#9CA3AF', opacity: 0.8 }}>
            {count} total
          </div>
        )}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        color: active ? '#fff' : color, lineHeight: 1,
      }}>{value}</div>
      <div style={{ fontSize: 10, color: active ? '#fff' : '#6B7280', opacity: active ? 0.95 : 1 }}>{sub}</div>
    </button>
  );
}

// Flag chip — small color-coded badge for a risk factor.
function FlagChip({ on, label, color, title }) {
  if (!on) return <span style={{ fontSize: 11, color: '#D1D5DB' }}>-</span>;
  return (
    <span title={title || label} style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700,
      color: '#fff', background: color, padding: '2px 7px',
      borderRadius: 4, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function downloadXlsx(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HighRisk');
  XLSX.writeFile(wb, filename);
}

// Per-row inline edit drawer — admin+ updates a patient's CareMap & flags
// without leaving the page. Closes on save or cancel.
function EditDrawer({ row, onClose, onSaved, canEdit }) {
  const [form, setForm] = useState({
    caremap_score: row.caremap_score ?? '',
    has_wounds: !!row.has_wounds,
    comorbidities_3plus: !!row.comorbidities_3plus,
    falls_6mo: !!row.falls_6mo,
    compliance_score: row.compliance_score ?? '',
    environmental_score: row.environmental_score ?? '',
    comments: row.comments || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true); setErr('');
    const compScore = form.compliance_score === '' ? null : parseInt(form.compliance_score);
    const envScore  = form.environmental_score === '' ? null : parseInt(form.environmental_score);
    const cm        = form.caremap_score === '' ? null : parseInt(form.caremap_score);
    const payload = {
      caremap_score: cm,
      has_wounds: !!form.has_wounds,
      comorbidities_3plus: !!form.comorbidities_3plus,
      falls_6mo: !!form.falls_6mo,
      compliance_score: compScore,
      environmental_score: envScore,
      high_compliance_risk:    compScore !== null && compScore > 8,
      high_environmental_risk: envScore !== null && envScore > 12,
      comments: form.comments || null,
      last_reassessment_date: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('patient_risk_factors')
      .update(payload)
      .eq('id', row.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved();
    onClose();
  }

  function Field({ label, children, span = 1 }) {
    return (
      <div style={{ gridColumn: `span ${span}` }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>{label}</label>
        {children}
      </div>
    );
  }

  const inputStyle = { width: '100%', padding: '7px 9px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' };
  const checkRow = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1F2937', userSelect: 'none' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 560, maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0F1117' }}>{row.patient_name}</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              Region {row.region} {row.health_plan ? `${'·'} ${row.health_plan}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9CA3AF', cursor: 'pointer', lineHeight: 1, padding: 0 }}>{'×'}</button>
        </div>

        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="CareMap Score">
            <input type="number" value={form.caremap_score} onChange={e => set('caremap_score', e.target.value)}
              style={inputStyle} placeholder="e.g. 65" disabled={!canEdit} />
          </Field>
          <Field label="LOC (auto)">
            <div style={{ padding: '7px 9px' }}>
              {(() => {
                const v = form.caremap_score === '' ? null : parseInt(form.caremap_score);
                let loc = null;
                if (v !== null && !isNaN(v)) {
                  if (v < 20) loc = 1;
                  else if (v < 40) loc = 2;
                  else if (v < 70) loc = 3;
                  else if (v < 86) loc = 4;
                  else loc = 5;
                }
                return <LocPill loc={loc} showRange />;
              })()}
            </div>
          </Field>

          <Field label="Compliance Score">
            <input type="number" value={form.compliance_score} onChange={e => set('compliance_score', e.target.value)}
              style={inputStyle} placeholder="High risk if > 8" disabled={!canEdit} />
          </Field>
          <Field label="Environmental Score">
            <input type="number" value={form.environmental_score} onChange={e => set('environmental_score', e.target.value)}
              style={inputStyle} placeholder="High risk if > 12" disabled={!canEdit} />
          </Field>

          <Field label="Clinical Flags" span={2}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: '#F9FAFB', borderRadius: 6, border: '1px solid #E5E7EB' }}>
              <label style={checkRow}>
                <input type="checkbox" checked={form.has_wounds} onChange={e => set('has_wounds', e.target.checked)} disabled={!canEdit} />
                Wounds present (syncs to census)
              </label>
              <label style={checkRow}>
                <input type="checkbox" checked={form.comorbidities_3plus} onChange={e => set('comorbidities_3plus', e.target.checked)} disabled={!canEdit} />
                3 or more comorbidities
              </label>
              <label style={checkRow}>
                <input type="checkbox" checked={form.falls_6mo} onChange={e => set('falls_6mo', e.target.checked)} disabled={!canEdit} />
                Falls within last 6 months
              </label>
            </div>
          </Field>

          <Field label="Clinician Comments" span={2}>
            <textarea value={form.comments} onChange={e => set('comments', e.target.value)}
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="e.g. NO CM in chart since 3/26" disabled={!canEdit} />
          </Field>
        </div>

        {err && (
          <div style={{ margin: '0 20px 12px', padding: '8px 10px', background: '#FEF2F2', color: '#991B1B', fontSize: 12, borderRadius: 6, border: '1px solid #FECACA' }}>
            {err}
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end', gap: 8, background: '#FAFAFA' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: '1px solid #E5E7EB', background: '#fff', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            Cancel
          </button>
          {canEdit && (
            <button onClick={save} disabled={saving} style={{ padding: '8px 16px', border: 'none', background: saving ? '#9CA3AF' : '#0F1117', color: '#fff', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HighRiskPatientsPage({ onNavigate, intent }) {
  const { profile } = useAuth();
  const regionScope = useAssignedRegions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState(intent?.filter || null); // 'loc45' | 'wounds' | 'comorb' | 'falls' | 'compliance' | 'environmental' | null
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterPlan, setFilterPlan] = useState('ALL');
  const [filterLoc, setFilterLoc] = useState('ALL'); // ALL | 1 | 2 | 3 | 4 | 5 | unknown
  const [searchQ, setSearchQ] = useState('');
  const [sortKey, setSortKey] = useState('caremap_desc'); // caremap_desc | caremap_asc | name | region
  const [editRow, setEditRow] = useState(null);

  const canEdit = ['super_admin','ceo','director','admin','assoc_director'].includes(profile?.role);

  async function load() {
    setLoading(true);
    let q = supabase.from('patient_risk_factors').select('*');
    if (!regionScope.isAllAccess) {
      q = regionScope.applyToQuery(q);
    }
    const data = await fetchAllPages(q.order('caremap_score', { ascending: false, nullsFirst: false }));
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (regionScope.loading) return;
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useRealtimeTable(['patient_risk_factors'], load);

  // Distinct health plans for filter dropdown
  const healthPlans = useMemo(
    () => [...new Set(rows.map(r => r.health_plan).filter(Boolean))].sort(),
    [rows]
  );

  // Aggregate KPI counts (BEFORE filtering, so tiles show totals in scope).
  const kpis = useMemo(() => {
    const inScope = rows;
    return {
      total: inScope.length,
      loc45: inScope.filter(r => r.loc_level === 4 || r.loc_level === 5).length,
      wounds: inScope.filter(r => r.has_wounds).length,
      comorb: inScope.filter(r => r.comorbidities_3plus).length,
      falls: inScope.filter(r => r.falls_6mo).length,
      compliance: inScope.filter(r => r.high_compliance_risk).length,
      environmental: inScope.filter(r => r.high_environmental_risk).length,
      locDist: {
        1: inScope.filter(r => r.loc_level === 1).length,
        2: inScope.filter(r => r.loc_level === 2).length,
        3: inScope.filter(r => r.loc_level === 3).length,
        4: inScope.filter(r => r.loc_level === 4).length,
        5: inScope.filter(r => r.loc_level === 5).length,
        unknown: inScope.filter(r => r.loc_level === null || r.loc_level === undefined).length,
      },
    };
  }, [rows]);

  // Filtered list — applies KPI filter, region, plan, LOC, search.
  const filtered = useMemo(() => {
    let out = rows;
    if (activeFilter === 'loc45')         out = out.filter(r => r.loc_level === 4 || r.loc_level === 5);
    if (activeFilter === 'wounds')        out = out.filter(r => r.has_wounds);
    if (activeFilter === 'comorb')        out = out.filter(r => r.comorbidities_3plus);
    if (activeFilter === 'falls')         out = out.filter(r => r.falls_6mo);
    if (activeFilter === 'compliance')    out = out.filter(r => r.high_compliance_risk);
    if (activeFilter === 'environmental') out = out.filter(r => r.high_environmental_risk);
    if (filterRegion !== 'ALL') out = out.filter(r => r.region === filterRegion);
    if (filterPlan !== 'ALL')   out = out.filter(r => r.health_plan === filterPlan);
    if (filterLoc !== 'ALL') {
      if (filterLoc === 'unknown') out = out.filter(r => r.loc_level === null || r.loc_level === undefined);
      else out = out.filter(r => r.loc_level === parseInt(filterLoc));
    }
    if (searchQ) {
      const q = searchQ.toLowerCase();
      out = out.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.comments || '').toLowerCase().includes(q)
      );
    }
    // Sort
    out = [...out];
    if (sortKey === 'caremap_desc') {
      out.sort((a, b) => (b.caremap_score ?? -1) - (a.caremap_score ?? -1));
    } else if (sortKey === 'caremap_asc') {
      out.sort((a, b) => (a.caremap_score ?? 9999) - (b.caremap_score ?? 9999));
    } else if (sortKey === 'name') {
      out.sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''));
    } else if (sortKey === 'region') {
      out.sort((a, b) => (a.region || '').localeCompare(b.region || '') || (b.caremap_score ?? -1) - (a.caremap_score ?? -1));
    }
    return out;
  }, [rows, activeFilter, filterRegion, filterPlan, filterLoc, searchQ, sortKey]);

  function toggleFilter(key) {
    setActiveFilter(prev => prev === key ? null : key);
  }

  function clearAll() {
    setActiveFilter(null);
    setFilterRegion('ALL');
    setFilterPlan('ALL');
    setFilterLoc('ALL');
    setSearchQ('');
  }

  function exportXlsx() {
    const data = filtered.map(r => ({
      Patient: r.patient_name,
      Region: r.region,
      'Health Plan': r.health_plan || '',
      'CareMap Score': r.caremap_score ?? '',
      LOC: r.loc_level ?? '',
      'LOC Tier': locStyle(r.loc_level).tier,
      Wounds: r.has_wounds ? 'Yes' : 'No',
      '3+ Comorbidities': r.comorbidities_3plus ? 'Yes' : 'No',
      'Falls (6mo)': r.falls_6mo ? 'Yes' : 'No',
      'Compliance Score': r.compliance_score ?? '',
      'High Compliance Risk': r.high_compliance_risk ? 'Yes' : 'No',
      'Environmental Score': r.environmental_score ?? '',
      'High Environmental Risk': r.high_environmental_risk ? 'Yes' : 'No',
      'Last Reassessment': r.last_reassessment_date || '',
      Comments: r.comments || '',
    }));
    downloadXlsx(data, `high-risk-patients-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  if (loading || regionScope.loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="High Risk Patients" subtitle="Loading..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
          Loading risk profile...
        </div>
      </div>
    );
  }

  const subtitle = `${kpis.total} patients on watchlist ${'·'} ${kpis.loc45} high-risk (LOC 4+5) ${'·'} ${filtered.length} shown`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="High Risk Patients" subtitle={subtitle} />

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* KPI tiles — clickable filters */}
        <div style={{ padding: '16px 20px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <KpiTile
            label="High Risk (LOC 4+5)"
            value={kpis.loc45}
            sub="CareMap 70+"
            color="#9A3412" bg="#FFEDD5"
            active={activeFilter === 'loc45'}
            onClick={() => toggleFilter('loc45')}
          />
          <KpiTile
            label="Wounds Present"
            value={kpis.wounds}
            sub="Syncs to census"
            color="#7F1D1D" bg="#FEE2E2"
            active={activeFilter === 'wounds'}
            onClick={() => toggleFilter('wounds')}
          />
          <KpiTile
            label="3+ Comorbidities"
            value={kpis.comorb}
            sub="Complex care"
            color="#9F1239" bg="#FFE4E6"
            active={activeFilter === 'comorb'}
            onClick={() => toggleFilter('comorb')}
          />
          <KpiTile
            label="Falls in 6 Months"
            value={kpis.falls}
            sub="Mobility / safety"
            color="#92400E" bg="#FEF3C7"
            active={activeFilter === 'falls'}
            onClick={() => toggleFilter('falls')}
          />
          <KpiTile
            label="High Compliance Risk"
            value={kpis.compliance}
            sub="Score > 8"
            color="#1E40AF" bg="#DBEAFE"
            active={activeFilter === 'compliance'}
            onClick={() => toggleFilter('compliance')}
          />
          <KpiTile
            label="High Environmental Risk"
            value={kpis.environmental}
            sub="Score > 12"
            color="#5B21B6" bg="#EDE9FE"
            active={activeFilter === 'environmental'}
            onClick={() => toggleFilter('environmental')}
          />
        </div>

        {/* LOC distribution strip */}
        <div style={{ padding: '0 20px 12px' }}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Level of Care Distribution
              </div>
              <button onClick={clearAll} style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                Clear all filters
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5, 'unknown'].map(k => {
                const s = locStyle(k === 'unknown' ? null : k);
                const count = kpis.locDist[k];
                const isActive = (filterLoc === String(k)) || (k === 'unknown' && filterLoc === 'unknown');
                return (
                  <button key={k} onClick={() => setFilterLoc(isActive ? 'ALL' : String(k))}
                    style={{
                      flex: '1 1 130px', minWidth: 130,
                      background: isActive ? s.color : s.bg,
                      border: `1px solid ${isActive ? s.color : s.border}`,
                      borderRadius: 8, padding: '8px 10px',
                      cursor: 'pointer', textAlign: 'left',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#fff' : s.color }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: 9, color: isActive ? '#fff' : '#6B7280', opacity: 0.8 }}>
                        {s.range}
                      </div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: isActive ? '#fff' : s.color, marginTop: 2 }}>
                      {count}
                    </div>
                    <div style={{ fontSize: 10, color: isActive ? '#fff' : '#6B7280', opacity: 0.9 }}>{s.tier}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Filter controls */}
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search patient name or comments..."
            style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff', width: 260 }} />
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff' }}>
            <option value="ALL">All Health Plans</option>
            {healthPlans.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={sortKey} onChange={e => setSortKey(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff' }}>
            <option value="caremap_desc">Sort: CareMap (high to low)</option>
            <option value="caremap_asc">Sort: CareMap (low to high)</option>
            <option value="name">Sort: Patient name</option>
            <option value="region">Sort: Region, then CareMap</option>
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={exportXlsx}
              style={{ padding: '7px 14px', border: '1px solid #E5E7EB', background: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#1F2937' }}>
              Export XLSX
            </button>
          </div>
        </div>

        {/* Patient table */}
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.8fr) 60px 90px 80px 60px 320px 1fr', gap: 0,
              background: '#F9FAFB', padding: '10px 14px',
              fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em',
              borderBottom: '1px solid #E5E7EB' }}>
              <div>Patient</div>
              <div>Region</div>
              <div>Health Plan</div>
              <div>CareMap</div>
              <div>LOC</div>
              <div>Risk Flags</div>
              <div>Comments</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
                No patients match the current filters.
              </div>
            )}
            {filtered.map((r, idx) => (
              <div key={r.id || idx}
                   onClick={() => setEditRow(r)}
                   style={{
                     display: 'grid',
                     gridTemplateColumns: 'minmax(180px, 1.8fr) 60px 90px 80px 60px 320px 1fr',
                     gap: 0,
                     padding: '10px 14px',
                     fontSize: 12, color: '#1F2937',
                     borderBottom: idx < filtered.length - 1 ? '1px solid #F3F4F6' : 'none',
                     cursor: 'pointer',
                     background: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                   }}
                   onMouseEnter={e => e.currentTarget.style.background = '#F3F4F6'}
                   onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#FAFAFA'}>
                <div style={{ fontWeight: 600 }}>{r.patient_name}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{r.region}</div>
                <div style={{ color: '#6B7280', fontSize: 11 }}>{r.health_plan || ''}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: r.caremap_score >= 86 ? '#7F1D1D' : r.caremap_score >= 70 ? '#9A3412' : '#1F2937' }}>
                  {r.caremap_score ?? '-'}
                </div>
                <div><LocPill loc={r.loc_level} small /></div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <FlagChip on={r.has_wounds} label="WND" color="#7F1D1D" title="Wounds present" />
                  <FlagChip on={r.comorbidities_3plus} label="3+ CMB" color="#9F1239" title="3+ comorbidities" />
                  <FlagChip on={r.falls_6mo} label="FALL" color="#92400E" title="Falls in 6mo" />
                  <FlagChip on={r.high_compliance_risk} label="CMP" color="#1E40AF" title="High compliance risk" />
                  <FlagChip on={r.high_environmental_risk} label="ENV" color="#5B21B6" title="High environmental risk" />
                </div>
                <div style={{ color: '#6B7280', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                     title={r.comments || ''}>
                  {r.comments || ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editRow && (
        <EditDrawer row={editRow} onClose={() => setEditRow(null)} onSaved={load} canEdit={canEdit} />
      )}
    </div>
  );
}

// Export the LocPill so other pages (Census, Coordinator Portal, etc.) can
// reuse the same visual treatment for risk badges in Phase 4.
export { LocPill, locStyle };
