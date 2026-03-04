import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './state/auth';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { AccountsPage } from './pages/Accounts';
import { PlansPage } from './pages/Plans';
import { NotificationsPage } from './pages/Notifications';

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
        path="/accounts"
        element={
          <RequireAuth>
            <AccountsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/plans"
        element={
          <RequireAuth>
            <PlansPage />
          </RequireAuth>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <NotificationsPage />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to="/accounts" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
