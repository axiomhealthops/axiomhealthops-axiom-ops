import { supabase } from './supabase';
 
export async function runAlertEngine(visits) {
  if (!visits || !visits.length) return { created: 0 };
 
  var alertsToInsert = [];
  var seen = {};
 
  function addAlert(a) {
    var key = a.alert_type + '|' + (a.patient_name || '') + '|' + (a.clinician_name || '') + '|' + (a.related_date || '');
    if (seen[key]) return;
    seen[key] = true;
    alertsToInsert.push(Object.assign({
      created_at: new Date().toISOString(),
      is_read: false,
      is_dismissed: false,
    }, a));
  }
 
  visits.forEach(function(v) {
    var status = (v.status || '').toLowerCase();
    var eventType = (v.event_type || '').toLowerCase();
    var region = v.region || '?';
    var patient = v.patient_name || 'Unknown Patient';
    var clinician = v.staff_name || 'Unknown Clinician';
    var date = v.raw_date || '';
 
    if (status.includes('missed') && !status.includes('active')) {
      addAlert({
        alert_type: 'missed_visit',
        priority: 'high',
        title: 'Missed Visit: ' + patient,
        message: clinician + ' · Region ' + region + ' · ' + date + '. Follow up to reschedule before end of week.',
        patient_name: patient,
        clinician_name: clinician,
        region: region,
        assigned_to_region: region,
        related_date: date || null,
      });
    }
 
    if (status.includes('missed') && status.includes('active')) {
      addAlert({
        alert_type: 'missed_active',
        priority: 'critical',
        title: 'Note Not Submitted: ' + patient,
        message: clinician + ' · Region ' + region + ' · ' + date + '. Visit completed but note NOT submitted — cannot bill until resolved.',
        patient_name: patient,
        clinician_name: clinician,
        region: region,
        assigned_to_region: region,
        related_date: date || null,
      });
    }
 
    if (status.includes('cancelled')) {
      addAlert({
        alert_type: 'cancelled_visit',
        priority: 'high',
        title: 'Cancelled Visit: ' + patient,
        message: clinician + ' · Region ' + region + ' · ' + date + '. Consider rescheduling to maintain clinician productivity.',
        patient_name: patient,
        clinician_name: clinician,
        region: region,
        assigned_to_region: region,
        related_date: date || null,
      });
    }
 
    if (eventType.includes('eval') && !eventType.includes('reassess') && !eventType.includes('re-eval')) {
      addAlert({
        alert_type: 'eval_due',
        priority: 'medium',
        title: 'New Evaluation: ' + patient,
        message: clinician + ' · Region ' + region + ' · ' + date + '. New patient eval — schedule 4x/week visits for 4 weeks post-eval.',
        patient_name: patient,
        clinician_name: clinician,
        region: region,
        assigned_to_region: region,
        related_date: date || null,
      });
    }
 
    if (eventType.includes('reassess') || eventType.includes('recert') || eventType.includes('re-eval') || eventType.includes('re-assess')) {
      addAlert({
        alert_type: 'reassessment_due',
        priority: 'high',
        title: 'Reassessment: ' + patient,
        message: clinician + ' · Region ' + region + ' · ' + date + '. 30-day reassessment — update visit frequency per therapist recommendation.',
        patient_name: patient,
        clinician_name: clinician,
        region: region,
        assigned_to_region: region,
        related_date: date || null,
      });
    }
  });
 
  if (!alertsToInsert.length) return { created: 0 };
 
  await supabase.from('alerts')
    .delete()
    .in('alert_type', ['missed_visit', 'missed_active', 'cancelled_visit', 'eval_due', 'reassessment_due'])
    .eq('is_read', false);
 
  var result = await supabase.from('alerts').insert(alertsToInsert);
  return { created: alertsToInsert.length, error: result.error };
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
      prodAlerts.push({
        alert_type: 'productivity_low',
        priority: 'medium',
        title: 'PRN Alert: ' + c.full_name + ' at ' + done + ' visits',
        message: 'PRN clinician has reached the 10-visit alert threshold this week. Region ' + c.region + '.',
        clinician_name: c.full_name,
        region: c.region,
        assigned_to_region: c.region,
        is_read: false,
        is_dismissed: false,
      });
    } else if (c.employment_type !== 'prn' && pct < 50 && done > 0) {
      prodAlerts.push({
        alert_type: 'productivity_low',
        priority: 'high',
        title: 'Low Productivity: ' + c.full_name + ' (' + Math.round(pct) + '%)',
        message: done + ' of ' + target + ' visits completed this week. Region ' + c.region + '. Review schedule and patient load.',
        clinician_name: c.full_name,
        region: c.region,
        assigned_to_region: c.region,
        is_read: false,
        is_dismissed: false,
      });
    }
  });
 
  if (prodAlerts.length > 0) {
    await supabase.from('alerts').delete().eq('alert_type', 'productivity_low').eq('is_read', false);
    await supabase.from('alerts').insert(prodAlerts);
  }
}
 
