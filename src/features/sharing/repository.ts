import type { SupabaseClient } from '@supabase/supabase-js';
import type { Household } from '@/features/households/types';
import type { CreatedInvitation, Invitation, Member, SharingRepository } from './types';

export function createSupabaseSharingRepository(client: SupabaseClient): SharingRepository {
  return {
    async listMembers(householdId) {
      const { data, error } = await client.rpc('list_household_members', { p_household_id: householdId });
      if (error) throw error;
      return data as Member[];
    },
    async listInvitations(householdId) {
      const { data, error } = await client
        .from('household_invitations')
        .select('id, household_id, role, created_at, expires_at, accepted_at, revoked_at')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Invitation[];
    },
    async createInvitation(householdId, role) {
      const { data, error } = await client.rpc('create_household_invitation', { p_household_id: householdId, p_role: role });
      if (error) throw error;
      const rows = data as CreatedInvitation[];
      if (!rows[0]) throw new Error('Convite não retornado');
      return rows[0];
    },
    async revokeInvitation(invitationId) {
      const { error } = await client.rpc('revoke_household_invitation', { p_invitation_id: invitationId });
      if (error) throw error;
    },
    async acceptInvitation(code) {
      const { data, error } = await client.rpc('accept_household_invitation', { p_code: code });
      if (error) throw error;
      return data as Household;
    },
    async removeMember(householdId, userId) {
      const { error } = await client.rpc('remove_household_member', { p_household_id: householdId, p_user_id: userId });
      if (error) throw error;
    },
    async updateMyProfile(displayName) {
      const { error } = await client.rpc('update_my_profile', { p_display_name: displayName });
      if (error) throw error;
    },
  };
}
