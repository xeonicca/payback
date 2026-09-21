import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const tripId = getRouterParam(event, 'tripId')
  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'tripId is required' })
  }

  const { enabled } = await readBody(event)
  if (typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled (boolean) is required' })
  }

  try {
    const db = getFirebaseAdminFirestore()
    const tripRef = db.collection('trips').doc(tripId)

    // One transaction: the member/collaborator checks and the writes can't interleave with a join
    return await db.runTransaction(async (tx) => {
      const [tripDoc, members, collaborators, pendingInvitations] = await Promise.all([
        tx.get(tripRef),
        tx.get(tripRef.collection('members')),
        tx.get(tripRef.collection('collaborators')),
        tx.get(db.collection('invitations').where('tripId', '==', tripId).where('status', '==', 'pending')),
      ])

      if (!tripDoc.exists) {
        throw createError({ statusCode: 404, statusMessage: 'Trip not found' })
      }
      const ownerUid = tripDoc.data()!.userId
      if (ownerUid !== user.uid) {
        throw createError({ statusCode: 403, statusMessage: 'Only the trip owner can change solo mode' })
      }

      if (!enabled) {
        // The public link stays off; the owner reopens it from 協作 when ready
        tx.update(tripRef, { soloMode: false })
        return { success: true, soloMode: false, revokedInvitations: 0 }
      }

      if (members.size !== 1 || collaborators.docs.some(doc => doc.id !== ownerUid)) {
        throw createError({ statusCode: 400, statusMessage: 'Solo mode needs exactly one member and no other collaborators' })
      }

      tx.update(tripRef, { soloMode: true, isPublicInviteEnabled: false })
      for (const invitation of pendingInvitations.docs)
        tx.update(invitation.ref, { status: 'revoked' })

      return { success: true, soloMode: true, revokedInvitations: pendingInvitations.size }
    })
  }
  catch (error: any) {
    if (error.statusCode)
      throw error

    console.error('Error changing solo mode:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to change solo mode' })
  }
})
