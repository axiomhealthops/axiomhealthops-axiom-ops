import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useRealtimeTable } from '../hooks/useRealtimeTable';
import { useAuth } from '../hooks/useAuth';

/**
 * MentionsBell — notification bell for @mention tags in patient chart notes.
 * Shows unread count badge and dropdown panel with tagged notes.
 */
export default function MentionsBell() {
  const { profile } = useAuth();
  const [notifs, setNotifs] = useState([]);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef();

  function fetchNotifs() {
    if (!profile?.id) return;

    // Count of unread
    supabase.from('note_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('read', false)
      .then(({ count }) => setUnreadCount(count || 0));

    // Fetch recent notifications with note details
    supabase.from('note_notifications')
      .select('*, note:patient_notes(*)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setNotifs(data || []));
  }

  useEffect(() => { fetchNotifs(); }, [profile?.id]);
  useRealtimeTable('note_notifications', fetchNotifs);

  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function markRead(id) {
    supabase.from('note_notifications').update({ read: true }).eq('id', id).then(fetchNotifs);
  }

  function markAllRead() {
    supabase.from('note_notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
      .then(fetchNotifs);
  }

  function cleanNoteText(t) {
    if (!t) return '';
    return t.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1');
  }

  const [expandedId, setExpandedId] = useState(null);

  function timeAgo(d) {
    const now = new Date();
    const then = new Date(d);
    const mins = Math.floor((now - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  if (!profile) return null;

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifs(); }}
        style={{
          position: 'relative', background: 'none', border: '1px solid var(--border)', borderRadius: 8,
          padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--black)',
        }}>
        <span style={{ fontSize: 16 }}>💬</span>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, background: '#1565C0', color: '#fff',
            borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16,
            textAlign: 'center', lineHeight: '14px',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', width: 380, maxHeight: 480, display: 'flex', flexDirection: 'column',
          background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 8px 30px rgba(0,0,0,0.14)', zIndex: 9999,
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)' }}>Mentions</div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>
                {unreadCount} unread mention{unreadCount !== 1 ? 's' : ''}
              </div>
            </div>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ fontSize: 11, color: '#1565C0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div style={{ overflow: 'auto', flex: 1 }}>
            {notifs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>No mentions yet</div>
                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>You'll see notifications here when someone tags you in a patient note.</div>
              </div>
            ) : notifs.map(n => {
              const note = n.note;
              const fullText = cleanNoteText(note?.note_text);
              const isLong = fullText.length > 120;
              const isExpanded = expandedId === n.id;
              const displayText = isLong && !isExpanded ? fullText.slice(0, 120) + '...' : fullText;
              return (
                <div key={n.id}
                  onClick={() => {
                    if (!n.read) markRead(n.id);
                    // Navigate to the patient in census when clicked
                    if (n.patient_name) {
                      window.dispatchEvent(new CustomEvent('axiom-navigate', {
                        detail: { page: 'census', intent: { searchPatient: n.patient_name } }
                      }));
                      setOpen(false);
                    } else if (isLong) {
                      setExpandedId(isExpanded ? null : n.id);
                    }
                  }}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                    background: n.read ? 'transparent' : '#EFF6FF', borderLeft: n.read ? 'none' : '3px solid #1565C0',
                    transition: 'background 0.15s',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{note?.author_name || 'Unknown'}</span>
                        <span style={{ fontSize: 10, color: 'var(--gray)' }}>mentioned you</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#1565C0', fontWeight: 600, marginBottom: 4 }}>
                        Re: {n.patient_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', lineHeight: 1.4, whiteSpace: isExpanded ? 'pre-wrap' : undefined }}>
                        {displayText}
                      </div>
                      {isLong && (
                        <div style={{ fontSize: 10, color: '#1565C0', fontWeight: 600, marginTop: 3, cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : n.id); if (!n.read) markRead(n.id); }}>
                          {isExpanded ? 'Show less' : 'Read full comment'}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 4 }}>
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                    {!n.read && (
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1565C0', flexShrink: 0, marginTop: 4 }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0,
            background: 'var(--bg)', borderRadius: '0 0 12px 12px', textAlign: 'center',
          }}>
            <button onClick={fetchNotifs} style={{ fontSize: 11, color: '#1565C0', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
