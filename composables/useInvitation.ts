import type { Invitation } from '@/types'
import { collection, query, where } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { invitationConverter } from '@/utils/converter'

interface CreateInvitationParams {
  tripId: string
  expiresInDays?: number
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

  async function acceptInvitation(invitationCode: string): Promise<AcceptInvitationResponse> {
    try {
      const response = await $fetch<AcceptInvitationResponse>('/api/invitations/accept', {
        method: 'POST',
        body: { invitationCode },
      })
      return response
    }
    catch (error: any) {
      console.error('Error accepting invitation:', error)
      throw new Error(error.data?.message || error.message || 'Failed to accept invitation')
    }
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

  function getInvitationByCode(invitationCode: string) {
    const db = useFirestore()
    const invitationsQuery = query(
      collection(db, 'invitations'),
      where('invitationCode', '==', invitationCode),
    ).withConverter(invitationConverter)

    const invitations = useCollection<Invitation>(invitationsQuery, {
      ssrKey: `invitation-${invitationCode}`,
    })

    const invitation = computed(() => invitations.value[0] || null)

    return {
      invitation,
      isLoading: computed(() => !invitations.value),
    }
  }

  return {
    createInvitation,
    acceptInvitation,
    revokeInvitation,
    listInvitations,
    getInvitationByCode,
  }
}
