import type { HouseholdRole } from '@/features/households/types';
import type { Household } from '@/features/households/types';

/** Contratos de membros, convites e perfil (migração 20261026000100_invitations.sql). */
export interface Member {
  user_id: string;
  role: HouseholdRole;
  display_name: string | null;
  joined_at: string;
}

export interface Invitation {
  id: string;
  household_id: string;
  role: HouseholdRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface CreatedInvitation {
  invitation_id: string;
  /** Mostrado uma única vez; o banco guarda apenas o hash. */
  code: string;
  expires_at: string;
}

export interface SharingRepository {
  listMembers(householdId: string): Promise<Member[]>;
  listInvitations(householdId: string): Promise<Invitation[]>;
  createInvitation(householdId: string, role: Exclude<HouseholdRole, 'owner'>): Promise<CreatedInvitation>;
  revokeInvitation(invitationId: string): Promise<void>;
  acceptInvitation(code: string): Promise<Household>;
  removeMember(householdId: string, userId: string): Promise<void>;
  updateMyProfile(displayName: string): Promise<void>;
}

export const ROLE_LABEL: Record<HouseholdRole, string> = {
  owner: 'Responsável (owner)',
  admin: 'Administra',
  member: 'Participa',
  viewer: 'Só consulta',
};
