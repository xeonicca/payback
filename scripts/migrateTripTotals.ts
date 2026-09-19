import { initializeApp } from 'firebase/app'
import { collection, doc, getDocs, getFirestore, query, updateDoc, where } from 'firebase/firestore'
import { firebaseConfig } from '../firebase.config'

// Initialize Firebase
const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

async function recalculateTripTotals() {
  try {
    // Get all trips
    const tripsSnapshot = await getDocs(collection(db, 'trips'))

    for (const tripDoc of tripsSnapshot.docs) {
      const tripId = tripDoc.id
      console.log(`Processing trip: ${tripId}`)

      // Get all expenses for this trip
      const expensesSnapshot = await getDocs(collection(db, 'trips', tripId, 'expenses'))

      let totalExpenses = 0
      let enabledTotalExpenses = 0
      let disabledTotalExpenses = 0
      let expenseCount = 0

      // Calculate totals
      expensesSnapshot.forEach((expenseDoc) => {
        const expense = expenseDoc.data()
        if (!expense.isProcessing) {
          const amount = expense.grandTotal || 0
          totalExpenses += amount

          if (expense.enabled) {
            enabledTotalExpenses += amount
          }
          else {
            disabledTotalExpenses += amount
          }

          expenseCount++
        }
      })

      // Update trip document
      await updateDoc(doc(db, 'trips', tripId), {
        totalExpenses,
        enabledTotalExpenses,
        disabledTotalExpenses,
        expenseCount,
        updatedAt: new Date(),
      })

      console.log(`Updated trip ${tripId}:`, {
        totalExpenses,
        enabledTotalExpenses,
        disabledTotalExpenses,
        expenseCount,
      })
    }

    console.log('Migration completed successfully!')
  }
  catch (error) {
    console.error('Error during migration:', error)
  }
}

// Run the migration
recalculateTripTotals()
