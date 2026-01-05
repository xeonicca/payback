<script setup lang="ts">
import { toast } from 'vue-sonner'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params

const { trip } = useTrip(tripId as string)
const { tripMembers, hostMember } = useTripMembers(tripId as string)
const { enabledExpenses: recentExpenses } = useTripExpenses(tripId as string, 5)
const { enabledExpenses: allEnabledExpenses } = useTripExpenses(tripId as string, 0)
const { canManageExpenses, isCollaborator } = useTripCollaborators(tripId as string)

const openAddExpenseDrawer = ref(false)

const convertToDefaultCurrency = computed(() => {
  if (!trip.value?.enabledTotalExpenses || !trip.value?.exchangeRate)
    return 0

  return Math.round(trip.value.enabledTotalExpenses * trip.value.exchangeRate * 100) / 100
})

// Calculate how much each member has actually paid (using ALL expenses)
function getMemberPaidAmount(memberId: string) {
  if (!allEnabledExpenses.value)
    return 0

  return allEnabledExpenses.value
    .filter(expense => expense.paidByMemberId === memberId)
    .reduce((total, expense) => total + expense.grandTotal, 0)
}

// Calculate how much a member owes (considering item-level sharing)
function getMemberOwedAmount(memberId: string) {
  if (!allEnabledExpenses.value)
    return 0

  let totalOwed = 0

  allEnabledExpenses.value.forEach((expense) => {
    // If expense has items, calculate based on item-level sharing
    if (expense.items && expense.items.length > 0) {
      // First, calculate total of all items
      const itemsTotal = expense.items.reduce((sum, item) =>
        sum + (item.price * (item.quantity || 1)), 0
      )

      // Only use item-level sharing if items have valid prices
      if (itemsTotal > 0) {
        // Calculate this member's share of items
        let memberItemsTotal = 0
        expense.items.forEach((item) => {
          let sharingMembers: string[] = []

          // If item has no specific sharedByMemberIds, all expense members share it
          if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
            sharingMembers = expense.sharedWithMemberIds
          }
          else {
            // Only include members who are both in item sharing AND main expense sharing
            sharingMembers = item.sharedByMemberIds.filter(id =>
              expense.sharedWithMemberIds.includes(id),
            )
          }

          // Skip if no members are sharing this item or if this member isn't sharing
          if (sharingMembers.length === 0 || !sharingMembers.includes(memberId)) {
            return
          }

          // Calculate this member's share of this item
          const itemTotal = item.price * (item.quantity || 1)
          const sharePerMember = itemTotal / sharingMembers.length
          memberItemsTotal += sharePerMember
        })

        // Proportionally distribute the grandTotal based on this member's item share
        // This ensures taxes, fees, tips, etc. are distributed proportionally
        const memberProportion = memberItemsTotal / itemsTotal
        totalOwed += expense.grandTotal * memberProportion
      }
      else {
        // Items exist but have no prices - fall back to expense-level sharing
        if (expense.sharedWithMemberIds.includes(memberId)) {
          const sharePerMember = expense.grandTotal / expense.sharedWithMemberIds.length
          totalOwed += sharePerMember
        }
      }
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

// Calculate member balance (paid - owed)
function getMemberBalance(memberId: string) {
  const paid = getMemberPaidAmount(memberId)
  const owed = getMemberOwedAmount(memberId)

  return paid - owed
}

// Debug function to check balance totals
function debugBalances() {
  if (!allEnabledExpenses.value || !tripMembers.value)
    return

  console.log('=== DEBUG: Balance Check ===')
  console.log(`Trip: ${trip.value?.name}`)
  console.log(`Total expenses count: ${allEnabledExpenses.value.length}`)
  console.log(`Total from trip: ${trip.value?.enabledTotalExpenses}`)

  let totalPaid = 0
  let totalOwed = 0
  let totalBalance = 0

  tripMembers.value.forEach((member) => {
    const paid = getMemberPaidAmount(member.id)
    const owed = getMemberOwedAmount(member.id)
    const balance = getMemberBalance(member.id)

    totalPaid += paid
    totalOwed += owed
    totalBalance += balance

    console.log(`${member.name}:`)
    console.log(`  Paid: ${paid.toFixed(2)}`)
    console.log(`  Owed: ${owed.toFixed(2)}`)
    console.log(`  Balance: ${balance.toFixed(2)}`)
  })

  console.log('\nTotals:')
  console.log(`  Total Paid: ${totalPaid.toFixed(2)}`)
  console.log(`  Total Owed: ${totalOwed.toFixed(2)}`)
  console.log(`  Total Balance: ${totalBalance.toFixed(2)} (should be ~0)`)
  console.log(`  Difference: ${Math.abs(totalPaid - totalOwed).toFixed(2)}`)

  // Detailed expense breakdown
  console.log('\n=== Expense Details ===')
  allEnabledExpenses.value.forEach((expense) => {
    console.log(`\nExpense: ${expense.description}`)
    console.log(`  Grand Total: ${expense.grandTotal}`)
    console.log(`  Has Items: ${expense.items?.length > 0}`)
    console.log(`  Shared by: ${expense.sharedWithMemberIds.length} members`)

    if (expense.items && expense.items.length > 0) {
      const itemsTotal = expense.items.reduce((sum, item) =>
        sum + (item.price * (item.quantity || 1)), 0
      )
      console.log(`  Items Total: ${itemsTotal}`)
      console.log(`  Difference (tax/fees): ${(expense.grandTotal - itemsTotal).toFixed(2)}`)
    }
  })
}

// Expose debug function to window for console access
if (import.meta.client) {
  (window as any).debugBalances = debugBalances
}

// Check if trip exists after data loads
watch(trip, (tripValue) => {
  if (tripValue === null) {
    toast.error('行程不存在')
    navigateTo('/')
  }
}, { once: true })
</script>

<template>
  <template v-if="!trip">
    <div class="pt-10 flex items-start justify-start h-screen">
      <div class="w-full flex flex-col space-y-2 max-w-sm">
        <ui-skeleton class="w-full h-6" />
        <ui-skeleton class="w-full h-6" />
      </div>
    </div>
  </template>
  <template v-else>
    <div class="flex items-start justify-between gap-2 bg-slate-200 pb-4">
      <h1 class="text-xl font-bold text-indigo-700">
        {{ trip.name }}
        <p class="text-sm text-slate-600">
          {{ trip.expenseCount }} 筆
        </p>
      </h1>
      <div class="font-bold flex flex-col items-end">
        <span class="text-lg text-indigo-700 font-bold">{{ trip.tripCurrency }} {{ trip.enabledTotalExpenses.toFixed(2) }}</span>
        <span class="text-sm text-slate-600 inline-flex items-center gap-1">
          <Icon name="lucide:equal-approximately" class="text-slate-600" size="16" />
          {{ trip.defaultCurrency }} {{ convertToDefaultCurrency.toFixed(2) }}
        </span>
      </div>
    </div>

    <section class="mt-4 space-y-2">
      <div class="flex items-center justify-between pl-2">
        <h2 class="text-xl font-bold text-indigo-700">
          成員結算
        </h2>
      </div>

      <!-- Summary Cards -->
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-white rounded-lg p-4 border border-gray-100">
          <p class="text-xs text-gray-500 mb-1">
            總支出
          </p>
          <p class="text-lg font-bold text-gray-900 font-mono">
            {{ trip?.tripCurrency }} {{ (trip?.enabledTotalExpenses || 0).toFixed(2) }}
          </p>
          <p v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-400 font-mono">
            ≈ {{ trip?.defaultCurrency }} {{ ((trip?.enabledTotalExpenses || 0) * trip.exchangeRate).toFixed(2) }}
          </p>
        </div>
        <div class="bg-white rounded-lg p-4 border border-gray-100">
          <p class="text-xs text-gray-500 mb-1">
            平均每人
          </p>
          <p class="text-lg font-bold text-indigo-600 font-mono">
            {{ trip?.tripCurrency }} {{ tripMembers.length > 0 ? ((trip?.enabledTotalExpenses || 0) / tripMembers.length).toFixed(2) : '0.00' }}
          </p>
          <p v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-400 font-mono">
            ≈ {{ trip?.defaultCurrency }} {{ tripMembers.length > 0 ? (((trip?.enabledTotalExpenses || 0) / tripMembers.length) * trip.exchangeRate).toFixed(2) : '0.00' }}
          </p>
        </div>
      </div>

      <!-- Combined Member Info -->
      <div class="space-y-2">
        <div
          v-for="member in tripMembers"
          :key="member.id"
          class="bg-white rounded-lg p-3 border border-gray-100"
        >
          <!-- Member Header -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="text-base">{{ member.avatarEmoji }}</span>
              <span class="text-sm font-semibold text-gray-900">{{ member.name }}</span>
            </div>
            <div
              :class="{
                'text-green-600': getMemberBalance(member.id) > 0.01,
                'text-red-600': getMemberBalance(member.id) < -0.01,
                'text-gray-600': Math.abs(getMemberBalance(member.id)) <= 0.01,
              }"
              class="text-xs font-semibold px-2 py-0.5 rounded-full"
              :style="{
                backgroundColor: getMemberBalance(member.id) > 0.01
                  ? 'rgb(220 252 231)'
                  : getMemberBalance(member.id) < -0.01
                    ? 'rgb(254 226 226)'
                    : 'rgb(243 244 246)',
              }"
            >
              <span v-if="getMemberBalance(member.id) > 0.01">應收款</span>
              <span v-else-if="getMemberBalance(member.id) < -0.01">應付款</span>
              <span v-else>已結清</span>
            </div>
          </div>

          <!-- Member Details Grid -->
          <div class="grid grid-cols-2 gap-2 text-xs">
            <!-- Spending -->
            <div class="bg-gray-50 rounded p-2">
              <p class="text-gray-500 mb-0.5">
                已支付
              </p>
              <p class="font-mono font-semibold text-gray-900">
                {{ trip?.tripCurrency }} {{ getMemberPaidAmount(member.id).toFixed(2) }}
              </p>
              <p v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-gray-400 font-mono mt-0.5">
                ≈ {{ trip?.defaultCurrency }} {{ (getMemberPaidAmount(member.id) * trip.exchangeRate).toFixed(2) }}
              </p>
            </div>

            <!-- Balance -->
            <div class="bg-gray-50 rounded p-2">
              <p class="text-gray-500 mb-0.5">
                結算金額
              </p>
              <p
                :class="{
                  'text-green-600': getMemberBalance(member.id) > 0.01,
                  'text-red-600': getMemberBalance(member.id) < -0.01,
                  'text-gray-600': Math.abs(getMemberBalance(member.id)) <= 0.01,
                }"
                class="font-mono font-semibold"
              >
                {{ getMemberBalance(member.id) > 0.01 ? '+' : getMemberBalance(member.id) < -0.01 ? '-' : '' }}{{ trip?.tripCurrency }} {{ Math.abs(getMemberBalance(member.id)).toFixed(2) }}
              </p>
              <p v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-gray-400 font-mono mt-0.5">
                ≈ {{ trip?.defaultCurrency }} {{ (Math.abs(getMemberBalance(member.id)) * trip.exchangeRate).toFixed(2) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="mt-4">
      <div class="flex items-center justify-between pl-2">
        <h2 class="text-xl font-bold text-indigo-700">
          近期支出紀錄
        </h2>
        <ui-button
          v-if="!trip.archived && canManageExpenses"
          size="sm"
          @click="openAddExpenseDrawer = true"
        >
          <icon name="lucide:plus" size="16" />
        </ui-button>
        <ui-badge v-else-if="trip.archived" variant="secondary" class="text-xs">
          已封存
        </ui-badge>
      </div>
      <div v-if="recentExpenses.length > 0" class="mt-2 pb-4 px-4 pt-2 space-y-1 bg-white rounded-sm">
        <template v-for="expense in recentExpenses" :key="expense.id">
          <expense-item :expense="expense" :trip-members="tripMembers" :trip="trip!" />
          <ui-separator />
        </template>
        <div class="flex items-center justify-end mt-4">
          <nuxt-link class="flex items-center gap-1 text-sm text-gray-500" :to="`/trips/${tripId}/expenses`">
            查看所有支出
            <icon name="lucide:arrow-right" size="16" />
          </nuxt-link>
        </div>
      </div>
      <div v-else class="mt-2 px-4 py-6 bg-white rounded-sm">
        <p class="text-sm text-gray-500">
          尚未有支出紀錄
        </p>
      </div>
    </section>

    <ui-drawer v-model:open="openAddExpenseDrawer">
      <ui-drawer-content>
        <div class="mx-auto w-full max-w-sm">
          <add-trip-expense-form
            :trip="trip"
            :trip-members="tripMembers"
            :host-member="hostMember"
            @close="openAddExpenseDrawer = false"
          />
        </div>
      </ui-drawer-content>
    </ui-drawer>
  </template>
</template>
