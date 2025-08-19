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

  <!-- Debt Relationship Section -->
  <div v-if="enabledExpenses.length > 0" class="mt-4 space-y-4">
    <div class="bg-white rounded-sm p-4 space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-indigo-700">
          債務關係
        </h2>
      </div>

      <div class="space-y-2">
        <div
          v-for="member in tripMembers"
          :key="member.id"
          class="py-2 px-3 bg-amber-50 rounded-lg"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="text-sm">{{ member.avatarEmoji }}</span>
            <span class="text-sm font-medium">{{ member.name }}</span>
          </div>

          <!-- Show paid vs owed amounts -->
          <div class="mb-2 space-y-1">
            <div class="text-xs flex items-center justify-between">
              <span class="text-gray-600">已付款:</span>
              <span class="font-mono text-blue-600">
                {{ trip?.tripCurrency }} {{ getMemberPaidAmount(member.id).toFixed(2) }}
              </span>
            </div>
            <div class="text-xs flex items-center justify-between">
              <span class="text-gray-600">應付金額:</span>
              <span class="font-mono text-green-600">
                {{ trip?.tripCurrency }} {{ getMemberOwedAmount(member.id).toFixed(2) }}
              </span>
            </div>
            <div class="text-xs flex items-center justify-between border-t pt-1">
              <span class="font-medium">餘額:</span>
              <span
                :class="{
                  'text-green-600': getMemberBalance(member.id) > 0,
                  'text-red-600': getMemberBalance(member.id) < 0,
                  'text-gray-600': getMemberBalance(member.id) === 0,
                }"
                class="font-mono font-medium"
              >
                {{ trip?.tripCurrency }} {{ getMemberBalance(member.id).toFixed(2) }}
              </span>
            </div>
          </div>

          <!-- Show debt relationships with other members -->
          <div class="space-y-1">
            <div class="text-xs text-gray-500 mb-1">
              與其他成員的債務關係:
            </div>
            <div
              v-for="otherMember in tripMembers.filter(m => m.id !== member.id)"
              :key="otherMember.id"
              class="text-xs flex items-center justify-between"
            >
              <span class="flex items-center gap-1">
                <span>{{ otherMember.avatarEmoji }}</span>
                <span>{{ otherMember.name }}</span>
              </span>
              <span
                :class="{
                  'text-green-600': getDebtAmount(member.id, otherMember.id) > 0,
                  'text-red-600': getDebtAmount(member.id, otherMember.id) < 0,
                  'text-gray-500': getDebtAmount(member.id, otherMember.id) === 0,
                }"
                class="font-mono"
              >
                <span v-if="getDebtAmount(member.id, otherMember.id) > 0">應收</span>
                <span v-else-if="getDebtAmount(member.id, otherMember.id) < 0">應付</span>
                <span v-else>已結清</span>
                <p>{{ trip?.tripCurrency }} {{ Math.abs(getDebtAmount(member.id, otherMember.id)).toFixed(2) }}</p>
                <p class="text-xs text-indigo-500">{{ trip?.defaultCurrency }} {{ Math.abs(getDebtAmount(member.id, otherMember.id) * (trip?.exchangeRate || 1)).toFixed(2) }}</p>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
