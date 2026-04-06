import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const { invitationCode, memberId, newMember } = await readBody(event)

  if (!invitationCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invitationCode is required',
    })
  }

  if (!memberId && !newMember) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either memberId or newMember is required',
    })
  }

  if (newMember && (!newMember.name || !newMember.avatarEmoji)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'newMember requires name and avatarEmoji',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // Find invitation by code
    const invitationsSnapshot = await db
      .collection('invitations')
      .where('invitationCode', '==', invitationCode)
      .limit(1)
      .get()

    if (invitationsSnapshot.empty) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Invitation not found',
      })
    }

    const invitationDoc = invitationsSnapshot.docs[0]
    const invitation = invitationDoc.data()

    // Check invitation status
    if (invitation.status === 'revoked') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invitation has been revoked',
      })
    }

    if (invitation.status === 'expired') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invitation has expired',
      })
    }

    // Check if invitation has remaining uses
    const maxUses = invitation.maxUses ?? 1
    const usedCount = invitation.usedCount ?? 0
    if (invitation.status === 'accepted' && maxUses !== null && usedCount >= maxUses) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invitation has reached its usage limit',
      })
    }

    // Check if this user already used this invitation
    const usedByUserIds = invitation.usedByUserIds ?? []
    if (usedByUserIds.includes(user.uid)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You have already used this invitation',
      })
    }

    // Check if invitation is expired
    const now = Timestamp.now()
    if (invitation.expiresAt.toMillis() < now.toMillis()) {
      // Mark as expired
      await invitationDoc.ref.update({
        status: 'expired',
      })

      throw createError({
        statusCode: 400,
        statusMessage: 'Invitation has expired',
      })
    }

    const tripId = invitation.tripId

    // Check if user is already a collaborator
    const collaboratorRef = db
      .collection('trips')
      .doc(tripId)
      .collection('collaborators')
      .doc(user.uid)
    const collaboratorDoc = await collaboratorRef.get()

    if (collaboratorDoc.exists) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You are already a collaborator on this trip',
      })
    }

    // Add user as collaborator (guest invitations get 'guest' role)
    const collaboratorRole = invitation.type === 'guest' ? 'guest' : 'editor'
    await collaboratorRef.set({
      userId: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: collaboratorRole,
      joinedAt: FieldValue.serverTimestamp(),
      invitedBy: invitation.invitedByUserId,
    })

    // Link to existing member or create new member
    if (memberId) {
      // Verify the member exists and isn't already linked
      const memberRef = db
        .collection('trips')
        .doc(tripId)
        .collection('members')
        .doc(memberId)
      const memberDoc = await memberRef.get()

      if (!memberDoc.exists) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Member not found',
        })
      }

      const memberData = memberDoc.data()
      if (memberData?.linkedUserId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'This member is already linked to another user',
        })
      }

      // Link the member to this user
      await memberRef.update({
        linkedUserId: user.uid,
      })
    }
    else if (newMember) {
      // Create a new member and link it
      await db
        .collection('trips')
        .doc(tripId)
        .collection('members')
        .add({
          name: newMember.name,
          avatarEmoji: newMember.avatarEmoji,
          isHost: false,
          spending: 0,
          createdAt: FieldValue.serverTimestamp(),
          linkedUserId: user.uid,
        })
    }

    // Update invitation usage
    const newUsedCount = usedCount + 1
    const isFullyUsed = maxUses !== null && newUsedCount >= maxUses
    await invitationDoc.ref.update({
      status: isFullyUsed ? 'accepted' : 'pending',
      usedCount: FieldValue.increment(1),
      usedByUserIds: FieldValue.arrayUnion(user.uid),
      usedByUserId: user.uid,
      usedAt: FieldValue.serverTimestamp(),
    })

    // Increment collaborator count and add user to collaboratorUserIds
    const tripRef = db.collection('trips').doc(tripId)
    await tripRef.update({
      collaboratorCount: FieldValue.increment(1),
      collaboratorUserIds: FieldValue.arrayUnion(user.uid),
    })

    return {
      success: true,
      tripId,
    }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error accepting invitation:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to accept invitation',
    })
  }
})
