import type { SupabaseClient } from '@supabase/supabase-js';

export interface SessionUser {
  id: string;
  email: string | null;
}

export type AuthListener = (user: SessionUser | null) => void;

/** Contrato de autenticação usado pela interface (permite testes sem rede). */
export interface AuthService {
  getCurrentUser(): Promise<SessionUser | null>;
  onChange(listener: AuthListener): () => void;
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

export function createSupabaseAuthService(client: SupabaseClient): AuthService {
  const toUser = (u: { id: string; email?: string | null } | null | undefined): SessionUser | null =>
    u ? { id: u.id, email: u.email ?? null } : null;

  return {
    async getCurrentUser() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return toUser(data.session?.user);
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async signInWithPassword(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
  };
}
