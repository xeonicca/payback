const admin = require('firebase-admin')
const logger = require('firebase-functions/logger')
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore')

const db = admin.firestore()

// Helper function to add or remove expense amount from trip totals
async function addOrRemoveExpenseAmount(tripId, amount, isEnabled) {
  const tripRef = db.doc(`trips/${tripId}`)

  try {
    await db.runTransaction(async (transaction) => {
      const tripDoc = await transaction.get(tripRef)
      if (!tripDoc.exists) {
        throw new Error('Trip document does not exist')
      }

      const {
        totalExpenses: currentTotal = 0,
        enabledTotalExpenses: currentEnabledTotal = 0,
        disabledTotalExpenses: currentDisabledTotal = 0,
      } = tripDoc.data()

      const newTotal = currentTotal + amount
      const newEnabledTotal = isEnabled ? currentEnabledTotal + amount : currentEnabledTotal
      const newDisabledTotal = !isEnabled ? currentDisabledTotal + amount : currentDisabledTotal

      transaction.update(tripRef, {
        totalExpenses: newTotal,
        enabledTotalExpenses: newEnabledTotal,
        disabledTotalExpenses: newDisabledTotal,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    logger.info(`Successfully added/removed expense amount for trip ${tripId}`)
  }
  catch (error) {
    logger.error(`Error adding/removing expense amount: ${error}`)
    throw error
  }
}

// Helper function to handle expense updates (amount changes and enabled state changes)
async function handleExpenseUpdate(tripId, oldData, newData) {
  const tripRef = db.doc(`trips/${tripId}`)

  try {
    await db.runTransaction(async (transaction) => {
      const tripDoc = await transaction.get(tripRef)
      if (!tripDoc.exists) {
        throw new Error('Trip document does not exist')
      }

      const {
        totalExpenses: currentTotal = 0,
        enabledTotalExpenses: currentEnabledTotal = 0,
        disabledTotalExpenses: currentDisabledTotal = 0,
      } = tripDoc.data()

      let newTotal = currentTotal
      let newEnabledTotal = currentEnabledTotal
      let newDisabledTotal = currentDisabledTotal

      // Handle enabled state changes
      if (oldData.enabled !== newData.enabled) {
        if (oldData.enabled) {
          newEnabledTotal -= oldData.grandTotal
          newDisabledTotal += oldData.grandTotal
        }
        else {
          newEnabledTotal += oldData.grandTotal
          newDisabledTotal -= oldData.grandTotal
        }
      }

      // Handle amount changes
      const amountChange = newData.grandTotal - oldData.grandTotal
      if (amountChange !== 0) {
        newTotal += amountChange
        if (newData.enabled) {
          newEnabledTotal += amountChange
        }
        else {
          newDisabledTotal += amountChange
        }
      }

      transaction.update(tripRef, {
        totalExpenses: newTotal,
        enabledTotalExpenses: newEnabledTotal,
        disabledTotalExpenses: newDisabledTotal,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    logger.info(`Successfully handled expense update for trip ${tripId}`)
  }
  catch (error) {
    logger.error(`Error handling expense update: ${error}`)
    throw error
  }
}

// Helper function to update expense count
async function updateExpenseCount(tripId, countChange) {
  const tripRef = db.doc(`trips/${tripId}`)

  try {
    await db.runTransaction(async (transaction) => {
      const tripDoc = await transaction.get(tripRef)
      if (!tripDoc.exists) {
        throw new Error('Trip document does not exist')
      }

      const currentCount = tripDoc.data().expenseCount || 0
      const newCount = currentCount + countChange

      transaction.update(tripRef, {
        expenseCount: newCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    logger.info(`Successfully updated expense count for trip ${tripId}`)
  }
  catch (error) {
    logger.error(`Error updating expense count: ${error}`)
    throw error
  }
}

// Trigger on expense creation
exports.onExpenseCreated = onDocumentCreated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const expenseData = event.data.data()

  // Only update if the expense is not in processing state
  if (!expenseData.isProcessing) {
    await Promise.all([
      addOrRemoveExpenseAmount(tripId, expenseData.grandTotal, expenseData.enabled),
      updateExpenseCount(tripId, 1),
    ])
  }
})

// Trigger on expense update
exports.onExpenseUpdated = onDocumentUpdated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const oldData = event.data.before.data()
  const newData = event.data.after.data()

  // Only process if the expense is no longer in processing state
  if (oldData.isProcessing && !newData.isProcessing) {
    await Promise.all([
      addOrRemoveExpenseAmount(tripId, newData.grandTotal, newData.enabled),
      updateExpenseCount(tripId, 1),
    ])
  }
  // Handle amount changes and enabled state changes for non-processing expenses
  else if (!oldData.isProcessing && !newData.isProcessing) {
    const amountChange = newData.grandTotal - oldData.grandTotal
    const enabledStateChanged = oldData.enabled !== newData.enabled

    if (amountChange !== 0 || enabledStateChanged) {
      await handleExpenseUpdate(tripId, oldData, newData)
    }
  }
})

// Trigger on expense deletion
exports.onExpenseDeleted = onDocumentDeleted('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const expenseData = event.data.data()

  // Only subtract if the expense was not in processing state
  if (!expenseData.isProcessing) {
    await Promise.all([
      addOrRemoveExpenseAmount(tripId, -expenseData.grandTotal, expenseData.enabled),
      updateExpenseCount(tripId, -1),
    ])
  }
})
