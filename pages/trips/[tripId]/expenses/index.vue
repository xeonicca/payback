<script setup lang="ts">
import type { Expense, Trip } from '@/types'
import { doc } from 'firebase/firestore'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

definePageMeta({
  layout: 'default-with-bottom-bar',
})

const db = useFirestore()
const { tripId } = useRoute().params

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const { tripExpenses } = useTripExpenses(tripId as string)
const { tripMembers } = useTripMembers(tripId as string)
</script>

<template>
  <div v-if="tripExpenses.length" class="space-y-2 bg-white rounded-sm p-4">
    <div class="text-sm text-gray-500 min-w-[100px]">
      購買明細 ({{ tripExpenses.length }} 筆)
    </div>
    <div>
      <template v-for="expense in tripExpenses" :key="expense.id">
        <expense-item :expense="expense" :trip-members="tripMembers" :trip="trip!" />
        <ui-separator />
      </template>
    </div>
  </div>
</template>
