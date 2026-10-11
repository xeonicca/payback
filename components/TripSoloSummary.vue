<script setup lang="ts">
import type { Trip } from '@/types'
import { computeSoloSummary } from '@/utils/soloSummary'

const props = defineProps<{
  trip: Trip
}>()

const { enabledExpenses } = useTripExpenses(props.trip.id)
const { hasDualCurrency, primaryCurrency, secondaryCurrency, toPrimary, toSecondary } = useCurrencyToggle(props.trip.id, toRef(props, 'trip'))

const summary = computed(() => computeSoloSummary(enabledExpenses.value, { now: new Date(), archived: props.trip.archived }))
</script>

<template>
  <div class="space-y-3">
    <div class="bg-card rounded-xl border p-5">
      <p class="text-xs text-muted-foreground mb-1">
        總花費
      </p>
      <p class="text-2xl font-bold font-mono text-foreground">
        {{ primaryCurrency }} {{ toPrimary(summary.total).toFixed(2) }}
      </p>
      <p v-if="hasDualCurrency" class="text-xs text-muted-foreground font-mono mt-0.5">
        ≈ {{ secondaryCurrency }} {{ toSecondary(summary.total).toFixed(2) }}
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="bg-card rounded-xl border p-4">
        <p class="text-xs text-muted-foreground mb-1">
          今日花費
        </p>
        <p class="text-lg font-bold font-mono text-foreground">
          {{ primaryCurrency }} {{ toPrimary(summary.today).toFixed(2) }}
        </p>
      </div>
      <div class="bg-card rounded-xl border p-4">
        <p class="text-xs text-muted-foreground mb-1">
          日均花費
        </p>
        <p class="text-lg font-bold font-mono text-primary">
          <template v-if="summary.dailyAverage !== null">
            {{ primaryCurrency }} {{ toPrimary(summary.dailyAverage).toFixed(2) }}
          </template>
          <template v-else>
            —
          </template>
        </p>
        <p v-if="summary.days > 0" class="text-xs text-muted-foreground">
          共 {{ summary.days }} 天
        </p>
      </div>
    </div>

    <nuxt-link
      v-if="summary.topCategory"
      :to="`/trips/${trip.id}/charts`"
      class="flex items-center justify-between bg-card rounded-xl border p-4 hover:bg-muted/50 transition-colors"
    >
      <span class="text-xs text-muted-foreground">最多花在</span>
      <span class="flex items-center gap-1">
        <category-chip :category="summary.topCategory" />
        <Icon name="lucide:chevron-right" :size="14" class="text-muted-foreground/60" />
      </span>
    </nuxt-link>
  </div>
</template>
