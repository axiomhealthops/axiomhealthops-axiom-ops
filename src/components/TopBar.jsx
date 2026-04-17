import React from 'react';
import AlertsBell from './AlertsBell';
import MentionsBell from './MentionsBell';
 
export default function TopBar(props) {
  var title = props.title || '';
  var subtitle = props.subtitle || '';
  var actions = props.actions || null;
 
  var today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
 
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 28px 16px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--card-bg)',
      flexShrink: 0,
    }}>
      <div>
        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--black)',
          letterSpacing: '-0.3px',
          margin: 0,
          lineHeight: 1.2,
        }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{
            fontSize: 13,
            color: 'var(--gray)',
            marginTop: 4,
            fontWeight: 400,
          }}>
            {subtitle}
          </div>
        )}
      </div>
 
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {actions}
          </div>
        )}
        <MentionsBell />
        <AlertsBell />
        <div style={{
          fontSize: 12,
          color: 'var(--gray)',
          fontFamily: 'DM Mono, monospace',
          letterSpacing: '0.02em',
        }}>
          {today}
        </div>
      </div>
    </div>
  );
}
 
