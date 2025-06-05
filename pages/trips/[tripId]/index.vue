<script setup lang="ts">
import { toast } from 'vue-sonner'
import { usePendingPromises } from 'vuefire'

definePageMeta({
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params

const { trip } = useTrip(tripId as string)
const { tripMembers, hostMember } = useTripMembers(tripId as string)
const { tripExpenses } = useTripExpenses(tripId as string, 5)
await usePendingPromises()

const openAddExpenseDrawer = ref(false)

const convertToDefaultCurrency = computed(() => {
  if (!trip.value?.totalExpenses || !trip.value?.exchangeRate)
    return 0

  return Math.round(trip.value.totalExpenses * trip.value.exchangeRate * 100) / 100
})

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
    <div class="flex items-start justify-between gap-2 bg-slate-200 pb-4">
      <h1 class="text-2xl font-bold text-indigo-700">
        {{ trip.name }}
        <p class="text-sm text-slate-600">
          {{ trip.expenseCount }} 筆
        </p>
      </h1>
      <div class="font-bold flex flex-col items-end">
        <span class="text-xl">{{ trip.tripCurrency }} {{ trip.totalExpenses }}</span>
        <span class="text-sm text-slate-600 inline-flex items-center gap-1">
          <Icon name="lucide:equal-approximately" class="text-slate-600" size="16" />
          {{ trip.defaultCurrency }} {{ convertToDefaultCurrency }}
        </span>
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
          近期支出紀錄
        </h2>
        <ui-button size="sm" @click="openAddExpenseDrawer = true">
          <icon name="lucide:plus" size="16" />
        </ui-button>
      </div>
      <div v-if="tripExpenses.length > 0" class="mt-2 pb-4 px-4 pt-2 space-y-1 bg-white rounded-sm">
        <template v-for="expense in tripExpenses" :key="expense.id">
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
