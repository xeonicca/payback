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
const expenseMembers = computed(() => (expense: Expense) => tripMembers.value?.filter(member => expense.sharedWithMemberIds.includes(member.id)))

</script>

<template>
  <div v-if="tripExpenses.length" class="space-y-2 bg-white rounded-sm p-4">
    <div class="text-sm text-gray-500 min-w-[100px]">
      購買明細 ({{ tripExpenses.length }} 筆)
    </div>
    <ui-table class="table-auto">
      <!-- <ui-table-caption>購買項目</ui-table-caption> -->
      <ui-table-header>
        <ui-table-row>
          <ui-table-head>名稱</ui-table-head>
          <ui-table-head class="text-right">價格</ui-table-head>
        </ui-table-row>
      </ui-table-header>
      <ui-table-body>
        <ui-table-row v-for="expense in tripExpenses" :key="expense.id">
          <ui-table-cell class="font-medium whitespace-break-spaces text-sm flex flex-col gap-2">
            <nuxt-link :to="`/trips/${tripId}/expenses/${expense.id}`">
              {{ expense.description }}
            </nuxt-link>
            
            <div class="flex items-center gap-1">
              <span v-for="member in expenseMembers(expense)" :key="member.id">
                {{ member.avatarEmoji }}
              </span>
            </div>

            <p class="text-xs text-gray-500">{{ expense.paidAtString }}</p>
          </ui-table-cell>
          <ui-table-cell class="text-right font-mono w-[100px] text-green-600">
            <nuxt-link :to="`/trips/${tripId}/expenses/${expense.id}`">
              {{ trip?.tripCurrency }} {{ expense.grandTotal }}
            </nuxt-link>
          </ui-table-cell>
        </ui-table-row>
      </ui-table-body>
    </ui-table>
  </div>
</template>
