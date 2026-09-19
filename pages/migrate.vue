<script setup lang="ts">
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import { useFirestore } from 'vuefire'

const db = useFirestore()
const isRunning = ref(false)
const logs = ref<string[]>([])

async function recalculateTripTotals() {
  if (isRunning.value)
    return

  isRunning.value = true
  logs.value = []

  try {
    // Get all trips
    const tripsSnapshot = await getDocs(collection(db, 'trips'))

    for (const tripDoc of tripsSnapshot.docs) {
      const tripId = tripDoc.id
      logs.value.push(`Processing trip: ${tripId}`)

      // Get all expenses for this trip
      const expensesSnapshot = await getDocs(collection(db, 'trips', tripId, 'expenses'))

      let processedCount = 0

      // Trigger cloud function recalculation by updating each expense
      for (const expenseDoc of expensesSnapshot.docs) {
        const expense = expenseDoc.data()

        // Only process non-processing expenses
        if (!expense.isProcessing) {
          // Trigger cloud function by setting isProcessing to true, then back to false
          // This will cause the cloud function to recalculate everything
          await updateDoc(doc(db, 'trips', tripId, 'expenses', expenseDoc.id), {
            isProcessing: true,
          })

          // Small delay to ensure the first update is processed
          await new Promise(resolve => setTimeout(resolve, 100))

          await updateDoc(doc(db, 'trips', tripId, 'expenses', expenseDoc.id), {
            isProcessing: false,
          })

          processedCount++
        }
      }

      logs.value.push(`Triggered recalculation for ${processedCount} expenses in trip ${tripId}`)
    }

    logs.value.push('Migration completed successfully! Cloud functions will recalculate all totals.')
  }
  catch (error) {
    console.error('Error during migration:', error)
    logs.value.push(`Error: ${error}`)
  }
  finally {
    isRunning.value = false
  }
}
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold mb-4">
      Trip Totals & Member Spending Migration
    </h1>

    <p class="mb-4 text-gray-600">
      This will trigger the cloud functions to recalculate all trip totals and member spending using the updated logic.
    </p>

    <ui-button
      :disabled="isRunning"
      @click="recalculateTripTotals"
    >
      {{ isRunning ? 'Running...' : 'Start Migration' }}
    </ui-button>

    <div class="mt-4 space-y-2">
      <div v-for="(log, index) in logs" :key="index" class="text-sm">
        {{ log }}
      </div>
    </div>
  </div>
</template>
