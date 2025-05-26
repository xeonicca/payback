<script setup lang="ts">
import type { Trip } from '@/types'
import { DateFormatter, getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { toTypedSchema } from '@vee-validate/zod'
import { addDoc, collection } from 'firebase/firestore'
import { toDate } from 'reka-ui/date'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'
import { z } from 'zod'
import { cn } from '@/lib/utils'

const props = defineProps<{
  trip: Trip
}>()

const formSchema = toTypedSchema(z.object({
  description: z.string().min(2).max(50),
  amount: z.number(),
  paidAt: z.string(),
  // category: z.string(),
  // paidByMemberId: z.string(),
  // paidByMemberName: z.string(),
  // sharedWithMemberIds: z.array(z.string()),
  // imageUrls: z.array(z.string()),
}))

const { values, isFieldDirty, setFieldValue, handleSubmit } = useForm({
  validationSchema: formSchema,
})

const df = new DateFormatter('en-US', {
  dateStyle: 'long',
})

const onSubmit = handleSubmit(async (values) => {
  const db = useFirestore()
  try {
    await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), values)
    toast.success('已新增支出')
  }
  catch (error) {
    console.error(error)
    toast.error('新增支出失敗')
  }
})

const paidAtPlaceholder = ref()
const paidAtDate = computed({
  get: () => values.paidAt ? parseDate(values.paidAt) : today(getLocalTimeZone()),
  set: val => val,
})

onMounted(() => {
  const amountInput = document.getElementById('amountInput')
  if (amountInput) {
    amountInput.focus()
  }
})
</script>

<template>
  <ui-drawer-header>
    <!-- <ui-drawer-title>新增支出</ui-drawer-title> -->
    <ui-drawer-description>輸入支出資訊</ui-drawer-description>
  </ui-drawer-header>
  <div class="space-y-4 px-4">
    <ui-form-field v-slot="{ componentField }" name="amount" :validate-on-blur="!isFieldDirty">
      <ui-form-item>
        <ui-form-label>支出金額</ui-form-label>
        <ui-form-control>
          <div class="relative">
            <ui-input id="amountInput" class="pl-12" type="number" v-bind="componentField" step="0.01" />
            <ui-badge class="absolute start-0 inset-y-0 flex items-center justify-center ml-1 my-1 px-2">
              {{ trip.tripCurrency }}
            </ui-badge>
          </div>
        </ui-form-control>
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

    <ui-form-field name="dob">
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
</template>
