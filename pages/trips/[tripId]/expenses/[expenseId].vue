<script setup lang="ts">
import type { Expense, Trip } from '@/types'
import { computedAsync } from '@vueuse/core'
import { doc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { toast } from 'vue-sonner'
import { useDocument, useFirestore, usePendingPromises, useFirebaseStorage, useStorageFile } from 'vuefire'
import { expenseConverter } from '@/utils/converter'

definePageMeta({
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

const paidByMember = computed(() => tripMembers.value?.find(member => member.id === expense.value?.paidByMemberId))
const sharedWithMembers = computed(() => tripMembers.value?.filter(member => expense.value?.sharedWithMemberIds.includes(member.id)))

const receiptImageUrl = computedAsync(async () => {
  const storage = useFirebaseStorage()
  const ref = storageRef(storage, expense.value?.receiptImageUrl)
  return await getDownloadURL(ref)
}, null)
</script>

<template>
  <div class="flex items-end justify-between gap-2 bg-slate-200 p-4">
    <div class="font-bold flex flex-col items-end text-left">
      <span class="w-[150px] text-sm text-gray-500">{{ expense?.paidAtString }}</span>
    </div>
    <h1 class="text-2xl font-bold text-indigo-700">
      {{ trip?.tripCurrency }} {{ expense?.grandTotal }}
    </h1>
  </div>

  <p class="flex items-center px-6 text-sm">
    {{ expense?.description }}
  </p>

  <div class="mt-4 space-y-4 px-2">
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
      <div class="flex items-center justify-between">
        <div class="text-sm text-gray-500 min-w-[100px]">
          分攤成員
        </div>
        <div class="flex items-center gap-2">
          <span
            v-for="member in sharedWithMembers"
            :key="member.id"
            class="text-sm"
          >
            {{ member.avatarEmoji }}
          </span>
        </div>
      </div>
      <ui-separator />
      <div v-if="expense?.items?.length" class="space-y-2">
        <div class="text-sm text-gray-500 min-w-[100px]">
          購買明細
        </div>
        <ui-table class="table-auto">
          <!-- <ui-table-caption>購買項目</ui-table-caption> -->
          <ui-table-header>
            <ui-table-row>
              <ui-table-head>名稱</ui-table-head>
              <ui-table-head class="text-right">價格</ui-table-head>
            </ui-table-row>
          </ui-table-header>
          <ui-table-body>
            <ui-table-row v-for="item in expense.items" :key="item.name">
              <ui-table-cell class="font-medium whitespace-break-spaces text-sm">{{ item.name }}</ui-table-cell>
              <ui-table-cell class="text-right font-mono w-[100px] text-green-600">{{ trip?.tripCurrency }} {{ item.price }}</ui-table-cell>
            </ui-table-row>
          </ui-table-body>
        </ui-table>
      </div>

      <div v-if="receiptImageUrl" class="space-y-2">
        <div class="text-sm text-gray-500">
          收據圖片
        </div>
        <div class="grid gap-2">
          <img :src="receiptImageUrl" class="w-full h-full object-cover" />
        </div>
      </div>
    </div>
  </div>
</template>
