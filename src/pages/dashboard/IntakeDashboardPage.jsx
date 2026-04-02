import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
 
// ── helpers ──────────────────────────────────────────────────────────
function sd(v) {
  if (!v) return null;
  if (v instanceof Date) { try { return v.toISOString().split('T')[0]; } catch { return null; } }
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function ss(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || ['none','nan','null','n/a','na'].includes(s.toLowerCase())) return null;
  if (s.startsWith('=') || s.includes('__xludf')) return null;
  return s.slice(0, max);
}
function normDiag(d) {
  if (!d) return null;
  const s = d.trim();
  if (/I89\.?0?\s*(LYMPHEDEMA|Lymphedema)/i.test(s)) return 'I89.0 Lymphedema';
  return s.slice(0, 150);
}
function normDenial(d) {
  if (!d) return null;
  const s = d.trim();
  if (/^N\/A\s*-\s*Accepted/i.test(s) || /^NA\s*-/i.test(s)) return null;
  return s.slice(0, 200);
}
function monthKey(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7); // "YYYY-MM"
}
function fmtMonth(key) {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}
 
// ── XLSX parser ───────────────────────────────────────────────────────
function parseIntakeXLSX(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: false });
  const ws = wb.Sheets['Form Responses 1'] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Sheet not found');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[2]) continue;
    const status = ss(r[2]);
    if (!status) continue;
    const locRaw = ss(r[8]);
    const zipMatch = locRaw && locRaw.match(/^(\d{5})/);
    const cityMatch = locRaw && locRaw.match(/^\d{5}\s*[:;]\s*(.*)/);
    out.push({
      date_received: sd(r[1]),
      referral_status: status,
      referral_type: ss(r[3]),
      region: ss(r[4]),
      patient_name: ss(r[5]),
      dob: sd(r[6]),
      contact_number: ss(r[7]),
      phone: ss(r[7]),
      location: locRaw,
      zip_code: zipMatch ? zipMatch[1] : null,
      city: cityMatch ? cityMatch[1].trim() : null,
      insurance: ss(r[9]),
      policy_number: ss(r[10]),
      denial_reason: normDenial(ss(r[11])),
      diagnosis: normDiag(ss(r[12])),
      referral_document: ss(r[13]),
      pcp_name: ss(r[14]),
      pcp_phone: ss(r[15]),
      pcp_fax: ss(r[16]),
      referral_source: ss(r[17], 200),
      referral_source_phone: ss(r[18]),
      referral_source_fax: ss(r[19]),
      chart_status: ss(r[20]),
      welcome_call: ss(r[21]),
      first_appt: ss(r[22]),
      county: ss(r[23]),
      total_visits: r[24] != null ? String(r[24]) : null,
      census_status: ss(r[25]),
      medicare_type: ss(r[26]),
      secondary_insurance: ss(r[27]),
      secondary_id: ss(r[28]),
    });
  }
  return out;
}
 
// ── small reusable chart bars ─────────────────────────────────────────
function HBar({ label, value, max, color, subLabel }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: 'var(--black)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color }}>{value.toLocaleString()}{subLabel ? ` (${subLabel})` : ''}</span>
      </div>
      <div style={{ height: 7, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 999, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}
 
// ── Import panel ──────────────────────────────────────────────────────
function ImportPanel({ onImportDone }) {
  const [status, setStatus] = useState('idle');
  const [msg, setMsg] = useState('');
  const ref = useRef();
 
  async function handleFile(file) {
    if (!file) return;
    setStatus('loading'); setMsg('Parsing file…');
    const reader = new FileReader();
    reader.onerror = () => { setStatus('error'); setMsg('File read failed'); };
    reader.onload = async (e) => {
      try {
        const rows = parseIntakeXLSX(e.target.result);
        setMsg(`Parsed ${rows.length} rows. Clearing old data…`);
        // Delete in batches to ensure full clear regardless of RLS
        let keepDeleting = true;
        while (keepDeleting) {
          const { data: toDelete } = await supabase.from('intake_referrals').select('id').limit(500);
          if (!toDelete || toDelete.length === 0) { keepDeleting = false; break; }
          const ids = toDelete.map(r => r.id);
          await supabase.from('intake_referrals').delete().in('id', ids);
          if (toDelete.length < 500) keepDeleting = false;
        }
        let inserted = 0;
        const CHUNK = 200;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const { error } = await supabase.from('intake_referrals').insert(chunk);
          if (error) throw new Error(error.message);
          inserted += chunk.length;
          setMsg(`Uploading… ${inserted}/${rows.length}`);
        }
        setStatus('success'); setMsg(`${rows.length.toLocaleString()} referrals imported successfully`);
        onImportDone();
      } catch (err) {
        setStatus('error'); setMsg('Error: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }
 
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>Import Monthly Intake Report</div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>Upload MONTHLY_INTAKE_REPORT.xlsx to load all referrals. Previous data will be replaced.</div>
        </div>
        {status === 'loading' && <div style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 500 }}>{msg}</div>}
        {status === 'success' && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>&#10003; {msg}</div>}
        {status === 'error' && <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 500 }}>{msg}</div>}
        <label style={{ padding: '7px 14px', background: status === 'loading' ? 'var(--gray)' : 'var(--red)', color: '#fff', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: status === 'loading' ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
          {status === 'loading' ? 'Importing…' : '↑ Upload XLSX'}
          <input ref={ref} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={status === 'loading'}
            onChange={e => handleFile(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
 
// ── Main page ─────────────────────────────────────────────────────────
export default function IntakeDashboardPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [insuranceFilter, setInsuranceFilter] = useState('ALL');
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState('overview');
  const [showImport, setShowImport] = useState(false);
  const [sortField, setSortField] = useState('date_desc');  // date_desc | date_asc | name_asc | status
 
  async function fetchRecords() {
    setLoading(true);
    const { data } = await supabase.from('intake_referrals')
      .select('id,date_received,referral_status,referral_type,region,patient_name,insurance,denial_reason,diagnosis,chart_status')
      .order('date_received', { ascending: false })
      .limit(6000);
    setRecords(data || []);
    setLoading(false);
  }
 
  useEffect(() => { fetchRecords(); }, []);
 
  // ── computed stats ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = records.length;
    const accepted = records.filter(r => r.referral_status === 'Accepted').length;
    const denied = records.filter(r => r.referral_status === 'Denied').length;
    const acceptRate = total > 0 ? Math.round((accepted / total) * 100) : 0;
 
    // Monthly trend
    const monthMap = {};
    records.forEach(r => {
      const k = monthKey(r.date_received);
      if (!k) return;
      if (!monthMap[k]) monthMap[k] = { accepted: 0, denied: 0 };
      if (r.referral_status === 'Accepted') monthMap[k].accepted++;
      else monthMap[k].denied++;
    });
    const months = Object.keys(monthMap).sort().slice(-14).map(k => ({ key: k, label: fmtMonth(k), ...monthMap[k], total: monthMap[k].accepted + monthMap[k].denied }));
 
    // By region
    const regionMap = {};
    records.forEach(r => {
      if (!r.region) return;
      if (!regionMap[r.region]) regionMap[r.region] = { accepted: 0, denied: 0 };
      if (r.referral_status === 'Accepted') regionMap[r.region].accepted++;
      else regionMap[r.region].denied++;
    });
    const byRegion = Object.entries(regionMap)
      .map(([r, v]) => ({ region: r, ...v, total: v.accepted + v.denied }))
      .sort((a, b) => b.total - a.total);
 
    // By insurance
    const insMap = {};
    records.forEach(r => {
      const k = r.insurance || 'Unknown';
      if (!insMap[k]) insMap[k] = { accepted: 0, denied: 0 };
      if (r.referral_status === 'Accepted') insMap[k].accepted++;
      else insMap[k].denied++;
    });
    const byInsurance = Object.entries(insMap)
      .map(([ins, v]) => ({ ins, ...v, total: v.accepted + v.denied }))
      .sort((a, b) => b.total - a.total).slice(0, 12);
 
    // By diagnosis (top 15)
    const diagMap = {};
    records.forEach(r => {
      const k = r.diagnosis || 'Not specified';
      if (!diagMap[k]) diagMap[k] = { accepted: 0, denied: 0 };
      if (r.referral_status === 'Accepted') diagMap[k].accepted++;
      else diagMap[k].denied++;
    });
    const byDiagnosis = Object.entries(diagMap)
      .map(([diag, v]) => ({ diag, ...v, total: v.accepted + v.denied }))
      .sort((a, b) => b.total - a.total).slice(0, 15);
 
    // Denial reasons (top 10)
    const denialMap = {};
    records.filter(r => r.referral_status === 'Denied' && r.denial_reason).forEach(r => {
      const k = r.denial_reason;
      denialMap[k] = (denialMap[k] || 0) + 1;
    });
    const denialReasons = Object.entries(denialMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count).slice(0, 8);
 
    // Referral types
    const typeMap = {};
    records.forEach(r => {
      const k = r.referral_type || 'Unknown';
      typeMap[k] = (typeMap[k] || 0) + 1;
    });
 
    // Chart status
    const csMap = {};
    records.filter(r => r.referral_status === 'Accepted').forEach(r => {
      const k = r.chart_status || 'Unknown';
      csMap[k] = (csMap[k] || 0) + 1;
    });
    const chartStatuses = Object.entries(csMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
 
    // This month
    const thisMonth = new Date().toISOString().slice(0, 7);
    const thisMonthRecs = records.filter(r => monthKey(r.date_received) === thisMonth);
 
    return { total, accepted, denied, acceptRate, months, byRegion, byInsurance, byDiagnosis, denialReasons, typeMap, chartStatuses, thisMonthRecs };
  }, [records]);
 
  // ── filtered table ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = records;
    if (statusFilter !== 'ALL') list = list.filter(r => r.referral_status === statusFilter);
    if (regionFilter !== 'ALL') list = list.filter(r => r.region === regionFilter);
    if (insuranceFilter !== 'ALL') list = list.filter(r => r.insurance === insuranceFilter);
    if (typeFilter !== 'ALL') list = list.filter(r => r.referral_type === typeFilter);
    if (monthFilter !== 'ALL') list = list.filter(r => monthKey(r.date_received) === monthFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.diagnosis || '').toLowerCase().includes(q) ||
        (r.insurance || '').toLowerCase().includes(q) ||
        (r.referral_source || '').toLowerCase().includes(q) ||
        (r.denial_reason || '').toLowerCase().includes(q) ||
        (r.chart_status || '').toLowerCase().includes(q) ||
        (r.region || '').toLowerCase().includes(q) ||
        (r.referral_type || '').toLowerCase().includes(q) ||
        (r.pcp_name || '').toLowerCase().includes(q) ||
        (r.city || '').toLowerCase().includes(q)
      );
    }
    // Sort
    list = [...list].sort((a, b) => {
      if (sortField === 'date_desc') return (b.date_received || '').localeCompare(a.date_received || '');
      if (sortField === 'date_asc')  return (a.date_received || '').localeCompare(b.date_received || '');
      if (sortField === 'name_asc')  return (a.patient_name || '').localeCompare(b.patient_name || '');
      if (sortField === 'status')    return (a.referral_status || '').localeCompare(b.referral_status || '');
      if (sortField === 'region')    return (a.region || '').localeCompare(b.region || '');
      if (sortField === 'insurance') return (a.insurance || '').localeCompare(b.insurance || '');
      return 0;
    });
    return list;
  }, [records, statusFilter, regionFilter, insuranceFilter, typeFilter, monthFilter, search, sortField]);
 
  const uniqueRegions = [...new Set(records.map(r => r.region).filter(Boolean))].sort();
  const uniqueInsurances = [...new Set(records.map(r => r.insurance).filter(Boolean))].sort();
  const uniqueMonths = [...new Set(records.map(r => monthKey(r.date_received)).filter(Boolean))].sort().reverse().slice(0, 18);
  const uniqueTypes = [...new Set(records.map(r => r.referral_type).filter(Boolean))].sort();
 
  const SEL = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' };
  const maxMonthTotal = stats.months.length > 0 ? Math.max(...stats.months.map(m => m.total)) : 1;
 
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'regions',  label: 'By Region' },
    { key: 'diagnoses', label: 'Diagnoses' },
    { key: 'denials',  label: 'Denial Analysis' },
    { key: 'patients', label: 'Patient Table' },
  ];
 
  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Intake Dashboard" subtitle="Loading referral data…" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading…</div>
    </div>
  );
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Intake Dashboard"
        subtitle={stats.total.toLocaleString() + ' referrals \u00b7 ' + stats.acceptRate + '% accept rate'}
        actions={
          <button onClick={() => setShowImport(v => !v)}
            style={{ padding: '7px 14px', background: showImport ? 'var(--border)' : 'var(--red)', color: showImport ? 'var(--black)' : '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {showImport ? 'Close Import' : '↑ Import XLSX'}
          </button>
        }
      />
 
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Import panel */}
        {showImport && (
          <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
            <ImportPanel onImportDone={() => { fetchRecords(); setShowImport(false); }} />
          </div>
        )}
 
        {/* KPI strip */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
          {[
            { label: 'Total Referrals',    val: stats.total.toLocaleString(),    color: 'var(--black)',  sub: 'all time' },
            { label: 'Accepted',           val: stats.accepted.toLocaleString(), color: 'var(--green)',  sub: stats.acceptRate + '% accept rate' },
            { label: 'Denied',             val: stats.denied.toLocaleString(),   color: '#DC2626',       sub: (100 - stats.acceptRate) + '% deny rate', alert: true },
            { label: 'This Month',         val: stats.thisMonthRecs.length,      color: '#1565C0',       sub: stats.thisMonthRecs.filter(r => r.referral_status === 'Accepted').length + ' accepted' },
            { label: 'Lymphedema Dx',      val: records.filter(r => r.diagnosis === 'I89.0 Lymphedema').length, color: '#7C3AED', sub: 'primary diagnosis' },
            { label: 'Non-Lymphedema Denied', val: records.filter(r => r.denial_reason === 'In network but Non-lymphedema').length, color: '#92400E', sub: 'top denial reason', alert: true },
          ].map(tile => (
            <div key={tile.label} style={{ flex: 1, padding: '10px 14px', borderRight: '1px solid var(--border)', textAlign: 'center', background: tile.alert ? '#FFFBF5' : 'transparent' }}>
              <div style={{ fontSize: 9, color: 'var(--gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tile.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: tile.color, marginTop: 2 }}>{tile.val}</div>
              <div style={{ fontSize: 10, color: tile.alert ? tile.color : 'var(--gray)', marginTop: 1, fontWeight: tile.alert ? 600 : 400 }}>{tile.sub}</div>
            </div>
          ))}
        </div>
 
        {/* Tabs + global search */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 12 }}>
          <div style={{ display: 'flex', gap: 2, flex: 1, paddingTop: 10 }}>
            {TABS.map(tab => {
              const active = activeTab === tab.key;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  style={{ padding: '7px 16px', border: 'none', borderRadius: '6px 6px 0 0', fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer', background: active ? 'var(--card-bg)' : 'transparent', color: active ? 'var(--red)' : 'var(--gray)', borderBottom: active ? '2px solid var(--red)' : '2px solid transparent' }}>
                  {tab.label}
                </button>
              );
            })}
          </div>
          <input
            placeholder="Search patient, diagnosis, insurance, PCP…"
            value={search}
            onChange={e => { setSearch(e.target.value); if (activeTab !== 'patients') setActiveTab('patients'); }}
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', width: 280, marginBottom: 4 }}
          />
        </div>
 
        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
 
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Monthly trend */}
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Monthly Referral Volume (Last 14 Months)</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
                  {stats.months.map(m => {
                    const aH = maxMonthTotal > 0 ? (m.accepted / maxMonthTotal) * 110 : 0;
                    const dH = maxMonthTotal > 0 ? (m.denied / maxMonthTotal) * 110 : 0;
                    return (
                      <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 110 }}>
                          <div title={`Accepted: ${m.accepted}`} style={{ width: '45%', height: aH, background: '#10B981', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                          <div title={`Denied: ${m.denied}`} style={{ width: '45%', height: dH, background: '#DC2626', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--gray)', textAlign: 'center' }}>{m.label}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--black)' }}>{m.total}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <div style={{ width: 10, height: 10, background: '#10B981', borderRadius: 2 }} /> Accepted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <div style={{ width: 10, height: 10, background: '#DC2626', borderRadius: 2 }} /> Denied
                  </div>
                </div>
              </div>
 
              {/* Insurance breakdown */}
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Referrals by Insurance (Top 12)</div>
                {stats.byInsurance.map(ins => (
                  <HBar key={ins.ins} label={ins.ins} value={ins.total}
                    max={stats.byInsurance[0]?.total || 1}
                    color='#1565C0'
                    subLabel={`${ins.accepted}A / ${ins.denied}D`} />
                ))}
              </div>
 
              {/* Referral types + chart status */}
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Referral Types</div>
                {Object.entries(stats.typeMap).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <HBar key={type} label={type} value={count}
                    max={Math.max(...Object.values(stats.typeMap))} color='#7C3AED' />
                ))}
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginTop: 20, marginBottom: 12 }}>Accepted Chart Statuses</div>
                {stats.chartStatuses.map(([cs, count]) => (
                  <HBar key={cs} label={cs} value={count}
                    max={stats.chartStatuses[0]?.[1] || 1} color='#10B981' />
                ))}
              </div>
            </div>
          )}
 
          {/* REGIONS TAB */}
          {activeTab === 'regions' && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '0.6fr 1fr 1fr 1fr 1fr 0.8fr', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span>Region</span><span>Total</span><span>Accepted</span><span>Denied</span><span>Accept Rate</span><span>Volume</span>
              </div>
              {stats.byRegion.map((r, i) => {
                const rate = r.total > 0 ? Math.round((r.accepted / r.total) * 100) : 0;
                const maxTotal = stats.byRegion[0]?.total || 1;
                return (
                  <div key={r.region} style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', display: 'grid', gridTemplateColumns: '0.6fr 1fr 1fr 1fr 1fr 0.8fr', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--black)' }}>Rgn {r.region}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 15 }}>{r.total}</span>
                    <span style={{ color: '#065F46', fontWeight: 600 }}>{r.accepted}</span>
                    <span style={{ color: '#DC2626', fontWeight: 600 }}>{r.denied}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: rate >= 50 ? '#065F46' : '#DC2626' }}>{rate}%</div>
                      <div style={{ height: 5, background: 'var(--border)', borderRadius: 999, marginTop: 3, width: 80 }}>
                        <div style={{ height: '100%', width: rate + '%', background: rate >= 50 ? '#10B981' : '#DC2626', borderRadius: 999 }} />
                      </div>
                    </div>
                    <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, width: 100 }}>
                      <div style={{ height: '100%', width: (r.total / maxTotal * 100) + '%', background: '#1565C0', borderRadius: 999 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
 
          {/* DIAGNOSES TAB */}
          {activeTab === 'diagnoses' && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '3fr 0.8fr 0.8fr 0.8fr 1fr', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span>Diagnosis</span><span>Total</span><span>Accepted</span><span>Denied</span><span>Accept Rate</span>
              </div>
              {stats.byDiagnosis.map((d, i) => {
                const rate = d.total > 0 ? Math.round((d.accepted / d.total) * 100) : 0;
                return (
                  <div key={d.diag} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', display: 'grid', gridTemplateColumns: '3fr 0.8fr 0.8fr 0.8fr 1fr', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--black)' }}>{d.diag}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{d.total}</span>
                    <span style={{ color: '#065F46', fontWeight: 600 }}>{d.accepted}</span>
                    <span style={{ color: '#DC2626', fontWeight: 600 }}>{d.denied}</span>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: rate >= 50 ? '#065F46' : '#DC2626' }}>{rate}%</span>
                      <div style={{ height: 4, background: 'var(--border)', borderRadius: 999, marginTop: 3, width: 80 }}>
                        <div style={{ height: '100%', width: rate + '%', background: rate >= 50 ? '#10B981' : '#DC2626', borderRadius: 999 }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
 
          {/* DENIAL ANALYSIS TAB */}
          {activeTab === 'denials' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Top Denial Reasons</div>
                {stats.denialReasons.map(d => (
                  <HBar key={d.reason} label={d.reason} value={d.count}
                    max={stats.denialReasons[0]?.count || 1} color='#DC2626' />
                ))}
              </div>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Denied Referrals by Region</div>
                {stats.byRegion.slice(0, 10).map(r => (
                  <HBar key={r.region} label={'Region ' + r.region} value={r.denied}
                    max={Math.max(...stats.byRegion.map(x => x.denied)) || 1} color='#DC2626' />
                ))}
              </div>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Denied by Insurance (Top 10)</div>
                {stats.byInsurance.slice(0, 10).map(ins => (
                  <HBar key={ins.ins} label={ins.ins} value={ins.denied}
                    max={Math.max(...stats.byInsurance.map(x => x.denied)) || 1} color='#F59E0B' />
                ))}
              </div>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 8 }}>Denial Summary</div>
                {[
                  { label: 'Non-lymphedema (in-network)', count: records.filter(r => r.denial_reason === 'In network but Non-lymphedema').length, color: '#DC2626' },
                  { label: 'Wrong insurance (non-lymphedema)', count: records.filter(r => r.denial_reason === 'Non-lymphedema and we don\'t accept patient insurance').length, color: '#F59E0B' },
                  { label: 'Lymphedema but wrong insurance', count: records.filter(r => r.denial_reason === 'Lymphedema but we don\'t accept patient insurance').length, color: '#7C3AED' },
                  { label: 'Other reasons', count: records.filter(r => r.referral_status === 'Denied' && r.denial_reason && !['In network but Non-lymphedema','Non-lymphedema and we don\'t accept patient insurance','Lymphedema but we don\'t accept patient insurance'].includes(r.denial_reason)).length, color: '#6B7280' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, color: 'var(--black)' }}>{item.label}</div>
                    <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: item.color }}>{item.count}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12, padding: 12, background: '#FEF3C7', borderRadius: 8, fontSize: 12, color: '#92400E', fontWeight: 500 }}>
                  <strong>{Math.round((records.filter(r => r.denial_reason === 'Lymphedema but we don\'t accept patient insurance').length / Math.max(stats.denied, 1)) * 100)}%</strong> of denials are lymphedema patients with out-of-network insurance — these are potential patients lost.
                </div>
              </div>
            </div>
          )}
 
          {/* PATIENT TABLE TAB */}
          {activeTab === 'patients' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={SEL}>
                  <option value="ALL">All Statuses</option>
                  <option value="Accepted">Accepted</option>
                  <option value="Denied">Denied</option>
                </select>
                <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={SEL}>
                  <option value="ALL">All Regions</option>
                  {uniqueRegions.map(r => <option key={r} value={r}>Region {r}</option>)}
                </select>
                <select value={insuranceFilter} onChange={e => setInsuranceFilter(e.target.value)} style={SEL}>
                  <option value="ALL">All Insurance</option>
                  {uniqueInsurances.map(ins => <option key={ins} value={ins}>{ins}</option>)}
                </select>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={SEL}>
                  <option value="ALL">All Types</option>
                  {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={SEL}>
                  <option value="ALL">All Months</option>
                  {uniqueMonths.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
                </select>
                <select value={sortField} onChange={e => setSortField(e.target.value)} style={SEL}>
                  <option value="date_desc">Sort: Newest First</option>
                  <option value="date_asc">Sort: Oldest First</option>
                  <option value="name_asc">Sort: Patient A–Z</option>
                  <option value="status">Sort: Status</option>
                  <option value="region">Sort: Region</option>
                  <option value="insurance">Sort: Insurance</option>
                </select>
                <span style={{ fontSize: 12, color: 'var(--gray)', marginLeft: 'auto' }}>{filtered.length.toLocaleString()} records</span>
              </div>
 
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 2.2fr 0.5fr 0.9fr 1.5fr 1.5fr 0.8fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <span>Date</span><span>Patient</span><span>Rgn</span><span>Type</span><span>Insurance</span><span>Diagnosis</span><span>Status</span>
                </div>
                {filtered.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>No records match your filters.</div>
                )}
                {filtered.slice(0, 300).map((r, i) => {
                  const isAccepted = r.referral_status === 'Accepted';
                  return (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '0.8fr 2.2fr 0.5fr 0.9fr 1.5fr 1.5fr 0.8fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--gray)', fontFamily: 'DM Mono, monospace' }}>{r.date_received ? r.date_received.slice(0, 10) : '—'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)' }}>{r.patient_name || '—'}</div>
                        {r.denial_reason && !isAccepted && <div style={{ fontSize: 10, color: '#DC2626', marginTop: 1 }}>{r.denial_reason.slice(0, 60)}</div>}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>{r.region || '—'}</span>
                      <span style={{ fontSize: 10, color: 'var(--gray)' }}>{(r.referral_type || '').replace(' Referral','').replace('Existing Patient','Existing') || '—'}</span>
                      <span style={{ fontSize: 11, color: 'var(--black)' }}>{r.insurance || '—'}</span>
                      <span style={{ fontSize: 11, color: 'var(--black)' }}>{(r.diagnosis || '—').slice(0, 50)}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isAccepted ? '#065F46' : '#DC2626', background: isAccepted ? '#ECFDF5' : '#FEF2F2', padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                        {isAccepted ? 'Accepted' : 'Denied'}
                      </span>
                    </div>
                  );
                })}
                {filtered.length > 300 && (
                  <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--gray)', background: 'var(--bg)' }}>
                    Showing 300 of {filtered.length.toLocaleString()} records. Use filters to narrow results.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
