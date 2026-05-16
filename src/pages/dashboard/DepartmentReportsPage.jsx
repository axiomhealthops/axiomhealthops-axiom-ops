// =====================================================================
// DepartmentReportsPage.jsx
//
// Per Liam (2026-05-16): "Think of all of these different columns as a
// separate data export and then create a specific grouping for the
// reports. For example, if they should be more Authorization Department,
// Care Coordination Department, Clinical Department, Etc"
//
// One-click XLSX exports grouped by department. Each report is a single
// query against current production data — no manual filtering needed.
// Built on the same SheetJS pattern as ReportsExportPage so admins get
// consistent file formats (well-known column order, frozen header row).
//
// Department buckets (mapping audit columns → reports):
//   AUTHORIZATION DEPT
//     - All Authorizations (every active auth + status)
//     - Active - Auth Pending (audit's flagged "pending" patients)
//     - Stalled Auths (submitted >5d, no approval)
//     - PPO Patients (separate plan rules)
//     - Renewal Pipeline (expiring ≤30 days)
//
//   CARE COORDINATION DEPT
//     - Patients Not Scheduled (SCHEDULED? = NO)
//     - Frequency Compliance (frequency missing or stale)
//     - CC Notes Log (all notes from audit imports + recent)
//     - On Hold / Waitlist active list
//
//   CLINICAL DEPT
//     - Discipline Breakdown (PT vs OT by region)
//     - Eval Pending Backlog
//
//   INTAKE DEPT
//     - This Week's Referrals (with welcome call status)
//     - Pariox Referral Source Breakdown
//
//   OPERATIONS (cross-dept)
//     - Full Patient Master (every column the audit asks about)
//     - Stuck Patients (any stage past threshold)
// =====================================================================

import { useState } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

// Each report = { id, label, dept, description, run(): returns {filename, sheets: [{name, rows}]} }
const REPORTS = [
  // ── AUTHORIZATION DEPARTMENT ──────────────────────────────────────
  {
    id: 'auth_all',
    label: 'All Active Authorizations',
    dept: 'AUTHORIZATION',
    description: 'Every currently-active auth with PPO?, dates, visit counts, status, assigned auth coordinator',
    async run() {
      var auths = await fetchAllPages(supabase.from('auth_tracker').select('patient_name,region,insurance,is_ppo,auth_status,auth_start_date,auth_expiry_date,visits_authorized,visits_used,evals_authorized,evals_used,reassessments_authorized,reassessments_used,soc_date,is_scheduled,assigned_to,notes').eq('is_currently_active', true).order('region').order('patient_name'));
      var rows = auths.map(function(a) {
        return {
          'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
          'PPO?': a.is_ppo === true ? 'YES' : a.is_ppo === false ? 'NO' : '',
          'Auth Status': a.auth_status, 'SOC': a.soc_date,
          'Auth Start': a.auth_start_date, 'Auth End': a.auth_expiry_date,
          'Visits Auth': a.visits_authorized, 'Visits Used': a.visits_used,
          'Visits Remaining': (a.visits_authorized || 0) - (a.visits_used || 0),
          'Evals Auth': a.evals_authorized, 'Evals Used': a.evals_used,
          'RAs Auth': a.reassessments_authorized, 'RAs Used': a.reassessments_used,
          'Scheduled?': a.is_scheduled === true ? 'YES' : a.is_scheduled === false ? 'NO' : '',
          'Assigned To': a.assigned_to, 'Notes': a.notes,
        };
      });
      return { filename: 'All_Active_Authorizations', sheets: [{ name: 'Authorizations', rows: rows }] };
    },
  },
  {
    id: 'auth_pending_active',
    label: 'Active - Auth Pending Patients',
    dept: 'AUTHORIZATION',
    description: 'Patients flagged in audit as "Active - Auth Pending" — currently being seen but auth not yet approved',
    async run() {
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,insurance,status,inferred_frequency,status_changed_at,pipeline_assigned_to').eq('status', 'Active - Auth Pending').order('region').order('patient_name'));
      var rows = census.map(function(c) {
        var dStuck = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
        return {
          'Patient': c.patient_name, 'Region': c.region, 'Insurance': c.insurance,
          'Frequency': c.inferred_frequency, 'Days Pending': dStuck,
          'Owner': c.pipeline_assigned_to || '⚠ unassigned',
        };
      });
      return { filename: 'Active_Auth_Pending', sheets: [{ name: 'Auth Pending', rows: rows }] };
    },
  },
  {
    id: 'auth_stalled',
    label: 'Stalled Auths (Submitted >5d, Not Approved)',
    dept: 'AUTHORIZATION',
    description: 'Auths submitted more than 5 days ago that still have no approval — action list for the Auth team',
    async run() {
      var auths = await fetchAllPages(supabase.from('auth_tracker').select('patient_name,region,insurance,auth_status,auth_submitted_date,assigned_to,notes').eq('is_currently_active', true).in('auth_status', ['submitted', 'pending']));
      var rows = auths.filter(function(a) {
        if (!a.auth_submitted_date) return false;
        var d = Math.ceil((Date.now() - new Date(a.auth_submitted_date).getTime()) / 86400000);
        return d > 5;
      }).map(function(a) {
        return {
          'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
          'Submitted': a.auth_submitted_date,
          'Days Stalled': Math.ceil((Date.now() - new Date(a.auth_submitted_date).getTime()) / 86400000),
          'Assigned To': a.assigned_to || '⚠ unassigned', 'Notes': a.notes,
        };
      }).sort(function(a, b) { return b['Days Stalled'] - a['Days Stalled']; });
      return { filename: 'Stalled_Auths', sheets: [{ name: 'Stalled Auths', rows: rows }] };
    },
  },
  {
    id: 'auth_ppo',
    label: 'PPO Patients',
    dept: 'AUTHORIZATION',
    description: 'Every patient on a PPO plan — different auth rules apply',
    async run() {
      var auths = await fetchAllPages(supabase.from('auth_tracker').select('patient_name,region,insurance,auth_status,visits_authorized,visits_used,auth_expiry_date,assigned_to').eq('is_currently_active', true).eq('is_ppo', true).order('region').order('patient_name'));
      var rows = auths.map(function(a) {
        return {
          'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
          'Auth Status': a.auth_status, 'Visits Auth': a.visits_authorized, 'Visits Used': a.visits_used,
          'Auth Expires': a.auth_expiry_date, 'Assigned To': a.assigned_to,
        };
      });
      return { filename: 'PPO_Patients', sheets: [{ name: 'PPO Patients', rows: rows }] };
    },
  },
  {
    id: 'auth_renewal',
    label: 'Renewal Pipeline (Expiring ≤30 days)',
    dept: 'AUTHORIZATION',
    description: 'Auths expiring in the next 30 days — sorted by urgency',
    async run() {
      var thirty = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      var auths = await fetchAllPages(supabase.from('auth_tracker').select('patient_name,region,insurance,auth_expiry_date,visits_authorized,visits_used,assigned_to').eq('is_currently_active', true).not('auth_expiry_date', 'is', null).lte('auth_expiry_date', thirty).order('auth_expiry_date'));
      var rows = auths.map(function(a) {
        var d = a.auth_expiry_date ? Math.ceil((new Date(a.auth_expiry_date).getTime() - Date.now()) / 86400000) : null;
        return {
          'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
          'Expires': a.auth_expiry_date, 'Days Left': d,
          'Visits Remaining': (a.visits_authorized || 0) - (a.visits_used || 0),
          'Assigned To': a.assigned_to,
        };
      });
      return { filename: 'Renewal_Pipeline', sheets: [{ name: 'Renewals', rows: rows }] };
    },
  },

  // ── CARE COORDINATION DEPARTMENT ──────────────────────────────────
  {
    id: 'cc_not_scheduled',
    label: 'Patients Not Scheduled (SCHEDULED? = NO)',
    dept: 'CARE COORDINATION',
    description: 'Active patients without scheduled visits — care coord follow-up list',
    async run() {
      var auths = await fetchAllPages(supabase.from('auth_tracker').select('patient_name,region,insurance,is_scheduled,assigned_to').eq('is_currently_active', true).eq('is_scheduled', false));
      // Join with census for status
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,status,inferred_frequency,pipeline_assigned_to'));
      var censusMap = {};
      census.forEach(function(c) { censusMap[(c.patient_name || '').toLowerCase().trim() + '|' + c.region] = c; });
      var rows = auths.map(function(a) {
        var c = censusMap[(a.patient_name || '').toLowerCase().trim() + '|' + a.region];
        return {
          'Patient': a.patient_name, 'Region': a.region, 'Insurance': a.insurance,
          'Census Status': c ? c.status : '—', 'Frequency': c ? c.inferred_frequency : '—',
          'Care Coord Owner': c ? c.pipeline_assigned_to || '⚠ unassigned' : '—',
          'Auth Assigned To': a.assigned_to,
        };
      }).sort(function(a, b) { return (a['Region'] || '').localeCompare(b['Region'] || ''); });
      return { filename: 'Not_Scheduled', sheets: [{ name: 'Not Scheduled', rows: rows }] };
    },
  },
  {
    id: 'cc_frequency_missing',
    label: 'Frequency Missing / Needs Review',
    dept: 'CARE COORDINATION',
    description: 'Active patients with no frequency set or marked for review',
    async run() {
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,status,inferred_frequency,needs_frequency_review,pipeline_assigned_to').or('inferred_frequency.is.null,needs_frequency_review.eq.true').not('status', 'in', '("Discharge","Discharge - Change Insurance","Discharged","Non-Admit","Non-admit","On Hold","Hospitalized")'));
      var rows = census.map(function(c) {
        return {
          'Patient': c.patient_name, 'Region': c.region, 'Status': c.status,
          'Current Frequency': c.inferred_frequency || '⚠ MISSING',
          'Needs Review?': c.needs_frequency_review ? 'YES' : 'NO',
          'Owner': c.pipeline_assigned_to || '⚠ unassigned',
        };
      }).sort(function(a, b) { return (a['Region'] || '').localeCompare(b['Region'] || ''); });
      return { filename: 'Frequency_Missing', sheets: [{ name: 'Frequency', rows: rows }] };
    },
  },
  {
    id: 'cc_notes_log',
    label: 'CC Notes Log (last 30 days)',
    dept: 'CARE COORDINATION',
    description: 'All care coordination notes including audit imports — chronological view',
    async run() {
      var since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      var notes = await fetchAllPages(supabase.from('care_coord_notes').select('patient_name,region,note_type,note,contact_date,updated_by').gte('contact_date', since).order('contact_date', { ascending: false }));
      var rows = notes.map(function(n) {
        return {
          'Date': n.contact_date, 'Patient': n.patient_name, 'Region': n.region,
          'Note Type': n.note_type, 'Note': n.note, 'Logged By': n.updated_by,
        };
      });
      return { filename: 'CC_Notes_Log', sheets: [{ name: 'Notes Log', rows: rows }] };
    },
  },
  {
    id: 'cc_on_hold_waitlist',
    label: 'On Hold + Waitlist Active List',
    dept: 'CARE COORDINATION',
    description: 'Patients on hold or waitlisted — sorted by days inactive (recovery candidates)',
    async run() {
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,status,insurance,status_changed_at,pipeline_assigned_to').in('status', ['On Hold', 'On Hold - Facility', 'On Hold - Pt Request', 'On Hold - MD Request', 'Waitlist']));
      var rows = census.map(function(c) {
        var d = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
        return {
          'Patient': c.patient_name, 'Region': c.region, 'Insurance': c.insurance,
          'Status': c.status, 'Days In Status': d,
          'Owner': c.pipeline_assigned_to || '⚠ unassigned',
        };
      }).sort(function(a, b) { return (b['Days In Status'] || 0) - (a['Days In Status'] || 0); });
      return { filename: 'OnHold_Waitlist', sheets: [{ name: 'OnHold + Waitlist', rows: rows }] };
    },
  },

  // ── CLINICAL DEPARTMENT ───────────────────────────────────────────
  {
    id: 'clinical_discipline',
    label: 'Discipline Breakdown (PT vs OT by Region)',
    dept: 'CLINICAL',
    description: 'How patients are split between Lymphedema PT and OT, by region — capacity planning input',
    async run() {
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,status,discipline,insurance').not('status', 'in', '("Discharge","Discharge - Change Insurance","Discharged","Non-Admit","Non-admit")'));
      var rows = census.map(function(c) {
        return {
          'Patient': c.patient_name, 'Region': c.region, 'Discipline': c.discipline || '—',
          'Status': c.status, 'Insurance': c.insurance,
        };
      });
      // Summary sheet
      var summary = {};
      census.forEach(function(c) {
        var k = c.region + '|' + (c.discipline || 'UNKNOWN');
        summary[k] = (summary[k] || 0) + 1;
      });
      var summaryRows = Object.entries(summary).map(function(e) {
        var parts = e[0].split('|');
        return { 'Region': parts[0], 'Discipline': parts[1], 'Count': e[1] };
      }).sort(function(a, b) { return (a.Region || '').localeCompare(b.Region || '') || (a.Discipline || '').localeCompare(b.Discipline || ''); });
      return { filename: 'Discipline_Breakdown', sheets: [
        { name: 'Summary by Region', rows: summaryRows },
        { name: 'All Patients', rows: rows },
      ]};
    },
  },
  {
    id: 'clinical_eval_pending',
    label: 'Eval Pending Backlog',
    dept: 'CLINICAL',
    description: 'Patients awaiting clinical evaluation — 48h SLA',
    async run() {
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,insurance,discipline,status_changed_at,pipeline_assigned_to').eq('status', 'Eval Pending'));
      var rows = census.map(function(c) {
        var d = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
        return {
          'Patient': c.patient_name, 'Region': c.region, 'Discipline': c.discipline,
          'Insurance': c.insurance, 'Days Waiting': d,
          'Past 48h SLA?': d > 2 ? 'YES' : 'NO',
          'Owner': c.pipeline_assigned_to || '⚠ unassigned',
        };
      }).sort(function(a, b) { return (b['Days Waiting'] || 0) - (a['Days Waiting'] || 0); });
      return { filename: 'Eval_Pending_Backlog', sheets: [{ name: 'Eval Pending', rows: rows }] };
    },
  },

  // ── INTAKE DEPARTMENT ─────────────────────────────────────────────
  {
    id: 'intake_this_week',
    label: 'This Week\'s Referrals',
    dept: 'INTAKE',
    description: 'New referrals received in the last 7 days — with welcome call + accept/decline status',
    async run() {
      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      var refs = await fetchAllPages(supabase.from('intake_referrals').select('patient_name,region,insurance,date_received,referral_status,welcome_call,first_appt,chart_status').gte('date_received', weekAgo).order('date_received', { ascending: false }));
      var rows = refs.map(function(r) {
        return {
          'Date Received': r.date_received, 'Patient': r.patient_name, 'Region': r.region,
          'Insurance': r.insurance, 'Referral Status': r.referral_status,
          'Welcome Call': r.welcome_call || 'Not Called',
          'First Appt': r.first_appt || '—', 'Chart Status': r.chart_status || '—',
        };
      });
      return { filename: 'This_Weeks_Referrals', sheets: [{ name: 'Referrals', rows: rows }] };
    },
  },
  {
    id: 'intake_ref_sources',
    label: 'Pariox Referral Source Breakdown',
    dept: 'INTAKE',
    description: 'Which Pariox codes (CPA, ACA, HumA, etc.) are sending us referrals, mapped to canonical insurance names',
    async run() {
      var refs = await fetchAllPages(supabase.from('intake_referrals').select('patient_name,region,insurance,referral_status,date_received'));
      // Group by ref source proxy (insurance + region)
      var summary = {};
      refs.forEach(function(r) {
        var k = r.region + '|' + (r.insurance || 'UNKNOWN');
        if (!summary[k]) summary[k] = { region: r.region, insurance: r.insurance, total: 0, accepted: 0, denied: 0 };
        summary[k].total++;
        if (r.referral_status === 'Accepted') summary[k].accepted++;
        if (r.referral_status === 'Denied') summary[k].denied++;
      });
      var rows = Object.values(summary).map(function(s) {
        return {
          'Region': s.region, 'Insurance': s.insurance, 'Total Referrals': s.total,
          'Accepted': s.accepted, 'Denied': s.denied,
          'Acceptance Rate %': s.total > 0 ? Math.round(s.accepted / s.total * 100) : 0,
        };
      }).sort(function(a, b) { return b['Total Referrals'] - a['Total Referrals']; });
      return { filename: 'Referral_Sources', sheets: [{ name: 'Referral Sources', rows: rows }] };
    },
  },

  // ── OPERATIONS (CROSS-DEPT) ───────────────────────────────────────
  {
    id: 'ops_master',
    label: 'Full Patient Master (every audit column)',
    dept: 'OPERATIONS',
    description: 'Mirrors the original audit XLSX format — every column for every active patient. Use this for the next round of audit.',
    async run() {
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,address,discipline,ref_source,insurance,status,inferred_frequency,status_changed_at,pipeline_assigned_to'));
      var auths = await fetchAllPages(supabase.from('auth_tracker').select('patient_name,region,is_ppo,soc_date,auth_start_date,auth_expiry_date,visits_authorized,evals_authorized,reassessments_authorized,is_scheduled,notes,assigned_to').eq('is_currently_active', true));
      var authMap = {};
      auths.forEach(function(a) { authMap[(a.patient_name || '').toLowerCase().trim() + '|' + a.region] = a; });
      var rows = census.map(function(c) {
        var a = authMap[(c.patient_name || '').toLowerCase().trim() + '|' + c.region] || {};
        return {
          'Patient': c.patient_name, 'Region': c.region, 'Address': c.address,
          'Disc': c.discipline, 'Ref Source': c.ref_source, 'Insurance': c.insurance,
          'SOC': a.soc_date, 'PPO?': a.is_ppo === true ? 'YES' : a.is_ppo === false ? 'NO' : '',
          'AUTH START DATE': a.auth_start_date, 'AUTH END DATE': a.auth_expiry_date,
          'APPROVED # VISITS': a.visits_authorized,
          'APPROVED # EVALS': a.evals_authorized,
          'APPROVED # RAs': a.reassessments_authorized,
          'NOTES': a.notes, 'Status': c.status,
          'SCHEDULED?': a.is_scheduled === true ? 'YES' : a.is_scheduled === false ? 'NO' : '',
          'FREQUENCY': c.inferred_frequency,
          'Auth Coord': a.assigned_to, 'Care Coord': c.pipeline_assigned_to,
        };
      });
      return { filename: 'Full_Patient_Master', sheets: [{ name: 'Patient Master', rows: rows }] };
    },
  },
  {
    id: 'ops_stuck',
    label: 'Stuck Patients (all stages, all owners)',
    dept: 'OPERATIONS',
    description: 'Every patient past their stage threshold — cross-department accountability list',
    async run() {
      var census = await fetchAllPages(supabase.from('census_data').select('patient_name,region,insurance,status,status_changed_at,pipeline_assigned_to'));
      function stageFor(s) {
        if (/soc.*pending/i.test(s)) return { label: 'SOC Pending', threshold: 3, owner: 'Auth Team' };
        if (/auth.*pending/i.test(s) && !/active/i.test(s)) return { label: 'Auth Pending', threshold: 5, owner: 'Auth Team' };
        if (/eval.*pending/i.test(s)) return { label: 'Eval Pending', threshold: 2, owner: 'Care Coord' };
        return null;
      }
      var rows = census.map(function(c) {
        var stage = stageFor(c.status || '');
        if (!stage) return null;
        var d = c.status_changed_at ? Math.ceil((Date.now() - new Date(c.status_changed_at).getTime()) / 86400000) : null;
        if (d === null || d <= stage.threshold) return null;
        return {
          'Patient': c.patient_name, 'Region': c.region, 'Insurance': c.insurance,
          'Stage': stage.label, 'Days Stuck': d, 'Threshold': stage.threshold,
          'Owner Team': stage.owner,
          'Assigned': c.pipeline_assigned_to || '⚠ unassigned',
        };
      }).filter(function(r) { return r !== null; }).sort(function(a, b) { return b['Days Stuck'] - a['Days Stuck']; });
      return { filename: 'Stuck_Patients', sheets: [{ name: 'Stuck Patients', rows: rows }] };
    },
  },
];

const DEPT_META = {
  AUTHORIZATION:     { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE', icon: '🔐' },
  'CARE COORDINATION': { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', icon: '👥' },
  CLINICAL:          { color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE', icon: '🩺' },
  INTAKE:            { color: '#D97706', bg: '#FFFBEB', border: '#FCD34D', icon: '📥' },
  OPERATIONS:        { color: '#0F1117', bg: '#F3F4F6', border: '#D1D5DB', icon: '⚙️' },
};

export default function DepartmentReportsPage() {
  const { profile } = useAuth();
  const [running, setRunning] = useState(null);
  const [lastRun, setLastRun] = useState({});

  async function runReport(report) {
    setRunning(report.id);
    try {
      var result = await report.run();
      // Build workbook
      var wb = XLSX.utils.book_new();
      result.sheets.forEach(function(s) {
        var ws = XLSX.utils.json_to_sheet(s.rows);
        // Freeze header row
        ws['!freeze'] = { xSplit: 0, ySplit: 1 };
        XLSX.utils.book_append_sheet(wb, ws, s.name);
      });
      var dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, result.filename + '_' + dateStr + '.xlsx');
      setLastRun(Object.assign({}, lastRun, { [report.id]: { count: result.sheets.reduce(function(s, sh) { return s + sh.rows.length; }, 0), at: new Date() } }));
    } catch (e) {
      console.error('Report error:', e);
      alert('Error generating ' + report.label + ': ' + e.message);
    } finally {
      setRunning(null);
    }
  }

  // Group reports by dept for display
  var byDept = {};
  REPORTS.forEach(function(r) {
    if (!byDept[r.dept]) byDept[r.dept] = [];
    byDept[r.dept].push(r);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg)' }}>
      <TopBar title="Department Reports" subtitle="One-click XLSX exports grouped by department" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
            <strong style={{ color: '#111827' }}>How this works:</strong> each report runs against current production data and downloads as a formatted XLSX.
            Reports are grouped by the department that uses them most. The <strong>Full Patient Master</strong> under Operations
            mirrors the original audit XLSX format — use that for the next round of the weekly audit.
          </div>
        </div>

        {Object.keys(DEPT_META).map(function(dept) {
          var reports = byDept[dept] || [];
          if (reports.length === 0) return null;
          var meta = DEPT_META[dept];
          return (
            <div key={dept} style={{ marginBottom: 20 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                padding: '8px 12px', background: meta.bg, border: '1px solid ' + meta.border,
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 18 }}>{meta.icon}</span>
                <div style={{ fontSize: 13, fontWeight: 800, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {dept} DEPARTMENT
                </div>
                <span style={{ fontSize: 10, color: meta.color, opacity: 0.7 }}>· {reports.length} report{reports.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
                {reports.map(function(r) {
                  var isRunning = running === r.id;
                  var ran = lastRun[r.id];
                  return (
                    <div key={r.id} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{r.label}</div>
                      <div style={{ fontSize: 10, color: '#6B7280', lineHeight: 1.4, flex: 1 }}>{r.description}</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                        <button
                          onClick={function() { runReport(r); }}
                          disabled={isRunning}
                          style={{
                            padding: '6px 14px', background: isRunning ? '#9CA3AF' : meta.color,
                            color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 700,
                            cursor: isRunning ? 'wait' : 'pointer',
                          }}>
                          {isRunning ? 'Generating…' : '↓ Export XLSX'}
                        </button>
                        {ran && (
                          <span style={{ fontSize: 9, color: '#10B981' }}>
                            ✓ {ran.count} rows · {ran.at.toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
}
