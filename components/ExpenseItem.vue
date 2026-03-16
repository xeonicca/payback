<script setup lang="ts">
import type { Expense, Trip, TripMember } from '@/types'

const props = defineProps<{
  expense: Expense
  tripMembers: TripMember[]
  trip: Trip
}>()

const sharedMembers = computed(() => props.tripMembers.filter(member => props.expense.sharedWithMemberIds.includes(member.id)))
const paidByMember = computed(() => props.tripMembers.find(member => member.id === props.expense.paidByMemberId))

// Check if expense was entered in home currency
const usedHomeCurrency = computed(() =>
  props.expense.inputCurrency && props.expense.inputCurrency === props.trip.defaultCurrency,
)
</script>

<template>
  <nuxt-link
    :to="`/trips/${trip.id}/expenses/${expense.id}`"
    :class="{ 'opacity-50': !expense.enabled }"
    class="flex items-center gap-3 py-3 px-2"
  >
    <!-- Payer avatar -->
    <member-avatar v-if="paidByMember" :emoji="paidByMember.avatarEmoji" size="md" />

    <!-- Description + meta -->
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-foreground m-0 line-clamp-2 leading-snug">
        {{ expense.description }}
        <Icon v-if="!expense.enabled" name="lucide:eye-off" class="w-3.5 h-3.5 text-muted-foreground inline-block align-text-top ml-0.5" />
      </p>
      <p class="text-xs text-muted-foreground m-0 mt-0.5">
        {{ expense.paidAtObject.month }}/{{ expense.paidAtObject.day }} {{ expense.paidAtObject.hour }}:{{ expense.paidAtObject.minute }}
        <span class="mx-1">·</span>
        {{ sharedMembers.length }}人分攤
      </p>
    </div>

    <!-- Amount (primary info — right-aligned, prominent) -->
    <div class="text-right shrink-0">
      <div v-if="usedHomeCurrency" class="text-sm font-mono font-bold text-primary">
        {{ trip.defaultCurrency }} {{ ((expense.grandTotal || 0) * trip.exchangeRate).toFixed(2) }}
      </div>
      <template v-else>
        <div class="text-sm font-mono font-bold text-foreground">
          {{ trip.tripCurrency }} {{ (expense.grandTotal || 0).toFixed(2) }}
        </div>
        <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-muted-foreground font-mono">
          ≈ {{ trip?.defaultCurrency }} {{ ((expense.grandTotal || 0) * trip.exchangeRate).toFixed(2) }}
        </div>
      </template>
    </div>
  </nuxt-link>
</template>
