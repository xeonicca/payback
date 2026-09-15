import type { Invitation, InvitationPreview } from '@/types'

interface CreateInvitationParams {
  tripId: string
  expiresInDays?: number
  maxUses?: number | null
  type?: 'personal' | 'guest'
  viewOnly?: boolean
}

interface CreateInvitationResponse {
  invitationId: string
  invitationCode: string
  invitationUrl: string
  expiresAt: string
}

interface AcceptInvitationResponse {
  success: boolean
  tripId: string
}

interface InvitationMember {
  id: string
  name: string
  avatarEmoji: string
  isHost: boolean
  linkedUserId: string | null
}

interface InvitationMembersResponse {
  tripId: string
  members: InvitationMember[]
}

export function useInvitation() {
  async function createInvitation(params: CreateInvitationParams): Promise<CreateInvitationResponse> {
    try {
      const response = await $fetch<CreateInvitationResponse>('/api/invitations/create', {
        method: 'POST',
        body: params,
      })
      return response
    }
    catch (error: any) {
      console.error('Error creating invitation:', error)
      throw new Error(error.data?.message || 'Failed to create invitation')
    }
  }

  async function acceptInvitation(
    invitationCode: string,
    memberChoice: { memberId: string } | { newMember: { name: string, avatarEmoji: string } },
  ): Promise<AcceptInvitationResponse> {
    try {
      const response = await $fetch<AcceptInvitationResponse>('/api/invitations/accept', {
        method: 'POST',
        body: { invitationCode, ...memberChoice },
      })
      return response
    }
    catch (error: any) {
      console.error('Error accepting invitation:', error)
      throw new Error(error.data?.message || error.message || 'Failed to accept invitation')
    }
  }

  async function getInvitationMembers(invitationCode: string): Promise<InvitationMembersResponse> {
    try {
      const response = await $fetch<InvitationMembersResponse>('/api/invitations/members', {
        query: { invitationCode },
      })
      return response
    }
    catch (error: any) {
      console.error('Error fetching invitation members:', error)
      throw new Error(error.data?.message || error.message || 'Failed to fetch trip members')
    }
  }

  // Public lookup used by the invite/guest pages before sign-in
  function getInvitationPreview(invitationCode: string): Promise<InvitationPreview> {
    return $fetch<InvitationPreview>('/api/invitations/preview', {
      query: { code: invitationCode },
    })
  }

  async function revokeInvitation(invitationId: string): Promise<{ success: boolean }> {
    try {
      const response = await $fetch<{ success: boolean }>('/api/invitations/revoke', {
        method: 'POST',
        body: { invitationId },
      })
      return response
    }
    catch (error: any) {
      console.error('Error revoking invitation:', error)
      throw new Error(error.data?.message || 'Failed to revoke invitation')
    }
  }

  async function listInvitations(tripId: string): Promise<Invitation[]> {
    try {
      const response = await $fetch<any[]>('/api/invitations/list', {
        query: { tripId },
      })
      return response as Invitation[]
    }
    catch (error: any) {
      console.error('Error listing invitations:', error)
      throw new Error(error.data?.message || 'Failed to list invitations')
    }
  }

  return {
    createInvitation,
    acceptInvitation,
    revokeInvitation,
    listInvitations,
    getInvitationMembers,
    getInvitationPreview,
  }
}
