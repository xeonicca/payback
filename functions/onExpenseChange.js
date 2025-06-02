const admin = require('firebase-admin')
const logger = require('firebase-functions/logger')
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore')

const db = admin.firestore()

// Helper function to update trip total
async function updateTripTotal(tripId, amountChange) {
  const tripRef = db.doc(`trips/${tripId}`)

  try {
    await db.runTransaction(async (transaction) => {
      const tripDoc = await transaction.get(tripRef)
      if (!tripDoc.exists) {
        throw new Error('Trip document does not exist')
      }

      const currentTotal = tripDoc.data().totalExpenses || 0
      const newTotal = currentTotal + amountChange

      transaction.update(tripRef, {
        totalExpenses: newTotal,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    logger.info(`Successfully updated total expenses for trip ${tripId}`)
  }
  catch (error) {
    logger.error(`Error updating trip total: ${error}`)
    throw error
  }
}

// Trigger on expense creation
exports.onExpenseCreated = onDocumentCreated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const expenseData = event.data.data()

  // Only update if the expense is not in processing state
  if (!expenseData.isProcessing) {
    await updateTripTotal(tripId, expenseData.grandTotal)
  }
})

// Trigger on expense update
exports.onExpenseUpdated = onDocumentUpdated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const oldData = event.data.before.data()
  const newData = event.data.after.data()

  // Only process if the expense is no longer in processing state
  if (oldData.isProcessing && !newData.isProcessing) {
    await updateTripTotal(tripId, newData.grandTotal)
  }
  // Handle amount changes for non-processing expenses
  else if (!oldData.isProcessing && !newData.isProcessing) {
    const amountChange = newData.grandTotal - oldData.grandTotal
    if (amountChange !== 0) {
      await updateTripTotal(tripId, amountChange)
    }
  }
})

// Trigger on expense deletion
exports.onExpenseDeleted = onDocumentDeleted('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const expenseData = event.data.data()

  // Only subtract if the expense was not in processing state
  if (!expenseData.isProcessing) {
    await updateTripTotal(tripId, -expenseData.grandTotal)
  }
})
