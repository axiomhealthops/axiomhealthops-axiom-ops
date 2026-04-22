import { useState } from 'react';
import { supabase } from '../lib/supabase';

const STATUS_OPTIONS = [
  'Active',
  'Active - Auth Pendin',
  'Auth Pending',
  'SOC Pending',
  'Eval Pending',
  'Waitlist',
  'On Hold',
  'On Hold - Facility',
  'On Hold - Pt Request',
  'On Hold - MD Request',
  'Hospitalized',
  'Discharge',
  'Discharge - Change I',
  'Non-Admit',
];

export { STATUS_OPTIONS };

export default function StatusChangeModal({ patient, coordinatorId, coordinatorName, onClose, onSaved }) {
  const [newStatus, setNewStatus] = useState(patient.status || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const currentStatus = patient.status || 'Unknown';
  const changed = newStatus !== currentStatus;

  async function handleSave() {
    if (!changed || !reason.trim()) return;
    setSaving(true);
    try {
      // 1. Update census_data status
      const { error: updateErr } = await supabase
        .from('census_data')
        .update({
          status: newStatus,
          previous_status: currentStatus,
          status_changed_at: new Date().toISOString(),
        })
        .eq('id', patient.id);
      if (updateErr) throw updateErr;

      // 2. Log the change to care_coord_notes as an audit trail
      const { error: noteErr } = await supabase
        .from('care_coord_notes')
        .insert({
          patient_name: patient.patient_name,
          region: patient.region,
          note_type: 'status_change',
          note: `Status changed: ${currentStatus} → ${newStatus}\nReason: ${reason.trim()}`,
          coordinator_id: coordinatorId || null,
          contact_date: new Date().toISOString().slice(0, 10),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (noteErr) console.error('Note insert error (non-blocking):', noteErr);

      onSaved();
    } catch (err) {
      console.error('Status change failed:', err);
      alert('Failed to update status: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>
        {/* Header */}
        <div style={{ padding:'16px 22px', background:'#1565C0', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Change Patient Status</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', marginTop:2 }}>{patient.patient_name} · Rgn {patient.region}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.6)' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:16 }}>
          {/* Current status */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>Current Status:</span>
            <span style={{ fontSize:12, fontWeight:700, color:'#1565C0', background:'#EFF6FF', padding:'3px 10px', borderRadius:6 }}>{currentStatus}</span>
          </div>

          {/* New status */}
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>New Status</label>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, outline:'none', background:'var(--card-bg)', cursor:'pointer' }}>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s} disabled={s === currentStatus}>{s}{s === currentStatus ? ' (current)' : ''}</option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>
              Reason for Change <span style={{ color:'#DC2626' }}>*</span>
            </label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="Why is this patient's status being changed? (e.g., patient requested hold, MD discharged, back from facility...)"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, outline:'none', background:'var(--bg)', resize:'vertical', boxSizing:'border-box' }} />
          </div>

          {/* Change preview */}
          {changed && reason.trim() && (
            <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:8, padding:'10px 14px', fontSize:11 }}>
              <strong style={{ color:'#92400E' }}>Preview:</strong>
              <span style={{ color:'#78350F' }}> {currentStatus} → <strong>{newStatus}</strong></span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)', borderRadius:'0 0 14px 14px' }}>
          <button onClick={onClose}
            style={{ padding:'7px 14px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, cursor:'pointer', background:'var(--card-bg)' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !changed || !reason.trim()}
            style={{ padding:'7px 18px', background: changed && reason.trim() ? '#1565C0' : '#9CA3AF', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:700, cursor: changed && reason.trim() ? 'pointer' : 'not-allowed', opacity: changed && reason.trim() ? 1 : 0.6 }}>
            {saving ? 'Saving…' : 'Update Status'}
          </button>
        </div>
      </div>
    </div>
  );
}
