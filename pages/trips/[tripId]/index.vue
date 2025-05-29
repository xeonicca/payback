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
const { tripExpenses } = useTripExpenses(tripId as string, 3)

const openUploadReceiptDrawer = ref(false)
const openAddExpenseDrawer = ref(false)
const totalExpenses = computed(() => tripExpenses.value?.reduce((acc, expense) => acc + expense.grandTotal, 0))

if (!trip.value) {
  toast.error('行程不存在')
  navigateTo('/')
}
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
    <div class="flex items-start justify-between gap-2 bg-slate-200 py-4">
      <h1 class="text-2xl font-bold text-indigo-700">
        {{ trip.name }}
      </h1>
      <div class="font-bold flex flex-col items-end">
        <span class="text-xl">{{ trip.tripCurrency }} {{ totalExpenses }}</span>
        <span class="text-sm text-slate-600">{{ tripExpenses.length }} 筆</span>
      </div>
    </div>
    <div class="mt-1 flex gap-2 items-center">
      <div v-for="member in tripMembers" :key="member.id" class="text-sm text-gray-500 flex items-center gap-1">
        <span>{{ member.avatarEmoji }}</span>
        <span class="font-bold">{{ member.name }}</span>
      </div>
    </div>

    <section class="mt-4">
      <div class="flex items-center justify-between pl-2">
        <h2 class="text-xl font-bold text-indigo-700">
          支出紀錄
        </h2>
        <ui-button size="icon" @click="openAddExpenseDrawer = true">
          <icon name="lucide:plus" size="16" />
        </ui-button>
      </div>
      <div class="mt-2 pb-4 px-4 pt-2 space-y-1 bg-white rounded-sm">
        <template v-for="expense in tripExpenses" :key="expense.id">
          <expense-item :expense="expense" :trip-members="tripMembers" :trip="trip!" />
          <ui-separator />
        </template>
      </div>
    </section>

    <ui-drawer v-model:open="openAddExpenseDrawer">
      <ui-drawer-content>
        <div class="mx-auto w-full max-w-sm">
          <add-trip-expense-form :trip="trip" :trip-members="tripMembers" :host-member="hostMember" />
        </div>
      </ui-drawer-content>
    </ui-drawer>

    <ui-drawer v-model:open="openUploadReceiptDrawer">
      <ui-drawer-content>
        <div class="mx-auto w-full max-w-sm">
          <upload-receipt-form
            :trip="trip"
            :trip-members="tripMembers"
            :host-member="hostMember"
            @close="openUploadReceiptDrawer = false"
          />
        </div>
      </ui-drawer-content>
    </ui-drawer>

    <trip-bottom-bar
      :trip="trip"
      @open-upload-receipt-drawer="openUploadReceiptDrawer = true"
    />
  </template>
</template>
