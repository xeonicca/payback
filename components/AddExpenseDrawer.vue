<script setup lang="ts">
import type { NewExpense, Trip, TripMember } from '@/types'
import { DateFormatter, getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { toTypedSchema } from '@vee-validate/zod'
import { useMediaQuery } from '@vueuse/core'
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes } from 'firebase/storage'
import { toDate } from 'reka-ui/date'
import { useForm } from 'vee-validate'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'
import { z } from 'zod'
import { cn } from '@/lib/utils'

const props = defineProps<{
  trip: Trip
  tripMembers: TripMember[]
  defaultPayerMember?: TripMember
  defaultTab?: 'receipt' | 'manual'
}>()
const { logEvent } = useAnalytics()
const router = useRouter()

const open = defineModel<boolean>('open', { default: false })

const sessionUser = useSessionUser()
const isDesktop = useMediaQuery('(min-width: 1024px)')
const activeTab = ref<'receipt' | 'manual'>(props.defaultTab ?? 'receipt')
const isSubmitting = ref(false)
const selectedFile = ref<File | null>(null)

const timezone = getLocalTimeZone()

// Currency logic
const currencyOverride = ref<string | null>(null)
const selectedCurrency = computed({
  get: () => currencyOverride.value ?? props.trip.tripCurrency,
  set: (val: string) => { currencyOverride.value = val },
})
const useHomeCurrency = computed(() =>
  selectedCurrency.value === props.trip.defaultCurrency,
)
const hasDifferentCurrencies = computed(() =>
  props.trip.tripCurrency !== props.trip.defaultCurrency,
)

// Exchange rate per expense
const { rate: fetchedRate, isLoading: isRateLoading, fetchRate } = useExchangeRate(
  () => props.trip.tripCurrency,
  () => props.trip.defaultCurrency,
  () => props.trip.exchangeRate,
)
const exchangeRateOverride = ref<number | null>(null)
const expenseExchangeRate = computed({
  get: () => exchangeRateOverride.value ?? fetchedRate.value,
  set: (val: number) => { exchangeRateOverride.value = val },
})

function convertToTripCurrency(amount: number): number {
  if (!useHomeCurrency.value || !expenseExchangeRate.value)
    return amount
  return amount / expenseExchangeRate.value
}

const df = new DateFormatter('zh-TW', { dateStyle: 'long' })

const formSchema = toTypedSchema(z.object({
  description: z.string().min(2).max(200).optional(),
  grandTotal: z.coerce.number().positive().optional(),
  paidAt: z.string().optional(),
  paidByMemberId: z.string(),
  sharedWithMemberIds: z.array(z.string()).refine(value => value.some(item => item), {
    message: '至少選擇一個人',
  }),
}))

const paidAtPlaceholder = ref()

const { values, isFieldDirty, setFieldValue, handleSubmit, resetForm } = useForm({
  validationSchema: formSchema,
  initialValues: {
    sharedWithMemberIds: props.defaultPayerMember?.id ? [props.defaultPayerMember.id] : [],
    paidByMemberId: props.defaultPayerMember?.id,
    paidAt: today(timezone).toString(),
  },
})

// Accordion picker state — only one open at a time
const showPayerPicker = ref(false)
const showSplitPicker = ref(false)
const paidAtTime = ref<string>(new Date().toTimeString().slice(0, 5))

// Compact summary computed values
const currentPayer = computed(() =>
  props.tripMembers.find(m => m.id === values.paidByMemberId),
)
const selectedSplitters = computed(() =>
  props.tripMembers.filter(m => values.sharedWithMemberIds?.includes(m.id)),
)
const splitSummary = computed(() => {
  const n = selectedSplitters.value.length
  if (n === 0)
    return '未選擇'
  if (n === props.tripMembers.length)
    return `所有 ${n} 人`
  if (n === 1)
    return selectedSplitters.value[0].name
  return `${n} 人`
})

// Auto-close payer picker after a selection is made
watch(() => values.paidByMemberId, () => {
  showPayerPicker.value = false
})

const convertedAmountPreview = computed(() => {
  if (!useHomeCurrency.value || !values.grandTotal)
    return null
  return convertToTripCurrency(values.grandTotal).toFixed(2)
})

const paidAtDate = computed({
  get: () => values.paidAt ? parseDate(values.paidAt) : today(timezone),
  set: val => val,
})

const allMembersSelected = computed(() =>
  values.sharedWithMemberIds?.length === props.tripMembers.length,
)

// Items state
interface ExpenseItem {
  id: string
  name: string
  price: string
  qty: string
  qtyVisible: boolean
}
const expenseItems = ref<ExpenseItem[]>([])
const hasItems = computed(() => expenseItems.value.length > 0)
const itemsSum = computed(() =>
  expenseItems.value.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0),
)
const showItemsPicker = ref(false)
const itemsSummary = computed(() => {
  if (!hasItems.value)
    return '加入品項'
  return `${expenseItems.value.length} 項・${selectedCurrency.value} ${itemsSum.value.toLocaleString()}`
})

const preLockAmount = ref<number | undefined>(undefined)

watch(hasItems, (isLocked, wasLocked) => {
  if (isLocked && !wasLocked) {
    preLockAmount.value = values.grandTotal
    setFieldValue('grandTotal', itemsSum.value > 0 ? itemsSum.value : undefined)
  }
  else if (!isLocked && wasLocked) {
    setFieldValue('grandTotal', preLockAmount.value)
  }
})

watch(itemsSum, (val) => {
  if (hasItems.value) {
    setFieldValue('grandTotal', val > 0 ? val : undefined)
  }
})

function addItem() {
  const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
  expenseItems.value.push({ id, name: '', price: '', qty: '1', qtyVisible: false })
  showItemsPicker.value = true
  nextTick(() => {
    document.getElementById(`item-name-${id}`)?.focus()
  })
}

function updateItem(id: string, patch: Partial<ExpenseItem>) {
  const idx = expenseItems.value.findIndex(it => it.id === id)
  if (idx !== -1)
    expenseItems.value[idx] = { ...expenseItems.value[idx], ...patch }
}

function removeItem(id: string) {
  expenseItems.value = expenseItems.value.filter(it => it.id !== id)
}

function clearItems() {
  expenseItems.value = []
}

function onItemBlur(id: string) {
  const item = expenseItems.value.find(it => it.id === id)
  if (item && !item.name.trim() && !item.price) {
    removeItem(id)
  }
}

function toggleSelectAllMembers() {
  if (allMembersSelected.value) {
    setFieldValue('sharedWithMemberIds', [])
  }
  else {
    setFieldValue('sharedWithMemberIds', props.tripMembers.map(m => m.id))
  }
}

function togglePayerPicker() {
  showPayerPicker.value = !showPayerPicker.value
  showSplitPicker.value = false
}

function toggleSplitPicker() {
  showSplitPicker.value = !showSplitPicker.value
  showPayerPicker.value = false
}

// Reset form when opened
watch(open, (val) => {
  if (val) {
    activeTab.value = props.defaultTab ?? 'receipt'
    selectedFile.value = null
    currencyOverride.value = null
    showPayerPicker.value = false
    showSplitPicker.value = false
    showItemsPicker.value = false
    expenseItems.value = []
    preLockAmount.value = undefined
    paidAtTime.value = new Date().toTimeString().slice(0, 5)
    resetForm({
      values: {
        sharedWithMemberIds: props.defaultPayerMember?.id ? [props.defaultPayerMember.id] : [],
        paidByMemberId: props.defaultPayerMember?.id,
        paidAt: today(timezone).toString(),
      },
    })
    exchangeRateOverride.value = null
    fetchRate()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'manual') {
    nextTick(() => {
      document.getElementById('grandTotalInput')?.focus()
    })
  }
})

const onSubmit = handleSubmit(async (formValues) => {
  if (activeTab.value === 'receipt') {
    await submitReceipt(formValues)
  }
  else {
    await submitManual(formValues)
  }
})

async function submitReceipt(formValues: { paidByMemberId: string, sharedWithMemberIds: string[] }) {
  if (!selectedFile.value) {
    toast.error('請上傳收據')
    return
  }

  isSubmitting.value = true
  try {
    const db = useFirestore()
    const storage = getStorage()

    const expense: NewExpense = {
      description: 'Receipt Uploaded, processing',
      grandTotal: 0,
      paidByMemberId: formValues.paidByMemberId,
      sharedWithMemberIds: formValues.sharedWithMemberIds,
      createdAt: serverTimestamp(),
      paidAt: serverTimestamp(),
      isProcessing: true,
      enabled: true,
      createdByUserId: sessionUser.value?.uid,
      exchangeRate: expenseExchangeRate.value,
    }

    const expenseDoc = await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), expense)

    const fileRef = storageRef(storage, `trips/${props.trip.id}/expenses/${expenseDoc.id}/${selectedFile.value.name}`)
    uploadBytes(fileRef, selectedFile.value)

    open.value = false
    logEvent('add_expense', { method: 'receipt', trip_id: props.trip.id })
    toast.success('收據上傳成功，正在解析收據中...')
  }
  catch (error) {
    console.error('Error uploading receipt:', error)
    toast.error((error as Error).message || '收據上傳失敗，請重新上傳')
  }
  finally {
    isSubmitting.value = false
  }
}

async function submitManual(formValues: { description?: string, grandTotal?: number, paidAt?: string, paidByMemberId: string, sharedWithMemberIds: string[] }) {
  if (!formValues.description || !formValues.grandTotal || !formValues.paidAt) {
    toast.error('請填寫所有欄位')
    return
  }

  isSubmitting.value = true
  try {
    const db = useFirestore()

    const selectedDate = parseDate(formValues.paidAt).toDate(timezone)
    if (paidAtTime.value) {
      const [h, m] = paidAtTime.value.split(':').map(Number)
      selectedDate.setHours(h, m, 0, 0)
    }
    else {
      const now = new Date()
      selectedDate.setHours(now.getHours(), now.getMinutes(), 0, 0)
    }

    const grandTotalInTripCurrency = convertToTripCurrency(formValues.grandTotal)

    const cleanItems = expenseItems.value
      .map(it => ({
        name: it.name.trim(),
        price: Number(it.price) || 0,
        quantity: Number(it.qty) || 1,
      }))
      .filter(it => it.price > 0 || it.name)

    const docRef = await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), {
      ...formValues,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      exchangeRate: expenseExchangeRate.value,
      paidAt: Timestamp.fromDate(selectedDate),
      createdAt: Timestamp.fromDate(new Date()),
      isProcessing: false,
      enabled: true,
      createdByUserId: sessionUser.value?.uid,
      ...(cleanItems.length > 0 ? { items: cleanItems } : {}),
    })

    open.value = false
    logEvent('add_expense', { method: 'manual', trip_id: props.trip.id })
    toast.success('已新增支出', {
      action: {
        label: '查看支出',
        onClick: () => router.push(`/trips/${props.trip.id}/expenses/${docRef.id}`),
      },
    })
  }
  catch (error) {
    console.error(error)
    toast.error((error as Error).message || '新增支出失敗')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <!-- Desktop: Dialog -->
  <ui-dialog v-if="isDesktop" v-model:open="open">
    <ui-dialog-content class="max-w-lg max-h-[85dvh] flex flex-col p-0 gap-0">
      <div class="px-6 pt-6 pb-4 border-b">
        <ui-dialog-title class="text-lg font-bold text-primary">
          新增支出
        </ui-dialog-title>
      </div>

      <div class="overflow-y-auto flex-1 min-h-0 px-6 py-4 space-y-4">
        <ui-tabs v-model="activeTab">
          <ui-tabs-list class="grid w-full grid-cols-2">
            <ui-tabs-trigger value="receipt">
              <Icon name="lucide:camera" class="w-4 h-4 mr-1" /> 收據掃描
            </ui-tabs-trigger>
            <ui-tabs-trigger value="manual">
              <Icon name="lucide:pencil" class="w-4 h-4 mr-1" /> 手動輸入
            </ui-tabs-trigger>
          </ui-tabs-list>

          <ui-tabs-content value="receipt" class="mt-4 space-y-4">
            <div class="grid w-full items-center gap-1.5">
              <ui-label for="picture-desktop">
                上傳收據（僅支援圖片格式）
              </ui-label>
              <ui-input
                id="picture-desktop"
                type="file"
                accept="image/*"
                @change="(e: Event) => selectedFile = (e.target as HTMLInputElement).files?.[0] ?? null"
              />
            </div>
            <div v-if="hasDifferentCurrencies" class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip.tripCurrency }} =</span>
              <ui-input
                v-model.number="expenseExchangeRate"
                type="number"
                step="0.0001"
                min="0"
                class="h-7 text-xs w-24"
              />
              <span class="text-xs text-muted-foreground">{{ trip.defaultCurrency }}</span>
              <ui-button
                v-if="isRateLoading"
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 px-1"
                disabled
              >
                <Icon name="lucide:loader-2" class="h-3 w-3 animate-spin" />
              </ui-button>
            </div>

            <ui-separator />

            <!-- Payer: compact accordion row -->
            <div>
              <button
                type="button"
                class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                @click="togglePayerPicker"
              >
                <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">付款人</span>
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <member-avatar v-if="currentPayer" :emoji="currentPayer.avatarEmoji" size="sm" />
                  <span class="text-sm font-medium truncate">{{ currentPayer?.name ?? '未選擇' }}</span>
                </div>
                <Icon
                  name="lucide:chevron-down"
                  class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                  :class="{ 'rotate-180': showPayerPicker }"
                />
              </button>

              <div v-show="showPayerPicker" class="pt-2 pb-1 pl-[4.5rem]">
                <ui-radio-group
                  :model-value="values.paidByMemberId"
                  class="flex flex-col gap-2.5"
                  @update:model-value="(val: string) => { setFieldValue('paidByMemberId', val); showPayerPicker = false }"
                >
                  <label
                    v-for="member in tripMembers"
                    :key="member.id"
                    class="flex items-center gap-1.5 cursor-pointer"
                  >
                    <ui-radio-group-item :value="member.id" class="shrink-0" />
                    <member-avatar :emoji="member.avatarEmoji" size="sm" />
                    <span class="text-sm">{{ member.name }}</span>
                  </label>
                </ui-radio-group>
              </div>
            </div>

            <!-- Splitters: compact accordion row -->
            <div>
              <button
                type="button"
                class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                @click="toggleSplitPicker"
              >
                <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">分攤成員</span>
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <div v-if="selectedSplitters.length" class="flex gap-0.5 shrink-0">
                    <member-avatar
                      v-for="m in selectedSplitters.slice(0, 4)"
                      :key="m.id"
                      :emoji="m.avatarEmoji"
                      size="sm"
                    />
                    <span v-if="selectedSplitters.length > 4" class="text-xs text-muted-foreground self-center ml-0.5">
                      +{{ selectedSplitters.length - 4 }}
                    </span>
                  </div>
                  <span class="text-sm font-medium truncate">{{ splitSummary }}</span>
                </div>
                <Icon
                  name="lucide:chevron-down"
                  class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                  :class="{ 'rotate-180': showSplitPicker }"
                />
              </button>

              <div v-show="showSplitPicker" class="pt-2 pb-1 pl-[4.5rem] space-y-2">
                <div class="flex justify-end">
                  <ui-button type="button" variant="link" size="sm" class="h-auto p-0 text-xs" @click="toggleSelectAllMembers">
                    {{ allMembersSelected ? '取消全選' : '全選' }}
                  </ui-button>
                </div>
                <div class="flex flex-col gap-2">
                  <label
                    v-for="member in tripMembers"
                    :key="member.id"
                    class="flex items-center gap-1.5 cursor-pointer"
                  >
                    <ui-checkbox
                      :model-value="values.sharedWithMemberIds?.includes(member.id) ?? false"
                      @update:model-value="(checked: boolean | 'indeterminate') => {
                        if (typeof checked !== 'boolean') return
                        const current = values.sharedWithMemberIds ?? []
                        setFieldValue('sharedWithMemberIds', checked
                          ? [...current, member.id]
                          : current.filter((id: string) => id !== member.id))
                      }"
                    />
                    <member-avatar :emoji="member.avatarEmoji" size="sm" />
                    <span class="text-sm">{{ member.name }}</span>
                  </label>
                </div>
              </div>
            </div>
          </ui-tabs-content>

          <!-- Manual entry: progressive disclosure -->
          <ui-tabs-content value="manual" class="mt-4 space-y-4">
            <!-- Amount: hero field -->
            <ui-form-field v-slot="{ componentField }" name="grandTotal" :validate-on-blur="!isFieldDirty">
              <ui-form-item>
                <div class="flex items-center justify-between mb-1.5">
                  <ui-form-label class="mb-0">
                    支出金額
                  </ui-form-label>
                  <span v-if="hasItems" class="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                    <Icon name="lucide:link" class="h-2.5 w-2.5" />
                    依品項加總
                  </span>
                </div>
                <ui-form-control>
                  <div class="relative">
                    <ui-input
                      id="grandTotalInput"
                      class="pl-17 h-12 text-lg font-mono" :class="[{ 'bg-muted cursor-default': hasItems }]"
                      type="tel"
                      placeholder="0.00"
                      v-bind="componentField"
                      :readonly="hasItems"
                      step="0.01"
                    />
                    <!-- Clickable badge toggles currency when trip has two currencies -->
                    <button
                      v-if="hasDifferentCurrencies"
                      type="button"
                      class="absolute start-0 inset-y-0 flex items-center ml-1 my-1"
                      :title="`切換至 ${useHomeCurrency ? trip.tripCurrency : trip.defaultCurrency}`"
                      @click="selectedCurrency = useHomeCurrency ? trip.tripCurrency : trip.defaultCurrency"
                    >
                      <ui-badge class="h-full px-2 flex items-center gap-1 cursor-pointer hover:opacity-75 transition-opacity">
                        {{ selectedCurrency }}
                        <Icon name="lucide:arrow-left-right" class="h-2.5 w-2.5 opacity-60" />
                      </ui-badge>
                    </button>
                    <ui-badge v-else class="absolute start-0 inset-y-0 flex items-center ml-1 my-1 px-2">
                      {{ selectedCurrency }}
                    </ui-badge>
                  </div>
                </ui-form-control>
                <p v-if="convertedAmountPreview" class="text-xs text-muted-foreground mt-1">
                  ≈ {{ trip.tripCurrency }} {{ convertedAmountPreview }}
                </p>
                <ui-form-message />
              </ui-form-item>
            </ui-form-field>

            <!-- Exchange rate: only shown when using home currency -->
            <div v-if="hasDifferentCurrencies && useHomeCurrency" class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip.tripCurrency }} =</span>
              <ui-input
                v-model.number="expenseExchangeRate"
                type="number"
                step="0.0001"
                min="0"
                class="h-7 text-xs w-24"
              />
              <span class="text-xs text-muted-foreground">{{ trip.defaultCurrency }}</span>
              <ui-button
                v-if="isRateLoading"
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 px-1"
                disabled
              >
                <Icon name="lucide:loader-2" class="h-3 w-3 animate-spin" />
              </ui-button>
            </div>

            <!-- Description -->
            <ui-form-field v-slot="{ componentField }" name="description" :validate-on-blur="!isFieldDirty">
              <ui-form-item>
                <ui-form-label>支出描述</ui-form-label>
                <ui-form-control>
                  <ui-input type="text" placeholder="餐廳、交通、住宿..." v-bind="componentField" />
                </ui-form-control>
                <ui-form-message />
              </ui-form-item>
            </ui-form-field>

            <!-- Items accordion -->
            <div>
              <button
                type="button"
                class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                @click="showItemsPicker = !showItemsPicker"
              >
                <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">品項</span>
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="text-sm truncate" :class="[hasItems ? 'font-medium text-foreground' : 'text-muted-foreground font-normal']">
                    {{ itemsSummary }}
                  </span>
                </div>
                <Icon
                  name="lucide:chevron-down"
                  class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                  :class="{ 'rotate-180': showItemsPicker }"
                />
              </button>
              <div v-show="showItemsPicker" class="pt-1 pb-1">
                <div v-if="expenseItems.length === 0" class="px-1 py-1 text-[11px] text-muted-foreground">
                  逐項輸入後，金額會自動加總
                </div>
                <div
                  v-for="(item, index) in expenseItems"
                  :key="item.id"
                  class="grid items-center gap-1.5 py-1"
                  :class="[index < expenseItems.length - 1 ? 'border-b border-dashed border-border' : '']"
                  style="grid-template-columns: 1fr auto 96px 20px"
                >
                  <input
                    :id="`item-name-${item.id}`"
                    type="text"
                    placeholder="品項"
                    :value="item.name"
                    class="h-8 px-2 rounded text-[13px] outline-none text-foreground placeholder:text-muted-foreground min-w-0 focus:border focus:border-ring focus:bg-white transition-colors" :class="[item.name ? 'border border-transparent bg-transparent' : 'border border-dashed border-border bg-transparent']"
                    @input="updateItem(item.id, { name: ($event.target as HTMLInputElement).value })"
                    @keydown.enter.prevent="document.getElementById(`item-price-${item.id}`)?.focus()"
                    @blur="onItemBlur(item.id)"
                  >
                  <button
                    v-if="!item.qtyVisible && (Number(item.qty) || 1) <= 1"
                    type="button"
                    class="h-[22px] px-1.5 border border-dashed border-border rounded text-[10px] font-mono text-muted-foreground hover:border-solid hover:text-foreground transition-colors"
                    @click="updateItem(item.id, { qtyVisible: true })"
                  >
                    × 1
                  </button>
                  <div v-else class="inline-flex items-center gap-0.5">
                    <span class="text-[11px] text-muted-foreground">×</span>
                    <input
                      type="tel"
                      inputmode="numeric"
                      :value="item.qty"
                      class="w-9 h-7 px-1 border border-border rounded text-[12px] font-mono text-center bg-white outline-none focus:border-ring"
                      @input="updateItem(item.id, { qty: ($event.target as HTMLInputElement).value.replace(/\D/g, '') })"
                      @blur="() => { const q = Number(item.qty) || 1; updateItem(item.id, { qty: String(q), qtyVisible: q > 1 }) }"
                    >
                  </div>
                  <input
                    :id="`item-price-${item.id}`"
                    type="tel"
                    inputmode="decimal"
                    placeholder="0"
                    :value="item.price"
                    class="w-full h-8 px-1.5 border border-border rounded bg-white text-[13px] font-mono text-right tabular-nums outline-none focus:border-ring placeholder:text-muted-foreground"
                    @input="updateItem(item.id, { price: ($event.target as HTMLInputElement).value })"
                    @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                    @blur="onItemBlur(item.id)"
                  >
                  <button
                    type="button"
                    class="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                    @click="removeItem(item.id)"
                  >
                    <Icon name="lucide:x" class="h-3 w-3" />
                  </button>
                  <div
                    v-if="item.qtyVisible && Number(item.qty) > 1 && Number(item.price) > 0"
                    class="col-span-full text-[10px] font-mono text-muted-foreground text-right pr-6 pb-1 tabular-nums"
                  >
                    = {{ selectedCurrency }} {{ ((Number(item.qty) || 1) * (Number(item.price) || 0)).toLocaleString() }}
                  </div>
                </div>
                <div class="flex items-center justify-between pt-1.5">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                    @click="addItem"
                  >
                    <Icon name="lucide:plus" class="h-3 w-3" />
                    加入品項
                  </button>
                  <button
                    v-if="hasItems"
                    type="button"
                    class="text-[11px] text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer"
                    @click="clearItems"
                  >
                    清除品項
                  </button>
                </div>
              </div>
            </div>

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
                          if (v) { setFieldValue('paidAt', v.toString()) }
                          else { setFieldValue('paidAt', undefined) }
                        }"
                      />
                    </ui-popover-content>
                  </ui-popover>
                  <ui-input
                    v-model="paidAtTime"
                    type="time"
                    step="60"
                    class="w-32 shrink-0"
                    aria-label="時間"
                  />
                </div>
                <ui-form-message />
              </ui-form-item>
            </ui-form-field>

            <ui-separator />

            <!-- Payer: compact accordion row -->
            <div>
              <button
                type="button"
                class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                @click="togglePayerPicker"
              >
                <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">付款人</span>
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <member-avatar v-if="currentPayer" :emoji="currentPayer.avatarEmoji" size="sm" />
                  <span class="text-sm font-medium truncate">{{ currentPayer?.name ?? '未選擇' }}</span>
                </div>
                <Icon
                  name="lucide:chevron-down"
                  class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                  :class="{ 'rotate-180': showPayerPicker }"
                />
              </button>

              <div v-show="showPayerPicker" class="pt-2 pb-1 pl-[4.5rem]">
                <ui-radio-group
                  :model-value="values.paidByMemberId"
                  class="flex flex-col gap-2.5"
                  @update:model-value="(val: string) => { setFieldValue('paidByMemberId', val); showPayerPicker = false }"
                >
                  <label
                    v-for="member in tripMembers"
                    :key="member.id"
                    class="flex items-center gap-1.5 cursor-pointer"
                  >
                    <ui-radio-group-item :value="member.id" class="shrink-0" />
                    <member-avatar :emoji="member.avatarEmoji" size="sm" />
                    <span class="text-sm">{{ member.name }}</span>
                  </label>
                </ui-radio-group>
              </div>
            </div>

            <!-- Splitters: compact accordion row -->
            <div>
              <button
                type="button"
                class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                @click="toggleSplitPicker"
              >
                <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">分攤成員</span>
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <div v-if="selectedSplitters.length" class="flex gap-0.5 shrink-0">
                    <member-avatar
                      v-for="m in selectedSplitters.slice(0, 4)"
                      :key="m.id"
                      :emoji="m.avatarEmoji"
                      size="sm"
                    />
                    <span v-if="selectedSplitters.length > 4" class="text-xs text-muted-foreground self-center ml-0.5">
                      +{{ selectedSplitters.length - 4 }}
                    </span>
                  </div>
                  <span class="text-sm font-medium truncate">{{ splitSummary }}</span>
                </div>
                <Icon
                  name="lucide:chevron-down"
                  class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                  :class="{ 'rotate-180': showSplitPicker }"
                />
              </button>

              <div v-show="showSplitPicker" class="pt-2 pb-1 pl-[4.5rem] space-y-2">
                <div class="flex justify-end">
                  <ui-button type="button" variant="link" size="sm" class="h-auto p-0 text-xs" @click="toggleSelectAllMembers">
                    {{ allMembersSelected ? '取消全選' : '全選' }}
                  </ui-button>
                </div>
                <div class="flex flex-col gap-2">
                  <label
                    v-for="member in tripMembers"
                    :key="member.id"
                    class="flex items-center gap-1.5 cursor-pointer"
                  >
                    <ui-checkbox
                      :model-value="values.sharedWithMemberIds?.includes(member.id) ?? false"
                      @update:model-value="(checked: boolean | 'indeterminate') => {
                        if (typeof checked !== 'boolean') return
                        const current = values.sharedWithMemberIds ?? []
                        setFieldValue('sharedWithMemberIds', checked
                          ? [...current, member.id]
                          : current.filter((id: string) => id !== member.id))
                      }"
                    />
                    <member-avatar :emoji="member.avatarEmoji" size="sm" />
                    <span class="text-sm">{{ member.name }}</span>
                  </label>
                </div>
                <div v-if="hasItems" class="flex items-center gap-1 mt-1.5 px-2 py-1.5 bg-muted rounded text-[11px] text-muted-foreground">
                  <Icon name="lucide:info" class="h-2.5 w-2.5 shrink-0" />
                  <span>需要不同品項分配？儲存後到明細頁面調整</span>
                </div>
              </div>
            </div>
          </ui-tabs-content>
        </ui-tabs>
      </div>

      <ui-dialog-footer class="px-6 py-4 border-t">
        <ui-button variant="outline" :disabled="isSubmitting" @click="open = false">
          取消
        </ui-button>
        <ui-button
          :disabled="isSubmitting"
          @click="onSubmit"
        >
          <template v-if="isSubmitting">
            <Icon name="lucide:loader-circle" class="w-4 h-4 mr-2 animate-spin" />
            {{ activeTab === 'receipt' ? '上傳中...' : '新增中...' }}
          </template>
          <template v-else>
            {{ activeTab === 'receipt' ? '上傳收據' : '新增支出' }}
          </template>
        </ui-button>
      </ui-dialog-footer>
    </ui-dialog-content>
  </ui-dialog>

  <!-- Mobile/Tablet: Drawer -->
  <ui-drawer v-else v-model:open="open">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm flex flex-col flex-1 min-h-0">
        <ui-drawer-header>
          <ui-drawer-title class="text-primary font-bold">
            新增支出
          </ui-drawer-title>
        </ui-drawer-header>

        <div class="overflow-y-auto flex-1 min-h-0 px-4 py-2 space-y-4">
          <ui-tabs v-model="activeTab">
            <ui-tabs-list class="grid w-full grid-cols-2">
              <ui-tabs-trigger value="receipt">
                <Icon name="lucide:camera" class="w-4 h-4 mr-1" /> 收據掃描
              </ui-tabs-trigger>
              <ui-tabs-trigger value="manual">
                <Icon name="lucide:pencil" class="w-4 h-4 mr-1" /> 手動輸入
              </ui-tabs-trigger>
            </ui-tabs-list>

            <ui-tabs-content value="receipt" class="mt-4 space-y-4">
              <div class="grid w-full items-center gap-1.5">
                <ui-label for="picture-mobile">
                  上傳收據（僅支援圖片格式）
                </ui-label>
                <ui-input
                  id="picture-mobile"
                  type="file"
                  accept="image/*"
                  @change="(e: Event) => selectedFile = (e.target as HTMLInputElement).files?.[0] ?? null"
                />
              </div>
              <div v-if="hasDifferentCurrencies" class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip.tripCurrency }} =</span>
                <ui-input
                  v-model.number="expenseExchangeRate"
                  type="number"
                  step="0.0001"
                  min="0"
                  class="h-7 text-xs w-24"
                />
                <span class="text-xs text-muted-foreground">{{ trip.defaultCurrency }}</span>
                <ui-button
                  v-if="isRateLoading"
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1"
                  disabled
                >
                  <Icon name="lucide:loader-2" class="h-3 w-3 animate-spin" />
                </ui-button>
              </div>

              <ui-separator />

              <!-- Payer: compact accordion row -->
              <div>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                  @click="togglePayerPicker"
                >
                  <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">付款人</span>
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <member-avatar v-if="currentPayer" :emoji="currentPayer.avatarEmoji" size="sm" />
                    <span class="text-sm font-medium truncate">{{ currentPayer?.name ?? '未選擇' }}</span>
                  </div>
                  <Icon
                    name="lucide:chevron-down"
                    class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                    :class="{ 'rotate-180': showPayerPicker }"
                  />
                </button>

                <div v-show="showPayerPicker" class="pt-2 pb-1 pl-[4.5rem]">
                  <ui-radio-group
                    :model-value="values.paidByMemberId"
                    class="flex flex-col gap-2.5"
                    @update:model-value="(val: string) => { setFieldValue('paidByMemberId', val); showPayerPicker = false }"
                  >
                    <label
                      v-for="member in tripMembers"
                      :key="member.id"
                      class="flex items-center gap-1.5 cursor-pointer"
                    >
                      <ui-radio-group-item :value="member.id" class="shrink-0" />
                      <member-avatar :emoji="member.avatarEmoji" size="sm" />
                      <span class="text-sm">{{ member.name }}</span>
                    </label>
                  </ui-radio-group>
                </div>
              </div>

              <!-- Splitters: compact accordion row -->
              <div>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                  @click="toggleSplitPicker"
                >
                  <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">分攤成員</span>
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div v-if="selectedSplitters.length" class="flex gap-0.5 shrink-0">
                      <member-avatar
                        v-for="m in selectedSplitters.slice(0, 4)"
                        :key="m.id"
                        :emoji="m.avatarEmoji"
                        size="sm"
                      />
                      <span v-if="selectedSplitters.length > 4" class="text-xs text-muted-foreground self-center ml-0.5">
                        +{{ selectedSplitters.length - 4 }}
                      </span>
                    </div>
                    <span class="text-sm font-medium truncate">{{ splitSummary }}</span>
                  </div>
                  <Icon
                    name="lucide:chevron-down"
                    class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                    :class="{ 'rotate-180': showSplitPicker }"
                  />
                </button>

                <div v-show="showSplitPicker" class="pt-2 pb-1 pl-[4.5rem] space-y-2">
                  <div class="flex justify-end">
                    <ui-button type="button" variant="link" size="sm" class="h-auto p-0 text-xs" @click="toggleSelectAllMembers">
                      {{ allMembersSelected ? '取消全選' : '全選' }}
                    </ui-button>
                  </div>
                  <div class="flex flex-col gap-2">
                    <label
                      v-for="member in tripMembers"
                      :key="member.id"
                      class="flex items-center gap-1.5 cursor-pointer"
                    >
                      <ui-checkbox
                        :model-value="values.sharedWithMemberIds?.includes(member.id) ?? false"
                        @update:model-value="(checked: boolean | 'indeterminate') => {
                          if (typeof checked !== 'boolean') return
                          const current = values.sharedWithMemberIds ?? []
                          setFieldValue('sharedWithMemberIds', checked
                            ? [...current, member.id]
                            : current.filter((id: string) => id !== member.id))
                        }"
                      />
                      <member-avatar :emoji="member.avatarEmoji" size="sm" />
                      <span class="text-sm">{{ member.name }}</span>
                    </label>
                  </div>
                </div>
              </div>
            </ui-tabs-content>

            <!-- Manual entry: progressive disclosure -->
            <ui-tabs-content value="manual" class="mt-4 space-y-4">
              <!-- Amount: hero field -->
              <ui-form-field v-slot="{ componentField }" name="grandTotal" :validate-on-blur="!isFieldDirty">
                <ui-form-item>
                  <div class="flex items-center justify-between mb-1.5">
                    <ui-form-label class="mb-0">
                      支出金額
                    </ui-form-label>
                    <span v-if="hasItems" class="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      <Icon name="lucide:link" class="h-2.5 w-2.5" />
                      依品項加總
                    </span>
                  </div>
                  <ui-form-control>
                    <div class="relative">
                      <ui-input
                        id="grandTotalInput"
                        class="pl-17 h-12 text-lg font-mono" :class="[{ 'bg-muted cursor-default': hasItems }]"
                        type="tel"
                        placeholder="0.00"
                        v-bind="componentField"
                        :readonly="hasItems"
                        step="0.01"
                      />
                      <!-- Clickable badge toggles currency when trip has two currencies -->
                      <button
                        v-if="hasDifferentCurrencies"
                        type="button"
                        class="absolute start-0 inset-y-0 flex items-center ml-1 my-1"
                        :title="`切換至 ${useHomeCurrency ? trip.tripCurrency : trip.defaultCurrency}`"
                        @click="selectedCurrency = useHomeCurrency ? trip.tripCurrency : trip.defaultCurrency"
                      >
                        <ui-badge class="h-full px-2 flex items-center gap-1 cursor-pointer hover:opacity-75 transition-opacity">
                          {{ selectedCurrency }}
                          <Icon name="lucide:arrow-left-right" class="h-2.5 w-2.5 opacity-60" />
                        </ui-badge>
                      </button>
                      <ui-badge v-else class="absolute start-0 inset-y-0 flex items-center ml-1 my-1 px-2">
                        {{ selectedCurrency }}
                      </ui-badge>
                    </div>
                  </ui-form-control>
                  <p v-if="convertedAmountPreview" class="text-xs text-muted-foreground mt-1">
                    ≈ {{ trip.tripCurrency }} {{ convertedAmountPreview }}
                  </p>
                  <ui-form-message />
                </ui-form-item>
              </ui-form-field>

              <!-- Exchange rate: only shown when using home currency -->
              <div v-if="hasDifferentCurrencies && useHomeCurrency" class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip.tripCurrency }} =</span>
                <ui-input
                  v-model.number="expenseExchangeRate"
                  type="number"
                  step="0.0001"
                  min="0"
                  class="h-7 text-xs w-24"
                />
                <span class="text-xs text-muted-foreground">{{ trip.defaultCurrency }}</span>
                <ui-button
                  v-if="isRateLoading"
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1"
                  disabled
                >
                  <Icon name="lucide:loader-2" class="h-3 w-3 animate-spin" />
                </ui-button>
              </div>

              <!-- Description -->
              <ui-form-field v-slot="{ componentField }" name="description" :validate-on-blur="!isFieldDirty">
                <ui-form-item>
                  <ui-form-label>支出描述</ui-form-label>
                  <ui-form-control>
                    <ui-input type="text" placeholder="餐廳、交通、住宿..." v-bind="componentField" />
                  </ui-form-control>
                  <ui-form-message />
                </ui-form-item>
              </ui-form-field>

              <!-- Items accordion -->
              <div>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                  @click="showItemsPicker ? (showItemsPicker = false) : (expenseItems.length === 0 ? addItem() : (showItemsPicker = true))"
                >
                  <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">品項</span>
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="text-sm truncate" :class="[hasItems ? 'font-medium text-foreground' : 'text-muted-foreground font-normal']">
                      {{ itemsSummary }}
                    </span>
                  </div>
                  <Icon
                    name="lucide:chevron-down"
                    class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                    :class="{ 'rotate-180': showItemsPicker }"
                  />
                </button>
                <div v-show="showItemsPicker" class="pt-1 pb-1">
                  <div v-if="expenseItems.length === 0" class="px-1 py-1 text-[11px] text-muted-foreground">
                    逐項輸入後，金額會自動加總
                  </div>
                  <div
                    v-for="(item, index) in expenseItems"
                    :key="item.id"
                    class="grid items-center gap-1.5 py-1"
                    :class="[index < expenseItems.length - 1 ? 'border-b border-dashed border-border' : '']"
                    style="grid-template-columns: 1fr auto 96px 20px"
                  >
                    <input
                      :id="`item-name-m-${item.id}`"
                      type="text"
                      placeholder="品項"
                      :value="item.name"
                      class="h-8 px-2 rounded text-[13px] outline-none text-foreground placeholder:text-muted-foreground min-w-0 focus:border focus:border-ring focus:bg-white transition-colors" :class="[item.name ? 'border border-transparent bg-transparent' : 'border border-dashed border-border bg-transparent']"
                      @input="updateItem(item.id, { name: ($event.target as HTMLInputElement).value })"
                      @keydown.enter.prevent="document.getElementById(`item-price-m-${item.id}`)?.focus()"
                      @blur="onItemBlur(item.id)"
                    >
                    <button
                      v-if="!item.qtyVisible && (Number(item.qty) || 1) <= 1"
                      type="button"
                      class="h-[22px] px-1.5 border border-dashed border-border rounded text-[10px] font-mono text-muted-foreground hover:border-solid hover:text-foreground transition-colors"
                      @click="updateItem(item.id, { qtyVisible: true })"
                    >
                      × 1
                    </button>
                    <div v-else class="inline-flex items-center gap-0.5">
                      <span class="text-[11px] text-muted-foreground">×</span>
                      <input
                        type="tel"
                        inputmode="numeric"
                        :value="item.qty"
                        class="w-9 h-7 px-1 border border-border rounded text-[12px] font-mono text-center bg-white outline-none focus:border-ring"
                        @input="updateItem(item.id, { qty: ($event.target as HTMLInputElement).value.replace(/\D/g, '') })"
                        @blur="() => { const q = Number(item.qty) || 1; updateItem(item.id, { qty: String(q), qtyVisible: q > 1 }) }"
                      >
                    </div>
                    <input
                      :id="`item-price-m-${item.id}`"
                      type="tel"
                      inputmode="decimal"
                      placeholder="0"
                      :value="item.price"
                      class="w-full h-8 px-1.5 border border-border rounded bg-white text-[13px] font-mono text-right tabular-nums outline-none focus:border-ring placeholder:text-muted-foreground"
                      @input="updateItem(item.id, { price: ($event.target as HTMLInputElement).value })"
                      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                      @blur="onItemBlur(item.id)"
                    >
                    <button
                      type="button"
                      class="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                      @click="removeItem(item.id)"
                    >
                      <Icon name="lucide:x" class="h-3 w-3" />
                    </button>
                    <div
                      v-if="item.qtyVisible && Number(item.qty) > 1 && Number(item.price) > 0"
                      class="col-span-full text-[10px] font-mono text-muted-foreground text-right pr-6 pb-1 tabular-nums"
                    >
                      = {{ selectedCurrency }} {{ ((Number(item.qty) || 1) * (Number(item.price) || 0)).toLocaleString() }}
                    </div>
                  </div>
                  <div class="flex items-center justify-between pt-1.5">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                      @click="addItem"
                    >
                      <Icon name="lucide:plus" class="h-3 w-3" />
                      加入品項
                    </button>
                    <button
                      v-if="hasItems"
                      type="button"
                      class="text-[11px] text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer"
                      @click="clearItems"
                    >
                      清除品項
                    </button>
                  </div>
                </div>
              </div>

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
                            if (v) { setFieldValue('paidAt', v.toString()) }
                            else { setFieldValue('paidAt', undefined) }
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

              <ui-separator />

              <!-- Payer: compact accordion row -->
              <div>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                  @click="togglePayerPicker"
                >
                  <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">付款人</span>
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <member-avatar v-if="currentPayer" :emoji="currentPayer.avatarEmoji" size="sm" />
                    <span class="text-sm font-medium truncate">{{ currentPayer?.name ?? '未選擇' }}</span>
                  </div>
                  <Icon
                    name="lucide:chevron-down"
                    class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                    :class="{ 'rotate-180': showPayerPicker }"
                  />
                </button>

                <div v-show="showPayerPicker" class="pt-2 pb-1 pl-[4.5rem]">
                  <ui-radio-group
                    :model-value="values.paidByMemberId"
                    class="flex flex-col gap-2.5"
                    @update:model-value="(val: string) => { setFieldValue('paidByMemberId', val); showPayerPicker = false }"
                  >
                    <label
                      v-for="member in tripMembers"
                      :key="member.id"
                      class="flex items-center gap-1.5 cursor-pointer"
                    >
                      <ui-radio-group-item :value="member.id" class="shrink-0" />
                      <member-avatar :emoji="member.avatarEmoji" size="sm" />
                      <span class="text-sm">{{ member.name }}</span>
                    </label>
                  </ui-radio-group>
                </div>
              </div>

              <!-- Splitters: compact accordion row -->
              <div>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                  @click="toggleSplitPicker"
                >
                  <span class="text-sm text-muted-foreground shrink-0 w-16 text-left">分攤成員</span>
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div v-if="selectedSplitters.length" class="flex gap-0.5 shrink-0">
                      <member-avatar
                        v-for="m in selectedSplitters.slice(0, 4)"
                        :key="m.id"
                        :emoji="m.avatarEmoji"
                        size="sm"
                      />
                      <span v-if="selectedSplitters.length > 4" class="text-xs text-muted-foreground self-center ml-0.5">
                        +{{ selectedSplitters.length - 4 }}
                      </span>
                    </div>
                    <span class="text-sm font-medium truncate">{{ splitSummary }}</span>
                  </div>
                  <Icon
                    name="lucide:chevron-down"
                    class="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200"
                    :class="{ 'rotate-180': showSplitPicker }"
                  />
                </button>

                <div v-show="showSplitPicker" class="pt-2 pb-1 pl-[4.5rem] space-y-2">
                  <div class="flex justify-end">
                    <ui-button type="button" variant="link" size="sm" class="h-auto p-0 text-xs" @click="toggleSelectAllMembers">
                      {{ allMembersSelected ? '取消全選' : '全選' }}
                    </ui-button>
                  </div>
                  <div class="flex flex-col gap-2">
                    <label
                      v-for="member in tripMembers"
                      :key="member.id"
                      class="flex items-center gap-1.5 cursor-pointer"
                    >
                      <ui-checkbox
                        :model-value="values.sharedWithMemberIds?.includes(member.id) ?? false"
                        @update:model-value="(checked: boolean | 'indeterminate') => {
                          if (typeof checked !== 'boolean') return
                          const current = values.sharedWithMemberIds ?? []
                          setFieldValue('sharedWithMemberIds', checked
                            ? [...current, member.id]
                            : current.filter((id: string) => id !== member.id))
                        }"
                      />
                      <member-avatar :emoji="member.avatarEmoji" size="sm" />
                      <span class="text-sm">{{ member.name }}</span>
                    </label>
                  </div>
                  <div v-if="hasItems" class="flex items-center gap-1 mt-1.5 px-2 py-1.5 bg-muted rounded text-[11px] text-muted-foreground">
                    <Icon name="lucide:info" class="h-2.5 w-2.5 shrink-0" />
                    <span>需要不同品項分配？儲存後到明細頁面調整</span>
                  </div>
                </div>
              </div>
            </ui-tabs-content>
          </ui-tabs>
        </div>

        <ui-drawer-footer class="pb-safe shrink-0">
          <ui-button
            :disabled="isSubmitting"
            @click="onSubmit"
          >
            <template v-if="isSubmitting">
              <Icon name="lucide:loader-circle" class="w-4 h-4 mr-2 animate-spin" />
              {{ activeTab === 'receipt' ? '上傳中...' : '新增中...' }}
            </template>
            <template v-else>
              {{ activeTab === 'receipt' ? '上傳收據' : '新增支出' }}
            </template>
          </ui-button>
          <ui-drawer-close as-child>
            <ui-button variant="outline">
              取消
            </ui-button>
          </ui-drawer-close>
        </ui-drawer-footer>
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>

<style>
.drawer-time-input::-webkit-calendar-picker-indicator {
  margin-right: 4px;
}
</style>
