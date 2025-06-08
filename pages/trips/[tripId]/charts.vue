<script setup lang="ts">
import type { Expense } from '@/types'
import { VisStackedBar, VisXYContainer } from '@unovis/vue'
import { usePendingPromises } from 'vuefire'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params
const { tripExpenses } = useTripExpenses(tripId as string)
await usePendingPromises()

interface ChartDataPoint {
  date: string
  total: number
}

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

  // Convert to array format required by Unovis
  return Object.entries(groupedExpenses).map(([date, total]) => ({
    x: date,
    y: total,
  }))
})

// Accessor functions for Unovis
const x = (d: ChartDataPoint) => d.date
const y = (d: ChartDataPoint) => d.total
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold text-indigo-700 mb-4">
      支出統計
    </h1>
    <div class="bg-white rounded-lg p-4">
      <div class="h-[400px]">
        <vis-x-y-container :data="chartData">
          <vis-stacked-bar :x="x" :y="y" />
        </vis-x-y-container>
      </div>
    </div>
  </div>
</template>
