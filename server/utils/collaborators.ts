import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'

/** Loads a trip, throwing 404 if it's missing and 403 unless `uid` owns it. */
export async function getOwnedTrip(db: Firestore, tripId: string, uid: string): Promise<DocumentData> {
  const tripDoc = await db.collection('trips').doc(tripId).get()
  if (!tripDoc.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Trip not found' })
  }
  const trip = tripDoc.data()!
  if (trip.userId !== uid) {
    throw createError({ statusCode: 403, statusMessage: 'Only the trip owner can manage access' })
  }
  return trip
}

/**
 * Takes a user's access away in one transaction: deletes their collaborator doc,
 * drops them from collaboratorUserIds and unlinks their member entry. The member
 * entry and the expenses they created stay. Returns false if they weren't a collaborator.
 */
export async function removeCollaborator(db: Firestore, tripId: string, userId: string): Promise<boolean> {
  const tripRef = db.collection('trips').doc(tripId)
  const collaboratorRef = tripRef.collection('collaborators').doc(userId)

  return db.runTransaction(async (tx) => {
    const [collaboratorDoc, linkedMembers] = await Promise.all([
      tx.get(collaboratorRef),
      tx.get(tripRef.collection('members').where('linkedUserId', '==', userId)),
    ])
    if (!collaboratorDoc.exists)
      return false

    for (const member of linkedMembers.docs)
      tx.update(member.ref, { linkedUserId: FieldValue.delete() })
    tx.delete(collaboratorRef)
    tx.update(tripRef, {
      collaboratorUserIds: FieldValue.arrayRemove(userId),
      collaboratorCount: FieldValue.increment(-1),
    })
    return true
  })
}
