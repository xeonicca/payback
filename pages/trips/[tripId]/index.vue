<script setup lang="ts">
import type { Expense, Trip } from '@/types'
import { doc } from 'firebase/firestore'
import { toast } from 'vue-sonner'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

const db = useFirestore()
const { tripId } = useRoute().params

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const { tripMembers, hostMember } = useTripMembers(tripId as string)
const { tripExpenses } = useTripExpenses(tripId as string)

const openUploadReceiptDrawer = ref(false)
const totalExpenses = computed(() => tripExpenses.value?.reduce((acc, expense) => acc + expense.grandTotal, 0))

if (!trip.value) {
  toast.error('行程不存在')
  navigateTo('/trips')
}
</script>

<template>
  <div class="flex items-start justify-between gap-2 bg-slate-200 py-4">
    <h1 class="text-2xl font-bold text-indigo-700">
      {{ trip?.name }}
    </h1>
    <div class="font-bold flex flex-col items-end">
      <span class="text-xl">{{ trip?.tripCurrency }} {{ totalExpenses }}</span>
      <span class="text-sm text-gray-500">{{ tripExpenses.length }} 筆</span>
    </div>
  </div>
  <div v-for="member in tripMembers" :key="member.id" class="mt-1 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <div class="text-sm text-gray-500 flex items-center gap-2">
        <span>{{ member.avatarEmoji }}</span>
        <span class="font-bold">{{ member.name }}</span>
      </div>
    </div>
  </div>

  <section class="mt-4">
    <h2 class="text-xl font-bold text-indigo-700">
      支出紀錄
    </h2>
    <div class="mt-2 pb-4 px-4 pt-2 space-y-1 bg-white rounded-sm">
      <template v-for="expense in tripExpenses" :key="expense.id">
        <expense-item :expense="expense" :trip-members="tripMembers" :trip="trip!" />
        <ui-separator />
      </template>
    </div>
  </section>

  <ui-drawer>
    <ui-drawer-trigger as-child>
      <ui-button variant="outline" class="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors flex items-center justify-center">
        <Icon name="mdi:plus" size="24" />
      </ui-button>
    </ui-drawer-trigger>
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm">
        <add-trip-expense-form :trip="trip!" :trip-members="tripMembers" :host-member="hostMember!" />
      </div>
    </ui-drawer-content>
  </ui-drawer>

  <ui-drawer v-model:open="openUploadReceiptDrawer">
    <ui-drawer-trigger as-child>
      <ui-button variant="outline" class="fixed bottom-22 right-6 w-14 h-14 bg-amber-500 text-white rounded-full shadow-lg hover:bg-amber-700 transition-colors flex items-center justify-center">
        <Icon name="lucide:zap" size="24" />
      </ui-button>
    </ui-drawer-trigger>
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm">
        <upload-receipt-form
          :trip="trip!"
          :trip-members="tripMembers"
          :host-member="hostMember!"
          @close="openUploadReceiptDrawer = false"
        />
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
