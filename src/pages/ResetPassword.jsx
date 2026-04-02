import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash as access_token
    // When the page loads we need to exchange it for a session
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setValidSession(true);
      }
      setChecking(false);
    });

    // Also check immediately in case the event already fired
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setValidSession(true);
      setChecking(false);
    });
  }, []);

  async function handleReset(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    // Sign out so they log in fresh with their new password
    await supabase.auth.signOut();
    setDone(true);
    setLoading(false);
  }

  const S = styles;

  if (checking) return (
    <div style={S.outer}>
      <div style={S.card}>
        <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 14 }}>Verifying reset link…</div>
      </div>
    </div>
  );

  if (done) return (
    <div style={S.outer}>
      <div style={S.card}>
        <div style={S.brand}>
          <div style={S.logoMark}>A</div>
          <div>
            <div style={S.logoTitle}>AxiomHealth</div>
            <div style={S.logoSub}>Operations Platform</div>
          </div>
        </div>
        <div style={S.divider} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
          <h2 style={{ ...S.heading, marginBottom: 8 }}>Password updated</h2>
          <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 28, lineHeight: 1.6 }}>
            Your password has been changed successfully. You can now sign in with your new password.
          </p>
          <a href="/login" style={{ ...S.button, display: 'block', textDecoration: 'none', textAlign: 'center' }}>
            Go to sign in
          </a>
        </div>
      </div>
    </div>
  );

  if (!validSession) return (
    <div style={S.outer}>
      <div style={S.card}>
        <div style={S.brand}>
          <div style={S.logoMark}>A</div>
          <div>
            <div style={S.logoTitle}>AxiomHealth</div>
            <div style={S.logoSub}>Operations Platform</div>
          </div>
        </div>
        <div style={S.divider} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ ...S.heading, marginBottom: 8 }}>Invalid or expired link</h2>
          <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 28, lineHeight: 1.6 }}>
            This password reset link has expired or has already been used.<br />
            Request a new one from the login page.
          </p>
          <a href="/login" style={{ ...S.button, display: 'block', textDecoration: 'none', textAlign: 'center' }}>
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.outer}>
      <div style={S.card}>
        <div style={S.brand}>
          <div style={S.logoMark}>A</div>
          <div>
            <div style={S.logoTitle}>AxiomHealth</div>
            <div style={S.logoSub}>Operations Platform</div>
          </div>
        </div>
        <div style={S.divider} />
        <h2 style={S.heading}>Set your new password</h2>
        <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 24, marginTop: -12 }}>
          Choose a strong password for your account.
        </p>
        {error && <div style={S.errorBox}>{error}</div>}
        <form onSubmit={handleReset} style={S.form}>
          <div style={S.field}>
            <label style={S.label}>New password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              required minLength={8} placeholder="Min. 8 characters" style={S.input}
              autoComplete="new-password" />
          </div>
          <div style={S.field}>
            <label style={S.label}>Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              required placeholder="Re-enter your password" style={S.input}
              autoComplete="new-password" />
          </div>
          {/* Password strength indicator */}
          {password.length > 0 && (
            <div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                {[1,2,3,4].map(i => (
                  <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, background:
                    password.length >= i * 3 ? (password.length >= 12 ? '#10B981' : password.length >= 8 ? '#D97706' : '#DC2626') : 'var(--border)'
                  }} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray)' }}>
                {password.length < 8 ? 'Too short' : password.length < 12 ? 'Fair — consider making it longer' : 'Strong password'}
              </div>
            </div>
          )}
          <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  outer: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '48px 40px', width: '100%', maxWidth: '420px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  brand: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' },
  logoMark: { width: '48px', height: '48px', borderRadius: '12px', background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: '700', flexShrink: 0 },
  logoTitle: { fontSize: '18px', fontWeight: '700', color: 'var(--black)' },
  logoSub: { fontSize: '12px', color: 'var(--gray)', marginTop: '2px' },
  divider: { height: '1px', background: 'var(--border)', marginBottom: '28px' },
  heading: { fontSize: '20px', fontWeight: '600', color: 'var(--black)', marginBottom: '24px' },
  errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '12px 16px', color: '#DC2626', fontSize: '14px', marginBottom: '20px' },
  form: { display: 'flex', flexDirection: 'column', gap: '20px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: '500', color: 'var(--black)' },
  input: { padding: '10px 14px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', color: 'var(--black)', background: 'var(--bg)', outline: 'none' },
  button: { padding: '12px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', width: '100%' },
};
