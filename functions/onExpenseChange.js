const { Storage } = require('@google-cloud/storage')
const admin = require('firebase-admin')
const logger = require('firebase-functions/logger')
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore')
const { totalsDelta } = require('./expenseTotals')

const db = admin.firestore()
const storage = new Storage()

// Helper function to get trip members
async function getTripMembers(tripId) {
  try {
    const membersSnapshot = await db.collection(`trips/${tripId}/members`).get()
    return membersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }))
  }
  catch (error) {
    logger.error(`Error fetching trip members: ${error}`)
    throw error
  }
}

// Consolidated function to update trip totals and member spending in a single transaction
async function updateTripAndMembers(tripId, tripUpdates, memberSpendingChanges) {
  const tripRef = db.doc(`trips/${tripId}`)
  const membersRef = db.collection(`trips/${tripId}/members`)

  try {
    await db.runTransaction(async (transaction) => {
      // Single read of trip document
      const tripDoc = await transaction.get(tripRef)
      if (!tripDoc.exists) {
        throw new Error('Trip document does not exist')
      }

      const tripData = tripDoc.data()

      // Calculate new trip values
      const updates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }

      if (tripUpdates.totalExpenses !== undefined) {
        updates.totalExpenses = (tripData.totalExpenses || 0) + tripUpdates.totalExpenses
      }
      if (tripUpdates.enabledTotalExpenses !== undefined) {
        updates.enabledTotalExpenses = (tripData.enabledTotalExpenses || 0) + tripUpdates.enabledTotalExpenses
      }
      if (tripUpdates.disabledTotalExpenses !== undefined) {
        updates.disabledTotalExpenses = (tripData.disabledTotalExpenses || 0) + tripUpdates.disabledTotalExpenses
      }
      if (tripUpdates.expenseCount !== undefined) {
        updates.expenseCount = (tripData.expenseCount || 0) + tripUpdates.expenseCount
      }

      // Update trip document
      transaction.update(tripRef, updates)

      // Update member spending in the same transaction
      for (const [memberId, spendingChange] of Object.entries(memberSpendingChanges)) {
        const memberRef = membersRef.doc(memberId)
        transaction.update(memberRef, {
          spending: admin.firestore.FieldValue.increment(spendingChange),
        })
      }
    })

    logger.info(`Successfully updated trip and member spending for trip ${tripId}`)
  }
  catch (error) {
    logger.error(`Error updating trip and members: ${error}`)
    throw error
  }
}

// Apply one expense write to its trip's totals and member spending. Every
// trigger goes through here: the change is what the expense counts for after
// the write minus what it counted for before, so the cached totals stay equal
// to the sum over the trip's expenses (see expenseTotals.js).
async function applyExpenseWrite(tripId, before, after) {
  const tripMembers = await getTripMembers(tripId)
  const delta = totalsDelta(before, after, tripMembers)
  if (delta.isZero)
    return
  await updateTripAndMembers(tripId, delta.trip, delta.spending)
}

// Trigger on expense creation
exports.onExpenseCreated = onDocumentCreated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  try {
    await applyExpenseWrite(tripId, null, event.data.data())
  }
  catch (error) {
    logger.error(`Error processing expense creation: ${error}`)
  }
})

// Trigger on expense update
exports.onExpenseUpdated = onDocumentUpdated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  try {
    await applyExpenseWrite(tripId, event.data.before.data(), event.data.after.data())
  }
  catch (error) {
    logger.error(`Error processing expense update: ${error}`)
  }
})

// Trigger on expense deletion
exports.onExpenseDeleted = onDocumentDeleted('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId, expenseId } = event.params
  try {
    await applyExpenseWrite(tripId, event.data.data(), null)
  }
  catch (error) {
    logger.error(`Error processing expense deletion: ${error}`)
  }

  // Delete associated images from Storage
  try {
    const bucket = storage.bucket(process.env.GCLOUD_STORAGE_BUCKET)
    const expenseFolder = `trips/${tripId}/expenses/${expenseId}/`
    await bucket.deleteFiles({ prefix: expenseFolder })
    logger.info(`Deleted images for expense ${expenseId}`)
  }
  catch (error) {
    logger.error(`Error deleting images for expense ${expenseId}: ${error}`)
  }
})
