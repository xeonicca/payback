<script setup lang="ts">
import type { Expense } from '@/types'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params
const { tripExpenses } = useTripExpenses(tripId as string)

const chartData = computed(() => {
  // Group expenses by date and calculate total for each date
  const groupedExpenses = tripExpenses.value.reduce((acc, expense) => {
    const date = expense.paidAtString.split(' ')[0] // Get just the date part
    if (!acc[date]) {
      acc[date] = 0
    }
    acc[date] += expense.grandTotal
    return acc
  }, {} as Record<string, number>)

  // Convert to array format required by ChartBar
  return Object.entries(groupedExpenses).map(([date, total]) => ({
    date,
    total,
  }))
})
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold text-indigo-700 mb-4">
      支出統計
    </h1>
    <div class="bg-white rounded-lg p-4">
      under construction
      <!-- <ui-bar-chart
        :data="chartData"
        :categories="['total']"
        index="date"
        :colors="['#4f46e5']"
        :show-x-axis="true"
        :show-y-axis="true"
        :show-tooltip="true"
        :show-legend="false"
        :show-grid-line="true"
        :rounded-corners="4"
      /> -->
    </div>
  </div>
</template>
