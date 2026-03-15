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

  const db = getFirebaseAdminFirestore()

  // Find all trips that don't have collaboratorUserIds yet
  const tripsSnapshot = await db.collection('trips').get()

  let migratedCount = 0
  let fixedCollaboratorDocs = 0

  for (const tripDoc of tripsSnapshot.docs) {
    const tripData = tripDoc.data()

    // Skip trips that already have collaboratorUserIds
    if (tripData.collaboratorUserIds && tripData.collaboratorUserIds.length > 0) {
      continue
    }

    const tripId = tripDoc.id
    const ownerId = tripData.userId

    // Skip trips with no owner userId
    if (!ownerId) {
      console.warn(`Trip ${tripId} has no userId, skipping`)
      continue
    }

    const collaboratorUserIds: string[] = [ownerId]

    // Read collaborators subcollection
    const collaboratorsSnapshot = await db
      .collection('trips')
      .doc(tripId)
      .collection('collaborators')
      .get()

    let ownerCollaboratorDocExists = false

    for (const collabDoc of collaboratorsSnapshot.docs) {
      const collabData = collabDoc.data()
      const collabUserId = collabData.userId

      // Check if owner's collaborator doc uses UID as doc ID
      if (collabUserId === ownerId) {
        if (collabDoc.id === ownerId) {
          ownerCollaboratorDocExists = true
        }
        else {
          // Owner doc has random ID - fix it by re-creating with UID
          await db
            .collection('trips')
            .doc(tripId)
            .collection('collaborators')
            .doc(ownerId)
            .set(collabData)

          // Delete the old random-ID doc
          await collabDoc.ref.delete()
          ownerCollaboratorDocExists = true
          fixedCollaboratorDocs++
        }
      }
      else {
        // Add non-owner collaborators
        if (!collaboratorUserIds.includes(collabUserId)) {
          collaboratorUserIds.push(collabUserId)
        }

        // Fix collaborator docs with wrong ID
        if (collabDoc.id !== collabUserId) {
          await db
            .collection('trips')
            .doc(tripId)
            .collection('collaborators')
            .doc(collabUserId)
            .set(collabData)
          await collabDoc.ref.delete()
          fixedCollaboratorDocs++
        }
      }
    }

    // If no owner collaborator doc exists, create one
    if (!ownerCollaboratorDocExists) {
      await db
        .collection('trips')
        .doc(tripId)
        .collection('collaborators')
        .doc(ownerId)
        .set({
          userId: ownerId,
          email: null,
          displayName: null,
          photoURL: null,
          role: 'owner',
          joinedAt: FieldValue.serverTimestamp(),
        })
    }

    // Set collaboratorUserIds and ownerDisplayName on trip
    await tripDoc.ref.update({
      collaboratorUserIds,
      ownerDisplayName: tripData.ownerDisplayName || '',
    })

    migratedCount++
  }

  return {
    success: true,
    migratedCount,
    fixedCollaboratorDocs,
    totalTrips: tripsSnapshot.size,
  }
})
