<script setup lang="ts">
import type { Expense } from '@/types'
import { Timestamp } from 'firebase/firestore'
import { coerceCategory, getCategoryMeta } from '@/utils/categories'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params
const { trip } = useTrip(tripId as string)
const { tripExpenses, enabledExpenses } = useTripExpenses(tripId as string)
const { tripMembers } = useTripMembers(tripId as string)
const { getMemberPaidAmount, getMemberOwedAmount, getMemberBalance } = useTripBalances(tripId as string)
const { primaryCurrency, toPrimary } = useCurrencyToggle(tripId as string, trip)

// ── Daily spending data ──
const dailySpending = computed(() => {
  const grouped: Record<string, number> = {}
  for (const expense of enabledExpenses.value) {
    const { year, month, day } = expense.paidAtObject
    // Zero-pad month and day so lexicographic sort is chronologically correct
    const key = `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`
    grouped[key] = (grouped[key] || 0) + expense.grandTotal
  }
  return Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, total]) => {
      const [, m, d] = key.split('/')
      return { date: `${Number(m)}/${Number(d)}`, total: Math.round(total * 100) / 100 }
    })
})

const maxDailySpend = computed(() => Math.max(...dailySpending.value.map(d => d.total), 1))

// ── Member spending breakdown ──
const memberSpending = computed(() => {
  return tripMembers.value
    .map(member => ({
      id: member.id,
      name: member.name,
      emoji: member.avatarEmoji,
      paid: getMemberPaidAmount(member.id),
      owed: getMemberOwedAmount(member.id),
      balance: getMemberBalance(member.id),
    }))
    .sort((a, b) => b.paid - a.paid)
})

const maxMemberPaid = computed(() => Math.max(...memberSpending.value.map(m => m.paid), 1))

// ── Category distribution ──
const categorySpending = computed(() => {
  const grouped: Record<string, number> = {}
  for (const expense of enabledExpenses.value) {
    const key = coerceCategory(expense.category)
    grouped[key] = (grouped[key] || 0) + expense.grandTotal
  }
  const total = Object.values(grouped).reduce((sum, n) => sum + n, 0) || 1
  return Object.entries(grouped)
    .map(([key, amount]) => {
      const meta = getCategoryMeta(key)
      return {
        key,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        amount,
        percent: (amount / total) * 100,
      }
    })
    .sort((a, b) => b.amount - a.amount)
})

// Build the conic-gradient stops for the doughnut from cumulative percentages.
const categoryPieGradient = computed(() => {
  let cursor = 0
  const stops = categorySpending.value.map((c) => {
    const start = cursor
    cursor += c.percent
    return `${c.color} ${start}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(', ')})`
})

const topCategory = computed(() => categorySpending.value[0])

// ── Summary stats ──
const totalExpenses = computed(() => enabledExpenses.value.reduce((sum, e) => sum + e.grandTotal, 0))
const avgPerDay = computed(() => dailySpending.value.length > 0 ? totalExpenses.value / dailySpending.value.length : 0)
const avgPerExpense = computed(() => enabledExpenses.value.length > 0 ? totalExpenses.value / enabledExpenses.value.length : 0)
const topDay = computed(() => dailySpending.value.reduce((max, d) => d.total > max.total ? d : max, { date: '-', total: 0 }))

function formatAmount(n: number) {
  const converted = toPrimary(n)
  if (converted >= 10000) return `${(converted / 1000).toFixed(0)}k`
  if (converted >= 1000) return `${(converted / 1000).toFixed(1)}k`
  return converted.toFixed(0)
}
</script>

<template>
  <div v-if="enabledExpenses.length === 0" class="pt-8">
    <empty-state
      icon="lucide:bar-chart-3"
      title="尚無資料"
      description="新增支出後即可查看統計"
    />
  </div>

  <div v-else class="space-y-6 pb-8">
    <!-- Summary row -->
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-card border rounded-xl p-4">
        <p class="text-xs text-muted-foreground m-0">總支出</p>
        <p class="text-lg font-bold font-mono text-foreground m-0 mt-1">
          {{ primaryCurrency }} {{ formatAmount(totalExpenses) }}
        </p>
        <p class="text-xs text-muted-foreground m-0 mt-0.5">
          {{ enabledExpenses.length }} 筆
        </p>
      </div>
      <div class="bg-card border rounded-xl p-4">
        <p class="text-xs text-muted-foreground m-0">日均支出</p>
        <p class="text-lg font-bold font-mono text-foreground m-0 mt-1">
          {{ primaryCurrency }} {{ formatAmount(avgPerDay) }}
        </p>
        <p class="text-xs text-muted-foreground m-0 mt-0.5">
          單筆均 {{ formatAmount(avgPerExpense) }}
        </p>
      </div>
    </div>

    <!-- Daily spending bar chart (pure CSS) -->
    <section class="bg-card border rounded-xl p-4">
      <h2 class="text-sm font-semibold text-foreground m-0 mb-4">每日支出</h2>
      <div class="space-y-2">
        <div
          v-for="day in dailySpending"
          :key="day.date"
          class="flex items-center gap-3"
        >
          <span class="text-xs text-muted-foreground font-mono w-12 shrink-0 text-right">{{ day.date }}</span>
          <div class="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
            <div
              class="h-full bg-primary rounded-sm transition-all duration-300"
              :style="{ width: `${(day.total / maxDailySpend) * 100}%` }"
            />
          </div>
          <span class="text-xs font-mono font-semibold text-foreground w-16 shrink-0 text-right">
            {{ formatAmount(day.total) }}
          </span>
        </div>
      </div>
      <div v-if="topDay.total > 0" class="mt-3 pt-3 border-t border-border">
        <p class="text-xs text-muted-foreground m-0">
          花費最多的一天是 <span class="font-semibold text-foreground">{{ topDay.date }}</span>，共 {{ primaryCurrency }} {{ formatAmount(topDay.total) }}
        </p>
      </div>
    </section>

    <!-- Member breakdown -->
    <section class="bg-card border rounded-xl p-4">
      <h2 class="text-sm font-semibold text-foreground m-0 mb-4">成員支出</h2>
      <div class="space-y-3">
        <div
          v-for="member in memberSpending"
          :key="member.id"
          class="space-y-1.5"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-lg">{{ member.emoji }}</span>
              <span class="text-sm font-medium text-foreground">{{ member.name }}</span>
            </div>
            <div class="text-right">
              <span class="text-sm font-mono font-semibold text-foreground">{{ formatAmount(member.paid) }}</span>
              <span
                class="text-xs font-mono ml-2"
                :class="{
                  'text-green-600 dark:text-green-400': member.balance > 0.01,
                  'text-red-600 dark:text-red-400': member.balance < -0.01,
                  'text-muted-foreground': Math.abs(member.balance) <= 0.01,
                }"
              >
                {{ member.balance > 0.01 ? '+' : '' }}{{ formatAmount(member.balance) }}
              </span>
            </div>
          </div>
          <div class="h-2 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full bg-primary/70 rounded-full transition-all duration-300"
              :style="{ width: `${(member.paid / maxMemberPaid) * 100}%` }"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Spending by category doughnut (pure CSS) -->
    <section class="bg-card border rounded-xl p-4">
      <h2 class="text-sm font-semibold text-foreground m-0 mb-4">消費分類</h2>
      <div class="flex items-center gap-5">
        <!-- Doughnut -->
        <div class="relative shrink-0" style="width: 7rem; height: 7rem;">
          <div
            class="w-full h-full rounded-full"
            :style="{ background: categoryPieGradient }"
          />
          <div class="absolute inset-[22%] rounded-full bg-card flex flex-col items-center justify-center">
            <span class="text-[10px] text-muted-foreground leading-none">總計</span>
            <span class="text-xs font-mono font-semibold text-foreground leading-tight mt-0.5">
              {{ formatAmount(totalExpenses) }}
            </span>
          </div>
        </div>

        <!-- Legend -->
        <div class="flex-1 min-w-0 space-y-2">
          <div
            v-for="cat in categorySpending"
            :key="cat.key"
            class="flex items-center gap-2"
          >
            <span class="size-2.5 rounded-full shrink-0" :style="{ backgroundColor: cat.color }" />
            <Icon :name="cat.icon" class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span class="text-xs text-foreground truncate">{{ cat.label }}</span>
            <span class="ml-auto text-xs font-mono text-muted-foreground shrink-0">{{ cat.percent.toFixed(0) }}%</span>
            <span class="text-xs font-mono font-semibold text-foreground w-14 shrink-0 text-right">
              {{ formatAmount(cat.amount) }}
            </span>
          </div>
        </div>
      </div>
      <div v-if="topCategory" class="mt-3 pt-3 border-t border-border">
        <p class="text-xs text-muted-foreground m-0">
          花費最多的分類是 <span class="font-semibold text-foreground">{{ topCategory.label }}</span>，占 {{ topCategory.percent.toFixed(0) }}%
        </p>
      </div>
    </section>
  </div>
</template>
