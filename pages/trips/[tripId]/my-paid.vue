<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params
const router = useRouter()

const { trip } = useTrip(tripId as string)
const { tripMembers, currentUserMember } = useTripMembers(tripId as string)
const { enabledExpenses } = useTripExpenses(tripId as string, 0)
const { showHomeCurrency, hasDualCurrency, primaryCurrency, secondaryCurrency, toPrimary, toSecondary } = useCurrencyToggle(tripId as string, trip)

const myPaidExpenses = computed(() => {
  if (!currentUserMember.value)
    return []
  return enabledExpenses.value.filter(e => e.paidByMemberId === currentUserMember.value!.id)
})

const myPaidTotal = computed(() =>
  myPaidExpenses.value.reduce((sum, e) => sum + e.grandTotal, 0),
)
</script>

<template>
  <template v-if="!trip">
    <div class="pt-6 space-y-4">
      <ui-skeleton class="h-8 w-48" />
      <ui-skeleton class="h-24 w-full rounded-xl" />
      <ui-skeleton class="h-32 w-full rounded-xl" />
    </div>
  </template>
  <template v-else>
    <!-- Header -->
    <div class="pb-4 max-w-3xl mx-auto">
      <button
        type="button"
        class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
        @click="router.push(`/trips/${tripId}`)"
      >
        <Icon name="lucide:arrow-left" :size="14" />
        {{ trip.name }}
      </button>
      <h1 class="text-xl font-bold text-foreground flex items-center gap-2">
        <member-avatar v-if="currentUserMember" :emoji="currentUserMember.avatarEmoji" size="md" />
        我支付的支出
      </h1>
      <p class="text-sm text-muted-foreground mt-1">
        共 {{ myPaidExpenses.length }} 筆
      </p>
    </div>

    <!-- Total card (sticky under navbar) -->
    <div
      v-if="currentUserMember"
      class="sticky z-10 -mx-6 px-6 pb-4 bg-slate-200 dark:bg-background"
      style="top: var(--navbar-height, 0px)"
    >
      <div class="max-w-3xl mx-auto bg-card rounded-xl border p-5 shadow-sm">
        <p class="text-xs text-muted-foreground mb-1">
          已支付總額
        </p>
        <p class="text-2xl font-bold font-mono text-foreground tracking-tight">
          {{ primaryCurrency }} {{ toPrimary(myPaidTotal).toFixed(2) }}
        </p>
        <p v-if="hasDualCurrency" class="text-xs text-muted-foreground font-mono mt-0.5">
          ≈ {{ secondaryCurrency }} {{ toSecondary(myPaidTotal).toFixed(2) }}
        </p>
      </div>
    </div>

    <!-- Expense list -->
    <div v-if="myPaidExpenses.length > 0" class="max-w-3xl mx-auto bg-card rounded-xl border p-4">
      <div class="divide-y divide-border">
        <expense-item
          v-for="expense in myPaidExpenses"
          :key="expense.id"
          :expense="expense"
          :trip-members="tripMembers"
          :trip="trip"
          :show-home-currency="showHomeCurrency"
          :primary-currency="primaryCurrency"
          :secondary-currency="secondaryCurrency"
        />
      </div>
    </div>

    <!-- Empty state -->
    <empty-state
      v-else-if="!currentUserMember"
      icon="lucide:user-x"
      title="尚未連結成員"
      description="你還沒有對應的旅程成員，無法顯示個人支付紀錄"
    />
    <empty-state
      v-else
      icon="lucide:receipt"
      title="尚無已支付的支出"
      description="這趟行程你還沒有支付任何費用"
    >
      <ui-button size="sm" @click="router.push(`/trips/${tripId}`)">
        <Icon name="lucide:arrow-left" :size="16" class="mr-1" />
        回到行程
      </ui-button>
    </empty-state>
  </template>
</template>
