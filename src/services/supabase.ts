import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '@/config/env';

/**
 * Cliente Supabase do navegador. Usa somente a chave publicável (anon);
 * toda autorização efetiva acontece no banco via RLS e funções RPC.
 */
export function createSupabaseClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
