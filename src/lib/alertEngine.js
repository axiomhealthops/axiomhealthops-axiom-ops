import { supabase } from './supabase';
 
var REGION_COORD = {
  A: 'Gypsy Renos',
  B: 'Mary Imperio', C: 'Mary Imperio', G: 'Mary Imperio',
  H: 'Audrey Sarmiento', J: 'Audrey Sarmiento', M: 'Audrey Sarmiento', N: 'Audrey Sarmiento',
  T: 'April Manalo', V: 'April Manalo',
};
 
export async function runAlertEngine(visits) {
  if (!visits || !visits.length) return { created: 0 };
 
  var alertsToInsert = [];
  var tasksToInsert = [];
  var seen = {};
  var today = new Date().toISOString().split('T')[0];
 
  function addAlert(a) {
    var key = a.alert_type + '|' + (a.patient_name || '') + '|' + (a.clinician_name || '') + '|' + (a.related_date || '');
    if (seen[key]) return;
    seen[key] = true;
    alertsToInsert.push(Object.assign({ created_at: new Date().toISOString(), is_read: false, is_dismissed: false }, a));
  }
 
  function addTask(t) {
    tasksToInsert.push(Object.assign({
      status: 'open',
      auto_generated: true,
      created_at: new Date().toISOString(),
    }, t));
  }
 
  visits.forEach(function(v) {
    var status = (v.status || '').toLowerCase();
    var eventType = (v.event_type || '').toLowerCase();
    var region = v.region || '?';
    var patient = v.patient_name || 'Unknown Patient';
    var clinician = v.staff_name || 'Unknown Clinician';
    var date = v.raw_date || '';
    var coord = REGION_COORD[region] || null;
 
    // Missed visit
    if (status === 'missed') {
      addAlert({ alert_type: 'missed_visit', priority: 'high', title: 'Missed Visit: ' + patient, message: clinician + ' \u00b7 Region ' + region + ' \u00b7 ' + date + '. Follow up to reschedule.', patient_name: patient, clinician_name: clinician, region: region, assigned_to_region: region, related_date: date || null });
      addTask({ task_type: 'missed_visit', priority: 'high', title: 'Reschedule missed visit: ' + patient, description: clinician + ' missed a visit on ' + date + '. Contact patient to reschedule.', patient_name: patient, clinician_name: clinician, coordinator_region: region, assigned_to: coord, due_date: today });
    }
 
    // Missed Active - cannot bill
    if (status === 'missed (active)') {
      addAlert({ alert_type: 'missed_active', priority: 'critical', title: 'Note Not Submitted: ' + patient, message: clinician + ' \u00b7 Region ' + region + ' \u00b7 ' + date + '. Visit done but note NOT submitted \u2014 cannot bill.', patient_name: patient, clinician_name: clinician, region: region, assigned_to_region: region, related_date: date || null });
      addTask({ task_type: 'note_not_submitted', priority: 'critical', title: 'Note not submitted \u2014 CANNOT BILL: ' + patient, description: clinician + ' completed visit on ' + date + ' but note not submitted. This visit cannot be billed until resolved.', patient_name: patient, clinician_name: clinician, coordinator_region: region, assigned_to: coord, due_date: today });
    }
 
    // Cancelled visit
    if (status === 'cancelled' || status.includes('cancelled')) {
      addAlert({ alert_type: 'cancelled_visit', priority: 'high', title: 'Cancelled Visit: ' + patient, message: clinician + ' \u00b7 Region ' + region + ' \u00b7 ' + date, patient_name: patient, clinician_name: clinician, region: region, assigned_to_region: region, related_date: date || null });
      addTask({ task_type: 'cancelled_visit', priority: 'high', title: 'Reschedule cancelled visit: ' + patient, description: 'Visit with ' + clinician + ' on ' + date + ' was cancelled. Reschedule to maintain productivity.', patient_name: patient, clinician_name: clinician, coordinator_region: region, assigned_to: coord, due_date: today });
    }
 
    // New eval - schedule follow-up
    if (eventType.includes('evaluation') && !eventType.includes('reassess') && !eventType.includes('re-eval')) {
      addAlert({ alert_type: 'eval_due', priority: 'medium', title: 'New Evaluation: ' + patient, message: clinician + ' \u00b7 Region ' + region + ' \u00b7 ' + date + '. Schedule 4x/week for 4 weeks post-eval.', patient_name: patient, clinician_name: clinician, region: region, assigned_to_region: region, related_date: date || null });
      addTask({ task_type: 'eval_scheduling', priority: 'medium', title: 'Schedule post-eval visits: ' + patient, description: 'Evaluation completed on ' + date + ' by ' + clinician + '. Schedule 4 visits/week for 4 weeks (16 visits total).', patient_name: patient, clinician_name: clinician, coordinator_region: region, assigned_to: coord });
    }
 
    // Reassessment
    if (eventType.includes('reassess') || eventType.includes('recert') || eventType.includes('re-eval') || eventType.includes('re-assess')) {
      addAlert({ alert_type: 'reassessment_due', priority: 'high', title: 'Reassessment: ' + patient, message: clinician + ' \u00b7 Region ' + region + ' \u00b7 ' + date + '. Update visit frequency per therapist recommendation.', patient_name: patient, clinician_name: clinician, region: region, assigned_to_region: region, related_date: date || null });
    }
  });
 
  if (!alertsToInsert.length && !tasksToInsert.length) return { created: 0 };
 
  // Clear old auto-generated alerts and tasks
  await supabase.from('alerts').delete()
    .in('alert_type', ['missed_visit','missed_active','cancelled_visit','eval_due','reassessment_due'])
    .eq('is_read', false);
 
  await supabase.from('coordinator_tasks').delete()
    .eq('auto_generated', true)
    .in('task_type', ['missed_visit','note_not_submitted','cancelled_visit','eval_scheduling'])
    .in('status', ['open','in_progress']);
 
  var alertResult = alertsToInsert.length > 0
    ? await supabase.from('alerts').insert(alertsToInsert)
    : { error: null };
 
  var taskResult = tasksToInsert.length > 0
    ? await supabase.from('coordinator_tasks').insert(tasksToInsert)
    : { error: null };
 
  return {
    created: alertsToInsert.length,
    tasksCreated: tasksToInsert.length,
    error: alertResult.error || taskResult.error,
  };
}
 
export async function checkProductivityAlerts(clinicians, visitsByClinician) {
  if (!clinicians || !clinicians.length) return;
  var prodAlerts = [];
  clinicians.forEach(function(c) {
    var stats = visitsByClinician[c.full_name] || { completed: 0 };
    var done = stats.completed;
    var target = c.employment_type === 'ft' ? 25 : c.employment_type === 'pt' ? 15 : 10;
    var pct = target > 0 ? (done / target) * 100 : 0;
    if (c.employment_type === 'prn' && done >= 10) {
      prodAlerts.push({ alert_type: 'productivity_low', priority: 'medium', title: 'PRN Alert: ' + c.full_name + ' at ' + done + ' visits', message: 'PRN clinician has reached the 10-visit threshold. Region ' + c.region + '.', clinician_name: c.full_name, region: c.region, assigned_to_region: c.region, is_read: false, is_dismissed: false });
    } else if (c.employment_type !== 'prn' && pct < 50 && done > 0) {
      prodAlerts.push({ alert_type: 'productivity_low', priority: 'high', title: 'Low Productivity: ' + c.full_name + ' (' + Math.round(pct) + '%)', message: done + ' of ' + target + ' visits completed. Region ' + c.region + '.', clinician_name: c.full_name, region: c.region, assigned_to_region: c.region, is_read: false, is_dismissed: false });
    }
  });
  if (prodAlerts.length > 0) {
    await supabase.from('alerts').delete().eq('alert_type', 'productivity_low').eq('is_read', false);
    await supabase.from('alerts').insert(prodAlerts);
  }
}
 
// Generate auth-based tasks for coordinators
export async function runAuthAlertEngine() {
  var today = new Date(); today.setHours(0,0,0,0);
  var todayStr = today.toISOString().split('T')[0];
 
  // Run nightly cleanup: flip status='expired' and is_currently_active=false on any past-expiry auth.
  // Returns affected patient list and re-sequences each. Safe to call on every run (idempotent).
  var cleanup = await supabase.rpc('mark_expired_auths');
  var newlyExpired = (cleanup && cleanup.data && cleanup.data[0]) ? (cleanup.data[0].affected_patients || []) : [];
 
  // Pull both currently-active auths (for renewal/critical tasks) AND just-expired auths (for expired tasks)
  var activeRes = await supabase.from('auth_tracker')
    .select('id, patient_name, insurance, insurance_type, region, auth_status, visits_authorized, visits_used, auth_expiry_date, is_currently_active')
    .in('auth_status', ['active', 'renewal_needed'])
    .eq('is_currently_active', true);
 
  var expiredRes = await supabase.from('auth_tracker')
    .select('id, patient_name, insurance, region, auth_expiry_date')
    .eq('auth_status', 'expired')
    .gte('auth_expiry_date', new Date(today.getTime() - 30*86400000).toISOString().split('T')[0]); // expired within last 30d
 
  if (activeRes.error) { console.warn('auth alert active fetch:', activeRes.error.message); return; }
 
  var tasksToInsert = [];
 
  (activeRes.data || []).forEach(function(r) {
    // PPO plans don't require authorization — skip alert generation
    if ((r.insurance_type || '').toLowerCase() === 'ppo') return;
    var remaining = Math.max((r.visits_authorized || 0) - (r.visits_used || 0), 0);
    var expDays = r.auth_expiry_date ? Math.round((new Date(r.auth_expiry_date) - today) / (1000*60*60*24)) : null;
    var coord = REGION_COORD[r.region] || null;
 
    if (remaining <= 7 && remaining > 0) {
      tasksToInsert.push({
        task_type: 'auth_critical', priority: 'critical',
        title: 'Auth Critical: ' + r.patient_name,
        description: remaining + ' visits remaining (' + r.insurance + '). Submit renewal immediately.',
        patient_name: r.patient_name, auth_tracker_id: r.id,
        coordinator_region: r.region, assigned_to: coord,
        status: 'open', auto_generated: true,
        due_date: todayStr,
      });
    } else if (remaining <= 10 && remaining > 7) {
      tasksToInsert.push({
        task_type: 'auth_renewal', priority: 'high',
        title: 'Auth Renewal Needed: ' + r.patient_name,
        description: remaining + ' visits remaining (' + r.insurance + '). Begin renewal process.',
        patient_name: r.patient_name, auth_tracker_id: r.id,
        coordinator_region: r.region, assigned_to: coord,
        status: 'open', auto_generated: true,
      });
    }
 
    if (expDays !== null && expDays <= 14 && expDays >= 0) {
      tasksToInsert.push({
        task_type: expDays <= 3 ? 'auth_critical' : 'auth_renewal',
        priority: expDays <= 3 ? 'critical' : 'high',
        title: 'Auth Expiring in ' + expDays + 'd: ' + r.patient_name,
        description: 'Auth expires ' + r.auth_expiry_date + ' (' + r.insurance + '). Contact PCP for renewal.',
        patient_name: r.patient_name, auth_tracker_id: r.id,
        coordinator_region: r.region, assigned_to: coord,
        status: 'open', auto_generated: true,
        due_date: r.auth_expiry_date,
      });
    }
  });
 
  // Generate auth_expired tasks for the recently-expired set (30-day window keeps the queue actionable, not a graveyard)
  (expiredRes.data || []).forEach(function(r) {
    var coord = REGION_COORD[r.region] || null;
    tasksToInsert.push({
      task_type: 'auth_expired', priority: 'critical',
      title: 'Auth EXPIRED: ' + r.patient_name,
      description: 'Auth expired ' + r.auth_expiry_date + ' (' + (r.insurance || '—') + '). Confirm successor auth is active or halt scheduling.',
      patient_name: r.patient_name, auth_tracker_id: r.id,
      coordinator_region: r.region, assigned_to: coord,
      status: 'open', auto_generated: true,
      due_date: todayStr,
    });
  });
 
  // Use upsert pattern matching coordinator_tasks_auto_dedupe partial unique index
  // (avoids the delete-then-insert race condition that conflicts with the dedupe pattern)
  if (tasksToInsert.length > 0) {
    var upsertRes = await supabase.from('coordinator_tasks').upsert(tasksToInsert, {
      onConflict: 'auth_tracker_id,task_type',
      ignoreDuplicates: false,
    });
    if (upsertRes.error) console.warn('coordinator_tasks upsert:', upsertRes.error.message);
  }
 
  // Close out any open auto auth tasks whose underlying auth no longer warrants them
  // (e.g., visits_used was corrected, expiry was extended)
  var liveAuthIds = (activeRes.data || []).map(r => r.id).concat((expiredRes.data || []).map(r => r.id));
  if (liveAuthIds.length > 0) {
    await supabase.from('coordinator_tasks')
      .update({ status: 'auto_closed', updated_at: new Date().toISOString() })
      .eq('auto_generated', true)
      .eq('status', 'open')
      .in('task_type', ['auth_critical', 'auth_renewal', 'auth_expired'])
      .not('auth_tracker_id', 'in', '(' + liveAuthIds.map(id => '"' + id + '"').join(',') + ')');
  }
 
  return { tasksCreated: tasksToInsert.length, newlyExpiredPatients: newlyExpired };
}
 
