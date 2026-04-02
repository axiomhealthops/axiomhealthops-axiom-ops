import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setPermissions([]); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data: prof } = await supabase
      .from('coordinators')
      .select('*')
      .eq('user_id', userId)
      .single();
    setProfile(prof);
    if (prof) await loadPermissions(prof);
    setLoading(false);
  }

  async function loadPermissions(prof) {
    // Load base page permissions for this role
    const { data: pages } = await supabase.from('page_permissions').select('*').order('sort_order');
    // Load user-level overrides
    const { data: overrides } = await supabase
      .from('user_page_overrides')
      .select('*')
      .eq('coordinator_id', prof.id);
    const overrideMap = {};
    (overrides || []).forEach(o => { overrideMap[o.page_key] = o.granted; });

    const role = prof.role;
    const allowed = (pages || [])
      .filter(p => {
        // Check if there's a user-level override first
        if (overrideMap[p.page_key] === true) return true;
        if (overrideMap[p.page_key] === false) return false;
        // Fall back to role-based default
        if (role === 'super_admin') return p.super_admin;
        if (role === 'admin') return p.admin;
        if (role === 'pod_leader') return p.pod_leader;
        if (role === 'team_member') return p.team_member;
        return false;
      })
      .map(p => p.page_key);
    setPermissions(allowed);
  }

  function canAccess(pageKey) {
    if (!profile) return false;
    if (profile.role === 'super_admin') return true;
    return permissions.includes(pageKey);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshPermissions() {
    if (profile) await loadPermissions(profile);
  }

  return (
    <AuthContext.Provider value={{ session, profile, permissions, loading, canAccess, signOut, refreshPermissions }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
