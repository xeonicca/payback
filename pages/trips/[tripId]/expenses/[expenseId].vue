<script setup lang="ts">
import type { Expense, Trip, TripMember } from '@/types'
import { doc } from 'firebase/firestore'
import { toast } from 'vue-sonner'
import { useDocument, useFirestore, usePendingPromises } from 'vuefire'
import { expenseConverter } from '@/utils/converter'

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
</script>

<template>
  <div class="flex items-start justify-between gap-2 bg-slate-200 p-4">
    <h1 class="text-2xl font-bold text-indigo-700">
      {{ expense?.description }}
    </h1>
    <div class="font-bold flex flex-col items-end">
      <span class="text-xl">{{ trip?.tripCurrency }} {{ expense?.grandTotal }}</span>
      <span class="text-sm text-gray-500">{{ expense?.paidAtString }}</span>
    </div>
  </div>

  <div class="mt-4 space-y-4 px-4">
    <div class="bg-white rounded-lg p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-sm text-gray-500">
          付款人
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm">{{ paidByMember?.avatarEmoji }}</span>
          <span class="font-bold">{{ paidByMember?.name }}</span>
        </div>
      </div>
      <ui-separator />
      <div class="flex items-center justify-between">
        <div class="text-sm text-gray-500">
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
        <div class="text-sm text-gray-500">
          購買項目
        </div>
        <div class="space-y-2 pl-4">
          <div v-for="item in expense.items" :key="item.name" class="flex items-center justify-between gap-2">
            <span class="font-bold text-xs">{{ item.name }}</span>
            <span class="text-sm">{{ trip?.tripCurrency }} {{ item.price }}</span>
          </div>
        </div>
      </div>

      <div v-if="expense?.imageUrls?.length" class="space-y-2">
        <div class="text-sm text-gray-500">
          收據圖片
        </div>
        <div class="grid grid-cols-2 gap-2">
          <img
            v-for="url in expense.imageUrls"
            :key="url"
            :src="url"
            alt="Receipt"
            class="w-full h-48 object-cover rounded-lg"
          >
        </div>
      </div>
    </div>
  </div>
</template>
