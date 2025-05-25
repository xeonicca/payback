<script setup lang="ts">
import type { TripMember } from '@/types'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import {
  FormControl as UiFormControl,
  FormDescription as UiFormDescription,
  FormField as UiFormField,
  FormItem as UiFormItem,
  FormLabel as UiFormLabel,
  FormMessage as UiFormMessage,
} from '@/components/ui/form'

import { CurrencyCode, supportedCurrencies } from '@/constants'

interface Props {
  onSubmit: (tripData: NewTripData) => Promise<void>
  isSubmitting?: boolean
}

interface NewTripData {
  name: string
  tripCurrency: string
  exchangeRateToTWD: number
  members: Omit<TripMember, 'id' | 'createdAt'>[]
}

const formSchema = toTypedSchema(z.object({
  name: z.string().min(2).max(50),
  tripCurrency: z.string().default(CurrencyCode.TWD),
  exchangeRate: z.number().default(1),
}))

const { values, isFieldDirty, handleSubmit } = useForm({
  validationSchema: formSchema,
})

const members = ref<TripMember[]>([])

function handleMembersChange(updated: TripMember[]) {
  members.value = updated
}

const isSubmitting = ref(false)

const onSubmit = handleSubmit((values) => {
  toast({
    title: 'You submitted the following values:',
    description: h('pre', { class: 'mt-2 w-[340px] rounded-md bg-slate-950 p-4' }, h('code', { class: 'text-white' }, JSON.stringify(values, null, 2))),
  })
})
</script>

<template>
  <form class="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-xl space-y-8" @submit.prevent="onSubmit">
    <h2 class="text-lg font-semibold text-gray-700 border-b pb-4">
      新增行程
    </h2>
    <div class="space-y-4">
      <ui-form-field v-slot="{ componentField }" name="name" :validate-on-blur="!isFieldDirty">
        <ui-form-item>
          <ui-form-label>行程名稱</ui-form-label>
          <ui-form-control>
            <ui-input type="text" placeholder="日本東京旅遊" v-bind="componentField" />
          </ui-form-control>
          <!-- <ui-form-description>
            這是你的行程名稱。
          </ui-form-description> -->
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>

      <ui-form-field v-slot="{ componentField }" name="tripCurrency" :validate-on-blur="!isFieldDirty">
        <ui-form-item>
          <ui-form-label>行程幣值</ui-form-label>
          <ui-select v-bind="componentField">
            <ui-form-control>
              <ui-select-trigger class="w-full">
                <ui-select-value placeholder="請選擇幣值" />
              </ui-select-trigger>
              <!-- <ui-form-description>
                這是你的行程幣值。
              </ui-form-description> -->
              <ui-form-message />
            </ui-form-control>
            <ui-select-content>
              <ui-select-group>
                <ui-select-item v-for="currency in supportedCurrencies" :key="currency.code" :value="currency.code">
                  {{ `${currency.code} - ${currency.name}` }}
                </ui-select-item>
              </ui-select-group>
            </ui-select-content>
          </ui-select>
        </ui-form-item>
      </ui-form-field>

      <ui-form-field v-if="values.tripCurrency !== CurrencyCode.TWD" v-slot="{ componentField }" name="exchangeRate" :validate-on-blur="!isFieldDirty">
        <ui-form-item>
          <ui-form-label>對台幣的匯率</ui-form-label>
          <ui-form-control>
            <ui-input type="number" placeholder="請輸入匯率" v-bind="componentField" />
          </ui-form-control>
          <ui-form-description>
            一元台幣可換得的{{ values.tripCurrency }}數量。
          </ui-form-description>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>
    </div>

    <!-- <AddTripMembersForm
      :members="members"
      :on-members-change="handleMembersChange"
    /> -->

    <ui-button
      type="submit"
      :disabled="isSubmitting"
      class="w-full"
      variant="default"
    >
      {{ isSubmitting ? 'Creating Trip...' : 'Create Trip & Add Members' }}
    </ui-button>
  </form>
</template>
