import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth.jsx';

// ─── EdemaCare brand palette (login page only) ───────────────────────────
// The rest of the app still runs on the legacy AxiomHealth red palette via
// CSS variables. This page is the public-facing front door, so it wears the
// new EdemaCare colors and the heart-mark wordmark verbatim. Sidebar /
// internal pages stay on the old palette until a separate brand-roll
// initiative re-skins the whole app.
const BRAND = {
  teal:       '#2DD4D4',      // top of the heart gradient
  blue:       '#3B82F6',      // mid blend
  purple:     '#7C5BF7',      // bottom of the heart gradient
  navy:       '#0A1628',      // wordmark + headings
  navySoft:   '#1E293B',      // body text
  gray:       '#64748B',      // helper / footer text
  border:     '#E2E8F0',
  bgTop:      '#F8FAFC',      // page background gradient top
  bgBottom:   '#EEF2FF',      // page background gradient bottom — soft purple tint
  cardBg:     '#FFFFFF',
  inputBg:    '#F8FAFC',
  danger:     '#DC2626',
  dangerBg:   '#FEF2F2',
  dangerBorder: '#FECACA',
};

const BUTTON_GRADIENT = `linear-gradient(135deg, ${BRAND.teal} 0%, ${BRAND.blue} 50%, ${BRAND.purple} 100%)`;

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

  function BrandHeader() {
    return (
      <>
        <div style={S.brand}>
          <img src="/logo.png" alt="EdemaCare" style={S.logo} />
        </div>
        <div style={S.tagline}>Operations Platform</div>
        <div style={S.divider} />
      </>
    );
  }

  if (view === 'forgot') return (
    <div style={S.outer}>
      <div style={S.card}>
        <BrandHeader />
        {resetSent ? (
          <>
            <div style={S.iconWrap}>
              <div style={S.mailIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <h2 style={{ ...S.heading, marginBottom: 8, textAlign: 'center' }}>Check your email</h2>
              <p style={{ fontSize: 14, color: BRAND.gray, lineHeight: 1.6, textAlign: 'center' }}>
                We sent a password reset link to <strong style={{ color: BRAND.navy }}>{email}</strong>.<br />
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
            <p style={{ fontSize: 14, color: BRAND.gray, marginBottom: 24, marginTop: -12 }}>
              Enter your email and we&apos;ll send you a reset link.
            </p>
            {error && <div style={S.errorBox}>{error}</div>}
            <form onSubmit={handleForgotPassword} style={S.form}>
              <div style={S.field}>
                <label style={S.label}>Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required autoComplete="email" placeholder="you@edemacare.com"
                  style={S.input} />
              </div>
              <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
            <button onClick={() => { setView('login'); setError(''); }}
              style={{ ...S.linkBtn, marginTop: 16 }}>
              {'< Back to sign in'}
            </button>
          </>
        )}
        <p style={S.legal}>EdemaCare is a service of AxiomHealth Management LLC</p>
      </div>
    </div>
  );

  return (
    <div style={S.outer}>
      <div style={S.card}>
        <BrandHeader />
        <h2 style={S.heading}>Sign in to your account</h2>
        {error && <div style={S.errorBox}>{error}</div>}
        <form onSubmit={handleSignIn} style={S.form}>
          <div style={S.field}>
            <label style={S.label}>Email address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email" placeholder="you@edemacare.com"
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
              required autoComplete="current-password" placeholder="Enter your password"
              style={S.input} />
          </div>
          <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p style={S.footer}>Contact your administrator if you need access.</p>
        <p style={S.legal}>EdemaCare is a service of AxiomHealth Management LLC</p>
      </div>
    </div>
  );
}

const styles = {
  outer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `linear-gradient(135deg, ${BRAND.bgTop} 0%, ${BRAND.bgBottom} 100%)`,
    padding: '24px',
  },
  card: {
    background: BRAND.cardBg,
    border: `1px solid ${BRAND.border}`,
    borderRadius: '20px',
    padding: '40px 40px 32px',
    width: '100%',
    maxWidth: '440px',
    boxShadow: '0 10px 40px rgba(10, 22, 40, 0.08), 0 2px 8px rgba(124, 91, 247, 0.04)',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '4px',
  },
  logo: {
    height: '38px',
    width: 'auto',
    objectFit: 'contain',
    display: 'block',
  },
  tagline: {
    fontSize: '12px',
    color: BRAND.gray,
    textAlign: 'center',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: 600,
    marginBottom: '28px',
  },
  divider: {
    height: '1px',
    background: BRAND.border,
    marginBottom: '28px',
  },
  heading: {
    fontSize: '22px',
    fontWeight: 700,
    color: BRAND.navy,
    marginBottom: '24px',
    letterSpacing: '-0.01em',
  },
  errorBox: {
    background: BRAND.dangerBg,
    border: `1px solid ${BRAND.dangerBorder}`,
    borderRadius: '10px',
    padding: '12px 16px',
    color: BRAND.danger,
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '20px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '18px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: BRAND.navySoft,
  },
  input: {
    padding: '11px 14px',
    border: `1px solid ${BRAND.border}`,
    borderRadius: '10px',
    fontSize: '14px',
    color: BRAND.navy,
    background: BRAND.inputBg,
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  },
  button: {
    padding: '13px',
    background: BUTTON_GRADIENT,
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 600,
    marginTop: '6px',
    cursor: 'pointer',
    width: '100%',
    boxShadow: '0 4px 14px rgba(124, 91, 247, 0.25)',
    transition: 'transform 0.1s ease, box-shadow 0.15s ease',
    letterSpacing: '0.01em',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: BRAND.purple,
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'none',
  },
  footer: {
    marginTop: '24px',
    textAlign: 'center',
    fontSize: '13px',
    color: BRAND.gray,
  },
  legal: {
    marginTop: '10px',
    textAlign: 'center',
    fontSize: '11px',
    color: BRAND.gray,
    opacity: 0.7,
  },
  iconWrap: {
    textAlign: 'center',
    marginBottom: 24,
  },
  mailIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: BUTTON_GRADIENT,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    boxShadow: '0 4px 14px rgba(124, 91, 247, 0.25)',
  },
};
