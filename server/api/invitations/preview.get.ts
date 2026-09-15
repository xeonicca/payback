import type { InvitationPreview } from '~/types'
import { getInvitationState } from '~/server/utils/invitations'
import { getFirebaseAdminFirestore } from '~/server/utils/session'

// Public: invite/guest pages call this before the visitor signs in.
// Returns only what those pages display — never the tripId or who used the link.
export default defineEventHandler(async (event): Promise<InvitationPreview> => {
  const { code } = getQuery(event)
  if (!code || typeof code !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'code is required' })
  }

  const snapshot = await getFirebaseAdminFirestore()
    .collection('invitations')
    .where('invitationCode', '==', code)
    .limit(1)
    .get()

  if (snapshot.empty) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }

  const invitation = snapshot.docs[0].data()
  return {
    state: getInvitationState(invitation),
    type: invitation.type === 'guest' ? 'guest' : 'personal',
    viewOnly: invitation.viewOnly === true,
    tripName: invitation.tripName || '',
    invitedByName: invitation.invitedByName || '',
    expiresAt: invitation.expiresAt.toDate().toISOString(),
  }
})
