import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import * as XLSX from 'xlsx';
 
const RATE = 230;
const REGIONAL_MANAGERS = {
  A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks',
  H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi',
  T:'Samantha Faliks', V:'Samantha Faliks',
};
 
function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }
function isCompleted(s) { return /completed/i.test(s||''); }
function isEval(e) { return /eval/i.test(e||''); }
function fmtDate(d) { return d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) : '' ; }
 
const REPORTS = [
  {
    id: 'kpi_summary',
    icon: '📊',
    title: 'Company KPI Summary',
    desc: 'High-level KPIs: visits, revenue, intake conversion, auth approval rate. Ideal for leadership presentations.',
    formats: ['xlsx','csv'],
    category: 'Executive',
  },
  {
    id: 'patient_performance',
    icon: '👤',
    title: 'Patient Performance Report',
    desc: 'Per-patient visit history with completed, cancelled, missed counts. Share with Regional Managers for PCP updates.',
    formats: ['xlsx','csv'],
    category: 'Clinical',
  },
  {
    id: 'non_compliance',
    icon: '🚫',
    title: 'Non-Compliance Report',
    desc: 'Patients with 2+ cancellations — evidence of non-compliance for clinical and payer documentation.',
    formats: ['xlsx','csv'],
    category: 'Clinical',
  },
  {
    id: 'intake_referrals',
    icon: '📥',
    title: 'Intake Referrals Export',
    desc: 'Full referral log with patient, insurance, diagnosis, status, PCP, and denial reason.',
    formats: ['xlsx','csv'],
    category: 'Intake',
  },
  {
    id: 'auth_status',
    icon: '🔐',
    title: 'Authorization Status Report',
    desc: 'All auths with visits authorized/used/remaining, expiry dates, and alert flags.',
    formats: ['xlsx','csv'],
    category: 'Authorization',
  },
  {
    id: 'revenue_by_region',
    icon: '💰',
    title: 'Revenue by Region',
    desc: 'Completed visits and estimated revenue broken down by region and regional manager.',
    formats: ['xlsx','csv'],
    category: 'Financial',
  },
  {
    id: 'clinician_productivity',
    icon: '📈',
    title: 'Clinician Productivity Report',
    desc: 'Per-clinician visit counts (completed, cancelled, missed), revenue contribution, and target attainment.',
    formats: ['xlsx','csv'],
    category: 'Operations',
  },
  {
    id: 'expiring_auths',
    icon: '⏰',
    title: 'Expiring Authorizations',
    desc: 'Patients whose auth expires within 30 days or have ≤5 visits remaining. Action list for auth team.',
    formats: ['xlsx','csv'],
    category: 'Authorization',
  },
  {
    id: 'regional_manager_summary',
    icon: '🗺',
    title: 'Regional Manager Summary',
    desc: 'Patient list per region with insurance, visit totals, and auth status. Ready to share with each RM.',
    formats: ['xlsx','csv'],
    category: 'Operations',
  },
  {
    id: 'patient_census',
    icon: '🩺',
    title: 'Patient Census Export',
    desc: 'Current census snapshot — Summary, Full Census, Active Only, and a Status Drift audit (cases where census_data and patient_master disagree). Template is the blank Pariox-format upload sheet for audits and bulk re-imports.',
    formats: ['xlsx','csv','template'],
    category: 'Operations',
  },
];
 
export default function ReportsExportPage() {
  const [visits, setVisits] = useState([]);
  const [intake, setIntake] = useState([]);
  const [auth, setAuth] = useState([]);
  const [census, setCensus] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null);
  const [success, setSuccess] = useState(null);
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
 
  useEffect(() => {
    Promise.all([
      supabase.from('visit_schedule_data').select('*'),
      supabase.from('intake_referrals').select('*'),
      supabase.from('auth_tracker').select('*'),
      supabase.from('census_data').select('*'),
      supabase.from('clinicians').select('*').eq('is_active', true),
    ]).then(([v,i,a,c,cl]) => {
      setVisits(v.data||[]); setIntake(i.data||[]);
      setAuth(a.data||[]); setCensus(c.data||[]);
      setClinicians(cl.data||[]); setLoading(false);
    });
  }, []);
 
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
 
          // Lazy-fetch patient_master for status drift detection
          const { data: master } = await supabase.from('patient_master')
            .select('patient_key, current_status, previous_status, status_changed_at, has_been_active, has_been_discharged, total_referrals, last_discharge_date')
            .limit(3000);
          const masterMap = {};
          (master||[]).forEach(m => { if (m.patient_key) masterMap[m.patient_key] = m; });
 
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
            ['AxiomHealth Patient Census Export'],
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
      }
 
      setSuccess(reportId + '_' + format);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Export error:', err);
    }
    setGenerating(null);
  }
 
  const categories = ['ALL', ...new Set(REPORTS.map(r => r.category))];
  const filtered = REPORTS.filter(r => categoryFilter === 'ALL' || r.category === categoryFilter);
 
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
 
        {/* Report cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
          {filtered.map(report => {
            const isGen = generating?.startsWith(report.id);
            const isDone = success?.startsWith(report.id);
            return (
              <div key={report.id} style={{ background:'var(--card-bg)', border:`1px solid ${isDone?'#10B981':'var(--border)'}`, borderRadius:12, padding:20, display:'flex', flexDirection:'column', gap:12, transition:'border-color 0.3s' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                  <div style={{ fontSize:28, lineHeight:1 }}>{report.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>{report.title}</div>
                      <span style={{ fontSize:9, fontWeight:700, color:'#7C3AED', background:'#F5F3FF', padding:'1px 6px', borderRadius:999, textTransform:'uppercase', letterSpacing:'0.05em' }}>{report.category}</span>
                    </div>
                    <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.5 }}>{report.desc}</div>
                  </div>
                </div>
                {isDone && (
                  <div style={{ fontSize:12, color:'#065F46', fontWeight:600, background:'#ECFDF5', padding:'6px 10px', borderRadius:6 }}>
                    ✓ Downloaded successfully
                  </div>
                )}
                <div style={{ display:'flex', gap:8 }}>
                  {report.formats.map(fmt => (
                    <button key={fmt} onClick={() => generate(report.id, fmt)}
                      disabled={!!generating}
                      style={{ flex:1, padding:'8px 12px', background:fmt==='xlsx'?'#065F46':fmt==='template'?'#7C3AED':'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:generating?'wait':'pointer', opacity:generating?0.6:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                      {isGen && generating?.endsWith(fmt) ? (
                        <><span style={{ display:'inline-block', width:12, height:12, border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} /> Generating…</>
                      ) : fmt === 'template' ? (
                        <>📋 Template</>
                      ) : (
                        <>{fmt === 'xlsx' ? '📊' : '📄'} Export {fmt.toUpperCase()}</>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
