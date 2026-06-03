<script setup lang="ts">
import type { Expense, ExpenseDetailItem } from '@/types'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const { tripId } = useRoute().params
const router = useRouter()

const { trip } = useTrip(tripId as string)
const { currentUserMember } = useTripMembers(tripId as string)
const { enabledExpenses } = useTripExpenses(tripId as string, 0)
const { hasDualCurrency, primaryCurrency, secondaryCurrency, toPrimary, toSecondary } = useCurrencyToggle(tripId as string, trip)

interface SpentLine {
  item: ExpenseDetailItem | null // null = whole-expense split (no items)
  share: number // user's portion in trip currency (raw, item-level basis)
}

interface SpentGroup {
  expense: Expense
  lines: SpentLine[]
  total: number // proportional total matching useTripBalances (includes tax/tip)
}

// Compute, per expense the user shares, the items they consumed and proportional total.
// Mirrors useTripBalances.getMemberOwedAmount so totals stay in sync.
const spentGroups = computed<SpentGroup[]>(() => {
  const myId = currentUserMember.value?.id
  if (!myId)
    return []

  const groups: SpentGroup[] = []

  for (const expense of enabledExpenses.value) {
    const lines: SpentLine[] = []
    let total = 0

    if (expense.items && expense.items.length > 0) {
      const itemsTotal = expense.items.reduce(
        (sum, item) => sum + (item.price * (item.quantity || 1)),
        0,
      )

      if (itemsTotal > 0) {
        let myItemsTotal = 0
        for (const item of expense.items) {
          let sharingMembers: string[] = []
          if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
            sharingMembers = expense.sharedWithMemberIds
          }
          else {
            sharingMembers = item.sharedByMemberIds.filter(id =>
              expense.sharedWithMemberIds.includes(id),
            )
          }

          if (sharingMembers.length === 0 || !sharingMembers.includes(myId))
            continue

          const lineTotal = item.price * (item.quantity || 1)
          const myShare = lineTotal / sharingMembers.length
          myItemsTotal += myShare
          lines.push({ item, share: myShare })
        }

        if (lines.length === 0)
          continue

        const proportion = myItemsTotal / itemsTotal
        total = expense.grandTotal * proportion
      }
      else {
        // Items have no usable prices — fall back to flat split
        if (!expense.sharedWithMemberIds.includes(myId))
          continue
        const share = expense.grandTotal / expense.sharedWithMemberIds.length
        lines.push({ item: null, share })
        total = share
      }
    }
    else {
      if (!expense.sharedWithMemberIds.includes(myId))
        continue
      const share = expense.grandTotal / expense.sharedWithMemberIds.length
      lines.push({ item: null, share })
      total = share
    }

    groups.push({ expense, lines, total })
  }

  return groups
})

const myTotalSpent = computed(() =>
  spentGroups.value.reduce((sum, g) => sum + g.total, 0),
)

const myItemCount = computed(() =>
  spentGroups.value.reduce((sum, g) => sum + g.lines.filter(l => l.item).length, 0),
)

function sharingMembersForItem(expense: Expense, item: ExpenseDetailItem): string[] {
  if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0)
    return expense.sharedWithMemberIds
  return item.sharedByMemberIds.filter(id => expense.sharedWithMemberIds.includes(id))
}

function rateFor(expense: Expense) {
  return expense.exchangeRate ?? trip.value?.exchangeRate ?? 1
}
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
        我花費的項目
      </h1>
      <p class="text-sm text-muted-foreground mt-1">
        {{ spentGroups.length }} 筆支出 · {{ myItemCount }} 項商品
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
          已花費總額
        </p>
        <p class="text-2xl font-bold font-mono text-foreground tracking-tight">
          {{ primaryCurrency }} {{ toPrimary(myTotalSpent).toFixed(2) }}
        </p>
        <p v-if="hasDualCurrency" class="text-xs text-muted-foreground font-mono mt-0.5">
          ≈ {{ secondaryCurrency }} {{ toSecondary(myTotalSpent).toFixed(2) }}
        </p>
        <p class="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          分攤金額包含稅金、服務費等比例分配；下方品項顯示原價及分攤後金額。
        </p>
      </div>
    </div>

    <!-- Spent groups -->
    <div v-if="spentGroups.length > 0" class="max-w-3xl mx-auto space-y-3">
      <nuxt-link
        v-for="group in spentGroups"
        :key="group.expense.id"
        :to="`/trips/${tripId}/expenses/${group.expense.id}`"
        class="block bg-card rounded-xl border p-4 hover:border-slate-300 hover:shadow-sm transition-all group"
      >
        <!-- Expense header -->
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-foreground truncate group-hover:underline">
              {{ group.expense.description || '未命名支出' }}
            </p>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ group.expense.paidAtString }}
            </p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xs text-muted-foreground">
              我分攤
            </p>
            <p class="font-mono font-semibold text-foreground text-sm">
              {{ primaryCurrency }} {{ toPrimary(group.total, rateFor(group.expense)).toFixed(2) }}
            </p>
            <p v-if="hasDualCurrency" class="text-[11px] text-muted-foreground font-mono">
              ≈ {{ secondaryCurrency }} {{ toSecondary(group.total, rateFor(group.expense)).toFixed(2) }}
            </p>
          </div>
        </div>

        <!-- Item lines -->
        <ul class="space-y-1.5">
          <li
            v-for="(line, idx) in group.lines"
            :key="idx"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <div class="min-w-0 flex-1 flex items-center gap-2">
              <Icon name="lucide:dot" :size="16" class="text-muted-foreground/60 shrink-0" />
              <template v-if="line.item">
                <span class="truncate text-foreground">
                  {{ line.item.name || '項目' }}
                </span>
                <span v-if="(line.item.quantity ?? 1) > 1" class="text-muted-foreground shrink-0">
                  ×{{ line.item.quantity }}
                </span>
                <span
                  v-if="line.item.sharedByMemberIds && line.item.sharedByMemberIds.length > 0"
                  class="text-muted-foreground shrink-0"
                >
                  · 與 {{ sharingMembersForItem(group.expense, line.item).length }} 人分
                </span>
              </template>
              <template v-else>
                <span class="text-muted-foreground italic">
                  整筆支出平均分攤
                </span>
              </template>
            </div>
            <span class="font-mono text-muted-foreground shrink-0">
              {{ primaryCurrency }} {{ toPrimary(line.share, rateFor(group.expense)).toFixed(2) }}
            </span>
          </li>
        </ul>
      </nuxt-link>
    </div>

    <!-- Empty states -->
    <empty-state
      v-else-if="!currentUserMember"
      icon="lucide:user-x"
      title="尚未連結成員"
      description="你還沒有對應的旅程成員，無法顯示個人花費紀錄"
    />
    <empty-state
      v-else
      icon="lucide:shopping-basket"
      title="尚無花費紀錄"
      description="你還沒有任何分攤的項目"
    >
      <ui-button size="sm" @click="router.push(`/trips/${tripId}`)">
        <Icon name="lucide:arrow-left" :size="16" class="mr-1" />
        回到行程
      </ui-button>
    </empty-state>
  </template>
</template>
