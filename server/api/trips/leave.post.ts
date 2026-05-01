import { FieldValue } from 'firebase-admin/firestore'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const { tripId } = await readBody(event)

  if (!tripId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'tripId is required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // Check the trip exists
    const tripRef = db.collection('trips').doc(tripId)
    const tripDoc = await tripRef.get()

    if (!tripDoc.exists) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Trip not found',
      })
    }

    const tripData = tripDoc.data()!

    // Owner cannot leave their own trip
    if (tripData.userId === user.uid) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Trip owner cannot leave the trip',
      })
    }

    // Check user is a collaborator
    const collaboratorRef = db
      .collection('trips')
      .doc(tripId)
      .collection('collaborators')
      .doc(user.uid)
    const collaboratorDoc = await collaboratorRef.get()

    if (!collaboratorDoc.exists) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You are not a collaborator on this trip',
      })
    }

    // Unlink the member (set linkedUserId to null instead of deleting)
    const membersSnapshot = await db
      .collection('trips')
      .doc(tripId)
      .collection('members')
      .where('linkedUserId', '==', user.uid)
      .get()

    for (const memberDoc of membersSnapshot.docs) {
      await memberDoc.ref.update({ linkedUserId: FieldValue.delete() })
    }

    // Remove collaborator document
    await collaboratorRef.delete()

    // Remove user from trip's collaboratorUserIds and decrement count
    await tripRef.update({
      collaboratorUserIds: FieldValue.arrayRemove(user.uid),
      collaboratorCount: FieldValue.increment(-1),
    })

    return { success: true }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error leaving trip:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to leave trip',
    })
  }
})
