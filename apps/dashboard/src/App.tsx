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
        path="/sites"
        element={
          <RequireAuth>
            <SitesPage />
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
        path="/ai"
        element={
          <RequireAuth>
            <AiSettingsPage />
          </RequireAuth>
        }
      />
      {/* Rotas de ferramentas (Redirecionam para o primeiro site por enquanto ou página de sites se não houver ID) */}
      <Route path="/connection" element={<Navigate to="/sites" replace />} />
      <Route path="/meta" element={<Navigate to="/sites" replace />} />
      <Route path="/settings" element={<Navigate to="/sites" replace />} />
      <Route path="/diagnostics" element={<Navigate to="/sites" replace />} />
      
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
