import { generateUniqueCode, publicJoinCodeTaken } from '~/server/utils/codes'
import { getOwnedTrip } from '~/server/utils/collaborators'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { tripId } = await readBody(event)
  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'tripId is required' })
  }

  try {
    const db = getFirebaseAdminFirestore()
    await getOwnedTrip(db, tripId, user.uid)

    // The old /join/<code> URL stops resolving as soon as this is written
    const publicJoinCode = await generateUniqueCode(publicJoinCodeTaken(db))
    await db.collection('trips').doc(tripId).update({ publicJoinCode })

    return { publicJoinCode }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error resetting public link:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to reset the public link' })
  }
})
