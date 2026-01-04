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
  const tripId = query.tripId as string

  if (!tripId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'tripId is required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // Get trip to verify ownership
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
        statusMessage: 'Only trip owner can view invitations',
      })
    }

    // Get all invitations for this trip
    const invitationsSnapshot = await db
      .collection('invitations')
      .where('tripId', '==', tripId)
      .orderBy('createdAt', 'desc')
      .get()

    const invitations = invitationsSnapshot.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data,
        expiresAt: data.expiresAt?.toDate().toISOString(),
        createdAt: data.createdAt?.toDate().toISOString(),
        usedAt: data.usedAt?.toDate().toISOString(),
      }
    })

    return invitations
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error listing invitations:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to list invitations',
    })
  }
})
