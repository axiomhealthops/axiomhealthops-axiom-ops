import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const VISIT_TYPES = [
  { value: 'routine', label: 'Routine Visit' },
  { value: 'eval', label: 'Evaluation' },
  { value: 'reassessment', label: 'Reassessment' },
  { value: 'follow_up', label: 'Follow-Up' },
  { value: 'wound_care', label: 'Wound Care' },
  { value: 'supervisory', label: 'Supervisory Visit' },
  { value: 'discharge', label: 'Discharge Visit' },
];

const TIME_SLOTS = [
  '8:00 AM','8:30 AM','9:00 AM','9:30 AM','10:00 AM','10:30 AM',
  '11:00 AM','11:30 AM','12:00 PM','12:30 PM','1:00 PM','1:30 PM',
  '2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM','4:30 PM','5:00 PM',
];

const RECURRENCE = [
  { value: '', label: 'One-time visit' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];

export default function ScheduleVisitModal({ patient, coordinatorId, coordinatorName, onClose, onSaved, existingVisit }) {
  const [clinicians, setClinicians] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [saving, setSaving] = useState(false);

  const isEdit = !!existingVisit;

  const [form, setForm] = useState({
    visit_date: existingVisit?.visit_date || '',
    visit_time: existingVisit?.visit_time || '',
    visit_type: existingVisit?.visit_type || 'routine',
    clinician_id: existingVisit?.clinician_id || '',
    clinician_name: existingVisit?.clinician_name || '',
    notes: existingVisit?.notes || '',
    is_recurring: existingVisit?.is_recurring || false,
    recurrence_pattern: existingVisit?.recurrence_pattern || '',
    recurrence_end_date: existingVisit?.recurrence_end_date || '',
  });

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // Load clinicians
  useEffect(() => {
    supabase.from('clinicians').select('id, full_name, discipline, region, is_active')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setClinicians(data || []));
  }, []);

  // Check conflicts when date/time/clinician changes
  useEffect(() => {
    if (!form.visit_date || !form.clinician_id) { setConflicts([]); return; }
    const q = supabase.from('scheduled_visits')
      .select('id, patient_name, visit_time, visit_type')
      .eq('visit_date', form.visit_date)
      .eq('clinician_id', form.clinician_id)
      .in('status', ['scheduled', 'confirmed']);

    if (isEdit) q.neq('id', existingVisit.id);

    q.then(({ data }) => setConflicts(data || []));
  }, [form.visit_date, form.clinician_id, form.visit_time]);

  // Filter clinicians by patient region if available
  const filteredClinicians = useMemo(() => {
    if (!patient?.region) return clinicians;
    return clinicians.filter(c => c.region === patient.region || c.region === 'All' || (c.region && c.region.split(',').map(r => r.trim()).includes(patient.region)));
  }, [clinicians, patient?.region]);

  const otherRegionClinicians = useMemo(() => {
    if (!patient?.region) return [];
    return clinicians.filter(c => c.region !== patient.region && c.region !== 'All' && !(c.region && c.region.split(',').map(r => r.trim()).includes(patient.region)));
  }, [clinicians, patient?.region]);

  // Time conflict check
  const hasTimeConflict = form.visit_time && conflicts.some(c => c.visit_time === form.visit_time);

  async function handleSave() {
    if (!form.visit_date || !form.clinician_id || !form.visit_type) return;
    setSaving(true);

    try {
      const payload = {
        patient_name: patient.patient_name,
        region: patient.region || null,
        visit_date: form.visit_date,
        visit_time: form.visit_time || null,
        visit_type: form.visit_type,
        clinician_id: form.clinician_id,
        clinician_name: form.clinician_name,
        notes: form.notes || null,
        is_recurring: form.is_recurring,
        recurrence_pattern: form.is_recurring ? form.recurrence_pattern : null,
        recurrence_end_date: form.is_recurring && form.recurrence_end_date ? form.recurrence_end_date : null,
        created_by: coordinatorId || null,
        created_by_name: coordinatorName || null,
        updated_at: new Date().toISOString(),
      };

      if (isEdit) {
        const { error } = await supabase.from('scheduled_visits')
          .update(payload).eq('id', existingVisit.id);
        if (error) throw error;
      } else {
        // Insert primary visit
        const { data: primary, error } = await supabase.from('scheduled_visits')
          .insert({ ...payload, status: 'scheduled' })
          .select('id')
          .single();
        if (error) throw error;

        // Generate recurring visits if applicable
        if (form.is_recurring && form.recurrence_pattern && form.recurrence_end_date) {
          const recurringVisits = [];
          let currentDate = new Date(form.visit_date + 'T00:00:00');
          const endDate = new Date(form.recurrence_end_date + 'T00:00:00');
          const increment = form.recurrence_pattern === 'weekly' ? 7
            : form.recurrence_pattern === 'biweekly' ? 14 : 30;

          while (true) {
            currentDate = new Date(currentDate.getTime() + increment * 86400000);
            if (currentDate > endDate) break;
            const dateStr = currentDate.toISOString().split('T')[0];
            recurringVisits.push({
              ...payload,
              visit_date: dateStr,
              status: 'scheduled',
              parent_visit_id: primary.id,
            });
          }

          if (recurringVisits.length > 0) {
            const { error: recErr } = await supabase.from('scheduled_visits').insert(recurringVisits);
            if (recErr) console.error('Recurring insert error:', recErr);
          }
        }
      }

      onSaved();
    } catch (err) {
      console.error('Schedule save failed:', err);
      alert('Failed to schedule visit: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  const LBL = { fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 };
  const INP = { width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', background: '#059669', borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{isEdit ? 'Edit Visit' : 'Schedule Visit'}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{patient.patient_name} · Rgn {patient.region || '—'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Date + Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Visit Date <span style={{ color: '#DC2626' }}>*</span></label>
              <input type="date" value={form.visit_date} onChange={e => set('visit_date', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                style={INP} />
            </div>
            <div>
              <label style={LBL}>Time</label>
              <select value={form.visit_time} onChange={e => set('visit_time', e.target.value)} style={INP}>
                <option value="">— Flexible —</option>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Clinician */}
          <div>
            <label style={LBL}>Clinician <span style={{ color: '#DC2626' }}>*</span></label>
            <select value={form.clinician_id} onChange={e => {
              const c = clinicians.find(cl => cl.id === e.target.value);
              set('clinician_id', e.target.value);
              set('clinician_name', c?.full_name || '');
            }} style={INP}>
              <option value="">— Select Clinician —</option>
              {filteredClinicians.length > 0 && (
                <optgroup label={`Region ${patient?.region || 'Local'}`}>
                  {filteredClinicians.map(c => (
                    <option key={c.id} value={c.id}>{c.full_name} ({c.discipline})</option>
                  ))}
                </optgroup>
              )}
              {otherRegionClinicians.length > 0 && (
                <optgroup label="Other Regions">
                  {otherRegionClinicians.map(c => (
                    <option key={c.id} value={c.id}>{c.full_name} ({c.discipline}, Rgn {c.region})</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Conflict warning */}
          {conflicts.length > 0 && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
              <strong style={{ color: '#92400E' }}>⚠ This clinician has {conflicts.length} other visit(s) on this date:</strong>
              <div style={{ marginTop: 4 }}>
                {conflicts.map(c => (
                  <div key={c.id} style={{ color: '#78350F' }}>
                    • {c.patient_name} — {c.visit_time || 'Flexible'} ({c.visit_type})
                    {c.visit_time === form.visit_time && form.visit_time && <span style={{ color: '#DC2626', fontWeight: 700 }}> ← TIME CONFLICT</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visit Type */}
          <div>
            <label style={LBL}>Visit Type <span style={{ color: '#DC2626' }}>*</span></label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {VISIT_TYPES.map(vt => (
                <button key={vt.value} onClick={() => set('visit_type', vt.value)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: `2px solid ${form.visit_type === vt.value ? '#059669' : 'var(--border)'}`, background: form.visit_type === vt.value ? '#ECFDF5' : 'var(--card-bg)', fontSize: 11, fontWeight: 600, color: form.visit_type === vt.value ? '#059669' : 'var(--gray)', cursor: 'pointer' }}>
                  {vt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recurring */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              <input type="checkbox" checked={form.is_recurring} onChange={e => set('is_recurring', e.target.checked)} />
              Recurring visit series
            </label>
            {form.is_recurring && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                <div>
                  <label style={LBL}>Frequency</label>
                  <select value={form.recurrence_pattern} onChange={e => set('recurrence_pattern', e.target.value)} style={INP}>
                    {RECURRENCE.filter(r => r.value).map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={LBL}>Repeat Until</label>
                  <input type="date" value={form.recurrence_end_date} onChange={e => set('recurrence_end_date', e.target.value)}
                    min={form.visit_date || new Date().toISOString().split('T')[0]}
                    style={INP} />
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={LBL}>Notes (optional)</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              placeholder="Special instructions, patient preferences..."
              style={{ ...INP, resize: 'vertical' }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg)', borderRadius: '0 0 14px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--gray)' }}>
            {form.is_recurring && form.recurrence_pattern && form.recurrence_end_date && form.visit_date ? (() => {
              const inc = form.recurrence_pattern === 'weekly' ? 7 : form.recurrence_pattern === 'biweekly' ? 14 : 30;
              let count = 0;
              let d = new Date(form.visit_date + 'T00:00:00');
              const end = new Date(form.recurrence_end_date + 'T00:00:00');
              while (d <= end) { count++; d = new Date(d.getTime() + inc * 86400000); }
              return `${count} visits will be scheduled`;
            })() : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: 'var(--card-bg)' }}>
              Cancel
            </button>
            <button onClick={handleSave}
              disabled={saving || !form.visit_date || !form.clinician_id || !form.visit_type}
              style={{ padding: '7px 18px', background: form.visit_date && form.clinician_id ? '#059669' : '#9CA3AF', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: form.visit_date && form.clinician_id ? 'pointer' : 'not-allowed' }}>
              {saving ? 'Saving…' : hasTimeConflict ? '⚠ Schedule Anyway' : (isEdit ? 'Update Visit' : 'Schedule Visit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
