import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

/**
 * PatientNotesPanel — clinical-style chronological notes feed.
 *
 * Props:
 *   patientName (string, required) — the patient this panel is scoped to
 *   maxHeight (string, optional) — CSS max-height for the scroll area, default '400px'
 *
 * Features:
 *   - Chronological note feed (newest first)
 *   - @mention tagging with staff autocomplete
 *   - Creates note_notifications for tagged users
 *   - Sends email notification via Supabase edge function
 */

const ROLE_LABELS = {
  super_admin: 'Director',
  admin: 'Admin',
  care_coordinator: 'Care Coord',
  auth_coordinator: 'Auth Coord',
  intake_coordinator: 'Intake Coord',
  regional_manager: 'RM',
  assoc_director: 'Assoc Dir',
  pod_leader: 'Pod Lead',
  clinician: 'Clinician',
  telehealth: 'Telehealth',
};

const ROLE_COLORS = {
  super_admin: '#7C3AED',
  admin: '#6B7280',
  care_coordinator: '#0891B2',
  auth_coordinator: '#DB2777',
  intake_coordinator: '#059669',
  regional_manager: '#1565C0',
  assoc_director: '#D97706',
  pod_leader: '#9333EA',
  clinician: '#0D9488',
  telehealth: '#6366F1',
};

export default function PatientNotesPanel({ patientName, maxHeight }) {
  const { profile } = useAuth();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef(null);
  const mentionRef = useRef(null);

  // Load staff list for @mentions
  useEffect(() => {
    supabase.from('coordinators').select('id, full_name, email, role')
      .order('full_name')
      .then(({ data }) => setStaff(data || []));
  }, []);

  // Load notes for this patient
  useEffect(() => {
    if (!patientName) return;
    loadNotes();
  }, [patientName]);

  async function loadNotes() {
    setLoading(true);
    const { data } = await supabase
      .from('patient_notes')
      .select('*')
      .eq('patient_name', patientName)
      .order('created_at', { ascending: false });
    setNotes(data || []);
    setLoading(false);
  }

  // Parse @mentions from text
  function parseMentions(t) {
    const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const tagged = [];
    let m;
    while ((m = regex.exec(t)) !== null) {
      tagged.push({ name: m[1], id: m[2] });
    }
    return tagged;
  }

  // Render note text with highlighted @mentions
  function renderNoteText(t) {
    const parts = [];
    const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;
    let m;
    while ((m = regex.exec(t)) !== null) {
      if (m.index > last) parts.push(t.slice(last, m.index));
      parts.push(
        <span key={m.index} style={{ color: '#1565C0', fontWeight: 600, background: '#EFF6FF', padding: '1px 4px', borderRadius: 3 }}>
          @{m[1]}
        </span>
      );
      last = m.index + m[0].length;
    }
    if (last < t.length) parts.push(t.slice(last));
    return parts;
  }

  // Display text replaces internal format with readable @Name
  function displayText(t) {
    return t.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1');
  }

  // Get the raw text for display in the textarea (with @Name instead of @[Name](id))
  function toEditableText(t) {
    return t.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1');
  }

  // Handle text input change and detect @mentions
  function handleInput(e) {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setText(val);
    setCursorPos(pos);

    // Check if we're in an @mention context
    const before = val.slice(0, pos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || before[atIdx - 1] === ' ' || before[atIdx - 1] === '\n')) {
      const query = before.slice(atIdx + 1);
      if (!query.includes(' ') || query.length <= 20) {
        setMentionFilter(query.toLowerCase());
        setShowMentions(true);
        setMentionIdx(0);
        return;
      }
    }
    setShowMentions(false);
  }

  function handleKeyDown(e) {
    if (!showMentions) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      return;
    }
    const filtered = staff.filter(s =>
      s.full_name.toLowerCase().includes(mentionFilter) ||
      (ROLE_LABELS[s.role] || '').toLowerCase().includes(mentionFilter)
    );
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (filtered[mentionIdx]) insertMention(filtered[mentionIdx]);
    } else if (e.key === 'Escape') {
      setShowMentions(false);
    }
  }

  function insertMention(person) {
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const atIdx = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@[${person.full_name}](${person.id}) ` + after;
    setText(newText);
    setShowMentions(false);
    setTimeout(() => {
      if (inputRef.current) {
        const newPos = atIdx + person.full_name.length + person.id.length + 6;
        inputRef.current.focus();
        inputRef.current.selectionStart = newPos;
        inputRef.current.selectionEnd = newPos;
      }
    }, 0);
  }

  async function handleSubmit() {
    if (!text.trim() || !profile) return;
    setSaving(true);

    const tagged = parseMentions(text);

    const { data: note, error } = await supabase
      .from('patient_notes')
      .insert([{
        patient_name: patientName,
        author_id: profile.id,
        author_name: profile.full_name,
        note_text: text.trim(),
        tagged_users: tagged,
      }])
      .select()
      .single();

    if (error) {
      console.error('Note save error:', error);
      setSaving(false);
      return;
    }

    // Create notifications for tagged users
    if (tagged.length > 0 && note) {
      const notifs = tagged.map(t => ({
        note_id: note.id,
        user_id: t.id,
        patient_name: patientName,
        read: false,
      }));
      await supabase.from('note_notifications').insert(notifs);

      // Fire email notifications (non-blocking)
      try {
        const taggedStaff = tagged.map(t => {
          const s = staff.find(st => st.id === t.id);
          return s ? { id: s.id, name: s.full_name, email: s.email } : null;
        }).filter(Boolean);

        if (taggedStaff.length > 0) {
          supabase.functions.invoke('notify-mention', {
            body: {
              note_id: note.id,
              patient_name: patientName,
              author_name: profile.full_name,
              note_text: displayText(text.trim()),
              tagged_users: taggedStaff,
            }
          }).catch(e => console.warn('Email notification failed (non-critical):', e));
        }
      } catch (e) {
        console.warn('Email notification setup failed (non-critical):', e);
      }
    }

    setText('');
    setSaving(false);
    loadNotes();
  }

  const filteredStaff = staff.filter(s =>
    s.full_name.toLowerCase().includes(mentionFilter) ||
    (ROLE_LABELS[s.role] || '').toLowerCase().includes(mentionFilter)
  ).slice(0, 8);

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
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: then.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function fullTimestamp(d) {
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>📋</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Patient Chart Notes</span>
          <span style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 500 }}>{notes.length} {notes.length === 1 ? 'entry' : 'entries'}</span>
        </div>
      </div>

      {/* Note input */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', position: 'relative' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: ROLE_COLORS[profile?.role] || '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {(profile?.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <textarea
              ref={inputRef}
              value={toEditableText(text)}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Add a chart note... Use @name to tag team members"
              rows={2}
              style={{
                width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 12, fontFamily: 'DM Sans, sans-serif', color: 'var(--black)', background: 'var(--bg)',
                resize: 'vertical', outline: 'none', lineHeight: 1.5,
              }}
              onFocus={e => e.target.style.borderColor = '#1565C0'}
              onBlur={e => { e.target.style.borderColor = 'var(--border)'; }}
            />

            {/* @mention autocomplete dropdown */}
            {showMentions && filteredStaff.length > 0 && (
              <div ref={mentionRef} style={{
                position: 'absolute', left: 0, bottom: '100%', marginBottom: 4, width: '100%', maxHeight: 200, overflowY: 'auto',
                background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100,
              }}>
                {filteredStaff.map((s, i) => (
                  <div key={s.id}
                    onClick={() => insertMention(s)}
                    onMouseEnter={() => setMentionIdx(i)}
                    style={{
                      padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      background: i === mentionIdx ? '#EFF6FF' : 'transparent',
                      borderBottom: i < filteredStaff.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: ROLE_COLORS[s.role] || '#6B7280',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                    }}>
                      {s.full_name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)' }}>{s.full_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--gray)' }}>{ROLE_LABELS[s.role] || s.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={saving || !text.trim()}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, cursor: saving || !text.trim() ? 'not-allowed' : 'pointer',
              background: text.trim() ? '#1565C0' : '#E5E7EB', color: text.trim() ? '#fff' : '#9CA3AF',
              opacity: saving ? 0.6 : 1, whiteSpace: 'nowrap', alignSelf: 'flex-end',
            }}>
            {saving ? 'Saving...' : 'Add Note'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 4, marginLeft: 38 }}>
          Press Enter to submit · Shift+Enter for new line · Type @ to tag team members
        </div>
      </div>

      {/* Notes feed */}
      <div style={{ maxHeight: maxHeight || '400px', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>Loading notes...</div>
        ) : notes.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📝</div>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>No chart notes yet. Add the first entry above.</div>
          </div>
        ) : (
          notes.map((n, i) => {
            const roleColor = ROLE_COLORS[staff.find(s => s.id === n.author_id)?.role] || '#6B7280';
            const authorRole = staff.find(s => s.id === n.author_id)?.role;
            return (
              <div key={n.id} style={{
                padding: '12px 16px', borderBottom: i < notes.length - 1 ? '1px solid var(--border)' : 'none',
                background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', background: roleColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0, marginTop: 1,
                  }}>
                    {(n.author_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{n.author_name}</span>
                      {authorRole && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: roleColor, background: roleColor + '15', padding: '1px 6px', borderRadius: 4 }}>
                          {ROLE_LABELS[authorRole] || authorRole}
                        </span>
                      )}
                      <span title={fullTimestamp(n.created_at)} style={{ fontSize: 10, color: 'var(--gray)', cursor: 'default' }}>{timeAgo(n.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--black)', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                      {renderNoteText(n.note_text)}
                    </div>
                    {n.tagged_users && n.tagged_users.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {n.tagged_users.map((t, ti) => (
                          <span key={ti} style={{ fontSize: 9, fontWeight: 600, color: '#1565C0', background: '#EFF6FF', padding: '2px 6px', borderRadius: 4 }}>
                            @{t.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
