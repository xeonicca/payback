<script setup lang="ts">
import type { Expense, ExpenseDetailItem, Trip, TripMember } from '@/types'
import { DateFormatter, getLocalTimeZone, parseDate } from '@internationalized/date'
import { toTypedSchema } from '@vee-validate/zod'
import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import { toDate } from 'reka-ui/date'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useDocument, useFirestore } from 'vuefire'
import { z } from 'zod'
import { useTripMembers } from '@/composables/useTripMember'
import { cn } from '@/lib/utils'
import { expenseConverter, tripConverter } from '@/utils/converter'

definePageMeta({
  middleware: ['auth'],
  layout: 'default',
})

const db = useFirestore()
const router = useRouter()
const sessionUser = useSessionUser()
const { tripId, expenseId } = useRoute().params

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const expense = useDocument<Expense>(doc(db, 'trips', tripId as string, 'expenses', expenseId as string).withConverter(expenseConverter))
const { tripMembers } = useTripMembers(tripId as string)
const { canEditExpense, collaborators } = useTripCollaborators(tripId as string)

const canEditThisExpense = computed(() => expense.value ? canEditExpense(expense.value) : false)

// Redirect if trip/expense doesn't exist after data loads
watch([trip, expense], ([tripValue, expenseValue]) => {
  if (tripValue === null || expenseValue === null) {
    toast.error('支出不存在')
    navigateTo(`/trips/${tripId}`)
  }
}, { once: true })

// Redirect if no permission — wait for collaborators to load to avoid false negatives
watch([expense, collaborators], ([exp, collabs]) => {
  if (!exp || !collabs || collabs.length === 0)
    return
  if (!canEditThisExpense.value) {
    toast.error('沒有編輯權限')
    navigateTo(`/trips/${tripId}/expenses/${expenseId}`)
  }
}, { once: true })

const timezone = getLocalTimeZone()

// Currency logic
const currencyOverride = ref<string | null>(null)
const selectedCurrency = computed({
  get: () => currencyOverride.value ?? trip.value?.tripCurrency ?? '',
  set: (val: string) => { currencyOverride.value = val },
})

const useHomeCurrency = computed(() =>
  selectedCurrency.value === trip.value?.defaultCurrency,
)

const hasDifferentCurrencies = computed(() =>
  trip.value?.tripCurrency !== trip.value?.defaultCurrency,
)

const exchangeRateOverride = ref<number | null>(null)
const expenseExchangeRate = computed({
  get: () => exchangeRateOverride.value ?? expense.value?.exchangeRate ?? trip.value?.exchangeRate ?? 1,
  set: (val: number) => { exchangeRateOverride.value = val },
})

const { rate: fetchedRate, isLoading: isRateLoading, fetchRate } = useExchangeRate(
  () => trip.value?.tripCurrency ?? '',
  () => trip.value?.defaultCurrency ?? '',
  () => trip.value?.exchangeRate ?? 1,
)

const previousExchangeRate = ref<number | null>(null)

async function applyLatestRate() {
  previousExchangeRate.value = expenseExchangeRate.value
  await fetchRate()
  exchangeRateOverride.value = fetchedRate.value
}

function revertRate() {
  if (previousExchangeRate.value !== null) {
    exchangeRateOverride.value = previousExchangeRate.value
    previousExchangeRate.value = null
  }
}

const formSchema = toTypedSchema(z.object({
  description: z.string().min(2).max(200),
  grandTotal: z.coerce.number().min(0),
  paidAt: z.string(),
  paidByMemberId: z.string(),
  sharedWithMemberIds: z.array(z.string()).refine(value => value.some(item => item), {
    message: '至少選擇一個人',
  }),
  items: z.array(z.object({
    name: z.string(),
    price: z.coerce.number().min(0),
    quantity: z.coerce.number().optional(),
    translatedName: z.string().optional(),
    sharedByMemberIds: z.array(z.string()).optional(),
  })),
}))

const paidAtPlaceholder = ref()

const wasEnteredInHomeCurrency = computed(() =>
  expense.value?.inputCurrency === trip.value?.defaultCurrency,
)

function convertToHomeCurrency(amount: number): number {
  const rate = expense.value?.exchangeRate ?? trip.value?.exchangeRate ?? 1
  return Math.round(amount * rate * 100) / 100
}

function getInitialItems() {
  const items = expense.value?.items || []
  if (!wasEnteredInHomeCurrency.value)
    return items
  return items.map(item => ({
    ...item,
    price: convertToHomeCurrency(item.price),
  }))
}

function getInitialValues() {
  if (!expense.value)
    return {}
  return {
    description: expense.value.description,
    grandTotal: wasEnteredInHomeCurrency.value ? convertToHomeCurrency(expense.value.grandTotal) : expense.value.grandTotal,
    paidAt: expense.value.paidAtString ? new Date(expense.value.paidAtString).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    paidByMemberId: expense.value.paidByMemberId,
    sharedWithMemberIds: expense.value.sharedWithMemberIds,
    items: getInitialItems(),
  }
}

const formInitialized = ref(false)
const initialCurrency = ref<string>('')
const initialExchangeRate = ref<number>(0)
const paidAtTime = ref<string>('')
const initialPaidAtTime = ref<string>('')
const isSubmitting = ref(false)
const itemsExpanded = ref(false)
const itemsListRef = ref<HTMLElement | null>(null)
const sharerModalIndex = ref<number | null>(null)
// Plain (non-reactive) array of raw display strings for item prices.
// Decouples what the user sees from the parsed form value so mid-edit states like "00"
// are not normalized back to "0". Non-reactive intentionally — re-renders are driven by
// updateItem → setFieldValue; making this reactive would cause a double-update error.
const itemPriceRaw: string[] = []

const { values, meta, isFieldDirty, setFieldValue, handleSubmit, resetForm } = useForm({
  validationSchema: formSchema,
})

// Initialize form once expense data loads
watch(expense, (exp) => {
  if (exp && !formInitialized.value) {
    const startingCurrency = exp.inputCurrency ?? trip.value?.tripCurrency ?? ''
    const startingRate = exp.exchangeRate ?? trip.value?.exchangeRate ?? 1
    currencyOverride.value = startingCurrency
    exchangeRateOverride.value = startingRate
    initialCurrency.value = startingCurrency
    initialExchangeRate.value = startingRate
    const initialValues = getInitialValues()
    resetForm({ values: initialValues })
    const { hour, minute } = exp.paidAtObject
    const timeStr = hour && minute
      ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
      : new Date().toTimeString().slice(0, 5)
    paidAtTime.value = timeStr
    initialPaidAtTime.value = timeStr
    const initialPrices = (initialValues.items || []).map(item => String(item.price ?? 0))
    itemPriceRaw.splice(0, itemPriceRaw.length, ...initialPrices)
    itemsExpanded.value = (exp.items?.length || 0) > 0
    formInitialized.value = true
  }
}, { immediate: true })

const paidAtDate = computed({
  get: () => values.paidAt ? parseDate(values.paidAt) : parseDate(new Date().toISOString().split('T')[0]),
  set: val => val,
})

const df = new DateFormatter('zh-TW', { dateStyle: 'long' })

function convertToTripCurrency(amount: number): number {
  if (!useHomeCurrency.value || !expenseExchangeRate.value)
    return amount
  return amount / expenseExchangeRate.value
}

const convertedAmountPreview = computed(() => {
  if (!useHomeCurrency.value || !values.grandTotal)
    return null
  return convertToTripCurrency(values.grandTotal).toFixed(2)
})

const calculatedTotal = computed(() => {
  return (values.items || []).reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0)
})

const hasItems = computed(() => (values.items?.length || 0) > 0)

const selectedSharedMembers = computed(() => {
  return tripMembers.value.filter((m: TripMember) => (values.sharedWithMemberIds || []).includes(m.id))
})

const allMembersSelected = computed(() =>
  values.sharedWithMemberIds?.length === tripMembers.value.length,
)

function toggleSelectAllMembers() {
  if (allMembersSelected.value) {
    setFieldValue('sharedWithMemberIds', [])
  }
  else {
    setFieldValue('sharedWithMemberIds', tripMembers.value.map(m => m.id))
  }
}

watch(calculatedTotal, (newTotal) => {
  setFieldValue('grandTotal', Math.round(newTotal * 100) / 100)
})

function displayNameForUserId(uid: string | undefined): string | null {
  if (!uid)
    return null
  const collaborator = collaborators.value.find(c => c.userId === uid)
  if (collaborator?.displayName)
    return collaborator.displayName
  const member = tripMembers.value?.find(m => m.linkedUserId === uid)
  return member?.name || null
}

const lastEditedLabel = computed(() => {
  if (!expense.value)
    return null
  if (expense.value.lastEditedByUserId && expense.value.lastEditedAtString) {
    const name = displayNameForUserId(expense.value.lastEditedByUserId)
    return name ? `${name} 編輯於 ${expense.value.lastEditedAtString}` : `編輯於 ${expense.value.lastEditedAtString}`
  }
  if (expense.value.createdByUserId) {
    const name = displayNameForUserId(expense.value.createdByUserId)
    return name ? `${name} 新增於 ${expense.value.createdAtString}` : `新增於 ${expense.value.createdAtString}`
  }
  return null
})

const isDirty = computed(() => {
  if (!formInitialized.value)
    return false
  return meta.value.dirty
    || selectedCurrency.value !== initialCurrency.value
    || expenseExchangeRate.value !== initialExchangeRate.value
    || paidAtTime.value !== initialPaidAtTime.value
})

function confirmLeave(): boolean {
  if (!isDirty.value || isSubmitting.value)
    return true
  // eslint-disable-next-line no-alert
  return window.confirm('您有未儲存的變更，確定要離開嗎？')
}

function handleCancel() {
  router.back()
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty.value && !isSubmitting.value) {
    e.preventDefault()
  }
}

onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))

onBeforeRouteLeave(() => confirmLeave())

const onSubmit = handleSubmit(async (values) => {
  if (!expense.value || !trip.value)
    return
  isSubmitting.value = true
  try {
    const selectedDate = parseDate(values.paidAt).toDate(timezone)
    if (paidAtTime.value) {
      const [h, m] = paidAtTime.value.split(':').map(Number)
      selectedDate.setHours(h, m, 0, 0)
    }
    else {
      const now = new Date()
      selectedDate.setHours(now.getHours(), now.getMinutes(), 0, 0)
    }

    const grandTotalInTripCurrency = convertToTripCurrency(values.grandTotal)

    const itemsInTripCurrency = useHomeCurrency.value
      ? (values.items || []).map(item => ({
          ...item,
          price: Math.round((item.price / expenseExchangeRate.value) * 100) / 100,
        }))
      : values.items

    await updateDoc(doc(db, 'trips', trip.value.id, 'expenses', expense.value.id), {
      description: values.description,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      exchangeRate: expenseExchangeRate.value,
      paidAt: Timestamp.fromDate(selectedDate),
      paidByMemberId: values.paidByMemberId,
      sharedWithMemberIds: values.sharedWithMemberIds,
      items: itemsInTripCurrency,
      lastEditedByUserId: sessionUser.value?.uid,
      lastEditedAt: serverTimestamp(),
    })
    toast.success('支出已更新')
    // Leave isSubmitting true so the leave-guard doesn't prompt during navigation
    router.back()
  }
  catch (error) {
    console.error(error)
    toast.error('更新支出失敗')
    isSubmitting.value = false
  }
})

function addItem() {
  const newItem: ExpenseDetailItem = {
    name: '',
    price: 0,
    quantity: 1,
    sharedByMemberIds: [],
  }
  setFieldValue('items', [...(values.items || []), newItem])
  itemPriceRaw.push('')
  nextTick(() => {
    const last = itemsListRef.value?.lastElementChild
    last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

function removeItem(index: number) {
  if (values.items) {
    const updatedItems = [...values.items]
    updatedItems.splice(index, 1)
    setFieldValue('items', updatedItems)
    itemPriceRaw.splice(index, 1)
  }
}

function updateItem(index: number, field: keyof ExpenseDetailItem, value: any) {
  if (values.items) {
    const updatedItems = [...values.items]
    updatedItems[index] = { ...updatedItems[index], [field]: value }
    setFieldValue('items', updatedItems)
  }
}

function updateItemSharing(index: number, memberIds: string[]) {
  if (values.items) {
    const updatedItems = [...values.items]
    updatedItems[index] = { ...updatedItems[index], sharedByMemberIds: memberIds }
    setFieldValue('items', updatedItems)
  }
}
</script>

<template>
  <!-- Loading state -->
  <template v-if="!expense || !trip">
    <div class="space-y-3 pt-2">
      <ui-skeleton class="h-8 w-40" />
      <ui-skeleton class="h-4 w-64" />
      <ui-skeleton class="h-48 w-full rounded-xl mt-4" />
    </div>
  </template>

  <template v-else>
    <!-- Back link -->
    <div class="flex items-center justify-between mb-4">
      <ui-button
        class="text-muted-foreground flex items-center gap-1 px-0"
        variant="link"
        size="sm"
        @click="handleCancel"
      >
        <Icon name="lucide:arrow-left" :size="16" /> 上一頁
      </ui-button>
    </div>

    <!-- Hero: what you're editing -->
    <div class="mb-6">
      <p class="text-xs text-muted-foreground uppercase tracking-wide font-medium">
        編輯支出
      </p>
      <h1 class="text-2xl font-bold font-mono text-primary mt-1">
        {{ selectedCurrency }} {{ (values.grandTotal || 0).toFixed(2) }}
        <span v-if="hasItems" class="ml-1 text-sm font-normal text-muted-foreground">(明細加總)</span>
      </h1>
      <p class="text-sm text-foreground mt-1 line-clamp-1">
        {{ values.description || expense!.description }}
      </p>
      <p v-if="lastEditedLabel" class="text-xs text-muted-foreground mt-1">
        {{ lastEditedLabel }}
      </p>
    </div>

    <form id="expense-edit-form" class="pb-safe-offset-32" @submit.prevent="onSubmit">
      <div class="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:gap-6">
        <!-- Left column: Basics + Split -->
        <div class="space-y-5">
          <!-- Card 1: Basics (amount, description, date) -->
          <div class="bg-card rounded-xl border p-5 space-y-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              基本資訊
            </h2>

            <!-- Amount + currency (hidden when items exist — total is auto-calculated and shown in hero) -->
            <ui-form-field v-if="!hasItems" v-slot="{ componentField }" name="grandTotal" :validate-on-blur="!isFieldDirty">
              <ui-form-item>
                <div class="flex items-center justify-between">
                  <ui-form-label>金額</ui-form-label>
                  <ui-button
                    v-if="hasDifferentCurrencies"
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-6 text-xs"
                    @click="selectedCurrency = useHomeCurrency ? trip!.tripCurrency : trip!.defaultCurrency"
                  >
                    <Icon name="lucide:arrow-left-right" class="mr-1 h-3 w-3" />
                    {{ useHomeCurrency ? `改用 ${trip!.tripCurrency}` : `改用 ${trip!.defaultCurrency}` }}
                  </ui-button>
                </div>
                <ui-form-control>
                  <div class="relative">
                    <ui-input
                      class="pl-14"
                      type="tel"
                      v-bind="componentField"
                      step="0.01"
                    />
                    <ui-badge class="absolute start-0 inset-y-0 flex items-center justify-center ml-1 my-1 px-2">
                      {{ selectedCurrency }}
                    </ui-badge>
                  </div>
                </ui-form-control>
                <div v-if="convertedAmountPreview" class="mt-2 space-y-2">
                  <!-- Preview + actions row -->
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs text-muted-foreground">≈ {{ trip!.tripCurrency }} {{ convertedAmountPreview }}</span>
                    <div class="flex items-center gap-1 shrink-0">
                      <ui-button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="h-auto py-0.5 px-1.5 text-xs text-muted-foreground"
                        :disabled="isRateLoading"
                        @click="applyLatestRate"
                      >
                        <Icon v-if="isRateLoading" name="lucide:loader-circle" class="mr-1 h-3 w-3 animate-spin" />
                        使用最新匯率
                      </ui-button>
                      <ui-button
                        v-if="previousExchangeRate !== null"
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="h-auto py-0.5 px-1.5 text-xs text-muted-foreground"
                        @click="revertRate"
                      >
                        還原
                      </ui-button>
                    </div>
                  </div>
                  <!-- Editable rate row -->
                  <div class="flex items-center gap-1.5">
                    <ui-label for="exchange-rate-input" class="sr-only">
                      匯率
                    </ui-label>
                    <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip!.tripCurrency }} =</span>
                    <ui-input
                      id="exchange-rate-input"
                      v-model.number="expenseExchangeRate"
                      type="number"
                      step="0.0001"
                      min="0"
                      class="h-7 text-xs w-24 px-2"
                    />
                    <span class="text-xs text-muted-foreground">{{ trip!.defaultCurrency }}</span>
                  </div>
                </div>
                <ui-form-message />
              </ui-form-item>
            </ui-form-field>

            <!-- Description -->
            <ui-form-field v-slot="{ componentField }" name="description" :validate-on-blur="!isFieldDirty">
              <ui-form-item>
                <ui-form-label>描述</ui-form-label>
                <ui-form-control>
                  <ui-textarea v-bind="componentField" rows="2" />
                </ui-form-control>
                <ui-form-message />
              </ui-form-item>
            </ui-form-field>

            <!-- Date + Time -->
            <ui-form-field name="paidAt">
              <ui-form-item class="flex flex-col">
                <ui-form-label>日期與時間</ui-form-label>
                <div class="flex gap-2">
                  <ui-popover>
                    <ui-popover-trigger as-child>
                      <ui-form-control>
                        <ui-button
                          type="button"
                          variant="outline"
                          :class="cn(
                            'flex-1 ps-3 text-start font-normal',
                            !paidAtDate && 'text-muted-foreground',
                          )"
                        >
                          <span>{{ paidAtDate ? df.format(toDate(paidAtDate)) : '選擇日期' }}</span>
                          <Icon name="lucide:calendar" class="ms-auto h-4 w-4 opacity-50" />
                        </ui-button>
                        <input hidden>
                      </ui-form-control>
                    </ui-popover-trigger>
                    <ui-popover-content class="w-auto p-0">
                      <ui-calendar
                        v-model:placeholder="paidAtPlaceholder"
                        v-model="paidAtDate"
                        calendar-label="支出日期"
                        initial-focus
                        @update:model-value="(v) => {
                          if (v) {
                            setFieldValue('paidAt', v.toString())
                          }
                          else {
                            setFieldValue('paidAt', undefined)
                          }
                        }"
                      />
                    </ui-popover-content>
                  </ui-popover>
                  <ui-input
                    v-model="paidAtTime"
                    type="time"
                    class="w-32 shrink-0"
                    aria-label="時間"
                  />
                </div>
                <ui-form-message />
              </ui-form-item>
            </ui-form-field>
          </div>

          <!-- Card 2: Payer + Sharers -->
          <div class="bg-card rounded-xl border p-5 space-y-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              付款與分攤
            </h2>

            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5 sm:gap-6">
              <div class="flex-1">
                <ui-form-field v-slot="{ componentField }" type="radio" name="paidByMemberId">
                  <ui-form-item>
                    <ui-form-label class="text-sm">
                      付款人
                    </ui-form-label>
                    <ui-form-control>
                      <ui-radio-group
                        class="flex flex-col gap-2"
                        v-bind="componentField"
                      >
                        <ui-form-item v-for="member in tripMembers" :key="member.id" class="flex items-center">
                          <ui-form-control>
                            <ui-radio-group-item :value="member.id" />
                          </ui-form-control>
                          <ui-form-label class="font-normal flex items-center gap-1">
                            <member-avatar :emoji="member.avatarEmoji" size="sm" />
                            <span class="text-sm">{{ member.name }}</span>
                          </ui-form-label>
                        </ui-form-item>
                      </ui-radio-group>
                    </ui-form-control>
                    <ui-form-message />
                  </ui-form-item>
                </ui-form-field>
              </div>
              <div class="flex-1">
                <ui-form-item>
                  <ui-form-field name="sharedWithMemberIds">
                    <div class="flex items-center justify-between">
                      <ui-form-label class="text-sm">
                        分攤的成員
                      </ui-form-label>
                      <ui-button type="button" variant="link" size="sm" class="h-auto p-0 text-xs" @click="toggleSelectAllMembers">
                        {{ allMembersSelected ? '取消全選' : '全選' }}
                      </ui-button>
                    </div>
                    <ui-form-field
                      v-for="member in tripMembers"
                      v-slot="{ value, handleChange }"
                      :key="member.id"
                      name="sharedWithMemberIds"
                      type="checkbox"
                      :value="member.id"
                      :unchecked-value="false"
                    >
                      <ui-form-item class="flex flex-row items-center space-x-2 space-y-0">
                        <ui-form-control>
                          <ui-checkbox
                            :model-value="value.includes(member.id)"
                            @update:model-value="handleChange"
                          />
                        </ui-form-control>
                        <ui-form-label class="font-normal flex items-center gap-1">
                          <member-avatar :emoji="member.avatarEmoji" size="sm" />
                          <span class="text-sm">{{ member.name }}</span>
                        </ui-form-label>
                      </ui-form-item>
                    </ui-form-field>
                    <ui-form-message />
                  </ui-form-field>
                </ui-form-item>
              </div>
            </div>
          </div>
        </div>

        <!-- Right column: Items (collapsible on mobile; moves to top on mobile when items exist) -->
        <div class="bg-card rounded-xl border p-5 space-y-4 h-fit" :class="{ 'order-first lg:order-none': hasItems }">
          <button
            type="button"
            class="w-full flex items-center justify-between"
            :class="{ 'lg:pointer-events-none': !hasItems, 'pointer-events-none': hasItems }"
            :aria-expanded="itemsExpanded"
            @click="hasItems ? undefined : (itemsExpanded = !itemsExpanded)"
          >
            <div class="flex items-center gap-2">
              <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                購買明細
              </h2>
              <span v-if="values.items && values.items.length > 0" class="text-xs text-muted-foreground">
                {{ values.items.length }} 個項目
              </span>
            </div>
            <div class="flex items-center gap-1">
              <Icon name="lucide:plus" :size="14" class="inline" />
              <span
                class="text-xs text-primary font-medium cursor-pointer pointer-events-auto"
                @click.stop="addItem(); itemsExpanded = true"
              >
                新增
              </span>
            </div>
          </button>

          <div v-show="itemsExpanded || (values.items && values.items.length === 0)" class="space-y-3 lg:!block">
            <div v-if="!values.items || values.items.length === 0" class="text-center py-6 text-muted-foreground">
              <p class="text-sm m-0">
                尚未有購買明細
              </p>
            </div>

            <div v-else ref="itemsListRef" class="space-y-3">
              <div
                v-for="(item, index) in values.items"
                :key="index"
                class="border border-border rounded-lg p-4 space-y-3"
              >
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground m-0">
                    #{{ index + 1 }}
                  </h4>
                  <ui-button
                    type="button"
                    size="icon"
                    variant="ghost"
                    class="size-11 text-destructive hover:text-destructive"
                    :aria-label="`刪除項目 ${index + 1}`"
                    @click="removeItem(index)"
                  >
                    <Icon name="lucide:trash-2" :size="16" />
                  </ui-button>
                </div>

                <!-- Name: primary, full width -->
                <div>
                  <ui-label :for="`item-${index}-name`" class="text-sm font-medium text-foreground">
                    名稱
                  </ui-label>
                  <ui-input
                    :id="`item-${index}-name`"
                    :model-value="item.name"
                    placeholder="項目名稱"
                    autocomplete="off"
                    class="mt-1"
                    @update:model-value="(value: string | number) => updateItem(index, 'name', String(value))"
                  />
                </div>

                <!-- Price (primary) + Quantity (secondary modifier) -->
                <div class="flex gap-3">
                  <div class="flex-1 min-w-0">
                    <ui-label :for="`item-${index}-price`" class="text-sm font-medium text-foreground">
                      價格
                    </ui-label>
                    <div class="relative mt-1">
                      <ui-input
                        :id="`item-${index}-price`"
                        :model-value="itemPriceRaw[index] ?? String(item.price)"
                        type="text"
                        inputmode="decimal"
                        placeholder="0.00"
                        class="pl-14 font-mono"
                        @update:model-value="(val: string | number) => {
                          const str = String(val)
                          itemPriceRaw[index] = str
                          const num = parseFloat(str)
                          updateItem(index, 'price', isNaN(num) ? 0 : num)
                        }"
                      />
                      <ui-badge class="absolute start-0 inset-y-0 flex items-center ml-1 my-1 px-2 pointer-events-none">
                        {{ selectedCurrency }}
                      </ui-badge>
                    </div>
                  </div>
                  <div class="w-20 shrink-0">
                    <ui-label :for="`item-${index}-quantity`" class="text-sm font-medium text-foreground">
                      數量
                    </ui-label>
                    <ui-input
                      :id="`item-${index}-quantity`"
                      :model-value="item.quantity || 1"
                      type="number"
                      min="1"
                      placeholder="1"
                      class="mt-1 text-center"
                      @update:model-value="(value: string | number) => updateItem(index, 'quantity', typeof value === 'string' ? parseInt(value) || 1 : value)"
                    />
                  </div>
                </div>

                <!-- Translated name: optional -->
                <div>
                  <ui-label :for="`item-${index}-translated`" class="text-sm font-medium text-foreground">
                    翻譯名稱
                    <span class="text-xs font-normal text-muted-foreground ml-0.5">選填</span>
                  </ui-label>
                  <ui-input
                    :id="`item-${index}-translated`"
                    :model-value="item.translatedName || ''"
                    placeholder="本地語言名稱"
                    class="mt-1"
                    @update:model-value="(value: string | number) => updateItem(index, 'translatedName', String(value))"
                  />
                </div>

                <!-- Item Sharing -->
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <p class="text-xs text-muted-foreground m-0">
                      分攤成員
                    </p>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      @click="sharerModalIndex = index"
                    >
                      <Icon name="lucide:pencil" class="w-3 h-3" />
                      編輯
                    </button>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <template v-if="(item.sharedByMemberIds || []).length > 0">
                      <div
                        v-for="member in selectedSharedMembers.filter(m => (item.sharedByMemberIds || []).includes(m.id))"
                        :key="member.id"
                        class="flex items-center gap-1 bg-slate-100 rounded-full px-2 py-0.5"
                      >
                        <member-avatar :emoji="member.avatarEmoji" size="sm" />
                        <span class="text-xs text-foreground">{{ member.name }}</span>
                      </div>
                    </template>
                    <span v-else class="text-xs text-muted-foreground">所有人均攤</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>

    <!-- Item sharer drawer -->
    <ui-drawer :open="sharerModalIndex !== null" @update:open="(open) => { if (!open) sharerModalIndex = null }">
      <ui-drawer-content>
        <div class="mx-auto w-full max-w-md px-6 pb-8 pt-2">
          <ui-drawer-header class="px-0 pt-4 pb-5">
            <ui-drawer-title class="text-base font-semibold">
              選擇分攤成員
            </ui-drawer-title>
            <ui-drawer-description class="text-xs text-muted-foreground">
              未選擇則由所有分攤成員共同分攤
            </ui-drawer-description>
          </ui-drawer-header>

          <div v-if="sharerModalIndex !== null" class="space-y-2">
            <!-- Select all row -->
            <label
              class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50"
              :class="(values.items?.[sharerModalIndex]?.sharedByMemberIds || []).length === selectedSharedMembers.length && selectedSharedMembers.length > 0 ? 'border-indigo-200 bg-indigo-50/50' : 'border-transparent'"
            >
              <ui-checkbox
                :checked="(values.items?.[sharerModalIndex]?.sharedByMemberIds || []).length === selectedSharedMembers.length && selectedSharedMembers.length > 0"
                @update:checked="(checked) => {
                  const idx = sharerModalIndex!
                  updateItemSharing(idx, checked ? selectedSharedMembers.map(m => m.id) : [])
                }"
              />
              <span class="text-sm font-semibold text-foreground flex-1">全選</span>
            </label>

            <div class="border-t border-slate-100 my-1" />

            <label
              v-for="member in selectedSharedMembers"
              :key="member.id"
              class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50"
              :class="(values.items?.[sharerModalIndex]?.sharedByMemberIds || []).includes(member.id) ? 'border-indigo-200 bg-indigo-50/50' : 'border-transparent'"
            >
              <ui-checkbox
                :checked="(values.items?.[sharerModalIndex]?.sharedByMemberIds || []).includes(member.id)"
                @update:checked="(checked) => {
                  const idx = sharerModalIndex!
                  const currentIds = values.items?.[idx]?.sharedByMemberIds || []
                  const newIds = checked
                    ? [...currentIds, member.id]
                    : currentIds.filter((id: string) => id !== member.id)
                  updateItemSharing(idx, newIds)
                }"
              />
              <member-avatar :emoji="member.avatarEmoji" size="sm" />
              <span class="text-sm font-medium text-foreground flex-1">{{ member.name }}</span>
            </label>
          </div>

          <div class="flex gap-2 mt-6">
            <ui-button
              type="button"
              variant="outline"
              class="flex-1"
              @click="() => { if (sharerModalIndex !== null) updateItemSharing(sharerModalIndex, []); sharerModalIndex = null }"
            >
              清除（所有人均攤）
            </ui-button>
            <ui-button
              type="button"
              class="flex-1"
              @click="sharerModalIndex = null"
            >
              完成
            </ui-button>
          </div>
        </div>
      </ui-drawer-content>
    </ui-drawer>

    <!-- Sticky bottom action bar -->
    <div class="fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur border-t px-4 pt-4 pb-safe-offset-4 z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
      <div class="container mx-auto flex gap-2">
        <ui-button class="flex-1" variant="outline" :disabled="isSubmitting" @click="handleCancel">
          取消
        </ui-button>
        <ui-button class="flex-1" type="submit" form="expense-edit-form" :disabled="isSubmitting" @click="onSubmit">
          <template v-if="isSubmitting">
            <Icon name="lucide:loader-circle" class="w-4 h-4 mr-2 animate-spin" />
            儲存中...
          </template>
          <template v-else>
            儲存變更
          </template>
        </ui-button>
      </div>
    </div>
  </template>
</template>
