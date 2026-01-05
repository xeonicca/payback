<script setup lang="ts">
import type { Expense, Trip, TripMember } from '@/types'

const props = defineProps<{
  expense: Expense
  tripMembers: TripMember[]
  trip: Trip
}>()

const expenseMembers = computed(() => (expense: Expense) => props.tripMembers.filter(member => expense.sharedWithMemberIds.includes(member.id)))
const paidByMember = computed(() => props.tripMembers.find(member => member.id === props.expense.paidByMemberId))
</script>

<template>
  <nuxt-link :to="`/trips/${trip.id}/expenses/${expense.id}`" :class="{ 'opacity-50': !expense.enabled }" class="flex gap-3 pt-3 pb-2 px-2">
    <div class="flex flex-col justify-center gap-2 flex-1">
      <p class="text-sm font-bold flex items-center gap-2">
        <span>{{ expense.description }}</span>
        <Icon v-if="!expense.enabled" name="lucide:eye-off" class="w-4 h-4 text-gray-500" />
      </p>
      <div class="text-lg text-gray-500 self-start relative flex flex-wrap gap-1 justify-end">
        <span
          v-for="member in expenseMembers(expense)" :key="member.id"
          class="font-bold rounded-full p-1 w-6 h-6 flex items-center justify-center"
        >
          {{ member.avatarEmoji }}</span>
      </div>
      <p class="text-xs text-gray-500">
        {{ expense.paidAtString }}
      </p>
    </div>
    <div class="flex flex-col justify-between gap-2">
      <div class="text-lg font-extrabold text-slate-800 text-right">
        {{ expense.paidAtObject.month }}/{{ expense.paidAtObject.day }}
        <p class="text-base text-gray-500">
          {{ paidByMember?.avatarEmoji }}
        </p>
      </div>

      <div class="w-[120px] md:w-[200px] text-right self-end">
        <div class="text-sm font-mono text-green-600">
          {{ trip.tripCurrency }} {{ (expense.grandTotal || 0).toFixed(2) }}
        </div>
        <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-gray-400 font-mono mt-0.5">
          ≈ {{ trip?.defaultCurrency }} {{ ((expense.grandTotal || 0) * trip.exchangeRate).toFixed(2) }}
        </div>
      </div>
    </div>
  </nuxt-link>
</template>
