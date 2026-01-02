<script setup lang="ts">
import type { Expense } from '@/types'
import { Chart, registerables } from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { onMounted, ref } from 'vue'
import { usePendingPromises } from 'vuefire'

Chart.register(...registerables, ChartDataLabels)

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params
const { tripExpenses } = useTripExpenses(tripId as string)
await usePendingPromises()

interface ChartDataPoint {
  x: string
  y: number
}

const chartData = computed<ChartDataPoint[]>(() => {
  // Group expenses by date and calculate total for each date
  const groupedExpenses = tripExpenses.value.reduce((acc, expense) => {
    const date = expense.paidAtString.split(' ')[0].replace(/,/g, '') // Remove any commas
    if (!acc[date]) {
      acc[date] = 0
    }
    acc[date] += expense.grandTotal
    return acc
  }, {} as Record<string, number>)

  // Convert to array format and round to 2 decimal places
  return Object.entries(groupedExpenses).sort((a, b) => a[0].localeCompare(b[0])).map(([date, total]) => ({
    x: date,
    y: Number.parseFloat(total.toFixed(2)),
  }))
})

const chartRef = ref<HTMLCanvasElement | null>(null)
const chartInstance = ref<Chart | null>(null)

onMounted(() => {
  if (chartRef.value) {
    const ctx = chartRef.value.getContext('2d')
    if (ctx) {
      chartInstance.value = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartData.value.map(point => point.x),
          datasets: [{
            label: 'Daily Expenses',
            data: chartData.value.map(point => point.y),
            backgroundColor: 'rgba(79, 70, 229, 0.5)', // indigo-600 with opacity
            borderColor: 'rgb(79, 70, 229)', // indigo-600
            borderWidth: 1,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            datalabels: {
              color: '#333',
              anchor: 'center',
              align: 'center',
              formatter: (value) => {
                const num = Number(value)
                if (num >= 1000) {
                  return `${(num / 1000).toFixed(1)}k`
                }
                return num.toFixed(2)
              },
              font: {
                weight: 'bold',
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: '日期',
              },
            },
            x: {
              title: {
                display: true,
                text: '支出',
              },
              ticks: {
                callback: (value) => {
                  const num = Number(value)
                  if (num >= 1000) {
                    return `${(num / 1000).toFixed(1)}k`
                  }
                  return num.toFixed(2)
                },
              },
            },
          },
        },
      })
    }
  }
})
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold text-indigo-700 mb-4">
      支出統計
    </h1>
    <div class="bg-white rounded-lg p-4">
      <div class="min-h-[60vh]">
        <canvas ref="chartRef" />
      </div>
    </div>
  </div>
</template>
