// =============================================================================
// MedicareTrackerPage.jsx — flat roster redesign (2026-06-01, Phase 2)
//
// Replaces the previous PT-accordion view (which Liam called "very confusing")
// with a single sortable roster — one row per straight-Medicare patient — that
// matches Liam's Excel spec column-for-column. Each row tracks the patient's
// 20-visit cap, 10-visit progress-note rule, 30-day rolling note rule, and
// ready-for-discharge state.
//
// Key Phase-2 changes (vs the prior file at this path):
//   * Single flat table, 15 columns, sortable. No accordion.
//   * Color-coded rows by severity bucket (over cap > 20 > 18-19 > 10+ > 8-9).
//   * Right-side drawer for drill-down: visit history, progress-note + DC-note
//     submission, roster notes, KX cap-override (admin/super_admin only).
//   * Hard-stop enforced at the DB level via trg_enforce_medicare_visit_cap;
//     UI shows admin override modal that writes cap_override_by/at/reason.
//   * Auto-flagging "Ready for Discharge" is owned by the DB trigger
//     trg_flag_medicare_ready_for_discharge — this page just renders the flag.
//   * Recalculate populates new persisted columns (address, discipline,
//     ref_source, patient_status, assistant_therapist, evaluation_date,
//     10th/20th actual+projected visit dates) so the roster renders without
//     re-deriving on each load.
//   * Escalation ladder for alerts (visits 8/9/10 progress-note + 18/19/20
//     discharge-note) fires from recalculate; ready-for-discharge alert at
//     visit 20 is owned by the DB trigger.
//   * One-click XLSX export matching Liam's spec column order.
//
// Preserved from prior file (DO NOT REWRITE):
//   * isStraightMedicare() classifier — excludes Medicare Advantage.
//   * Rolling 10-visit OR 30-day progress-note rule (CMS Pub 100-02 Ch15 §220.3).
//   * Discipline-aware evaluating-PT selection (PTAs/COTAs blocked from lead).
//   * supabase + fetchAllPages + useRealtimeTable + useAssignedRegions plumbing.
//
// CLAUDE.md compliance:
//   * fetchAllPages used for visit_schedule_data + insurance_abbreviations
//     + census_data + coordinators + clinicians.
//   * No unicode in JSX text — ASCII strings or wrapped in {'...'} expressions.
//   * No hardcoded $230; not relevant on this page.
//   * Sun-Sat week math not used here (no weekly aggregation).
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { REGION_COORD } from '../../lib/alertEngine';
import { isCompleted, isEval, dedupEncounters } from '../../lib/visitMath';

// --- helpers ---------------------------------------------------------------

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const ADMIN_ROLES = new Set(['super_admin', 'admin', 'director', 'ceo']);

// 2026-06-30 — when a chart is flagged "Needs Audit" the following four
// people get a high-priority alert. Per Liam: these names are intentionally
// hard-wired (the alert UI has no per-recipient routing yet, and these four
// all have all-region access so the single alert will land in their bell).
// IDs sourced from coordinators table on 2026-06-30. Names are kept here for
// the alert message body; IDs go into metadata so we can grow into per-user
// routing later without rewriting the trigger logic.
const AUDIT_ALERT_RECIPIENTS = [
  { id: '24580169-8fea-4d42-97c3-2e4c779c3101', name: 'Hervylie Senica' },
  { id: '646223a8-20b0-4d37-805d-b96d79c0f77c', name: 'Carla Smith' },
  { id: '1fe789dc-ac6e-4289-a48e-8c2bbfa31637', name: "Liam O'Brien" },
  { id: '7507c50d-0a27-4496-9466-36a989539b2d', name: 'Randi Bonner' },
];

const PATIENT_STATUS_OPTIONS = [
  'Active', 'SOC Pending', 'On Hold', 'Hospitalized', 'Discharge', 'Non-Admit', 'Waitlist',
];

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
// Compact "Jun 19 '26" form for in-row dates where horizontal real estate is
// at a premium. Used in the roster row's Eval column and the 10th/20th
// milestone sub-line. Full fmtDate stays for headers, modals, and exports.
function fmtDateShort(d) {
  if (!d) return '-';
  const parts = new Date(d + 'T00:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: '2-digit' }).split(', ');
  return parts.length === 2 ? `${parts[0]} '${parts[1]}` : parts[0];
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(yyyymmdd, days) {
  if (!yyyymmdd) return null;
  const d = new Date(yyyymmdd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
// "Last, First" -> "First Last". Pariox stores staff "Last, First"; clinicians
// table stores full_name "First Last".
function flipName(name) {
  if (!name) return '';
  const m = name.match(/^\s*([^,]+),\s*(.+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : name.trim();
}

// Insurance classifier. Single source of truth for "is this Medicare?" — see
// the long-form comment in the original file (preserved here). Straight
// Medicare ONLY; Advantage plans (Aetna Medicare, Cigna Medicare, CarePlus,
// Humana, Devoted) follow private rules, not Medicare's 10/20.
function buildInsuranceClassifier(rows) {
  const byId = new Map();
  for (const r of (rows || [])) {
    for (const id of [r.display_name, r.insurance_name, r.abbreviation]) {
      if (id) byId.set(id.toLowerCase().trim(), r.category);
    }
  }
  return byId;
}
function isStraightMedicare(insurance, classifier) {
  if (!insurance) return false;
  const cat = classifier.get(insurance.toLowerCase().trim());
  if (cat) return cat === 'Medicare';
  const stripped = insurance.replace(/^[A-Za-z0-9]{1,3}\s*-\s*/, '').trim().toLowerCase();
  return stripped === 'medicare';
}

// Project a future visit-N date from cadence. Uses last-12-week visit
// frequency. Returns null if there's no history to extrapolate from.
function projectVisitDate(careStartDate, lastVisitDate, currentCount, targetVisit) {
  if (!careStartDate || !lastVisitDate || currentCount >= targetVisit) return null;
  const elapsedDays = daysBetween(careStartDate, lastVisitDate) || 1;
  const visitsPerDay = currentCount / Math.max(elapsedDays, 1);
  if (visitsPerDay <= 0) return null;
  const remaining = targetVisit - currentCount;
  const daysAhead = Math.ceil(remaining / visitsPerDay);
  return addDaysIso(todayISO(), Math.min(daysAhead, 365)); // cap forecast at 1y
}

// --- severity bucket -------------------------------------------------------
// Per-episode count is the cap-relevant number (Phase 3 / 2026-06-01).
// Falls back to total_completed_visits for the first time the page is loaded
// after a fresh patient is added before recalc has populated the episode.
function visitsForCap(f) {
  if (f?.current_episode_visit_count != null) return f.current_episode_visit_count;
  return f?.total_completed_visits || 0;
}
function bucketOf(f) {
  const v = visitsForCap(f);
  if (v >= 21) return 'over_cap';
  if (v >= 20) return 'discharge';
  if (v >= 18) return 'dc_soon';
  if (v >= 10 && f?.progress_note_due) return 'note_overdue';
  if (v >= 8) return 'note_soon';
  return 'ok';
}
// True when Pariox-derived current-episode count and Liam's manual import
// disagree by more than 2 visits. Helps surface mismatches without picking a
// winner; 2-visit fuzz is normal (timing of upload + reconciliation lag).
function manualDriftOf(f) {
  if (f?.manual_visit_count == null || f?.current_episode_visit_count == null) return 0;
  return Math.abs(f.current_episode_visit_count - f.manual_visit_count);
}
// 2026-06-30 redesign: fewer columns, lighter palette, a 4px colored left-
// accent stripe instead of the cryptic X/!/~/*/.  bucket icon. Only OVER CAP
// keeps a faint row tint (because it IS an emergency); everything else relies
// on the stripe + a small bucket chip in the Status column.
const BUCKET_STYLE = {
  over_cap:     { accent: '#7F1D1D', tint: '#FEF2F2', label: 'OVER CAP'  },
  discharge:    { accent: '#DC2626', tint: 'transparent', label: 'READY DC' },
  dc_soon:      { accent: '#7C3AED', tint: 'transparent', label: 'DC SOON'   },
  note_overdue: { accent: '#EA580C', tint: 'transparent', label: 'NOTE DUE'  },
  note_soon:    { accent: '#CA8A04', tint: 'transparent', label: 'NOTE SOON' },
  ok:           { accent: 'transparent', tint: 'transparent', label: ''     },
};

// --- column definitions (2026-06-30 condensed layout) ---------------------
// Was 15 cols (Liam's Excel spec). Reduced to 7 by stacking related fields
// inside one cell. The XLSX export still emits all 15 fields for parity with
// Liam's spreadsheet workflow — only the on-screen table is condensed.
const COLS = [
  { key: 'patient_name',           label: 'Patient',    w: 240, sortBy: 'patient_name' },
  { key: 'patient_status',         label: 'Status',     w: 130, sortBy: 'patient_status' },
  { key: 'evaluation_date',        label: 'Eval',       w: 90,  sortBy: 'evaluation_date' },
  { key: 'therapists',             label: 'Therapists', w: 200, sortBy: 'evaluating_pt' },
  { key: 'progress',               label: 'Progress',   w: 180, sortBy: 'total_completed_visits' },
  { key: 'roster_notes',           label: 'Notes',      w: 240, sortBy: null },
  { key: 'action',                 label: '',           w: 130, sortBy: null },
  { key: 'audit',                  label: 'Audit',      w: 70,  sortBy: null },
];

const AUDIT_COLS = [
  { key: 'patient_name',           label: 'Patient',      w: 220, sortBy: 'patient_name' },
  { key: 'audit_reason',           label: 'Audit Reason', w: 240, sortBy: 'needs_audit_flagged_at' },
  { key: 'patient_status',         label: 'Status',       w: 150, sortBy: 'patient_status' },
  { key: 'evaluation_date',        label: 'Eval Date',    w: 130, sortBy: 'evaluation_date' },
  { key: 'therapists',             label: 'Therapists',   w: 240, sortBy: 'evaluating_pt' },
  { key: 'progress',               label: 'Progress',     w: 170, sortBy: 'total_completed_visits' },
  { key: 'audit_actions',          label: '',             w: 200, sortBy: null },
];

// =============================================================================
// MAIN PAGE
// =============================================================================
export default function MedicareTrackerPage() {
  const { profile } = useAuth();
  const isAdmin = profile && ADMIN_ROLES.has(profile.role);

  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [view, setView] = useState('active'); // 'active' | 'audit'
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterDiscipline, setFilterDiscipline] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterBucket, setFilterBucket] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');
  const [sortKey, setSortKey] = useState('total_completed_visits');
  const [sortDir, setSortDir] = useState('desc');
  // Audit flagging modal — opens with the chosen row + an empty reason field
  const [auditPrompt, setAuditPrompt] = useState(null);
  const [auditReason, setAuditReason] = useState('');
  const [auditBusy, setAuditBusy] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null); // flag row or null
  const [confirmDischarge, setConfirmDischarge] = useState(null); // flag row or null
  const [dischargeNote, setDischargeNote] = useState('');
  const [dischargeBusy, setDischargeBusy] = useState(false);
  const [dischargeMsg, setDischargeMsg] = useState('');
  // Clinician picker (used by Audit rows). pickerState = { flag, slot } or null
  // where slot is 'lead' | 'assistant'.
  const [allClinicians, setAllClinicians] = useState([]);
  const [assignmentsByPatient, setAssignmentsByPatient] = useState({});
  const [pickerState, setPickerState] = useState(null);

  // ─── Discharge action (one-tap from row) ──────────────────────────────
  // Marks the patient's census status as Discharge, deactivates the Medicare
  // flag row so it drops off the tracker (the page filters by is_active=true),
  // and writes a high-priority alert routed to the regional care coordination
  // team so they know to start the transition-of-care workflow.
  //
  // 2026-06-30: every write is error-checked. Two of the three Supabase calls
  // used to swallow errors silently (pattern #15 in CLAUDE.md) — Ariel reported
  // discharges that "succeeded" but left the row stuck on the roster. The
  // missing `is_active=false` was the actual cause of the stuck rows; the
  // error-check guards against the same UX lie returning under a different
  // failure mode (RLS, trigger raise, network blip).
  async function dischargePatient(flag, note) {
    setDischargeBusy(true);
    setDischargeMsg('');
    try {
      const today = new Date().toISOString().slice(0, 10);
      const actor = profile?.full_name || profile?.email || 'Unknown';

      // 1) Flip the census status to "Discharge"
      const { error: censusErr } = await supabase
        .from('census_data')
        .update({ status: 'Discharge', updated_by: actor, status_changed_at: new Date().toISOString() })
        .eq('patient_name', flag.patient_name);
      if (censusErr) throw new Error(`census_data update failed: ${censusErr.message}`);

      // 2) Deactivate the Medicare flag row so it drops off the tracker, and
      //    record the discharge details for the audit trail / re-recalc path.
      const { error: flagErr } = await supabase
        .from('medicare_visit_flags')
        .update({
          is_active: false,
          flag_20th_acknowledged: true,
          ready_for_discharge: false,
          twentieth_visit_discharge_note_date: today,
          patient_status: 'Discharge',
          updated_at: new Date().toISOString(),
          roster_notes: note
            ? `${flag.roster_notes ? flag.roster_notes + ' | ' : ''}Discharged ${today} by ${actor}: ${note}`
            : `${flag.roster_notes ? flag.roster_notes + ' | ' : ''}Discharged ${today} by ${actor}`,
        })
        .eq('patient_name', flag.patient_name);
      if (flagErr) throw new Error(`medicare_visit_flags update failed: ${flagErr.message}`);

      // 3) Notify care coordination team (regional). Non-fatal — if the alert
      //    insert fails the discharge itself has already succeeded.
      const region = flag.region || null;
      const { error: alertErr } = await supabase.from('alerts').insert({
        alert_type: 'patient_discharged',
        priority: 'high',
        title: `Discharge: ${flag.patient_name}${region ? ` (Region ${region})` : ''}`,
        message:
          `${flag.patient_name} was discharged from Medicare services by ${actor} on ${today}.` +
          (note ? ` Note: ${note}` : '') +
          ' Please coordinate transition of care, notify referring provider, and update patient records.',
        patient_name: flag.patient_name,
        region: region,
        coordinator_region: region,
        assigned_to_region: region,
        related_date: today,
        metadata: {
          source: 'medicare_tracker',
          actor: actor,
          actor_email: profile?.email,
          discharge_note: note || null,
          visits_completed: flag.total_completed_visits ?? null,
        },
        is_read: false,
        is_dismissed: false,
      });
      if (alertErr) console.warn('Discharge alert insert failed (non-fatal):', alertErr.message);

      // 4) Audit trail
      logActivity({
        coordinatorId: profile?.id,
        coordinatorName: profile?.full_name,
        coordinatorRole: profile?.role,
        actionType: 'medicare_patient_discharged',
        actionDetail: `Discharged ${flag.patient_name}${region ? ` (Region ${region})` : ''}${note ? ` — ${note}` : ''}`,
        patientName: flag.patient_name,
        tableName: 'census_data',
        recordId: flag.id,
        metadata: { source: 'medicare_tracker', region, visits_completed: flag.total_completed_visits },
      });

      const alertWarning = alertErr ? ' (care-coord alert pending — see console)' : ' Care coord notified.';
      setDischargeMsg(`${flag.patient_name} discharged and cleared from tracker.${alertWarning}`);
      setConfirmDischarge(null);
      setDischargeNote('');
      setTimeout(() => setDischargeMsg(''), 4000);
      loadFlags();
    } catch (e) {
      console.error('Discharge failed', e);
      setDischargeMsg(`Discharge failed: ${e?.message || e}`);
    } finally {
      setDischargeBusy(false);
    }
  }

  // ─── Needs Audit flag (Active roster -> Audit lane) ─────────────────
  // Sets needs_audit + reason + actor on the flag row, then fires a single
  // high-priority alert addressed to Hervylie, Carla, Liam, and Randi. The
  // row drops off Active and surfaces in the Needs Audit tab where the named
  // fields can be edited without recalc clobbering the edits.
  async function flagForAudit(flag, reason) {
    setAuditBusy(true);
    setDischargeMsg('');
    try {
      const actor = profile?.full_name || profile?.email || 'Unknown';
      const trimmed = (reason || '').trim();
      if (!trimmed) throw new Error('Audit reason is required');

      const { error: updErr } = await supabase
        .from('medicare_visit_flags')
        .update({
          needs_audit: true,
          needs_audit_reason: trimmed,
          needs_audit_flagged_by: actor,
          needs_audit_flagged_at: new Date().toISOString(),
          needs_audit_resolved_at: null,
          needs_audit_resolved_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', flag.id);
      if (updErr) throw new Error(`flag update failed: ${updErr.message}`);

      const region = flag.region || null;
      const recipientNames = AUDIT_ALERT_RECIPIENTS.map(r => r.name).join(', ');
      const { error: alertErr } = await supabase.from('alerts').insert({
        alert_type: 'medicare_chart_needs_audit',
        priority: 'high',
        title: `Chart needs audit: ${flag.patient_name}${region ? ` (Region ${region})` : ''}`,
        message:
          `${actor} flagged ${flag.patient_name} for audit. ` +
          `Reason: "${trimmed}". ` +
          `Please review in the Medicare Tracker -> Needs Audit tab. ` +
          `Notifying: ${recipientNames}.`,
        patient_name: flag.patient_name,
        region,
        coordinator_region: region,
        assigned_to_region: region,
        related_date: new Date().toISOString().slice(0, 10),
        metadata: {
          source: 'medicare_tracker_audit_flag',
          actor,
          actor_email: profile?.email,
          reason: trimmed,
          recipients: AUDIT_ALERT_RECIPIENTS,
          medicare_flag_id: flag.id,
          visits_completed: flag.total_completed_visits ?? null,
        },
        is_read: false,
        is_dismissed: false,
      });
      if (alertErr) console.warn('Audit alert insert failed (non-fatal):', alertErr.message);

      logActivity({
        coordinatorId: profile?.id,
        coordinatorName: profile?.full_name,
        coordinatorRole: profile?.role,
        actionType: 'medicare_chart_needs_audit',
        actionDetail: `Flagged ${flag.patient_name}${region ? ` (Region ${region})` : ''} for audit: ${trimmed}`,
        patientName: flag.patient_name,
        tableName: 'medicare_visit_flags',
        recordId: flag.id,
        metadata: { source: 'medicare_tracker', region, reason: trimmed },
      });

      setAuditPrompt(null);
      setAuditReason('');
      setDischargeMsg(`${flag.patient_name} moved to Needs Audit. Notified ${recipientNames}.`);
      setTimeout(() => setDischargeMsg(''), 4500);
      loadFlags();
    } catch (e) {
      console.error('Audit flag failed', e);
      setDischargeMsg(`Audit flag failed: ${e?.message || e}`);
    } finally {
      setAuditBusy(false);
    }
  }

  // ─── Save inline edits from the Needs Audit table ────────────────────
  // Used by AuditRosterRow's Save button. patch is a partial object of the
  // editable fields (patient_status, evaluation_date, evaluating_pt,
  // assistant_therapist, current_episode_visit_count, total_completed_visits).
  async function saveAuditEdits(flag, patch) {
    const actor = profile?.full_name || profile?.email || 'Unknown';
    const { error } = await supabase
      .from('medicare_visit_flags')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', flag.id);
    if (error) {
      setDischargeMsg(`Save failed: ${error.message}`);
      return false;
    }
    logActivity({
      coordinatorId: profile?.id,
      coordinatorName: profile?.full_name,
      coordinatorRole: profile?.role,
      actionType: 'medicare_audit_edit',
      actionDetail: `Edited ${flag.patient_name} during audit: ${Object.keys(patch).join(', ')}`,
      patientName: flag.patient_name,
      tableName: 'medicare_visit_flags',
      recordId: flag.id,
      metadata: { source: 'medicare_tracker_audit', actor, fields: Object.keys(patch) },
    });
    setDischargeMsg(`${flag.patient_name} updated.`);
    setTimeout(() => setDischargeMsg(''), 2500);
    loadFlags();
    return true;
  }

  // Reset the per-episode visit counters and start a new episode. Original
  // visit_schedule_data history stays intact — this only resets the tracker's
  // per-episode counters that the cap math reads from.
  async function restartTracker(flag) {
    const actor = profile?.full_name || profile?.email || 'Unknown';
    const today = new Date().toISOString().slice(0, 10);
    const newEpisode = (flag.current_episode_number || 1) + 1;
    const { error } = await supabase
      .from('medicare_visit_flags')
      .update({
        current_episode_number: newEpisode,
        current_episode_visit_count: 0,
        current_episode_start_date: today,
        ready_for_discharge: false,
        flag_20th_acknowledged: false,
        flag_10th_acknowledged: false,
        progress_note_due: false,
        progress_note_due_reason: null,
        last_progress_note_date: today,
        last_progress_note_visit: 0,
        next_due_visit: 10,
        next_due_date: addDaysIso(today, 30),
        twentieth_visit_actual_date: null,
        twentieth_visit_projected_date: null,
        twentieth_visit_discharge_note_date: null,
        tenth_visit_actual_date: null,
        tenth_visit_projected_date: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', flag.id);
    if (error) {
      setDischargeMsg(`Restart failed: ${error.message}`);
      return;
    }
    logActivity({
      coordinatorId: profile?.id,
      coordinatorName: profile?.full_name,
      coordinatorRole: profile?.role,
      actionType: 'medicare_tracker_restart',
      actionDetail: `Restarted tracker for ${flag.patient_name} (now episode ${newEpisode})`,
      patientName: flag.patient_name,
      tableName: 'medicare_visit_flags',
      recordId: flag.id,
      metadata: { source: 'medicare_tracker_audit', actor, new_episode: newEpisode },
    });
    setDischargeMsg(`${flag.patient_name} tracker restarted (now episode ${newEpisode}).`);
    setTimeout(() => setDischargeMsg(''), 3000);
    loadFlags();
  }

  // Clear the needs_audit flag and return the row to the Active roster.
  async function resolveAudit(flag) {
    const actor = profile?.full_name || profile?.email || 'Unknown';
    const { error } = await supabase
      .from('medicare_visit_flags')
      .update({
        needs_audit: false,
        needs_audit_resolved_at: new Date().toISOString(),
        needs_audit_resolved_by: actor,
        updated_at: new Date().toISOString(),
      })
      .eq('id', flag.id);
    if (error) {
      setDischargeMsg(`Resolve failed: ${error.message}`);
      return;
    }
    logActivity({
      coordinatorId: profile?.id,
      coordinatorName: profile?.full_name,
      coordinatorRole: profile?.role,
      actionType: 'medicare_audit_resolved',
      actionDetail: `Resolved audit for ${flag.patient_name}`,
      patientName: flag.patient_name,
      tableName: 'medicare_visit_flags',
      recordId: flag.id,
      metadata: { source: 'medicare_tracker_audit', actor },
    });
    setDischargeMsg(`${flag.patient_name} audit resolved. Returned to Active roster.`);
    setTimeout(() => setDischargeMsg(''), 3000);
    loadFlags();
  }

  const regionScope = useAssignedRegions();

  // --- recalc -----------------------------------------------------------
  // Walks census + visit_schedule_data, refreshes every medicare_visit_flags
  // row, fires the escalation-ladder alerts. The DB trigger handles
  // ready_for_discharge + the critical alert at visit 20.
  const recalculate = useCallback(async () => {
    setCalculating(true);
    try {
      const insRows = await fetchAllPages(supabase.from('insurance_abbreviations')
        .select('abbreviation, display_name, insurance_name, category'));
      const insClassifier = buildInsuranceClassifier(insRows);

      const mcPtsRaw = await fetchAllPages(supabase.from('census_data')
        .select('patient_name, region, insurance, address, discipline, ref_source, status'));
      const mcPts = (mcPtsRaw || []).filter(p => isStraightMedicare(p.insurance, insClassifier));

      // Purge flag rows for patients no longer in census (soft-archive, not delete).
      const keepNames = new Set(mcPts.map(p => p.patient_name));
      const { data: existingFlags } = await supabase.from('medicare_visit_flags')
        .select('patient_name, is_active');
      const goneNames = (existingFlags || []).map(r => r.patient_name).filter(n => !keepNames.has(n));
      if (goneNames.length) {
        await supabase.from('medicare_visit_flags')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in('patient_name', goneNames);
      }

      const visits = await fetchAllPages(supabase.from('visit_schedule_data')
        .select('patient_name, staff_name, staff_name_normalized, event_type, status, visit_date, region'));

      const clinicians = await fetchAllPages(supabase.from('clinicians')
        .select('full_name, aliases, discipline'));
      const disciplineByName = new Map();
      for (const c of (clinicians || [])) {
        if (c.full_name) disciplineByName.set(c.full_name.toLowerCase().trim(), c.discipline);
        (c.aliases || []).forEach(a => { if (a) disciplineByName.set(a.toLowerCase().trim(), c.discipline); });
      }
      const therapistName = v => (v.staff_name_normalized || flipName(v.staff_name) || '').trim();
      const disciplineOf = n => disciplineByName.get((n || '').toLowerCase().trim());
      const isLead = n => { const d = disciplineOf(n); return d === 'PT' || d === 'OT'; };
      const isAssistant = n => { const d = disciplineOf(n); return d === 'PTA' || d === 'COTA'; };

      const escalationAlerts = [];
      const escalationTasks = [];
      const today = todayISO();

      // Pre-fetch needs_audit state for every Medicare patient so the loop
      // can skip audited rows without doing a per-iteration round trip.
      const { data: auditFlagRows } = await supabase.from('medicare_visit_flags')
        .select('patient_name, needs_audit').eq('needs_audit', true);
      const auditedPatientNames = new Set((auditFlagRows || []).map(r => r.patient_name));

      for (const pt of mcPts) {
        // Skip rows currently flagged for audit — Ariel's manual edits would
        // be overwritten otherwise. Recalc resumes once needs_audit clears.
        if (auditedPatientNames.has(pt.patient_name)) continue;

        // Completed visits only (via canonical isCompleted), deduped to one
        // encounter per (patient, date) so PT+PTA co-treat slots don't double.
        const ptVisitsRaw = (visits || []).filter(v => v.patient_name === pt.patient_name && isCompleted(v));
        const ptVisits = dedupEncounters(ptVisitsRaw).sort((a, b) =>
          (a.visit_date || '').localeCompare(b.visit_date || ''));

        if (ptVisits.length === 0) {
          // Patient is on Medicare census but has no completed visits yet.
          // Upsert a minimal row so the roster shows them. is_active is omitted
          // so the column default (true) applies on insert and existing values
          // are preserved on update — never resurrect a manually-discharged row.
          await supabase.from('medicare_visit_flags').upsert({
            patient_name: pt.patient_name,
            region: pt.region,
            insurance: pt.insurance,
            address: pt.address,
            discipline: pt.discipline,
            ref_source: pt.ref_source,
            patient_status: pt.status,
            total_completed_visits: 0,
            last_calculated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'patient_name' });
          continue;
        }

        const total = ptVisits.length;
        const evalVisit = ptVisits.find(isEval);
        const careStartDate = evalVisit?.visit_date || ptVisits[0].visit_date;
        const lastVisitDate = ptVisits[ptVisits.length - 1].visit_date;

        // Evaluating therapist — prefer the eval visit's clinician if PT/OT,
        // else most-frequent PT/OT among visits. PTAs/COTAs ineligible.
        const counts = {};
        for (const v of ptVisits) {
          const n = therapistName(v);
          if (n) counts[n] = (counts[n] || 0) + 1;
        }
        const evalName = evalVisit ? therapistName(evalVisit) : null;
        const evaluatingPt = (evalName && isLead(evalName))
          ? evalName
          : (Object.entries(counts).filter(([n]) => isLead(n)).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Unassigned');

        // Assistant therapist (PTA/COTA) — most-frequent assistant, null if none.
        const assistant = Object.entries(counts)
          .filter(([n]) => isAssistant(n))
          .sort((a,b) => b[1]-a[1])[0]?.[0] || null;

        // 10th/20th visit actual dates from visit history.
        const tenthActual    = total >= 10 ? ptVisits[9].visit_date  : null;
        const twentiethActual = total >= 20 ? ptVisits[19].visit_date : null;
        const tenthProjected     = tenthActual    ? null : projectVisitDate(careStartDate, lastVisitDate, total, 10);
        const twentiethProjected = twentiethActual ? null : projectVisitDate(careStartDate, lastVisitDate, total, 20);

        // Rolling progress-note clock (preserved from prior implementation).
        const { data: existing } = await supabase.from('medicare_visit_flags')
          .select('id, is_active, flag_10th_acknowledged, flag_20th_acknowledged, last_progress_note_date, last_progress_note_visit, ready_for_discharge, cap_override_by, roster_notes, kx_modifier_applied, tenth_visit_note_submitted_date, twentieth_visit_discharge_note_date')
          .eq('patient_name', pt.patient_name).maybeSingle();

        const anchorDate  = existing?.last_progress_note_date  || careStartDate;
        const anchorVisit = existing?.last_progress_note_visit || 0;
        const nextDueVisit = anchorVisit + 10;
        const nextDueDate  = addDaysIso(anchorDate, 30);

        const overVisit = total >= nextDueVisit;
        const overDays  = today >= nextDueDate;
        const due = overVisit || overDays;
        let dueReason = null;
        if (due) {
          if (overVisit && overDays) {
            const tenthVisitDate = ptVisits[nextDueVisit - 1]?.visit_date;
            dueReason = (tenthVisitDate && tenthVisitDate <= nextDueDate) ? '10_visits' : '30_days';
          } else if (overVisit) {
            dueReason = '10_visits';
          } else {
            dueReason = '30_days';
          }
        }

        const flag10 = total >= 10;
        const flag20 = total >= 20;
        const ack10 = existing?.flag_10th_acknowledged || false;
        const ack20 = existing?.flag_20th_acknowledged || false;

        const payload = {
          patient_name: pt.patient_name,
          region: pt.region,
          insurance: pt.insurance,
          address: pt.address,
          discipline: pt.discipline,
          ref_source: pt.ref_source,
          patient_status: pt.status,
          evaluating_pt: evaluatingPt,
          assistant_therapist: assistant,
          total_completed_visits: total,
          care_start_date: careStartDate,
          evaluation_date: careStartDate,
          tenth_visit_actual_date: tenthActual,
          tenth_visit_projected_date: tenthProjected,
          twentieth_visit_actual_date: twentiethActual,
          twentieth_visit_projected_date: twentiethProjected,
          progress_note_due_date: nextDueDate,
          discharge_note_due_date: twentiethActual || twentiethProjected,
          next_due_visit: nextDueVisit,
          next_due_date: nextDueDate,
          progress_note_due: due,
          progress_note_due_reason: dueReason,
          flag_10th_note: flag10,
          flag_10th_acknowledged: ack10,
          flag_20th_discharge: flag20,
          flag_20th_acknowledged: ack20,
          // Preserve is_active=false when the row was cleared via the Discharge
          // button (signaled by existing.flag_20th_acknowledged=true). Patients
          // who got is_active=false from goneNames purging but are now back in
          // census (and never went through the discharge button) re-activate.
          is_active: !(existing?.is_active === false && existing?.flag_20th_acknowledged === true),
          last_calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await supabase.from('medicare_visit_flags')
          .upsert(payload, { onConflict: 'patient_name' });

        // --- Escalation-ladder alerts (visits 8/9/10 + 18/19/20) ---------
        // Critical "ready_for_discharge" at visit 20 is owned by the DB
        // trigger — we don't duplicate it here. We DO fire the
        // discharge-note alert (separate signal: PT must write the DC note).
        const coord = REGION_COORD[pt.region] || null;
        function queue(type, priority, title, message) {
          escalationAlerts.push({
            alert_type: type, priority, title, message,
            patient_name: pt.patient_name, clinician_name: evaluatingPt,
            region: pt.region, assigned_to_region: pt.region,
            is_read: false, is_dismissed: false,
            created_at: new Date().toISOString(),
          });
          escalationTasks.push({
            task_type: type, priority, title, description: message,
            patient_name: pt.patient_name, clinician_name: evaluatingPt,
            coordinator_region: pt.region, assigned_to: coord,
            status: 'open', auto_generated: true,
            due_date: today, created_at: new Date().toISOString(),
          });
        }

        // Progress-note ladder (skip if a note was submitted at/after this visit)
        const noteAlreadyAtTier = anchorVisit >= total;
        if (!noteAlreadyAtTier) {
          if (total === 8) {
            queue('medicare_progress_note_due', 'medium',
              'Progress note approaching (visit 8): ' + pt.patient_name,
              evaluatingPt + ' must prepare a Medicare progress note for ' + pt.patient_name +
              '. Currently at visit 8 of 10 — note due by visit 10 or 30 days from anchor.');
          } else if (total === 9) {
            queue('medicare_progress_note_due', 'high',
              'Progress note required next visit: ' + pt.patient_name,
              evaluatingPt + ' must submit Medicare progress note for ' + pt.patient_name +
              ' at the next visit (visit 10).');
          } else if (total >= 10 && due) {
            queue('medicare_progress_note_due', 'critical',
              'Progress note OVERDUE: ' + pt.patient_name,
              evaluatingPt + ' has NOT submitted the required Medicare progress note. ' +
              (dueReason === '10_visits' ? total + ' completed visits' : '30+ days since last note') + '.');
          }
        }

        // Discharge-note ladder
        const dcNoteSubmitted = !!existing?.twentieth_visit_discharge_note_date;
        if (!dcNoteSubmitted) {
          if (total === 18) {
            queue('medicare_discharge_note_due', 'medium',
              'Discharge planning required: ' + pt.patient_name,
              evaluatingPt + ' must begin discharge planning for ' + pt.patient_name +
              '. Currently at visit 18 of 20.');
          } else if (total === 19) {
            queue('medicare_discharge_note_due', 'high',
              'Discharge note must be drafted: ' + pt.patient_name,
              evaluatingPt + ' must draft Medicare discharge note for ' + pt.patient_name +
              '. Visit 19 of 20.');
          } else if (total >= 20) {
            queue('medicare_discharge_note_due', 'critical',
              'Discharge note REQUIRED: ' + pt.patient_name,
              evaluatingPt + ' must submit Medicare discharge note. Patient at ' + total +
              ' completed visits. 20-visit cap reached.');
          }
        }
      }

      // Fan out escalation alerts (dedupe at insertion via NOT EXISTS pattern
      // since the alerts table doesn't have a unique constraint).
      if (escalationAlerts.length) {
        const types = Array.from(new Set(escalationAlerts.map(a => a.alert_type)));
        // Clear stale open alerts/tasks for these types and re-seed current set.
        await supabase.from('alerts').delete()
          .in('alert_type', types)
          .eq('is_read', false)
          .eq('is_dismissed', false);
        await supabase.from('coordinator_tasks').delete()
          .in('task_type', types)
          .eq('auto_generated', true)
          .in('status', ['open', 'in_progress']);
        await supabase.from('alerts').insert(escalationAlerts);
        await supabase.from('coordinator_tasks').insert(escalationTasks);
      }
    } catch (err) {
      console.error('Medicare recalc error:', err);
    }
    setCalculating(false);
    loadFlags();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- load -------------------------------------------------------------
  const loadFlags = useCallback(async () => {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setFlags([]); setLoading(false); return;
    }
    const { data } = await regionScope.applyToQuery(
      supabase.from('medicare_visit_flags')
        .select('*')
        .eq('is_active', true)
    );
    setFlags(data || []);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useEffect(() => { loadFlags(); }, [loadFlags]);

  // ─── Clinician + assignments loader (for the Audit page dropdowns) ───
  // Pulls the full active-clinician roster once + every active assignment
  // for any patient currently in the audit lane. Builds two structures:
  //   allClinicians          — array used by the "Add therapist" picker
  //   assignmentsByPatient   — { [patient_name]: [{clinician_id, name, discipline, role}] }
  const loadAuditSupport = useCallback(async () => {
    const auditPatientNames = flags.filter(f => f.needs_audit).map(f => f.patient_name);
    const { data: clRows } = await supabase.from('clinicians')
      .select('id, full_name, discipline, region, is_active')
      .eq('is_active', true)
      .order('full_name');
    setAllClinicians(clRows || []);
    if (auditPatientNames.length === 0) { setAssignmentsByPatient({}); return; }
    const { data: assigns } = await supabase.from('patient_clinician_assignments')
      .select('patient_name, clinician_id, role, discipline, is_active, assigned_at')
      .in('patient_name', auditPatientNames)
      .eq('is_active', true);
    const byId = new Map((clRows || []).map(c => [c.id, c]));
    const byPatient = {};
    for (const a of (assigns || [])) {
      const cl = byId.get(a.clinician_id);
      if (!cl) continue;
      const item = {
        clinician_id: a.clinician_id,
        clinician_name: cl.full_name,
        discipline: a.discipline || cl.discipline,
        role: a.role,
      };
      (byPatient[a.patient_name] = byPatient[a.patient_name] || []).push(item);
    }
    setAssignmentsByPatient(byPatient);
  }, [flags]);
  useEffect(() => { if (view === 'audit') loadAuditSupport(); }, [view, loadAuditSupport]);

  // ─── Add a clinician to the patient's chart (patient_clinician_assignments) ─
  async function addClinicianAssignment(flag, clinician, role) {
    const actor = profile?.full_name || profile?.email || 'Unknown';
    // Use the clinician's own discipline; lead role typically lines up with
    // PT/OT and assistant with PTA/COTA, but we trust whatever the clinician
    // record says rather than enforcing it here.
    const { error } = await supabase.from('patient_clinician_assignments').insert({
      patient_key: (flag.patient_name || '').toLowerCase().trim(),
      patient_name: flag.patient_name,
      clinician_id: clinician.id,
      role,
      discipline: clinician.discipline,
      is_active: true,
      assigned_at: new Date().toISOString(),
      assigned_by: actor,
    });
    if (error) {
      setDischargeMsg(`Add therapist failed: ${error.message}`);
      return false;
    }
    logActivity({
      coordinatorId: profile?.id,
      coordinatorName: profile?.full_name,
      coordinatorRole: profile?.role,
      actionType: 'patient_clinician_assigned',
      actionDetail: `Assigned ${clinician.full_name} (${role}) to ${flag.patient_name}`,
      patientName: flag.patient_name,
      tableName: 'patient_clinician_assignments',
      recordId: flag.id,
      metadata: { source: 'medicare_tracker_audit', actor, role, clinician_id: clinician.id },
    });
    setDischargeMsg(`Added ${clinician.full_name} (${role}) to ${flag.patient_name}'s chart.`);
    setTimeout(() => setDischargeMsg(''), 3000);
    await loadAuditSupport();
    return true;
  }
  useRealtimeTable(['census_data', 'visit_schedule_data', 'medicare_visit_flags'], loadFlags);

  // --- derived view ----------------------------------------------------
  // Split flags by audit lane first — Active view hides audited rows, Audit
  // view shows only audited rows. Dropdown/search filters apply to whichever
  // lane the user is currently on.
  const activeFlags = useMemo(() => flags.filter(f => !f.needs_audit), [flags]);
  const auditFlags  = useMemo(() => flags.filter(f =>  f.needs_audit), [flags]);
  const sourceFlags = view === 'audit' ? auditFlags : activeFlags;

  const filtered = useMemo(() => {
    return sourceFlags.filter(f => {
      if (filterRegion !== 'ALL' && f.region !== filterRegion) return false;
      if (filterDiscipline !== 'ALL' && f.discipline !== filterDiscipline) return false;
      if (filterStatus !== 'ALL' && f.patient_status !== filterStatus) return false;
      // Bucket filter only applies on the Active view — audit rows aren't
      // bucketed by clinical urgency, they're triaged by Ariel directly.
      // note_overdue is a special case: bucketOf() is mutually exclusive
      // (a v>=18 patient with progress_note_due shows as DC SOON / READY DC /
      // OVER CAP, and a v<10 patient hit by the 30-day timer shows as OK),
      // but the KPI counts every progress_note_due=true row. Click filter
      // must match the KPI so all 25 note-due patients are reachable.
      if (view === 'active' && filterBucket !== 'ALL') {
        if (filterBucket === 'note_overdue') {
          if (!f.progress_note_due) return false;
        } else if (bucketOf(f) !== filterBucket) return false;
      }
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!(f.patient_name || '').toLowerCase().includes(q) &&
            !(f.evaluating_pt || '').toLowerCase().includes(q) &&
            !(f.assistant_therapist || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [sourceFlags, view, filterRegion, filterDiscipline, filterStatus, filterBucket, searchQ]);

  const sorted = useMemo(() => {
    const bucketRank = { over_cap: 0, discharge: 1, dc_soon: 2, note_overdue: 3, note_soon: 4, ok: 5 };
    const arr = [...filtered].sort((a, b) => {
      // Always tie-break severity first so red rows surface above white ones.
      const ba = bucketRank[bucketOf(a)] ?? 9;
      const bb = bucketRank[bucketOf(b)] ?? 9;
      if (ba !== bb) return ba - bb;
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'visits_remaining') {
        av = 20 - (a.total_completed_visits || 0);
        bv = 20 - (b.total_completed_visits || 0);
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const counts = useMemo(() => ({
    // KPI tile numbers reference the Active roster only — audited rows are
    // intentionally a separate count surfaced by the tab.
    total: activeFlags.length,
    overCap: activeFlags.filter(f => (f.total_completed_visits || 0) >= 21).length,
    readyDc: activeFlags.filter(f => f.ready_for_discharge && !f.flag_20th_acknowledged).length,
    noteDue: activeFlags.filter(f => f.progress_note_due).length,
    dcSoon:  activeFlags.filter(f => { const v = f.total_completed_visits || 0; return v >= 18 && v < 20; }).length,
    needsAudit: auditFlags.length,
  }), [activeFlags, auditFlags]);

  // --- distinct dropdown values ----------------------------------------
  const distinctDisc = useMemo(() => Array.from(new Set(flags.map(f => f.discipline).filter(Boolean))).sort(), [flags]);
  const distinctStatus = useMemo(() => Array.from(new Set(flags.map(f => f.patient_status).filter(Boolean))).sort(), [flags]);

  // --- XLSX export ------------------------------------------------------
  function exportXlsx() {
    const rows = sorted.map(f => ({
      'Patient Name':            f.patient_name,
      'Address':                 f.address || '',
      'Disc':                    f.discipline || '',
      'Ref Source':              f.ref_source || '',
      'Status':                  f.patient_status || '',
      'Region':                  f.region || '',
      'Evaluation Date':         f.evaluation_date || '',
      'PT / OT':                 f.evaluating_pt || '',
      'PTA / COTA':              f.assistant_therapist || '',
      '10th Visit Progress Note Date': f.tenth_visit_actual_date || (f.tenth_visit_projected_date ? 'projected ' + f.tenth_visit_projected_date : ''),
      'Visits Allowed':          20,
      'Visits Consumed':         f.total_completed_visits || 0,
      'Visits Remaining':        20 - (f.total_completed_visits || 0),
      '20th Visit Discharge Note Date': f.twentieth_visit_actual_date || (f.twentieth_visit_projected_date ? 'projected ' + f.twentieth_visit_projected_date : ''),
      'Notes':                   f.roster_notes || '',
      'Ready for Discharge':     f.ready_for_discharge ? 'YES' : 'no',
      'Cap Override By':         f.cap_override_by || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Medicare Roster');
    XLSX.writeFile(wb, 'medicare-roster-' + todayISO() + '.xlsx');
  }

  function toggleSort(k) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  }

  // --- render -----------------------------------------------------------
  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Medicare Visit Tracker" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Medicare Visit Tracker"
        subtitle="20-visit cap, 10-visit progress note, and ready-for-discharge across all regions"
      />

      {/* Tab strip — Active Roster | Needs Audit. Sits between the TopBar and
          the rest of the page so view switching is the first thing you see. */}
      <div style={{ padding:'10px 20px 0 20px', display:'flex', gap:6,
                    borderBottom:'1px solid var(--border)' }}>
        <TabButton
          label="Active Roster"
          count={activeFlags.length}
          active={view === 'active'}
          onClick={() => setView('active')} />
        <TabButton
          label="Needs Audit"
          count={counts.needsAudit}
          accent="#B45309"
          active={view === 'audit'}
          onClick={() => setView('audit')} />
      </div>

      {/* KPI tiles — Active view only. Audit view doesn't get the buckets;
          its workflow is "go through each row and fix something". */}
      {view === 'active' && (
        <div style={{ padding:'14px 20px 6px 20px', display:'grid',
                      gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:12 }}>
          <KpiTile
            label="Medicare Patients"
            value={counts.total}
            active={filterBucket === 'ALL'}
            accent="#0F1117"
            onClick={() => setFilterBucket('ALL')}
          />
          <KpiTile
            label="Over Cap"
            value={counts.overCap}
            active={filterBucket === 'over_cap'}
            accent={BUCKET_STYLE.over_cap.accent}
            onClick={() => setFilterBucket('over_cap')}
          />
          <KpiTile
            label="Ready for Discharge"
            value={counts.readyDc}
            active={filterBucket === 'discharge'}
            accent={BUCKET_STYLE.discharge.accent}
            onClick={() => setFilterBucket('discharge')}
          />
          <KpiTile
            label="Progress Note Due"
            value={counts.noteDue}
            active={filterBucket === 'note_overdue'}
            accent={BUCKET_STYLE.note_overdue.accent}
            onClick={() => setFilterBucket('note_overdue')}
          />
        </div>
      )}

      {/* Compact filter strip — shared between views */}
      <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)',
                    display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} style={selStyle}>
          <option value="ALL">All Regions</option>
          {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
        </select>
        <select value={filterDiscipline} onChange={e => setFilterDiscipline(e.target.value)} style={selStyle}>
          <option value="ALL">All Disciplines</option>
          {distinctDisc.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
          <option value="ALL">All Statuses</option>
          {distinctStatus.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {view === 'active' && filterBucket !== 'ALL' && (
          <button onClick={() => setFilterBucket('ALL')}
            style={{ ...selStyle, color:'var(--gray)', cursor:'pointer' }}>
            Clear bucket filter
          </button>
        )}
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search patient, PT, PTA..."
          style={{ ...selStyle, width:220 }} />
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          <button onClick={exportXlsx} style={btnSecondaryStyle}>Export XLSX</button>
          {/* Recalculate only on the Active view. On the Audit tab it would
              be a no-op for the visible rows (audited rows are intentionally
              skipped so manual edits aren't clobbered), and the button being
              there reads as "this will refresh what I see" — it wouldn't. */}
          {view === 'active' && (
            <button onClick={recalculate} disabled={calculating} style={btnPrimaryStyle}>
              {calculating ? 'Recalculating...' : 'Recalculate'}
            </button>
          )}
        </div>
      </div>

      {/* Roster table — Active view (compact) or Audit view (editable) */}
      <div style={{ padding:'14px 20px 24px 20px', overflowX:'auto' }}>
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', minWidth: view === 'audit' ? 1280 : 1180 }}>
          <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
            <thead>
              <tr style={{ background:'var(--bg)', borderBottom:'2px solid var(--border)' }}>
                {view === 'active' && <th style={{ width:4, padding:0 }} />}
                {(view === 'audit' ? AUDIT_COLS : COLS).map(c => {
                  const sortable = !!c.sortBy;
                  return (
                    <th key={c.key}
                      onClick={sortable ? () => toggleSort(c.sortBy) : undefined}
                      style={{ ...thStyle, width:c.w, cursor: sortable ? 'pointer' : 'default', userSelect:'none' }}>
                      {c.label}
                      {sortable && sortKey === c.sortBy && (
                        <span style={{ marginLeft:4, opacity:0.6 }}>{sortDir === 'asc' ? '^' : 'v'}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={(view === 'audit' ? AUDIT_COLS : COLS).length + (view === 'active' ? 1 : 0)}
                        style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                  {view === 'audit'
                    ? (auditFlags.length === 0
                        ? 'No charts flagged for audit.'
                        : 'No rows match current filters.')
                    : (flags.length === 0
                        ? 'No Medicare patients yet. Click Recalculate to scan.'
                        : 'No rows match current filters.')}
                </td></tr>
              ) : view === 'audit' ? (
                sorted.map(f => (
                  <AuditRosterRow key={f.id}
                    flag={f}
                    assignments={assignmentsByPatient[f.patient_name] || []}
                    onSave={patch => saveAuditEdits(f, patch)}
                    onRestart={() => restartTracker(f)}
                    onResolve={() => resolveAudit(f)}
                    onOpenPicker={slot => setPickerState({ flag: f, slot })} />
                ))
              ) : (
                sorted.map(f => {
                  const bucket = bucketOf(f);
                  const style = BUCKET_STYLE[bucket];
                  return (
                    <RosterRow key={f.id}
                      flag={f}
                      bucketStyle={style}
                      bucketLabel={style.label}
                      onSelect={() => setSelectedPatient(f)}
                      onDischarge={() => setConfirmDischarge(f)}
                      onAudit={() => { setAuditPrompt(f); setAuditReason(''); }} />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      {selectedPatient && (
        <PatientDrawer
          flag={selectedPatient}
          isAdmin={isAdmin}
          profile={profile}
          onClose={() => setSelectedPatient(null)}
          onSaved={() => { loadFlags(); }}
        />
      )}

      {/* Discharge confirmation modal */}
      {confirmDischarge && (
        <div
          onClick={() => !dischargeBusy && setConfirmDischarge(null)}
          style={{
            position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.6)', zIndex:3000,
            display:'flex', alignItems:'center', justifyContent:'center', padding:24,
          }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:540,
                     boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ padding:'16px 22px', background:'#7F1D1D', borderRadius:'14px 14px 0 0' }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Mark Patient as Discharged</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.85)', marginTop:2 }}>
                Notifies the Care Coordination team for the patient's region.
              </div>
            </div>
            <div style={{ padding:'18px 22px' }}>
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8,
                            padding:'10px 14px', marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#991B1B', textTransform:'uppercase', letterSpacing:0.4 }}>Patient</div>
                <div style={{ fontSize:15, fontWeight:700, color:'#7F1D1D', marginTop:2 }}>{confirmDischarge.patient_name}</div>
                <div style={{ fontSize:12, color:'#7F1D1D', marginTop:4 }}>
                  Region {confirmDischarge.region || '—'} {'·'} {confirmDischarge.discipline || '—'} {'·'}
                  {' '}{confirmDischarge.total_completed_visits ?? 0} visits completed
                </div>
              </div>
              <div style={{ fontSize:13, color:'var(--black)', marginBottom:12, lineHeight:1.5 }}>
                This will set the census status to <strong>Discharge</strong>, clear the Medicare ready-for-DC flag,
                and create a <strong>high-priority alert</strong> for the Care Coord team in
                Region {confirmDischarge.region || '—'} so they can start the transition-of-care workflow.
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>
                  Discharge note (optional — included in the care coord alert)
                </div>
                <textarea
                  value={dischargeNote}
                  onChange={e => setDischargeNote(e.target.value)}
                  placeholder="e.g. patient met goals, transitioned to maintenance, will resume in 30 days"
                  rows={3}
                  style={{
                    width:'100%', padding:'8px 11px', border:'1px solid var(--border)',
                    borderRadius:7, fontSize:13, outline:'none', background:'var(--card-bg)',
                    resize:'vertical', minHeight:60, boxSizing:'border-box',
                  }} />
              </div>
            </div>
            <div style={{ padding:'12px 22px', borderTop:'1px solid var(--border)',
                          display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
              <button
                onClick={() => { setConfirmDischarge(null); setDischargeNote(''); }}
                disabled={dischargeBusy}
                style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7,
                         fontSize:13, background:'var(--card-bg)', cursor:dischargeBusy?'wait':'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => dischargePatient(confirmDischarge, dischargeNote)}
                disabled={dischargeBusy}
                style={{ padding:'8px 20px', background:'#7F1D1D', color:'#fff', border:'none',
                         borderRadius:7, fontSize:13, fontWeight:700, cursor:dischargeBusy?'wait':'pointer' }}>
                {dischargeBusy ? 'Discharging...' : 'Confirm Discharge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit flag modal — required reason field, fires the notification */}
      {auditPrompt && (
        <div
          onClick={() => !auditBusy && setAuditPrompt(null)}
          style={{
            position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.6)', zIndex:3000,
            display:'flex', alignItems:'center', justifyContent:'center', padding:24,
          }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:560,
                     boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ padding:'16px 22px', background:'#B45309', borderRadius:'14px 14px 0 0' }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Flag Chart for Audit</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.85)', marginTop:2 }}>
                Moves the row to the Needs Audit tab and alerts Hervylie Senica, Carla Smith, Liam O'Brien, and Randi Bonner.
              </div>
            </div>
            <div style={{ padding:'18px 22px' }}>
              <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8,
                            padding:'10px 14px', marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#92400E', textTransform:'uppercase', letterSpacing:0.4 }}>Patient</div>
                <div style={{ fontSize:15, fontWeight:700, color:'#78350F', marginTop:2 }}>{auditPrompt.patient_name}</div>
                <div style={{ fontSize:12, color:'#78350F', marginTop:4 }}>
                  Region {auditPrompt.region || '-'} {'·'} {auditPrompt.discipline || '-'} {'·'}
                  {' '}{auditPrompt.total_completed_visits ?? 0} visits completed
                </div>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>
                  Audit reason (required — include what's wrong and what needs to be verified)
                </div>
                <textarea
                  value={auditReason}
                  onChange={e => setAuditReason(e.target.value)}
                  placeholder="e.g. Visit count looks wrong — Pariox shows 12 but we billed 14. Need to reconcile against the schedule and decide whether to KX or re-cert."
                  rows={5}
                  autoFocus
                  style={{
                    width:'100%', padding:'8px 11px', border:'1px solid var(--border)',
                    borderRadius:7, fontSize:13, outline:'none', background:'var(--card-bg)',
                    resize:'vertical', minHeight:90, boxSizing:'border-box',
                  }} />
              </div>
            </div>
            <div style={{ padding:'12px 22px', borderTop:'1px solid var(--border)',
                          display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
              <button
                onClick={() => { setAuditPrompt(null); setAuditReason(''); }}
                disabled={auditBusy}
                style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7,
                         fontSize:13, background:'var(--card-bg)', cursor:auditBusy?'wait':'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => flagForAudit(auditPrompt, auditReason)}
                disabled={auditBusy || !auditReason.trim()}
                style={{ padding:'8px 20px', background:'#B45309', color:'#fff', border:'none',
                         borderRadius:7, fontSize:13, fontWeight:700,
                         cursor:auditBusy?'wait':(auditReason.trim()?'pointer':'not-allowed'),
                         opacity: auditReason.trim() ? 1 : 0.6 }}>
                {auditBusy ? 'Flagging...' : 'Flag for Audit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clinician picker modal — opened from the audit row's Add Therapist
          button. On select, inserts a new patient_clinician_assignments row
          and refreshes the assignments map so the new clinician appears in
          the dropdown immediately. */}
      <ClinicianPickerModal
        open={!!pickerState}
        slot={pickerState?.slot}
        flag={pickerState?.flag}
        clinicians={allClinicians}
        busy={auditBusy}
        onClose={() => setPickerState(null)}
        onPick={async (cl) => {
          const ok = await addClinicianAssignment(pickerState.flag, cl, pickerState.slot);
          if (ok) setPickerState(null);
        }} />

      {/* Discharge result toast — green on success, red on failure */}
      {dischargeMsg && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:3100,
          background: /failed/i.test(dischargeMsg) ? '#7F1D1D' : '#065F46',
          color:'#fff', padding:'12px 18px', borderRadius:10, fontSize:13, fontWeight:600,
          boxShadow:'0 10px 30px rgba(0,0,0,0.25)', maxWidth:380,
        }}>{dischargeMsg}</div>
      )}
    </div>
  );
}

// =============================================================================
// TAB BUTTON — top-of-page view switch between Active Roster and Needs Audit
// =============================================================================
function TabButton({ label, count, active, accent, onClick }) {
  const tone = accent || (active ? '#0F1117' : 'var(--gray)');
  return (
    <button
      onClick={onClick}
      style={{
        padding:'10px 16px',
        background:'transparent',
        border:'none',
        borderBottom: active ? `3px solid ${tone}` : '3px solid transparent',
        marginBottom:-1,
        cursor:'pointer',
        fontSize:13,
        fontWeight: active ? 700 : 500,
        color: active ? tone : 'var(--gray)',
        display:'inline-flex', alignItems:'center', gap:8,
      }}
    >
      {label}
      {typeof count === 'number' && (
        <span style={{
          fontFamily:'DM Mono, monospace',
          fontSize:11, fontWeight:700,
          background: active ? `${tone}15` : 'var(--bg)',
          color: active ? tone : 'var(--gray)',
          border:`1px solid ${active ? tone + '40' : 'var(--border)'}`,
          padding:'1px 7px', borderRadius:999,
        }}>{count}</span>
      )}
    </button>
  );
}

// =============================================================================
// KPI TILE — single tappable summary tile in the top strip
// =============================================================================
function KpiTile({ label, value, accent, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign:'left',
        padding:'12px 14px',
        borderRadius:10,
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        background: active ? `${accent}10` : 'var(--card-bg)',
        cursor:'pointer',
        transition:'background 120ms, border-color 120ms',
        display:'flex', flexDirection:'column', gap:4,
        boxShadow: active ? `inset 3px 0 0 ${accent}` : 'none',
      }}
    >
      <span style={{ fontSize:10, fontWeight:600, letterSpacing:0.6,
                     textTransform:'uppercase', color:'var(--gray)' }}>
        {label}
      </span>
      <span style={{ fontSize:24, fontWeight:800, color: accent === '#0F1117' ? 'var(--text)' : accent,
                     fontFamily:'DM Mono, monospace', lineHeight:1 }}>
        {value}
      </span>
    </button>
  );
}

// =============================================================================
// ROSTER ROW — one Medicare patient, compact 7-column layout
// =============================================================================
// Visual rules (2026-06-30):
//   * 4px colored left stripe on every row to signal bucket — the only
//     row-level color signal apart from over_cap (which keeps a faint tint).
//   * Patient column stacks name + region/discipline/ref/address as a quiet
//     secondary line. Insurance goes there too.
//   * Status column shows census status + bucket chip when not 'ok'.
//   * Progress column shows N/20 + a visit-completion bar + 10th/20th dates
//     on a second line. Single source of progress instead of four columns.
//   * Therapists column stacks PT/OT primary and PTA/COTA secondary.
// =============================================================================
function RosterRow({ flag, bucketStyle, bucketLabel, onSelect, onDischarge, onAudit }) {
  const f = flag;
  const visits = visitsForCap(f);
  const pct = Math.min(100, Math.round((visits / 20) * 100));
  const overCapBy = Math.max(0, visits - 20);
  const driftAmount = manualDriftOf(f);
  const tenth = f.tenth_visit_actual_date
    ? `10th ${fmtDateShort(f.tenth_visit_actual_date)}`
    : `10th proj ${fmtDateShort(f.tenth_visit_projected_date)}`;
  const twentieth = f.twentieth_visit_actual_date
    ? `20th ${fmtDateShort(f.twentieth_visit_actual_date)}`
    : `20th proj ${fmtDateShort(f.twentieth_visit_projected_date)}`;

  // Suppress the bucket chip when it would just repeat the census status text
  // (e.g., a "READY DC" chip on a row already labeled "Discharge") or when it
  // outright contradicts the status (a "READY DC" chip on a "SOC Pending"
  // patient who happens to have 20 episode-2 visits booked under them). Status
  // text wins; OVER CAP / NOTE DUE / DC SOON / NOTE SOON still surface since
  // they convey new information regardless of census status.
  const statusNorm = (f.patient_status || '').toLowerCase();
  const isDischargeChip = bucketLabel === BUCKET_STYLE.discharge.label;
  const hideChip = isDischargeChip && (statusNorm === 'discharge' || statusNorm === 'soc pending');
  const showChip = !!bucketLabel && !hideChip;

  return (
    <tr
      onClick={onSelect}
      style={{ background: bucketStyle.tint, borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
      {/* Left accent stripe — bucket signal */}
      <td style={{ width:4, padding:0, background: bucketStyle.accent }} />

      {/* Patient */}
      <td style={tdStyle}>
        <div style={{ fontWeight:700, fontSize:13 }}>{f.patient_name}</div>
        <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>
          {[
            f.region && `Region ${f.region}`,
            f.discipline,
            f.ref_source && `ref ${f.ref_source}`,
            f.address,
          ].filter(Boolean).join('  ' + String.fromCharCode(183) + '  ')}
        </div>
        {f.insurance && (
          <div style={{ fontSize:10, color:'var(--gray)', opacity:0.7 }}>{f.insurance}</div>
        )}
      </td>

      {/* Status — census status text + bucket chip (when it adds info) */}
      <td style={tdStyle}>
        <div style={{ fontWeight:600 }}>{f.patient_status || '-'}</div>
        {showChip && (
          <span style={{
            display:'inline-block', marginTop:4,
            background: `${bucketStyle.accent}15`,
            color: bucketStyle.accent,
            border: `1px solid ${bucketStyle.accent}40`,
            borderRadius:999, padding:'1px 8px',
            fontSize:9, fontWeight:700, letterSpacing:0.4,
          }}>
            {bucketLabel}
          </span>
        )}
      </td>

      {/* Eval — short date for compactness */}
      <td style={{ ...tdStyle, fontFamily:'DM Mono, monospace', color:'var(--gray)' }}>
        {fmtDateShort(f.evaluation_date)}
      </td>

      {/* Therapists — PT/OT primary + PTA/COTA secondary */}
      <td style={tdStyle}>
        <div>{f.evaluating_pt || 'Unassigned'}</div>
        {f.assistant_therapist && (
          <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>
            asst {f.assistant_therapist}
          </div>
        )}
      </td>

      {/* Progress — N/20 + bar + milestones */}
      <td style={tdStyle}>
        <div style={{ display:'flex', alignItems:'baseline', gap:6, fontFamily:'DM Mono, monospace' }}>
          <span style={{ fontSize:16, fontWeight:800, color: visits >= 20 ? bucketStyle.accent : 'var(--text)' }}>
            {visits}
          </span>
          <span style={{ fontSize:11, color:'var(--text)', opacity:0.6 }}>/ 20</span>
          {overCapBy > 0 && (
            <span style={{
              fontSize:9, fontWeight:800, letterSpacing:0.4,
              color: bucketStyle.accent,
              background: `${bucketStyle.accent}1A`,
              border:`1px solid ${bucketStyle.accent}55`,
              borderRadius:4, padding:'1px 5px',
            }}>
              +{overCapBy} OVER
            </span>
          )}
          {f.current_episode_number > 1 && (
            <span style={{ fontSize:9, color:'var(--gray)' }}>
              ep {f.current_episode_number}/{f.episode_count}
            </span>
          )}
        </div>
        {/* Bar — clamped at 100% with a small overflow notch when over-cap so
            the visual reads "past full" instead of "exactly full". */}
        <div style={{ position:'relative', marginTop:4, height:4, background:'var(--border)', borderRadius:2 }}>
          <div style={{
            position:'absolute', left:0, top:0, height:'100%',
            width: `${pct}%`,
            background: bucketStyle.accent === 'transparent' ? '#10B981' : bucketStyle.accent,
            borderRadius: 2,
          }} />
          {overCapBy > 0 && (
            <div style={{
              position:'absolute', right:-3, top:-1, bottom:-1,
              width:6,
              background: bucketStyle.accent,
              borderRadius:2,
              boxShadow: `0 0 0 1px ${bucketStyle.accent}`,
            }} />
          )}
        </div>
        <div style={{ fontSize:9, color:'var(--gray)', marginTop:3, lineHeight:1.3 }}>
          {tenth}{' '}{String.fromCharCode(183)}{' '}{twentieth}
        </div>
        {driftAmount > 2 && (
          <div style={{ fontSize:9, fontWeight:700, color:'#92400E',
                        background:'#FEF3C7', padding:'1px 5px',
                        borderRadius:3, marginTop:3, display:'inline-block' }}>
            drift {driftAmount}
          </div>
        )}
      </td>

      {/* Notes — truncated */}
      <td style={{ ...tdStyle, maxWidth:260, color: f.roster_notes ? 'var(--text)' : 'var(--gray)' }}>
        <div style={{
          display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical',
          overflow:'hidden', lineHeight:1.4,
        }}>
          {f.roster_notes || 'No notes'}
        </div>
      </td>

      {/* Action */}
      <td style={tdStyle}>
        <FlagCell flag={f} bucketStyle={bucketStyle} onDischarge={onDischarge} />
      </td>

      {/* Needs Audit checkbox — Liam's far-right control. Click opens the
          required-reason modal. Stops row-click propagation so checking the
          box doesn't also open the patient drawer. */}
      <td style={{ ...tdStyle, textAlign:'center' }}
          onClick={e => { e.stopPropagation(); if (onAudit) onAudit(); }}>
        <label style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none' }}
               onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={!!f.needs_audit}
            onChange={() => { if (onAudit) onAudit(); }}
            style={{ width:16, height:16, accentColor:'#B45309', cursor:'pointer' }}
          />
          <span style={{ fontSize:10, color:'var(--gray)', fontWeight:600 }}>Audit</span>
        </label>
      </td>
    </tr>
  );
}

// =============================================================================
// THERAPIST SELECT — dropdown of clinicians ASSIGNED to a patient
// =============================================================================
// "Assignments" come from patient_clinician_assignments (active rows only).
// If the patient's currently-saved name (fallbackName) isn't in the
// assignments list yet — e.g., a legacy text value populated by Pariox before
// the chart was wired up — we still expose it as a sticky "(legacy)" option
// so the dropdown doesn't show empty when there's actually a value behind it.
// "Add therapist" opens the system-wide picker (handled at the page level).
function TherapistSelect({ label, slot, value, assignments, fallbackName, onChange, onAdd, inputBase }) {
  const options = assignments.map(a => a.clinician_name);
  const hasFallback = fallbackName && !options.includes(fallbackName);
  const allOptions = hasFallback ? [fallbackName, ...options] : options;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
      <div style={{ fontSize:9, color:'var(--gray)', fontWeight:600, letterSpacing:0.3, textTransform:'uppercase' }}>
        {label}
      </div>
      <div style={{ display:'flex', gap:4 }}>
        <select value={value || ''}
                onChange={e => onChange(e.target.value)}
                style={{ ...inputBase, flex:1 }}>
          <option value="">{slot === 'lead' ? 'Unassigned' : '- none -'}</option>
          {allOptions.map(name => (
            <option key={name} value={name}>
              {name}{hasFallback && name === fallbackName ? '  (legacy)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onAdd}
          title="Pick a clinician from the full system roster and add them to this patient's chart"
          style={{
            padding:'4px 10px',
            background:'transparent',
            color:'#1565C0',
            border:'1px solid #1565C055',
            borderRadius:6,
            fontSize:10,
            fontWeight:600,
            cursor:'pointer',
            whiteSpace:'nowrap',
          }}>
          + Add
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// CLINICIAN PICKER MODAL — full-system clinician search + assignment
// =============================================================================
// Mounted at the page level. When opened from a Therapist Select's "Add"
// button, it scopes the visible roster to the appropriate discipline tier
// (PT/OT for lead slot, PTA/COTA for assistant slot) by default; "Show all"
// disables the filter for edge cases.
function ClinicianPickerModal({ open, slot, flag, clinicians, onPick, onClose, busy }) {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { if (open) { setQ(''); setShowAll(false); } }, [open, flag?.id, slot]);

  if (!open || !flag) return null;

  const defaultDisciplines = slot === 'lead' ? ['PT', 'OT'] : ['PTA', 'COTA'];
  const tierLabel = slot === 'lead' ? 'Lead (PT / OT)' : 'Assistant (PTA / COTA)';

  const filtered = clinicians
    .filter(c => showAll || defaultDisciplines.includes(c.discipline))
    .filter(c => {
      if (!q) return true;
      const needle = q.toLowerCase();
      return (c.full_name || '').toLowerCase().includes(needle)
          || (c.discipline || '').toLowerCase().includes(needle)
          || (c.region || '').toLowerCase().includes(needle);
    })
    .slice(0, 60);

  return (
    <div onClick={() => !busy && onClose()}
      style={{
        position:'fixed', inset:0, background:'rgba(15,23,42,0.6)', zIndex:3200,
        display:'flex', alignItems:'center', justifyContent:'center', padding:24,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:560,
                 boxShadow:'0 24px 60px rgba(0,0,0,0.3)', display:'flex', flexDirection:'column',
                 maxHeight:'80vh' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ fontSize:15, fontWeight:700 }}>Add Therapist - {tierLabel}</div>
          <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
            Adds the selected clinician to {flag.patient_name}'s chart and makes them selectable in the dropdown.
          </div>
        </div>
        <div style={{ padding:'10px 20px', display:'flex', gap:8, alignItems:'center',
                      borderBottom:'1px solid var(--border)' }}>
          <input autoFocus
                 value={q}
                 onChange={e => setQ(e.target.value)}
                 placeholder="Search by name, discipline, or region"
                 style={{ flex:1, padding:'7px 10px', border:'1px solid var(--border)',
                          borderRadius:7, fontSize:13, outline:'none' }} />
          <label style={{ fontSize:11, color:'var(--gray)', display:'inline-flex',
                          alignItems:'center', gap:6, cursor:'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Show all disciplines
          </label>
        </div>
        <div style={{ overflowY:'auto', flex:1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding:24, color:'var(--gray)', fontSize:12, textAlign:'center' }}>
              No clinicians match. Try widening the search or toggling "Show all disciplines".
            </div>
          ) : filtered.map(c => (
            <button key={c.id}
                    disabled={busy}
                    onClick={() => onPick(c)}
                    style={{
                      width:'100%', textAlign:'left', padding:'10px 20px',
                      border:'none', borderBottom:'1px solid var(--border)',
                      background:'transparent', cursor: busy ? 'wait' : 'pointer',
                      display:'flex', justifyContent:'space-between', alignItems:'center', gap:12,
                    }}>
              <div>
                <div style={{ fontWeight:600, fontSize:13 }}>{c.full_name}</div>
                <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>
                  {[c.discipline, c.region && `Region ${c.region}`].filter(Boolean).join('  ' + String.fromCharCode(183) + '  ')}
                </div>
              </div>
              <span style={{ fontSize:10, color:'#1565C0', fontWeight:700 }}>Assign</span>
            </button>
          ))}
        </div>
        <div style={{ padding:'10px 20px', borderTop:'1px solid var(--border)',
                      display:'flex', justifyContent:'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ padding:'7px 14px', border:'1px solid var(--border)', borderRadius:7,
                     fontSize:13, background:'var(--card-bg)', cursor:busy?'wait':'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// AUDIT ROSTER ROW — Needs Audit lane, inline-editable fields
// =============================================================================
// Each row holds local edit state in a single `edits` object. Save commits to
// medicare_visit_flags; Restart Tracker resets episode counters; Resolve Audit
// returns the row to the Active roster (and re-enables recalc on the row).
function AuditRosterRow({ flag, assignments, onSave, onRestart, onResolve, onOpenPicker }) {
  const f = flag;
  const initial = {
    patient_status: f.patient_status || '',
    evaluation_date: f.evaluation_date || '',
    evaluating_pt: f.evaluating_pt || '',
    assistant_therapist: f.assistant_therapist || '',
    current_episode_visit_count:
      f.current_episode_visit_count != null ? f.current_episode_visit_count : (f.total_completed_visits || 0),
  };
  const [edits, setEdits] = useState(initial);
  const [saving, setSaving] = useState(false);

  // Reset local edits when the underlying row changes (e.g., after a save +
  // realtime refetch). Keying on id + updated_at picks up server-side updates.
  useEffect(() => {
    setEdits({
      patient_status: f.patient_status || '',
      evaluation_date: f.evaluation_date || '',
      evaluating_pt: f.evaluating_pt || '',
      assistant_therapist: f.assistant_therapist || '',
      current_episode_visit_count:
        f.current_episode_visit_count != null ? f.current_episode_visit_count : (f.total_completed_visits || 0),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.id, f.updated_at]);

  const isDirty = Object.keys(initial).some(k => String(initial[k] ?? '') !== String(edits[k] ?? ''));

  async function handleSave() {
    setSaving(true);
    const patch = {};
    if (edits.patient_status !== initial.patient_status) patch.patient_status = edits.patient_status;
    if (edits.evaluation_date !== initial.evaluation_date) patch.evaluation_date = edits.evaluation_date || null;
    if (edits.evaluating_pt !== initial.evaluating_pt) patch.evaluating_pt = edits.evaluating_pt;
    if (edits.assistant_therapist !== initial.assistant_therapist) patch.assistant_therapist = edits.assistant_therapist || null;
    if (edits.current_episode_visit_count !== initial.current_episode_visit_count) {
      const n = Math.max(0, parseInt(edits.current_episode_visit_count, 10) || 0);
      patch.current_episode_visit_count = n;
      patch.total_completed_visits = n;
    }
    if (Object.keys(patch).length > 0) await onSave(patch);
    setSaving(false);
  }

  const inputBase = {
    width:'100%', boxSizing:'border-box',
    padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6,
    fontSize:12, background:'var(--card-bg)', outline:'none',
  };

  return (
    <tr style={{ borderBottom:'1px solid var(--border)', background: isDirty ? '#FFFBEB' : 'transparent' }}>
      {/* Patient (read-only header w/ region + flag metadata) */}
      <td style={tdStyle}>
        <div style={{ fontWeight:700, fontSize:13 }}>{f.patient_name}</div>
        <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>
          {[
            f.region && `Region ${f.region}`,
            f.discipline,
            f.ref_source && `ref ${f.ref_source}`,
          ].filter(Boolean).join('  ' + String.fromCharCode(183) + '  ')}
        </div>
        {f.needs_audit_flagged_by && (
          <div style={{ fontSize:9, color:'var(--gray)', marginTop:4 }}>
            flagged by {f.needs_audit_flagged_by}
            {f.needs_audit_flagged_at && ` on ${fmtDateShort(f.needs_audit_flagged_at.slice(0,10))}`}
          </div>
        )}
      </td>

      {/* Audit Reason */}
      <td style={{ ...tdStyle, color:'var(--text)' }}>
        <div style={{ lineHeight:1.4, whiteSpace:'pre-wrap' }}>
          {f.needs_audit_reason || '-'}
        </div>
      </td>

      {/* Status (editable) */}
      <td style={tdStyle}>
        <select value={edits.patient_status}
                onChange={e => setEdits(s => ({ ...s, patient_status: e.target.value }))}
                style={inputBase}>
          <option value="">- select -</option>
          {PATIENT_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </td>

      {/* Eval Date (editable date input) */}
      <td style={tdStyle}>
        <input type="date" value={edits.evaluation_date || ''}
               onChange={e => setEdits(s => ({ ...s, evaluation_date: e.target.value }))}
               style={inputBase} />
      </td>

      {/* Therapists — dropdowns of clinicians ASSIGNED to this patient
          (patient_clinician_assignments). "Add therapist" opens the system
          clinician picker; selection writes a new assignment row to the
          patient's chart, then shows up in the dropdown automatically. */}
      <td style={tdStyle}>
        <TherapistSelect
          label="Lead (PT / OT)"
          slot="lead"
          value={edits.evaluating_pt}
          assignments={(assignments || []).filter(a => a.role === 'lead')}
          fallbackName={initial.evaluating_pt}
          onChange={v => setEdits(s => ({ ...s, evaluating_pt: v }))}
          onAdd={() => onOpenPicker && onOpenPicker('lead')}
          inputBase={inputBase} />
        <div style={{ height:6 }} />
        <TherapistSelect
          label="Assistant (PTA / COTA)"
          slot="assistant"
          value={edits.assistant_therapist}
          assignments={(assignments || []).filter(a => a.role === 'assistant')}
          fallbackName={initial.assistant_therapist}
          onChange={v => setEdits(s => ({ ...s, assistant_therapist: v }))}
          onAdd={() => onOpenPicker && onOpenPicker('assistant')}
          inputBase={inputBase} />
      </td>

      {/* Progress — used visit count is editable */}
      <td style={tdStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input type="number" min={0} max={40}
                 value={edits.current_episode_visit_count}
                 onChange={e => setEdits(s => ({ ...s, current_episode_visit_count: e.target.value }))}
                 style={{ ...inputBase, width:70, fontFamily:'DM Mono, monospace', fontWeight:700 }} />
          <span style={{ fontSize:11, color:'var(--gray)' }}>/ 20</span>
        </div>
        {f.current_episode_number > 1 && (
          <div style={{ fontSize:9, color:'var(--gray)', marginTop:3 }}>
            ep {f.current_episode_number}/{f.episode_count}
          </div>
        )}
        <button
          onClick={onRestart}
          title="Reset episode visit counters to 0 and bump to a new episode. Visit history in Pariox stays intact."
          style={{
            marginTop:6, fontSize:10, fontWeight:600,
            background:'transparent', color:'#7C3AED',
            border:'1px solid #7C3AED55', borderRadius:5,
            padding:'2px 8px', cursor:'pointer',
          }}>
          Restart Tracker
        </button>
      </td>

      {/* Actions */}
      <td style={tdStyle}>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            style={{
              fontSize:11, fontWeight:700,
              background: isDirty ? '#065F46' : 'transparent',
              color: isDirty ? '#fff' : 'var(--gray)',
              border: `1px solid ${isDirty ? '#065F46' : 'var(--border)'}`,
              borderRadius:6, padding:'5px 10px',
              cursor: isDirty && !saving ? 'pointer' : 'not-allowed',
            }}>
            {saving ? 'Saving...' : (isDirty ? 'Save Edits' : 'No Changes')}
          </button>
          <button
            onClick={onResolve}
            title="Clear the Needs Audit flag and return this row to the Active roster"
            style={{
              fontSize:11, fontWeight:600,
              background:'transparent', color:'var(--text)',
              border:'1px solid var(--border)', borderRadius:6, padding:'5px 10px',
              cursor:'pointer',
            }}>
            Resolve Audit
          </button>
        </div>
      </td>
    </tr>
  );
}

// =============================================================================
// FLAG CELL — right-hand action column on each roster row
// =============================================================================
// Quiet by default. The roster is dense (~120 rows) and the previous design —
// a red READY FOR DC pill plus a maroon Discharge button on every row — turned
// the column into a wall of red. Liam 2026-06-30: "overwhelming and confusing".
//
// New rules:
//   * No "READY FOR DC" pill. The row tint + bucket label + 20-of-20 visit
//     count already say it three times — a fourth red pill is noise.
//   * The Discharge button appears ONLY when the row is actually clearable:
//       - ready_for_discharge=true   (cap reached, DB trigger fired)
//       - patient_status='Discharge' (clinically discharged, needs tracker
//         cleanup — covers patients marked Discharge in Pariox)
//     Otherwise the cell is empty. No CTA on a fresh 2-visit patient.
//   * Button style is a ghost outline at rest, fills maroon on hover. Quiet
//     enough to disappear into a clean row, obvious once you reach for it.
// =============================================================================
function FlagCell({ flag, bucketStyle, onDischarge }) {
  const status = (flag.patient_status || '').toLowerCase();
  const showDischarge = !!flag.ready_for_discharge || status === 'discharge';
  // Match the button accent to the bucket so the button harmonizes with the
  // row's left accent stripe instead of fighting it.
  const accent = bucketStyle?.accent && bucketStyle.accent !== 'transparent'
    ? bucketStyle.accent
    : 'var(--text)';

  if (!showDischarge && !flag.cap_override_by) return null;

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4 }}>
      {flag.cap_override_by && (
        <div style={{ fontSize:9, opacity:0.7 }}>override by {flag.cap_override_by}</div>
      )}
      {showDischarge && (
        <button
          onClick={e => { e.stopPropagation(); onDischarge(); }}
          title="Confirm clinical discharge and clear this patient from the tracker"
          style={{
            background:'transparent',
            color: accent,
            border:`1px solid ${accent}`,
            borderRadius:6,
            padding:'3px 10px',
            fontSize:10,
            fontWeight:600,
            cursor:'pointer',
            whiteSpace:'nowrap',
            transition:'background 120ms, color 120ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = accent; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = accent; }}
        >
          Mark Discharged
        </button>
      )}
    </div>
  );
}

// =============================================================================
// DRAWER — drill-down for one Medicare patient
// =============================================================================
function PatientDrawer({ flag, isAdmin, profile, onClose, onSaved }) {
  const profileName = profile?.full_name || profile?.email || 'Unknown';
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noteDate, setNoteDate] = useState(todayISO());
  const [noteText, setNoteText] = useState('');
  const [dcDate, setDcDate] = useState(todayISO());
  const [dcText, setDcText] = useState('');
  const [rosterNotes, setRosterNotes] = useState(flag.roster_notes || '');
  const [overrideReason, setOverrideReason] = useState('');
  const [kxApplied, setKxApplied] = useState(!!flag.kx_modifier_applied);
  const [tab, setTab] = useState('visits');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('visit_schedule_data')
        .select('visit_date, staff_name_normalized, staff_name, event_type, status')
        .eq('patient_name', flag.patient_name)
        .order('visit_date', { ascending: false })
        .limit(60);
      if (!ignore) { setVisits(data || []); setLoading(false); }
    })();
    return () => { ignore = true; };
  }, [flag.patient_name]);

  async function submitProgressNote() {
    setSaving(true);
    const visitAtSubmit = flag.total_completed_visits || 0;
    await supabase.from('medicare_visit_flags').update({
      last_progress_note_date: noteDate,
      last_progress_note_visit: visitAtSubmit,
      last_progress_note_submitted_by: profileName,
      last_progress_note_notes: noteText || null,
      tenth_visit_note_submitted_date: visitAtSubmit >= 10 ? (flag.tenth_visit_note_submitted_date || noteDate) : flag.tenth_visit_note_submitted_date,
      progress_note_due: false,
      progress_note_due_reason: null,
      next_due_date: addDaysIso(noteDate, 30),
      next_due_visit: visitAtSubmit + 10,
      updated_at: new Date().toISOString(),
    }).eq('id', flag.id);
    await supabase.from('alerts').delete()
      .eq('alert_type', 'medicare_progress_note_due')
      .eq('patient_name', flag.patient_name)
      .eq('is_read', false);
    await supabase.from('coordinator_tasks').delete()
      .eq('task_type', 'medicare_progress_note_due')
      .eq('patient_name', flag.patient_name)
      .eq('auto_generated', true)
      .in('status', ['open', 'in_progress']);
    setSaving(false);
    onSaved();
    onClose();
  }

  async function submitDischargeNote() {
    setSaving(true);
    await supabase.from('medicare_visit_flags').update({
      twentieth_visit_discharge_note_date: dcDate,
      flag_20th_acknowledged: true,
      flag_20th_acknowledged_at: new Date().toISOString(),
      flag_20th_acknowledged_by: profileName,
      roster_notes: dcText ? ((rosterNotes ? rosterNotes + '\n' : '') + 'DC note ' + dcDate + ': ' + dcText) : rosterNotes,
      updated_at: new Date().toISOString(),
    }).eq('id', flag.id);
    await supabase.from('alerts').delete()
      .in('alert_type', ['medicare_discharge_note_due', 'medicare_ready_for_discharge'])
      .eq('patient_name', flag.patient_name)
      .eq('is_read', false);
    await supabase.from('coordinator_tasks').delete()
      .in('task_type', ['medicare_discharge_note_due', 'medicare_ready_for_discharge'])
      .eq('patient_name', flag.patient_name)
      .eq('auto_generated', true)
      .in('status', ['open', 'in_progress']);
    setSaving(false);
    onSaved();
    onClose();
  }

  async function saveRosterNotes() {
    setSaving(true);
    await supabase.from('medicare_visit_flags').update({
      roster_notes: rosterNotes,
      kx_modifier_applied: kxApplied,
      updated_at: new Date().toISOString(),
    }).eq('id', flag.id);
    setSaving(false);
    onSaved();
  }

  async function applyCapOverride() {
    if (!overrideReason.trim()) return;
    setSaving(true);
    await supabase.from('medicare_visit_flags').update({
      cap_override_reason: overrideReason.trim(),
      cap_override_by: profileName,
      cap_override_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', flag.id);
    // Audit trail
    await supabase.from('coordinator_activity_log').insert({
      action: 'medicare_cap_override',
      patient_name: flag.patient_name,
      coordinator_id: profile?.id || null,
      coordinator_name: profileName,
      details: overrideReason.trim(),
      created_at: new Date().toISOString(),
    }).catch(() => { /* table optional - no-op if schema mismatch */ });
    setSaving(false);
    onSaved();
    onClose();
  }

  async function clearCapOverride() {
    setSaving(true);
    await supabase.from('medicare_visit_flags').update({
      cap_override_reason: null,
      cap_override_by: null,
      cap_override_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', flag.id);
    setSaving(false);
    onSaved();
  }

  const epVisits = flag.current_episode_visit_count ?? flag.total_completed_visits ?? 0;
  const remaining = 20 - epVisits;

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:2000 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ position:'absolute', right:0, top:0, height:'100vh', width: 560, maxWidth:'92vw',
                 background:'var(--card-bg)', boxShadow:'-12px 0 40px rgba(0,0,0,0.25)',
                 display:'flex', flexDirection:'column' }}>
        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)',
                      background: flag.ready_for_discharge ? '#DC2626' : '#0F1117', color:'#fff' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:16, fontWeight:800 }}>{flag.patient_name}</div>
              <div style={{ fontSize:11, opacity:0.85, marginTop:3 }}>
                Region {flag.region} - {flag.discipline} - {flag.insurance}
              </div>
              <div style={{ fontSize:11, opacity:0.85 }}>
                PT/OT: {flag.evaluating_pt || 'Unassigned'}{flag.assistant_therapist ? ' - PTA/COTA: ' + flag.assistant_therapist : ''}
              </div>
            </div>
            <button onClick={onClose} style={{ background:'transparent', color:'#fff', border:'1px solid rgba(255,255,255,0.3)',
              borderRadius:6, padding:'4px 10px', fontSize:13, cursor:'pointer' }}>{'✕'}</button>
          </div>
          <div style={{ marginTop:10, display:'flex', gap:14, fontFamily:'DM Mono, monospace', flexWrap:'wrap', alignItems:'center' }}>
            <span><span style={{ fontSize:22, fontWeight:900 }}>{epVisits}</span>
              <span style={{ fontSize:11, opacity:0.7 }}> / 20 this episode</span></span>
            {flag.current_episode_number > 1 && (
              <span style={{ alignSelf:'center', fontSize:10, opacity:0.85,
                             background:'rgba(255,255,255,0.15)', padding:'2px 8px', borderRadius:999 }}>
                Episode {flag.current_episode_number} of {flag.episode_count}
              </span>
            )}
            {flag.lifetime_visit_count != null && flag.lifetime_visit_count > epVisits && (
              <span style={{ alignSelf:'center', fontSize:10, opacity:0.65 }}>
                lifetime {flag.lifetime_visit_count}
              </span>
            )}
            <span style={{ alignSelf:'center', fontSize:11, opacity:0.85 }}>
              {remaining >= 0 ? remaining + ' remaining' : Math.abs(remaining) + ' OVER cap'}
            </span>
            {flag.ready_for_discharge && (
              <span style={{ alignSelf:'center', background:'#fff', color:'#DC2626',
                             padding:'3px 9px', borderRadius:999, fontSize:10, fontWeight:800 }}>
                READY FOR DISCHARGE
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
          {[['visits','Visits'],['note','Progress Note'],['dc','Discharge'],['notes','Notes'],
            ...(isAdmin ? [['override','Cap Override']] : [])].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex:1, padding:'10px 8px', border:'none', background: tab === k ? 'var(--card-bg)' : 'var(--bg)',
                color: tab === k ? 'var(--black)' : 'var(--gray)',
                borderBottom: tab === k ? '2px solid #1565C0' : '2px solid transparent',
                fontSize:12, fontWeight: tab === k ? 700 : 500, cursor:'pointer' }}>{l}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'14px 20px' }}>
          {/* VISITS */}
          {tab === 'visits' && (
            <div>
              {loading && <div style={{ color:'var(--gray)' }}>Loading visits...</div>}
              {!loading && visits.length === 0 && <div style={{ color:'var(--gray)' }}>No visits on file.</div>}
              {!loading && visits.length > 0 && (
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'var(--bg)', textAlign:'left' }}>
                      <th style={miniThStyle}>#</th>
                      <th style={miniThStyle}>Date</th>
                      <th style={miniThStyle}>Clinician</th>
                      <th style={miniThStyle}>Type</th>
                      <th style={miniThStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v, i) => {
                      const isCompletedV = /completed/i.test(v.status || '') && !/cancel/i.test(v.event_type || '');
                      return (
                        <tr key={i} style={{ borderBottom:'1px solid var(--border)' }}>
                          <td style={miniTdStyle}>{visits.length - i}</td>
                          <td style={miniTdStyle}>{fmtDate(v.visit_date)}</td>
                          <td style={miniTdStyle}>{v.staff_name_normalized || flipName(v.staff_name) || '-'}</td>
                          <td style={miniTdStyle}>{(v.event_type || '').replace(/\*e\*.*/, '').trim()}</td>
                          <td style={miniTdStyle}>
                            <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4,
                              background: isCompletedV ? '#ECFDF5' : '#FEF2F2',
                              color: isCompletedV ? '#065F46' : '#991B1B' }}>
                              {v.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* PROGRESS NOTE */}
          {tab === 'note' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <InfoBox tone="warn" title="Medicare Progress Note">
                Required every 10 treatment days OR every 30 calendar days (CMS Pub 100-02 Ch 15 §220.3).
                Submitting here resets the rolling clock from this date.
                {flag.last_progress_note_date && (
                  <div style={{ marginTop:6, fontSize:11 }}>
                    Last submitted: {fmtDate(flag.last_progress_note_date)} at visit {flag.last_progress_note_visit || 0}
                    {flag.last_progress_note_submitted_by ? ' by ' + flag.last_progress_note_submitted_by : ''}.
                  </div>
                )}
              </InfoBox>
              <Field label="Submission date">
                <input type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Note reference / EMR detail (optional)">
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={4} style={textareaStyle}
                  placeholder="e.g. Pariox note ID, signed-off date, EMR record" />
              </Field>
              <button onClick={submitProgressNote} disabled={saving} style={btnPrimaryStyle}>
                {saving ? 'Saving...' : 'Confirm Progress Note Submitted'}
              </button>
            </div>
          )}

          {/* DISCHARGE */}
          {tab === 'dc' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <InfoBox tone={flag.ready_for_discharge ? 'crit' : 'warn'} title="Medicare Discharge Note">
                Required at the 20-visit cap. Submitting here closes the discharge alert AND the
                ready-for-discharge alert. The patient should also be moved to Discharge status in census.
              </InfoBox>
              <Field label="Discharge note date">
                <input type="date" value={dcDate} onChange={e => setDcDate(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Disposition / reason (optional)">
                <textarea value={dcText} onChange={e => setDcText(e.target.value)} rows={4} style={textareaStyle}
                  placeholder="e.g. Goals met. Patient self-managing. Home program provided." />
              </Field>
              <button onClick={submitDischargeNote} disabled={saving}
                style={{ ...btnPrimaryStyle, background:'#DC2626' }}>
                {saving ? 'Saving...' : 'Confirm Discharge'}
              </button>
            </div>
          )}

          {/* ROSTER NOTES */}
          {tab === 'notes' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <Field label="Roster notes (visible on the Notes column)">
                <textarea value={rosterNotes} onChange={e => setRosterNotes(e.target.value)} rows={6} style={textareaStyle}
                  placeholder="Free-text notes — e.g. KX modifier filed, ABN signed, special billing context, family contact preference" />
              </Field>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                <input type="checkbox" checked={kxApplied} onChange={e => setKxApplied(e.target.checked)} />
                KX modifier applied (annual threshold crossed)
              </label>
              <button onClick={saveRosterNotes} disabled={saving} style={btnPrimaryStyle}>
                {saving ? 'Saving...' : 'Save Notes'}
              </button>
            </div>
          )}

          {/* CAP OVERRIDE — admin only */}
          {tab === 'override' && isAdmin && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <InfoBox tone="crit" title="20-Visit Cap Override">
                Soft escape valve for legitimate KX-modifier / ABN cases. Setting this clears the
                database-level block on new visits past 20 for this patient. The override is logged
                to coordinator_activity_log. Use sparingly.
              </InfoBox>
              {flag.cap_override_by ? (
                <div style={{ padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--bg)' }}>
                  <div style={{ fontSize:12 }}><strong>Override active</strong></div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:4 }}>
                    Set by {flag.cap_override_by} at {fmtDate((flag.cap_override_at || '').slice(0,10))}
                  </div>
                  <div style={{ fontSize:12, marginTop:8, whiteSpace:'pre-wrap' }}>
                    {flag.cap_override_reason || '(no reason recorded)'}
                  </div>
                  <button onClick={clearCapOverride} disabled={saving}
                    style={{ ...btnSecondaryStyle, marginTop:12 }}>
                    {saving ? 'Clearing...' : 'Clear Override'}
                  </button>
                </div>
              ) : (
                <>
                  <Field label="Override reason (required)">
                    <textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} rows={4}
                      style={textareaStyle}
                      placeholder="e.g. KX modifier filed, medical necessity documented, ABN on file" />
                  </Field>
                  <button onClick={applyCapOverride} disabled={saving || !overrideReason.trim()}
                    style={{ ...btnPrimaryStyle, background:'#DC2626' }}>
                    {saving ? 'Applying...' : 'Apply Override'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// styles + tiny presentational helpers
// =============================================================================
const selStyle = { padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6,
  fontSize:12, outline:'none', background:'var(--card-bg)' };
const btnPrimaryStyle = { padding:'7px 14px', background:'#1565C0', color:'#fff',
  border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' };
const btnSecondaryStyle = { padding:'7px 14px', background:'var(--card-bg)', color:'var(--black)',
  border:'1px solid var(--border)', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' };
const thStyle = { textAlign:'left', padding:'10px 12px', fontSize:11, fontWeight:700,
  textTransform:'uppercase', letterSpacing:'0.04em', color:'var(--gray)',
  borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' };
const tdStyle = { padding:'9px 12px', verticalAlign:'top', fontSize:12 };
const miniThStyle = { padding:'6px 8px', fontSize:10, fontWeight:700, color:'var(--gray)',
  textTransform:'uppercase', borderBottom:'1px solid var(--border)' };
const miniTdStyle = { padding:'6px 8px', fontSize:11 };
const inputStyle  = { width:'100%', padding:'7px 10px', border:'1px solid var(--border)',
  borderRadius:6, fontSize:13, background:'var(--card-bg)', outline:'none', boxSizing:'border-box' };
const textareaStyle = { ...inputStyle, resize:'vertical', minHeight:80, fontFamily:'inherit' };

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>{label}</label>
      {children}
    </div>
  );
}
function InfoBox({ tone, title, children }) {
  const palette = tone === 'crit' ? { bg:'#FEF2F2', fg:'#991B1B', bd:'#FCA5A5' }
                : tone === 'warn' ? { bg:'#FEF3C7', fg:'#92400E', bd:'#FCD34D' }
                :                     { bg:'#EFF6FF', fg:'#1E40AF', bd:'#93C5FD' };
  return (
    <div style={{ background:palette.bg, color:palette.fg, border:'1px solid ' + palette.bd,
      borderRadius:8, padding:'10px 12px', fontSize:12 }}>
      <div style={{ fontWeight:700, marginBottom:4 }}>{title}</div>
      {children}
    </div>
  );
}
