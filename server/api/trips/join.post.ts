import { FieldValue } from 'firebase-admin/firestore'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  // The public link grants editor access, which anonymous guests never get
  if (user.isAnonymous) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Sign in with Google to join this trip',
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

  if (memberId && (typeof memberId !== 'string' || memberId.includes('/'))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'memberId must be a member id',
    })
  }

  if (newMember && (typeof newMember.name !== 'string' || !newMember.name || typeof newMember.avatarEmoji !== 'string' || !newMember.avatarEmoji)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'newMember requires name and avatarEmoji',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // One transaction: every check runs before any write
    const tripId = await db.runTransaction(async (tx) => {
      const tripsSnapshot = await tx.get(
        db.collection('trips').where('publicJoinCode', '==', joinCode).limit(1),
      )
      if (tripsSnapshot.empty) {
        throw createError({ statusCode: 404, statusMessage: 'Trip not found' })
      }

      const tripDoc = tripsSnapshot.docs[0]
      const tripData = tripDoc.data()
      const collaboratorRef = tripDoc.ref.collection('collaborators').doc(user.uid)
      const memberRef = memberId ? tripDoc.ref.collection('members').doc(memberId) : null
      const departedRef = tripDoc.ref.collection('departed').doc(user.uid)

      const [collaboratorDoc, memberDoc, departedDoc] = await Promise.all([
        tx.get(collaboratorRef),
        memberRef ? tx.get(memberRef) : Promise.resolve(null),
        tx.get(departedRef),
      ])

      if (tripData.soloMode === true) {
        throw createError({ statusCode: 403, statusMessage: 'Solo trips cannot be joined' })
      }
      if (!tripData.isPublicInviteEnabled) {
        throw createError({ statusCode: 400, statusMessage: 'Public joining is disabled for this trip' })
      }
      if (collaboratorDoc.exists) {
        throw createError({ statusCode: 400, statusMessage: 'You are already a collaborator on this trip' })
      }
      if (tripData.userId === user.uid) {
        throw createError({ statusCode: 400, statusMessage: 'You are the owner of this trip' })
      }
      if (memberDoc && !memberDoc.exists) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found' })
      }
      if (memberDoc?.data()?.linkedUserId) {
        throw createError({ statusCode: 400, statusMessage: 'This member is already linked to another user' })
      }

      tx.set(collaboratorRef, {
        userId: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL || null,
        role: 'editor',
        // A view-only collaborator can't shed it by leaving and coming back
        readOnly: departedDoc.data()?.readOnly === true,
        joinedAt: FieldValue.serverTimestamp(),
        joinedVia: 'public-link',
      })

      if (memberRef) {
        tx.update(memberRef, { linkedUserId: user.uid })
      }
      else {
        tx.set(tripDoc.ref.collection('members').doc(), {
          name: newMember.name,
          avatarEmoji: newMember.avatarEmoji,
          isHost: false,
          spending: 0,
          createdAt: FieldValue.serverTimestamp(),
          linkedUserId: user.uid,
        })
      }

      tx.update(tripDoc.ref, {
        collaboratorCount: FieldValue.increment(1),
        collaboratorUserIds: FieldValue.arrayUnion(user.uid),
      })
      tx.delete(departedRef)

      return tripDoc.id
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
