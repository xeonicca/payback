import { removeCollaborator } from '~/server/utils/collaborators'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)

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
    const tripDoc = await db.collection('trips').doc(tripId).get()

    if (!tripDoc.exists) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Trip not found',
      })
    }

    // Owner cannot leave their own trip
    if (tripDoc.data()!.userId === user.uid) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Trip owner cannot leave the trip',
      })
    }

    if (!(await removeCollaborator(db, tripId, user.uid))) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You are not a collaborator on this trip',
      })
    }

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
