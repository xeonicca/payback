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
const searchTerm = ref('')
const sortBy = ref<'time' | 'total'>('time')
const sortOrder = ref<'asc' | 'desc'>('desc')
const router = useRouter()

function toggleSort(type: 'time' | 'total') {
  if (sortBy.value === type) {
    // Toggle order if clicking the same sort option
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  }
  else {
    // Switch to new sort option with default descending order
    sortBy.value = type
    sortOrder.value = 'desc'
  }
}

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const { tripExpenses, enabledExpenses } = useTripExpenses(tripId as string)
const { tripMembers } = useTripMembers(tripId as string)

const displayedExpenses = computed(() => {
  let expenses = showHiddenExpenses.value ? tripExpenses.value : enabledExpenses.value

  // Apply search filter
  if (searchTerm.value) {
    const search = searchTerm.value.trim()
    expenses = expenses.filter((expense) => {
      // Check for amount conditions (>, <)
      const gtMatch = search.match(/^>\s*(\d+(?:\.\d*)?)$/)
      const ltMatch = search.match(/^<\s*(\d+(?:\.\d*)?)$/)

      if (gtMatch) {
        // Greater than condition
        const threshold = Number.parseFloat(gtMatch[1])
        return expense.grandTotal > threshold
      }
      else if (ltMatch) {
        // Less than condition
        const threshold = Number.parseFloat(ltMatch[1])
        return expense.grandTotal < threshold
      }
      else {
        // Regular search by description or amount
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

    if (sortBy.value === 'total') {
      comparison = a.grandTotal - b.grandTotal
    }
    else {
      // Sort by time (paidAt, then createdAt)
      const aTime = a.paidAt?.toMillis() || a.createdAt?.toMillis() || 0
      const bTime = b.paidAt?.toMillis() || b.createdAt?.toMillis() || 0
      comparison = aTime - bTime
    }

    return sortOrder.value === 'desc' ? -comparison : comparison
  })

  return expenses
})

// Helper function to calculate how much a member has paid (sum of expenses they paid for)
function getMemberPaidAmount(memberId: string) {
  if (!enabledExpenses.value)
    return 0

  return enabledExpenses.value
    .filter(expense => expense.paidByMemberId === memberId)
    .reduce((total, expense) => total + expense.grandTotal, 0)
}

// Helper function to calculate how much a member owes (considering item-level sharing)
function getMemberOwedAmount(memberId: string) {
  if (!enabledExpenses.value)
    return 0

  let totalOwed = 0

  enabledExpenses.value.forEach((expense) => {
    // If expense has items, calculate based on item-level sharing
    if (expense.items && expense.items.length > 0) {
      expense.items.forEach((item) => {
        let sharingMembers: string[] = []

        // If item has no specific sharedByMemberIds, all expense members share it
        if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
          sharingMembers = expense.sharedWithMemberIds
        }
        else {
          // Only include members who are both in item sharing AND main expense sharing
          sharingMembers = item.sharedByMemberIds.filter(memberId =>
            expense.sharedWithMemberIds.includes(memberId),
          )
        }

        // Skip if no members are sharing this item or if this member isn't sharing
        if (sharingMembers.length === 0 || !sharingMembers.includes(memberId)) {
          return
        }

        // Calculate this member's share of this item
        const itemTotal = item.price * (item.quantity || 1)
        const sharePerMember = itemTotal / sharingMembers.length
        totalOwed += sharePerMember
      })
    }
    else {
      // If no items, use expense-level sharing
      if (expense.sharedWithMemberIds.includes(memberId)) {
        const sharePerMember = expense.grandTotal / expense.sharedWithMemberIds.length
        totalOwed += sharePerMember
      }
    }
  })

  return totalOwed
}

// Helper function to calculate member balance (paid - owed)
function getMemberBalance(memberId: string) {
  const paid = getMemberPaidAmount(memberId)
  const owed = getMemberOwedAmount(memberId)

  return paid - owed
}

// Helper function to calculate debt amount between two members
function getDebtAmount(member1Id: string, member2Id: string) {
  const member1Balance = getMemberBalance(member1Id)
  const member2Balance = getMemberBalance(member2Id)

  // If member1 has positive balance and member2 has negative balance,
  // member1 is owed money by member2
  if (member1Balance > 0 && member2Balance < 0) {
    return Math.min(member1Balance, Math.abs(member2Balance))
  }

  // If member1 has negative balance and member2 has positive balance,
  // member1 owes money to member2
  if (member1Balance < 0 && member2Balance > 0) {
    return -Math.min(Math.abs(member1Balance), member2Balance)
  }

  return 0
}
</script>

<template>
  <!-- Sticky Header with Back Button, Search, and Sort -->
  <div class="sticky top-0 z-10 bg-slate-200 -mx-6 px-6 pt-2 pb-2 space-y-2">
    <!-- Row 1: Back Button and Search -->
    <div class="flex items-center gap-2">
      <ui-button
        class="text-gray-500 flex items-center gap-1 px-0 flex-shrink-0"
        variant="link"
        size="sm"
        @click="router.push(`/trips/${tripId}`)"
      >
        <icon name="lucide:arrow-left" size="16" /> 回到旅程
      </ui-button>

      <div class="relative flex-1">
        <Icon name="lucide-search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <ui-input
          v-model="searchTerm"
          type="text"
          placeholder="搜尋描述、金額..."
          class="pl-10 pr-10 w-full h-9"
        />
        <button
          v-if="searchTerm"
          type="button"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          @click="searchTerm = ''"
        >
          <Icon name="lucide-x" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Row 2: Sort Options -->
    <div class="flex items-center gap-3 text-xs">
      <span class="text-gray-600">排序</span>
      <button
        type="button"
        class="flex items-center gap-1 transition-colors" :class="[
          sortBy === 'time' ? 'text-indigo-700 font-semibold' : 'text-gray-600 hover:text-gray-900',
        ]"
        @click="toggleSort('time')"
      >
        <span>購買時間</span>
        <Icon
          v-if="sortBy === 'time'"
          :name="sortOrder === 'desc' ? 'lucide-arrow-down' : 'lucide-arrow-up'"
          class="w-3 h-3"
        />
      </button>
      <span class="text-gray-300">|</span>
      <button
        type="button"
        class="flex items-center gap-1 transition-colors" :class="[
          sortBy === 'total' ? 'text-indigo-700 font-semibold' : 'text-gray-600 hover:text-gray-900',
        ]"
        @click="toggleSort('total')"
      >
        <span>金額大小</span>
        <Icon
          v-if="sortBy === 'total'"
          :name="sortOrder === 'desc' ? 'lucide-arrow-down' : 'lucide-arrow-up'"
          class="w-3 h-3"
        />
      </button>
    </div>
  </div>

  <div v-if="tripExpenses.length" class="space-y-3 bg-white rounded-sm p-4">
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

    <!-- Expense List -->
    <div v-if="displayedExpenses.length > 0">
      <template v-for="expense in displayedExpenses" :key="expense.id">
        <expense-item :expense="expense" :trip-members="tripMembers" :trip="trip!" />
        <ui-separator />
      </template>
    </div>

    <!-- Empty State -->
    <div v-else class="flex flex-col items-center justify-center py-12 text-center">
      <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3">
        <Icon name="lucide-search" class="w-6 h-6 text-gray-400" />
      </div>
      <p class="text-sm text-gray-600 font-medium mb-1">
        找不到符合的支出
      </p>
      <p class="text-xs text-gray-500">
        試試調整搜尋條件
      </p>
    </div>
  </div>

  <!-- Empty State: No Expenses -->
  <div v-else class="flex flex-col items-center justify-center py-20 text-center">
    <div class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
      <Icon name="lucide-receipt" class="w-10 h-10 text-gray-400" />
    </div>
    <h3 class="text-lg font-semibold text-gray-900 mb-2">
      尚無支出記錄
    </h3>
    <p class="text-sm text-gray-600 mb-6 max-w-xs">
      還沒有任何購買明細。開始記錄您的旅程支出吧！
    </p>
    <ui-button
      variant="default"
      size="sm"
      @click="router.push(`/trips/${tripId}`)"
    >
      <Icon name="lucide-arrow-left" class="w-4 h-4 mr-1" />
      回到旅程頁面
    </ui-button>
  </div>

  <!-- Debt Relationship Section -->
  <div v-if="enabledExpenses.length > 0" class="mt-4 space-y-3">
    <h2 class="text-xl font-bold text-indigo-700 px-2">
      債務關係
    </h2>

    <div class="space-y-3">
      <div
        v-for="member in tripMembers"
        :key="member.id"
        class="bg-white rounded-lg p-4 border border-gray-100 space-y-3"
      >
        <!-- Member Header -->
        <div class="flex items-center gap-2 pb-3 border-b border-gray-100">
          <span class="text-lg">{{ member.avatarEmoji }}</span>
          <span class="text-base font-semibold text-gray-900">{{ member.name }}</span>
        </div>

        <!-- Summary Stats -->
        <div class="space-y-2">
          <div class="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
            <span class="text-xs text-gray-600 font-medium">
              已付款
            </span>
            <span class="text-sm font-mono font-semibold text-blue-600">
              {{ trip?.tripCurrency }} {{ getMemberPaidAmount(member.id).toFixed(2) }}
            </span>
          </div>
          <div class="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
            <span class="text-xs text-gray-600 font-medium">
              應付金額
            </span>
            <span class="text-sm font-mono font-semibold text-orange-600">
              {{ trip?.tripCurrency }} {{ getMemberOwedAmount(member.id).toFixed(2) }}
            </span>
          </div>
          <div class="flex items-center justify-between py-2 px-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <span class="text-xs text-gray-700 font-semibold">
              餘額
            </span>
            <span
              :class="{
                'text-green-600': getMemberBalance(member.id) > 0,
                'text-red-600': getMemberBalance(member.id) < 0,
                'text-gray-700': getMemberBalance(member.id) === 0,
              }"
              class="text-sm font-mono font-bold"
            >
              {{ trip?.tripCurrency }} {{ getMemberBalance(member.id).toFixed(2) }}
            </span>
          </div>
        </div>

        <!-- Debt Relationships with Other Members -->
        <div v-if="tripMembers.filter(m => m.id !== member.id).length > 0" class="pt-2 space-y-2">
          <p class="text-xs font-medium text-gray-600">
            與其他成員的債務關係
          </p>
          <div class="space-y-2">
            <div
              v-for="otherMember in tripMembers.filter(m => m.id !== member.id)"
              :key="otherMember.id"
              class="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm">{{ otherMember.avatarEmoji }}</span>
                <span class="text-sm font-medium text-gray-900">{{ otherMember.name }}</span>
              </div>
              <div class="text-right">
                <div
                  :class="{
                    'text-green-600': getDebtAmount(member.id, otherMember.id) > 0,
                    'text-red-600': getDebtAmount(member.id, otherMember.id) < 0,
                    'text-gray-600': getDebtAmount(member.id, otherMember.id) === 0,
                  }"
                  class="text-xs font-semibold"
                >
                  <span v-if="getDebtAmount(member.id, otherMember.id) > 0">應收</span>
                  <span v-else-if="getDebtAmount(member.id, otherMember.id) < 0">應付</span>
                  <span v-else>已結清</span>
                </div>
                <div
                  :class="{
                    'text-green-600': getDebtAmount(member.id, otherMember.id) > 0,
                    'text-red-600': getDebtAmount(member.id, otherMember.id) < 0,
                    'text-gray-600': getDebtAmount(member.id, otherMember.id) === 0,
                  }"
                  class="text-xs font-mono mt-0.5"
                >
                  {{ trip?.tripCurrency }} {{ Math.abs(getDebtAmount(member.id, otherMember.id)).toFixed(2) }}
                </div>
                <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-500 font-mono mt-0.5">
                  {{ trip?.defaultCurrency }} {{ Math.abs(getDebtAmount(member.id, otherMember.id) * (trip?.exchangeRate || 1)).toFixed(2) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
