import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: signInError } = await signIn(email.trim(), password);
    if (signInError) setError('Invalid email or password. Please try again.');
    setLoading(false);
  }

  return (
    <div style={styles.outer}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <div style={styles.logoMark}>A</div>
          <div>
            <div style={styles.logoTitle}>AxiomHealth</div>
            <div style={styles.logoSub}>Operations Platform</div>
          </div>
        </div>
        <div style={styles.divider} />
        <h2 style={styles.heading}>Sign in to your account</h2>
        {error && <div style={styles.errorBox}>{error}</div>}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@axiomhealthmanagement.com" style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••" style={styles.input} />
          </div>
          <button type="submit" disabled={loading} style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p style={styles.footer}>Contact your administrator if you need access.</p>
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
  button: { padding: '12px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', marginTop: '4px', cursor: 'pointer' },
  footer: { marginTop: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--gray)' },
};
