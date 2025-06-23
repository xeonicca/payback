<script setup lang="ts">
import type { Trip } from '@/types'
import { doc } from 'firebase/firestore'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

definePageMeta({
  middleware: ['auth'],
})

const db = useFirestore()
const { tripId } = useRoute().params
const showHiddenExpenses = ref(false)
const router = useRouter()

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const { tripExpenses, enabledExpenses } = useTripExpenses(tripId as string)
const { tripMembers } = useTripMembers(tripId as string)

const displayedExpenses = computed(() => {
  if (showHiddenExpenses.value) {
    return tripExpenses.value
  }
  return enabledExpenses.value
})
</script>

<template>
  <ui-button
    class="text-gray-500 flex items-center gap-1 mb-2 px-0"
    variant="link"
    size="sm"
    @click="router.push(`/trips/${tripId}`)"
  >
    <icon name="lucide:arrow-left" size="16" /> 回到旅程
  </ui-button>
  <div v-if="tripExpenses.length" class="space-y-2 bg-white rounded-sm p-4">
    <div class="flex justify-between items-center">
      <div class="text-sm text-gray-500 min-w-[100px]">
        購買明細 ({{ tripExpenses.length }} 筆)
      </div>
      <div class="flex items-center gap-2">
        <ui-label for="enabled">
          顯示隱藏支出
        </ui-label>
        <ui-switch id="enabled" :model-value="showHiddenExpenses" @update:model-value="showHiddenExpenses = !showHiddenExpenses" />
      </div>
    </div>

    <div>
      <template v-for="expense in displayedExpenses" :key="expense.id">
        <expense-item :expense="expense" :trip-members="tripMembers" :trip="trip!" />
        <ui-separator />
      </template>
    </div>
  </div>
</template>
