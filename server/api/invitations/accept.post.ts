import { FieldValue } from 'firebase-admin/firestore'
import { getInvitationState, normalizeMaxUses } from '~/server/utils/invitations'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)

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

    // One transaction: every check runs before any write, so a failed accept leaves
    // no half-joined collaborator behind, and concurrent accepts can't exceed maxUses.
    const outcome = await db.runTransaction(async (tx) => {
      const invitationSnapshot = await tx.get(
        db.collection('invitations').where('invitationCode', '==', invitationCode).limit(1),
      )
      if (invitationSnapshot.empty) {
        throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
      }

      const invitationDoc = invitationSnapshot.docs[0]
      const invitation = invitationDoc.data()
      const tripRef = db.collection('trips').doc(invitation.tripId)
      const collaboratorRef = tripRef.collection('collaborators').doc(user.uid)
      const memberRef = memberId ? tripRef.collection('members').doc(memberId) : null

      const [tripDoc, collaboratorDoc, memberDoc] = await Promise.all([
        tx.get(tripRef),
        tx.get(collaboratorRef),
        memberRef ? tx.get(memberRef) : Promise.resolve(null),
      ])

      const state = getInvitationState(invitation)
      if (state === 'revoked') {
        throw createError({ statusCode: 400, statusMessage: 'Invitation has been revoked' })
      }
      if (state === 'expired') {
        // Persist the expiry, then report it once the transaction commits
        if (invitation.status !== 'expired')
          tx.update(invitationDoc.ref, { status: 'expired' })
        return { expired: true as const }
      }
      if (state === 'used') {
        throw createError({ statusCode: 400, statusMessage: 'Invitation has reached its usage limit' })
      }
      if ((invitation.usedByUserIds ?? []).includes(user.uid)) {
        throw createError({ statusCode: 400, statusMessage: 'You have already used this invitation' })
      }
      if (invitation.type !== 'guest' && user.isAnonymous) {
        throw createError({ statusCode: 403, statusMessage: 'Sign in with Google to accept this invitation' })
      }
      if (!tripDoc.exists) {
        throw createError({ statusCode: 404, statusMessage: 'Trip not found' })
      }
      // Defence in depth: only invitations the trip's owner issued are honoured
      if (invitation.invitedByUserId !== tripDoc.data()?.userId) {
        throw createError({ statusCode: 403, statusMessage: 'Invitation is not valid for this trip' })
      }
      if (collaboratorDoc.exists) {
        throw createError({ statusCode: 400, statusMessage: 'You are already a collaborator on this trip' })
      }
      if (memberDoc && !memberDoc.exists) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found' })
      }
      if (memberDoc?.data()?.linkedUserId) {
        throw createError({ statusCode: 400, statusMessage: 'This member is already linked to another user' })
      }

      // Add user as collaborator (guest invitations get 'guest' role)
      tx.set(collaboratorRef, {
        userId: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        role: invitation.type === 'guest' ? 'guest' : 'editor',
        readOnly: invitation.viewOnly === true,
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: invitation.invitedByUserId,
      })

      // Link to existing member or create new member
      if (memberRef) {
        tx.update(memberRef, { linkedUserId: user.uid })
      }
      else {
        tx.set(tripRef.collection('members').doc(), {
          name: newMember.name,
          avatarEmoji: newMember.avatarEmoji,
          isHost: false,
          spending: 0,
          createdAt: FieldValue.serverTimestamp(),
          linkedUserId: user.uid,
        })
      }

      const maxUses = normalizeMaxUses(invitation.maxUses)
      const usedCount = (invitation.usedCount ?? 0) + 1
      tx.update(invitationDoc.ref, {
        status: maxUses !== null && usedCount >= maxUses ? 'accepted' : 'pending',
        usedCount,
        usedByUserIds: FieldValue.arrayUnion(user.uid),
        usedByUserId: user.uid,
        usedAt: FieldValue.serverTimestamp(),
      })

      tx.update(tripRef, {
        collaboratorCount: FieldValue.increment(1),
        collaboratorUserIds: FieldValue.arrayUnion(user.uid),
      })

      return { expired: false as const, tripId: tripRef.id }
    })

    if (outcome.expired) {
      throw createError({ statusCode: 400, statusMessage: 'Invitation has expired' })
    }

    return {
      success: true,
      tripId: outcome.tripId,
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
