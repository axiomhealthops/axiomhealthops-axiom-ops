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

    // 2026-05-19 BUG FIX: previously reloaded profile on EVERY auth event
    // including TOKEN_REFRESHED (fires ~hourly). The async profile reload
    // briefly nulled state during peak hours, which under heavy realtime
    // load caused ProtectedRoute to flip and Dashboard to remount, sending
    // users back to their role's defaultPage (Intake Dashboard for intake
    // coords, etc.). Token refresh doesn't change the user — skip the
    // reload for those events. Only reload on actual sign-in/sign-out.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      const userChanged = newSession?.user?.id !== user?.id;
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (event === 'SIGNED_OUT' || !newSession?.user) {
        setProfile(null);
        setPermissions([]);
        setLoading(false);
        return;
      }

      // SIGNED_IN, INITIAL_SESSION, USER_UPDATED → reload profile only if the
      // user actually changed. TOKEN_REFRESHED keeps the same user and never
      // needs a profile reload.
      if (event === 'TOKEN_REFRESHED') return;
      if (userChanged || !profile) loadProfile(newSession.user.id);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile(userId) {
    try {
      const { data: prof, error } = await supabase
        .from('coordinators')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();           // maybeSingle() returns null instead of throwing if no row

      // 2026-05-19: only nuke profile state on confirmed-empty result.
      // A network error means we should KEEP the existing profile rather
      // than briefly blank it out (which causes Dashboard remount).
      if (error) {
        console.warn('loadProfile network error — keeping existing profile:', error.message);
      } else {
        setProfile(prof || null);
        if (prof) await loadPermissions(prof);
      }
    } catch (err) {
      console.error('loadProfile error — keeping existing profile:', err);
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
          // 2026-05-18: 'director' role added — Director of Operations gets full
          // visibility (mapped to super_admin perms). Was previously falling through
          // to return false because no handler existed.
          if (role === 'super_admin') return p.super_admin;
          if (role === 'director')    return p.super_admin;
          if (role === 'ceo')        return p.super_admin;  // legacy
          if (role === 'admin')      return p.admin;
          if (role === 'auth_coordinator')   return p.auth_coordinator;
          if (role === 'intake_coordinator') return p.intake_coordinator;
          if (role === 'care_coordinator')   return p.care_coordinator;
          if (role === 'clinician')          return p.clinician;
          if (role === 'regional_manager') return p.regional_manager; // RM has own restricted column
          if (role === 'assoc_director') return p.assoc_director;
          if (role === 'telehealth')      return p.telehealth;
          if (role === 'pod_leader')  return p.pod_leader;   // legacy
          if (role === 'team_member') return p.team_member;  // legacy
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
    if (['super_admin','ceo','admin','assoc_director'].includes(profile.role)) return true;
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
