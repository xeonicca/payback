<script setup lang="ts">
import type { Expense, ExpenseDetailItem, Trip, TripMember } from '@/types'
import { DateFormatter, getLocalTimeZone, parseDate } from '@internationalized/date'
import { toTypedSchema } from '@vee-validate/zod'
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

const emit = defineEmits<{
  (e: 'close'): void
}>()

const timezone = getLocalTimeZone()

const formSchema = toTypedSchema(z.object({
  description: z.string().min(2).max(50),
  grandTotal: z.number().min(0),
  paidAt: z.string(),
  paidByMemberId: z.string(),
  sharedWithMemberIds: z.array(z.string()).refine(value => value.some(item => item), {
    message: '至少選擇一個人',
  }),
  items: z.array(z.object({
    name: z.string(),
    price: z.number().min(0),
    quantity: z.number().optional(),
    translatedName: z.string().optional(),
    sharedByMemberIds: z.array(z.string()).optional(),
  })),
}))

const paidAtPlaceholder = ref()

// Initialize form with current expense data
const { values, isFieldDirty, setFieldValue, handleSubmit, resetForm } = useForm({
  validationSchema: formSchema,
  initialValues: {
    description: props.expense.description,
    grandTotal: props.expense.grandTotal,
    paidAt: props.expense.paidAtString ? new Date(props.expense.paidAtString).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    paidByMemberId: props.expense.paidByMemberId,
    sharedWithMemberIds: props.expense.sharedWithMemberIds,
    items: props.expense.items || [],
  },
})

const paidAtDate = computed({
  get: () => values.paidAt ? parseDate(values.paidAt) : parseDate(new Date().toISOString().split('T')[0]),
  set: val => val,
})

const df = new DateFormatter('en-US', {
  dateStyle: 'long',
})

// Calculate total from items
const calculatedTotal = computed(() => {
  return (values.items || []).reduce((sum, item) => sum + (item.price || 0), 0)
})

// Update grandTotal when items change
watch(calculatedTotal, (newTotal) => {
  setFieldValue('grandTotal', Math.round(newTotal * 100) / 100)
})

const onSubmit = handleSubmit(async (values) => {
  const db = useFirestore()
  try {
    // Create a date object from the selected date
    const selectedDate = parseDate(values.paidAt).toDate(timezone)
    // Set the current time to the selected date
    const now = new Date()
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds())

    await updateDoc(doc(db, 'trips', props.trip.id, 'expenses', props.expense.id), {
      description: values.description,
      grandTotal: values.grandTotal,
      paidAt: Timestamp.fromDate(selectedDate),
      paidByMemberId: values.paidByMemberId,
      sharedWithMemberIds: values.sharedWithMemberIds,
      items: values.items,
    })
    toast.success('支出已更新')
    emit('close')
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
  if (!values.items) {
    values.items = []
  }
  values.items.push(newItem)
}

function removeItem(index: number) {
  if (values.items) {
    values.items.splice(index, 1)
  }
}

function updateItem(index: number, field: keyof ExpenseDetailItem, value: any) {
  if (values.items) {
    values.items[index] = {
      ...values.items[index],
      [field]: value,
    }
  }
}

function updateItemSharing(index: number, memberIds: string[]) {
  if (values.items) {
    values.items[index] = {
      ...values.items[index],
      sharedByMemberIds: memberIds,
    }
  }
}

onMounted(() => {
  // Reset form with current expense data
  resetForm({
    values: {
      description: props.expense.description,
      grandTotal: props.expense.grandTotal,
      paidAt: props.expense.paidAtString ? new Date(props.expense.paidAtString).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      paidByMemberId: props.expense.paidByMemberId,
      sharedWithMemberIds: props.expense.sharedWithMemberIds,
      items: props.expense.items || [],
    },
  })
})
</script>

<template>
  <ui-drawer-header>
    <ui-drawer-title class="text-indigo-500 font-bold">
      編輯支出
    </ui-drawer-title>
    <ui-drawer-description>編輯支出資訊</ui-drawer-description>
  </ui-drawer-header>

  <ui-drawer-content>
    <div class="space-y-4 py-8 px-6 min-h-[30vh] overflow-y-auto">
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
          <ui-form-label>支出金額</ui-form-label>
          <ui-form-control>
            <div class="relative">
              <ui-input class="pl-12" type="tel" v-bind="componentField" step="0.01" />
              <ui-badge class="absolute start-0 inset-y-0 flex items-center justify-center ml-1 my-1 px-2">
                {{ trip.tripCurrency }}
              </ui-badge>
            </div>
          </ui-form-control>
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
          <ui-form-field name="sharedWithMemberIds">
            <ui-form-item>
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
            </ui-form-item>
          </ui-form-field>
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
            <Icon name="lucide:plus" size="16" />
            新增項目
          </ui-button>
        </div>

        <div v-if="!values.items || values.items.length === 0" class="text-center py-8 text-gray-500">
          <p>尚未有購買明細</p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="(item, index) in values.items"
            :key="index"
            class="border rounded-lg p-4 space-y-3"
          >
            <div class="flex items-center justify-between">
              <h4 class="font-medium">
                項目 {{ index + 1 }}
              </h4>
              <ui-button
                type="button"
                size="sm"
                variant="ghost"
                class="text-red-500 hover:text-red-700"
                @click="removeItem(index)"
              >
                <Icon name="lucide:trash-2" size="16" />
              </ui-button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <span class="text-sm">
                  名稱
                </span>
                <ui-input
                  :model-value="item.name"
                  placeholder="項目名稱"
                  @update:model-value="(value: string | number) => updateItem(index, 'name', String(value))"
                />
              </div>
              <div>
                <span class="text-sm">
                  價格
                </span>
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
                    {{ trip.tripCurrency }}
                  </ui-badge>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <span class="text-sm">
                  數量
                </span>
                <ui-input
                  :model-value="item.quantity || 1"
                  type="number"
                  min="1"
                  placeholder="1"
                  @update:model-value="(value: string | number) => updateItem(index, 'quantity', typeof value === 'string' ? parseInt(value) || 1 : value)"
                />
              </div>
              <div>
                <span class="text-sm">
                  翻譯名稱 (選填)
                </span>
                <ui-input
                  :model-value="item.translatedName || ''"
                  placeholder="翻譯名稱"
                  @update:model-value="(value: string | number) => updateItem(index, 'translatedName', String(value))"
                />
              </div>
            </div>

            <!-- Item Sharing -->
            <div>
              <span class="text-sm">
                分攤成員
              </span>
              <div class="flex flex-wrap gap-2 mt-2">
                <ui-button
                  v-for="member in tripMembers"
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
                  <span class="mr-1">{{ member.avatarEmoji }}</span>
                  {{ member.name }}
                </ui-button>
              </div>
              <p class="text-xs text-gray-500 mt-1">
                如果沒有選擇特定成員，則所有成員都會分攤此項目
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ui-drawer-footer>
      <ui-button @click="onSubmit">
        儲存變更
      </ui-button>
      <ui-drawer-close as-child>
        <ui-button variant="outline">
          取消
        </ui-button>
      </ui-drawer-close>
    </ui-drawer-footer>
  </ui-drawer-content>
</template>
