import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);       // kept for App.jsx compatibility
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else { setProfile(null); setPermissions([]); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    try {
      const { data: prof, error } = await supabase
        .from('coordinators')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();           // maybeSingle() returns null instead of throwing if no row

      setProfile(prof || null);
      if (prof) await loadPermissions(prof);
    } catch (err) {
      console.error('loadProfile error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadPermissions(prof) {
    try {
      const { data: pages } = await supabase
        .from('page_permissions')
        .select('*')
        .order('sort_order');

      const { data: overrides } = await supabase
        .from('user_page_overrides')
        .select('*')
        .eq('coordinator_id', prof.id);

      const overrideMap = {};
      (overrides || []).forEach(o => { overrideMap[o.page_key] = o.granted; });

      const role = prof.role;
      const allowed = (pages || [])
        .filter(p => {
          if (overrideMap[p.page_key] === true) return true;
          if (overrideMap[p.page_key] === false) return false;
          if (role === 'super_admin') return p.super_admin;
          if (role === 'ceo') return p.super_admin;
          if (role === 'admin') return p.admin;
          if (role === 'regional_manager') return p.regional_manager; // RM has own restricted column
          if (role === 'pod_leader') return p.pod_leader;
          if (role === 'team_member') return p.team_member;
          return false;
        })
        .map(p => p.page_key);

      setPermissions(allowed);
    } catch (err) {
      console.error('loadPermissions error:', err);
      setPermissions([]);
    }
  }

  function canAccess(pageKey) {
    if (!profile) return false;
    if (profile.role === 'super_admin' || profile.role === 'ceo') return true;
    return permissions.includes(pageKey);
  }

  async function signIn(email, password) {
    return await supabase.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshPermissions() {
    if (profile) await loadPermissions(profile);
  }

  return (
    <AuthContext.Provider value={{
      session, user, profile, permissions, loading,
      canAccess, signIn, signOut, refreshPermissions,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
