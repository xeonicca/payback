import { getInvitationState } from '~/server/utils/invitations'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const query = getQuery(event)
  const invitationCode = query.invitationCode as string

  if (!invitationCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invitationCode is required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // Find invitation by code
    const invitationsSnapshot = await db
      .collection('invitations')
      .where('invitationCode', '==', invitationCode)
      .limit(1)
      .get()

    if (invitationsSnapshot.empty) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Invitation not found',
      })
    }

    const invitation = invitationsSnapshot.docs[0].data()

    // Same validity rules as accept: unlimited links stay open after their first use
    const state = getInvitationState(invitation)
    if (state !== 'valid') {
      throw createError({
        statusCode: 400,
        statusMessage: `Invitation is ${state}`,
      })
    }

    // Personal invitations are for Google accounts; don't show their member list to guests
    if (invitation.type !== 'guest' && user.isAnonymous) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Sign in with Google to accept this invitation',
      })
    }

    // Fetch trip members
    const membersSnapshot = await db
      .collection('trips')
      .doc(invitation.tripId)
      .collection('members')
      .orderBy('createdAt', 'asc')
      .get()

    const members = membersSnapshot.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        name: data.name,
        avatarEmoji: data.avatarEmoji,
        isHost: data.isHost || false,
        linkedUserId: data.linkedUserId || null,
      }
    })

    return {
      tripId: invitation.tripId,
      members,
    }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error fetching invitation members:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch trip members',
    })
  }
})
