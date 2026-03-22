import { getFirebaseAdminFirestore } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const { joinCode } = getQuery(event)

  if (!joinCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'joinCode is required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    const tripsSnapshot = await db
      .collection('trips')
      .where('publicJoinCode', '==', joinCode)
      .limit(1)
      .get()

    if (tripsSnapshot.empty) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Trip not found',
      })
    }

    const tripDoc = tripsSnapshot.docs[0]
    const tripData = tripDoc.data()

    if (!tripData.isPublicInviteEnabled) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Public joining is disabled for this trip',
      })
    }

    // Get members
    const membersSnapshot = await db
      .collection('trips')
      .doc(tripDoc.id)
      .collection('members')
      .get()

    const members = membersSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      avatarEmoji: doc.data().avatarEmoji,
      isHost: doc.data().isHost || false,
      linkedUserId: doc.data().linkedUserId || null,
    }))

    return {
      tripId: tripDoc.id,
      tripName: tripData.name,
      ownerDisplayName: tripData.ownerDisplayName || '',
      members,
    }
  }
  catch (error: any) {
    if (error.statusCode)
      throw error

    console.error('Error fetching join info:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch trip info',
    })
  }
})
