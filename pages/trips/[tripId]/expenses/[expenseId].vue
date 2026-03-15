<script setup lang="ts">
import type { Expense, Trip } from '@/types'
import { computedAsync } from '@vueuse/core'
import { deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { toast } from 'vue-sonner'
import { useDocument, useFirebaseStorage, useFirestore } from 'vuefire'
import EditExpenseForm from '@/components/EditExpenseForm.vue'
import ExpenseDetailItem from '@/components/ExpenseDetailItem.vue'
import { useTripMembers } from '@/composables/useTripMember'
import { expenseConverter, tripConverter } from '@/utils/converter'

definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})

const db = useFirestore()
const router = useRouter()
const { tripId, expenseId } = useRoute().params

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const expense = useDocument<Expense>(doc(db, 'trips', tripId as string, 'expenses', expenseId as string).withConverter(expenseConverter))
const { tripMembers } = useTripMembers(tripId as string)
const { canManageExpenses } = useTripCollaborators(tripId as string)

const sharedWithMembers = computed(() => tripMembers.value?.filter(member => expense.value?.sharedWithMemberIds.includes(member.id)))

// Check if trip/expense exists after data loads
watch([trip, expense], ([tripValue, expenseValue]) => {
  if (tripValue === null || expenseValue === null) {
    toast.error('支出不存在')
    navigateTo(`/trips/${tripId}`)
  }
}, { once: true })

const showEditDialog = ref(false)
const showDeleteDialog = ref(false)
const isDeleting = ref(false)
const isReanalyzing = ref(false)

const paidByMember = computed(() => tripMembers.value?.find(member => member.id === expense.value?.paidByMemberId))

const receiptImageUrl = computedAsync(async () => {
  const storage = useFirebaseStorage()
  const ref = storageRef(storage, expense.value?.receiptImageUrl)
  return await getDownloadURL(ref)
}, null)

const convertToDefaultCurrency = computed(() => {
  if (!expense.value?.grandTotal || !trip.value?.exchangeRate)
    return 0

  return Math.round(expense.value.grandTotal * trip.value.exchangeRate * 100) / 100
})

// Check if expense was entered in home currency
const usedHomeCurrency = computed(() =>
  expense.value?.inputCurrency && expense.value.inputCurrency === trip.value?.defaultCurrency,
)

const sharedTotalByMember = computed(() => {
  const sharedWithMemberIds = expense.value?.sharedWithMemberIds ?? []
  if (!expense.value?.items?.length) {
    return sharedWithMemberIds.reduce((acc, memberId) => {
      acc[memberId] = {
        total: expense.value!.grandTotal / sharedWithMemberIds.length,
        convertedTotal: expense.value!.grandTotal / sharedWithMemberIds.length * trip.value!.exchangeRate,
      }
      return acc
    }, {} as Record<string, { total: number, convertedTotal: number }>)
  }

  const memberTotals: Record<string, { total: number, convertedTotal: number }> = {}

  // Initialize all members with 0
  sharedWithMemberIds.forEach((memberId) => {
    memberTotals[memberId] = {
      total: 0,
      convertedTotal: 0,
    }
  })

  // Calculate totals for each item
  expense.value.items.forEach((item) => {
    let sharingMembers: string[]

    // If item has no specific sharedByMemberIds, all members share it
    if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
      sharingMembers = sharedWithMemberIds
    }
    else {
      // Only include members who are both in item sharing AND main expense sharing
      sharingMembers = item.sharedByMemberIds.filter(memberId =>
        sharedWithMemberIds.includes(memberId),
      )
    }

    // Skip if no members are sharing this item
    if (sharingMembers.length === 0)
      return

    // Calculate price per member for this item
    const pricePerMember = item.price * (item.quantity ?? 1) / sharingMembers.length

    // Add the price to each sharing member's total
    sharingMembers.forEach((memberId) => {
      memberTotals[memberId].total += pricePerMember
      memberTotals[memberId].convertedTotal += pricePerMember * trip.value!.exchangeRate
    })
  })

  return memberTotals
})

// Detailed breakdown by member
const memberItemBreakdown = computed(() => {
  const sharedWithMemberIds = expense.value?.sharedWithMemberIds ?? []
  const breakdown: Record<string, Array<{
    itemName: string
    itemPrice: number
    itemQuantity: number
    totalItemCost: number
    sharingMembers: string[]
    sharePerMember: number
  }>> = {}

  // Initialize breakdown for each member
  sharedWithMemberIds.forEach((memberId) => {
    breakdown[memberId] = []
  })

  if (!expense.value?.items?.length) {
    // If no items, split grand total equally
    const sharePerMember = expense.value!.grandTotal / sharedWithMemberIds.length
    sharedWithMemberIds.forEach((memberId) => {
      breakdown[memberId].push({
        itemName: '總金額平分',
        itemPrice: expense.value!.grandTotal,
        itemQuantity: 1,
        totalItemCost: expense.value!.grandTotal,
        sharingMembers: sharedWithMemberIds,
        sharePerMember,
      })
    })
    return breakdown
  }

  // Calculate breakdown for each item
  expense.value.items.forEach((item, index) => {
    let sharingMembers: string[]

    // If item has no specific sharedByMemberIds, all members share it
    if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
      sharingMembers = sharedWithMemberIds
    }
    else {
      // Only include members who are both in item sharing AND main expense sharing
      sharingMembers = item.sharedByMemberIds.filter(memberId =>
        sharedWithMemberIds.includes(memberId),
      )
    }

    // Skip if no members are sharing this item
    if (sharingMembers.length === 0)
      return

    const totalItemCost = item.price * (item.quantity ?? 1)
    const sharePerMember = totalItemCost / sharingMembers.length

    // Add this item breakdown to each sharing member
    sharingMembers.forEach((memberId) => {
      breakdown[memberId].push({
        itemName: item.name || `項目 ${index + 1}`,
        itemPrice: item.price,
        itemQuantity: item.quantity ?? 1,
        totalItemCost,
        sharingMembers,
        sharePerMember,
      })
    })
  })

  return breakdown
})

async function updateExpense(newValue: boolean) {
  if (!expense.value)
    return

  await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
    enabled: newValue,
  })

  if (newValue) {
    toast.success('支出已顯示')
  }
  else {
    toast.error('支出已隱藏')
  }
}

async function deleteExpense() {
  if (!expense.value)
    return

  try {
    isDeleting.value = true
    await deleteDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string))
    toast.success('已刪除支出')
    router.push(`/trips/${tripId}/expenses`)
  }
  catch (error) {
    console.error('Error deleting expense:', error)
    toast.error('刪除失敗')
  }
  finally {
    isDeleting.value = false
  }
}

async function reanalyzeReceipt() {
  if (!expense.value?.receiptImageUrl || expense.value?.isProcessing)
    return

  try {
    isReanalyzing.value = true
    const functions = getFunctions(undefined, 'us-west1')
    const reanalyze = httpsCallable(functions, 'reanalyzeReceipt-reanalyzeReceipt')
    await reanalyze({ tripId, expenseId })
    toast.success('收據重新分析完成')
  }
  catch (error: unknown) {
    console.error('Error reanalyzing receipt:', error)
    const errorMessage = error instanceof Error ? error.message : '未知錯誤'
    toast.error(`重新分析失敗: ${errorMessage}`)
  }
  finally {
    isReanalyzing.value = false
  }
}
</script>

<template>
  <!-- Top bar: visibility toggle + actions -->
  <div v-if="canManageExpenses" class="flex items-center justify-end gap-2 mb-2">
    <div class="flex items-center gap-2">
      <ui-label for="enabled" class="text-xs text-muted-foreground">
        {{ expense?.enabled ? '顯示中' : '已隱藏' }}
      </ui-label>
      <ui-switch id="enabled" :model-value="expense?.enabled ?? true" @update:model-value="updateExpense" />
    </div>
    <ui-dropdown-menu>
      <ui-dropdown-menu-trigger as-child>
        <ui-button variant="ghost" size="icon" class="size-8" aria-label="更多操作">
          <Icon name="lucide:more-vertical" :size="16" />
        </ui-button>
      </ui-dropdown-menu-trigger>
      <ui-dropdown-menu-content align="end">
        <ui-dropdown-menu-item @click="showEditDialog = true">
          <Icon name="lucide:edit-3" :size="14" class="mr-2" />
          編輯
        </ui-dropdown-menu-item>
        <ui-dropdown-menu-separator />
        <ui-dropdown-menu-item class="text-destructive" @click="showDeleteDialog = true">
          <Icon name="lucide:trash-2" :size="14" class="mr-2" />
          刪除
        </ui-dropdown-menu-item>
      </ui-dropdown-menu-content>
    </ui-dropdown-menu>
  </div>

  <!-- Amount + description -->
  <div class="mb-4">
    <h1 class="text-2xl font-bold font-mono">
      <template v-if="usedHomeCurrency">
        <span class="text-primary">{{ trip?.defaultCurrency }} {{ convertToDefaultCurrency.toFixed(2) }}</span>
      </template>
      <template v-else>
        <span class="text-primary">{{ trip?.tripCurrency }} {{ expense?.grandTotal.toFixed(2) }}</span>
        <span class="text-sm text-muted-foreground font-normal inline-flex items-center gap-1 ml-1">
          ≈ {{ trip?.defaultCurrency }} {{ convertToDefaultCurrency.toFixed(2) }}
        </span>
      </template>
    </h1>
    <p class="text-sm text-foreground mt-1">
      {{ expense?.description }}
    </p>
    <p class="text-xs text-muted-foreground mt-0.5">
      {{ expense?.paidAtString }}
    </p>
  </div>

  <div class="space-y-4">
    <div class="bg-card rounded-xl border p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-sm text-muted-foreground">
          付款人
        </div>
        <div class="flex items-center gap-2">
          <member-avatar v-if="paidByMember" :emoji="paidByMember.avatarEmoji" size="sm" />
          <span class="font-bold text-foreground">{{ paidByMember?.name }}</span>
        </div>
      </div>
      <ui-separator />
      <div v-if="Object.keys(sharedTotalByMember).length > 0" class="space-y-2">
        <div class="text-sm text-muted-foreground">
          成員分攤明細
        </div>
        <ui-accordion type="multiple" class="space-y-2">
          <ui-accordion-item
            v-for="member in sharedWithMembers"
            :key="member.id"
            :value="member.id"
            class="bg-muted/50 rounded-lg border-0"
          >
            <ui-accordion-trigger class="flex items-center justify-between py-2 px-3 hover:no-underline">
              <div class="flex flex-1 items-center justify-between py-2 hover:no-underline">
                <div class="flex items-center gap-2">
                  <member-avatar :emoji="member.avatarEmoji" size="sm" />
                  <span class="text-sm font-medium text-foreground">{{ member.name }}</span>
                </div>
                <div class="text-right mr-4">
                  <div v-if="usedHomeCurrency" class="text-sm font-mono text-primary">
                    {{ trip?.defaultCurrency }} {{ sharedTotalByMember[member.id].convertedTotal.toFixed(2) || '0.00' }}
                  </div>
                  <template v-else>
                    <div class="text-sm font-mono text-green-600 dark:text-green-400">
                      {{ trip?.tripCurrency }} {{ sharedTotalByMember[member.id].total.toFixed(2) || '0.00' }}
                    </div>
                    <div v-if="trip?.exchangeRate && trip.exchangeRate !== 1" class="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Icon name="lucide:equal-approximately" class="text-muted-foreground" size="12" />
                      <p>{{ trip?.defaultCurrency }} {{ (sharedTotalByMember[member.id].convertedTotal).toFixed(2) }}</p>
                    </div>
                  </template>
                </div>
              </div>
            </ui-accordion-trigger>
            <ui-accordion-content class="px-3 pb-3">
              <div class="space-y-2 text-xs">
                <div
                  v-for="(item, index) in memberItemBreakdown[member.id] || []"
                  :key="index"
                  class="flex justify-between items-center py-1 px-2 bg-accent rounded gap-4"
                >
                  <div class="flex-1">
                    <span class="font-mono text-foreground">{{ item.itemName }}</span>
                    <p class="text-muted-foreground">
                      ({{ usedHomeCurrency ? trip?.defaultCurrency : trip?.tripCurrency }} {{ (usedHomeCurrency ? item.itemPrice * (trip?.exchangeRate || 1) : item.itemPrice).toFixed(2) }} × {{ item.itemQuantity }} ÷ {{ item.sharingMembers.length }}人)
                    </p>
                  </div>
                  <div class="text-right font-mono" :class="usedHomeCurrency ? 'text-primary' : 'text-green-600 dark:text-green-400'">
                    {{ usedHomeCurrency ? trip?.defaultCurrency : trip?.tripCurrency }} {{ (usedHomeCurrency ? item.sharePerMember * (trip?.exchangeRate || 1) : item.sharePerMember).toFixed(2) }}
                  </div>
                </div>
                <div class="border-t border-border pt-1 flex justify-between items-center font-bold text-foreground">
                  <span>小計:</span>
                  <span :class="usedHomeCurrency ? 'text-primary' : 'text-green-600 dark:text-green-400'">
                    {{ usedHomeCurrency ? trip?.defaultCurrency : trip?.tripCurrency }} {{ ((memberItemBreakdown[member.id] || []).reduce((sum, item) => sum + item.sharePerMember, 0) * (usedHomeCurrency ? (trip?.exchangeRate || 1) : 1)).toFixed(2) }}
                  </span>
                </div>
              </div>
            </ui-accordion-content>
          </ui-accordion-item>
        </ui-accordion>
      </div>

      <ui-separator />
      <template v-if="expense?.items?.length">
        <div class="text-sm text-muted-foreground">
          購買明細
        </div>
        <div class="space-y-1">
          <expense-detail-item
            v-for="item in expense.items"
            :key="item.name"
            :item="item"
            :currency="trip?.tripCurrency || ''"
            :exchange-rate="trip?.exchangeRate || 1"
            :default-currency="trip?.defaultCurrency || 'TWD'"
            :edit-mode="false"
            :trip-members="tripMembers"
            :shareable-members="sharedWithMembers"
            :shared-by-member-ids="item.sharedByMemberIds"
          />
        </div>
      </template>

      <template v-if="receiptImageUrl">
        <ui-separator />
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm text-muted-foreground">
              收據圖片
            </div>
            <ui-button
              v-if="canManageExpenses && !expense?.isProcessing"
              variant="outline"
              size="sm"
              :disabled="isReanalyzing"
              class="flex items-center gap-2"
              @click="reanalyzeReceipt"
            >
              <Icon
                :name="isReanalyzing ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                :size="14"
                :class="{ 'animate-spin': isReanalyzing }"
              />
              {{ isReanalyzing ? '分析中...' : '重新分析收據' }}
            </ui-button>
            <div v-else-if="expense?.isProcessing" class="flex items-center gap-2 text-sm text-amber-600">
              <Icon name="lucide:loader-2" :size="14" class="animate-spin" />
              處理中...
            </div>
          </div>
          <div class="grid gap-2">
            <img :src="receiptImageUrl" alt="收據圖片" loading="lazy" class="w-full max-h-96 object-contain rounded-lg">
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- Edit Expense Dialog -->
  <ui-drawer v-if="canManageExpenses" v-model:open="showEditDialog">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm">
        <edit-expense-form
          v-if="expense && trip"
          :expense="expense"
          :trip="trip"
          :trip-members="tripMembers"
          @close="showEditDialog = false"
        />
      </div>
    </ui-drawer-content>
  </ui-drawer>

  <!-- Delete Expense Confirmation Dialog -->
  <ui-alert-dialog v-if="canManageExpenses" v-model:open="showDeleteDialog">
    <ui-alert-dialog-content>
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>刪除支出</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          確定要刪除「{{ expense?.description }}」嗎？此操作無法復原。
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-alert-dialog-cancel :disabled="isDeleting">
          取消
        </ui-alert-dialog-cancel>
        <ui-button variant="destructive" :disabled="isDeleting" @click="deleteExpense">
          <Icon v-if="isDeleting" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isDeleting ? '刪除中...' : '刪除' }}
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>
</template>
