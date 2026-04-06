import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  // User should now have Google provider data after linking
  if (user.providerData.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Account has not been linked to a provider yet',
    })
  }

  const { tripId } = await readBody(event)
  const db = getFirebaseAdminFirestore()

  try {
    if (tripId) {
      // Update collaborator record for a specific trip
      const collaboratorRef = db
        .collection('trips')
        .doc(tripId)
        .collection('collaborators')
        .doc(user.uid)
      const collaboratorDoc = await collaboratorRef.get()

      if (collaboratorDoc.exists && collaboratorDoc.data()?.role === 'guest') {
        await collaboratorRef.update({
          role: 'editor',
          email: user.email || null,
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
        })
      }
    }
    else {
      // Update all trips where the user is a guest collaborator
      const tripsSnapshot = await db
        .collection('trips')
        .where('collaboratorUserIds', 'array-contains', user.uid)
        .get()

      const batch = db.batch()
      for (const tripDoc of tripsSnapshot.docs) {
        const collaboratorRef = tripDoc.ref
          .collection('collaborators')
          .doc(user.uid)
        const collaboratorDoc = await collaboratorRef.get()

        if (collaboratorDoc.exists && collaboratorDoc.data()?.role === 'guest') {
          batch.update(collaboratorRef, {
            role: 'editor',
            email: user.email || null,
            displayName: user.displayName || null,
            photoURL: user.photoURL || null,
          })
        }
      }
      await batch.commit()
    }

    return {
      success: true,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      uid: user.uid,
      isAnonymous: false,
    }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error upgrading guest account:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to upgrade guest account',
    })
  }
})
