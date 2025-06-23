const admin = require('firebase-admin')
const logger = require('firebase-functions/logger')
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore')

const db = admin.firestore()

// Helper function to calculate member spending for an expense
function calculateMemberSpending(expenseData, tripMembers) {
  const memberSpending = {}

  // Initialize all members with 0 spending
  tripMembers.forEach((member) => {
    memberSpending[member.id] = 0
  })

  // If expense has items, calculate based on item-level sharing
  if (expenseData.items && expenseData.items.length > 0) {
    expenseData.items.forEach((item) => {
      let sharingMembers = []

      // If item has no specific sharedByMemberIds, all members share it
      if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
        sharingMembers = tripMembers.map(member => member.id)
      }
      else {
        sharingMembers = item.sharedByMemberIds
      }

      // Skip if no members are sharing this item
      if (sharingMembers.length === 0)
        return

      // Calculate price per member for this item
      const pricePerMember = item.price / sharingMembers.length

      // Add the price to each sharing member's total
      sharingMembers.forEach((memberId) => {
        if (memberSpending[memberId] !== undefined) {
          memberSpending[memberId] += pricePerMember
        }
      })
    })
  }
  else {
    // If no items, use sharedWithMemberIds from expense level
    let sharingMembers = []

    // If expense has no specific sharedWithMemberIds, all members share it
    if (!expenseData.sharedWithMemberIds || expenseData.sharedWithMemberIds.length === 0) {
      sharingMembers = tripMembers.map(member => member.id)
    }
    else {
      sharingMembers = expenseData.sharedWithMemberIds
    }

    // Skip if no members are sharing this expense
    if (sharingMembers.length === 0) {
      return memberSpending
    }

    // Calculate price per member for the entire expense
    const pricePerMember = expenseData.grandTotal / sharingMembers.length

    // Add the price to each sharing member's total
    sharingMembers.forEach((memberId) => {
      if (memberSpending[memberId] !== undefined) {
        memberSpending[memberId] = pricePerMember
      }
    })
  }

  return memberSpending
}

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

// Trigger on expense creation
exports.onExpenseCreated = onDocumentCreated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const expenseData = event.data.data()

  // Only update if the expense is not in processing state
  if (!expenseData.isProcessing) {
    try {
      const tripMembers = await getTripMembers(tripId)
      const memberSpending = calculateMemberSpending(expenseData, tripMembers)

      // Consolidate all updates into a single transaction
      await updateTripAndMembers(tripId, {
        totalExpenses: expenseData.grandTotal,
        enabledTotalExpenses: expenseData.enabled ? expenseData.grandTotal : 0,
        disabledTotalExpenses: expenseData.enabled ? 0 : expenseData.grandTotal,
        expenseCount: 1,
      }, memberSpending)
    }
    catch (error) {
      logger.error(`Error processing expense creation: ${error}`)
    }
  }
})

// Trigger on expense update
exports.onExpenseUpdated = onDocumentUpdated('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const oldData = event.data.before.data()
  const newData = event.data.after.data()

  try {
    // Only process if the expense is no longer in processing state
    if (oldData.isProcessing && !newData.isProcessing) {
      const tripMembers = await getTripMembers(tripId)
      const memberSpending = calculateMemberSpending(newData, tripMembers)

      // Consolidate all updates into a single transaction
      await updateTripAndMembers(tripId, {
        totalExpenses: newData.grandTotal,
        enabledTotalExpenses: newData.enabled ? newData.grandTotal : 0,
        disabledTotalExpenses: newData.enabled ? 0 : newData.grandTotal,
        expenseCount: 1,
      }, memberSpending)
    }
    // Handle amount changes and enabled state changes for non-processing expenses
    else if (!oldData.isProcessing && !newData.isProcessing) {
      const amountChange = newData.grandTotal - oldData.grandTotal
      const enabledStateChanged = oldData.enabled !== newData.enabled
      const itemsChanged = JSON.stringify(oldData.items) !== JSON.stringify(newData.items)

      if (amountChange !== 0 || enabledStateChanged || itemsChanged) {
        const tripMembers = await getTripMembers(tripId)

        // Calculate the difference in member spending
        const oldMemberSpending = calculateMemberSpending(oldData, tripMembers)
        const newMemberSpending = calculateMemberSpending(newData, tripMembers)

        const memberSpendingChanges = {}
        tripMembers.forEach((member) => {
          const oldSpending = oldData.enabled ? oldMemberSpending[member.id] : 0
          const newSpending = newData.enabled ? newMemberSpending[member.id] : 0
          memberSpendingChanges[member.id] = newSpending - oldSpending
        })

        // Calculate trip total changes
        const tripUpdates = {}

        // Handle enabled state changes
        if (enabledStateChanged) {
          if (oldData.enabled) {
            tripUpdates.enabledTotalExpenses = -oldData.grandTotal
            tripUpdates.disabledTotalExpenses = oldData.grandTotal
          }
          else {
            tripUpdates.enabledTotalExpenses = oldData.grandTotal
            tripUpdates.disabledTotalExpenses = -oldData.grandTotal
          }
        }

        // Handle amount changes
        if (amountChange !== 0) {
          tripUpdates.totalExpenses = amountChange
          if (newData.enabled) {
            tripUpdates.enabledTotalExpenses = (tripUpdates.enabledTotalExpenses || 0) + amountChange
          }
          else {
            tripUpdates.disabledTotalExpenses = (tripUpdates.disabledTotalExpenses || 0) + amountChange
          }
        }

        // Consolidate all updates into a single transaction
        await updateTripAndMembers(tripId, tripUpdates, memberSpendingChanges)
      }
    }
  }
  catch (error) {
    logger.error(`Error processing expense update: ${error}`)
  }
})

// Trigger on expense deletion
exports.onExpenseDeleted = onDocumentDeleted('trips/{tripId}/expenses/{expenseId}', async (event) => {
  const { tripId } = event.params
  const expenseData = event.data.data()

  // Only subtract if the expense was not in processing state
  if (!expenseData.isProcessing) {
    try {
      const tripMembers = await getTripMembers(tripId)
      const memberSpending = calculateMemberSpending(expenseData, tripMembers)

      // Negate the spending amounts for deletion
      const negativeMemberSpending = {}
      Object.keys(memberSpending).forEach((memberId) => {
        negativeMemberSpending[memberId] = -memberSpending[memberId]
      })

      // Consolidate all updates into a single transaction
      await updateTripAndMembers(tripId, {
        totalExpenses: -expenseData.grandTotal,
        enabledTotalExpenses: expenseData.enabled ? -expenseData.grandTotal : 0,
        disabledTotalExpenses: expenseData.enabled ? 0 : -expenseData.grandTotal,
        expenseCount: -1,
      }, negativeMemberSpending)
    }
    catch (error) {
      logger.error(`Error processing expense deletion: ${error}`)
    }
  }
})
