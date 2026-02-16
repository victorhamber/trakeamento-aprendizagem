import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './state/auth';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { DashboardPage } from './pages/Dashboard';
import { AiSettingsPage } from './pages/AiSettings';
import { SitesPage } from './pages/Sites';
import { SitePage } from './pages/Site';

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const auth = useAuth();
  if (!auth.token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const SiteRedirect = ({ tab }: { tab: string }) => {
  const raw = typeof window !== 'undefined' ? window.localStorage.getItem('lastSiteId') : null;
  const id = raw ? Number(raw) : NaN;
  if (Number.isFinite(id) && id > 0) {
    return <Navigate to={`/sites/${id}?tab=${tab}`} replace />;
  }
  return <Navigate to="/sites" state={{ intentTab: tab }} replace />;
};

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/campaigns"
        element={
          <RequireAuth>
            <SiteRedirect tab="campaigns" />
          </RequireAuth>
        }
      />
      <Route
        path="/sites/:siteId"
        element={
          <RequireAuth>
            <SitePage />
          </RequireAuth>
        }
      />
      <Route
        path="/sites"
        element={
          <RequireAuth>
            <SitesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/recommendations"
        element={
          <RequireAuth>
            <SiteRedirect tab="reports" />
          </RequireAuth>
        }
      />
      <Route
        path="/ai"
        element={
          <RequireAuth>
            <AiSettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tracking"
        element={
          <RequireAuth>
            <SiteRedirect tab="snippet" />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
