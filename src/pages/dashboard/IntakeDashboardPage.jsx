import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import ManualIntakeEntry from './ManualIntakeEntry';

// ── helpers ──────────────────────────────────────────────────────────
function sd(v) {
  if (!v) return null;
  // JS Date object (from xlsx.js cellDates:true)
  if (v instanceof Date) { try { return v.toISOString().split('T')[0]; } catch { return null; } }
  const s = String(v).trim();
  // Already ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // M/D/YYYY or MM/DD/YYYY format (xlsx.js sometimes returns this)
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
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
function ImportPanel({ onImportDone, profile }) {
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
        const rawRows = parseIntakeXLSX(e.target.result);
        setMsg(`Parsed ${rawRows.length} rows. Checking for duplicates…`);

        // Dedupe by unique key (patient_name, date_received) — last occurrence wins.
        // A patient can legitimately have multiple referrals on different dates
        // (e.g. denied in March with Humana, accepted in April with Aetna), so
        // the unique key is the pair — not patient_name alone.
        const dedupe = new Map();
        for (const r of rawRows) {
          if (!r.patient_name || !r.date_received) continue; // skip unkeyable rows
          const key = `${r.patient_name}||${r.date_received}`;
          dedupe.set(key, r);
        }
        const rows = Array.from(dedupe.values()).map(r => ({
          ...r,
          updated_at: new Date().toISOString(),
        }));
        const droppedDupes = rawRows.length - rows.length;

        // Count existing rows so we can report new vs updated
        const { count: countBefore } = await supabase
          .from('intake_referrals')
          .select('*', { count: 'exact', head: true });

        setMsg(`Upserting ${rows.length} rows…`);

        // Upsert in chunks. onConflict matches the unique constraint so same-key
        // rows get UPDATED in place; new-key rows get INSERTED. Historical rows
        // not present in the upload are left alone.
        const CHUNK = 200;
        let processed = 0;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const { error } = await supabase
            .from('intake_referrals')
            .upsert(chunk, { onConflict: 'patient_name,date_received' });
          if (error) {
            // Surface the offending chunk so a bad row can be identified fast
            const firstRow = chunk[0];
            const lastRow = chunk[chunk.length - 1];
            throw new Error(
              `${error.message} (failed on rows ${i + 1}–${i + chunk.length}, ` +
              `e.g. ${firstRow.patient_name} / ${firstRow.date_received} … ` +
              `${lastRow.patient_name} / ${lastRow.date_received})`
            );
          }
          processed += chunk.length;
          setMsg(`Upserting… ${processed.toLocaleString()}/${rows.length.toLocaleString()}`);
        }

        // Count again and compute breakdown
        const { count: countAfter } = await supabase
          .from('intake_referrals')
          .select('*', { count: 'exact', head: true });
        const added = Math.max(0, (countAfter || 0) - (countBefore || 0));
        const updated = rows.length - added;
        const dupeNote = droppedDupes > 0 ? ` · ${droppedDupes} duplicate row${droppedDupes > 1 ? 's' : ''} collapsed` : '';

        // Record this import in upload_batches for audit trail (shows on Data Uploads page).
        const uploaderName = profile?.full_name || profile?.email || 'Unknown';
        const batchRes = await supabase.from('upload_batches').insert([{
          batch_type: 'intake_referrals',
          file_name: file.name,
          record_count: rows.length,
          uploaded_by: uploaderName,
        }]);
        if (batchRes.error) {
          // Non-fatal: the import worked, we just couldn't log it. Surface but don't fail.
          console.warn('upload_batches log failed:', batchRes.error.message);
        }

        // Update data_freshness so the Operations Overview "stale data" banner
        // clears for intake_referrals. Pariox visit/census uploads do this too;
        // intake import was the only one missing it.
        const nowIso = new Date().toISOString();
        const freshRes = await supabase.from('data_freshness').upsert({
          data_type: 'intake_referrals',
          last_upload: nowIso,
          record_count: rows.length,
          updated_at: nowIso,
        }, { onConflict: 'data_type' });
        if (freshRes.error) console.warn('data_freshness upsert failed:', freshRes.error.message);

        setStatus('success');
        setMsg(`✓ ${rows.length.toLocaleString()} processed: ${added.toLocaleString()} new, ${updated.toLocaleString()} updated${dupeNote}`);
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
  const { profile } = useAuth();
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
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [sortField, setSortField] = useState('date_desc');
  // Audit tab state (lifted to avoid hooks-in-render violation)
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilter, setAuditFilter] = useState('ALL');
  const [auditTypeFilter, setAuditTypeFilter] = useState('ALL'); // filter by flag type
  const [auditSelected, setAuditSelected] = useState(null); // selected patient for detail panel
  // Patient profile modal state
  const [profilePatient, setProfilePatient] = useState(null);
  const [profileAuth, setProfileAuth] = useState([]);
  const [profileVisits, setProfileVisits] = useState([]);
  const [profileLoading, setProfileLoading] = useState(false);
  // Payor tab state (lifted)
  const [payorSearch, setPayorSearch] = useState('');
  // Monthly Referral Volume chart: date range filter
  const [trendRange, setTrendRange] = useState('last12'); // last6|last12|last24|ytd|prev_year|custom
  const [trendFrom, setTrendFrom] = useState('');  // YYYY-MM, used when trendRange='custom'
  const [trendTo, setTrendTo] = useState('');      // YYYY-MM
  const [payorIns, setPayorIns] = useState('ALL');
  const [payorDx, setPayorDx] = useState('ALL');

  const regionScope = useAssignedRegions();

  async function fetchRecords() {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setRecords([]); setLoading(false); return;
    }
    // PostgREST silently caps at ~1000 rows even when .limit(N) requests more.
    // Paginate via .range() to get the full set regardless of server-side cap.
    setLoading(true);
    const PAGE = 1000;
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const q = regionScope.applyToQuery(
        supabase.from('intake_referrals')
          .select('id,date_received,referral_status,referral_type,region,patient_name,insurance,denial_reason,diagnosis,chart_status,dob,phone,contact_number,location,city,zip_code,county,policy_number,secondary_insurance,pcp_name,pcp_phone,pcp_fax,referral_source,referral_source_phone,referral_source_fax,referral_document,referral_document_path,referral_document_name,notes,medicare_type')
          .order('date_received', { ascending: false })
          .range(from, from + PAGE - 1)
      );
      const { data, error } = await q;
      if (error) { console.warn('fetchRecords error:', error.message); break; }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    setRecords(all);
    setLoading(false);
  }

  useEffect(() => { fetchRecords(); }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  // ── open patient profile ───────────────────────────────────────────
  async function openPatientProfile(record) {
    setProfilePatient(record);
    setProfileLoading(true);
    setProfileAuth([]);
    setProfileVisits([]);
    try {
      var pName = (record.patient_name || '').trim();
      var [authRes, visitRes] = await Promise.all([
        supabase.from('auth_tracker').select('*').ilike('patient_name', pName),
        supabase.from('visit_schedule_data').select('*').ilike('patient_name', pName).order('visit_date', { ascending: false }).limit(200),
      ]);
      setProfileAuth(authRes.data || []);
      setProfileVisits(visitRes.data || []);
    } catch (e) { console.warn('Profile fetch error:', e); }
    setProfileLoading(false);
  }

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
    // Full history of months (no slice) — the chart applies its own date-range filter.
    const months = Object.keys(monthMap).sort().map(k => ({ key: k, label: fmtMonth(k), ...monthMap[k], total: monthMap[k].accepted + monthMap[k].denied }));

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

    // Patient classification breakdown
    const newPatients = records.filter(r => r.referral_type === 'New Patient');
    const existingPatients = records.filter(r => r.referral_type === 'Existing Patient' || r.referral_type === 'Resumption Referral');
    const insuranceChange = records.filter(r => r.referral_type === 'Patient Switched Insurance');
    const unclassified = records.filter(r => !r.referral_type);
    const thisMonthNew = thisMonthRecs.filter(r => r.referral_type === 'New Patient');
    const thisMonthExisting = thisMonthRecs.filter(r => r.referral_type === 'Existing Patient' || r.referral_type === 'Resumption Referral');

    return { total, accepted, denied, acceptRate, months, byRegion, byInsurance, byDiagnosis, denialReasons, typeMap, chartStatuses, thisMonthRecs, newPatients, existingPatients, insuranceChange, unclassified, thisMonthNew, thisMonthExisting };
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

  // ── Monthly trend: apply date range filter ──────────────────────────
  // All months exist in stats.months; this filter selects which to show.
  const filteredTrendMonths = useMemo(() => {
    if (!stats.months.length) return [];
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1; // 1-12
    const mk = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    let fromKey, toKey;
    if (trendRange === 'last6' || trendRange === 'last12' || trendRange === 'last24') {
      const n = trendRange === 'last6' ? 6 : trendRange === 'last12' ? 12 : 24;
      toKey = mk(yr, mo);
      const f = new Date(yr, mo - n, 1);  // mo-n works with 0/negative; Date normalizes
      fromKey = mk(f.getFullYear(), f.getMonth() + 1);
    } else if (trendRange === 'ytd') {
      fromKey = mk(yr, 1);
      toKey = mk(yr, mo);
    } else if (trendRange === 'prev_year') {
      fromKey = mk(yr - 1, 1);
      toKey = mk(yr - 1, 12);
    } else if (trendRange === 'custom' && trendFrom && trendTo) {
      fromKey = trendFrom;
      toKey = trendTo;
    } else {
      // custom selected but not fully filled → show everything
      return stats.months;
    }
    if (fromKey > toKey) { const t = fromKey; fromKey = toKey; toKey = t; } // be forgiving
    return stats.months.filter(m => m.key >= fromKey && m.key <= toKey);
  }, [stats.months, trendRange, trendFrom, trendTo]);

  const maxMonthTotal = filteredTrendMonths.length > 0 ? Math.max(...filteredTrendMonths.map(m => m.total)) : 1;

  // By-region breakdown scoped to the SAME date range as the Monthly chart.
  // When Liam picks "Last 6 months" or "April 2026", the region chart matches.
  const VALID_REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
  const filteredByRegion = useMemo(() => {
    if (!records.length) return [];
    // Build the key set the Monthly filter would accept
    const allowedKeys = new Set(filteredTrendMonths.map(m => m.key));
    if (!allowedKeys.size) return [];
    const map = {};
    records.forEach(r => {
      const k = monthKey(r.date_received);
      if (!k || !allowedKeys.has(k)) return;
      if (!r.region || !VALID_REGIONS.includes(r.region)) return;
      if (!map[r.region]) map[r.region] = { accepted: 0, denied: 0 };
      if (r.referral_status === 'Accepted') map[r.region].accepted++;
      else if (r.referral_status === 'Denied') map[r.region].denied++;
    });
    return Object.entries(map)
      .map(([region, v]) => ({ region, ...v, total: v.accepted + v.denied }))
      .sort((a, b) => b.total - a.total);
  }, [records, filteredTrendMonths]);
  const maxRegionTotal = filteredByRegion.length > 0 ? Math.max(...filteredByRegion.map(r => r.total)) : 1;

  const TABS = [
    { key: 'overview',  label: 'Overview' },
    { key: 'regions',   label: 'By Region' },
    { key: 'diagnoses', label: 'Diagnoses' },
    { key: 'denials',   label: 'Denial Analysis' },
    { key: 'audit',     label: '🔍 Denial Audit' },
    { key: 'payor',     label: '⚡ Payor Opportunity' },
    { key: 'patients',  label: 'Patient Table' },
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
        subtitle={stats.total.toLocaleString() + ' referrals · ' + stats.acceptRate + '% accept rate'}
        actions={
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setShowManualEntry(true)}
              style={{ padding:'7px 14px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              + New Referral
            </button>
            <button onClick={() => setShowImport(v => !v)}
              style={{ padding:'7px 14px', background:showImport?'var(--border)':'var(--red)', color:showImport?'var(--black)':'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              {showImport ? 'Close Import' : '↑ Import XLSX'}
            </button>
          </div>
        }
      />

      {showManualEntry && (
        <ManualIntakeEntry
          onClose={() => setShowManualEntry(false)}
          onSaved={() => { setShowManualEntry(false); fetchRecords(); }}
        />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Import panel */}
        {showImport && (
          <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
            <ImportPanel profile={profile} onImportDone={() => { fetchRecords(); setShowImport(false); }} />
          </div>
        )}

        {/* KPI strip — each tile is clickable and filters the patient table */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Referrals',    val: stats.total.toLocaleString(),             color: 'var(--black)', sub: 'all time',               action: () => { setStatusFilter('ALL'); setTypeFilter('ALL'); setSearch(''); setActiveTab('patients'); } },
            { label: '🆕 New Patients',    val: stats.newPatients.length.toLocaleString(), color: '#1565C0',      sub: stats.thisMonthNew.length + ' this month', bg: '#EFF6FF', action: () => { setTypeFilter('New Patient'); setStatusFilter('ALL'); setSearch(''); setActiveTab('patients'); } },
            { label: '🔄 Existing Patients', val: stats.existingPatients.length.toLocaleString(), color: '#065F46', sub: 'resumptions + continuations', bg: '#ECFDF5', action: () => { setTypeFilter('Existing Patient'); setStatusFilter('ALL'); setSearch(''); setActiveTab('patients'); } },
            { label: 'Accepted',           val: stats.accepted.toLocaleString(),           color: 'var(--green)', sub: stats.acceptRate + '% accept rate', action: () => { setStatusFilter('Accepted'); setTypeFilter('ALL'); setSearch(''); setActiveTab('patients'); } },
            { label: 'Denied',             val: stats.denied.toLocaleString(),             color: '#DC2626',      sub: (100 - stats.acceptRate) + '% deny rate', alert: true, action: () => { setStatusFilter('Denied'); setTypeFilter('ALL'); setSearch(''); setActiveTab('patients'); } },
            { label: 'This Month',         val: stats.thisMonthRecs.length,                color: '#7C3AED',      sub: stats.thisMonthNew.length + ' new · ' + stats.thisMonthExisting.length + ' existing', action: () => { setMonthFilter(new Date().toISOString().slice(0,7)); setStatusFilter('ALL'); setTypeFilter('ALL'); setSearch(''); setActiveTab('patients'); } },
          ].map(tile => (
            <div key={tile.label} onClick={tile.action}
              style={{ flex: '1 1 140px', minWidth: 140, padding: '10px 14px', borderRight: '1px solid var(--border)', textAlign: 'center', background: tile.bg || (tile.alert ? '#FFFBF5' : 'transparent'), cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              <div style={{ fontSize: 9, color: 'var(--gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tile.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: tile.color, marginTop: 2 }}>{tile.val}</div>
              <div style={{ fontSize: 10, color: tile.alert ? tile.color : 'var(--gray)', marginTop: 1, fontWeight: tile.alert ? 600 : 400 }}>{tile.sub}</div>
              <div style={{ fontSize: 9, color: tile.color, marginTop: 3, opacity: 0.6 }}>click to filter ↓</div>
            </div>
          ))}
        </div>

        {/* Patient Classification Banner */}
        <div style={{ display: 'flex', gap: 0, background: '#F8FAFF', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { label: '🆕 New Patient', count: stats.newPatients.length, accepted: stats.newPatients.filter(r=>r.referral_status==='Accepted').length, color: '#1565C0', bg: '#EFF6FF', type: 'New Patient' },
            { label: '🔄 Resumption / Existing', count: stats.existingPatients.length, accepted: stats.existingPatients.filter(r=>r.referral_status==='Accepted').length, color: '#065F46', bg: '#ECFDF5', type: 'Existing Patient' },
            { label: '🔀 Insurance Change', count: stats.insuranceChange.length, accepted: stats.insuranceChange.filter(r=>r.referral_status==='Accepted').length, color: '#7C3AED', bg: '#F5F3FF', type: 'Patient Switched Insurance' },
            { label: '❌ Non-Admit', count: records.filter(r=>r.referral_type==='Non Admit').length, accepted: 0, color: '#DC2626', bg: '#FEF2F2', type: 'Non Admit' },
          ].map(item => (
            <div key={item.label} onClick={() => { setTypeFilter(typeFilter===item.type?'ALL':item.type); setActiveTab('patients'); }}
              style={{ flex: 1, padding: '8px 16px', background: typeFilter===item.type ? item.bg : 'transparent', borderRight: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: item.color }}>{item.label}</div>
                <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 1 }}>{item.accepted} accepted</div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: item.color }}>{item.count}</div>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>Monthly Referral Volume</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select value={trendRange} onChange={e => setTrendRange(e.target.value)} style={SEL}>
                      <option value="last6">Last 6 months</option>
                      <option value="last12">Last 12 months</option>
                      <option value="last24">Last 24 months</option>
                      <option value="ytd">Year to date</option>
                      <option value="prev_year">Previous year</option>
                      <option value="custom">Custom range…</option>
                    </select>
                    {trendRange === 'custom' && (
                      <>
                        <input type="month" value={trendFrom} onChange={e => setTrendFrom(e.target.value)} style={SEL} placeholder="From" />
                        <span style={{ fontSize: 11, color: 'var(--gray)' }}>to</span>
                        <input type="month" value={trendTo} onChange={e => setTrendTo(e.target.value)} style={SEL} placeholder="To" />
                      </>
                    )}
                  </div>
                </div>
                {filteredTrendMonths.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--gray)', padding: '30px 0', textAlign: 'center' }}>
                    No referrals in the selected range.
                  </div>
                ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
                  {filteredTrendMonths.map(m => {
                    const aH = maxMonthTotal > 0 ? (m.accepted / maxMonthTotal) * 110 : 0;
                    const dH = maxMonthTotal > 0 ? (m.denied / maxMonthTotal) * 110 : 0;
                    return (
                      <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: 110, width: '100%' }}>
                          <div title={`Accepted: ${m.accepted}`} style={{ flex: 1, maxWidth: 14, height: aH, background: '#10B981', borderRadius: '3px 3px 0 0', minHeight: m.accepted > 0 ? 2 : 0 }} />
                          <div title={`Denied: ${m.denied}`} style={{ flex: 1, maxWidth: 14, height: dH, background: '#DC2626', borderRadius: '3px 3px 0 0', minHeight: m.denied > 0 ? 2 : 0 }} />
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--gray)', textAlign: 'center' }}>{m.label}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--black)' }}>{m.total}</div>
                        <div style={{ fontSize: 8, fontFamily: 'DM Mono, monospace', lineHeight: 1.2, textAlign: 'center' }}>
                          <span style={{ color: '#059669' }}>{m.accepted}A</span>
                          <span style={{ color: 'var(--gray)' }}> · </span>
                          <span style={{ color: '#DC2626' }}>{m.denied}D</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
                <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <div style={{ width: 10, height: 10, background: '#10B981', borderRadius: 2 }} /> Accepted
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <div style={{ width: 10, height: 10, background: '#DC2626', borderRadius: 2 }} /> Denied
                  </div>
                </div>
              </div>

              {/* By Region — visual, respects the Monthly chart's date range */}
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>Referrals by Region</div>
                  <div style={{ fontSize: 11, color: 'var(--gray)' }}>
                    {trendRange === 'last6' ? 'Last 6 months'
                     : trendRange === 'last12' ? 'Last 12 months'
                     : trendRange === 'last24' ? 'Last 24 months'
                     : trendRange === 'ytd' ? 'Year to date'
                     : trendRange === 'prev_year' ? 'Previous year'
                     : trendRange === 'custom' && trendFrom && trendTo ? `${trendFrom} to ${trendTo}`
                     : 'All time'} · sorted by volume
                  </div>
                </div>
                {filteredByRegion.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--gray)', padding: '30px 0', textAlign: 'center' }}>
                    No referrals in the selected range.
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140 }}>
                    {filteredByRegion.map(r => {
                      const aH = maxRegionTotal > 0 ? (r.accepted / maxRegionTotal) * 110 : 0;
                      const dH = maxRegionTotal > 0 ? (r.denied / maxRegionTotal) * 110 : 0;
                      const rate = r.total > 0 ? Math.round((r.accepted / r.total) * 100) : 0;
                      return (
                        <div key={r.region} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 4, height: 110, width: '100%' }}>
                            <div title={`Accepted: ${r.accepted}`} style={{ flex: 1, maxWidth: 22, height: aH, background: '#10B981', borderRadius: '3px 3px 0 0', minHeight: r.accepted > 0 ? 2 : 0 }} />
                            <div title={`Denied: ${r.denied}`} style={{ flex: 1, maxWidth: 22, height: dH, background: '#DC2626', borderRadius: '3px 3px 0 0', minHeight: r.denied > 0 ? 2 : 0 }} />
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--black)', textAlign: 'center' }}>Rgn {r.region}</div>
                          <div style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', textAlign: 'center' }}>
                            <span style={{ color: '#059669' }}>{r.accepted}A</span>
                            <span style={{ color: 'var(--gray)' }}> · </span>
                            <span style={{ color: '#DC2626' }}>{r.denied}D</span>
                          </div>
                          <div style={{ fontSize: 10, textAlign: 'center', fontWeight: 600, color: rate >= 50 ? '#059669' : '#DC2626' }}>
                            {rate}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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

          {/* DENIAL AUDIT TAB */}
          {activeTab === 'audit' && (() => {
            // Pre-compute suspicious patterns from data alone (instant, no AI needed)
            const suspiciousPatterns = (() => {
              const denied = records.filter(r => r.referral_status === 'Denied');
              const flags = [];

              denied.forEach(r => {
                const dx = (r.diagnosis || '').toLowerCase();
                const reason = (r.denial_reason || '').toLowerCase();
                const issues = [];
                let risk = 'LOW';

                // Flag 1: Lymphedema diagnosis but denied as "non-lymphedema"
                if ((dx.includes('lymphedema') || dx.includes('i89')) && reason.includes('non-lymphedema')) {
                  issues.push({ type: 'Diagnosis Mismatch', detail: 'Lymphedema diagnosis but denied as Non-lymphedema — possible coding error or denial override', risk: 'HIGH' });
                  risk = 'HIGH';
                }

                // Flag 2: OON denial but insurance is one we DO accept (Humana, Careplus, etc.)
                const inNetworkCarriers = ['humana', 'careplus', 'health first', 'devoted', 'fhcp', 'medicare', 'cigna', 'aetna'];
                const insLower = (r.insurance || '').toLowerCase();
                if (reason.includes("don't accept patient insurance") && inNetworkCarriers.some(c => insLower.includes(c))) {
                  issues.push({ type: 'In-Network Carrier Flagged OON', detail: `${r.insurance} appears to be an in-network carrier but was denied as out-of-network`, risk: 'HIGH' });
                  risk = 'HIGH';
                }

                // Flag 3: Accepted elsewhere with same denial reason (possible inconsistency)
                const sameReasonAccepted = records.filter(rr =>
                  rr.referral_status === 'Accepted' &&
                  rr.insurance === r.insurance &&
                  rr.diagnosis === r.diagnosis
                );
                if (sameReasonAccepted.length > 0 && issues.length === 0) {
                  issues.push({ type: 'Inconsistent Decision', detail: `${sameReasonAccepted.length} other patient(s) with same insurance and diagnosis were Accepted`, risk: 'MEDIUM' });
                  if (risk === 'LOW') risk = 'MEDIUM';
                }

                // Flag 4: Blank or vague denial reason
                if (!r.denial_reason || r.denial_reason.trim().length < 5) {
                  issues.push({ type: 'Missing Denial Reason', detail: 'No denial reason recorded — may indicate incomplete intake processing', risk: 'MEDIUM' });
                  if (risk === 'LOW') risk = 'MEDIUM';
                }

                // Flag 5: "Non-lymphedema" denial but diagnosis contains lymphedema-related terms
                const lymphTerms = ['lymph', 'edema', 'i89', 'swelling', 'venous stasis'];
                if (reason.includes('non-lymphedema') && lymphTerms.some(t => dx.includes(t)) && !issues.find(i => i.type === 'Diagnosis Mismatch')) {
                  issues.push({ type: 'Possible Lymphedema Missed', detail: `Diagnosis "${r.diagnosis}" may have lymphedema component — review if denial was appropriate`, risk: 'MEDIUM' });
                  if (risk === 'LOW') risk = 'MEDIUM';
                }

                if (issues.length > 0) {
                  flags.push({ ...r, issues, risk });
                }
              });

              // Sort: HIGH first, then MEDIUM
              return flags.sort((a, b) => {
                const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                return order[a.risk] - order[b.risk];
              });
            })();

            const highRisk = suspiciousPatterns.filter(f => f.risk === 'HIGH');
            const medRisk = suspiciousPatterns.filter(f => f.risk === 'MEDIUM');

            const filtered = suspiciousPatterns.filter(f => {
              if (auditFilter !== 'ALL' && f.risk !== auditFilter) return false;
              // Type filter (set by tile clicks)
              if (auditTypeFilter !== 'ALL' && !f.issues.some(i => i.type === auditTypeFilter)) return false;
              if (auditSearch) {
                const q = auditSearch.toLowerCase();
                return (f.patient_name||'').toLowerCase().includes(q) ||
                       (f.diagnosis||'').toLowerCase().includes(q) ||
                       (f.insurance||'').toLowerCase().includes(q) ||
                       (f.region||'').toLowerCase().includes(q) ||
                       f.issues.some(i => i.type.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q));
              }
              return true;
            });

            const riskColor = { HIGH: '#DC2626', MEDIUM: '#D97706', LOW: '#6B7280' };
            const riskBg = { HIGH: '#FEF2F2', MEDIUM: '#FFFBEB', LOW: '#F9FAFB' };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Header */}
                <div style={{ background: 'linear-gradient(135deg, #7C2D12 0%, #DC2626 100%)', borderRadius: 12, padding: 24, color: '#fff' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7, marginBottom: 6 }}>Denial Audit — Quality Control</div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', marginBottom: 8 }}>{suspiciousPatterns.length} Referrals Flagged for Review</div>
                  <div style={{ fontSize: 13, opacity: 0.85, maxWidth: 700, lineHeight: 1.6 }}>
                    Automated pattern analysis of all denied referrals. Flags cases where the denial reason may be inconsistent with the diagnosis, insurance, or prior decisions — ensuring no patient was turned away by mistake.
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginTop: 16 }}>
                    {[
                      { label: 'High Risk Flags', val: highRisk.length, note: 'require immediate review', bg: 'rgba(220,38,38,0.25)' },
                      { label: 'Medium Risk Flags', val: medRisk.length, note: 'review recommended', bg: 'rgba(217,119,6,0.25)' },
                      { label: 'Total Denied', val: records.filter(r => r.referral_status === 'Denied').length, note: 'across all time', bg: 'rgba(255,255,255,0.12)' },
                    ].map(t => (
                      <div key={t.label} style={{ background: t.bg, borderRadius: 10, padding: '12px 16px', minWidth: 140 }}>
                        <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'DM Mono, monospace', marginTop: 4 }}>{t.val}</div>
                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{t.note}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Flag type breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Diagnosis Mismatch',        desc: 'Lymphedema dx denied as non-lymphedema',           color: '#DC2626', count: suspiciousPatterns.filter(f => f.issues.some(i => i.type === 'Diagnosis Mismatch')).length },
                    { label: 'In-Network Carrier OON',    desc: 'Known in-network carrier flagged as OON',           color: '#DC2626', count: suspiciousPatterns.filter(f => f.issues.some(i => i.type === 'In-Network Carrier Flagged OON')).length },
                    { label: 'Inconsistent Decision',     desc: 'Same dx + insurance accepted elsewhere',            color: '#D97706', count: suspiciousPatterns.filter(f => f.issues.some(i => i.type === 'Inconsistent Decision')).length },
                    { label: 'Possible Lymphedema Missed',desc: 'Lymphedema-related dx denied as non-lymphedema',    color: '#D97706', count: suspiciousPatterns.filter(f => f.issues.some(i => i.type === 'Possible Lymphedema Missed')).length },
                    { label: 'Missing Denial Reason',     desc: 'Denial recorded with no reason',                    color: '#D97706', count: suspiciousPatterns.filter(f => f.issues.some(i => i.type === 'Missing Denial Reason')).length },
                  ].map(cat => {
                    // Map tile label → actual issue.type string
                    const typeMap = {
                      'In-Network Carrier OON': 'In-Network Carrier Flagged OON',
                    };
                    const issueType = typeMap[cat.label] || cat.label;
                    const isActive = auditTypeFilter === issueType;
                    return (
                      <div key={cat.label}
                        onClick={() => { setAuditTypeFilter(isActive ? 'ALL' : issueType); setAuditSearch(''); setAuditSelected(null); }}
                        style={{ background: isActive ? cat.color + '18' : 'var(--card-bg)', border: `2px solid ${isActive ? cat.color : 'var(--border)'}`, borderRadius: 10, padding: 16, cursor: 'pointer', transition: 'all 0.15s' }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = cat.color; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border)'; }}>
                        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: cat.color }}>{cat.count}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)', marginTop: 4 }}>{cat.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{cat.desc}</div>
                        {isActive && <div style={{ fontSize: 10, color: cat.color, marginTop: 6, fontWeight: 700 }}>✓ Active filter — click to clear</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Flagged patient list */}
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>Flagged Referrals</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)' }}>Click any row to investigate — see full referral details and flag explanations</div>
                    </div>
                    {auditTypeFilter !== 'ALL' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FEF2F2', border: '1px solid #DC2626', borderRadius: 6, padding: '4px 10px' }}>
                        <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>Filter: {auditTypeFilter}</span>
                        <button onClick={() => setAuditTypeFilter('ALL')} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                      </div>
                    )}
                    <input placeholder="Search name, diagnosis, insurance…" value={auditSearch} onChange={e => { setAuditSearch(e.target.value); setAuditSelected(null); }}
                      style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', width: 230 }} />
                    {['ALL','HIGH','MEDIUM'].map(f => (
                      <button key={f} onClick={() => setAuditFilter(f)}
                        style={{ padding: '5px 12px', border: `1px solid ${auditFilter === f ? riskColor[f] || '#1565C0' : 'var(--border)'}`, borderRadius: 6, fontSize: 11, fontWeight: auditFilter === f ? 700 : 400, background: auditFilter === f ? (riskBg[f] || '#EFF6FF') : 'transparent', color: auditFilter === f ? (riskColor[f] || '#1565C0') : 'var(--gray)', cursor: 'pointer' }}>
                        {f === 'ALL' ? 'All' : f}
                      </button>
                    ))}
                    <span style={{ fontSize: 12, color: 'var(--gray)' }}>{filtered.length} flagged</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '0.6fr 1.8fr 0.5fr 1fr 1.4fr 1.8fr', padding: '8px 20px', background: 'var(--bg)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <span>Risk</span><span>Patient</span><span>Rgn</span><span>Insurance</span><span>Diagnosis</span><span>Flags</span>
                  </div>
                  {filtered.length === 0 && (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>No flagged referrals match your filters.</div>
                  )}
                  {filtered.slice(0, 250).map((r, i) => {
                    const isSelected = auditSelected?.id === r.id;
                    return (
                      <React.Fragment key={r.id}>
                        <div onClick={() => setAuditSelected(isSelected ? null : r)}
                          style={{ display: 'grid', gridTemplateColumns: '0.6fr 1.8fr 0.5fr 1fr 1.4fr 1.8fr', padding: '10px 20px', borderBottom: isSelected ? 'none' : '1px solid var(--border)', background: isSelected ? '#F0F7FF' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'start', cursor: 'pointer', borderLeft: isSelected ? '3px solid #1565C0' : '3px solid transparent' }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#F8F9FA'; }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)'; }}>
                          <div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: riskColor[r.risk], background: riskBg[r.risk], padding: '2px 7px', borderRadius: 999 }}>{r.risk}</span>
                          </div>
                          <div>
                            <div onClick={function(e) { e.stopPropagation(); openPatientProfile(r); }} style={{ fontSize: 12, fontWeight: 600, color: '#1565C0', cursor: 'pointer', display: 'inline' }} onMouseEnter={function(e) { e.currentTarget.style.textDecoration = 'underline'; }} onMouseLeave={function(e) { e.currentTarget.style.textDecoration = 'none'; }}>{r.patient_name || '—'}</div>
                            <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1, fontFamily: 'DM Mono, monospace' }}>{r.date_received ? r.date_received.slice(0,10) : '—'}</div>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>{r.region || '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--black)' }}>{r.insurance || '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--black)' }}>{(r.diagnosis || '—').slice(0, 35)}</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {r.issues.map((issue, j) => (
                              <span key={j} style={{ fontSize: 9, fontWeight: 700, color: riskColor[issue.risk], background: riskBg[issue.risk], padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap' }}>{issue.type}</span>
                            ))}
                          </div>
                        </div>
                        {/* DETAIL PANEL — expands inline below the selected row */}
                        {isSelected && (
                          <div style={{ borderBottom: '1px solid var(--border)', background: '#F0F7FF', borderLeft: '3px solid #1565C0', padding: '0 20px 20px 20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingTop: 16 }}>
                              {/* Left: full referral details */}
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#1565C0', marginBottom: 12 }}>Referral Details</div>
                                {[
                                  ['Patient', r.patient_name],
                                  ['Date Received', r.date_received],
                                  ['Region', r.region],
                                  ['Referral Type', r.referral_type],
                                  ['Insurance', r.insurance],
                                  ['Diagnosis', r.diagnosis],
                                  ['Referral Status', r.referral_status],
                                  ['Denial Reason', r.denial_reason || '— none recorded —'],
                                  ['Chart Status', r.chart_status],
                                  ['Referral Source', r.referral_source],
                                  ['PCP Name', r.pcp_name],
                                  ['PCP Phone', r.pcp_phone],
                                ].map(([label, val]) => val ? (
                                  <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }}>
                                    <span style={{ color: 'var(--gray)', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>{label}:</span>
                                    <span style={{ fontWeight: label === 'Denial Reason' ? 700 : 400, color: label === 'Denial Reason' ? '#DC2626' : 'var(--black)' }}>{val}</span>
                                  </div>
                                ) : null)}
                                {/* Accepted matches for Inconsistent Decision */}
                                {r.issues.some(i => i.type === 'Inconsistent Decision') && (() => {
                                  const matches = records.filter(rr => rr.referral_status === 'Accepted' && rr.insurance === r.insurance && rr.diagnosis === r.diagnosis);
                                  return matches.length > 0 ? (
                                    <div style={{ marginTop: 10, padding: 10, background: '#ECFDF5', border: '1px solid #10B981', borderRadius: 8 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: '#065F46', marginBottom: 6 }}>Patients Accepted with same Insurance + Diagnosis:</div>
                                      {matches.slice(0,5).map(m => (
                                        <div key={m.id} style={{ fontSize: 11, color: '#065F46' }}>✓ {m.patient_name} ({m.date_received?.slice(0,10)}, Region {m.region})</div>
                                      ))}
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                              {/* Right: flags with recommended actions */}
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', marginBottom: 12 }}>Flags & Recommended Actions</div>
                                {r.issues.map((issue, j) => (
                                  <div key={j} style={{ background: '#fff', border: `1px solid ${riskColor[issue.risk]}40`, borderLeft: `3px solid ${riskColor[issue.risk]}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: riskColor[issue.risk], background: riskBg[issue.risk], padding: '2px 8px', borderRadius: 999 }}>{issue.risk}</span>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{issue.type}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 8 }}>{issue.detail}</div>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: '#1565C0' }}>
                                      {issue.type === 'Diagnosis Mismatch' && '→ Review referral document — if diagnosis is confirmed lymphedema, denial should be reversed and patient re-admitted'}
                                      {issue.type === 'In-Network Carrier Flagged OON' && '→ Verify insurance plan type — patient may have a non-contracted plan variant. If standard plan, update insurance record and reconsider'}
                                      {issue.type === 'Inconsistent Decision' && '→ Compare this referral with accepted patients above — if criteria are the same, escalate to supervisor for denial review'}
                                      {issue.type === 'Possible Lymphedema Missed' && '→ Pull referral document and have clinical team review diagnosis — lymphedema component may warrant admission'}
                                      {issue.type === 'Missing Denial Reason' && '→ Contact intake coordinator who processed this referral — denial reason must be documented for compliance'}
                                    </div>
                                  </div>
                                ))}
                                {r.referral_document && (
                                  <a href={r.referral_document} target="_blank" rel="noopener noreferrer"
                                    style={{ display: 'inline-block', marginTop: 4, padding: '7px 14px', background: '#1565C0', color: '#fff', borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                                    📄 View Referral Document
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* PAYOR OPPORTUNITY TAB */}
          {activeTab === 'payor' && (() => {
            // Lymphedema OON = confirmed lymphedema diagnosis, denied only due to OON insurance
            const oonLymphedema = records.filter(r =>
              r.referral_status === 'Denied' &&
              r.denial_reason && /lymphedema but we don.t accept/i.test(r.denial_reason)
            );
            // Non-lymphedema OON = wrong condition AND wrong insurance (harder conversion)
            const oonNonLymph = records.filter(r =>
              r.referral_status === 'Denied' &&
              r.denial_reason && /non-lymphedema and we don.t accept/i.test(r.denial_reason)
            );
            // By insurance for OON lymphedema
            const insMap = {};
            oonLymphedema.forEach(r => {
              const k = r.insurance || 'Unknown';
              if (!insMap[k]) insMap[k] = { count: 0, patients: [] };
              insMap[k].count++;
              insMap[k].patients.push(r.patient_name);
            });
            const byIns = Object.entries(insMap).sort((a,b) => b[1].count - a[1].count);
            // By diagnosis
            const dxMap = {};
            oonLymphedema.forEach(r => {
              const k = r.diagnosis || 'Not specified';
              dxMap[k] = (dxMap[k] || 0) + 1;
            });
            const byDx = Object.entries(dxMap).sort((a,b) => b[1]-a[1]).slice(0,10);
            // By region
            const regMap = {};
            oonLymphedema.forEach(r => {
              if (!r.region) return;
              regMap[r.region] = (regMap[r.region] || 0) + 1;
            });
            const byReg = Object.entries(regMap).sort((a,b) => b[1]-a[1]);
            // By year/month trend
            const trendMap = {};
            oonLymphedema.forEach(r => {
              const k = r.date_received ? r.date_received.slice(0,7) : null;
              if (k) trendMap[k] = (trendMap[k] || 0) + 1;
            });
            const trend = Object.entries(trendMap).sort((a,b) => a[0].localeCompare(b[0])).slice(-12);
            const maxTrend = Math.max(...trend.map(t => t[1]), 1);
            // Uses lifted state: payorSearch, payorIns, payorDx
            const filteredOon = oonLymphedema.filter(r => {
              if (payorIns !== 'ALL' && r.insurance !== payorIns) return false;
              if (payorDx !== 'ALL' && r.diagnosis !== payorDx) return false;
              if (payorSearch) {
                const q = payorSearch.toLowerCase();
                return (r.patient_name||'').toLowerCase().includes(q) ||
                       (r.insurance||'').toLowerCase().includes(q) ||
                       (r.diagnosis||'').toLowerCase().includes(q) ||
                       (r.region||'').toLowerCase().includes(q);
              }
              return true;
            });
            const uniquePayorIns = [...new Set(oonLymphedema.map(r => r.insurance).filter(Boolean))].sort();
            const uniquePayorDx = [...new Set(oonLymphedema.map(r => r.diagnosis).filter(Boolean))].sort();

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Header callout */}
                <div style={{ background: 'linear-gradient(135deg, #1E3A5F 0%, #1565C0 100%)', borderRadius: 12, padding: 24, color: '#fff' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7, marginBottom: 6 }}>Payor Relations Opportunity Report</div>
                  <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'DM Mono, monospace', marginBottom: 8 }}>{oonLymphedema.length} Confirmed Lymphedema Patients Lost to OON Insurance</div>
                  <div style={{ fontSize: 13, opacity: 0.85, maxWidth: 700, lineHeight: 1.6 }}>
                    These patients were referred with a confirmed lymphedema diagnosis but denied solely because their insurance is out-of-network. Each represents a potential patient that could be converted if the Payor Relations team negotiates in-network contracts with these carriers.
                  </div>
                  <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
                    {[
                      { label: 'Confirmed Lymphedema OON', val: oonLymphedema.length, note: 'primary opportunity' },
                      { label: 'Top OON Carrier', val: byIns[0]?.[0] || '—', note: `${byIns[0]?.[1]?.count || 0} patients` },
                      { label: 'Est. Revenue Opportunity', val: '$' + (oonLymphedema.length * 4200).toLocaleString(), note: 'at avg $4,200/patient' },
                    ].map(tile => (
                      <div key={tile.label} style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '12px 16px', minWidth: 160 }}>
                        <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tile.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'DM Mono, monospace', marginTop: 4 }}>{tile.val}</div>
                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{tile.note}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* By insurance */}
                  <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>OON Patients by Insurance Carrier</div>
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 16 }}>Prioritize contract negotiations with highest-volume carriers first</div>
                    {byIns.map(([ins, data]) => {
                      const pct = Math.round((data.count / oonLymphedema.length) * 100);
                      return (
                        <div key={ins} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ fontWeight: 600, color: 'var(--black)' }}>{ins}</span>
                            <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#1565C0' }}>{data.count} <span style={{ fontWeight: 400, color: 'var(--gray)', fontSize: 10 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: 8, background: 'var(--border)', borderRadius: 999 }}>
                            <div style={{ height: '100%', width: (data.count / byIns[0][1].count * 100) + '%', background: '#1565C0', borderRadius: 999 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Trend + region */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Monthly OON Lymphedema Trend</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
                        {trend.map(([k, v]) => (
                          <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <div style={{ width: '80%', height: (v / maxTrend * 70), background: '#1565C0', borderRadius: '3px 3px 0 0', minHeight: 3 }} title={`${fmtMonth(k)}: ${v}`} />
                            <div style={{ fontSize: 8, color: 'var(--gray)', textAlign: 'center' }}>{fmtMonth(k)}</div>
                            <div style={{ fontSize: 9, fontWeight: 700 }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 12 }}>OON Patients by Region</div>
                      {byReg.map(([reg, cnt]) => (
                        <div key={reg} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>Region {reg}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 80, height: 6, background: 'var(--border)', borderRadius: 999 }}>
                              <div style={{ height: '100%', width: (cnt / byReg[0][1] * 100) + '%', background: '#1565C0', borderRadius: 999 }} />
                            </div>
                            <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 13, color: '#1565C0', minWidth: 24, textAlign: 'right' }}>{cnt}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Patient list */}
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>OON Lymphedema Patient List</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)' }}>Share with Payor Relations — each patient can be re-engaged if insurance converts to in-network</div>
                    </div>
                    <input placeholder="Search patient, insurance, region…" value={payorSearch}
                      onChange={e => setPayorSearch(e.target.value)}
                      style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', width: 220 }} />
                    <select value={payorIns} onChange={e => setPayorIns(e.target.value)}
                      style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', outline: 'none' }}>
                      <option value="ALL">All Carriers</option>
                      {uniquePayorIns.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                    <select value={payorDx} onChange={e => setPayorDx(e.target.value)}
                      style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', outline: 'none' }}>
                      <option value="ALL">All Diagnoses</option>
                      {uniquePayorDx.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <span style={{ fontSize: 12, color: 'var(--gray)', whiteSpace: 'nowrap' }}>{filteredOon.length} patients</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.5fr 1.2fr 1.4fr 0.6fr', padding: '8px 20px', background: 'var(--bg)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <span>Patient</span><span>Region</span><span>Insurance (OON)</span><span>Diagnosis</span><span>Date</span>
                  </div>
                  {filteredOon.slice(0, 200).map((r, i) => (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 0.5fr 1.2fr 1.4fr 0.6fr', padding: '9px 20px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'center' }}>
                      <span onClick={function(e) { e.stopPropagation(); openPatientProfile(r); }} style={{ fontSize: 12, fontWeight: 600, color: '#1565C0', cursor: 'pointer' }} onMouseEnter={function(e) { e.currentTarget.style.textDecoration = 'underline'; }} onMouseLeave={function(e) { e.currentTarget.style.textDecoration = 'none'; }}>{r.patient_name || '—'}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>{r.region || '—'}</span>
                      <span style={{ fontSize: 11, color: '#1565C0', fontWeight: 600 }}>{r.insurance || '—'}</span>
                      <span style={{ fontSize: 11, color: 'var(--black)' }}>{(r.diagnosis || '—').slice(0, 40)}</span>
                      <span style={{ fontSize: 11, color: 'var(--gray)', fontFamily: 'DM Mono, monospace' }}>{r.date_received ? r.date_received.slice(0,10) : '—'}</span>
                    </div>
                  ))}
                  {filteredOon.length > 200 && (
                    <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--gray)', background: 'var(--bg)' }}>
                      Showing 200 of {filteredOon.length} patients. Use filters to narrow.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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

              <datalist id="ins-edit-list">
                {['Humana','CarePlus','FHCP','Devoted','Health First','Aetna','Medicare','Simply','Cigna','United Healthcare','BlueCross BlueShield','Molina','WellCare','Bright Health','Oscar','Ambetter','AvMed','Sunshine Health','Staywell','Prestige'].map(function(o) { return <option key={o} value={o} />; })}
              </datalist>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 2.2fr 0.5fr 0.9fr 1.5fr 1.5fr 0.8fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <span>Date</span><span>Patient</span><span>Rgn</span><span>Type</span><span>Insurance</span><span>Diagnosis</span><span>Status</span>
                </div>
                {filtered.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>No records match your filters.</div>
                )}
                {filtered.slice(0, 300).map((r, i) => {
                  const st = r.referral_status || 'Pending';
                  const stColor = st === 'Accepted' ? '#065F46' : st === 'Denied' ? '#DC2626' : st === 'On Hold' ? '#92400E' : '#1565C0';
                  const stBg = st === 'Accepted' ? '#ECFDF5' : st === 'Denied' ? '#FEF2F2' : st === 'On Hold' ? '#FEF3C7' : '#EFF6FF';
                  return (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '0.8fr 2.2fr 0.5fr 0.9fr 1.5fr 1.5fr 0.8fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--gray)', fontFamily: 'DM Mono, monospace' }}>{r.date_received ? r.date_received.slice(0, 10) : '—'}</span>
                      <div>
                        <div onClick={function(e) { e.stopPropagation(); openPatientProfile(r); }} style={{ fontSize: 12, fontWeight: 600, color: '#1565C0', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color 0.15s' }} onMouseEnter={function(e) { e.currentTarget.style.textDecorationColor = '#1565C0'; }} onMouseLeave={function(e) { e.currentTarget.style.textDecorationColor = 'transparent'; }}>{r.patient_name || '—'}</div>
                        {r.denial_reason && st === 'Denied' && <div style={{ fontSize: 10, color: '#DC2626', marginTop: 1 }}>{r.denial_reason.slice(0, 60)}</div>}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>{r.region || '—'}</span>
                      <span style={{ fontSize: 10, color: 'var(--gray)' }}>{(r.referral_type || '').replace(' Referral','').replace('Existing Patient','Existing') || '—'}</span>
                      <input list="ins-edit-list" value={r.insurance||''} onChange={function(e) {
                        var newIns = e.target.value;
                        setRecords(function(prev) { return prev.map(function(rec) { return rec.id === r.id ? Object.assign({}, rec, { insurance: newIns }) : rec; }); });
                      }} onBlur={async function(e) {
                        var newIns = e.target.value;
                        await supabase.from('intake_referrals').update({ insurance: newIns, updated_at: new Date().toISOString() }).eq('id', r.id);
                      }} style={{ fontSize: 11, color: 'var(--black)', border: '1px solid transparent', borderRadius: 4, padding: '2px 4px', outline: 'none', background: 'transparent', width: '100%', boxSizing: 'border-box' }}
                      onFocus={function(e) { e.target.style.border = '1px solid var(--border)'; e.target.style.background = 'var(--card-bg)'; }}
                      onMouseOut={function(e) { if (document.activeElement !== e.target) { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; } }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--black)' }}>{(r.diagnosis || '—').slice(0, 50)}</span>
                      <select value={st} onChange={async function(e) {
                        var newStatus = e.target.value;
                        var { error } = await supabase.from('intake_referrals').update({ referral_status: newStatus, updated_at: new Date().toISOString() }).eq('id', r.id);
                        if (error) { alert('Error updating status: ' + error.message); return; }
                        setRecords(function(prev) { return prev.map(function(rec) { return rec.id === r.id ? Object.assign({}, rec, { referral_status: newStatus }) : rec; }); });
                      }} style={{ fontSize: 10, fontWeight: 700, color: stColor, background: stBg, padding: '2px 4px', borderRadius: 6, border: '1px solid ' + stBg, cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none', textAlign: 'center', minWidth: 70 }}>
                        <option value="Pending">Pending</option>
                        <option value="Accepted">Accepted</option>
                        <option value="Denied">Denied</option>
                        <option value="On Hold">On Hold</option>
                      </select>
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

      {/* ── PATIENT PROFILE MODAL ─────────────────────────────────────── */}
      {profilePatient && (function() {
        var r = profilePatient;
        var docUrl = r.referral_document_path
          ? supabase.storage.from('referral-documents').getPublicUrl(r.referral_document_path).data?.publicUrl
          : r.referral_document || null;
        var patAuth = profileAuth.sort(function(a,b) { return (b.created_at||'').localeCompare(a.created_at||''); });
        var latestAuth = patAuth[0] || null;
        var patVisits = profileVisits;
        var completed = patVisits.filter(function(v) { return /completed/i.test(v.status||''); }).length;
        var cancelled = patVisits.filter(function(v) { return /cancel/i.test(v.event_type||'')||/cancel/i.test(v.status||''); }).length;
        var visitsRemaining = latestAuth ? (latestAuth.visits_authorized||24)-(latestAuth.visits_used||0) : null;
        var daysToExpiry = latestAuth && latestAuth.auth_expiry_date ? Math.round((new Date(latestAuth.auth_expiry_date) - new Date()) / 86400000) : null;
        var profileTab = r._profileTab || 'overview';
        function setProfileTab(t) { setProfilePatient(function(p) { return p ? Object.assign({}, p, { _profileTab: t }) : p; }); }
        function fmtD(d) { return d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'; }
        var PTAB = function(t,l) { return React.createElement('button', { key: t, onClick: function() { setProfileTab(t); }, style: { padding:'8px 16px', border:'none', background:'none', fontSize:12, fontWeight:profileTab===t?700:400, color:profileTab===t?'var(--black)':'var(--gray)', borderBottom:profileTab===t?'2px solid #C8102E':'2px solid transparent', cursor:'pointer', whiteSpace:'nowrap' }}, l); };

        return React.createElement('div', { onClick: function() { setProfilePatient(null); }, style: { position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }},
          React.createElement('div', { onClick: function(e) { e.stopPropagation(); }, style: { background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:820, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }},
            /* Header */
            React.createElement('div', { style: { padding:'18px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0F1117', borderRadius:'16px 16px 0 0' }},
              React.createElement('div', null,
                React.createElement('div', { style: { fontSize:18, fontWeight:700, color:'#fff' }}, r.patient_name || 'Unknown Patient'),
                React.createElement('div', { style: { fontSize:12, color:'#9CA3AF', marginTop:2 }},
                  'Region ' + (r.region||'—') + ' · ' + (r.insurance||'—') + ' · ' + (r.referral_status||'Pending')
                )
              ),
              React.createElement('div', { style: { display:'flex', gap:8, alignItems:'center' }},
                docUrl && React.createElement('a', { href: docUrl, target:'_blank', rel:'noopener noreferrer', style: { padding:'6px 14px', background:'#1565C0', border:'none', borderRadius:6, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', textDecoration:'none', whiteSpace:'nowrap' }}, '📄 View Referral Doc'),
                React.createElement('button', { onClick: function() { setProfilePatient(null); }, style: { background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9CA3AF' }}, '×')
              )
            ),

            /* Stats strip */
            React.createElement('div', { style: { display:'grid', gridTemplateColumns:'repeat(4,1fr)', borderBottom:'1px solid var(--border)' }},
              [
                { label:'Visits Completed', val: completed, color:'#065F46', bg:'#ECFDF5' },
                { label:'Cancelled', val: cancelled, color:'#DC2626', bg:'#FEF2F2' },
                { label:'Visits Remaining', val: visitsRemaining !== null ? visitsRemaining : '—', color: visitsRemaining!==null&&visitsRemaining<=5?'#DC2626':visitsRemaining!==null&&visitsRemaining<=10?'#D97706':'#065F46', bg: visitsRemaining!==null&&visitsRemaining<=5?'#FEF2F2':visitsRemaining!==null&&visitsRemaining<=10?'#FEF3C7':'#ECFDF5' },
                { label:'Days to Auth Expiry', val: daysToExpiry !== null ? daysToExpiry : '—', color: daysToExpiry!==null&&daysToExpiry<=7?'#DC2626':daysToExpiry!==null&&daysToExpiry<=14?'#D97706':'#065F46', bg: daysToExpiry!==null&&daysToExpiry<=7?'#FEF2F2':daysToExpiry!==null&&daysToExpiry<=14?'#FEF3C7':'#ECFDF5' },
              ].map(function(s) { return React.createElement('div', { key: s.label, style: { padding:'12px 16px', background:s.bg, borderRight:'1px solid var(--border)', textAlign:'center' }},
                React.createElement('div', { style: { fontSize:24, fontWeight:800, fontFamily:'DM Mono, monospace', color:s.color }}, s.val),
                React.createElement('div', { style: { fontSize:10, fontWeight:600, color:'var(--gray)', marginTop:2 }}, s.label)
              ); })
            ),

            /* Tabs */
            React.createElement('div', { style: { display:'flex', borderBottom:'1px solid var(--border)', padding:'0 24px', overflowX:'auto' }},
              PTAB('overview','Overview'), PTAB('referral','Referral'), PTAB('auth','Authorization'), PTAB('history','Visit History'), PTAB('documents','Documents')
            ),

            /* Tab content */
            React.createElement('div', { style: { flex:1, overflowY:'auto', padding:24 }},
              profileLoading ? React.createElement('div', { style: { textAlign:'center', color:'var(--gray)', padding:40 }}, 'Loading patient data…') :

              /* OVERVIEW */
              profileTab === 'overview' ? React.createElement('div', { style: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }},
                React.createElement('div', { style: { background:'var(--bg)', borderRadius:10, padding:16 }},
                  React.createElement('div', { style: { fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}, 'Contact Information'),
                  [['Patient Name', r.patient_name], ['Date of Birth', fmtD(r.dob)], ['Phone', r.phone || r.contact_number || '—'], ['Address', r.location || '—'], ['City', r.city || '—'], ['Zip', r.zip_code || '—'], ['County', r.county || '—']].map(function(pair) {
                    return pair[1] && pair[1] !== '—' ? React.createElement('div', { key: pair[0], style: { display:'flex', gap:8, marginBottom:6, fontSize:12 }},
                      React.createElement('span', { style: { color:'var(--gray)', fontWeight:600, minWidth:100, flexShrink:0 }}, pair[0]+':'),
                      React.createElement('span', { style: { color:'var(--black)' }}, pair[1])
                    ) : null;
                  })
                ),
                React.createElement('div', { style: { background:'var(--bg)', borderRadius:10, padding:16 }},
                  React.createElement('div', { style: { fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}, 'Current Auth Status'),
                  latestAuth ? [['Auth Number', latestAuth.auth_number || '—'], ['Status', latestAuth.auth_status], ['Insurance', latestAuth.insurance], ['Visits Authorized', latestAuth.visits_authorized], ['Visits Used', latestAuth.visits_used], ['Visits Remaining', visitsRemaining], ['Auth Start', fmtD(latestAuth.soc_date || latestAuth.auth_start_date)], ['Auth Expiry', fmtD(latestAuth.auth_expiry_date)]].map(function(pair) {
                    return React.createElement('div', { key: pair[0], style: { display:'flex', gap:8, marginBottom:6, fontSize:12 }},
                      React.createElement('span', { style: { color:'var(--gray)', fontWeight:600, minWidth:110, flexShrink:0 }}, pair[0]+':'),
                      React.createElement('span', { style: { color:'var(--black)' }}, pair[1])
                    );
                  }) : React.createElement('div', { style: { fontSize:12, color:'var(--gray)' }}, 'No authorization records found.')
                )
              ) :

              /* REFERRAL */
              profileTab === 'referral' ? React.createElement('div', { style: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }},
                [
                  { title:'Referral Details', fields: [['Date Received', fmtD(r.date_received)], ['Status', r.referral_status || 'Pending'], ['Referral Type', r.referral_type || '—'], ['Region', r.region || '—'], ['Denial Reason', r.denial_reason || '— none recorded —'], ['Chart Status', r.chart_status || '—']] },
                  { title:'Diagnosis & Insurance', fields: [['Diagnosis', r.diagnosis || '—'], ['Primary Insurance', r.insurance || '—'], ['Policy Number', r.policy_number || '—'], ['Medicare Type', r.medicare_type || '—'], ['Secondary Insurance', r.secondary_insurance || '—']] },
                  { title:'Referral Source', fields: [['Source Name', r.referral_source || '—'], ['Source Phone', r.referral_source_phone || '—'], ['Source Fax', r.referral_source_fax || '—']] },
                  { title:'Primary Care Physician', fields: [['PCP Name', r.pcp_name || '—'], ['PCP Phone', r.pcp_phone || '—'], ['PCP Fax', r.pcp_fax || '—']] },
                ].map(function(section) {
                  return React.createElement('div', { key: section.title, style: { background:'var(--bg)', borderRadius:10, padding:16 }},
                    React.createElement('div', { style: { fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}, section.title),
                    section.fields.map(function(pair) {
                      return React.createElement('div', { key: pair[0], style: { display:'flex', gap:8, marginBottom:6, fontSize:12 }},
                        React.createElement('span', { style: { color:'var(--gray)', fontWeight:600, minWidth:120, flexShrink:0 }}, pair[0]+':'),
                        React.createElement('span', { style: { color: pair[0]==='Denial Reason'&&pair[1]!=='— none recorded —'?'#DC2626':'var(--black)', fontWeight: pair[0]==='Denial Reason'&&pair[1]!=='— none recorded —'?700:400 }}, pair[1])
                      );
                    })
                  );
                })
              ) :

              /* AUTHORIZATION */
              profileTab === 'auth' ? React.createElement('div', { style: { display:'flex', flexDirection:'column', gap:12 }},
                patAuth.length === 0 ? React.createElement('div', { style: { color:'var(--gray)', fontSize:13 }}, 'No authorization records found.') :
                patAuth.map(function(a, i) {
                  return React.createElement('div', { key: a.id || i, style: { background:'var(--bg)', borderRadius:10, padding:16, border:'1px solid var(--border)' }},
                    React.createElement('div', { style: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }},
                      React.createElement('div', { style: { fontSize:13, fontWeight:700, color:'var(--black)' }}, 'Auth #' + (a.auth_number || 'Pending')),
                      React.createElement('span', { style: { fontSize:11, fontWeight:700, color:/active|approved/i.test(a.auth_status||'')?'#065F46':'#D97706', background:/active|approved/i.test(a.auth_status||'')?'#ECFDF5':'#FEF3C7', padding:'2px 8px', borderRadius:999 }}, a.auth_status)
                    ),
                    React.createElement('div', { style: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }},
                      [['Insurance', a.insurance], ['Visits Auth.', a.visits_authorized], ['Visits Used', a.visits_used], ['Remaining', (a.visits_authorized||24)-(a.visits_used||0)], ['Auth Start', fmtD(a.soc_date||a.auth_start_date)], ['Auth Expiry', fmtD(a.auth_expiry_date)], ['PCP', a.pcp_name||'—'], ['Request Type', a.request_type||'—'], ['Frequency', a.frequency||'—']].map(function(pair) {
                        return React.createElement('div', { key: pair[0], style: { fontSize:12 }},
                          React.createElement('div', { style: { color:'var(--gray)', fontWeight:600, fontSize:10, marginBottom:2 }}, pair[0]),
                          React.createElement('div', { style: { color:'var(--black)', fontWeight:500 }}, pair[1])
                        );
                      })
                    ),
                    React.createElement('div', { style: { marginTop:12 }},
                      React.createElement('div', { style: { display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--gray)', marginBottom:3 }},
                        React.createElement('span', null, 'Visit Utilization'),
                        React.createElement('span', null, (a.visits_used||0) + ' / ' + (a.visits_authorized||24))
                      ),
                      React.createElement('div', { style: { height:6, background:'var(--border)', borderRadius:999 }},
                        React.createElement('div', { style: { height:'100%', width:Math.min(((a.visits_used||0)/(a.visits_authorized||24))*100,100)+'%', background:'#10B981', borderRadius:999 }})
                      )
                    )
                  );
                })
              ) :

              /* VISIT HISTORY */
              profileTab === 'history' ? React.createElement('div', null,
                React.createElement('div', { style: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', padding:'8px 12px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', borderRadius:'8px 8px 0 0' }},
                  React.createElement('span', null, 'Date'), React.createElement('span', null, 'Clinician'), React.createElement('span', null, 'Event'), React.createElement('span', null, 'Status'), React.createElement('span', null, 'Discipline')
                ),
                patVisits.length === 0 ? React.createElement('div', { style: { padding:20, color:'var(--gray)', fontSize:13 }}, 'No visit history found.') :
                patVisits.map(function(v, i) {
                  var isCan = /cancel/i.test(v.event_type||'')||/cancel/i.test(v.status||'');
                  var isComp = /completed/i.test(v.status||'');
                  var isMiss = /missed/i.test(v.status||'') && !isCan;
                  var sColor = isComp?'#065F46':isCan?'#DC2626':isMiss?'#D97706':'#1565C0';
                  var sBg = isComp?'#ECFDF5':isCan?'#FEF2F2':isMiss?'#FEF3C7':'#EFF6FF';
                  return React.createElement('div', { key: v.id||i, style: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', padding:'8px 12px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center' }},
                    React.createElement('span', { style: { fontSize:12, fontFamily:'DM Mono, monospace' }}, v.visit_date||'—'),
                    React.createElement('span', { style: { fontSize:12, color:'var(--black)' }}, v.staff_name||'—'),
                    React.createElement('span', { style: { fontSize:11, color:'var(--gray)' }}, (v.event_type||'—').replace(/\s*\(PDF\)/g,'').trim()),
                    React.createElement('span', { style: { fontSize:10, fontWeight:700, color:sColor, background:sBg, padding:'2px 7px', borderRadius:999, display:'inline-block' }}, isCan?'Cancelled':isComp?'Completed':isMiss?'Missed':v.status||'—'),
                    React.createElement('span', { style: { fontSize:11, color:'var(--gray)' }}, v.discipline||'—')
                  );
                })
              ) :

              /* DOCUMENTS */
              profileTab === 'documents' ? React.createElement('div', null,
                React.createElement('div', { style: { fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:16, textTransform:'uppercase', letterSpacing:'0.05em' }}, 'Referral Documents'),
                docUrl ? React.createElement('div', { style: { background:'var(--bg)', borderRadius:10, padding:16, border:'1px solid var(--border)' }},
                  React.createElement('div', { style: { display:'flex', alignItems:'center', gap:12 }},
                    React.createElement('div', { style: { width:40, height:40, background:'#EFF6FF', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}, '📄'),
                    React.createElement('div', { style: { flex:1 }},
                      React.createElement('div', { style: { fontSize:13, fontWeight:600, color:'var(--black)' }}, r.referral_document_name || 'Referral Document'),
                      React.createElement('div', { style: { fontSize:11, color:'var(--gray)', marginTop:2 }}, 'Uploaded with referral on ' + fmtD(r.date_received))
                    ),
                    React.createElement('a', { href: docUrl, target:'_blank', rel:'noopener noreferrer', style: { padding:'8px 16px', background:'#1565C0', color:'#fff', borderRadius:7, fontSize:12, fontWeight:600, textDecoration:'none' }}, 'Open Document')
                  )
                ) : React.createElement('div', { style: { padding:40, textAlign:'center', color:'var(--gray)', fontSize:13 }}, 'No referral document attached to this record.'),
                patAuth.length > 0 && React.createElement('div', { style: { marginTop:20 }},
                  React.createElement('div', { style: { fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}, 'Authorization Documents'),
                  patAuth.filter(function(a) { return a.auth_document_path; }).length === 0
                    ? React.createElement('div', { style: { color:'var(--gray)', fontSize:12 }}, 'No authorization documents uploaded.')
                    : patAuth.filter(function(a) { return a.auth_document_path; }).map(function(a) {
                        var aUrl = supabase.storage.from('auth-documents').getPublicUrl(a.auth_document_path).data?.publicUrl || a.auth_document_path;
                        return React.createElement('div', { key: a.id, style: { background:'var(--bg)', borderRadius:10, padding:12, border:'1px solid var(--border)', marginBottom:8, display:'flex', alignItems:'center', gap:12 }},
                          React.createElement('div', { style: { fontSize:18 }}, '🔐'),
                          React.createElement('div', { style: { flex:1 }},
                            React.createElement('div', { style: { fontSize:12, fontWeight:600 }}, 'Auth #' + (a.auth_number||'Pending') + ' — ' + (a.auth_document_name||'Auth Document')),
                            React.createElement('div', { style: { fontSize:11, color:'var(--gray)' }}, (a.auth_status||'') + ' · Expires ' + fmtD(a.auth_expiry_date))
                          ),
                          React.createElement('a', { href: aUrl, target:'_blank', rel:'noopener noreferrer', style: { padding:'6px 12px', background:'#7C3AED', color:'#fff', borderRadius:6, fontSize:11, fontWeight:600, textDecoration:'none' }}, 'Open')
                        );
                      })
                )
              ) : null
            )
          )
        );
      })()}
    </div>
  );
}
