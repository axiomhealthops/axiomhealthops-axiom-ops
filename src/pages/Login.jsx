import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('login'); // 'login' | 'forgot'
  const [resetSent, setResetSent] = useState(false);

  async function handleSignIn(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    const { error: err } = await signIn(email.trim(), password);
    if (err) setError('Invalid email or password. Please try again.');
    setLoading(false);
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'https://axiomhealthops-axiom-ops.vercel.app/reset-password',
    });
    if (err) { setError(err.message); setLoading(false); return; }
    setResetSent(true);
    setLoading(false);
  }

  const S = styles;

  if (view === 'forgot') return (
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
        {resetSent ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
              <h2 style={{ ...S.heading, marginBottom: 8 }}>Check your email</h2>
              <p style={{ fontSize: 14, color: 'var(--gray)', lineHeight: 1.6 }}>
                We sent a password reset link to <strong>{email}</strong>.<br />
                Click the link in the email to set your new password.
              </p>
            </div>
            <button onClick={() => { setView('login'); setResetSent(false); }} style={S.button}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <h2 style={S.heading}>Reset your password</h2>
            <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 24, marginTop: -12 }}>
              Enter your email and we'll send you a reset link.
            </p>
            {error && <div style={S.errorBox}>{error}</div>}
            <form onSubmit={handleForgotPassword} style={S.form}>
              <div style={S.field}>
                <label style={S.label}>Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required autoComplete="email" placeholder="you@axiomhealthmanagement.com"
                  style={S.input} />
              </div>
              <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
            <button onClick={() => { setView('login'); setError(''); }}
              style={{ ...S.linkBtn, marginTop: 16 }}>
              ← Back to sign in
            </button>
          </>
        )}
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
        <h2 style={S.heading}>Sign in to your account</h2>
        {error && <div style={S.errorBox}>{error}</div>}
        <form onSubmit={handleSignIn} style={S.form}>
          <div style={S.field}>
            <label style={S.label}>Email address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email" placeholder="you@axiomhealthmanagement.com"
              style={S.input} />
          </div>
          <div style={S.field}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={S.label}>Password</label>
              <button type="button" onClick={() => { setView('forgot'); setError(''); }}
                style={S.linkBtn}>
                Forgot password?
              </button>
            </div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              required autoComplete="current-password" placeholder="••••••••"
              style={S.input} />
          </div>
          <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p style={S.footer}>Contact your administrator if you need access.</p>
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
  errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', fontSize: '14px', marginBottom: '20px' },
  form: { display: 'flex', flexDirection: 'column', gap: '20px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: '500', color: 'var(--black)' },
  input: { padding: '10px 14px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', color: 'var(--black)', background: 'var(--bg)', outline: 'none' },
  button: { padding: '12px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', marginTop: '4px', cursor: 'pointer', width: '100%' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--red)', fontSize: '13px', fontWeight: '500', cursor: 'pointer', padding: 0, textDecoration: 'none' },
  footer: { marginTop: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--gray)' },
};
