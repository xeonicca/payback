<script setup lang="ts">
import { toast } from 'vue-sonner'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params

const { trip } = useTrip(tripId as string)
const { tripMembers, hostMember, currentUserMember } = useTripMembers(tripId as string)
const { enabledExpenses: recentExpenses } = useTripExpenses(tripId as string, 5)
const { canAddExpenses } = useTripCollaborators(tripId as string)

const { getMemberPaidAmount, getMemberOwedAmount } = useTripBalances(tripId as string)

const openAddExpenseDrawer = ref(false)

// Pre-compute balances to avoid repeated calculations in template
const memberBalances = computed(() => {
  const map: Record<string, { paid: number, owed: number, balance: number }> = {}
  for (const member of tripMembers.value) {
    const paid = getMemberPaidAmount(member.id)
    const owed = getMemberOwedAmount(member.id)
    map[member.id] = { paid, owed, balance: paid - owed }
  }
  return map
})

// Settlement suggestions: directed payments to settle all debts
const settlements = computed(() => {
  const results: Array<{ from: string, fromId: string, to: string, toId: string, amount: number }> = []

  const debtors = tripMembers.value
    .map(m => ({ ...m, balance: memberBalances.value[m.id]?.balance ?? 0 }))
    .filter(m => m.balance < -0.01)
    .sort((a, b) => a.balance - b.balance)

  const creditors = tripMembers.value
    .map(m => ({ ...m, balance: memberBalances.value[m.id]?.balance ?? 0 }))
    .filter(m => m.balance > 0.01)
    .sort((a, b) => b.balance - a.balance)

  // Greedy settlement
  const debtorBalances = debtors.map(d => ({ ...d, remaining: Math.abs(d.balance) }))
  const creditorBalances = creditors.map(c => ({ ...c, remaining: c.balance }))

  for (const debtor of debtorBalances) {
    for (const creditor of creditorBalances) {
      if (debtor.remaining < 0.01 || creditor.remaining < 0.01)
        continue
      const amount = Math.min(debtor.remaining, creditor.remaining)
      if (amount >= 0.01) {
        results.push({
          from: debtor.name,
          fromId: debtor.id,
          to: creditor.name,
          toId: creditor.id,
          amount,
        })
        debtor.remaining -= amount
        creditor.remaining -= amount
      }
    }
  }

  return results
})

// Current user's settlements (what they owe or are owed)
const mySettlements = computed(() => {
  if (!currentUserMember.value)
    return []
  const myId = currentUserMember.value.id
  return settlements.value.filter(s => s.fromId === myId || s.toId === myId)
})

// Check if trip exists after data loads
watch(trip, (tripValue) => {
  if (tripValue === null) {
    toast.error('行程不存在')
    navigateTo('/')
  }
}, { once: true })

function formatAmount(amount: number) {
  return Math.abs(amount).toFixed(2)
}

function formatConverted(amount: number) {
  if (!trip.value?.exchangeRate || trip.value.exchangeRate === 1)
    return null
  return (Math.abs(amount) * trip.value.exchangeRate).toFixed(2)
}
</script>

<template>
  <template v-if="!trip">
    <div class="pt-6 space-y-4">
      <ui-skeleton class="h-8 w-48" />
      <ui-skeleton class="h-32 w-full rounded-xl" />
      <ui-skeleton class="h-24 w-full rounded-xl" />
      <ui-skeleton class="h-24 w-full rounded-xl" />
    </div>
  </template>
  <template v-else>
    <!-- Page Header -->
    <div class="pb-2">
      <h1 class="text-xl font-bold text-foreground flex items-center gap-2">
        {{ trip.name }}
        <ui-badge v-if="trip.archived" variant="secondary" class="text-xs font-normal">
          <Icon name="lucide:archive" :size="12" class="mr-1" />
          已封存
        </ui-badge>
      </h1>
      <p class="text-sm text-muted-foreground">
        {{ trip.expenseCount }} 筆支出 · {{ tripMembers.length }} 位成員
      </p>
    </div>

    <!-- Desktop: two-column layout / Mobile: single column -->
    <div class="lg:grid lg:grid-cols-5 lg:gap-6">
      <!-- Left column: Personal summary + Overview -->
      <div class="lg:col-span-2 space-y-4">
        <!-- Personal Summary Card (shown when user is a linked member) -->
        <ui-card v-if="currentUserMember && memberBalances[currentUserMember.id]" class="border-primary/20">
          <ui-card-header>
            <div class="flex items-center gap-2">
              <member-avatar :emoji="currentUserMember.avatarEmoji" size="lg" />
              <div>
                <ui-card-title class="text-base">
                  {{ currentUserMember.name }}
                </ui-card-title>
                <ui-card-description>你的結算狀態</ui-card-description>
              </div>
            </div>
            <ui-card-action>
              <ui-badge
                :class="{
                  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400': memberBalances[currentUserMember.id].balance > 0.01,
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400': memberBalances[currentUserMember.id].balance < -0.01,
                }"
                :variant="Math.abs(memberBalances[currentUserMember.id].balance) <= 0.01 ? 'secondary' : undefined"
              >
                <span v-if="memberBalances[currentUserMember.id].balance > 0.01">應收款</span>
                <span v-else-if="memberBalances[currentUserMember.id].balance < -0.01">應付款</span>
                <span v-else>已結清</span>
              </ui-badge>
            </ui-card-action>
          </ui-card-header>
          <ui-card-content>
            <!-- Balance amount -->
            <div class="mb-4">
              <p
                :class="{
                  'text-green-600 dark:text-green-400': memberBalances[currentUserMember.id].balance > 0.01,
                  'text-red-600 dark:text-red-400': memberBalances[currentUserMember.id].balance < -0.01,
                  'text-muted-foreground': Math.abs(memberBalances[currentUserMember.id].balance) <= 0.01,
                }"
                class="text-2xl font-bold font-mono"
              >
                {{ memberBalances[currentUserMember.id].balance > 0.01 ? '+' : memberBalances[currentUserMember.id].balance < -0.01 ? '-' : '' }}{{ trip.tripCurrency }} {{ formatAmount(memberBalances[currentUserMember.id].balance) }}
              </p>
              <p v-if="formatConverted(memberBalances[currentUserMember.id].balance)" class="text-xs text-muted-foreground font-mono mt-0.5">
                ≈ {{ trip.defaultCurrency }} {{ formatConverted(memberBalances[currentUserMember.id].balance) }}
              </p>
            </div>

            <!-- Paid / Owed breakdown -->
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-muted/50 rounded-lg p-3">
                <p class="text-xs text-muted-foreground mb-0.5">
                  已支付
                </p>
                <p class="font-mono font-semibold text-foreground text-sm">
                  {{ trip.tripCurrency }} {{ memberBalances[currentUserMember.id].paid.toFixed(2) }}
                </p>
              </div>
              <div class="bg-muted/50 rounded-lg p-3">
                <p class="text-xs text-muted-foreground mb-0.5">
                  應分攤
                </p>
                <p class="font-mono font-semibold text-foreground text-sm">
                  {{ trip.tripCurrency }} {{ memberBalances[currentUserMember.id].owed.toFixed(2) }}
                </p>
              </div>
            </div>

            <!-- Settlement suggestions for current user -->
            <div v-if="mySettlements.length > 0" class="mt-4 space-y-2">
              <p class="text-xs font-medium text-muted-foreground">
                結算建議
              </p>
              <div
                v-for="(settlement, idx) in mySettlements"
                :key="idx"
                class="flex items-center gap-2 text-sm"
              >
                <template v-if="settlement.fromId === currentUserMember.id">
                  <span class="text-red-600 dark:text-red-400 font-medium">你</span>
                  <Icon name="lucide:arrow-right" class="size-3.5 text-muted-foreground" />
                  <span class="font-medium text-foreground">{{ settlement.to }}</span>
                  <span class="ml-auto font-mono font-semibold text-red-600 dark:text-red-400">
                    {{ trip.tripCurrency }} {{ settlement.amount.toFixed(2) }}
                  </span>
                </template>
                <template v-else>
                  <span class="font-medium text-foreground">{{ settlement.from }}</span>
                  <Icon name="lucide:arrow-right" class="size-3.5 text-muted-foreground" />
                  <span class="text-green-600 dark:text-green-400 font-medium">你</span>
                  <span class="ml-auto font-mono font-semibold text-green-600 dark:text-green-400">
                    {{ trip.tripCurrency }} {{ settlement.amount.toFixed(2) }}
                  </span>
                </template>
              </div>
            </div>
          </ui-card-content>
        </ui-card>

        <!-- Trip Overview — collapsible on mobile, always open on desktop -->
        <ui-accordion type="single" collapsible default-value="overview">
          <ui-accordion-item value="overview">
            <ui-accordion-trigger class="text-base font-bold text-foreground py-3 px-2 lg:pointer-events-none lg:[&>svg]:hidden">
              旅程總覽
            </ui-accordion-trigger>
            <ui-accordion-content>
              <div class="space-y-3 pb-2">
                <!-- Trip totals -->
                <div class="grid grid-cols-2 gap-3">
                  <div class="bg-card rounded-xl border p-4">
                    <p class="text-xs text-muted-foreground mb-1">
                      總支出
                    </p>
                    <p class="text-lg font-bold text-foreground font-mono">
                      {{ trip.tripCurrency }} {{ (trip.enabledTotalExpenses || 0).toFixed(2) }}
                    </p>
                    <p v-if="trip.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-muted-foreground font-mono">
                      ≈ {{ trip.defaultCurrency }} {{ ((trip.enabledTotalExpenses || 0) * trip.exchangeRate).toFixed(2) }}
                    </p>
                  </div>
                  <div class="bg-card rounded-xl border p-4">
                    <p class="text-xs text-muted-foreground mb-1">
                      平均每人
                    </p>
                    <p class="text-lg font-bold text-primary font-mono">
                      {{ trip.tripCurrency }} {{ tripMembers.length > 0 ? ((trip.enabledTotalExpenses || 0) / tripMembers.length).toFixed(2) : '0.00' }}
                    </p>
                    <p v-if="trip.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-muted-foreground font-mono">
                      ≈ {{ trip.defaultCurrency }} {{ tripMembers.length > 0 ? (((trip.enabledTotalExpenses || 0) / tripMembers.length) * trip.exchangeRate).toFixed(2) : '0.00' }}
                    </p>
                  </div>
                </div>

                <!-- All members balance list -->
                <div class="space-y-2">
                  <div
                    v-for="member in tripMembers"
                    :key="member.id"
                    class="bg-card rounded-xl border p-3"
                    :class="{ 'ring-1 ring-primary/20': currentUserMember?.id === member.id }"
                  >
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <member-avatar :emoji="member.avatarEmoji" size="md" />
                        <span class="text-sm font-semibold text-foreground">{{ member.name }}</span>
                        <ui-badge v-if="currentUserMember?.id === member.id" variant="secondary" class="text-[10px] px-1.5">
                          你
                        </ui-badge>
                      </div>
                      <ui-badge
                        :class="{
                          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400': (memberBalances[member.id]?.balance ?? 0) > 0.01,
                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400': (memberBalances[member.id]?.balance ?? 0) < -0.01,
                        }"
                        :variant="Math.abs(memberBalances[member.id]?.balance ?? 0) <= 0.01 ? 'secondary' : undefined"
                      >
                        <span v-if="(memberBalances[member.id]?.balance ?? 0) > 0.01">應收款</span>
                        <span v-else-if="(memberBalances[member.id]?.balance ?? 0) < -0.01">應付款</span>
                        <span v-else>已結清</span>
                      </ui-badge>
                    </div>

                    <div class="grid grid-cols-2 gap-2 text-xs">
                      <div class="bg-muted/50 rounded-lg p-2">
                        <p class="text-muted-foreground mb-0.5">
                          已支付
                        </p>
                        <p class="font-mono font-semibold text-foreground">
                          {{ trip.tripCurrency }} {{ (memberBalances[member.id]?.paid ?? 0).toFixed(2) }}
                        </p>
                        <p v-if="trip.exchangeRate && trip.exchangeRate !== 1" class="text-muted-foreground font-mono mt-0.5">
                          ≈ {{ trip.defaultCurrency }} {{ ((memberBalances[member.id]?.paid ?? 0) * trip.exchangeRate).toFixed(2) }}
                        </p>
                      </div>
                      <div class="bg-muted/50 rounded-lg p-2">
                        <p class="text-muted-foreground mb-0.5">
                          結算金額
                        </p>
                        <p
                          :class="{
                            'text-green-600 dark:text-green-400': (memberBalances[member.id]?.balance ?? 0) > 0.01,
                            'text-red-600 dark:text-red-400': (memberBalances[member.id]?.balance ?? 0) < -0.01,
                            'text-muted-foreground': Math.abs(memberBalances[member.id]?.balance ?? 0) <= 0.01,
                          }"
                          class="font-mono font-semibold"
                        >
                          {{ (memberBalances[member.id]?.balance ?? 0) > 0.01 ? '+' : (memberBalances[member.id]?.balance ?? 0) < -0.01 ? '-' : '' }}{{ trip.tripCurrency }} {{ formatAmount(memberBalances[member.id]?.balance ?? 0) }}
                        </p>
                        <p v-if="trip.exchangeRate && trip.exchangeRate !== 1" class="text-muted-foreground font-mono mt-0.5">
                          ≈ {{ trip.defaultCurrency }} {{ formatConverted(memberBalances[member.id]?.balance ?? 0) }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- All settlement suggestions -->
                <div v-if="settlements.length > 0" class="bg-card rounded-xl border p-4">
                  <p class="text-sm font-semibold text-foreground mb-3">
                    結算建議
                  </p>
                  <div class="space-y-2">
                    <div
                      v-for="(settlement, idx) in settlements"
                      :key="idx"
                      class="flex items-center gap-2 text-sm"
                    >
                      <span class="font-medium text-foreground">{{ settlement.from }}</span>
                      <Icon name="lucide:arrow-right" class="size-3.5 text-muted-foreground shrink-0" />
                      <span class="font-medium text-foreground">{{ settlement.to }}</span>
                      <span class="ml-auto font-mono font-semibold text-foreground">
                        {{ trip.tripCurrency }} {{ settlement.amount.toFixed(2) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </ui-accordion-content>
          </ui-accordion-item>
        </ui-accordion>
      </div>

      <!-- Right column: Recent Expenses -->
      <section class="mt-4 lg:mt-0 lg:col-span-3">
        <div class="flex items-center justify-between pl-2">
          <h2 class="text-base font-bold text-foreground">
            近期支出紀錄
          </h2>
          <ui-button
            v-if="!trip.archived && canAddExpenses"
            size="sm"
            @click="openAddExpenseDrawer = true"
          >
            <icon name="lucide:plus" size="16" />
          </ui-button>
          <ui-badge v-else-if="trip.archived" variant="secondary" class="text-xs">
            已封存
          </ui-badge>
        </div>
        <div v-if="recentExpenses.length > 0" class="mt-2 pb-4 px-4 pt-2 space-y-1 bg-card rounded-xl border">
          <template v-for="(expense, idx) in recentExpenses" :key="expense.id">
            <expense-item :expense="expense" :trip-members="tripMembers" :trip="trip!" />
            <ui-separator v-if="idx < recentExpenses.length - 1" />
          </template>
          <div class="flex items-center justify-end mt-4">
            <nuxt-link class="flex items-center gap-1 text-sm text-muted-foreground py-2" :to="`/trips/${tripId}/expenses`">
              查看所有支出
              <icon name="lucide:arrow-right" size="16" />
            </nuxt-link>
          </div>
        </div>
        <div v-else class="mt-2 px-4 py-6 bg-card rounded-xl border">
          <p class="text-sm text-muted-foreground">
            尚未有支出紀錄
          </p>
        </div>
      </section>
    </div>

    <add-expense-drawer
      v-model:open="openAddExpenseDrawer"
      :trip="trip"
      :trip-members="tripMembers"
      :default-payer-member="currentUserMember || hostMember"
      default-tab="manual"
    />
  </template>
</template>
