<script setup lang="ts">
import type { Expense, Trip } from '@/types'
import { computedAsync } from '@vueuse/core'
import { doc, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { toast } from 'vue-sonner'
import { useDocument, useFirebaseStorage, useFirestore } from 'vuefire'
import EditExpenseForm from '@/components/EditExpenseForm.vue'
import ExpenseDetailItem from '@/components/ExpenseDetailItem.vue'
import { useTripMembers } from '@/composables/useTripMember'
import { expenseConverter, tripConverter } from '@/utils/converter'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const db = useFirestore()
const { tripId, expenseId } = useRoute().params

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const expense = useDocument<Expense>(doc(db, 'trips', tripId as string, 'expenses', expenseId as string).withConverter(expenseConverter))
const { tripMembers } = useTripMembers(tripId as string)
const sharedMembers = computed(() => tripMembers.value?.filter(member => expense.value?.sharedWithMemberIds.includes(member.id)))

// Check if trip/expense exists after data loads
watch([trip, expense], ([tripValue, expenseValue]) => {
  if (tripValue === null || expenseValue === null) {
    toast.error('支出不存在')
    navigateTo(`/trips/${tripId}`)
  }
}, { once: true })

const showEditDialog = ref(false)

const paidByMember = computed(() => tripMembers.value?.find(member => member.id === expense.value?.paidByMemberId))
const sharedWithMembers = computed(() => tripMembers.value?.filter(member => expense.value?.sharedWithMemberIds.includes(member.id)))

const receiptImageUrl = computedAsync(async () => {
  const storage = useFirebaseStorage()
  const ref = storageRef(storage, expense.value?.receiptImageUrl)
  return await getDownloadURL(ref)
}, null)

const convertToDefaultCurrency = computed(() => {
  if (!expense.value?.grandTotal || !trip.value?.exchangeRate)
    return 0

  return Math.round(expense.value.grandTotal * trip.value.exchangeRate * 100) / 100
})

const sharedTotalByMember = computed(() => {
  const sharedWithMemberIds = expense.value?.sharedWithMemberIds ?? []
  if (!expense.value?.items?.length) {
    return sharedWithMemberIds.reduce((acc, memberId) => {
      acc[memberId] = {
        total: expense.value!.grandTotal / sharedWithMemberIds.length,
        convertedTotal: expense.value!.grandTotal / sharedWithMemberIds.length * trip.value!.exchangeRate,
      }
      return acc
    }, {} as Record<string, { total: number, convertedTotal: number }>)
  }

  const memberTotals: Record<string, { total: number, convertedTotal: number }> = {}

  // Initialize all members with 0
  sharedWithMemberIds.forEach((memberId) => {
    memberTotals[memberId] = {
      total: 0,
      convertedTotal: 0,
    }
  })

  // Calculate totals for each item
  expense.value.items.forEach((item) => {
    let sharingMembers: string[]

    // If item has no specific sharedByMemberIds, all members share it
    if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
      sharingMembers = sharedWithMemberIds
    }
    else {
      // Only include members who are both in item sharing AND main expense sharing
      sharingMembers = item.sharedByMemberIds.filter(memberId =>
        sharedWithMemberIds.includes(memberId),
      )
    }

    // Skip if no members are sharing this item
    if (sharingMembers.length === 0)
      return

    // Calculate price per member for this item
    const pricePerMember = item.price * (item.quantity ?? 1) / sharingMembers.length

    // Add the price to each sharing member's total
    sharingMembers.forEach((memberId) => {
      memberTotals[memberId].total += pricePerMember
      memberTotals[memberId].convertedTotal += pricePerMember * trip.value!.exchangeRate
    })
  })

  return memberTotals
})

// Detailed breakdown by member for debugging
const memberItemBreakdown = computed(() => {
  const sharedWithMemberIds = expense.value?.sharedWithMemberIds ?? []
  const breakdown: Record<string, Array<{
    itemName: string
    itemPrice: number
    itemQuantity: number
    totalItemCost: number
    sharingMembers: string[]
    sharePerMember: number
  }>> = {}

  // Initialize breakdown for each member
  sharedWithMemberIds.forEach((memberId) => {
    breakdown[memberId] = []
  })

  if (!expense.value?.items?.length) {
    // If no items, split grand total equally
    const sharePerMember = expense.value!.grandTotal / sharedWithMemberIds.length
    sharedWithMemberIds.forEach((memberId) => {
      breakdown[memberId].push({
        itemName: '總金額平分',
        itemPrice: expense.value!.grandTotal,
        itemQuantity: 1,
        totalItemCost: expense.value!.grandTotal,
        sharingMembers: sharedWithMemberIds,
        sharePerMember,
      })
    })
    return breakdown
  }

  // Calculate breakdown for each item
  expense.value.items.forEach((item, index) => {
    let sharingMembers: string[]

    // If item has no specific sharedByMemberIds, all members share it
    if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
      sharingMembers = sharedWithMemberIds
    }
    else {
      // Only include members who are both in item sharing AND main expense sharing
      sharingMembers = item.sharedByMemberIds.filter(memberId =>
        sharedWithMemberIds.includes(memberId),
      )
    }

    // Skip if no members are sharing this item
    if (sharingMembers.length === 0)
      return

    const totalItemCost = item.price * (item.quantity ?? 1)
    const sharePerMember = totalItemCost / sharingMembers.length

    // Add this item breakdown to each sharing member
    sharingMembers.forEach((memberId) => {
      breakdown[memberId].push({
        itemName: item.name || `項目 ${index + 1}`,
        itemPrice: item.price,
        itemQuantity: item.quantity ?? 1,
        totalItemCost,
        sharingMembers,
        sharePerMember,
      })
    })
  })

  return breakdown
})

async function updateExpense(newValue: boolean) {
  if (!expense.value)
    return

  await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
    enabled: newValue,
  })

  if (newValue) {
    toast.success('支出已顯示')
  }
  else {
    toast.error('支出已隱藏')
  }
}

function openEditDialog() {
  showEditDialog.value = true
}

function closeEditDialog() {
  showEditDialog.value = false
}
</script>

<template>
  <div class="flex items-end justify-between gap-2 bg-slate-200 mb-2">
    <h1 class="text-2xl font-bold text-indigo-700">
      {{ trip?.tripCurrency }} {{ expense?.grandTotal.toFixed(2) }}
      <p class="text-sm text-slate-700 inline-flex items-center gap-1">
        <Icon name="lucide:equal-approximately" class="text-slate-700" /> {{ trip?.defaultCurrency }} {{ convertToDefaultCurrency.toFixed(2) }}
      </p>
    </h1>
    <ui-button
      variant="outline"
      size="sm"
      class="flex items-center gap-2"
      @click="openEditDialog"
    >
      <Icon
        name="lucide:edit-3"
        :size="16"
        class="text-gray-600"
      />
      編輯
    </ui-button>
  </div>

  <div class="text-sm">
    <span class="w-[150px] text-sm text-gray-500">{{ expense?.paidAtString }}</span>
    <p class="text-sm mt-2">
      {{ expense?.description }}
    </p>
  </div>

  <div class="space-x-2 px-2 my-4 flex justify-between items-center bg-slate-500 rounded-lg">
    <div class="flex items-center gap-2 pl-2">
      <icon name="lucide:eye" class="text-white" size="20" />
    </div>
    <div class="p-2 flex-1 flex justify-end items-center space-x-2">
      <ui-label for="enabled" class="text-white">
        顯示這筆支出
      </ui-label>
      <ui-switch id="enabled" :model-value="expense?.enabled ?? true" @update:model-value="updateExpense" />
    </div>
  </div>

  <div class="mt-4 space-y-4">
    <div class="bg-white rounded-lg p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-sm text-gray-500 min-w-[100px]">
          付款人
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm">{{ paidByMember?.avatarEmoji }}</span>
          <span class="font-bold">{{ paidByMember?.name }}</span>
        </div>
      </div>
      <ui-separator />
      <div v-if="Object.keys(sharedTotalByMember).length > 0" class="space-y-2">
        <div class="text-sm text-gray-500 min-w-[100px]">
          成員分攤明細
        </div>
        <ui-accordion type="multiple" class="space-y-2">
          <ui-accordion-item
            v-for="member in sharedMembers"
            :key="member.id"
            :value="member.id"
            class="bg-gray-50 rounded-lg border-0"
          >
            <ui-accordion-trigger class="flex items-center justify-between py-2 px-3 hover:no-underline">
              <div class="flex flex-1 items-center justify-between py-2 hover:no-underline">
                <div class="flex items-center gap-2">
                  <span class="text-sm">{{ member.avatarEmoji }}</span>
                  <span class="text-sm font-medium">{{ member.name }}</span>
                </div>
                <div class="text-right mr-4">
                  <div class="text-sm font-mono text-green-600">
                    {{ trip?.tripCurrency }} {{ sharedTotalByMember[member.id].total.toFixed(2) || '0.00' }}
                  </div>
                  <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-500 inline-flex items-center gap-1">
                    <Icon name="lucide:equal-approximately" class="text-gray-500" size="12" />
                    <p>{{ trip?.defaultCurrency }} {{ (sharedTotalByMember[member.id].convertedTotal).toFixed(2) }}</p>
                  </div>
                </div>
              </div>
            </ui-accordion-trigger>
            <ui-accordion-content class="px-3 pb-3">
              <div class="space-y-2 text-xs">
                <div
                  v-for="(item, index) in memberItemBreakdown[member.id] || []"
                  :key="index"
                  class="flex justify-between items-center py-1 px-2 bg-indigo-100 rounded gap-4"
                >
                  <div class="flex-1">
                    <span class="font-mono">{{ item.itemName }}</span>
                    <p class="text-gray-500">
                      ({{ trip?.tripCurrency }} {{ item.itemPrice.toFixed(2) }} × {{ item.itemQuantity }} ÷ {{ item.sharingMembers.length }}人)
                    </p>
                  </div>
                  <div class="text-right font-mono text-green-600">
                    {{ trip?.tripCurrency }} {{ item.sharePerMember.toFixed(2) }}
                  </div>
                </div>
                <div class="border-t pt-1 flex justify-between items-center font-bold">
                  <span>小計:</span>
                  <span class="text-green-600">
                    {{ trip?.tripCurrency }} {{ (memberItemBreakdown[member.id] || []).reduce((sum, item) => sum + item.sharePerMember, 0).toFixed(2) }}
                  </span>
                </div>
              </div>
            </ui-accordion-content>
          </ui-accordion-item>
        </ui-accordion>
      </div>

      <!-- Debt Relationship Section -->
      <div v-if="Object.keys(sharedTotalByMember).length > 0" class="space-y-3">
        <div class="text-sm font-semibold text-gray-700">
          債務關係
        </div>

        <!-- Who Paid -->
        <div class="bg-white rounded-lg p-4 border border-gray-100">
          <div class="flex items-center gap-2 pb-3 border-b border-gray-100 mb-3">
            <span class="text-lg">{{ paidByMember?.avatarEmoji }}</span>
            <span class="text-base font-semibold text-gray-900">{{ paidByMember?.name }}</span>
            <span class="text-xs text-gray-500 px-2 py-1 bg-blue-50 rounded-full">付款人</span>
          </div>

          <div class="flex items-center justify-between py-2 px-3 bg-blue-50 rounded-lg border border-blue-100">
            <span class="text-xs text-gray-700 font-medium">
              已付款
            </span>
            <span class="text-sm font-mono font-semibold text-blue-600">
              {{ trip?.tripCurrency }} {{ expense?.grandTotal.toFixed(2) }}
            </span>
          </div>
        </div>

        <!-- Other Members Owe -->
        <div v-if="sharedMembers.filter(m => m.id !== expense?.paidByMemberId).length > 0" class="bg-white rounded-lg p-4 border border-gray-100 space-y-3">
          <p class="text-xs font-semibold text-gray-700 pb-2 border-b border-gray-100">
            其他成員應付金額
          </p>

          <div class="space-y-2">
            <div
              v-for="member in sharedMembers.filter(m => m.id !== expense?.paidByMemberId)"
              :key="member.id"
              class="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm">{{ member.avatarEmoji }}</span>
                <span class="text-sm font-medium text-gray-900">{{ member.name }}</span>
              </div>
              <div class="text-right">
                <div class="text-sm font-mono font-semibold text-red-600">
                  {{ trip?.tripCurrency }} {{ sharedTotalByMember[member.id].total.toFixed(2) }}
                </div>
                <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-500 font-mono mt-0.5">
                  {{ trip?.defaultCurrency }} {{ sharedTotalByMember[member.id].convertedTotal.toFixed(2) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Summary -->
        <div class="bg-indigo-50 rounded-lg p-4 border border-indigo-100 space-y-2">
          <p class="text-xs font-semibold text-gray-700 mb-2">
            結算摘要
          </p>
          <div class="space-y-2">
            <div class="flex items-center justify-between py-2 px-3 bg-white rounded-lg">
              <span class="text-xs text-gray-600">付款人 {{ paidByMember?.name }} 應收</span>
              <span class="text-sm font-mono font-semibold text-green-600">
                {{ trip?.tripCurrency }} {{ ((expense?.grandTotal || 0) - (sharedMembers.filter(m => m.id !== expense?.paidByMemberId).reduce((sum, m) => sum + (sharedTotalByMember[m.id]?.total || 0), 0))).toFixed(2) }}
              </span>
            </div>
            <div class="flex items-center justify-between py-2 px-3 bg-white rounded-lg">
              <span class="text-xs text-gray-600">其他成員總計應付</span>
              <span class="text-sm font-mono font-semibold text-red-600">
                {{ trip?.tripCurrency }} {{ sharedMembers.filter(m => m.id !== expense?.paidByMemberId).reduce((sum, m) => sum + (sharedTotalByMember[m.id]?.total || 0), 0).toFixed(2) }}
              </span>
            </div>
          </div>
        </div>
      </div>
      <ui-separator />
      <template v-if="expense?.items?.length">
        <div class="text-sm text-gray-500 min-w-[100px]">
          購買明細
        </div>
        <div class="space-y-1">
          <expense-detail-item
            v-for="item in expense.items"
            :key="item.name"
            :item="item"
            :currency="trip?.tripCurrency || ''"
            :exchange-rate="trip?.exchangeRate || 1"
            :default-currency="trip?.defaultCurrency || 'TWD'"
            :edit-mode="false"
            :trip-members="tripMembers"
            :shareable-members="sharedWithMembers"
            :shared-by-member-ids="item.sharedByMemberIds"
          />
        </div>
      </template>

      <template v-if="receiptImageUrl">
        <ui-separator />
        <div class="space-y-2">
          <div class="text-sm text-gray-500">
            收據圖片
          </div>
          <div class="grid gap-2">
            <img :src="receiptImageUrl" class="w-full h-full object-cover">
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- Edit Expense Dialog -->
  <ui-drawer v-model:open="showEditDialog">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm">
        <edit-expense-form
          v-if="expense && trip"
          :expense="expense"
          :trip="trip"
          :trip-members="tripMembers"
          @close="closeEditDialog"
        />
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
