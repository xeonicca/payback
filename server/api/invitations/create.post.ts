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

  const { tripId, expiresInDays = 7 } = await readBody(event)

  if (!tripId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'tripId is required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // Get trip to verify ownership and get trip name
    const tripRef = db.collection('trips').doc(tripId)
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
        statusMessage: 'Only trip owner can create invitations',
      })
    }

    // Generate random invitation code (6 characters)
    const invitationCode = Math.random().toString(36).substring(2, 8).toUpperCase()

    // Calculate expiry date
    const expiresAt = Timestamp.fromMillis(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    )

    // Create invitation document
    const invitationData = {
      tripId,
      tripName: tripData?.name || 'Unknown Trip',
      invitedByUserId: user.uid,
      invitedByName: user.displayName || 'Unknown User',
      invitationCode,
      status: 'pending',
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
    }

    const invitationRef = await db.collection('invitations').add(invitationData)

    const baseUrl = getRequestURL(event).origin
    const invitationUrl = `${baseUrl}/invite/${invitationCode}`

    return {
      invitationId: invitationRef.id,
      invitationCode,
      invitationUrl,
      expiresAt: expiresAt.toDate().toISOString(),
    }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error creating invitation:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create invitation',
    })
  }
})
