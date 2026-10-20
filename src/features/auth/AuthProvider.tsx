import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthService, SessionUser } from '@/services/auth';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';

function toState(user: SessionUser | null): AuthState {
  return user ? { status: 'authenticated', user } : { status: 'unauthenticated' };
}

export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    service
      .getCurrentUser()
      .then((user) => active && setState(toState(user)))
      .catch(() => active && setState({ status: 'unauthenticated' }));
    const unsubscribe = service.onChange((user) => active && setState(toState(user)));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [service]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signIn: (email, password) => service.signInWithPassword(email, password),
      signOut: () => service.signOut(),
    }),
    [service, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
