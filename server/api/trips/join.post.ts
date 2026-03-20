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

  const { joinCode, memberId, newMember } = await readBody(event)

  if (!joinCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'joinCode is required',
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

    // Find trip by join code
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
    const tripId = tripDoc.id

    if (!tripData.isPublicInviteEnabled) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Public joining is disabled for this trip',
      })
    }

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

    // Also check if user is the trip owner
    if (tripData.userId === user.uid) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You are the owner of this trip',
      })
    }

    // Add user as collaborator
    await collaboratorRef.set({
      userId: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL || null,
      role: 'editor',
      joinedAt: FieldValue.serverTimestamp(),
      joinedVia: 'public-link',
    })

    // Link to existing member or create new member
    if (memberId) {
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

      await memberRef.update({
        linkedUserId: user.uid,
      })
    }
    else if (newMember) {
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

    // Update trip collaborator count
    await tripDoc.ref.update({
      collaboratorCount: FieldValue.increment(1),
      collaboratorUserIds: FieldValue.arrayUnion(user.uid),
    })

    return {
      success: true,
      tripId,
    }
  }
  catch (error: any) {
    if (error.statusCode)
      throw error

    console.error('Error joining trip:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to join trip',
    })
  }
})
