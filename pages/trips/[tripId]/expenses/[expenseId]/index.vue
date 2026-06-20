<script setup lang="ts">
import type { Expense, ExpenseDetailItem, Trip } from '@/types'
import { computedAsync } from '@vueuse/core'
import { deleteDoc, deleteField, doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { toast } from 'vue-sonner'
import { useDocument, useFirebaseStorage, useFirestore } from 'vuefire'
import { useTripMembers } from '@/composables/useTripMember'
import { expenseConverter, tripConverter } from '@/utils/converter'
import { applyDiscount } from '@/utils/discount'
import { applyTaxDeduction } from '@/utils/tax'

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
const { canEditExpense, canDeleteExpense, collaborators } = useTripCollaborators(tripId as string)
const { hasDualCurrency, primaryCurrency, secondaryCurrency, toPrimary, toSecondary } = useCurrencyToggle(tripId as string, trip)

const canEditThisExpense = computed(() => expense.value ? canEditExpense(expense.value) : false)
const canDeleteThisExpense = computed(() => expense.value ? canDeleteExpense(expense.value) : false)

const sharedWithMembers = computed(() => tripMembers.value?.filter(member => expense.value?.sharedWithMemberIds.includes(member.id)))

// Check if trip/expense exists after data loads
watch([trip, expense], ([tripValue, expenseValue]) => {
  if (tripValue === null || expenseValue === null) {
    toast.error('支出不存在')
    navigateTo(`/trips/${tripId}`)
  }
}, { once: true })

const showDeleteDialog = ref(false)
const isDeleting = ref(false)
const isReanalyzing = ref(false)
const editingItemIndex = ref<number | null>(null)
const isSavingItem = ref(false)
const isAddingItem = ref(false)
const splittingItemIndex = ref<number | null>(null)
const isSplittingItem = ref(false)
const isEditingBasics = ref(false)
const isSavingBasics = ref(false)
const isEditingSharers = ref(false)
const isSavingSharers = ref(false)
const showTaxDeductionDialog = ref(false)
const showRevertTaxDialog = ref(false)
const isApplyingTax = ref(false)
const isRevertingTax = ref(false)
const showDiscountDialog = ref(false)
const showRevertDiscountDialog = ref(false)
const isApplyingDiscount = ref(false)
const isRevertingDiscount = ref(false)
const isReceiptViewerOpen = ref(false)

const sessionUser = useSessionUser()

const hasTaxDeduction = computed(() => expense.value?.taxDeductionPercentage != null)
const hasDiscount = computed(() => expense.value?.discountPercentage != null)

const editingItem = computed(() =>
  editingItemIndex.value !== null ? (expense.value?.items?.[editingItemIndex.value] ?? null) : null,
)

const splittingItem = computed(() =>
  splittingItemIndex.value !== null ? (expense.value?.items?.[splittingItemIndex.value] ?? null) : null,
)

function closeItemEditDialog() {
  editingItemIndex.value = null
  isAddingItem.value = false
}

async function saveBasics(payload: {
  description: string
  grandTotal: number | null
  inputCurrency: string
  exchangeRate: number
  paidAt: Date
  paidByMemberId: string
  category: string
}) {
  if (!expense.value)
    return
  try {
    isSavingBasics.value = true
    const update: Record<string, unknown> = {
      description: payload.description,
      inputCurrency: payload.inputCurrency,
      exchangeRate: payload.exchangeRate,
      paidAt: Timestamp.fromDate(payload.paidAt),
      paidByMemberId: payload.paidByMemberId,
      category: payload.category || deleteField(),
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    }
    if (payload.grandTotal !== null)
      update.grandTotal = payload.grandTotal
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), update)
    isEditingBasics.value = false
    toast.success('已更新支出')
  }
  catch (error) {
    console.error('Error updating expense basics:', error)
    toast.error('更新失敗')
  }
  finally {
    isSavingBasics.value = false
  }
}

async function saveSharers(sharedWithMemberIds: string[]) {
  if (!expense.value)
    return
  try {
    isSavingSharers.value = true
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      sharedWithMemberIds,
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    isEditingSharers.value = false
    toast.success('已更新分攤成員')
  }
  catch (error) {
    console.error('Error updating sharers:', error)
    toast.error('更新失敗')
  }
  finally {
    isSavingSharers.value = false
  }
}

async function deleteItem(index: number) {
  if (!expense.value)
    return
  try {
    isSavingItem.value = true
    const items = [...(expense.value.items ?? [])]
    items.splice(index, 1)
    const update: Record<string, unknown> = {
      items,
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    }
    // Only recalc grandTotal when items remain — keep the existing total when
    // removing the last item, matching the edit page's behavior.
    if (items.length > 0) {
      update.grandTotal = Math.round(items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0) * 100) / 100
    }
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), update)
    editingItemIndex.value = null
    toast.success('已刪除項目')
  }
  catch (error) {
    console.error('Error deleting item:', error)
    toast.error('刪除失敗')
  }
  finally {
    isSavingItem.value = false
  }
}

async function addItem(newItem: ExpenseDetailItem) {
  if (!expense.value)
    return
  try {
    isSavingItem.value = true
    const items = [...(expense.value.items ?? []), newItem]
    const grandTotal = Math.round(items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0) * 100) / 100
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items,
      grandTotal,
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    isAddingItem.value = false
    toast.success('已新增項目')
  }
  catch (error) {
    console.error('Error adding item:', error)
    toast.error('新增失敗')
  }
  finally {
    isSavingItem.value = false
  }
}

async function splitItem(originalIndex: number, splitQuantity: number, splitMemberIds: string[]) {
  if (!expense.value)
    return
  const items = expense.value.items ?? []
  const original = items[originalIndex]
  if (!original)
    return
  const originalQuantity = original.quantity ?? 1
  if (!Number.isInteger(splitQuantity) || splitQuantity < 1 || splitQuantity >= originalQuantity)
    return

  const expenseSharers = expense.value.sharedWithMemberIds ?? []
  const originalEffective = original.sharedByMemberIds && original.sharedByMemberIds.length > 0
    ? original.sharedByMemberIds
    : expenseSharers
  const splitSet = new Set(splitMemberIds)
  const remainingShared = originalEffective.filter(id => !splitSet.has(id))
  if (remainingShared.length === 0)
    return

  const expenseSharerSet = new Set(expenseSharers)
  const isAllExpenseSharers = (ids: string[]) =>
    ids.length === expenseSharers.length && ids.every(id => expenseSharerSet.has(id))

  const updatedOriginal: ExpenseDetailItem = {
    ...original,
    quantity: originalQuantity - splitQuantity,
    sharedByMemberIds: isAllExpenseSharers(remainingShared) ? [] : remainingShared,
  }
  const newItem: ExpenseDetailItem = {
    name: original.name,
    price: original.price,
    quantity: splitQuantity,
    ...(original.translatedName ? { translatedName: original.translatedName } : {}),
    sharedByMemberIds: isAllExpenseSharers(splitMemberIds) ? [] : [...splitMemberIds],
  }

  const updatedItems = [...items]
  updatedItems[originalIndex] = updatedOriginal
  updatedItems.splice(originalIndex + 1, 0, newItem)

  try {
    isSplittingItem.value = true
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items: updatedItems,
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    splittingItemIndex.value = null
    toast.success('已拆分項目')
  }
  catch (error) {
    console.error('Error splitting item:', error)
    toast.error('拆分失敗')
  }
  finally {
    isSplittingItem.value = false
  }
}

async function saveItem(index: number, updated: ExpenseDetailItem) {
  if (!expense.value)
    return
  try {
    isSavingItem.value = true
    const items = [...(expense.value.items ?? [])]
    items[index] = updated
    const grandTotal = Math.round(items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0) * 100) / 100
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items,
      grandTotal,
      lastEditedAt: serverTimestamp(),
    })
    editingItemIndex.value = null
  }
  catch (error) {
    console.error('Error saving item:', error)
    toast.error('儲存失敗')
  }
  finally {
    isSavingItem.value = false
  }
}

const paidByMember = computed(() => tripMembers.value?.find(member => member.id === expense.value?.paidByMemberId))

const createdByName = computed(() => {
  const uid = expense.value?.createdByUserId
  if (!uid)
    return null
  // Try collaborator display name first, fall back to linked member name
  const collaborator = collaborators.value.find(c => c.userId === uid)
  if (collaborator?.displayName)
    return collaborator.displayName
  const member = tripMembers.value?.find(m => m.linkedUserId === uid)
  return member?.name || null
})

const receiptImageUrl = computedAsync(async () => {
  const storage = useFirebaseStorage()
  const ref = storageRef(storage, expense.value?.receiptImageUrl)
  return await getDownloadURL(ref)
}, null)

const convertToDefaultCurrency = computed(() => {
  if (!expense.value?.grandTotal)
    return 0
  const rate = expense.value.exchangeRate ?? trip.value?.exchangeRate ?? 1
  return Math.round(expense.value.grandTotal * rate * 100) / 100
})

// Check if expense was entered in home currency
const usedHomeCurrency = computed(() =>
  expense.value?.inputCurrency && expense.value.inputCurrency === trip.value?.defaultCurrency,
)

const sharedTotalByMember = computed(() => {
  const sharedWithMemberIds = expense.value?.sharedWithMemberIds ?? []
  const rate = expense.value?.exchangeRate ?? trip.value?.exchangeRate ?? 1
  if (!expense.value?.items?.length) {
    return sharedWithMemberIds.reduce((acc, memberId) => {
      acc[memberId] = {
        total: expense.value!.grandTotal / sharedWithMemberIds.length,
        convertedTotal: expense.value!.grandTotal / sharedWithMemberIds.length * rate,
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
      memberTotals[memberId].convertedTotal += pricePerMember * rate
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
    toast.success('支出已隱藏')
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

async function applyTaxDeductionToExpense(percentage: number) {
  if (!expense.value?.items?.length)
    return
  try {
    isApplyingTax.value = true
    const sourceItems = expense.value.originalItems ?? expense.value.items
    const sourceGrandTotal = expense.value.originalGrandTotal ?? expense.value.grandTotal
    const { items, grandTotal } = applyTaxDeduction(sourceItems, percentage)
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items,
      grandTotal,
      originalItems: sourceItems,
      originalGrandTotal: sourceGrandTotal,
      taxDeductionPercentage: percentage,
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    showTaxDeductionDialog.value = false
    toast.success(`已扣除 ${percentage}% 消費稅`)
  }
  catch (error) {
    console.error('Error applying tax deduction:', error)
    toast.error('套用失敗')
  }
  finally {
    isApplyingTax.value = false
  }
}

async function revertTaxDeduction() {
  if (!expense.value?.originalItems || expense.value.originalGrandTotal == null)
    return
  try {
    isRevertingTax.value = true
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items: expense.value.originalItems,
      grandTotal: expense.value.originalGrandTotal,
      originalItems: deleteField(),
      originalGrandTotal: deleteField(),
      taxDeductionPercentage: deleteField(),
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    showRevertTaxDialog.value = false
    toast.success('已還原原始金額')
  }
  catch (error) {
    console.error('Error reverting tax deduction:', error)
    toast.error('還原失敗')
  }
  finally {
    isRevertingTax.value = false
  }
}

async function applyDiscountToExpense(percentage: number) {
  if (!expense.value?.items?.length)
    return
  try {
    isApplyingDiscount.value = true
    const sourceItems = expense.value.discountOriginalItems ?? expense.value.items
    const sourceGrandTotal = expense.value.discountOriginalGrandTotal ?? expense.value.grandTotal
    const { items, grandTotal } = applyDiscount(sourceItems, percentage)
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items,
      grandTotal,
      discountOriginalItems: sourceItems,
      discountOriginalGrandTotal: sourceGrandTotal,
      discountPercentage: percentage,
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    showDiscountDialog.value = false
    toast.success(`已套用 ${percentage}% 折扣`)
  }
  catch (error) {
    console.error('Error applying discount:', error)
    toast.error('套用失敗')
  }
  finally {
    isApplyingDiscount.value = false
  }
}

async function revertDiscount() {
  if (!expense.value?.discountOriginalItems || expense.value.discountOriginalGrandTotal == null)
    return
  try {
    isRevertingDiscount.value = true
    await updateDoc(doc(db, 'trips', tripId as string, 'expenses', expenseId as string), {
      items: expense.value.discountOriginalItems,
      grandTotal: expense.value.discountOriginalGrandTotal,
      discountOriginalItems: deleteField(),
      discountOriginalGrandTotal: deleteField(),
      discountPercentage: deleteField(),
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    showRevertDiscountDialog.value = false
    toast.success('已還原折扣前金額')
  }
  catch (error) {
    console.error('Error reverting discount:', error)
    toast.error('還原失敗')
  }
  finally {
    isRevertingDiscount.value = false
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
  <!-- Loading state -->
  <template v-if="!expense || !trip">
    <div class="space-y-3 pt-2">
      <ui-skeleton class="h-8 w-40" />
      <ui-skeleton class="h-4 w-64" />
      <ui-skeleton class="h-4 w-32" />
      <ui-skeleton class="h-48 w-full rounded-xl mt-4" />
    </div>
  </template>
  <template v-else>
    <!-- Top bar: back + visibility + actions -->
    <div class="flex items-center justify-between mb-2">
      <ui-button
        class="text-muted-foreground flex items-center gap-1 px-0"
        variant="link"
        size="sm"
        @click="router.back()"
      >
        <Icon name="lucide:arrow-left" :size="16" /> 上一頁
      </ui-button>
      <div v-if="canEditThisExpense && !trip?.archived" class="flex items-center gap-2">
        <ui-label for="enabled" class="text-xs text-muted-foreground">
          {{ expense?.enabled ? '顯示中' : '已隱藏' }}
        </ui-label>
        <ui-switch id="enabled" :model-value="expense?.enabled ?? true" @update:model-value="updateExpense" />
        <ui-dropdown-menu>
          <ui-dropdown-menu-trigger as-child>
            <ui-button variant="ghost" size="icon" class="size-8" aria-label="更多操作">
              <Icon name="lucide:more-vertical" :size="16" />
            </ui-button>
          </ui-dropdown-menu-trigger>
          <ui-dropdown-menu-content align="end">
            <ui-dropdown-menu-item v-if="hasTaxDeduction" @click="showRevertTaxDialog = true">
              <Icon name="lucide:rotate-ccw" :size="14" class="mr-2" />
              還原消費稅 ({{ expense?.taxDeductionPercentage }}%)
            </ui-dropdown-menu-item>
            <ui-dropdown-menu-item v-else :disabled="!expense?.items?.length" @click="showTaxDeductionDialog = true">
              <Icon name="lucide:percent" :size="14" class="mr-2" />
              扣除消費稅
            </ui-dropdown-menu-item>
            <ui-dropdown-menu-item v-if="hasDiscount" @click="showRevertDiscountDialog = true">
              <Icon name="lucide:rotate-ccw" :size="14" class="mr-2" />
              還原折扣 ({{ expense?.discountPercentage }}%)
            </ui-dropdown-menu-item>
            <ui-dropdown-menu-item v-else :disabled="!expense?.items?.length" @click="showDiscountDialog = true">
              <Icon name="lucide:tag" :size="14" class="mr-2" />
              套用折扣
            </ui-dropdown-menu-item>
            <ui-dropdown-menu-separator />
            <ui-dropdown-menu-item class="text-destructive" @click="showDeleteDialog = true">
              <Icon name="lucide:trash-2" :size="14" class="mr-2" />
              刪除
            </ui-dropdown-menu-item>
          </ui-dropdown-menu-content>
        </ui-dropdown-menu>
      </div>
    </div>

    <!-- Amount + description -->
    <div class="mb-4 flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-bold font-mono">
          <template v-if="usedHomeCurrency">
            <span class="text-primary">{{ trip?.defaultCurrency }} {{ convertToDefaultCurrency.toFixed(2) }}</span>
          </template>
          <template v-else>
            <span class="text-primary">{{ primaryCurrency }} {{ toPrimary(expense?.grandTotal || 0, expense?.exchangeRate).toFixed(2) }}</span>
            <span v-if="hasDualCurrency" class="text-sm text-muted-foreground font-normal inline-flex items-center gap-1 ml-1">
              ≈ {{ secondaryCurrency }} {{ toSecondary(expense?.grandTotal || 0, expense?.exchangeRate).toFixed(2) }}
            </span>
          </template>
        </h1>
        <p class="text-sm text-foreground mt-1">
          {{ expense?.description }}
        </p>
        <button type="button" class="mt-1" @click="isEditingBasics = true">
          <category-chip :category="expense?.category" show-unlabeled />
        </button>
        <p class="text-xs text-muted-foreground mt-0.5">
          {{ expense?.paidAtString }}
          <span v-if="createdByName"> · {{ createdByName }} 新增</span>
        </p>
      </div>
      <ui-button
        v-if="canEditThisExpense && !trip?.archived"
        variant="ghost"
        size="icon"
        class="size-8 rounded-full bg-indigo-100 text-indigo-500 hover:bg-indigo-200 hover:text-indigo-700 shrink-0"
        aria-label="編輯基本資訊"
        @click="isEditingBasics = true"
      >
        <Icon name="mdi:pencil" :size="14" />
      </ui-button>
    </div>

    <!-- Desktop: two-column / Mobile: single column -->
    <div class="lg:grid lg:grid-cols-2 lg:gap-6 space-y-4 lg:space-y-0">
      <!-- Left: Payer + member split breakdown -->
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
          <div class="flex items-center justify-between">
            <div class="text-sm text-muted-foreground">
              成員分攤明細
            </div>
            <ui-button
              v-if="canEditThisExpense && !trip?.archived"
              variant="outline"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="isEditingSharers = true"
            >
              <Icon name="mdi:pencil" :size="12" class="mr-1" />
              編輯成員
            </ui-button>
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
                    <div class="flex flex-col items-start">
                      <span class="text-sm font-medium text-foreground">{{ member.name }}</span>
                      <span class="text-xs text-muted-foreground">分擔 {{ (memberItemBreakdown[member.id] || []).length }} 項</span>
                    </div>
                  </div>
                  <div class="text-right mr-4">
                    <div v-if="usedHomeCurrency" class="text-sm font-mono text-primary">
                      {{ trip?.defaultCurrency }} {{ sharedTotalByMember[member.id].convertedTotal.toFixed(2) || '0.00' }}
                    </div>
                    <template v-else>
                      <div class="text-sm font-mono text-green-600 dark:text-green-400">
                        {{ primaryCurrency }} {{ toPrimary(sharedTotalByMember[member.id].total, expense?.exchangeRate).toFixed(2) || '0.00' }}
                      </div>
                      <div v-if="hasDualCurrency" class="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Icon name="lucide:equal-approximately" class="text-muted-foreground" size="12" />
                        <span>{{ secondaryCurrency }} {{ toSecondary(sharedTotalByMember[member.id].total, expense?.exchangeRate).toFixed(2) }}</span>
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
                        ({{ usedHomeCurrency ? trip?.defaultCurrency : primaryCurrency }} {{ (usedHomeCurrency ? item.itemPrice * (expense?.exchangeRate || trip?.exchangeRate || 1) : toPrimary(item.itemPrice, expense?.exchangeRate)).toFixed(2) }} × {{ item.itemQuantity }} ÷ {{ item.sharingMembers.length }}人)
                      </p>
                    </div>
                    <div class="text-right font-mono" :class="usedHomeCurrency ? 'text-primary' : 'text-green-600 dark:text-green-400'">
                      {{ usedHomeCurrency ? trip?.defaultCurrency : primaryCurrency }} {{ (usedHomeCurrency ? item.sharePerMember * (expense?.exchangeRate || trip?.exchangeRate || 1) : toPrimary(item.sharePerMember, expense?.exchangeRate)).toFixed(2) }}
                    </div>
                  </div>
                  <div class="border-t border-border pt-1 flex justify-between items-center font-bold text-foreground">
                    <span>小計:</span>
                    <span :class="usedHomeCurrency ? 'text-primary' : 'text-green-600 dark:text-green-400'">
                      {{ usedHomeCurrency ? trip?.defaultCurrency : primaryCurrency }} {{ ((memberItemBreakdown[member.id] || []).reduce((sum, item) => sum + (usedHomeCurrency ? item.sharePerMember * (expense?.exchangeRate || trip?.exchangeRate || 1) : toPrimary(item.sharePerMember, expense?.exchangeRate)), 0)).toFixed(2) }}
                    </span>
                  </div>
                </div>
              </ui-accordion-content>
            </ui-accordion-item>
          </ui-accordion>
        </div>
      </div>

      <!-- Right: Item details + receipt -->
      <div class="space-y-4">
        <expense-review-banner
          v-if="expense?.needsReview && expense?.reviewReasons?.length"
          :reasons="expense.reviewReasons"
        />
        <div v-if="expense?.items?.length || (canEditThisExpense && !trip?.archived)" class="bg-card rounded-xl border p-4 space-y-4">
          <div class="flex items-center justify-between">
            <div class="text-sm text-muted-foreground">
              購買明細
            </div>
            <ui-button
              v-if="canEditThisExpense && !trip?.archived"
              variant="outline"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="isAddingItem = true"
            >
              <Icon name="lucide:plus" :size="14" class="mr-1" />
              新增項目
            </ui-button>
          </div>
          <div v-if="expense?.items?.length" class="space-y-1">
            <expense-detail-item
              v-for="(item, index) in expense.items"
              :key="item.name"
              :item="item"
              :currency="trip?.tripCurrency || ''"
              :exchange-rate="expense?.exchangeRate ?? trip?.exchangeRate ?? 1"
              :default-currency="trip?.defaultCurrency || 'TWD'"
              :edit-mode="false"
              :can-edit="canEditThisExpense && !trip?.archived"
              :trip-members="tripMembers"
              :shareable-members="sharedWithMembers"
              :shared-by-member-ids="item.sharedByMemberIds"
              @edit="editingItemIndex = index"
              @split="splittingItemIndex = index"
            />
          </div>
          <p v-else class="text-center py-4 text-xs text-muted-foreground">
            尚未有購買明細
          </p>
        </div>

        <div v-if="receiptImageUrl" class="bg-card rounded-xl border p-4 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm text-muted-foreground">
              收據圖片
            </div>
            <ui-button
              v-if="canEditThisExpense && !expense?.isProcessing"
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
          <button
            type="button"
            aria-label="放大檢視收據"
            class="block w-full cursor-zoom-in rounded-lg overflow-hidden focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2"
            @click="isReceiptViewerOpen = true"
          >
            <img
              :src="receiptImageUrl"
              alt="收據圖片"
              loading="lazy"
              class="w-full max-h-96 object-contain rounded-lg"
            >
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Basics Dialog (description, amount, currency, rate, date, payer) -->
    <expense-basics-edit-dialog
      :open="isEditingBasics"
      :expense="expense"
      :trip="trip"
      :trip-members="tripMembers || []"
      :is-saving="isSavingBasics"
      @update:open="(open) => { if (!open && !isSavingBasics) isEditingBasics = false }"
      @save="saveBasics"
    />

    <!-- Edit Sharers Dialog -->
    <expense-sharers-edit-dialog
      :open="isEditingSharers"
      :trip-members="tripMembers || []"
      :shared-with-member-ids="expense?.sharedWithMemberIds || []"
      :is-saving="isSavingSharers"
      @update:open="(open) => { if (!open && !isSavingSharers) isEditingSharers = false }"
      @save="saveSharers"
    />

    <!-- Quick Edit / Add Item Dialog -->
    <expense-item-edit-dialog
      :open="editingItemIndex !== null || isAddingItem"
      :item="editingItem"
      :item-index="editingItemIndex"
      :currency="trip?.tripCurrency || ''"
      :shareable-members="sharedWithMembers || []"
      :is-saving="isSavingItem"
      @update:open="(open) => { if (!open && !isSavingItem) closeItemEditDialog() }"
      @save="saveItem"
      @add="addItem"
      @delete="deleteItem"
    />

    <!-- Split Item Dialog -->
    <expense-item-split-dialog
      :open="splittingItemIndex !== null"
      :item="splittingItem"
      :item-index="splittingItemIndex"
      :currency="trip?.tripCurrency || ''"
      :shareable-members="sharedWithMembers || []"
      @update:open="(open) => { if (!open && !isSplittingItem) splittingItemIndex = null }"
      @split="splitItem"
    />

    <!-- Tax Deduction Dialog -->
    <expense-tax-deduction-dialog
      v-model:open="showTaxDeductionDialog"
      :currency="trip?.tripCurrency || ''"
      :current-grand-total="expense?.grandTotal || 0"
      :current-items="expense?.items || []"
      :is-saving="isApplyingTax"
      @confirm="applyTaxDeductionToExpense"
    />

    <!-- Revert Tax Deduction Confirmation Dialog -->
    <ui-alert-dialog v-model:open="showRevertTaxDialog">
      <ui-alert-dialog-content>
        <ui-alert-dialog-header>
          <ui-alert-dialog-title>還原消費稅</ui-alert-dialog-title>
          <ui-alert-dialog-description>
            將還原為扣除 {{ expense?.taxDeductionPercentage }}% 消費稅前的原始金額。
          </ui-alert-dialog-description>
        </ui-alert-dialog-header>
        <div class="rounded-lg border bg-muted/40 p-3 space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">目前金額</span>
            <span class="font-mono text-foreground">{{ trip?.tripCurrency }} {{ (expense?.grandTotal || 0).toFixed(2) }}</span>
          </div>
          <div class="border-t border-border pt-2 flex items-center justify-between">
            <span class="text-sm font-medium text-foreground">還原後金額</span>
            <span class="font-mono text-base font-bold text-primary">{{ trip?.tripCurrency }} {{ (expense?.originalGrandTotal || 0).toFixed(2) }}</span>
          </div>
        </div>
        <ui-alert-dialog-footer>
          <ui-alert-dialog-cancel :disabled="isRevertingTax">
            取消
          </ui-alert-dialog-cancel>
          <ui-button :disabled="isRevertingTax" @click="revertTaxDeduction">
            <Icon v-if="isRevertingTax" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
            {{ isRevertingTax ? '還原中...' : '確認還原' }}
          </ui-button>
        </ui-alert-dialog-footer>
      </ui-alert-dialog-content>
    </ui-alert-dialog>

    <!-- Discount Dialog -->
    <expense-discount-dialog
      v-model:open="showDiscountDialog"
      :currency="trip?.tripCurrency || ''"
      :current-grand-total="expense?.grandTotal || 0"
      :current-items="expense?.items || []"
      :is-saving="isApplyingDiscount"
      @confirm="applyDiscountToExpense"
    />

    <!-- Revert Discount Confirmation Dialog -->
    <ui-alert-dialog v-model:open="showRevertDiscountDialog">
      <ui-alert-dialog-content>
        <ui-alert-dialog-header>
          <ui-alert-dialog-title>還原折扣</ui-alert-dialog-title>
          <ui-alert-dialog-description>
            將還原為套用 {{ expense?.discountPercentage }}% 折扣前的金額。
          </ui-alert-dialog-description>
        </ui-alert-dialog-header>
        <div class="rounded-lg border bg-muted/40 p-3 space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">目前金額</span>
            <span class="font-mono text-foreground">{{ trip?.tripCurrency }} {{ (expense?.grandTotal || 0).toFixed(2) }}</span>
          </div>
          <div class="border-t border-border pt-2 flex items-center justify-between">
            <span class="text-sm font-medium text-foreground">還原後金額</span>
            <span class="font-mono text-base font-bold text-primary">{{ trip?.tripCurrency }} {{ (expense?.discountOriginalGrandTotal || 0).toFixed(2) }}</span>
          </div>
        </div>
        <ui-alert-dialog-footer>
          <ui-alert-dialog-cancel :disabled="isRevertingDiscount">
            取消
          </ui-alert-dialog-cancel>
          <ui-button :disabled="isRevertingDiscount" @click="revertDiscount">
            <Icon v-if="isRevertingDiscount" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
            {{ isRevertingDiscount ? '還原中...' : '確認還原' }}
          </ui-button>
        </ui-alert-dialog-footer>
      </ui-alert-dialog-content>
    </ui-alert-dialog>

    <!-- Delete Expense Confirmation Dialog -->
    <ui-alert-dialog v-if="canDeleteThisExpense" v-model:open="showDeleteDialog">
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

    <receipt-viewer
      v-if="receiptImageUrl"
      v-model:open="isReceiptViewerOpen"
      :src="receiptImageUrl"
    />
  </template>
</template>
