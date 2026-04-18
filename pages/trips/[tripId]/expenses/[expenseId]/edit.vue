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
const isSubmitting = ref(false)
const itemsExpanded = ref(false)

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
    resetForm({ values: getInitialValues() })
    itemsExpanded.value = (exp.items?.length || 0) > 0
    formInitialized.value = true
  }
}, { immediate: true })

const paidAtDate = computed({
  get: () => values.paidAt ? parseDate(values.paidAt) : parseDate(new Date().toISOString().split('T')[0]),
  set: val => val,
})

const df = new DateFormatter('en-US', { dateStyle: 'long' })

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
})

function confirmLeave(): boolean {
  if (!isDirty.value || isSubmitting.value)
    return true
  // eslint-disable-next-line no-alert
  return window.confirm('您有未儲存的變更，確定要離開嗎？')
}

function handleCancel() {
  if (confirmLeave())
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
    const now = new Date()
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())

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
}

function removeItem(index: number) {
  if (values.items) {
    const updatedItems = [...values.items]
    updatedItems.splice(index, 1)
    setFieldValue('items', updatedItems)
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
    <div class="flex items-center justify-between mb-2">
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
      </h1>
      <p class="text-sm text-foreground mt-1 line-clamp-1">
        {{ values.description || expense!.description }}
      </p>
      <p v-if="lastEditedLabel" class="text-xs text-muted-foreground mt-1">
        {{ lastEditedLabel }}
      </p>
    </div>

    <form id="expense-edit-form" class="pb-safe-offset-32" @submit.prevent="onSubmit">
      <div class="lg:grid lg:grid-cols-2 lg:gap-6 space-y-4 lg:space-y-0">
        <!-- Left column: Basics + Split -->
        <div class="space-y-4">
          <!-- Card 1: Basics (amount, description, date) -->
          <div class="bg-card rounded-xl border p-4 space-y-4">
            <h2 class="text-sm font-semibold text-foreground m-0">
              基本資訊
            </h2>

            <!-- Amount + currency -->
            <ui-form-field v-slot="{ componentField }" name="grandTotal" :validate-on-blur="!isFieldDirty">
              <ui-form-item>
                <div class="flex items-center justify-between">
                  <ui-form-label>
                    金額
                    <span v-if="hasItems" class="ml-1 text-xs font-normal text-muted-foreground">
                      (由購買明細自動加總)
                    </span>
                  </ui-form-label>
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
                      :class="{ 'bg-muted/50 cursor-not-allowed': hasItems }"
                      type="tel"
                      v-bind="componentField"
                      step="0.01"
                      :readonly="hasItems"
                      :aria-readonly="hasItems"
                      :tabindex="hasItems ? -1 : undefined"
                    />
                    <ui-badge class="absolute start-0 inset-y-0 flex items-center justify-center ml-1 my-1 px-2">
                      {{ selectedCurrency }}
                    </ui-badge>
                  </div>
                </ui-form-control>
                <p v-if="hasItems" class="text-xs text-muted-foreground mt-1">
                  <Icon name="lucide:info" :size="12" class="inline-block mr-0.5 -mt-0.5" />
                  刪除所有項目後可直接輸入金額
                </p>
                <div v-if="convertedAmountPreview" class="flex items-center gap-2 mt-2 flex-wrap">
                  <span class="text-xs text-muted-foreground">≈ {{ trip!.tripCurrency }} {{ convertedAmountPreview }}</span>
                  <div class="flex items-center gap-1">
                    <span class="text-xs text-muted-foreground whitespace-nowrap">(1 {{ trip!.tripCurrency }} =</span>
                    <ui-label for="exchange-rate-input" class="sr-only">
                      匯率
                    </ui-label>
                    <ui-input
                      id="exchange-rate-input"
                      v-model.number="expenseExchangeRate"
                      type="number"
                      step="0.0001"
                      min="0"
                      class="h-9 text-xs w-24 px-2"
                    />
                    <span class="text-xs text-muted-foreground">{{ trip!.defaultCurrency }})</span>
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

            <!-- Date -->
            <ui-form-field name="paidAt">
              <ui-form-item class="flex flex-col">
                <ui-form-label>日期</ui-form-label>
                <ui-popover>
                  <ui-popover-trigger as-child>
                    <ui-form-control>
                      <ui-button
                        type="button"
                        variant="outline"
                        :class="cn(
                          'w-full ps-3 text-start font-normal',
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
                <ui-form-message />
              </ui-form-item>
            </ui-form-field>
          </div>

          <!-- Card 2: Payer + Sharers -->
          <div class="bg-card rounded-xl border p-4 space-y-4">
            <h2 class="text-sm font-semibold text-foreground m-0">
              付款與分攤
            </h2>

            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
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
                    <ui-form-label class="text-sm">
                      平分的成員
                    </ui-form-label>
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

        <!-- Right column: Items (collapsible on mobile) -->
        <div class="bg-card rounded-xl border p-4 space-y-4 h-fit">
          <button
            type="button"
            class="w-full flex items-center justify-between lg:pointer-events-none"
            :aria-expanded="itemsExpanded"
            @click="itemsExpanded = !itemsExpanded"
          >
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold text-foreground m-0">
                購買明細
              </h2>
              <span v-if="values.items && values.items.length > 0" class="text-xs text-muted-foreground">
                {{ values.items.length }} 個項目
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="text-xs text-primary font-medium cursor-pointer"
                @click.stop="addItem(); itemsExpanded = true"
              >
                <Icon name="lucide:plus" :size="14" class="inline" />
                新增
              </span>
              <Icon
                name="lucide:chevron-down"
                :size="16"
                class="text-muted-foreground transition-transform lg:hidden"
                :class="{ 'rotate-180': itemsExpanded }"
              />
            </div>
          </button>

          <div v-show="itemsExpanded || (values.items && values.items.length === 0)" class="space-y-3 lg:!block">
            <div v-if="!values.items || values.items.length === 0" class="text-center py-6 text-muted-foreground">
              <p class="text-sm m-0">
                尚未有購買明細
              </p>
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="(item, index) in values.items"
                :key="index"
                class="border border-border rounded-lg p-4 space-y-3"
              >
                <div class="flex items-center justify-between">
                  <h4 class="text-sm font-medium text-foreground m-0">
                    項目 {{ index + 1 }}
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

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <ui-label :for="`item-${index}-name`" class="text-xs text-muted-foreground">
                      名稱
                    </ui-label>
                    <ui-input
                      :id="`item-${index}-name`"
                      :model-value="item.name"
                      placeholder="項目名稱"
                      @update:model-value="(value: string | number) => updateItem(index, 'name', String(value))"
                    />
                  </div>
                  <div>
                    <ui-label :for="`item-${index}-price`" class="text-xs text-muted-foreground">
                      價格
                    </ui-label>
                    <div class="relative">
                      <ui-input
                        :id="`item-${index}-price`"
                        :model-value="item.price"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        @update:model-value="(value: string | number) => updateItem(index, 'price', typeof value === 'string' ? parseFloat(value) || 0 : value)"
                      />
                      <ui-badge class="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs">
                        {{ selectedCurrency }}
                      </ui-badge>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <ui-label :for="`item-${index}-quantity`" class="text-xs text-muted-foreground">
                      數量
                    </ui-label>
                    <ui-input
                      :id="`item-${index}-quantity`"
                      :model-value="item.quantity || 1"
                      type="number"
                      min="1"
                      placeholder="1"
                      @update:model-value="(value: string | number) => updateItem(index, 'quantity', typeof value === 'string' ? parseInt(value) || 1 : value)"
                    />
                  </div>
                  <div>
                    <ui-label :for="`item-${index}-translated`" class="text-xs text-muted-foreground">
                      翻譯名稱 (選填)
                    </ui-label>
                    <ui-input
                      :id="`item-${index}-translated`"
                      :model-value="item.translatedName || ''"
                      placeholder="翻譯名稱"
                      @update:model-value="(value: string | number) => updateItem(index, 'translatedName', String(value))"
                    />
                  </div>
                </div>

                <!-- Item Sharing -->
                <div>
                  <span class="text-xs text-muted-foreground">分攤成員</span>
                  <div class="flex flex-wrap gap-2 mt-1.5">
                    <ui-button
                      v-for="member in selectedSharedMembers"
                      :key="member.id"
                      type="button"
                      :variant="(item.sharedByMemberIds || []).includes(member.id) ? 'default' : 'outline'"
                      :aria-pressed="(item.sharedByMemberIds || []).includes(member.id)"
                      class="min-h-11"
                      @click="() => {
                        const currentIds = item.sharedByMemberIds || []
                        const newIds = currentIds.includes(member.id)
                          ? currentIds.filter(id => id !== member.id)
                          : [...currentIds, member.id]
                        updateItemSharing(index, newIds)
                      }"
                    >
                      <member-avatar :emoji="member.avatarEmoji" size="sm" />
                      {{ member.name }}
                    </ui-button>
                  </div>
                  <p class="text-xs text-muted-foreground mt-1 m-0">
                    未選擇則由所有分攤成員共同分攤
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>

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
