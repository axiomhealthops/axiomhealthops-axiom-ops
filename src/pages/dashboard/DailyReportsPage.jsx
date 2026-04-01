import React, { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth.jsx';
import { REGIONS } from '../../lib/constants';
 
export default function DailyReportsPage() {
  var { profile } = useAuth();
  var [reports, setReports] = useState([]);
  var [loading, setLoading] = useState(true);
  var [showForm, setShowForm] = useState(false);
  var [activeTab, setActiveTab] = useState('all');
  var [form, setForm] = useState({
    report_type: 'morning',
    region: '',
    census_count: '',
    visits_completed: '',
    visits_scheduled: '',
    on_hold_count: '',
    discharges: '',
    referrals: '',
    notes: '',
  });
 
  useEffect(function() { fetchReports(); }, []);
 
  function fetchReports() {
    supabase.from('daily_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(function(res) {
        setReports(res.data || []);
        setLoading(false);
      });
  }
 
  function handleSubmit(e) {
    e.preventDefault();
    supabase.from('daily_reports').insert([{
      coordinator_id: profile ? profile.id : null,
      report_date: new Date().toISOString().split('T')[0],
      report_type: form.report_type,
      region: form.region,
      census_count: parseInt(form.census_count) || 0,
      visits_completed: parseInt(form.visits_completed) || 0,
      visits_scheduled: parseInt(form.visits_scheduled) || 0,
      on_hold_count: parseInt(form.on_hold_count) || 0,
      discharges: parseInt(form.discharges) || 0,
      referrals: parseInt(form.referrals) || 0,
      notes: form.notes,
    }]).then(function() {
      setForm({ report_type: 'morning', region: '', census_count: '', visits_completed: '', visits_scheduled: '', on_hold_count: '', discharges: '', referrals: '', notes: '' });
      setShowForm(false);
      fetchReports();
    });
  }
 
  var today = new Date().toISOString().split('T')[0];
  var todayReports = reports.filter(function(r) { return r.report_date === today; });
  var filtered = activeTab === 'today' ? todayReports : reports;
 
  var INP = { padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none' };
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Daily Reports"
        subtitle={todayReports.length + ' submitted today \u00b7 ' + reports.length + ' total'}
        actions={
          <button onClick={function() { setShowForm(!showForm); }} style={{ padding: '8px 16px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + Submit Report
          </button>
        }
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>
 
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg)', borderRadius: 8, padding: 4, border: '1px solid var(--border)', width: 'fit-content' }}>
          {[['all', 'All Reports'], ['today', "Today's Reports"]].map(function(item) {
            var key = item[0];
            var label = item[1];
            var isActive = activeTab === key;
            return (
              <button key={key} onClick={function() { setActiveTab(key); }}
                style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: isActive ? 600 : 500, cursor: 'pointer', background: isActive ? 'var(--card-bg)' : 'none', color: isActive ? 'var(--black)' : 'var(--gray)', boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                {label}
                {key === 'today' && todayReports.length > 0 && (
                  <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 999, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{todayReports.length}</span>
                )}
              </button>
            );
          })}
        </div>
 
        {showForm && (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Submit Daily Report</div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <select value={form.report_type} onChange={function(e) { setForm(Object.assign({}, form, { report_type: e.target.value })); }} style={INP}>
                  <option value="morning">Morning Report</option>
                  <option value="eod">EOD Report</option>
                </select>
                <select value={form.region} onChange={function(e) { setForm(Object.assign({}, form, { region: e.target.value })); }} style={INP}>
                  <option value="">Select Region</option>
                  {['A','B','C','G','H','J','M','N','T','V'].map(function(r) {
                    return React.createElement('option', { key: r, value: r }, 'Region ' + r + ' \u2014 ' + (REGIONS[r] || ''));
                  })}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
                {[['census_count','Census Count'],['visits_completed','Visits Completed'],['visits_scheduled','Visits Scheduled'],['on_hold_count','On Hold'],['discharges','Discharges'],['referrals','Referrals']].map(function(item) {
                  var field = item[0];
                  var label = item[1];
                  return (
                    <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
                      <input type="number" min="0" value={form[field]} onChange={function(e) { var u = {}; u[field] = e.target.value; setForm(Object.assign({}, form, u)); }}
                        style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 16, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--black)', background: 'var(--bg)', outline: 'none', textAlign: 'center' }} />
                    </div>
                  );
                })}
              </div>
              <textarea placeholder="Notes, flags, or anything the team needs to know..." value={form.notes} onChange={function(e) { setForm(Object.assign({}, form, { notes: e.target.value })); }}
                rows={3} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none', resize: 'vertical', fontFamily: 'DM Sans, sans-serif' }} />
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="submit" style={{ padding: '10px 20px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Submit Report</button>
                <button type="button" onClick={function() { setShowForm(false); }} style={{ padding: '10px 20px', background: 'none', color: 'var(--gray)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </form>
          </div>
        )}
 
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>&#128203;</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--black)' }}>No reports yet</div>
            <div style={{ color: 'var(--gray)', fontSize: 13, marginTop: 6 }}>Click "+ Submit Report" to file the first report</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(function(r) {
              var isMorning = r.report_type === 'morning';
              return (
                <div key={r.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: isMorning ? '#EFF6FF' : '#FEF3C7', color: isMorning ? '#1E40AF' : '#92400E' }}>
                        {isMorning ? '\uD83C\uDF05 Morning' : '\uD83C\uDF06 EOD'}
                      </span>
                      <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--gray)' }}>{r.report_date}</span>
                      {r.region && (
                        <span style={{ fontSize: 12, color: 'var(--gray)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}>
                          Region {r.region} \u2014 {REGIONS[r.region] || ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 12 }}>
                    {[['Census', r.census_count],['Completed', r.visits_completed],['Scheduled', r.visits_scheduled],['On Hold', r.on_hold_count],['Discharges', r.discharges],['Referrals', r.referrals]].map(function(item) {
                      return (
                        <div key={item[0]} style={{ textAlign: 'center', background: 'var(--bg)', borderRadius: 8, padding: '8px 4px' }}>
                          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' }}>{item[1] !== null && item[1] !== undefined ? item[1] : '\u2014'}</div>
                          <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item[0]}</div>
                        </div>
                      );
                    })}
                  </div>
                  {r.notes && (
                    <div style={{ fontSize: 13, color: 'var(--gray)', background: 'var(--bg)', borderRadius: 8, padding: '10px 14px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--black)' }}>Notes: </span>{r.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
 
