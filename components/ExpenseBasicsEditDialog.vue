<script setup lang="ts">
import type { Expense, Trip, TripMember } from '@/types'
import { DateFormatter, getLocalTimeZone, parseDate } from '@internationalized/date'
import { toDate } from 'reka-ui/date'
import { useExchangeRate } from '@/composables/useExchangeRate'
import { cn } from '@/lib/utils'

const props = defineProps<{
  open: boolean
  expense: Expense | null
  trip: Trip | null
  tripMembers: TripMember[]
  isSaving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'save', payload: {
    description: string
    grandTotal: number | null
    inputCurrency: string
    exchangeRate: number
    paidAt: Date
    paidByMemberId: string
  }): void
}>()

const timezone = getLocalTimeZone()
const df = new DateFormatter('zh-TW', { dateStyle: 'long' })

const description = ref('')
const grandTotalRaw = ref('')
const selectedCurrency = ref('')
const exchangeRate = ref(1)
const previousExchangeRate = ref<number | null>(null)
const paidAtDateString = ref('')
const paidAtTime = ref('')
const paidByMemberId = ref('')
const paidAtPlaceholder = ref()

const paidAtDate = computed({
  get: () => paidAtDateString.value
    ? parseDate(paidAtDateString.value)
    : parseDate(new Date().toISOString().split('T')[0]),
  set: val => val,
})

const hasItems = computed(() => (props.expense?.items?.length ?? 0) > 0)
const hasDifferentCurrencies = computed(() => props.trip?.tripCurrency !== props.trip?.defaultCurrency)
const useHomeCurrency = computed(() => selectedCurrency.value === props.trip?.defaultCurrency)

const grandTotal = computed(() => {
  const n = Number.parseFloat(grandTotalRaw.value)
  return Number.isNaN(n) ? 0 : n
})

// Preview of trip-currency total when editing in home currency (and items don't drive the total)
const convertedAmountPreview = computed(() => {
  if (hasItems.value || !useHomeCurrency.value || !grandTotal.value || !exchangeRate.value)
    return null
  return (grandTotal.value / exchangeRate.value).toFixed(2)
})

const { rate: fetchedRate, isLoading: isRateLoading, fetchRate } = useExchangeRate(
  () => props.trip?.tripCurrency ?? '',
  () => props.trip?.defaultCurrency ?? '',
  () => props.trip?.exchangeRate ?? 1,
)

async function applyLatestRate() {
  previousExchangeRate.value = exchangeRate.value
  await fetchRate()
  exchangeRate.value = fetchedRate.value
}

function revertRate() {
  if (previousExchangeRate.value !== null) {
    exchangeRate.value = previousExchangeRate.value
    previousExchangeRate.value = null
  }
}

function convertToHomeCurrency(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100
}

// Sync local state when dialog opens. Re-sync on every open so closing without
// saving discards in-progress edits.
watch(() => props.open, (open) => {
  if (!open)
    return
  const exp = props.expense
  const trip = props.trip
  if (!exp || !trip)
    return

  description.value = exp.description
  selectedCurrency.value = exp.inputCurrency ?? trip.tripCurrency
  exchangeRate.value = exp.exchangeRate ?? trip.exchangeRate ?? 1
  previousExchangeRate.value = null
  paidByMemberId.value = exp.paidByMemberId

  // Reconstruct the calendar/time inputs from the structured paidAt fields so
  // we don't have to reach into the Timestamp instance.
  const { year, month, day, hour, minute } = exp.paidAtObject
  paidAtDateString.value = year && month && day
    ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    : new Date().toISOString().split('T')[0]
  paidAtTime.value = hour && minute
    ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    : new Date().toTimeString().slice(0, 5)

  // Display amount in the same currency the user originally entered, so
  // hopping into the dialog doesn't surprise them with a converted number.
  const enteredInHome = exp.inputCurrency === trip.defaultCurrency
  const displayedTotal = enteredInHome
    ? convertToHomeCurrency(exp.grandTotal, exp.exchangeRate ?? trip.exchangeRate ?? 1)
    : exp.grandTotal
  grandTotalRaw.value = String(displayedTotal)
}, { immediate: true })

const canSave = computed(() => {
  const trimmed = description.value.trim()
  if (trimmed.length < 2 || trimmed.length > 200)
    return false
  if (!hasItems.value && !(grandTotal.value > 0))
    return false
  if (!(exchangeRate.value > 0))
    return false
  if (!paidByMemberId.value)
    return false
  if (!paidAtDateString.value)
    return false
  return true
})

function handleSave() {
  if (!canSave.value)
    return
  // When items exist the total is derived from items — don't overwrite it.
  const tripCurrencyTotal = hasItems.value
    ? null
    : useHomeCurrency.value
      ? Math.round((grandTotal.value / exchangeRate.value) * 100) / 100
      : grandTotal.value

  const selectedDate = parseDate(paidAtDateString.value).toDate(timezone)
  if (paidAtTime.value) {
    const [h, m] = paidAtTime.value.split(':').map(Number)
    selectedDate.setHours(h, m, 0, 0)
  }
  else {
    const now = new Date()
    selectedDate.setHours(now.getHours(), now.getMinutes(), 0, 0)
  }

  emit('save', {
    description: description.value.trim(),
    grandTotal: tripCurrencyTotal,
    inputCurrency: selectedCurrency.value,
    exchangeRate: exchangeRate.value,
    paidAt: selectedDate,
    paidByMemberId: paidByMemberId.value,
  })
}

function handleClose() {
  emit('update:open', false)
}
</script>

<template>
  <ui-dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <ui-dialog-content class="max-w-md" @open-auto-focus.prevent>
      <ui-dialog-header>
        <ui-dialog-title>編輯基本資訊</ui-dialog-title>
      </ui-dialog-header>

      <div v-if="expense && trip" class="space-y-4 py-2">
        <!-- Description -->
        <div>
          <ui-label class="text-sm font-medium text-foreground">
            描述
          </ui-label>
          <ui-textarea v-model="description" rows="2" class="mt-1" />
          <p v-if="description.trim().length > 0 && description.trim().length < 2" class="text-xs text-destructive mt-1">
            描述至少 2 個字
          </p>
        </div>

        <!-- Amount (only when no items — otherwise driven by items) -->
        <div v-if="!hasItems">
          <div class="flex items-center justify-between">
            <ui-label class="text-sm font-medium text-foreground">
              金額
            </ui-label>
            <ui-button
              v-if="hasDifferentCurrencies"
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 text-xs"
              @click="selectedCurrency = useHomeCurrency ? trip.tripCurrency : trip.defaultCurrency"
            >
              <Icon name="lucide:arrow-left-right" class="mr-1 h-3 w-3" />
              {{ useHomeCurrency ? `改用 ${trip.tripCurrency}` : `改用 ${trip.defaultCurrency}` }}
            </ui-button>
          </div>
          <div class="relative mt-1">
            <ui-input
              v-model="grandTotalRaw"
              type="text"
              inputmode="decimal"
              placeholder="0.00"
              class="pl-14 font-mono"
            />
            <ui-badge class="absolute start-0 inset-y-0 flex items-center ml-1 my-1 px-2 pointer-events-none">
              {{ selectedCurrency }}
            </ui-badge>
          </div>
          <p v-if="convertedAmountPreview" class="text-xs text-muted-foreground mt-1">
            ≈ {{ trip.tripCurrency }} {{ convertedAmountPreview }}
          </p>
        </div>
        <div v-else class="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
          金額由明細自動計算（{{ trip.tripCurrency }} {{ expense.grandTotal.toFixed(2) }}）
        </div>

        <!-- Exchange rate -->
        <div v-if="hasDifferentCurrencies">
          <div class="flex items-center justify-between">
            <ui-label class="text-sm font-medium text-foreground">
              匯率
            </ui-label>
            <div class="flex items-center gap-1">
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
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip.tripCurrency }} =</span>
            <ui-input
              v-model.number="exchangeRate"
              type="number"
              step="0.0001"
              min="0"
              class="h-8 text-xs w-28 px-2"
            />
            <span class="text-xs text-muted-foreground">{{ trip.defaultCurrency }}</span>
          </div>
        </div>

        <!-- Date + time -->
        <div>
          <ui-label class="text-sm font-medium text-foreground">
            日期與時間
          </ui-label>
          <div class="flex gap-2 mt-1">
            <ui-popover>
              <ui-popover-trigger as-child>
                <ui-button
                  type="button"
                  variant="outline"
                  :class="cn('flex-1 ps-3 text-start font-normal', !paidAtDateString && 'text-muted-foreground')"
                >
                  <span>{{ paidAtDate ? df.format(toDate(paidAtDate)) : '選擇日期' }}</span>
                  <Icon name="lucide:calendar" class="ms-auto h-4 w-4 opacity-50" />
                </ui-button>
              </ui-popover-trigger>
              <ui-popover-content class="w-auto p-0">
                <ui-calendar
                  v-model:placeholder="paidAtPlaceholder"
                  v-model="paidAtDate"
                  calendar-label="支出日期"
                  initial-focus
                  @update:model-value="(v) => {
                    paidAtDateString = v ? v.toString() : ''
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
        </div>

        <!-- Payer -->
        <div v-if="tripMembers.length > 0">
          <ui-label class="text-sm font-medium text-foreground">
            付款人
          </ui-label>
          <ui-radio-group v-model="paidByMemberId" class="flex flex-col gap-2 mt-1">
            <div
              v-for="member in tripMembers"
              :key="member.id"
              class="flex items-center gap-2"
            >
              <ui-radio-group-item :id="`payer-${member.id}`" :value="member.id" />
              <ui-label :for="`payer-${member.id}`" class="font-normal flex items-center gap-1 cursor-pointer">
                <member-avatar :emoji="member.avatarEmoji" size="sm" />
                <span class="text-sm">{{ member.name }}</span>
              </ui-label>
            </div>
          </ui-radio-group>
        </div>
      </div>

      <ui-dialog-footer class="flex-row gap-2">
        <ui-button
          type="button"
          variant="outline"
          class="flex-1"
          :disabled="isSaving"
          @click="handleClose"
        >
          取消
        </ui-button>
        <ui-button
          type="button"
          class="flex-1"
          :disabled="isSaving || !canSave"
          @click="handleSave"
        >
          <Icon v-if="isSaving" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isSaving ? '儲存中...' : '儲存' }}
        </ui-button>
      </ui-dialog-footer>
    </ui-dialog-content>
  </ui-dialog>
</template>
