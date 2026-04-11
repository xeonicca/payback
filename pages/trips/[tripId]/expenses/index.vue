<script setup lang="ts">
import type { FieldValue } from 'firebase/firestore'
import type { Trip } from '@/types'
import { doc, Timestamp } from 'firebase/firestore'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const db = useFirestore()
const { tripId } = useRoute().params
const showHiddenExpenses = ref(false)
const searchTerm = ref('')
const sortBy = ref<'time' | 'total' | 'uploaded'>('time')
const sortOrder = ref<'asc' | 'desc'>('desc')
const router = useRouter()

function toggleSort(type: 'time' | 'total' | 'uploaded') {
  if (sortBy.value === type) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  }
  else {
    sortBy.value = type
    sortOrder.value = 'desc'
  }
}

const sortOptions = [
  { key: 'time' as const, label: '購買時間' },
  { key: 'total' as const, label: '金額' },
  { key: 'uploaded' as const, label: '上傳時間' },
]

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const { showHomeCurrency, primaryCurrency, secondaryCurrency } = useCurrencyToggle(tripId as string, trip)
const { tripExpenses, enabledExpenses } = useTripExpenses(tripId as string)
const { tripMembers } = useTripMembers(tripId as string)

const displayedExpenses = computed(() => {
  let expenses = showHiddenExpenses.value ? tripExpenses.value : enabledExpenses.value

  // Apply search filter
  if (searchTerm.value) {
    const search = searchTerm.value.trim()
    expenses = expenses.filter((expense) => {
      const gtMatch = search.match(/^>\s*(\d+(?:\.\d*)?)$/)
      const ltMatch = search.match(/^<\s*(\d+(?:\.\d*)?)$/)

      if (gtMatch) {
        const threshold = Number.parseFloat(gtMatch[1])
        return expense.grandTotal > threshold
      }
      else if (ltMatch) {
        const threshold = Number.parseFloat(ltMatch[1])
        return expense.grandTotal < threshold
      }
      else {
        const searchLower = search.toLowerCase()
        const matchesDescription = expense.description.toLowerCase().includes(searchLower)
        const matchesAmount = expense.grandTotal.toString().includes(searchLower)
        return matchesDescription || matchesAmount
      }
    })
  }

  // Apply sorting
  expenses = [...expenses].sort((a, b) => {
    let comparison = 0
    const getTimeMillis = (timestamp: Timestamp | FieldValue | undefined) => {
      return timestamp instanceof Timestamp ? timestamp.toMillis() : 0
    }

    if (sortBy.value === 'total') {
      comparison = a.grandTotal - b.grandTotal
    }
    else if (sortBy.value === 'uploaded') {
      const aTime = getTimeMillis(a.createdAt) || 0
      const bTime = getTimeMillis(b.createdAt) || 0
      comparison = aTime - bTime
    }
    else {
      const aTime = getTimeMillis(a.paidAt) || getTimeMillis(a.createdAt) || 0
      const bTime = getTimeMillis(b.paidAt) || getTimeMillis(b.createdAt) || 0
      comparison = aTime - bTime
    }

    return sortOrder.value === 'desc' ? -comparison : comparison
  })

  return expenses
})
</script>

<template>
  <!-- Sticky Header -->
  <div class="sticky z-10 bg-slate-200 dark:bg-background -mx-6 px-6 pb-3 space-y-2" style="top: var(--navbar-height, 0px)">
    <!-- Search -->
    <div class="flex items-center gap-2 max-w-3xl mx-auto">
      <div class="relative flex-1">
        <Icon name="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <ui-input
          v-model="searchTerm"
          type="text"
          placeholder="搜尋描述、金額..."
          class="pl-10 pr-10 w-full h-9"
        />
        <button
          v-if="searchTerm"
          type="button"
          aria-label="清除搜尋"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          @click="searchTerm = ''"
        >
          <Icon name="lucide:x" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Row 2: Sort pills -->
    <div class="flex items-center gap-1.5 max-w-3xl mx-auto">
      <button
        v-for="option in sortOptions"
        :key="option.key"
        type="button"
        :aria-pressed="sortBy === option.key"
        class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
        :class="sortBy === option.key
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground'"
        @click="toggleSort(option.key)"
      >
        {{ option.label }}
        <Icon
          v-if="sortBy === option.key"
          :name="sortOrder === 'desc' ? 'lucide:arrow-down' : 'lucide:arrow-up'"
          :size="12"
        />
      </button>
    </div>
  </div>

  <div v-if="tripExpenses.length" class="space-y-3 bg-card rounded-xl border p-4 max-w-3xl mx-auto">
    <div class="flex justify-between items-center">
      <div class="text-sm text-muted-foreground">
        {{ tripExpenses.length }} 筆支出
      </div>
      <div class="flex items-center gap-2">
        <ui-label for="show-hidden" class="text-xs">
          顯示隱藏
        </ui-label>
        <ui-switch id="show-hidden" :model-value="showHiddenExpenses" @update:model-value="showHiddenExpenses = !showHiddenExpenses" />
      </div>
    </div>

    <!-- Expense List -->
    <div v-if="displayedExpenses.length > 0" class="divide-y divide-border">
      <expense-item
        v-for="expense in displayedExpenses"
        :key="expense.id"
        :expense="expense"
        :trip-members="tripMembers"
        :trip="trip!"
        :show-home-currency="showHomeCurrency"
        :primary-currency="primaryCurrency"
        :secondary-currency="secondaryCurrency"
      />
    </div>

    <!-- Empty search state -->
    <empty-state
      v-else
      icon="lucide:search"
      title="找不到符合的支出"
      description="試試調整搜尋條件"
    />
  </div>

  <!-- Empty State: No Expenses -->
  <empty-state
    v-else
    icon="lucide:receipt"
    title="尚無支出記錄"
    description="回到行程頁面新增第一筆支出"
  >
    <ui-button
      variant="default"
      size="sm"
      @click="router.push(`/trips/${tripId}`)"
    >
      <Icon name="lucide:arrow-left" :size="16" class="mr-1" />
      回到行程
    </ui-button>
  </empty-state>
</template>
