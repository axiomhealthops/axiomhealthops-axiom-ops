import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import * as XLSX from 'xlsx';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
// Shared visit math (2026-05-17 refactor). The old local isCompleted(status)
// signature was DIFFERENT from visitMath's (takes whole row) — wrappers below
// preserve back-compat so existing call sites don't all need rewriting.
import { BLENDED_RATE as RATE,
         isCancelled as _isCancelledRow,
         isCompleted as _isCompletedRow,
         isEval as _isEvalRow } from '../../lib/visitMath';

const REGIONAL_MANAGERS = {
  A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks',
  H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi',
  T:'Samantha Faliks', V:'Samantha Faliks',
};

// Back-compat wrappers — preserve the old (event_type, status) / (status)
// signatures used by existing report code so we don't have to rewrite every
// call site. Internally they pass through to the shared visitMath helpers.
function isCancelled(e, s) { return _isCancelledRow({ event_type: e, status: s }); }
function isCompleted(s)    { return _isCompletedRow({ status: s, event_type: '' }); }
function isEval(e)         { return _isEvalRow({ event_type: e }); }
function fmtDate(d) { return d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) : '' ; }
 
// ─── Report taxonomy (2026-06-09 reorganization) ─────────────────────────
// Before: 12 inconsistent categories with "Clinical" vs "Clinical Dept",
// "Auth" vs "Auth Dept" duplicates, cards in one big undifferentiated grid.
// Now: 6 clean buckets + section headers + pinned high-priority reports.
// The category drives both filter dropdown labels AND the visual section
// the report renders into.
const CATEGORY_META = {
  'Executive & Revenue': { color: '#7C3AED', bg: '#F5F3FF', desc: 'Leadership-facing snapshots — KPIs, revenue, cross-department accountability' },
  'Intake':              { color: '#0369A1', bg: '#EFF6FF', desc: 'Referral funnel — sources, conversions, this-week activity' },
  'Authorization':       { color: '#1565C0', bg: '#EFF6FF', desc: 'Auth inventory — active, pending, stalled, renewal, expiring' },
  'Care Coordination':   { color: '#0E7490', bg: '#ECFEFF', desc: 'Patient pipeline health — scheduling, frequency, notes, on-hold' },
  'Clinical':            { color: '#D97706', bg: '#FFFBEB', desc: 'Patient-level clinical performance, discipline mix, risk roster' },
  'Operations':          { color: '#065F46', bg: '#ECFDF5', desc: 'Census, masters, missed/cancelled, clinician productivity, regional rollups' },
};
const CATEGORY_ORDER = Object.keys(CATEGORY_META);

const REPORTS = [
  // ── EXECUTIVE & REVENUE (5) — leadership / board / cross-cutting ──
  { id: 'kpi_summary',              icon: '📊', title: 'Company KPI Summary',                desc: 'High-level KPIs: visits, revenue, intake conversion, auth approval rate. Ideal for leadership presentations.', formats: ['xlsx','csv'], category: 'Executive & Revenue', pinned: true },
  { id: 'revenue_by_region',        icon: '💰', title: 'Revenue by Region',                  desc: 'Completed visits and estimated revenue broken down by region and regional manager.', formats: ['xlsx','csv'], category: 'Executive & Revenue', pinned: true },
  { id: 'payer_performance',        icon: '🏦', title: 'Payer Performance Report',           desc: 'Per-payer revenue, visit volume, completion rate, auth approval rate, days-to-approve. Strategic input for renegotiation conversations.', formats: ['xlsx','csv'], category: 'Executive & Revenue', pinned: true },
  { id: 'conversion_funnel',        icon: '🔻', title: 'Conversion Funnel (by month)',       desc: 'Referral → Accepted → On Census → SOC → Active. Monthly cohort drop-off analysis with region slice. Shows where patients leak out.', formats: ['xlsx','csv'], category: 'Executive & Revenue', pinned: true },
  { id: 'ops_stuck',                icon: '⚠️', title: 'Stuck Patients (all stages)',        desc: 'Every patient past their stage threshold — cross-department accountability list.', formats: ['xlsx','csv'], category: 'Executive & Revenue' },

  // ── INTAKE (3) — funnel top, referral sources ──
  { id: 'intake_this_week',         icon: '📥', title: "This Week's Referrals",              desc: 'New referrals received in the last 7 days — with welcome call + accept/decline status.', formats: ['xlsx','csv'], category: 'Intake', pinned: true },
  { id: 'intake_referrals',         icon: '🗂', title: 'Intake Referrals Export (full log)', desc: 'Full referral log with patient, insurance, diagnosis, status, PCP, and denial reason.', formats: ['xlsx','csv'], category: 'Intake' },
  { id: 'intake_ref_sources',       icon: '📊', title: 'Referral Source Breakdown',          desc: 'Which Pariox codes are sending referrals, mapped to insurance + accept rate.', formats: ['xlsx','csv'], category: 'Intake' },

  // ── AUTHORIZATION (7) — full lifecycle: active, pending, stalled, renewal, expiring ──
  { id: 'auth_status',              icon: '🔐', title: 'Authorization Status (all)',         desc: 'All auths with visits authorized/used/remaining, expiry dates, and alert flags.', formats: ['xlsx','csv'], category: 'Authorization' },
  { id: 'auth_all',                 icon: '✅', title: 'All Active Authorizations',          desc: 'Every currently-active auth with PPO?, dates, visit counts, status, and assigned auth coordinator.', formats: ['xlsx','csv'], category: 'Authorization' },
  { id: 'auth_pending_active',      icon: '⏳', title: 'Active - Auth Pending Patients',     desc: 'Patients currently being seen with status "Active - Auth Pending" — owe an auth, still seeing them.', formats: ['xlsx','csv'], category: 'Authorization', pinned: true },
  { id: 'auth_stalled',             icon: '🪦', title: 'Stalled Auths (Submitted >5d)',      desc: 'Auths submitted more than 5 days ago that still have no approval — action list for the Auth team.', formats: ['xlsx','csv'], category: 'Authorization', pinned: true },
  { id: 'expiring_auths',           icon: '⏰', title: 'Expiring Authorizations (≤30d)',     desc: 'Patients whose auth expires within 30 days or have ≤5 visits remaining. Action list for auth team.', formats: ['xlsx','csv'], category: 'Authorization' },
  { id: 'auth_renewal',             icon: '🔄', title: 'Renewal Pipeline (≤30 days)',        desc: 'Auths expiring in the next 30 days — sorted by days remaining.', formats: ['xlsx','csv'], category: 'Authorization' },
  { id: 'auth_ppo',                 icon: '💳', title: 'PPO Patients',                       desc: 'Every patient on a PPO plan — different auth rules apply. Pulls from audit-imported is_ppo OR existing insurance_type match.', formats: ['xlsx','csv'], category: 'Authorization' },

  // ── CARE COORDINATION (4) — scheduling, frequency, notes, on-hold ──
  { id: 'cc_not_scheduled',         icon: '📅', title: 'Patients Not Scheduled (next 14d)',  desc: 'Active patients with NO scheduled visits in the next 14 days. Uses real visit_schedule_data — more accurate than the audit flag.', formats: ['xlsx','csv'], category: 'Care Coordination', pinned: true },
  { id: 'frequency_review',         icon: '⚖', title: 'Frequency Review Queue',              desc: 'Active patients with visit frequency, last visit date, visits used vs authorized, and days since last seen. Flags patients overdue for frequency review.', formats: ['xlsx','csv'], category: 'Care Coordination' },
  { id: 'cc_frequency_missing',     icon: '🛠', title: 'Frequency Missing / Needs Review',   desc: 'Active patients with no frequency set or marked for review.', formats: ['xlsx','csv'], category: 'Care Coordination' },
  { id: 'cc_on_hold_waitlist',      icon: '⏸', title: 'On Hold + Waitlist Active List',     desc: 'Patients on hold or waitlisted — sorted by days inactive (recovery candidates).', formats: ['xlsx','csv'], category: 'Care Coordination' },
  { id: 'cc_notes_log',             icon: '📝', title: 'CC Notes Log (30 days)',             desc: 'All care coordination notes incl. audit imports — chronological view.', formats: ['xlsx','csv'], category: 'Care Coordination' },

  // ── CLINICAL (5) — patient performance, discipline mix, risk roster ──
  { id: 'patient_performance',      icon: '👤', title: 'Patient Performance Report',         desc: 'Per-patient visit history with completed, cancelled, missed counts. Share with Regional Managers for PCP updates.', formats: ['xlsx','csv'], category: 'Clinical', pinned: true },
  { id: 'non_compliance',           icon: '🚫', title: 'Non-Compliance Patients (2+ cancels)', desc: 'Patients with 2+ cancellations — evidence of non-compliance for clinical and payer documentation.', formats: ['xlsx','csv'], category: 'Clinical' },
  { id: 'clinical_discipline',      icon: '🩺', title: 'Discipline Breakdown (PT vs OT)',    desc: 'How patients split between Lymphedema PT and OT, by region — capacity planning input. Multi-sheet (Summary + All Patients).', formats: ['xlsx','csv'], category: 'Clinical' },
  { id: 'clinical_eval_pending',    icon: '⏱', title: 'Eval Pending Backlog',                desc: 'Patients awaiting clinical evaluation — 48h SLA.', formats: ['xlsx','csv'], category: 'Clinical' },
  { id: 'clinical_high_risk',       icon: '⚠', title: 'High Risk Patients (LOC + CareMap)',  desc: 'Full high-risk roster with CareMap, LOC level, wounds, comorbidities, falls, compliance & environmental risk. Multi-sheet (LOC 4+5 first, then full list).', formats: ['xlsx','csv'], category: 'Clinical' },

  // ── OPERATIONS (6) — census, masters, missed/cancelled, productivity, RM rollup ──
  { id: 'patient_census',           icon: '🏥', title: 'Patient Census Export',              desc: 'Current census snapshot — Summary, Full Census, Active Only, and a Status Drift audit (cases where census_data and patient_master disagree). Template is the blank Pariox-format upload sheet for audits and bulk re-imports.', formats: ['xlsx','csv','template'], category: 'Operations', pinned: true },
  { id: 'ops_doc_lag',              icon: '⏱', title: 'Documentation Lag Report',            desc: 'Per-clinician: visits with past visit_dates that are still marked Scheduled in Pariox. Catches the "Monday visits not documented" lag that hides revenue.', formats: ['xlsx','csv'], category: 'Operations', pinned: true },
  { id: 'ops_master',               icon: '📋', title: 'Full Patient Master',                desc: 'Mirrors the original audit XLSX — every column for every active patient. Use this for the next round of the weekly audit.', formats: ['xlsx','csv'], category: 'Operations' },
  { id: 'ops_missed_cancelled',     icon: '📉', title: 'Missed & Cancelled Visits',          desc: 'All missed and cancelled visits from visit_schedule_data — replaces the standalone Missed/Cancelled page.', formats: ['xlsx','csv'], category: 'Operations', pinned: true },
  { id: 'clinician_productivity',   icon: '📈', title: 'Clinician Productivity Report',      desc: 'Per-clinician visit counts (completed, cancelled, missed), revenue contribution, and target attainment.', formats: ['xlsx','csv'], category: 'Operations' },
  { id: 'regional_manager_summary', icon: '🗺', title: 'Regional Manager Summary',           desc: 'Patient list per region with insurance, visit totals, and auth status. Ready to share with each RM.', formats: ['xlsx','csv'], category: 'Operations' },
];
 
export default function ReportsExportPage() {
  const [visits, setVisits] = useState([]);
  const [intake, setIntake] = useState([]);
  const [auth, setAuth] = useState([]);
  const [census, setCensus] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  // Added 2026-05-17 for dept reports consolidation
  const [careCoordNotes, setCareCoordNotes] = useState([]);
  // High-risk reassessment roster — drives the clinical_high_risk report
  const [highRisk, setHighRisk] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null);
  const [success, setSuccess] = useState(null);
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
 
  function loadData() {
    Promise.all([
      fetchAllPages(supabase.from('visit_schedule_data').select('*')),
      fetchAllPages(supabase.from('intake_referrals').select('*')),
      fetchAllPages(supabase.from('auth_tracker').select('*')),
      fetchAllPages(supabase.from('census_data').select('*')),
      fetchAllPages(supabase.from('clinicians').select('*').eq('is_active', true)),
      // For cc_notes_log report (added 2026-05-17 in consolidation)
      fetchAllPages(supabase.from('care_coord_notes').select('patient_name,region,note_type,note,contact_date,updated_by').order('contact_date', { ascending: false })),
      // High-risk roster (added 2026-05-19) — drives clinical_high_risk report
      fetchAllPages(supabase.from('patient_risk_factors').select('*').order('caremap_score', { ascending: false, nullsFirst: false })),
    ]).then(([v,i,a,c,cl,cn,hr]) => {
      setVisits(v); setIntake(i);
      setAuth(a); setCensus(c);
      setClinicians(cl);
      setCareCoordNotes(cn);
      setHighRisk(hr || []);
      setLoading(false);
    });
  }

  useEffect(() => { loadData(); }, []);
 
  function applyFilters(items, dateField='visit_date') {
    return items.filter(item => {
      const d = item[dateField];
      if (regionFilter !== 'ALL' && item.region !== regionFilter) return false;
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      return true;
    });
  }
 
  function exportXLSX(data, sheetName, filename) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    // Auto-width columns
    const cols = Object.keys(data[0]||{}).map(k => ({ wch: Math.max(k.length, 14) }));
    ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename + '.xlsx');
  }
 
  function exportCSV(data, filename) {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => {
      const v = String(row[h]||'');
      return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g,'""')}"` : v;
    }).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename + '.csv'; a.click();
    URL.revokeObjectURL(url);
  }
 
  async function generate(reportId, format) {
    setGenerating(reportId + '_' + format);
    setSuccess(null);
    await new Promise(r => setTimeout(r, 200));
 
    const today = new Date().toISOString().slice(0,10);
    const suffix = `_${today}`;
 
    try {
      switch (reportId) {
 
        case 'kpi_summary': {
          const fv = applyFilters(visits);
          const fi = applyFilters(intake, 'date_received');
          const fa = applyFilters(auth, 'created_at');
          const evalSeen = new Set();
          let completed=0, cancelled=0, missed=0;
          fv.forEach(v => {
            if (isCancelled(v.event_type,v.status)) { cancelled++; return; }
            if (isEval(v.event_type)) {
              const k = `${v.patient_name}||${v.visit_date}`;
              if (evalSeen.has(k)) return; evalSeen.add(k);
            }
            if (isCompleted(v.status)) completed++;
            else if (/missed/i.test(v.status||'')) missed++;
          });
          const accepted = fi.filter(r=>r.referral_status==='Accepted').length;
          const activeAuth = fa.filter(a=>/active|approved/i.test(a.auth_status||'')).length;
          const data = [{
            'Report Date': fmtDate(today),
            'Total Visits (Billable)': completed,
            'Cancelled Visits': cancelled,
            'Missed Visits': missed,
            'Completion Rate %': fv.length > 0 ? Math.round(completed/fv.length*100) : 0,
            'Est. Revenue ($)': completed * RATE,
            'Lost Revenue (Cancellations) ($)': cancelled * RATE,
            'Lost Revenue (Missed) ($)': missed * RATE,
            'Total Referrals': fi.length,
            'Accepted Referrals': accepted,
            'Denied Referrals': fi.length - accepted,
            'Intake Conversion Rate %': fi.length > 0 ? Math.round(accepted/fi.length*100) : 0,
            'Total Auths': fa.length,
            'Active/Approved Auths': activeAuth,
            'Auth Approval Rate %': fa.length > 0 ? Math.round(activeAuth/fa.length*100) : 0,
            'Active Census Patients': census.length,
          }];
          format === 'xlsx' ? exportXLSX(data, 'KPI Summary', 'KPI_Summary'+suffix) : exportCSV(data, 'KPI_Summary'+suffix);
          break;
        }
 
        case 'patient_performance': {
          const fv = applyFilters(visits);
          const patMap = {};
          fv.forEach(v => {
            const k = (v.patient_name||'Unknown').trim();
            if (!patMap[k]) patMap[k] = { completed:0, cancelled:0, missed:0, region:v.region||'', insurance:'' };
            if (isCancelled(v.event_type,v.status)) patMap[k].cancelled++;
            else if (isCompleted(v.status)) patMap[k].completed++;
            else if (/missed/i.test(v.status||'')) patMap[k].missed++;
          });
          // Enrich with census insurance
          census.forEach(c => {
            const k = (c.patient_name||'').trim();
            if (patMap[k]) patMap[k].insurance = c.insurance || '';
          });
          // Enrich with auth data
          auth.forEach(a => {
            const k = (a.patient_name||'').trim();
            if (patMap[k]) {
              patMap[k].auth_status = a.auth_status || '';
              patMap[k].visits_remaining = (a.visits_authorized||24)-(a.visits_used||0);
              patMap[k].auth_expiry = a.auth_expiry_date || '';
            }
          });
          const data = Object.entries(patMap)
            .filter(([,v]) => regionFilter==='ALL' || v.region===regionFilter)
            .map(([name, v]) => ({
              'Patient Name': name,
              'Region': v.region,
              'Regional Manager': REGIONAL_MANAGERS[v.region] || '—',
              'Insurance': v.insurance || '—',
              'Completed Visits': v.completed,
              'Cancelled Visits': v.cancelled,
              'Missed Visits': v.missed,
              'Total Visits': v.completed + v.cancelled + v.missed,
              'Completion Rate %': v.completed+v.cancelled+v.missed > 0 ? Math.round(v.completed/(v.completed+v.cancelled+v.missed)*100) : 0,
              'Auth Status': v.auth_status || '—',
              'Visits Remaining': v.visits_remaining ?? '—',
              'Auth Expiry': fmtDate(v.auth_expiry),
            }))
            .sort((a,b) => a['Region'].localeCompare(b['Region']) || a['Patient Name'].localeCompare(b['Patient Name']));
          format === 'xlsx' ? exportXLSX(data, 'Patient Performance', 'Patient_Performance'+suffix) : exportCSV(data, 'Patient_Performance'+suffix);
          break;
        }
 
        case 'non_compliance': {
          const fv = applyFilters(visits);
          const cancelMap = {};
          fv.forEach(v => {
            if (!isCancelled(v.event_type,v.status)) return;
            const k = (v.patient_name||'Unknown').trim();
            if (!cancelMap[k]) cancelMap[k] = { count:0, dates:[], region:v.region||'', insurance:'' };
            cancelMap[k].count++;
            if (v.visit_date) cancelMap[k].dates.push(v.visit_date);
          });
          census.forEach(c => {
            const k = (c.patient_name||'').trim();
            if (cancelMap[k]) cancelMap[k].insurance = c.insurance || '';
          });
          const data = Object.entries(cancelMap)
            .filter(([,v]) => v.count >= 2 && (regionFilter==='ALL' || v.region===regionFilter))
            .map(([name,v]) => ({
              'Patient Name': name,
              'Region': v.region,
              'Regional Manager': REGIONAL_MANAGERS[v.region] || '—',
              'Insurance': v.insurance,
              'Total Cancellations': v.count,
              'Non-Compliance Level': v.count >= 5 ? 'HIGH' : v.count >= 3 ? 'MEDIUM' : 'LOW',
              'Cancellation Dates': v.dates.sort().join(', '),
              'Revenue Lost ($)': v.count * RATE,
            }))
            .sort((a,b) => b['Total Cancellations'] - a['Total Cancellations']);
          format === 'xlsx' ? exportXLSX(data, 'Non-Compliance', 'Non_Compliance_Report'+suffix) : exportCSV(data, 'Non_Compliance_Report'+suffix);
          break;
        }
 
        case 'intake_referrals': {
          const fi = applyFilters(intake, 'date_received');
          const data = fi.map(r => ({
            'Date Received': fmtDate(r.date_received),
            'Patient Name': r.patient_name || '',
            'Status': r.referral_status || '',
            'Referral Type': r.referral_type || '',
            'Region': r.region || '',
            'Regional Manager': REGIONAL_MANAGERS[r.region] || '—',
            'Insurance': r.insurance || '',
            'Policy Number': r.policy_number || '',
            'Diagnosis': r.diagnosis || '',
            'Denial Reason': r.denial_reason || '',
            'PCP Name': r.pcp_name || '',
            'PCP Phone': r.pcp_phone || '',
            'Referral Source': r.referral_source || '',
            'Chart Status': r.chart_status || '',
            'DOB': fmtDate(r.dob),
            'Phone': r.phone || r.contact_number || '',
            'City': r.city || '',
            'Zip': r.zip_code || '',
          })).sort((a,b) => a['Date Received'].localeCompare(b['Date Received']));
          format === 'xlsx' ? exportXLSX(data, 'Intake Referrals', 'Intake_Referrals'+suffix) : exportCSV(data, 'Intake_Referrals'+suffix);
          break;
        }
 
        case 'auth_status': {
          const fa = applyFilters(auth, 'created_at');
          const data = fa.map(a => ({
            'Patient Name': a.patient_name || '',
            'Region': a.region || '',
            'Regional Manager': REGIONAL_MANAGERS[a.region] || '—',
            'Insurance': a.insurance || '',
            'Auth Number': a.auth_number || '',
            'Auth Status': a.auth_status || '',
            'Visits Authorized': a.visits_authorized || 24,
            'Visits Used': a.visits_used || 0,
            'Visits Remaining': (a.visits_authorized||24)-(a.visits_used||0),
            'SOC Date': fmtDate(a.soc_date),
            'Auth Expiry': fmtDate(a.auth_expiry_date),
            'Days Until Expiry': a.auth_expiry_date ? Math.round((new Date(a.auth_expiry_date)-new Date())/86400000) : '',
            'Alert - Low Visits': a.alert_low_visits ? 'YES' : '',
            'Alert - Expiring': a.alert_expiring ? 'YES' : '',
            'PCP Name': a.pcp_name || '',
            'Denial Reason': a.denial_reason || '',
          })).sort((a,b) => (a['Days Until Expiry']||999) - (b['Days Until Expiry']||999));
          format === 'xlsx' ? exportXLSX(data, 'Auth Status', 'Auth_Status_Report'+suffix) : exportCSV(data, 'Auth_Status_Report'+suffix);
          break;
        }
 
        case 'revenue_by_region': {
          const fv = applyFilters(visits);
          const regionMap = {};
          const evalSeen = new Set();
          fv.forEach(v => {
            if (isCancelled(v.event_type,v.status)) { 
              const k = v.region||'Unknown';
              if (!regionMap[k]) regionMap[k] = { completed:0, cancelled:0, missed:0, scheduled:0 };
              regionMap[k].cancelled++;
              return;
            }
            const k = v.region||'Unknown';
            if (!regionMap[k]) regionMap[k] = { completed:0, cancelled:0, missed:0, scheduled:0 };
            if (isEval(v.event_type)) {
              const ek = `${v.patient_name}||${v.visit_date}`;
              if (evalSeen.has(ek)) return; evalSeen.add(ek);
            }
            if (isCompleted(v.status)) regionMap[k].completed++;
            else if (/missed/i.test(v.status||'')) regionMap[k].missed++;
            else if (/scheduled/i.test(v.status||'')) regionMap[k].scheduled++;
          });
          const data = Object.entries(regionMap)
            .filter(([r]) => regionFilter==='ALL' || r===regionFilter)
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([region,v]) => ({
              'Region': region,
              'Regional Manager': REGIONAL_MANAGERS[region] || '—',
              'Completed Visits': v.completed,
              'Scheduled Visits': v.scheduled,
              'Cancelled Visits': v.cancelled,
              'Missed Visits': v.missed,
              'Revenue Earned ($)': v.completed * RATE,
              'Revenue Pipeline ($)': v.scheduled * RATE,
              'Revenue Lost ($)': (v.cancelled + v.missed) * RATE,
            }));
          format === 'xlsx' ? exportXLSX(data, 'Revenue by Region', 'Revenue_By_Region'+suffix) : exportCSV(data, 'Revenue_By_Region'+suffix);
          break;
        }
 
        case 'clinician_productivity': {
          const fv = applyFilters(visits);
          const clinMap = {};
          fv.forEach(v => {
            const k = v.staff_name||'Unknown';
            if (!clinMap[k]) clinMap[k] = { completed:0, cancelled:0, missed:0, region:v.region||'' };
            if (isCancelled(v.event_type,v.status)) clinMap[k].cancelled++;
            else if (isCompleted(v.status)) clinMap[k].completed++;
            else if (/missed/i.test(v.status||'')) clinMap[k].missed++;
          });
          // Enrich with clinician DB data
          const clinDB = {};
          clinicians.forEach(c => { clinDB[(c.pariox_name||c.full_name||'').toLowerCase()] = c; });
          const data = Object.entries(clinMap)
            .filter(([,v]) => regionFilter==='ALL' || v.region===regionFilter)
            .map(([name,v]) => {
              const dbMatch = clinDB[name.toLowerCase()] || {};
              const target = dbMatch.weekly_visit_target || 25;
              return {
                'Clinician Name': name,
                'Region': v.region,
                'Regional Manager': REGIONAL_MANAGERS[v.region] || '—',
                'Discipline': dbMatch.discipline || '—',
                'Employment Type': dbMatch.employment_type || '—',
                'Completed Visits': v.completed,
                'Cancelled Visits': v.cancelled,
                'Missed Visits': v.missed,
                'Weekly Target': target,
                'Revenue Contribution ($)': v.completed * RATE,
              };
            })
            .sort((a,b) => b['Completed Visits'] - a['Completed Visits']);
          format === 'xlsx' ? exportXLSX(data, 'Clinician Productivity', 'Clinician_Productivity'+suffix) : exportCSV(data, 'Clinician_Productivity'+suffix);
          break;
        }
 
        case 'expiring_auths': {
          const today_d = new Date();
          const d30 = new Date(); d30.setDate(d30.getDate()+30);
          const data = auth
            .filter(a => {
              if (regionFilter !== 'ALL' && a.region !== regionFilter) return false;
              const remaining = (a.visits_authorized||24)-(a.visits_used||0);
              const daysLeft = a.auth_expiry_date ? Math.round((new Date(a.auth_expiry_date)-today_d)/86400000) : null;
              return remaining <= 5 || (daysLeft !== null && daysLeft <= 30 && daysLeft >= 0);
            })
            .map(a => {
              const remaining = (a.visits_authorized||24)-(a.visits_used||0);
              const daysLeft = a.auth_expiry_date ? Math.round((new Date(a.auth_expiry_date)-today_d)/86400000) : null;
              return {
                'Patient Name': a.patient_name || '',
                'Region': a.region || '',
                'Regional Manager': REGIONAL_MANAGERS[a.region] || '—',
                'Insurance': a.insurance || '',
                'Auth Number': a.auth_number || '',
                'Auth Status': a.auth_status || '',
                'Visits Remaining': remaining,
                'Auth Expiry Date': fmtDate(a.auth_expiry_date),
                'Days Until Expiry': daysLeft ?? 'N/A',
                'Priority': remaining <= 2 || daysLeft <= 7 ? 'HIGH' : 'MEDIUM',
                'PCP Name': a.pcp_name || '',
                'PCP Phone': a.pcp_phone || '',
                'Action Required': remaining <= 5 ? 'Submit renewal auth' : 'Auth expiring soon',
              };
            })
            .sort((a,b) => (a['Days Until Expiry']||0) - (b['Days Until Expiry']||0));
          format === 'xlsx' ? exportXLSX(data, 'Expiring Auths', 'Expiring_Authorizations'+suffix) : exportCSV(data, 'Expiring_Authorizations'+suffix);
          break;
        }
 
        case 'regional_manager_summary': {
          const data = census
            .filter(c => regionFilter==='ALL' || c.region===regionFilter)
            .map(c => {
              const patAuth = auth.find(a => a.patient_name?.toLowerCase().trim() === c.patient_name?.toLowerCase().trim());
              const patVisits = visits.filter(v => v.patient_name?.toLowerCase().trim() === c.patient_name?.toLowerCase().trim());
              const completed = patVisits.filter(v => isCompleted(v.status) && !isCancelled(v.event_type,v.status)).length;
              const cancelled = patVisits.filter(v => isCancelled(v.event_type,v.status)).length;
              return {
                'Region': c.region || '—',
                'Regional Manager': REGIONAL_MANAGERS[c.region] || '—',
                'Patient Name': c.patient_name || '',
                'Insurance': c.insurance || '',
                'Status': c.status || '',
                'Completed Visits': completed,
                'Cancelled Visits': cancelled,
                'Auth Status': patAuth?.auth_status || '—',
                'Visits Remaining': patAuth ? (patAuth.visits_authorized||24)-(patAuth.visits_used||0) : '—',
                'Auth Expiry': fmtDate(patAuth?.auth_expiry_date),
              };
            })
            .sort((a,b) => a['Region'].localeCompare(b['Region']) || a['Patient Name'].localeCompare(b['Patient Name']));
          format === 'xlsx' ? exportXLSX(data, 'RM Summary', 'Regional_Manager_Summary'+suffix) : exportCSV(data, 'Regional_Manager_Summary'+suffix);
          break;
        }
 
        case 'frequency_review': {
          // Fetch clinical settings for frequency data
          const { data: clinSettings } = await supabase.from('patient_clinical_settings').select('*');
          const freqMap = {};
          (clinSettings || []).forEach(s => { freqMap[s.patient_name] = s; });

          const activePts = census.filter(p => p.status === 'Active' || (p.status || '').startsWith('Active'));
          const now = Date.now();
          const freqRows = activePts.map(p => {
            const cs = freqMap[p.patient_name] || {};
            const ptVisits = visits.filter(v => v.patient_name === p.patient_name);
            const completed = ptVisits.filter(v => isCompleted(v.status));
            const lastVisit = completed.length > 0 ? completed.sort((a,b) => (b.visit_date||'').localeCompare(a.visit_date||''))[0] : null;
            const daysSince = lastVisit?.visit_date ? Math.floor((now - new Date(lastVisit.visit_date + 'T00:00:00').getTime()) / 86400000) : null;
            const ptAuth = auth.filter(a => a.patient_name === p.patient_name && (a.auth_status === 'active' || a.auth_status === 'approved'));
            const latestAuth = ptAuth.sort((a,b) => (b.auth_expiry_date||'').localeCompare(a.auth_expiry_date||''))[0];
            return {
              'Patient Name': p.patient_name,
              'Region': p.region || '',
              'Insurance': p.insurance || '',
              'Visit Frequency': cs.visit_frequency || 'Not Set',
              'Visits Used': latestAuth?.visits_used || 0,
              'Visits Authorized': latestAuth?.visits_authorized || 0,
              'Remaining': (latestAuth?.visits_authorized || 0) - (latestAuth?.visits_used || 0),
              'Last Visit Date': lastVisit?.visit_date ? fmtDate(lastVisit.visit_date) : 'Never',
              'Days Since Last Visit': daysSince !== null ? daysSince : 'N/A',
              'Auth Expires': latestAuth?.auth_expiry_date ? fmtDate(latestAuth.auth_expiry_date) : '',
              'Status': daysSince !== null && daysSince > 14 ? 'OVERDUE' : daysSince !== null && daysSince > 7 ? 'DUE SOON' : 'OK',
              'Clinician': lastVisit?.clinician_name || '',
            };
          }).sort((a,b) => {
            const order = { 'OVERDUE': 0, 'DUE SOON': 1, 'OK': 2 };
            return (order[a.Status] ?? 3) - (order[b.Status] ?? 3);
          });

          if (freqRows.length === 0) { alert('No active patients found for frequency review.'); break; }
          format === 'xlsx' ? exportXLSX(freqRows, 'Frequency Review', 'Frequency_Review_Queue'+suffix) : exportCSV(freqRows, 'Frequency_Review_Queue'+suffix);
          break;
        }

        case 'patient_census': {
          // Template download — blank Pariox-format upload sheet (matches UploadsPage parser exactly)
          if (format === 'template') {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([
              ['Patient Name','Address','Discipline','Ref Source','Region','SOC','Insurance','Status'],
              ['Doe, Jane A','123 Main St, Orlando FL 32801','PT','Hospital ABC','A','2026-01-15','Medicare','Active'],
              ['Smith, John B','456 Oak Ave, Tampa FL 33602','OT','Dr. Garcia','C','2026-02-20','Humana','SOC Pending'],
            ]);
            ws['!cols'] = [{wch:24},{wch:36},{wch:12},{wch:22},{wch:8},{wch:12},{wch:18},{wch:14}];
            const inst = XLSX.utils.aoa_to_sheet([
              ['Census Bulk Upload Template — Instructions'],
              [''],
              ['Column order MUST match the Pariox export format. The Census tab has the correct headers and 2 example rows.'],
              ['Header row is required (row 1). Data starts on row 2.'],
              [''],
              ['Column','Field','Required','Notes'],
              ['A','Patient Name','Yes','Format: "LastName, FirstName Middle"'],
              ['B','Address','No','Free text'],
              ['C','Discipline','No','PT / OT / ST / SN / etc.'],
              ['D','Ref Source','No','Referring provider or facility'],
              ['E','Region','Yes','Single letter (A, B, C, G, H, J, M, N, T, V)'],
              ['F','SOC','No','Start of Care date — informational only, not parsed'],
              ['G','Insurance','No','Payor name'],
              ['H','Status','Yes','Active / SOC Pending / Eval Pending / On Hold / Discharge / Waitlist / Auth Pending'],
              [''],
              ['To upload: go to Uploads → Patient Census card → drop this file. The system will diff against the prior snapshot and log status changes automatically.'],
            ]);
            inst['!cols'] = [{wch:10},{wch:18},{wch:10},{wch:60}];
            XLSX.utils.book_append_sheet(wb, inst, 'Instructions');
            XLSX.utils.book_append_sheet(wb, ws, 'Census');
            XLSX.writeFile(wb, 'Census_Upload_Template.xlsx');
            break;
          }
 
          // Lazy-fetch patient_master for status drift detection (paginated)
          const master = await fetchAllPages(
            supabase.from('patient_master')
              .select('patient_key, current_status, previous_status, status_changed_at, has_been_active, has_been_discharged, total_referrals, last_discharge_date')
          );
          const masterMap = {};
          master.forEach(m => { if (m.patient_key) masterMap[m.patient_key] = m; });
 
          const fc = census.filter(c => regionFilter==='ALL' || c.region===regionFilter);
 
          const rows = fc.map(c => {
            const m = masterMap[c.patient_key] || {};
            return {
              'Patient Name': c.patient_name || '',
              'Patient Key': c.patient_key || '',
              'Region': c.region || '',
              'Regional Manager': REGIONAL_MANAGERS[c.region] || '—',
              'Insurance': c.insurance || '',
              'Status': c.status || '',
              'Master Status': m.current_status || '',
              'Previous Status': c.previous_status || m.previous_status || '',
              'Status Changed': c.status_changed_at ? new Date(c.status_changed_at).toLocaleString() : '',
              'Discipline': c.discipline || '',
              'Referral Source': c.ref_source || '',
              'Address': c.address || '',
              'First Seen': fmtDate(c.first_seen_date),
              'Last Seen': fmtDate(c.last_seen_date),
              'Last Visit': fmtDate(c.last_visit_date),
              'Last Visit Clinician': c.last_visit_clinician || '',
              'Last Visit Type': c.last_visit_type || '',
              'Days Since Last Visit': c.days_since_last_visit ?? '',
              'Has Wound': c.has_wound ? 'Yes' : 'No',
              'Wound Type': c.wound_type || '',
              'Target Start': fmtDate(c.target_start_date),
              'Pipeline Assigned To': c.pipeline_assigned_to || '',
              'Pipeline Notes': c.pipeline_notes || '',
              'Total Referrals': m.total_referrals ?? '',
              'Ever Active': m.has_been_active ? 'Yes' : 'No',
              'Ever Discharged': m.has_been_discharged ? 'Yes' : 'No',
              'Last Discharge': fmtDate(m.last_discharge_date),
              'Snapshot Uploaded': c.uploaded_at ? new Date(c.uploaded_at).toLocaleString() : '',
            };
          }).sort((a,b) => (a.Region||'').localeCompare(b.Region||'') || (a.Status||'').localeCompare(b.Status||'') || a['Patient Name'].localeCompare(b['Patient Name']));
 
          if (format === 'csv') {
            exportCSV(rows, 'Patient_Census'+suffix);
            break;
          }
 
          // Multi-sheet XLSX
          const wb = XLSX.utils.book_new();
 
          // Summary sheet
          const statusCounts = {};
          const regionCounts = {};
          rows.forEach(r => {
            statusCounts[r.Status||'(blank)'] = (statusCounts[r.Status||'(blank)']||0) + 1;
            regionCounts[r.Region||'(blank)'] = (regionCounts[r.Region||'(blank)']||0) + 1;
          });
          const driftRows = rows.filter(r => r['Master Status'] && (r.Status||'').toLowerCase() !== (r['Master Status']||'').toLowerCase());
          const summary = [
            ['EdemaCare Patient Census Export'],
            ['Generated', new Date().toLocaleString()],
            ['Source', 'census_data (latest snapshot) joined to patient_master'],
            ['Region Filter', regionFilter],
            ['Total Patients', rows.length],
            ['Active Patients', rows.filter(r => (r.Status||'').toLowerCase()==='active').length],
            ['Status Drift Cases', driftRows.length],
            [''],
            ['By Status', 'Count'],
            ...Object.entries(statusCounts).sort((a,b) => b[1]-a[1]).map(([s,n]) => [s,n]),
            [''],
            ['By Region','Count'],
            ...Object.entries(regionCounts).sort().map(([r,n]) => [r,n]),
          ];
          const sumWs = XLSX.utils.aoa_to_sheet(summary);
          sumWs['!cols'] = [{wch:32},{wch:14}];
          XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');
 
          // Full Census
          const fullWs = XLSX.utils.json_to_sheet(rows);
          fullWs['!cols'] = Object.keys(rows[0]||{}).map(k => ({ wch: Math.max(k.length, 14) }));
          XLSX.utils.book_append_sheet(wb, fullWs, 'Full Census');
 
          // Active Only
          const activeRows = rows.filter(r => (r.Status||'').toLowerCase()==='active');
          if (activeRows.length) {
            const actWs = XLSX.utils.json_to_sheet(activeRows);
            actWs['!cols'] = Object.keys(activeRows[0]).map(k => ({ wch: Math.max(k.length, 14) }));
            XLSX.utils.book_append_sheet(wb, actWs, 'Active Only');
          }
 
          // Status Drift Audit — patients where census snapshot and patient_master disagree
          if (driftRows.length) {
            const driftWs = XLSX.utils.json_to_sheet(driftRows.map(r => ({
              'Patient Name': r['Patient Name'],
              'Region': r.Region,
              'Census Status': r.Status,
              'Master Status': r['Master Status'],
              'Previous Status': r['Previous Status'],
              'Status Changed': r['Status Changed'],
              'Last Visit': r['Last Visit'],
              'Days Since Last Visit': r['Days Since Last Visit'],
            })));
            driftWs['!cols'] = [{wch:24},{wch:8},{wch:18},{wch:18},{wch:18},{wch:20},{wch:14},{wch:12}];
            XLSX.utils.book_append_sheet(wb, driftWs, 'Status Drift Audit');
          }
 
          XLSX.writeFile(wb, 'Patient_Census'+suffix+'.xlsx');
          break;
        }

        // ──────────────────────────────────────────────────────────────────
        // 2026-05-17 consolidation: 14 dept reports + Missed/Cancelled moved
        // from DepartmentReportsPage. Internal helpers below — note these
        // intentionally bypass the page-level region/date filters because
        // each report has its own scoping logic (e.g., "last 7 days", "active
        // patients only"). If you want to layer the page filters on top, add
        // applyFilters(...) inside each case.
        // ──────────────────────────────────────────────────────────────────

        // ── AUTHORIZATION DEPARTMENT ─────────────────────────────────────
        case 'auth_all': {
          const data = auth.filter(a => a.is_currently_active).map(a => ({
            'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
            'PPO?': a.is_ppo === true ? 'YES' : a.is_ppo === false ? 'NO' : '',
            'Auth Status': a.auth_status, 'SOC': fmtDate(a.soc_date),
            'Auth Start': fmtDate(a.auth_start_date), 'Auth End': fmtDate(a.auth_expiry_date),
            'Visits Auth': a.visits_authorized, 'Visits Used': a.visits_used,
            'Visits Remaining': (a.visits_authorized || 0) - (a.visits_used || 0),
            'Evals Auth': a.evals_authorized, 'Evals Used': a.evals_used,
            'RAs Auth': a.reassessments_authorized, 'RAs Used': a.reassessments_used,
            'Scheduled?': a.is_scheduled === true ? 'YES' : a.is_scheduled === false ? 'NO' : '',
            'Assigned To': a.assigned_to, 'Notes': a.notes,
          }));
          format === 'xlsx' ? exportXLSX(data, 'Active Authorizations', 'Active_Authorizations'+suffix) : exportCSV(data, 'Active_Authorizations'+suffix);
          break;
        }

        case 'auth_pending_active': {
          const data = census.filter(c => c.status === 'Active - Auth Pending').map(c => {
            const days = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
            return {
              'Patient': c.patient_name, 'Region': c.region, 'Insurance': c.insurance,
              'Frequency': c.inferred_frequency, 'Days Pending': days,
              'Owner': c.pipeline_assigned_to || 'unassigned',
            };
          });
          format === 'xlsx' ? exportXLSX(data, 'Active Auth Pending', 'Active_Auth_Pending'+suffix) : exportCSV(data, 'Active_Auth_Pending'+suffix);
          break;
        }

        case 'auth_stalled': {
          const data = auth.filter(a => a.is_currently_active && /^(submitted|pending)$/i.test(a.auth_status || '') && a.auth_submitted_date)
            .map(a => {
              const days = Math.ceil((Date.now() - new Date(a.auth_submitted_date).getTime()) / 86400000);
              return { a, days };
            })
            .filter(x => x.days > 5)
            .map(({a, days}) => ({
              'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
              'Submitted': fmtDate(a.auth_submitted_date), 'Days Stalled': days,
              'Assigned To': a.assigned_to || 'unassigned', 'Notes': a.notes,
            })).sort((x,y) => y['Days Stalled'] - x['Days Stalled']);
          format === 'xlsx' ? exportXLSX(data, 'Stalled Auths', 'Stalled_Auths'+suffix) : exportCSV(data, 'Stalled_Auths'+suffix);
          break;
        }

        case 'auth_ppo': {
          const data = auth.filter(a => a.is_currently_active && (a.is_ppo === true || (a.insurance_type && /ppo/i.test(a.insurance_type))))
            .map(a => ({
              'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
              'Insurance Type': a.insurance_type || '—',
              'PPO Source': a.is_ppo === true ? 'audit' : 'insurance_type',
              'Auth Status': a.auth_status, 'Visits Auth': a.visits_authorized, 'Visits Used': a.visits_used,
              'Auth Expires': fmtDate(a.auth_expiry_date), 'Assigned To': a.assigned_to,
            }));
          format === 'xlsx' ? exportXLSX(data, 'PPO Patients', 'PPO_Patients'+suffix) : exportCSV(data, 'PPO_Patients'+suffix);
          break;
        }

        case 'auth_renewal': {
          const thirty = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          const data = auth.filter(a => a.is_currently_active && a.auth_expiry_date && a.auth_expiry_date <= thirty)
            .map(a => {
              const d = Math.ceil((new Date(a.auth_expiry_date).getTime() - Date.now()) / 86400000);
              return {
                'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
                'Expires': fmtDate(a.auth_expiry_date), 'Days Left': d,
                'Visits Remaining': (a.visits_authorized || 0) - (a.visits_used || 0),
                'Assigned To': a.assigned_to,
              };
            }).sort((x,y) => x['Days Left'] - y['Days Left']);
          format === 'xlsx' ? exportXLSX(data, 'Renewal Pipeline', 'Renewal_Pipeline'+suffix) : exportCSV(data, 'Renewal_Pipeline'+suffix);
          break;
        }

        // ── CARE COORDINATION DEPARTMENT ─────────────────────────────────
        case 'cc_not_scheduled': {
          // Active patients minus those with non-cancelled visits in next 14d
          const today = new Date().toISOString().slice(0, 10);
          const in14d = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
          const scheduled = new Set();
          visits.forEach(v => {
            if (!v.visit_date || v.visit_date < today || v.visit_date > in14d) return;
            if (isCancelled(v.event_type, v.status)) return;
            if (/attempted/i.test(v.event_type || '')) return;
            scheduled.add((v.patient_name || '').toLowerCase().trim());
          });
          const excludeStatuses = ['Discharge','Discharge - Change Insurance','Discharged','Non-Admit','Non-admit','On Hold','On Hold - Facility','On Hold - Pt Request','On Hold - MD Request','Hospitalized','Waitlist','SOC Pending','Eval Pending'];
          const authMap = {};
          auth.filter(a => a.is_currently_active).forEach(a => { authMap[(a.patient_name||'').toLowerCase().trim() + '|' + a.region] = a; });
          const data = census.filter(c => c.status && !excludeStatuses.includes(c.status))
            .filter(c => !scheduled.has((c.patient_name||'').toLowerCase().trim()))
            .map(c => {
              const a = authMap[(c.patient_name||'').toLowerCase().trim() + '|' + c.region] || {};
              return {
                'Patient': c.patient_name, 'Region': c.region, 'Insurance': c.insurance,
                'Status': c.status, 'Frequency': c.inferred_frequency || 'missing',
                'Audit Flag (SCHEDULED?)': a.is_scheduled === false ? 'NO' : a.is_scheduled === true ? 'YES (conflict)' : 'not audited',
                'Care Coord Owner': c.pipeline_assigned_to || 'unassigned',
                'Auth Coord': a.assigned_to || '—',
              };
            }).sort((x,y) => (x.Region||'').localeCompare(y.Region||'') || x.Patient.localeCompare(y.Patient));
          format === 'xlsx' ? exportXLSX(data, 'Not Scheduled', 'Not_Scheduled'+suffix) : exportCSV(data, 'Not_Scheduled'+suffix);
          break;
        }

        case 'cc_frequency_missing': {
          // Scoped to truly-active patients only (matches the FrequencyReviewPage
          // UI scope). Stale flags on Discharge/On Hold patients are auto-cleared
          // by the trg_auto_clear_freq_review trigger as of 2026-05-17.
          const data = census.filter(c => {
            const s = (c.status || '').toLowerCase();
            if (!s.startsWith('active')) return false;
            return !c.inferred_frequency || c.needs_frequency_review;
          }).map(c => ({
            'Patient': c.patient_name, 'Region': c.region, 'Status': c.status,
            'Current Frequency': c.inferred_frequency || 'MISSING',
            'Needs Review?': c.needs_frequency_review ? 'YES' : 'NO',
            'Owner': c.pipeline_assigned_to || 'unassigned',
          })).sort((x,y) => (x.Region||'').localeCompare(y.Region||''));
          format === 'xlsx' ? exportXLSX(data, 'Frequency Review', 'Frequency_Review'+suffix) : exportCSV(data, 'Frequency_Review'+suffix);
          break;
        }

        case 'cc_notes_log': {
          const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
          const data = careCoordNotes.filter(n => n.contact_date && n.contact_date >= since).map(n => ({
            'Date': fmtDate(n.contact_date), 'Patient': n.patient_name, 'Region': n.region,
            'Note Type': n.note_type, 'Note': n.note, 'Logged By': n.updated_by,
          }));
          format === 'xlsx' ? exportXLSX(data, 'CC Notes Log', 'CC_Notes_Log'+suffix) : exportCSV(data, 'CC_Notes_Log'+suffix);
          break;
        }

        case 'cc_on_hold_waitlist': {
          const holdStatuses = ['On Hold','On Hold - Facility','On Hold - Pt Request','On Hold - MD Request','Waitlist'];
          const data = census.filter(c => holdStatuses.includes(c.status)).map(c => {
            const d = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
            return {
              'Patient': c.patient_name, 'Region': c.region, 'Insurance': c.insurance,
              'Status': c.status, 'Days In Status': d,
              'Owner': c.pipeline_assigned_to || 'unassigned',
            };
          }).sort((x,y) => (y['Days In Status']||0) - (x['Days In Status']||0));
          format === 'xlsx' ? exportXLSX(data, 'On Hold + Waitlist', 'OnHold_Waitlist'+suffix) : exportCSV(data, 'OnHold_Waitlist'+suffix);
          break;
        }

        // ── CLINICAL DEPARTMENT ──────────────────────────────────────────
        case 'clinical_discipline': {
          const excludeStatuses = ['Discharge','Discharge - Change Insurance','Discharged','Non-Admit','Non-admit'];
          const activeCensus = census.filter(c => !excludeStatuses.includes(c.status));
          // Multi-sheet: summary + all patients
          const summary = {};
          activeCensus.forEach(c => {
            const k = c.region + '|' + (c.discipline || 'UNKNOWN');
            summary[k] = (summary[k] || 0) + 1;
          });
          const summaryRows = Object.entries(summary).map(([k, count]) => {
            const [region, disc] = k.split('|');
            return { 'Region': region, 'Discipline': disc, 'Count': count };
          }).sort((a, b) => (a.Region||'').localeCompare(b.Region||'') || (a.Discipline||'').localeCompare(b.Discipline||''));
          const detailRows = activeCensus.map(c => ({
            'Patient': c.patient_name, 'Region': c.region, 'Discipline': c.discipline || '—',
            'Status': c.status, 'Insurance': c.insurance,
          }));
          if (format === 'xlsx') {
            const wb = XLSX.utils.book_new();
            const ws1 = XLSX.utils.json_to_sheet(summaryRows);
            XLSX.utils.book_append_sheet(wb, ws1, 'Summary by Region');
            const ws2 = XLSX.utils.json_to_sheet(detailRows);
            XLSX.utils.book_append_sheet(wb, ws2, 'All Patients');
            XLSX.writeFile(wb, 'Discipline_Breakdown'+suffix+'.xlsx');
          } else {
            exportCSV(detailRows, 'Discipline_Breakdown'+suffix);
          }
          break;
        }

        case 'clinical_high_risk': {
          // High Risk Patients report — uses patient_risk_factors. Two sheets in XLSX:
          //   Sheet 1: LOC 4+5 (the critical watchlist Liam reviews first)
          //   Sheet 2: All patients on watchlist (sorted by CareMap desc)
          const tierOf = (loc) => {
            if (loc === 5) return 'Critical (LOC 5)';
            if (loc === 4) return 'High (LOC 4)';
            if (loc === 3) return 'Moderate (LOC 3)';
            if (loc === 2) return 'Mild (LOC 2)';
            if (loc === 1) return 'Low (LOC 1)';
            return 'No CareMap';
          };
          const mapRow = (r) => ({
            'Patient': r.patient_name,
            'Region': r.region || '',
            'Health Plan': r.health_plan || '',
            'CareMap Score': r.caremap_score ?? '',
            'LOC Level': r.loc_level ?? '',
            'LOC Tier': tierOf(r.loc_level),
            'Wounds': r.has_wounds ? 'Yes' : 'No',
            '3+ Comorbidities': r.comorbidities_3plus ? 'Yes' : 'No',
            'Falls (6mo)': r.falls_6mo ? 'Yes' : 'No',
            'Compliance Score': r.compliance_score ?? '',
            'High Compliance Risk (>8)': r.high_compliance_risk ? 'Yes' : 'No',
            'Environmental Score': r.environmental_score ?? '',
            'High Environmental Risk (>12)': r.high_environmental_risk ? 'Yes' : 'No',
            'Last Reassessment': r.last_reassessment_date || '',
            'Comments': r.comments || '',
          });
          const scoped = regionFilter === 'ALL' ? highRisk : highRisk.filter(r => r.region === regionFilter);
          const sortFn = (a, b) => (b.caremap_score ?? -1) - (a.caremap_score ?? -1);
          const high = scoped.filter(r => r.loc_level === 4 || r.loc_level === 5).sort(sortFn).map(mapRow);
          const all = [...scoped].sort(sortFn).map(mapRow);
          if (format === 'xlsx') {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(high), 'LOC 4 + 5');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all),  'All Watchlist');
            // Summary sheet — counts by LOC level and region
            const summary = [];
            for (const loc of [5, 4, 3, 2, 1, null]) {
              const set = scoped.filter(r => r.loc_level === loc);
              summary.push({
                'LOC Level': loc ?? 'No CareMap',
                'Tier': tierOf(loc),
                'Patient Count': set.length,
                'With Wounds': set.filter(r => r.has_wounds).length,
                'With 3+ Comorbidities': set.filter(r => r.comorbidities_3plus).length,
                'With Falls (6mo)': set.filter(r => r.falls_6mo).length,
                'High Compliance Risk': set.filter(r => r.high_compliance_risk).length,
                'High Environmental Risk': set.filter(r => r.high_environmental_risk).length,
              });
            }
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary by LOC');
            XLSX.writeFile(wb, 'High_Risk_Patients' + suffix + '.xlsx');
          } else {
            exportCSV(all, 'High_Risk_Patients' + suffix);
          }
          break;
        }

        case 'clinical_eval_pending': {
          const data = census.filter(c => c.status === 'Eval Pending').map(c => {
            const d = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
            return {
              'Patient': c.patient_name, 'Region': c.region, 'Discipline': c.discipline,
              'Insurance': c.insurance, 'Days Waiting': d,
              'Past 48h SLA?': d > 2 ? 'YES' : 'NO',
              'Owner': c.pipeline_assigned_to || 'unassigned',
            };
          }).sort((x,y) => (y['Days Waiting']||0) - (x['Days Waiting']||0));
          format === 'xlsx' ? exportXLSX(data, 'Eval Pending', 'Eval_Pending'+suffix) : exportCSV(data, 'Eval_Pending'+suffix);
          break;
        }

        // ── INTAKE DEPARTMENT ────────────────────────────────────────────
        case 'intake_this_week': {
          const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
          const data = intake.filter(r => r.date_received >= weekAgo).map(r => ({
            'Date Received': fmtDate(r.date_received), 'Patient': r.patient_name, 'Region': r.region,
            'Insurance': r.insurance, 'Referral Status': r.referral_status,
            'Welcome Call': r.welcome_call || 'Not Called',
            'First Appt': r.first_appt || '—', 'Chart Status': r.chart_status || '—',
          })).sort((x,y) => (y['Date Received']||'').localeCompare(x['Date Received']||''));
          format === 'xlsx' ? exportXLSX(data, 'This Week Referrals', 'This_Weeks_Referrals'+suffix) : exportCSV(data, 'This_Weeks_Referrals'+suffix);
          break;
        }

        case 'intake_ref_sources': {
          const summary = {};
          intake.forEach(r => {
            const k = r.region + '|' + (r.insurance || 'UNKNOWN');
            if (!summary[k]) summary[k] = { region: r.region, insurance: r.insurance, total: 0, accepted: 0, denied: 0 };
            summary[k].total++;
            if (r.referral_status === 'Accepted') summary[k].accepted++;
            if (r.referral_status === 'Denied') summary[k].denied++;
          });
          const data = Object.values(summary).map(s => ({
            'Region': s.region, 'Insurance': s.insurance, 'Total Referrals': s.total,
            'Accepted': s.accepted, 'Denied': s.denied,
            'Acceptance Rate %': s.total > 0 ? Math.round(s.accepted / s.total * 100) : 0,
          })).sort((x,y) => y['Total Referrals'] - x['Total Referrals']);
          format === 'xlsx' ? exportXLSX(data, 'Referral Sources', 'Referral_Sources'+suffix) : exportCSV(data, 'Referral_Sources'+suffix);
          break;
        }

        // ── OPERATIONS (cross-dept) ──────────────────────────────────────
        case 'ops_master': {
          const authMap = {};
          auth.filter(a => a.is_currently_active).forEach(a => { authMap[(a.patient_name||'').toLowerCase().trim() + '|' + a.region] = a; });
          const data = census.map(c => {
            const a = authMap[(c.patient_name||'').toLowerCase().trim() + '|' + c.region] || {};
            return {
              'Patient': c.patient_name, 'Region': c.region, 'Address': c.address,
              'Disc': c.discipline, 'Ref Source': c.ref_source, 'Insurance': c.insurance,
              'SOC': fmtDate(a.soc_date), 'PPO?': a.is_ppo === true ? 'YES' : a.is_ppo === false ? 'NO' : '',
              'AUTH START DATE': fmtDate(a.auth_start_date), 'AUTH END DATE': fmtDate(a.auth_expiry_date),
              'APPROVED # VISITS': a.visits_authorized,
              'APPROVED # EVALS': a.evals_authorized,
              'APPROVED # RAs': a.reassessments_authorized,
              'NOTES': a.notes, 'Status': c.status,
              'SCHEDULED?': a.is_scheduled === true ? 'YES' : a.is_scheduled === false ? 'NO' : '',
              'FREQUENCY': c.inferred_frequency,
              'Auth Coord': a.assigned_to, 'Care Coord': c.pipeline_assigned_to,
            };
          });
          format === 'xlsx' ? exportXLSX(data, 'Patient Master', 'Full_Patient_Master'+suffix) : exportCSV(data, 'Full_Patient_Master'+suffix);
          break;
        }

        case 'ops_stuck': {
          function stageFor(s) {
            if (/soc.*pending/i.test(s)) return { label: 'SOC Pending', threshold: 3, owner: 'Auth Team' };
            if (/auth.*pending/i.test(s) && !/active/i.test(s)) return { label: 'Auth Pending', threshold: 5, owner: 'Auth Team' };
            if (/eval.*pending/i.test(s)) return { label: 'Eval Pending', threshold: 2, owner: 'Care Coord' };
            return null;
          }
          const data = census.map(c => {
            const stage = stageFor(c.status || '');
            if (!stage) return null;
            const d = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
            if (d === null || d <= stage.threshold) return null;
            return {
              'Patient': c.patient_name, 'Region': c.region, 'Insurance': c.insurance,
              'Stage': stage.label, 'Days Stuck': d, 'Threshold': stage.threshold,
              'Owner Team': stage.owner,
              'Assigned': c.pipeline_assigned_to || 'unassigned',
            };
          }).filter(x => x !== null).sort((x,y) => y['Days Stuck'] - x['Days Stuck']);
          format === 'xlsx' ? exportXLSX(data, 'Stuck Patients', 'Stuck_Patients'+suffix) : exportCSV(data, 'Stuck_Patients'+suffix);
          break;
        }

        case 'ops_missed_cancelled': {
          // Replaces the standalone MissedCancelledReportPage
          const fv = applyFilters(visits);
          const data = fv.filter(v => {
            const s = (v.status||'').toLowerCase();
            const e = (v.event_type||'').toLowerCase();
            return s.includes('miss') || e.includes('cancel');
          }).map(v => {
            const cancelled = isCancelled(v.event_type, v.status);
            const missed = /missed/i.test(v.status||'') && !cancelled;
            return {
              'Visit Date': fmtDate(v.visit_date),
              'Patient': v.patient_name,
              'Region': v.region,
              'Clinician': v.staff_name,
              'Event Type': v.event_type,
              'Status': v.status,
              'Classification': cancelled ? 'Cancelled' : missed ? 'Missed' : 'Other',
              'Notes': v.notes || '',
            };
          }).sort((x,y) => (y['Visit Date']||'').localeCompare(x['Visit Date']||''));
          format === 'xlsx' ? exportXLSX(data, 'Missed & Cancelled', 'Missed_Cancelled'+suffix) : exportCSV(data, 'Missed_Cancelled'+suffix);
          break;
        }

        // ── NEW (2026-06-09): Documentation Lag Report ────────────────────
        // Catches the "visit happened but isn't marked Completed in Pariox yet"
        // pattern. We learned this matters the hard way when Monday 6/8 showed
        // $0 revenue on Director Command because 181 of 195 actual visits were
        // still status='Scheduled' from the clinician's lagging documentation.
        case 'ops_doc_lag': {
          const fv = applyFilters(visits);
          const today = new Date(); today.setHours(0,0,0,0);
          const tStr = today.toISOString().slice(0,10);

          // Apply the per-(patient,visit_date,staff) latest-uploaded_at dedup
          // (same rule as ProductivityPage — see CLAUDE.md #10).
          const latestByKey = new Map();
          fv.forEach(v => {
            const k = (v.patient_name||'') + '|' + (v.visit_date||'') + '|' + (v.staff_name||'');
            const existing = latestByKey.get(k);
            if (!existing || (v.uploaded_at && (!existing.uploaded_at || v.uploaded_at > existing.uploaded_at))) {
              latestByKey.set(k, v);
            }
          });
          const deduped = Array.from(latestByKey.values());

          // Lagging = visit_date in the past AND status='Scheduled' AND not a cancel
          const lagging = deduped.filter(v => {
            if (!v.visit_date || v.visit_date >= tStr) return false;
            if ((v.status||'').toLowerCase() !== 'scheduled') return false;
            if (isCancelled(v.event_type, v.status)) return false;
            return true;
          });

          // Summary: per clinician
          const byStaff = {};
          lagging.forEach(v => {
            const s = v.staff_name || 'UNKNOWN';
            if (!byStaff[s]) byStaff[s] = { rows: [], oldestDate: '9999-12-31' };
            byStaff[s].rows.push(v);
            if (v.visit_date < byStaff[s].oldestDate) byStaff[s].oldestDate = v.visit_date;
          });
          const summaryRows = Object.entries(byStaff).map(([staff, info]) => {
            const oldest = new Date(info.oldestDate + 'T00:00:00');
            const oldestLagDays = Math.floor((today - oldest) / 86400000);
            return {
              'Clinician': staff,
              'Lagging Visits': info.rows.length,
              'Revenue at Risk ($)': info.rows.length * RATE,
              'Oldest Lag (days)': oldestLagDays,
              'Oldest Visit Date': fmtDate(info.oldestDate),
              'Regions Affected': Array.from(new Set(info.rows.map(r => r.region).filter(Boolean))).sort().join(', '),
            };
          }).sort((a,b) => b['Lagging Visits'] - a['Lagging Visits']);

          // Detail: every lagging row
          const detailRows = lagging.map(v => {
            const days = Math.floor((today - new Date(v.visit_date + 'T00:00:00')) / 86400000);
            return {
              'Visit Date': fmtDate(v.visit_date),
              'Lag (days)': days,
              'Clinician': v.staff_name || '',
              'Patient': v.patient_name || '',
              'Region': v.region || '',
              'Discipline': v.discipline || '',
              'Event Type': v.event_type || '',
              'Status (current)': v.status || '',
              'Insurance': v.insurance || '',
              'Revenue if Completed ($)': RATE,
            };
          }).sort((a,b) => b['Lag (days)'] - a['Lag (days)']);

          const totalRevAtRisk = lagging.length * RATE;
          const totalsRow = [{
            'Report Date': fmtDate(tStr),
            'Total Lagging Visits': lagging.length,
            'Total Revenue at Risk ($)': totalRevAtRisk,
            'Clinicians Affected': Object.keys(byStaff).length,
            'Avg Lag (days)': lagging.length ? Math.round(lagging.reduce((s,v) => s + Math.floor((today - new Date(v.visit_date + 'T00:00:00'))/86400000), 0) / lagging.length) : 0,
          }];

          if (format === 'xlsx') {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(totalsRow), 'Headline');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'By Clinician');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Every Lagging Visit');
            XLSX.writeFile(wb, 'Documentation_Lag'+suffix+'.xlsx');
          } else {
            exportCSV(detailRows, 'Documentation_Lag'+suffix);
          }
          break;
        }

        // ── NEW (2026-06-09): Payer Performance Report ────────────────────
        // Per-payer revenue, visit volume, completion rate, auth metrics.
        // Strategic input for Yvonne's payer renegotiation conversations.
        case 'payer_performance': {
          const fv = applyFilters(visits);

          // Deduplicate visits the same way the dashboard does
          const latestByKey = new Map();
          fv.forEach(v => {
            const k = (v.patient_name||'') + '|' + (v.visit_date||'') + '|' + (v.staff_name||'');
            const existing = latestByKey.get(k);
            if (!existing || (v.uploaded_at && (!existing.uploaded_at || v.uploaded_at > existing.uploaded_at))) {
              latestByKey.set(k, v);
            }
          });
          const deduped = Array.from(latestByKey.values());

          // Aggregate visits by insurance — fall back to census insurance if visit row missing it
          const censusInsByPatient = new Map();
          census.forEach(c => { if (c.patient_name) censusInsByPatient.set(c.patient_name.trim(), c.insurance); });
          const payerStats = {};
          deduped.forEach(v => {
            const payer = (v.insurance || censusInsByPatient.get((v.patient_name||'').trim()) || 'Unknown').trim();
            if (!payerStats[payer]) {
              payerStats[payer] = { completed:0, cancelled:0, missed:0, scheduled:0, total:0, patients:new Set() };
            }
            const ps = payerStats[payer];
            ps.total++;
            if (v.patient_name) ps.patients.add(v.patient_name);
            if (isCancelled(v.event_type, v.status)) ps.cancelled++;
            else if (isCompleted(v.status)) ps.completed++;
            else if (/missed/i.test(v.status||'')) ps.missed++;
            else if ((v.status||'').toLowerCase() === 'scheduled') ps.scheduled++;
          });

          // Aggregate auth metrics by insurance
          const authStats = {};
          auth.forEach(a => {
            const payer = (a.insurance || 'Unknown').trim();
            if (!authStats[payer]) {
              authStats[payer] = {
                total:0, active:0, pending:0, approved:0, submitted:0, denied:0, expired:0,
                visits_authorized:0, visits_used:0,
                daysToApproveTotal:0, daysToApproveCount:0,
                ppoCount:0,
              };
            }
            const as = authStats[payer];
            as.total++;
            const st = (a.auth_status||'').toLowerCase();
            if (st === 'active') as.active++;
            else if (st === 'pending') as.pending++;
            else if (st === 'approved') as.approved++;
            else if (st === 'submitted') as.submitted++;
            else if (st === 'denied') as.denied++;
            else if (st === 'expired') as.expired++;
            if (a.is_ppo) as.ppoCount++;
            as.visits_authorized += (a.visits_authorized || 0);
            as.visits_used += (a.visits_used || 0);
            if (a.auth_submitted_date && a.auth_approved_date) {
              const sd = new Date(a.auth_submitted_date);
              const ad = new Date(a.auth_approved_date);
              const days = Math.floor((ad - sd) / 86400000);
              if (days >= 0 && days < 90) {
                as.daysToApproveTotal += days;
                as.daysToApproveCount++;
              }
            }
          });

          const allPayers = new Set([...Object.keys(payerStats), ...Object.keys(authStats)]);
          const rows = Array.from(allPayers).map(payer => {
            const ps = payerStats[payer] || { completed:0, cancelled:0, missed:0, scheduled:0, total:0, patients:new Set() };
            const as = authStats[payer] || { total:0, active:0, pending:0, approved:0, submitted:0, denied:0, expired:0, visits_authorized:0, visits_used:0, daysToApproveTotal:0, daysToApproveCount:0, ppoCount:0 };
            const completedRevenue = ps.completed * RATE;
            const lostRevenue = (ps.cancelled + ps.missed) * RATE;
            const outcomes = ps.completed + ps.cancelled + ps.missed;
            const completionPct = outcomes > 0 ? Math.round(ps.completed / outcomes * 100) : 0;
            const approvalDenom = as.approved + as.active + as.denied;
            const approvalPct = approvalDenom > 0 ? Math.round(((as.approved + as.active) / approvalDenom) * 100) : 0;
            const avgDaysToApprove = as.daysToApproveCount > 0 ? Math.round(as.daysToApproveTotal / as.daysToApproveCount) : null;
            return {
              'Payer': payer,
              'Unique Patients': ps.patients.size,
              'Visits Completed': ps.completed,
              'Completed Revenue ($)': completedRevenue,
              'Visits Cancelled': ps.cancelled,
              'Visits Missed': ps.missed,
              'Lost Revenue ($)': lostRevenue,
              'Completion Rate %': completionPct,
              'Total Auths': as.total,
              'Active Auths': as.active,
              'Pending Auths': as.pending,
              'Submitted Auths': as.submitted,
              'Approved Auths': as.approved,
              'Denied Auths': as.denied,
              'Expired Auths': as.expired,
              'PPO Auths': as.ppoCount,
              'Auth Approval Rate %': approvalPct,
              'Avg Days to Approve': avgDaysToApprove ?? '—',
              'Visits Authorized (sum)': as.visits_authorized,
              'Visits Used (sum)': as.visits_used,
              'Auth Utilization %': as.visits_authorized > 0 ? Math.round(as.visits_used / as.visits_authorized * 100) : 0,
            };
          }).sort((a,b) => b['Completed Revenue ($)'] - a['Completed Revenue ($)']);

          // Totals row
          const tot = rows.reduce((acc, r) => {
            acc.patients += r['Unique Patients'];
            acc.completed += r['Visits Completed'];
            acc.completedRev += r['Completed Revenue ($)'];
            acc.lostRev += r['Lost Revenue ($)'];
            acc.cancelled += r['Visits Cancelled'];
            acc.missed += r['Visits Missed'];
            return acc;
          }, { patients:0, completed:0, completedRev:0, lostRev:0, cancelled:0, missed:0 });
          rows.push({
            'Payer': 'TOTAL',
            'Unique Patients': tot.patients,
            'Visits Completed': tot.completed,
            'Completed Revenue ($)': tot.completedRev,
            'Visits Cancelled': tot.cancelled,
            'Visits Missed': tot.missed,
            'Lost Revenue ($)': tot.lostRev,
            'Completion Rate %': (tot.completed + tot.cancelled + tot.missed) > 0 ? Math.round(tot.completed / (tot.completed + tot.cancelled + tot.missed) * 100) : 0,
          });

          format === 'xlsx' ? exportXLSX(rows, 'Payer Performance', 'Payer_Performance'+suffix) : exportCSV(rows, 'Payer_Performance'+suffix);
          break;
        }

        // ── NEW (2026-06-09): Conversion Funnel Report ────────────────────
        // Monthly cohort funnel: Referral → Accepted → On Census → SOC → Active
        // Shows drop-off rate at each stage with by-month and by-region slices.
        case 'conversion_funnel': {
          const fi = applyFilters(intake, 'date_received');

          // Build patient lookup map
          const censusByName = new Map();
          census.forEach(c => {
            const k = (c.patient_name||'').trim().toLowerCase();
            if (k) censusByName.set(k, c);
          });
          const socByName = new Map();
          auth.forEach(a => {
            const k = (a.patient_name||'').trim().toLowerCase();
            if (k && a.soc_date && !socByName.has(k)) socByName.set(k, a.soc_date);
          });

          const ACTIVE_STATUSES = new Set(['Active','active','Active - Auth Pending','Active - Auth Pendin']);

          // Helper: classify each referral row through the funnel
          const classify = (r) => {
            const key = (r.patient_name||'').trim().toLowerCase();
            const accepted = (r.referral_status||'').toLowerCase() === 'accepted';
            const onCensus = censusByName.has(key);
            const hasSOC = socByName.has(key) || (onCensus && censusByName.get(key)?.first_seen_date);
            const censusRow = censusByName.get(key);
            const isActive = onCensus && ACTIVE_STATUSES.has(censusRow?.status);
            return { accepted, onCensus, hasSOC, isActive };
          };

          // ── Sheet 1: Funnel by Month ──
          const byMonth = {};
          fi.forEach(r => {
            const d = r.date_received || '';
            const monthKey = d ? d.slice(0,7) : 'UNKNOWN';
            if (!byMonth[monthKey]) byMonth[monthKey] = { received:0, accepted:0, onCensus:0, hasSOC:0, isActive:0 };
            const c = classify(r);
            byMonth[monthKey].received++;
            if (c.accepted) byMonth[monthKey].accepted++;
            if (c.onCensus) byMonth[monthKey].onCensus++;
            if (c.hasSOC) byMonth[monthKey].hasSOC++;
            if (c.isActive) byMonth[monthKey].isActive++;
          });
          const monthRows = Object.keys(byMonth).sort().map(month => {
            const s = byMonth[month];
            const pct = (a,b) => b > 0 ? Math.round(a/b*100) : 0;
            return {
              'Month': month,
              'Referrals Received': s.received,
              'Accepted': s.accepted,
              'Acceptance Rate %': pct(s.accepted, s.received),
              'On Census': s.onCensus,
              'Accept→Census %': pct(s.onCensus, s.accepted),
              'Has SOC': s.hasSOC,
              'Census→SOC %': pct(s.hasSOC, s.onCensus),
              'Currently Active': s.isActive,
              'SOC→Active %': pct(s.isActive, s.hasSOC),
              'Overall Conversion % (Referral→Active)': pct(s.isActive, s.received),
              'Drop-off: Reject ($ lost est.)': (s.received - s.accepted) * RATE * 5, // est 5 visits/patient lost
              'Drop-off: Post-Accept ($ lost est.)': (s.accepted - s.isActive) * RATE * 5,
            };
          });

          // ── Sheet 2: Funnel by Region ──
          const byRegion = {};
          fi.forEach(r => {
            const region = r.region || 'UNKNOWN';
            if (!byRegion[region]) byRegion[region] = { received:0, accepted:0, onCensus:0, hasSOC:0, isActive:0 };
            const c = classify(r);
            byRegion[region].received++;
            if (c.accepted) byRegion[region].accepted++;
            if (c.onCensus) byRegion[region].onCensus++;
            if (c.hasSOC) byRegion[region].hasSOC++;
            if (c.isActive) byRegion[region].isActive++;
          });
          const regionRows = Object.keys(byRegion).sort().map(region => {
            const s = byRegion[region];
            const pct = (a,b) => b > 0 ? Math.round(a/b*100) : 0;
            return {
              'Region': region,
              'Regional Manager': REGIONAL_MANAGERS[region] || '—',
              'Referrals Received': s.received,
              'Accepted': s.accepted,
              'Acceptance Rate %': pct(s.accepted, s.received),
              'On Census': s.onCensus,
              'Has SOC': s.hasSOC,
              'Currently Active': s.isActive,
              'Overall Conversion %': pct(s.isActive, s.received),
            };
          });

          // ── Sheet 3: Funnel by Payer ──
          const byPayer = {};
          fi.forEach(r => {
            const payer = (r.insurance || 'Unknown').trim();
            if (!byPayer[payer]) byPayer[payer] = { received:0, accepted:0, onCensus:0, hasSOC:0, isActive:0 };
            const c = classify(r);
            byPayer[payer].received++;
            if (c.accepted) byPayer[payer].accepted++;
            if (c.onCensus) byPayer[payer].onCensus++;
            if (c.hasSOC) byPayer[payer].hasSOC++;
            if (c.isActive) byPayer[payer].isActive++;
          });
          const payerRows = Object.entries(byPayer).map(([payer, s]) => {
            const pct = (a,b) => b > 0 ? Math.round(a/b*100) : 0;
            return {
              'Payer': payer,
              'Referrals Received': s.received,
              'Accepted': s.accepted,
              'Acceptance Rate %': pct(s.accepted, s.received),
              'On Census': s.onCensus,
              'Has SOC': s.hasSOC,
              'Currently Active': s.isActive,
              'Overall Conversion %': pct(s.isActive, s.received),
            };
          }).sort((a,b) => b['Referrals Received'] - a['Referrals Received']);

          // ── Sheet 4: Per-Patient Trace (for debugging / drill-down) ──
          const traceRows = fi.map(r => {
            const c = classify(r);
            const censusRow = censusByName.get((r.patient_name||'').trim().toLowerCase());
            return {
              'Date Received': fmtDate(r.date_received),
              'Patient': r.patient_name || '',
              'Region': r.region || '',
              'Insurance': r.insurance || '',
              'Referral Status': r.referral_status || '',
              'Accepted?': c.accepted ? 'Yes' : 'No',
              'On Census?': c.onCensus ? 'Yes' : 'No',
              'Has SOC?': c.hasSOC ? 'Yes' : 'No',
              'Is Active?': c.isActive ? 'Yes' : 'No',
              'Current Census Status': censusRow?.status || '—',
              'Denial Reason (if denied)': r.denial_reason || '',
              'Furthest Stage Reached': c.isActive ? 'Active' : c.hasSOC ? 'SOC' : c.onCensus ? 'Census' : c.accepted ? 'Accepted' : 'Referral Only',
            };
          }).sort((x,y) => (y['Date Received']||'').localeCompare(x['Date Received']||''));

          if (format === 'xlsx') {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthRows), 'Funnel by Month');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regionRows), 'Funnel by Region');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payerRows), 'Funnel by Payer');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(traceRows), 'Per-Patient Trace');
            XLSX.writeFile(wb, 'Conversion_Funnel'+suffix+'.xlsx');
          } else {
            exportCSV(monthRows, 'Conversion_Funnel'+suffix);
          }
          break;
        }
      }

      setSuccess(reportId + '_' + format);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Export error:', err);
      alert('Export failed: ' + (err.message || err));
    }
    setGenerating(null);
  }
 
  const categories = ['ALL', 'Pinned', ...CATEGORY_ORDER];
  const filtered = REPORTS.filter(r => {
    if (categoryFilter === 'ALL') return true;
    if (categoryFilter === 'Pinned') return r.pinned;
    return r.category === categoryFilter;
  });
  const pinnedReports = REPORTS.filter(r => r.pinned);
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    meta: CATEGORY_META[cat],
    items: filtered.filter(r => r.category === cat),
  })).filter(g => g.items.length > 0);
 
  useRealtimeTable(['census_data', 'visit_schedule_data', 'auth_tracker', 'clinicians', 'intake_referrals', 'care_coord_notes'], loadData);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Reports & Export" subtitle="Loading data…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Reports & Export" subtitle="Extract data for presentations, reviews, and PCP sharing" />
      <div style={{ flex:1, overflow:'auto', padding:20, display:'flex', flexDirection:'column', gap:20 }}>
 
        {/* Filters */}
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', marginBottom:12 }}>Report Filters <span style={{ fontWeight:400, color:'var(--gray)', fontSize:12 }}>— applies to all exports below</span></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Region</div>
              <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--bg)' }}>
                <option value="ALL">All Regions</option>
                {['A','B','C','G','H','J','M','N','T','V'].map(r => <option key={r} value={r}>Region {r} — {REGIONAL_MANAGERS[r]}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Date From</div>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Date To</div>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Category</div>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--bg)' }}>
                {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'All Categories' : c}</option>)}
              </select>
            </div>
          </div>
          {(regionFilter !== 'ALL' || dateFrom || dateTo) && (
            <div style={{ marginTop:10, display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#1565C0', fontWeight:600 }}>Active filters:</span>
              {regionFilter !== 'ALL' && <span style={{ fontSize:11, background:'#EFF6FF', border:'1px solid #1565C0', color:'#1565C0', padding:'2px 8px', borderRadius:999 }}>Region {regionFilter}</span>}
              {dateFrom && <span style={{ fontSize:11, background:'#EFF6FF', border:'1px solid #1565C0', color:'#1565C0', padding:'2px 8px', borderRadius:999 }}>From {dateFrom}</span>}
              {dateTo && <span style={{ fontSize:11, background:'#EFF6FF', border:'1px solid #1565C0', color:'#1565C0', padding:'2px 8px', borderRadius:999 }}>To {dateTo}</span>}
              <button onClick={() => { setRegionFilter('ALL'); setDateFrom(''); setDateTo(''); }}
                style={{ fontSize:11, background:'none', border:'none', color:'var(--gray)', cursor:'pointer', textDecoration:'underline' }}>Clear all</button>
            </div>
          )}
        </div>
 
        {/* ── PINNED / MOST USED — only when not filtering to a single category ── */}
        {categoryFilter === 'ALL' && pinnedReports.length > 0 && (
          <SectionBlock
            title="Most Used"
            subtitle={`Quick access to the ${pinnedReports.length} reports run most often`}
            color="#7C3AED"
            bg="#F5F3FF"
            icon="⭐"
            items={pinnedReports}
            generating={generating}
            success={success}
            generate={generate}
          />
        )}

        {/* ── GROUPED BY DEPARTMENT BUCKET ── */}
        {grouped.map(group => (
          <SectionBlock
            key={group.category}
            title={group.category}
            subtitle={group.meta.desc}
            color={group.meta.color}
            bg={group.meta.bg}
            icon=""
            count={group.items.length}
            items={group.items}
            generating={generating}
            success={success}
            generate={generate}
          />
        ))}

      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── SectionBlock: renders one department bucket with a header + card grid ──
function SectionBlock({ title, subtitle, color, bg, icon, count, items, generating, success, generate }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, paddingLeft:4 }}>
        {icon && <div style={{ fontSize:18 }}>{icon}</div>}
        <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', letterSpacing:'-0.01em' }}>{title}</div>
        <div style={{
          fontSize:11, fontWeight:700, color, background:bg,
          padding:'2px 9px', borderRadius:999, textTransform:'uppercase', letterSpacing:'0.04em',
        }}>
          {count != null ? `${count} report${count === 1 ? '' : 's'}` : 'Pinned'}
        </div>
        {subtitle && <div style={{ fontSize:12, color:'var(--gray)', marginLeft:6 }}>{subtitle}</div>}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:14 }}>
        {items.map(report => {
          const isGen = generating?.startsWith(report.id);
          const isDone = success?.startsWith(report.id);
          return (
            <div key={report.id} style={{
              background:'var(--card-bg)',
              border:`1px solid ${isDone ? '#10B981' : 'var(--border)'}`,
              borderLeft:`4px solid ${color}`,
              borderRadius:10,
              padding:'16px 18px',
              display:'flex', flexDirection:'column', gap:11,
              transition:'border-color 0.3s',
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:11 }}>
                <div style={{ fontSize:24, lineHeight:1 }}>{report.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:3, lineHeight:1.3 }}>
                    {report.title}
                    {report.pinned && <span style={{ marginLeft:6, fontSize:11 }}>{'⭐'}</span>}
                  </div>
                  <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.45 }}>{report.desc}</div>
                </div>
              </div>
              {isDone && (
                <div style={{ fontSize:12, color:'#065F46', fontWeight:600, background:'#ECFDF5', padding:'5px 9px', borderRadius:6 }}>
                  Downloaded
                </div>
              )}
              <div style={{ display:'flex', gap:6 }}>
                {report.formats.map(fmt => (
                  <button key={fmt} onClick={() => generate(report.id, fmt)} disabled={!!generating}
                    style={{
                      flex:1, padding:'7px 10px',
                      background: fmt === 'xlsx' ? color : fmt === 'template' ? '#7C3AED' : 'var(--card-bg)',
                      color: fmt === 'csv' ? color : '#fff',
                      border: fmt === 'csv' ? `1px solid ${color}` : 'none',
                      borderRadius:6, fontSize:11.5, fontWeight:600,
                      cursor: generating ? 'wait' : 'pointer',
                      opacity: generating ? 0.6 : 1,
                      display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    }}>
                    {isGen && generating?.endsWith(fmt) ? (
                      <><span style={{ display:'inline-block', width:11, height:11, border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} /> Working...</>
                    ) : fmt === 'template' ? (
                      <>Template</>
                    ) : (
                      <>Export {fmt.toUpperCase()}</>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
