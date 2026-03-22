import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const { tripId, enabled } = await readBody(event)

  if (!tripId || typeof enabled !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: 'tripId and enabled (boolean) are required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()
    const tripRef = db.collection('trips').doc(tripId)
    const tripDoc = await tripRef.get()

    if (!tripDoc.exists) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Trip not found',
      })
    }

    const tripData = tripDoc.data()

    if (tripData?.userId !== user.uid) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only trip owner can toggle public invite',
      })
    }

    const updateData: Record<string, any> = {
      isPublicInviteEnabled: enabled,
    }

    // Generate join code on first enable if one doesn't exist
    if (enabled && !tripData?.publicJoinCode) {
      updateData.publicJoinCode = Math.random().toString(36).substring(2, 10).toUpperCase()
    }

    await tripRef.update(updateData)

    return {
      success: true,
      isPublicInviteEnabled: enabled,
      publicJoinCode: updateData.publicJoinCode || tripData?.publicJoinCode || null,
    }
  }
  catch (error: any) {
    if (error.statusCode)
      throw error

    console.error('Error toggling public invite:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to toggle public invite',
    })
  }
})
