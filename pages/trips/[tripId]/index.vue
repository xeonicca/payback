<script setup lang="ts">
import { toast } from 'vue-sonner'
import { usePendingPromises } from 'vuefire'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params

const { trip } = useTrip(tripId as string)
const { tripMembers, hostMember } = useTripMembers(tripId as string)
const { enabledExpenses } = useTripExpenses(tripId as string, 5)
await usePendingPromises()

const openAddExpenseDrawer = ref(false)

const convertToDefaultCurrency = computed(() => {
  if (!trip.value?.enabledTotalExpenses || !trip.value?.exchangeRate)
    return 0

  return Math.round(trip.value.enabledTotalExpenses * trip.value.exchangeRate * 100) / 100
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
          成員支出
        </h2>
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
              {{ trip?.tripCurrency }} {{ member.spending.toFixed(2) || '0.00' }}
            </div>
            <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-500 inline-flex items-center gap-1">
              <Icon name="lucide:equal-approximately" class="text-gray-500" size="12" />
              <p>{{ trip?.defaultCurrency }} {{ (member.spending * trip.exchangeRate).toFixed(2) }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="mt-4 space-y-2">
      <div class="flex items-center justify-between pl-2">
        <h2 class="text-xl font-bold text-indigo-700">
          結算建議
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
        </div>
        <div class="bg-white rounded-lg p-4 border border-gray-100">
          <p class="text-xs text-gray-500 mb-1">
            平均每人
          </p>
          <p class="text-lg font-bold text-indigo-600 font-mono">
            {{ trip?.tripCurrency }} {{ tripMembers.length > 0 ? ((trip?.enabledTotalExpenses || 0) / tripMembers.length).toFixed(2) : '0.00' }}
          </p>
        </div>
      </div>

      <!-- Member Balances -->
      <div class="space-y-2">
        <div
          v-for="member in tripMembers"
          :key="member.id"
          class="flex items-center justify-between py-2.5 px-3 bg-white rounded-lg border border-gray-100"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm">{{ member.avatarEmoji }}</span>
            <span class="text-sm font-medium text-gray-900">{{ member.name }}</span>
          </div>
          <div class="text-right">
            <div
              :class="{
                'text-green-600': member.spending > ((trip?.enabledTotalExpenses || 0) / tripMembers.length),
                'text-red-600': member.spending < ((trip?.enabledTotalExpenses || 0) / tripMembers.length),
                'text-gray-600': Math.abs(member.spending - ((trip?.enabledTotalExpenses || 0) / tripMembers.length)) < 0.01,
              }"
              class="text-sm font-semibold"
            >
              <span v-if="member.spending > ((trip?.enabledTotalExpenses || 0) / tripMembers.length)">多付</span>
              <span v-else-if="member.spending < ((trip?.enabledTotalExpenses || 0) / tripMembers.length)">少付</span>
              <span v-else>已平衡</span>
            </div>
            <div
              :class="{
                'text-green-600': member.spending > ((trip?.enabledTotalExpenses || 0) / tripMembers.length),
                'text-red-600': member.spending < ((trip?.enabledTotalExpenses || 0) / tripMembers.length),
                'text-gray-600': Math.abs(member.spending - ((trip?.enabledTotalExpenses || 0) / tripMembers.length)) < 0.01,
              }"
              class="text-xs font-mono mt-0.5"
            >
              {{ trip?.tripCurrency }} {{ Math.abs(member.spending - ((trip?.enabledTotalExpenses || 0) / tripMembers.length)).toFixed(2) }}
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
          v-if="!trip.archived"
          size="sm"
          @click="openAddExpenseDrawer = true"
        >
          <icon name="lucide:plus" size="16" />
        </ui-button>
        <ui-badge v-else variant="secondary" class="text-xs">
          已封存
        </ui-badge>
      </div>
      <div v-if="enabledExpenses.length > 0" class="mt-2 pb-4 px-4 pt-2 space-y-1 bg-white rounded-sm">
        <template v-for="expense in enabledExpenses" :key="expense.id">
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
