import React, { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { REGIONS } from '../../lib/constants';

export default function OnHoldRecoveryPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patient_name: '', region: '', hold_reason: '', hold_date: '', notes: '' });

  useEffect(() => { fetchRecords(); }, []);

  async function fetchRecords() {
    const { data } = await supabase.from('on_hold_recovery').select('*').order('created_at', { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await supabase.from('on_hold_recovery').insert([{ ...form, recovery_status: 'on_hold' }]);
    setForm({ patient_name: '', region: '', hold_reason: '', hold_date: '', notes: '' });
    setShowForm(false);
    fetchRecords();
  }

  async function updateStatus(id, status) {
    await supabase.from('on_hold_recovery').update({
      recovery_status: status,
      recovery_date: status === 'recovered' ? new Date().toISOString().split('T')[0] : null,
    }).eq('id', id);
    fetchRecords();
  }

  const onHold = records.filter(r => r.recovery_status === 'on_hold');
  const recovered = records.filter(r => r.recovery_status === 'recovered');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="On-Hold Recovery"
        subtitle={`${onHold.length} on hold · ${recovered.length} recovered`}
        actions={<button onClick={() => setShowForm(!showForm)} style={styles.addBtn}>+ Add Patient</button>}
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>
        <div style={styles.summaryRow}>
          {[['On Hold', onHold.length, 'var(--danger)'], ['Recovered', recovered.length, 'var(--green)'], ['Recovery Rate', records.length > 0 ? Math.round((recovered.length / records.length) * 100) + '%' : '0%', 'var(--blue)']].map(([label, val, color]) => (
            <div key={label} style={styles.summaryCard}>
              <div style={styles.summaryLabel}>{label}</div>
              <div style={{ ...styles.summaryVal, color }}>{val}</div>
            </div>
          ))}
        </div>

        {showForm && (
          <div style={styles.formCard}>
            <form onSubmit={handleSubmit}>
              <div style={styles.formGrid}>
                <input required placeholder="Patient Name" value={form.patient_name} onChange={e => setForm({...form, patient_name: e.target.value})} style={styles.input} />
                <input placeholder="Region" value={form.region} onChange={e => setForm({...form, region: e.target.value})} style={styles.input} />
                <input placeholder="Hold Reason" value={form.hold_reason} onChange={e => setForm({...form, hold_reason: e.target.value})} style={styles.input} />
                <input type="date" value={form.hold_date} onChange={e => setForm({...form, hold_date: e.target.value})} style={styles.input} />
              </div>
              <input placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} style={{...styles.input, width: '100%', marginTop: 10}} />
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="submit" style={styles.submitBtn}>Save</button>
                <button type="button" onClick={() => setShowForm(false)} style={styles.cancelBtn}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {loading ? <div style={styles.empty}>Loading...</div> : onHold.length === 0 && recovered.length === 0 ? (
          <div style={styles.empty}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏸</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No patients on hold</div>
            <div style={{ color: 'var(--gray)', fontSize: 13, marginTop: 6 }}>Click "+ Add Patient" to track on-hold recovery</div>
          </div>
        ) : (
          <>
            {onHold.length > 0 && (
              <>
                <div style={styles.sectionLabel}>On Hold ({onHold.length})</div>
                <div style={styles.table}>
                  <div style={styles.tableHeader}>
                    <span>Patient</span><span>Region</span><span>Coordinator</span>
                    <span>Hold Reason</span><span>Hold Date</span><span>Action</span>
                  </div>
                  {onHold.map(r => (
                    <div key={r.id} style={styles.tableRow}>
                      <span style={styles.cellName}>{r.patient_name}</span>
                      <span style={styles.cell}>Region {r.region}</span>
                      <span style={styles.cell}>{REGIONS[r.region] || '—'}</span>
                      <span style={styles.cell}>{r.hold_reason || '—'}</span>
                      <span style={styles.cell}>{r.hold_date || '—'}</span>
                      <span style={styles.cell}>
                        <button onClick={() => updateStatus(r.id, 'recovered')} style={styles.recoverBtn}>Mark Recovered</button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {recovered.length > 0 && (
              <>
                <div style={{ ...styles.sectionLabel, marginTop: 24 }}>Recovered ({recovered.length})</div>
                <div style={styles.table}>
                  <div style={styles.tableHeader}>
                    <span>Patient</span><span>Region</span><span>Hold Reason</span>
                    <span>Hold Date</span><span>Recovery Date</span><span>Status</span>
                  </div>
                  {recovered.map(r => (
                    <div key={r.id} style={{ ...styles.tableRow, opacity: 0.7 }}>
                      <span style={styles.cellName}>{r.patient_name}</span>
                      <span style={styles.cell}>Region {r.region}</span>
                      <span style={styles.cell}>{r.hold_reason || '—'}</span>
                      <span style={styles.cell}>{r.hold_date || '—'}</span>
                      <span style={styles.cell}>{r.recovery_date || '—'}</span>
                      <span style={styles.cell}>
                        <span style={{ background: '#ECFDF5', color: '#065F46', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>Recovered</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  addBtn: { p
