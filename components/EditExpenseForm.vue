<script setup lang="ts">
import type { Expense, ExpenseDetailItem, Trip, TripMember } from '@/types'
import { DateFormatter, getLocalTimeZone, parseDate } from '@internationalized/date'
import { toTypedSchema } from '@vee-validate/zod'
import { useMediaQuery } from '@vueuse/core'
import { doc, Timestamp, updateDoc } from 'firebase/firestore'
import { toDate } from 'reka-ui/date'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'
import { z } from 'zod'
import { cn } from '@/lib/utils'

const props = defineProps<{
  expense: Expense
  trip: Trip
  tripMembers: TripMember[]
}>()

const open = defineModel<boolean>('open', { default: false })

const isDesktop = useMediaQuery('(min-width: 1024px)')
const timezone = getLocalTimeZone()

// Selected currency for input
const currencyOverride = ref<string | null>(props.expense.inputCurrency ?? null)
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

const wasEnteredInHomeCurrency = props.expense.inputCurrency === props.trip.defaultCurrency

function convertToHomeCurrency(amount: number): number {
  return Math.round(amount * props.trip.exchangeRate * 100) / 100
}

function getInitialItems() {
  const items = props.expense.items || []
  if (!wasEnteredInHomeCurrency)
    return items
  return items.map(item => ({
    ...item,
    price: convertToHomeCurrency(item.price),
  }))
}

function getInitialValues() {
  return {
    description: props.expense.description,
    grandTotal: wasEnteredInHomeCurrency ? convertToHomeCurrency(props.expense.grandTotal) : props.expense.grandTotal,
    paidAt: props.expense.paidAtString ? new Date(props.expense.paidAtString).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    paidByMemberId: props.expense.paidByMemberId,
    sharedWithMemberIds: props.expense.sharedWithMemberIds,
    items: getInitialItems(),
  }
}

const { values, isFieldDirty, setFieldValue, handleSubmit, resetForm } = useForm({
  validationSchema: formSchema,
  initialValues: getInitialValues(),
})

const paidAtDate = computed({
  get: () => values.paidAt ? parseDate(values.paidAt) : parseDate(new Date().toISOString().split('T')[0]),
  set: val => val,
})

const df = new DateFormatter('en-US', { dateStyle: 'long' })

function convertToTripCurrency(amount: number): number {
  if (!useHomeCurrency.value || !props.trip.exchangeRate)
    return amount
  return amount / props.trip.exchangeRate
}

const convertedAmountPreview = computed(() => {
  if (!useHomeCurrency.value || !values.grandTotal)
    return null
  return convertToTripCurrency(values.grandTotal).toFixed(2)
})

const calculatedTotal = computed(() => {
  return (values.items || []).reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0)
})

const selectedSharedMembers = computed(() => {
  return props.tripMembers.filter((m: TripMember) => (values.sharedWithMemberIds || []).includes(m.id))
})

watch(calculatedTotal, (newTotal) => {
  setFieldValue('grandTotal', Math.round(newTotal * 100) / 100)
})

// Reset form when opened
watch(open, (val) => {
  if (val) {
    currencyOverride.value = props.expense.inputCurrency ?? null
    resetForm({ values: getInitialValues() })
  }
})

const onSubmit = handleSubmit(async (values) => {
  const db = useFirestore()
  try {
    const selectedDate = parseDate(values.paidAt).toDate(timezone)
    const now = new Date()
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())

    const grandTotalInTripCurrency = convertToTripCurrency(values.grandTotal)

    const itemsInTripCurrency = useHomeCurrency.value
      ? (values.items || []).map(item => ({
          ...item,
          price: Math.round((item.price / props.trip.exchangeRate) * 100) / 100,
        }))
      : values.items

    await updateDoc(doc(db, 'trips', props.trip.id, 'expenses', props.expense.id), {
      description: values.description,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      paidAt: Timestamp.fromDate(selectedDate),
      paidByMemberId: values.paidByMemberId,
      sharedWithMemberIds: values.sharedWithMemberIds,
      items: itemsInTripCurrency,
    })
    toast.success('支出已更新')
    open.value = false
  }
  catch (error) {
    console.error(error)
    toast.error('更新支出失敗')
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
  <!-- Desktop: Dialog -->
  <ui-alert-dialog v-if="isDesktop" v-model:open="open">
    <ui-alert-dialog-content class="max-w-lg max-h-[85dvh] flex flex-col p-0 gap-0">
      <div class="px-6 pt-6 pb-4 border-b">
        <ui-alert-dialog-title class="text-lg font-bold text-primary">
          編輯支出
        </ui-alert-dialog-title>
      </div>

      <div class="overflow-y-auto flex-1 px-6 py-4 space-y-4">
        <!-- Basic Expense Info -->
        <ui-form-field v-slot="{ componentField }" name="description" :validate-on-blur="!isFieldDirty">
          <ui-form-item>
            <ui-form-label>支出描述</ui-form-label>
            <ui-form-control>
              <ui-textarea v-bind="componentField" />
            </ui-form-control>
            <ui-form-message />
          </ui-form-item>
        </ui-form-field>

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
                <ui-input class="pl-14" type="tel" v-bind="componentField" step="0.01" />
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

        <ui-form-field name="paidAt">
          <ui-form-item class="flex flex-col">
            <ui-form-label>支出日期</ui-form-label>
            <ui-popover>
              <ui-popover-trigger as-child>
                <ui-form-control>
                  <ui-button
                    type="button"
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

        <!-- Member Selection -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 px-2">
            <ui-form-field v-slot="{ componentField }" type="radio" name="paidByMemberId">
              <ui-form-item>
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

        <ui-separator />

        <!-- Items Section -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">
              購買明細
            </span>
            <ui-button type="button" size="sm" variant="outline" @click="addItem">
              <Icon name="lucide:plus" :size="16" />
              新增項目
            </ui-button>
          </div>

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
                  class="size-8 text-destructive hover:text-destructive"
                  @click="removeItem(index)"
                >
                  <Icon name="lucide:trash-2" :size="14" />
                </ui-button>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <span class="text-xs text-muted-foreground">名稱</span>
                  <ui-input
                    :model-value="item.name"
                    placeholder="項目名稱"
                    @update:model-value="(value: string | number) => updateItem(index, 'name', String(value))"
                  />
                </div>
                <div>
                  <span class="text-xs text-muted-foreground">價格</span>
                  <div class="relative">
                    <ui-input
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
                  <span class="text-xs text-muted-foreground">數量</span>
                  <ui-input
                    :model-value="item.quantity || 1"
                    type="number"
                    min="1"
                    placeholder="1"
                    @update:model-value="(value: string | number) => updateItem(index, 'quantity', typeof value === 'string' ? parseInt(value) || 1 : value)"
                  />
                </div>
                <div>
                  <span class="text-xs text-muted-foreground">翻譯名稱 (選填)</span>
                  <ui-input
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
                    size="sm"
                    :variant="(item.sharedByMemberIds || []).includes(member.id) ? 'default' : 'outline'"
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

      <ui-alert-dialog-footer class="px-6 py-4 border-t">
        <ui-alert-dialog-cancel>取消</ui-alert-dialog-cancel>
        <ui-button @click="onSubmit">
          儲存變更
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>

  <!-- Mobile/Tablet: Drawer -->
  <ui-drawer v-else v-model:open="open">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm flex flex-col max-h-[85dvh]">
        <ui-drawer-header>
          <ui-drawer-title class="text-primary font-bold">
            編輯支出
          </ui-drawer-title>
        </ui-drawer-header>

        <div class="overflow-y-auto flex-1 px-4 py-4 space-y-4">
          <!-- form body duplicated for mobile container -->
          <ui-form-field v-slot="{ componentField }" name="description" :validate-on-blur="!isFieldDirty">
            <ui-form-item>
              <ui-form-label>支出描述</ui-form-label>
              <ui-form-control>
                <ui-textarea v-bind="componentField" />
              </ui-form-control>
              <ui-form-message />
            </ui-form-item>
          </ui-form-field>

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
                  <ui-input class="pl-14" type="tel" v-bind="componentField" step="0.01" />
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

          <ui-form-field name="paidAt">
            <ui-form-item class="flex flex-col">
              <ui-form-label>支出日期</ui-form-label>
              <ui-popover>
                <ui-popover-trigger as-child>
                  <ui-form-control>
                    <ui-button
                      type="button"
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
                <ui-form-item>
                  <ui-form-label class="text-sm">
                    選擇付款人
                  </ui-form-label>
                  <ui-form-control>
                    <ui-radio-group class="flex flex-col gap-2" v-bind="componentField">
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

          <ui-separator />

          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">購買明細</span>
              <ui-button type="button" size="sm" variant="outline" @click="addItem">
                <Icon name="lucide:plus" :size="16" />
                新增項目
              </ui-button>
            </div>

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
                  <ui-button type="button" size="icon" variant="ghost" class="size-8 text-destructive hover:text-destructive" @click="removeItem(index)">
                    <Icon name="lucide:trash-2" :size="14" />
                  </ui-button>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <span class="text-xs text-muted-foreground">名稱</span>
                    <ui-input :model-value="item.name" placeholder="項目名稱" @update:model-value="(value: string | number) => updateItem(index, 'name', String(value))" />
                  </div>
                  <div>
                    <span class="text-xs text-muted-foreground">價格</span>
                    <div class="relative">
                      <ui-input :model-value="item.price" type="number" step="0.01" min="0" placeholder="0.00" @update:model-value="(value: string | number) => updateItem(index, 'price', typeof value === 'string' ? parseFloat(value) || 0 : value)" />
                      <ui-badge class="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs">
                        {{ selectedCurrency }}
                      </ui-badge>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <span class="text-xs text-muted-foreground">數量</span>
                    <ui-input :model-value="item.quantity || 1" type="number" min="1" placeholder="1" @update:model-value="(value: string | number) => updateItem(index, 'quantity', typeof value === 'string' ? parseInt(value) || 1 : value)" />
                  </div>
                  <div>
                    <span class="text-xs text-muted-foreground">翻譯名稱 (選填)</span>
                    <ui-input :model-value="item.translatedName || ''" placeholder="翻譯名稱" @update:model-value="(value: string | number) => updateItem(index, 'translatedName', String(value))" />
                  </div>
                </div>

                <div>
                  <span class="text-xs text-muted-foreground">分攤成員</span>
                  <div class="flex flex-wrap gap-2 mt-1.5">
                    <ui-button
                      v-for="member in selectedSharedMembers"
                      :key="member.id"
                      type="button"
                      size="sm"
                      :variant="(item.sharedByMemberIds || []).includes(member.id) ? 'default' : 'outline'"
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

        <ui-drawer-footer class="pb-safe">
          <ui-button @click="onSubmit">
            儲存變更
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
