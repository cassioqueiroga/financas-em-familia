/** Contrato espelhando public.households (supabase/migrations/*_households.sql). */
export type HouseholdKind = 'personal' | 'family';
export type HouseholdRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Household {
  id: string;
  name: string;
  kind: HouseholdKind;
  base_currency: string;
  timezone: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CreateHouseholdInput {
  name: string;
  kind: HouseholdKind;
  /** Gerada uma vez por intenção do usuário e reutilizada em novas tentativas. */
  idempotencyKey: string;
}

export interface HouseholdRepository {
  list(): Promise<Household[]>;
  create(input: CreateHouseholdInput): Promise<Household>;
}
