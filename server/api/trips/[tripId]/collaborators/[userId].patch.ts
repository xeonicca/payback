import { getOwnedTrip } from '~/server/utils/collaborators'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const tripId = getRouterParam(event, 'tripId')
  const userId = getRouterParam(event, 'userId')
  if (!tripId || !userId) {
    throw createError({ statusCode: 400, statusMessage: 'tripId and userId are required' })
  }

  const { readOnly } = await readBody(event)
  if (typeof readOnly !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'readOnly (boolean) is required' })
  }

  const db = getFirebaseAdminFirestore()
  const trip = await getOwnedTrip(db, tripId, user.uid)
  if (userId === trip.userId) {
    throw createError({ statusCode: 400, statusMessage: 'The trip owner always has full access' })
  }

  const collaboratorRef = db.collection('trips').doc(tripId).collection('collaborators').doc(userId)
  if (!(await collaboratorRef.get()).exists) {
    throw createError({ statusCode: 404, statusMessage: 'Not a collaborator on this trip' })
  }

  await collaboratorRef.update({ readOnly })
  return { success: true, readOnly }
})
