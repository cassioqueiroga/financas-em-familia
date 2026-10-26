import { Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import type { AppEnvironment } from '@/config/env';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { AccountsPage } from '@/features/finance/AccountsPage';
import { CardsPage } from '@/features/finance/CardsPage';
import { CategoriesPage } from '@/features/finance/CategoriesPage';
import { DashboardPage } from '@/features/finance/DashboardPage';
import { EntriesPage } from '@/features/finance/EntriesPage';
import { FinanceProvider } from '@/features/finance/FinanceContext';
import { HouseholdsPage } from '@/features/households/HouseholdsPage';
import { ImportPage } from '@/features/import/ImportPage';
import { InsightsPage } from '@/features/insights/InsightsPage';
import { FamilyPage } from '@/features/sharing/FamilyPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const protect = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>;

export function App({ environment }: { environment: AppEnvironment }) {
  return (
    <FinanceProvider>
      <AppShell environment={environment}>
        <Routes>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/" element={protect(<DashboardPage />)} />
          <Route path="/analises" element={protect(<InsightsPage />)} />
          <Route path="/lancamentos" element={protect(<EntriesPage />)} />
          <Route path="/contas" element={protect(<AccountsPage />)} />
          <Route path="/cartoes" element={protect(<CardsPage />)} />
          <Route path="/importar" element={protect(<ImportPage />)} />
          <Route path="/categorias" element={protect(<CategoriesPage />)} />
          <Route path="/familia" element={protect(<FamilyPage />)} />
          <Route path="/espacos" element={protect(<HouseholdsPage />)} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </FinanceProvider>
  );
}
