import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const { invitationCode } = await readBody(event)

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

    const invitationDoc = invitationsSnapshot.docs[0]
    const invitation = invitationDoc.data()

    // Check if invitation is already used
    if (invitation.status !== 'pending') {
      throw createError({
        statusCode: 400,
        statusMessage: `Invitation is ${invitation.status}`,
      })
    }

    // Check if invitation is expired
    const now = Timestamp.now()
    if (invitation.expiresAt.toMillis() < now.toMillis()) {
      // Mark as expired
      await invitationDoc.ref.update({
        status: 'expired',
      })

      throw createError({
        statusCode: 400,
        statusMessage: 'Invitation has expired',
      })
    }

    const tripId = invitation.tripId

    // Check if user is already a collaborator
    const collaboratorRef = db
      .collection('trips')
      .doc(tripId)
      .collection('collaborators')
      .doc(user.uid)
    const collaboratorDoc = await collaboratorRef.get()

    if (collaboratorDoc.exists) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You are already a collaborator on this trip',
      })
    }

    // Add user as collaborator
    await collaboratorRef.set({
      userId: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL || null,
      role: 'editor',
      joinedAt: FieldValue.serverTimestamp(),
      invitedBy: invitation.invitedByUserId,
    })

    // Update invitation status
    await invitationDoc.ref.update({
      status: 'accepted',
      usedByUserId: user.uid,
      usedAt: FieldValue.serverTimestamp(),
    })

    // Increment collaborator count on trip
    const tripRef = db.collection('trips').doc(tripId)
    await tripRef.update({
      collaboratorCount: FieldValue.increment(1),
    })

    return {
      success: true,
      tripId,
    }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error accepting invitation:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to accept invitation',
    })
  }
})
