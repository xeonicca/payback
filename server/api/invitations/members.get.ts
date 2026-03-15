import { Timestamp } from 'firebase-admin/firestore'
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

    // Validate invitation is still valid
    if (invitation.status !== 'pending') {
      throw createError({
        statusCode: 400,
        statusMessage: `Invitation is ${invitation.status}`,
      })
    }

    const now = Timestamp.now()
    if (invitation.expiresAt.toMillis() < now.toMillis()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invitation has expired',
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
