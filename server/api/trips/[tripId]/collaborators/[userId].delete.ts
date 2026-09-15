import { getOwnedTrip, removeCollaborator } from '~/server/utils/collaborators'
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

  const db = getFirebaseAdminFirestore()
  const trip = await getOwnedTrip(db, tripId, user.uid)
  if (userId === trip.userId) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot remove the trip owner' })
  }

  if (!(await removeCollaborator(db, tripId, userId))) {
    throw createError({ statusCode: 404, statusMessage: 'Not a collaborator on this trip' })
  }

  return { success: true }
})
