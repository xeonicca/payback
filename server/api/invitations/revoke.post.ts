import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const { invitationId } = await readBody(event)

  if (!invitationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invitationId is required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // Get invitation
    const invitationRef = db.collection('invitations').doc(invitationId)
    const invitationDoc = await invitationRef.get()

    if (!invitationDoc.exists) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Invitation not found',
      })
    }

    const invitation = invitationDoc.data()

    // Get trip to verify ownership
    const tripRef = db.collection('trips').doc(invitation?.tripId || '')
    const tripDoc = await tripRef.get()

    if (!tripDoc.exists) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Trip not found',
      })
    }

    const tripData = tripDoc.data()

    // Verify user is the trip owner
    if (tripData?.userId !== user.uid) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only trip owner can revoke invitations',
      })
    }

    // Update invitation status to revoked
    await invitationRef.update({
      status: 'revoked',
    })

    return {
      success: true,
    }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error revoking invitation:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to revoke invitation',
    })
  }
})
