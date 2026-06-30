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

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
const BUCKET_STYLE = {
  over_cap:     { bg: '#1F2937', fg: '#FFFFFF', label: 'OVER CAP',   icon: 'X' },
  discharge:    { bg: '#FEE2E2', fg: '#991B1B', label: 'DISCHARGE',  icon: '!' },
  dc_soon:      { bg: '#EDE9FE', fg: '#5B21B6', label: 'DC SOON',    icon: '~' },
  note_overdue: { bg: '#FFEDD5', fg: '#9A3412', label: 'NOTE DUE',   icon: '*' },
  note_soon:    { bg: '#FEF3C7', fg: '#92400E', label: 'NOTE SOON',  icon: '.' },
  ok:           { bg: 'transparent', fg: 'var(--gray)', label: '',   icon: '' },
};

// --- column definitions (Liam's spec, 15 cols) -----------------------------
const COLS = [
  { key: 'patient_name',           label: 'Patient',          w: 180 },
  { key: 'address',                label: 'Address',          w: 150 },
  { key: 'discipline',             label: 'Disc',             w: 90 },
  { key: 'ref_source',             label: 'Ref Src',          w: 70 },
  { key: 'patient_status',         label: 'Status',           w: 100 },
  { key: 'region',                 label: 'Rgn',              w: 50 },
  { key: 'evaluation_date',        label: 'Eval Date',        w: 100 },
  { key: 'evaluating_pt',          label: 'PT / OT',          w: 130 },
  { key: 'assistant_therapist',    label: 'PTA / COTA',       w: 130 },
  { key: 'tenth_visit_actual_date',label: '10th Visit',       w: 110 },
  { key: 'visits_allowed',         label: 'Allowed',          w: 60 },
  { key: 'total_completed_visits', label: 'Used',             w: 50 },
  { key: 'visits_remaining',       label: 'Remaining',        w: 80 },
  { key: 'twentieth_visit_actual_date', label: '20th Visit',  w: 110 },
  { key: 'roster_notes',           label: 'Notes',            w: 160 },
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
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterDiscipline, setFilterDiscipline] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterBucket, setFilterBucket] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');
  const [sortKey, setSortKey] = useState('total_completed_visits');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedPatient, setSelectedPatient] = useState(null); // flag row or null
  const [confirmDischarge, setConfirmDischarge] = useState(null); // flag row or null
  const [dischargeNote, setDischargeNote] = useState('');
  const [dischargeBusy, setDischargeBusy] = useState(false);
  const [dischargeMsg, setDischargeMsg] = useState('');

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

      for (const pt of mcPts) {
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
  useRealtimeTable(['census_data', 'visit_schedule_data', 'medicare_visit_flags'], loadFlags);

  // --- derived view ----------------------------------------------------
  const filtered = useMemo(() => {
    return flags.filter(f => {
      if (filterRegion !== 'ALL' && f.region !== filterRegion) return false;
      if (filterDiscipline !== 'ALL' && f.discipline !== filterDiscipline) return false;
      if (filterStatus !== 'ALL' && f.patient_status !== filterStatus) return false;
      if (filterBucket !== 'ALL' && bucketOf(f) !== filterBucket) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!(f.patient_name || '').toLowerCase().includes(q) &&
            !(f.evaluating_pt || '').toLowerCase().includes(q) &&
            !(f.assistant_therapist || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [flags, filterRegion, filterDiscipline, filterStatus, filterBucket, searchQ]);

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
    total: flags.length,
    overCap: flags.filter(f => (f.total_completed_visits || 0) >= 21).length,
    readyDc: flags.filter(f => f.ready_for_discharge && !f.flag_20th_acknowledged).length,
    noteDue: flags.filter(f => f.progress_note_due).length,
    dcSoon:  flags.filter(f => { const v = f.total_completed_visits || 0; return v >= 18 && v < 20; }).length,
  }), [flags]);

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
        subtitle={counts.total + ' Medicare patients - ' + counts.overCap + ' OVER CAP - ' +
                  counts.readyDc + ' ready for discharge - ' + counts.noteDue + ' progress note due'}
      />

      {/* Filter strip */}
      <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)',
                    display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
          {[
            ['ALL',          'All ' + counts.total],
            ['over_cap',     'Over Cap ' + counts.overCap],
            ['discharge',    'Discharge ' + counts.readyDc],
            ['dc_soon',      'DC Soon ' + counts.dcSoon],
            ['note_overdue', 'Note Due ' + counts.noteDue],
            ['note_soon',    'Note Soon'],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setFilterBucket(k)}
              style={{ padding:'6px 12px', border:'none', fontSize:11,
                fontWeight: filterBucket === k ? 700 : 500, cursor:'pointer',
                background: filterBucket === k ? '#0F1117' : 'var(--card-bg)',
                color:      filterBucket === k ? '#fff' : 'var(--gray)' }}>
              {l}
            </button>
          ))}
        </div>
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
          style={selStyle}>
          <option value="ALL">All Regions</option>
          {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
        </select>
        <select value={filterDiscipline} onChange={e => setFilterDiscipline(e.target.value)}
          style={selStyle}>
          <option value="ALL">All Disciplines</option>
          {distinctDisc.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={selStyle}>
          <option value="ALL">All Statuses</option>
          {distinctStatus.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search patient, PT, PTA..."
          style={{ ...selStyle, width:200 }} />
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          <button onClick={exportXlsx} style={btnSecondaryStyle}>{'⤓'} Export XLSX</button>
          <button onClick={recalculate} disabled={calculating} style={btnPrimaryStyle}>
            {calculating ? 'Recalculating...' : 'Recalculate'}
          </button>
        </div>
      </div>

      {/* Roster table */}
      <div style={{ padding:'14px 20px 24px 20px', overflowX:'auto' }}>
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', minWidth: 1600 }}>
          <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
            <thead>
              <tr style={{ background:'var(--bg)', borderBottom:'2px solid var(--border)' }}>
                <th style={{ ...thStyle, width:24, padding:'8px 6px' }}>{' '}</th>
                {COLS.map(c => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    style={{ ...thStyle, width:c.w, cursor:'pointer', userSelect:'none' }}>
                    {c.label}
                    {sortKey === c.key && <span style={{ marginLeft:4, opacity:0.6 }}>{sortDir === 'asc' ? '^' : 'v'}</span>}
                  </th>
                ))}
                <th style={{ ...thStyle, width:120 }}>Flag</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={COLS.length + 2} style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                  {flags.length === 0 ? 'No Medicare patients yet. Click Recalculate to scan.' : 'No rows match current filters.'}
                </td></tr>
              ) : sorted.map(f => {
                const bucket = bucketOf(f);
                const style = BUCKET_STYLE[bucket];
                const remaining = 20 - visitsForCap(f);
                return (
                  <tr key={f.id}
                    onClick={() => setSelectedPatient(f)}
                    style={{ background: style.bg, color: style.fg,
                             borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
                    <td style={{ ...tdStyle, textAlign:'center', fontWeight:900, color: style.fg }}>{style.icon}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight:700 }}>{f.patient_name}</div>
                      {f.insurance && <div style={{ fontSize:10, opacity:0.7 }}>{f.insurance}</div>}
                    </td>
                    <td style={tdStyle}>{f.address || '-'}</td>
                    <td style={tdStyle}>{f.discipline || '-'}</td>
                    <td style={tdStyle}>{f.ref_source || '-'}</td>
                    <td style={tdStyle}>{f.patient_status || '-'}</td>
                    <td style={{ ...tdStyle, fontWeight:700 }}>{f.region || '-'}</td>
                    <td style={tdStyle}>{fmtDate(f.evaluation_date)}</td>
                    <td style={tdStyle}>{f.evaluating_pt || 'Unassigned'}</td>
                    <td style={tdStyle}>{f.assistant_therapist || '-'}</td>
                    <td style={tdStyle}>
                      {f.tenth_visit_actual_date
                        ? fmtDate(f.tenth_visit_actual_date)
                        : <span style={{ opacity:0.7 }}>proj {fmtDate(f.tenth_visit_projected_date)}</span>}
                      {f.tenth_visit_note_submitted_date && (
                        <div style={{ fontSize:9, opacity:0.7 }}>note {fmtDate(f.tenth_visit_note_submitted_date)}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily:'DM Mono, monospace' }}>20</td>
                    <td style={{ ...tdStyle, fontFamily:'DM Mono, monospace', fontWeight:900 }}>
                      {visitsForCap(f)}
                      {f.current_episode_number > 1 && (
                        <div style={{ fontSize:9, fontWeight:600, opacity:0.7 }}>
                          Ep {f.current_episode_number}/{f.episode_count}
                        </div>
                      )}
                      {manualDriftOf(f) > 2 && (
                        <div style={{ fontSize:9, fontWeight:700, color:'#92400E',
                                      background:'#FEF3C7', padding:'1px 4px',
                                      borderRadius:3, marginTop:2, display:'inline-block' }}>
                          DRIFT manual {f.manual_visit_count}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily:'DM Mono, monospace', fontWeight:700,
                                 color: remaining <= 0 ? '#FFFFFF' : style.fg }}>
                      {remaining}
                    </td>
                    <td style={tdStyle}>
                      {f.twentieth_visit_actual_date
                        ? fmtDate(f.twentieth_visit_actual_date)
                        : <span style={{ opacity:0.7 }}>proj {fmtDate(f.twentieth_visit_projected_date)}</span>}
                      {f.twentieth_visit_discharge_note_date && (
                        <div style={{ fontSize:9, opacity:0.7 }}>DC note {fmtDate(f.twentieth_visit_discharge_note_date)}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {f.roster_notes || '-'}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4 }}>
                        {f.ready_for_discharge && !f.flag_20th_acknowledged && (
                          <span style={{ background:'#DC2626', color:'#fff', padding:'3px 8px',
                                         borderRadius:999, fontSize:10, fontWeight:800, whiteSpace:'nowrap' }}>
                            READY FOR DC
                          </span>
                        )}
                        {f.cap_override_by && (
                          <div style={{ fontSize:9, opacity:0.7 }}>override by {f.cap_override_by}</div>
                        )}
                        {/* Quick-discharge action — only show when patient is not already discharged */}
                        {(f.patient_status || '').toLowerCase() !== 'discharge' && (
                          <button
                            onClick={e => { e.stopPropagation(); setConfirmDischarge(f); }}
                            title="Mark this patient as Discharged and notify the Care Coord team"
                            style={{
                              background:'#7F1D1D', color:'#fff', border:'none',
                              borderRadius:6, padding:'4px 10px', fontSize:10, fontWeight:700,
                              cursor:'pointer', whiteSpace:'nowrap',
                            }}>
                            Discharge
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
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

      {/* Discharge result toast */}
      {dischargeMsg && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:3100,
          background: dischargeMsg.startsWith('✓') ? '#065F46' : '#7F1D1D',
          color:'#fff', padding:'12px 18px', borderRadius:10, fontSize:13, fontWeight:600,
          boxShadow:'0 10px 30px rgba(0,0,0,0.25)', maxWidth:380,
        }}>{dischargeMsg}</div>
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
