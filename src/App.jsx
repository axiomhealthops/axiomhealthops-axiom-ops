import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { DIRECTOR_ROLES, MISSION_ROLES, COORDINATOR_ROLES } from './lib/constants';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';

function MissionControlPlaceholder() {
  const { profile, signOut } = useAuth();
  return (
    <div style={{ padding: 40, fontFamily: 'DM Sans, sans-serif' }}>
      <h2>Mission Control</h2>
      <p>Welcome, {profile?.full_name || 'Team Member'}.</p>
      <button onClick={signOut} style={{ marginTop: 16, padding: '8px 16px' }}>Sign out</button>
    </div>
  );
}

function CoordinatorPlaceholder() {
  const { profile, signOut } = useAuth();
  return (
    <div style={{ padding: 40, fontFamily: 'DM Sans, sans-serif' }}>
      <h2>Coordinator App</h2>
      <p>Welcome, {profile?.full_name || 'Coordinator'}.</p>
      <button onClick={signOut} style={{ marginTop: 16, padding: '8px 16px' }}>Sign out</button>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif', color: '#8B6B64' }}>
      Loading...
    </div>
  );
}

function RoleRouter() {
  const { user, profile, loading } = useAuth();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  const role = profile?.role;
  if (DIRECTOR_ROLES.includes(role)) return <Navigate to="/dashboard" replace />;
  if (MISSION_ROLES.includes(role)) return <Navigate to="/mission" replace />;
  if (COORDINATOR_ROLES.includes(role)) return <Navigate to="/coordinator" replace />;
  return (
    <div style={{ padding: 40, color: '#DC2626', fontFamily: 'DM Sans, sans-serif' }}>
      <strong>Access Error:</strong> Your account has no assigned role. Contact Liam.
    </div>
  );
}

function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(profile?.role)) return <Navigate to="/" replace />;
  return children;
}

function LoginGuard() {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (user && profile) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<RoleRouter />} />
          <Route path="/dashboard/*" element={
            <ProtectedRoute allowedRoles={DIRECTOR_ROLES}>
              <Dashboard />
            </ProtectedRoute>
          } />
          <Route path="/mission/*" element={
            <ProtectedRoute allowedRoles={MISSION_ROLES}>
              <MissionControlPlaceholder />
            </ProtectedRoute>
          } />
          <Route path="/coordinator/*" element={
            <ProtectedRoute allowedRoles={COORDINATOR_ROLES}>
              <CoordinatorPlaceholder />
            </ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
