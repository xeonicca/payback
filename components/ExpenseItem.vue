<script setup lang="ts">
import type { Expense, Trip, TripMember } from '@/types'

const props = defineProps<{
  expense: Expense
  tripMembers: TripMember[]
  trip: Trip
  primaryCurrency?: string
  secondaryCurrency?: string
  showHomeCurrency?: boolean
}>()

const sharedMembers = computed(() => props.tripMembers.filter(member => props.expense.sharedWithMemberIds.includes(member.id)))
const paidByMember = computed(() => props.tripMembers.find(member => member.id === props.expense.paidByMemberId))

// Check if expense was entered in home currency
const usedHomeCurrency = computed(() =>
  props.expense.inputCurrency && props.expense.inputCurrency === props.trip.defaultCurrency,
)

const hasDualCurrency = computed(() => !!props.trip.exchangeRate && props.trip.exchangeRate !== 1)

// Amount in trip currency (storage format)
const tripCurrencyAmount = computed(() => props.expense.grandTotal || 0)
// Amount in home currency
const homeCurrencyAmount = computed(() => {
  const rate = props.expense.exchangeRate ?? props.trip.exchangeRate
  return tripCurrencyAmount.value * rate
})

const displayPrimary = computed(() => {
  if (usedHomeCurrency.value) {
    return { currency: props.trip.defaultCurrency, amount: homeCurrencyAmount.value }
  }
  if (props.showHomeCurrency) {
    return { currency: props.trip.defaultCurrency, amount: homeCurrencyAmount.value }
  }
  return { currency: props.trip.tripCurrency, amount: tripCurrencyAmount.value }
})

const displaySecondary = computed(() => {
  if (usedHomeCurrency.value) return null
  if (!hasDualCurrency.value) return null
  if (props.showHomeCurrency) {
    return { currency: props.trip.tripCurrency, amount: tripCurrencyAmount.value }
  }
  return { currency: props.trip.defaultCurrency, amount: homeCurrencyAmount.value }
})
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
        <span v-if="paidByMember" class="hidden lg:inline">{{ paidByMember.name }} 付款 · </span>
        {{ sharedMembers.length }}人分攤
      </p>
    </div>

    <!-- Shared member avatars — desktop only -->
    <div class="hidden lg:flex items-center gap-0.5 shrink-0">
      <member-avatar
        v-for="member in sharedMembers.slice(0, 4)"
        :key="member.id"
        :emoji="member.avatarEmoji"
        size="sm"
      />
      <span v-if="sharedMembers.length > 4" class="text-xs text-muted-foreground ml-1">
        +{{ sharedMembers.length - 4 }}
      </span>
    </div>

    <!-- Amount (primary info — right-aligned, prominent) -->
    <div class="text-right shrink-0">
      <div class="text-sm font-mono font-bold" :class="usedHomeCurrency ? 'text-primary' : 'text-foreground'">
        {{ displayPrimary.currency }} {{ displayPrimary.amount.toFixed(2) }}
      </div>
      <div v-if="displaySecondary" class="text-xs text-muted-foreground font-mono">
        ≈ {{ displaySecondary.currency }} {{ displaySecondary.amount.toFixed(2) }}
      </div>
    </div>
  </nuxt-link>
</template>
