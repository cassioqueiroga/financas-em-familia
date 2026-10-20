import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreateHouseholdInput, Household, HouseholdRepository } from './types';

export function createSupabaseHouseholdRepository(client: SupabaseClient): HouseholdRepository {
  return {
    async list() {
      const { data, error } = await client
        .from('households')
        .select('id, name, kind, base_currency, timezone, created_by, created_at, updated_at, version')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Household[];
    },
    async create(input: CreateHouseholdInput) {
      const { data, error } = await client.rpc('create_household', {
        p_name: input.name,
        p_kind: input.kind,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
      return data as Household;
    },
  };
}
