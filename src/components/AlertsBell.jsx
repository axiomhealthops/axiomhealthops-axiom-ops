import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
 
var PRIORITY_COLORS = {
  critical: { bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5', dot: '#DC2626' },
  high: { bg: '#FFF7ED', color: '#92400E', border: '#FCD34D', dot: '#F59E0B' },
  medium: { bg: '#EFF6FF', color: '#1E40AF', border: '#93C5FD', dot: '#3B82F6' },
  low: { bg: '#F9FAFB', color: '#374151', border: '#E5E7EB', dot: '#9CA3AF' },
};
 
var TYPE_ICONS = {
  missed_visit: '\u26A0',
  cancelled_visit: '\u2716',
  missed_active: '\uD83D\uDCCB',
  eval_due: '\uD83D\uDD35',
  reassessment_due: '\uD83D\uDD04',
  auth_expiring: '\u23F1',
  auth_expired: '\uD83D\uDD34',
  hospitalized_followup: '\uD83C\uDFE5',
  productivity_low: '\uD83D\uDCC9',
  auth_activated: '\u2705',
  patient_discharged_hospital: '\uD83C\uDFE0',
};
 
export default function AlertsBell() {
  var [alerts, setAlerts] = useState([]);
  var [open, setOpen] = useState(false);
  var [loading, setLoading] = useState(false);
  var panelRef = useRef();
 
  function fetchAlerts() {
    setLoading(true);
    supabase.from('alerts')
      .select('*')
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(60)
      .then(function(res) {
        setAlerts(res.data || []);
        setLoading(false);
      });
  }
 
  useEffect(function() {
    fetchAlerts();
    var interval = setInterval(fetchAlerts, 60000);
    return function() { clearInterval(interval); };
  }, []);
 
  useEffect(function() {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [open]);
 
  var unread = alerts.filter(function(a) { return !a.is_read; }).length;
  var critical = alerts.filter(function(a) { return a.priority === 'critical' && !a.is_read; }).length;
 
  function markRead(id) {
    supabase.from('alerts').update({ is_read: true }).eq('id', id).then(fetchAlerts);
  }
 
  function dismiss(id) {
    supabase.from('alerts').update({ is_dismissed: true }).eq('id', id).then(fetchAlerts);
  }
 
  function markAllRead() {
    supabase.from('alerts')
      .update({ is_read: true })
      .eq('is_read', false)
      .eq('is_dismissed', false)
      .then(fetchAlerts);
  }
 
  function clearRead() {
    supabase.from('alerts')
      .update({ is_dismissed: true })
      .eq('is_read', true)
      .then(fetchAlerts);
  }
 
  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button
        onClick={function() { setOpen(!open); if (!open) fetchAlerts(); }}
        style={{ position: 'relative', background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--black)' }}>
        <span style={{ fontSize: 16 }}>&#128276;</span>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, background: critical > 0 ? '#DC2626' : '#F59E0B', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center', lineHeight: '14px' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
 
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', width: 400, maxHeight: 540, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.14)', zIndex: 9999 }}>
 
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)' }}>Alerts</div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{unread} unread of {alerts.length} total</div>
            </div>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ fontSize: 11, color: '#1565C0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                Mark all read
              </button>
            )}
          </div>
 
          <div style={{ overflow: 'auto', flex: 1 }}>
            {loading && alerts.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>Loading...</div>
            ) : alerts.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>&#9989;</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>All clear</div>
                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>No active alerts</div>
              </div>
            ) : alerts.map(function(a) {
              var pc = PRIORITY_COLORS[a.priority] || PRIORITY_COLORS.medium;
              var icon = TYPE_ICONS[a.alert_type] || '&#128276;';
              return (
                <div key={a.id}
                  onClick={function() { if (!a.is_read) markRead(a.id); }}
                  style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: a.is_read ? 'transparent' : pc.bg, borderLeft: '3px solid ' + pc.dot, transition: 'background 0.15s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, flex: 1 }}>
                      <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: a.is_read ? 500 : 700, color: 'var(--black)', lineHeight: 1.35 }}>{a.title}</div>
                        {a.message && (
                          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3, lineHeight: 1.45 }}>{a.message}</div>
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: pc.color, background: pc.bg, border: '1px solid ' + pc.border, padding: '1px 6px', borderRadius: 4 }}>
                            {(a.priority || '').toUpperCase()}
                          </span>
                          {a.region && (
                            <span style={{ fontSize: 10, color: 'var(--gray)', background: 'var(--bg)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 4 }}>
                              Region {a.region}
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: 'var(--gray)' }}>
                            {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={function(e) { e.stopPropagation(); dismiss(a.id); }}
                      style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>
                      &#10005;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
 
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg)', borderRadius: '0 0 12px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={clearRead} style={{ fontSize: 11, color: 'var(--gray)', background: 'none', border: 'none', cursor: 'pointer' }}>
              Clear read alerts
            </button>
            <button onClick={fetchAlerts} style={{ fontSize: 11, color: '#1565C0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
 
