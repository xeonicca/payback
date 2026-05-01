import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const tripId = getRouterParam(event, 'tripId')
  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'tripId is required' })
  }

  const { name, avatarEmoji } = await readBody(event)
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  if (!avatarEmoji || typeof avatarEmoji !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'avatarEmoji is required' })
  }

  const db = getFirebaseAdminFirestore()

  // Verify the user is a collaborator on this trip
  const collaboratorDoc = await db
    .collection('trips')
    .doc(tripId)
    .collection('collaborators')
    .doc(user.uid)
    .get()

  if (!collaboratorDoc.exists) {
    throw createError({ statusCode: 403, statusMessage: 'Not a collaborator on this trip' })
  }

  // Find the member linked to this user
  const membersSnapshot = await db
    .collection('trips')
    .doc(tripId)
    .collection('members')
    .where('linkedUserId', '==', user.uid)
    .limit(1)
    .get()

  if (membersSnapshot.empty) {
    throw createError({ statusCode: 404, statusMessage: 'No member linked to your account' })
  }

  const memberDoc = membersSnapshot.docs[0]
  const trimmedName = name.trim()

  // Check for name collision with other members
  const allMembersSnapshot = await db
    .collection('trips')
    .doc(tripId)
    .collection('members')
    .get()

  const nameConflict = allMembersSnapshot.docs.some(
    doc => doc.id !== memberDoc.id && doc.data().name?.toLowerCase() === trimmedName.toLowerCase(),
  )

  if (nameConflict) {
    throw createError({ statusCode: 409, statusMessage: `「${trimmedName}」已被其他成員使用` })
  }

  await memberDoc.ref.update({ name: trimmedName, avatarEmoji })

  return { success: true }
})
