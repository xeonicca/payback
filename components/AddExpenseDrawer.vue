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

const df = new DateFormatter('en-US', { dateStyle: 'long' })

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
    toast.error('收據上傳失敗，請重新上傳')
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
    const now = new Date()
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())

    const grandTotalInTripCurrency = convertToTripCurrency(formValues.grandTotal)

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
    toast.error('新增支出失敗')
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
                <ui-form-label>支出金額</ui-form-label>
                <ui-form-control>
                  <div class="relative">
                    <ui-input
                      id="grandTotalInput"
                      class="pl-16 h-12 text-lg font-mono"
                      type="tel"
                      placeholder="0.00"
                      v-bind="componentField"
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

            <!-- Date: inline compact chip -->
            <ui-form-field name="paidAt">
              <ui-form-item>
                <ui-popover>
                  <ui-popover-trigger as-child>
                    <ui-form-control>
                      <button
                        type="button"
                        :class="cn(
                          'flex items-center gap-1.5 text-sm transition-colors',
                          paidAtDate && values.paidAt !== today(timezone).toString()
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground',
                        )"
                      >
                        <Icon name="lucide:calendar" class="h-3.5 w-3.5 shrink-0" />
                        <span>{{ paidAtDate ? df.format(toDate(paidAtDate)) : '今天' }}</span>
                      </button>
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
                  <ui-form-label>支出金額</ui-form-label>
                  <ui-form-control>
                    <div class="relative">
                      <ui-input
                        id="grandTotalInput"
                        class="pl-16 h-12 text-lg font-mono"
                        type="tel"
                        placeholder="0.00"
                        v-bind="componentField"
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

              <!-- Date: inline compact chip -->
              <ui-form-field name="paidAt">
                <ui-form-item>
                  <ui-popover>
                    <ui-popover-trigger as-child>
                      <ui-form-control>
                        <button
                          type="button"
                          :class="cn(
                            'flex items-center gap-1.5 text-sm transition-colors',
                            paidAtDate && values.paidAt !== today(timezone).toString()
                              ? 'text-foreground font-medium'
                              : 'text-muted-foreground hover:text-foreground',
                          )"
                        >
                          <Icon name="lucide:calendar" class="h-3.5 w-3.5 shrink-0" />
                          <span>{{ paidAtDate ? df.format(toDate(paidAtDate)) : '今天' }}</span>
                        </button>
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
