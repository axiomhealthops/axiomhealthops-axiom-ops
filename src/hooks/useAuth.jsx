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

      // 2026-05-29: pages can now be granted via either the user's PRIMARY
      // role OR any SECONDARY role they hold (coordinators.secondary_roles).
      // This was added so the Director of Ops can stand up a `marketing_rep`
      // role without stripping the existing operations role (regional_manager
      // / assoc_director) from the 7 RMPs. A page is allowed if ANY role on
      // the user — primary or secondary — passes the page_permissions check.
      const primaryRole = prof.role;
      const secondary = Array.isArray(prof.secondary_roles) ? prof.secondary_roles : [];
      const allRoles = [primaryRole, ...secondary].filter(Boolean);

      function pageAllowsRole(p, role) {
        if (role === 'super_admin') return p.super_admin;
        if (role === 'director')    return p.super_admin; // mapped to super_admin perms
        if (role === 'ceo')         return p.super_admin; // legacy
        if (role === 'admin')       return p.admin;
        if (role === 'auth_coordinator')   return p.auth_coordinator;
        if (role === 'intake_coordinator') return p.intake_coordinator;
        if (role === 'care_coordinator')   return p.care_coordinator;
        if (role === 'clinician')          return p.clinician;
        if (role === 'regional_manager')   return p.regional_manager;
        if (role === 'assoc_director')     return p.assoc_director;
        if (role === 'telehealth')         return p.telehealth;
        if (role === 'pod_leader')         return p.pod_leader;
        if (role === 'team_member')        return p.team_member;
        // 2026-05-29: marketing_rep — granted only on pages where the
        // page_permissions row has marketing_rep=true (currently just
        // marketing-crm).
        if (role === 'marketing_rep')      return p.marketing_rep;
        // 2026-05-30: HAE — marketing-primary role. Granted only on pages
        // where page_permissions.healthcare_account_executive=true.
        if (role === 'healthcare_account_executive') return p.healthcare_account_executive;
        // 2026-06-05: Director of Payer Relations and Marketing (Yvonne).
        // Narrower than admin — only the pages where director_payer_marketing
        // is explicitly true. See docs/Yvonne_Payer_Marketing_Report_Design.md.
        if (role === 'director_payer_marketing')      return p.director_payer_marketing;
        return false;
      }

      const allowed = (pages || [])
        .filter(p => {
          if (overrideMap[p.page_key] === true) return true;
          if (overrideMap[p.page_key] === false) return false;
          return allRoles.some(r => pageAllowsRole(p, r));
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
