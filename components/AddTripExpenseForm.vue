<script setup lang="ts">
import type { Trip, TripMember } from '@/types'
import { DateFormatter, getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { toTypedSchema } from '@vee-validate/zod'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { toDate } from 'reka-ui/date'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'
import { z } from 'zod'
import { cn } from '@/lib/utils'

const props = defineProps<{
  trip: Trip
  tripMembers: TripMember[]
  hostMember?: TripMember
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const timezone = getLocalTimeZone()

// Selected currency for input - defaults to trip currency, with user override
const currencyOverride = ref<string | null>(null)
const selectedCurrency = computed({
  get: () => currencyOverride.value ?? props.trip.tripCurrency,
  set: (val: string) => { currencyOverride.value = val },
})

// Check if entering in home currency
const useHomeCurrency = computed(() =>
  selectedCurrency.value === props.trip.defaultCurrency,
)

// Check if trip and home currency are different
const hasDifferentCurrencies = computed(() =>
  props.trip.tripCurrency !== props.trip.defaultCurrency,
)

const formSchema = toTypedSchema(z.object({
  description: z.string().min(2).max(200),
  grandTotal: z.coerce.number().positive(),
  paidAt: z.string(),
  paidByMemberId: z.string(),
  sharedWithMemberIds: z.array(z.string()).refine(value => value.some(item => item), {
    message: '至少選擇一個人',
  }),
  // category: z.string(),
  // imageUrls: z.array(z.string()),
}))

const paidAtPlaceholder = ref()

const { values, isFieldDirty, setFieldValue, handleSubmit } = useForm({
  validationSchema: formSchema,
  initialValues: {
    sharedWithMemberIds: props.hostMember?.id ? [props.hostMember.id] : [],
    paidByMemberId: props.hostMember?.id,
    paidAt: today(timezone).toString(),
  },
})

const paidAtDate = computed({
  get: () => values.paidAt ? parseDate(values.paidAt) : today(timezone),
  set: val => val,
})

// Convert home currency amount to trip currency
function convertToTripCurrency(amount: number): number {
  if (!useHomeCurrency.value || !props.trip.exchangeRate) {
    return amount
  }
  // exchangeRate = 1 tripCurrency = X defaultCurrency
  // So to convert from defaultCurrency to tripCurrency: divide by exchangeRate
  return amount / props.trip.exchangeRate
}

// Preview of converted amount when entering in home currency
const convertedAmountPreview = computed(() => {
  if (!useHomeCurrency.value || !values.grandTotal) {
    return null
  }
  const converted = convertToTripCurrency(values.grandTotal)
  return converted.toFixed(2)
})

const df = new DateFormatter('en-US', {
  dateStyle: 'long',
})

const onSubmit = handleSubmit(async (values) => {
  const db = useFirestore()
  try {
    // Create a date object from the selected date
    const selectedDate = parseDate(values.paidAt).toDate(timezone)
    // Set the current time to the selected date
    const now = new Date()
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())

    // Convert amount to trip currency if entered in home currency
    const grandTotalInTripCurrency = convertToTripCurrency(values.grandTotal)

    await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), {
      ...values,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      paidAt: Timestamp.fromDate(selectedDate),
      createdAt: Timestamp.fromDate(new Date()),
      isProcessing: false,
      enabled: true,
    })
    toast.success('已新增支出')
    emit('close')
  }
  catch (error) {
    console.error(error)
    toast.error('新增支出失敗')
  }
})

onMounted(() => {
  const grandTotalInput = document.getElementById('grandTotalInput')
  if (grandTotalInput) {
    grandTotalInput.focus()
  }
})
</script>

<template>
  <ui-drawer-header>
    <ui-drawer-title class="text-indigo-500 font-bold">
      新增支出
    </ui-drawer-title>
    <ui-drawer-description>輸入支出資訊</ui-drawer-description>
  </ui-drawer-header>
  <ui-drawer-content>
    <div class="space-y-4 px-6 py-8 min-h-[30vh] overflow-y-auto">
      <ui-form-field v-slot="{ componentField }" name="grandTotal" :validate-on-blur="!isFieldDirty">
        <ui-form-item>
          <div class="flex items-center justify-between">
            <ui-form-label>支出金額</ui-form-label>
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
          <ui-form-control>
            <div class="relative">
              <ui-input id="grandTotalInput" class="pl-14" type="tel" v-bind="componentField" step="0.01" />
              <ui-badge class="absolute start-0 inset-y-0 flex items-center justify-center ml-1 my-1 px-2">
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

      <ui-form-field v-slot="{ componentField }" name="description" :validate-on-blur="!isFieldDirty">
        <ui-form-item>
          <ui-form-label>支出描述</ui-form-label>
          <ui-form-control>
            <ui-input type="text" v-bind="componentField" />
          </ui-form-control>
          <!-- <ui-form-description>
            這是你的行程名稱。
          </ui-form-description> -->
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>

      <ui-form-field name="paidAt">
        <ui-form-item class="flex flex-col">
          <ui-form-label>支出日期</ui-form-label>
          <ui-popover>
            <ui-popover-trigger as-child>
              <ui-form-control>
                <ui-button
                  variant="outline" :class="cn(
                    'w-full ps-3 text-start font-normal',
                    !paidAtDate && 'text-muted-foreground',
                  )"
                >
                  <span>{{ paidAtDate ? df.format(toDate(paidAtDate)) : "Pick a date" }}</span>
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

      <ui-separator />
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 px-2">
          <ui-form-field v-slot="{ componentField }" type="radio" name="paidByMemberId">
            <ui-form-item class="">
              <ui-form-label class="text-sm">
                選擇付款人
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
                      <span class="text-sm">{{ member.avatarEmoji }}</span>
                      <span class="text-sm">{{ member.name }}</span>
                    </ui-form-label>
                  </ui-form-item>
                </ui-radio-group>
              </ui-form-control>
              <ui-form-message />
            </ui-form-item>
          </ui-form-field>
        </div>
        <div class="flex-1 px-2">
          <ui-form-item>
            <ui-form-field name="sharedWithMemberIds">
              <ui-form-label class="text-sm">
                選擇平分的成員
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
                    <span class="text-sm">{{ member.avatarEmoji }}</span>
                    <span class="text-sm">{{ member.name }}</span>
                  </ui-form-label>
                  <ui-form-message />
                </ui-form-item>
              </ui-form-field>
            </ui-form-field>
          </ui-form-item>
        </div>
      </div>
    </div>

    <ui-drawer-footer>
      <ui-button type="submit" @click="onSubmit">
        Submit
      </ui-button>
      <ui-drawer-close as-child>
        <ui-button variant="outline">
          Cancel
        </ui-button>
      </ui-drawer-close>
    </ui-drawer-footer>
  </ui-drawer-content>
</template>
