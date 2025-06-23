<script setup lang="ts">
import type { Expense, Trip } from '@/types'
import { computedAsync } from '@vueuse/core'
import { doc, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { toast } from 'vue-sonner'
import { useDocument, useFirebaseStorage, useFirestore, usePendingPromises } from 'vuefire'
import ExpenseDetailItem from '@/components/ExpenseDetailItem.vue'
import { expenseConverter } from '@/utils/converter'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const db = useFirestore()
const { tripId, expenseId } = useRoute().params

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const expense = useDocument<Expense>(doc(db, 'trips', tripId as string, 'expenses', expenseId as string).withConverter(expenseConverter))
const { tripMembers } = useTripMembers(tripId as string)
await usePendingPromises()

if (!trip.value || !expense.value) {
  toast.error('支出不存在')
  navigateTo(`/trips/${tripId}`)
}

const isEditMode = ref(false)

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
  if (!expense.value?.items?.length) {
    return tripMembers.value.reduce((acc, member) => {
      acc[member.id] = {
        total: expense.value!.grandTotal / tripMembers.value.length,
        convertedTotal: expense.value!.grandTotal / tripMembers.value.length * trip.value!.exchangeRate,
      }
      return acc
    }, {} as Record<string, { total: number, convertedTotal: number }>)
  }

  const memberTotals: Record<string, { total: number, convertedTotal: number }> = {}

  // Initialize all members with 0
  tripMembers.value.forEach((member) => {
    memberTotals[member.id] = {
      total: 0,
      convertedTotal: 0,
    }
  })

  // Calculate totals for each item
  expense.value.items.forEach((item) => {
    let sharingMembers: string[]

    // If item has no specific sharedByMemberIds, all members share it
    if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
      sharingMembers = tripMembers.value.map(member => member.id)
    }
    else {
      sharingMembers = item.sharedByMemberIds
    }

    // Skip if no members are sharing this item
    if (sharingMembers.length === 0)
      return

    // Calculate price per member for this item
    const pricePerMember = item.price / sharingMembers.length

    // Add the price to each sharing member's total
    sharingMembers.forEach((memberId) => {
      memberTotals[memberId].total += pricePerMember
      memberTotals[memberId].convertedTotal += pricePerMember * trip.value!.exchangeRate
    })
  })

  return memberTotals
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

async function toggleEditMode() {
  if (isEditMode.value) {
    // Save changes when exiting edit mode
    await saveItemChanges()
  }
  isEditMode.value = !isEditMode.value
}

async function saveItemChanges() {
  if (!expense.value?.items)
    return

  try {
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items: expense.value.items,
    })
    toast.success('明細分攤設定已儲存')
  }
  catch (error) {
    console.error('Error saving item changes:', error)
    toast.error('儲存失敗，請重試')
  }
}

function handleItemSharedByMemberIdsUpdate(itemIndex: number, memberIds: string[]) {
  if (!expense.value?.items)
    return

  // Create a new array to avoid mutating the reactive object directly
  const updatedItems = [...expense.value.items]
  updatedItems[itemIndex] = {
    ...updatedItems[itemIndex],
    sharedByMemberIds: memberIds,
  }

  // Update the expense items
  expense.value.items = updatedItems
}
</script>

<template>
  <div class="flex items-end justify-between gap-2 bg-slate-200 mb-2">
    <h1 class="text-2xl font-bold text-indigo-700">
      {{ trip?.tripCurrency }} {{ expense?.grandTotal }}
      <p class="text-sm text-slate-700 inline-flex items-center gap-1">
        <Icon name="lucide:equal-approximately" class="text-slate-700" /> {{ trip?.defaultCurrency }} {{ convertToDefaultCurrency }}
      </p>
    </h1>
    <ui-button
      variant="outline"
      size="sm"
      class="flex items-center gap-2"
      @click="toggleEditMode"
    >
      <Icon
        :name="isEditMode ? 'lucide:check' : 'lucide:edit-3'"
        :size="16"
        class="text-gray-600"
      />
      {{ isEditMode ? '完成' : '編輯' }}
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
      <!-- <div class="flex items-start justify-between">
        <div class="text-sm text-gray-500 min-w-[100px] pt-1">
          支出說明
        </div>
        <div class="flex items-center gap-2 text-right">
          {{ expense?.description }}
        </div>
      </div> -->

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
        <div class="space-y-2">
          <div
            v-for="member in tripMembers"
            :key="member.id"
            class="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm">{{ member.avatarEmoji }}</span>
              <span class="text-sm font-medium">{{ member.name }}</span>
            </div>
            <div class="text-right">
              <div class="text-sm font-mono text-green-600">
                {{ trip?.tripCurrency }} {{ sharedTotalByMember[member.id].total.toFixed(2) || '0.00' }}
              </div>
              <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-500 inline-flex items-center gap-1">
                <Icon name="lucide:equal-approximately" class="text-gray-500" size="12" />
                <p>{{ trip?.defaultCurrency }} {{ (sharedTotalByMember[member.id].convertedTotal).toFixed(2) }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template v-if="expense?.items?.length">
        <ui-separator />
        <div class="space-y-2">
          <div class="text-sm text-gray-500 min-w-[100px]">
            購買明細
          </div>
          <div class="space-y-1">
            <expense-detail-item
              v-for="(item, index) in expense.items"
              :key="item.name"
              :item="item"
              :currency="trip?.tripCurrency || ''"
              :exchange-rate="trip?.exchangeRate || 1"
              :default-currency="trip?.defaultCurrency || 'TWD'"
              :edit-mode="isEditMode"
              :trip-members="tripMembers"
              :shareable-members="sharedWithMembers"
              :shared-by-member-ids="item.sharedByMemberIds"
              @update:shared-by-member-ids="(memberIds) => handleItemSharedByMemberIdsUpdate(index, memberIds)"
            />
          </div>
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
</template>
