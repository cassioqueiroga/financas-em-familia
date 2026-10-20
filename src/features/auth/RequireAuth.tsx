import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { LoadingState } from '@/components/ui/StatusViews';
import { useAuth } from './auth-context';

/**
 * Proteção de navegação (experiência do usuário). NÃO é a camada de
 * autorização: os dados só são liberados pelo banco (RLS).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <LoadingState label="Verificando sua sessão…" />;
  if (state.status === 'unauthenticated') {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
