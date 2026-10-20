import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import type { AppEnvironment } from '@/config/env';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { HouseholdsPage } from '@/features/households/HouseholdsPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export function App({ environment }: { environment: AppEnvironment }) {
  return (
    <AppShell environment={environment}>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/espacos"
          element={
            <RequireAuth>
              <HouseholdsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}
