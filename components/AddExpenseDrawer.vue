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
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'
import { z } from 'zod'
import { cn } from '@/lib/utils'

const { logEvent } = useAnalytics()

const props = defineProps<{
  trip: Trip
  tripMembers: TripMember[]
  defaultPayerMember?: TripMember
  defaultTab?: 'receipt' | 'manual'
}>()

const open = defineModel<boolean>('open', { default: false })

const isDesktop = useMediaQuery('(min-width: 1024px)')
const activeTab = ref<'receipt' | 'manual'>(props.defaultTab ?? 'receipt')
const isSubmitting = ref(false)
const selectedFile = ref<File | null>(null)

const timezone = getLocalTimeZone()

// Currency logic (manual mode only)
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

function convertToTripCurrency(amount: number): number {
  if (!useHomeCurrency.value || !props.trip.exchangeRate)
    return amount
  return amount / props.trip.exchangeRate
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

// Reset form when opened
watch(open, (val) => {
  if (val) {
    activeTab.value = props.defaultTab ?? 'receipt'
    selectedFile.value = null
    currencyOverride.value = null
    resetForm({
      values: {
        sharedWithMemberIds: props.defaultPayerMember?.id ? [props.defaultPayerMember.id] : [],
        paidByMemberId: props.defaultPayerMember?.id,
        paidAt: today(timezone).toString(),
      },
    })
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

    await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), {
      ...formValues,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      paidAt: Timestamp.fromDate(selectedDate),
      createdAt: Timestamp.fromDate(new Date()),
      isProcessing: false,
      enabled: true,
    })

    open.value = false
    logEvent('add_expense', { method: 'manual', trip_id: props.trip.id })
    toast.success('已新增支出')
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
  <ui-alert-dialog v-if="isDesktop" v-model:open="open">
    <ui-alert-dialog-content class="max-w-lg max-h-[85dvh] flex flex-col p-0 gap-0">
      <div class="px-6 pt-6 pb-4 border-b">
        <ui-alert-dialog-title class="text-lg font-bold text-primary">
          新增支出
        </ui-alert-dialog-title>
      </div>

      <div class="overflow-y-auto flex-1 min-h-0 px-6 py-4 space-y-4">
        <!-- shared form content -->
        <ui-tabs v-model="activeTab">
          <ui-tabs-list class="grid w-full grid-cols-2">
            <ui-tabs-trigger value="receipt">
              <Icon name="lucide:camera" class="w-4 h-4 mr-1" /> 收據掃描
            </ui-tabs-trigger>
            <ui-tabs-trigger value="manual">
              <Icon name="lucide:pencil" class="w-4 h-4 mr-1" /> 手動輸入
            </ui-tabs-trigger>
          </ui-tabs-list>

          <ui-tabs-content value="receipt" class="mt-4">
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
          </ui-tabs-content>

          <ui-tabs-content value="manual" class="mt-4 space-y-4">
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
          </ui-tabs-content>
        </ui-tabs>

        <ui-separator />

        <!-- Payer and sharer selection -->
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
                        <span class="text-sm truncate">{{ member.name }}</span>
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
                <div class="flex items-center justify-between">
                  <ui-form-label class="text-sm">
                    選擇平分的成員
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
                      <span class="text-sm truncate">{{ member.name }}</span>
                    </ui-form-label>
                  </ui-form-item>
                </ui-form-field>
                <ui-form-message />
              </ui-form-field>
            </ui-form-item>
          </div>
        </div>
      </div>

      <ui-alert-dialog-footer class="px-6 py-4 border-t">
        <ui-alert-dialog-cancel :disabled="isSubmitting">
          取消
        </ui-alert-dialog-cancel>
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
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>

  <!-- Mobile/Tablet: Drawer -->
  <ui-drawer v-else v-model:open="open">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm flex flex-col max-h-[85dvh]">
        <ui-drawer-header>
          <ui-drawer-title class="text-primary font-bold">
            新增支出
          </ui-drawer-title>
        </ui-drawer-header>

        <div class="overflow-y-auto flex-1 min-h-0 px-4 py-2 space-y-4">
          <!-- Tabs -->
          <ui-tabs v-model="activeTab">
            <ui-tabs-list class="grid w-full grid-cols-2">
              <ui-tabs-trigger value="receipt">
                <Icon name="lucide:camera" class="w-4 h-4 mr-1" /> 收據掃描
              </ui-tabs-trigger>
              <ui-tabs-trigger value="manual">
                <Icon name="lucide:pencil" class="w-4 h-4 mr-1" /> 手動輸入
              </ui-tabs-trigger>
            </ui-tabs-list>

            <ui-tabs-content value="receipt" class="mt-4">
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
            </ui-tabs-content>

            <ui-tabs-content value="manual" class="mt-4 space-y-4">
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
            </ui-tabs-content>
          </ui-tabs>

          <ui-separator />

          <!-- Payer and sharer selection -->
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
                          <span class="text-sm truncate">{{ member.name }}</span>
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
                  <div class="flex items-center justify-between">
                    <ui-form-label class="text-sm">
                      選擇平分的成員
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
                        <span class="text-sm truncate">{{ member.name }}</span>
                      </ui-form-label>
                    </ui-form-item>
                  </ui-form-field>
                  <ui-form-message />
                </ui-form-field>
              </ui-form-item>
            </div>
          </div>
        </div>

        <ui-drawer-footer class="pb-safe">
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
