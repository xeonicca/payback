<script setup lang="ts">
import type { NewTrip, NewTripMember } from '@/types'
import { toTypedSchema } from '@vee-validate/zod'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { useForm } from 'vee-validate'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'
import * as z from 'zod'
import {
  FormControl as UiFormControl,
  FormDescription as UiFormDescription,
  FormField as UiFormField,
  FormItem as UiFormItem,
  FormLabel as UiFormLabel,
  FormMessage as UiFormMessage,
} from '@/components/ui/form'
import { useSessionUser } from '@/composables/useSessionUser'
import { CurrencyCode, supportedCurrencies } from '@/constants'

const formSchema = toTypedSchema(z.object({
  name: z.string().min(2).max(50),
  tripCurrency: z.string().default(CurrencyCode.TWD),
  exchangeRate: z.number().default(1),
}))

const { values, isFieldDirty, handleSubmit, setFieldValue } = useForm({
  validationSchema: formSchema,
})

interface TwdCurrency {
  twd: {
    [key: string]: number
  }
}

const { data: twdCurrency } = await useAsyncData('twdCurrency', async () => {
  const data = await $fetch<TwdCurrency>('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/twd.json')
  return data.twd
})

const exchangeRateFromTwd = computed(() => {
  const currency = values.tripCurrency?.toLowerCase() || CurrencyCode.TWD
  if (!twdCurrency?.value)
    return 1
  return Math.round(twdCurrency.value[currency] * 10000) / 10000
})

const exchangeRateToTwd = computed(() => {
  return Math.round(1 / exchangeRateFromTwd.value * 10000) / 10000
})

const isSubmitting = ref(false)

const db = useFirestore()
const sessionUser = useSessionUser()
const router = useRouter()

const defaultMembers: NewTripMember[] = [
  {
    name: sessionUser.value!.displayName || 'User 1',
    avatarEmoji: '🐭',
    isHost: true,
    createdAt: serverTimestamp(),
  },
]

const onSubmit = handleSubmit(async (values) => {
  try {
    isSubmitting.value = true

    const tripData = {
      name: values.name,
      tripCurrency: values.tripCurrency,
      exchangeRate: values.tripCurrency === CurrencyCode.TWD ? 1 : values.exchangeRate,
      defaultCurrency: CurrencyCode.TWD,
      createdAt: serverTimestamp(),
      userId: sessionUser.value!.uid,
      totalExpenses: 0,
      expenseCount: 0,
    }

    const docRef = await writeTrip(tripData)
    await writeTripMembers(docRef.id, {
      name: sessionUser.value!.displayName || 'User 1',
      avatarEmoji: '🐭',
      createdAt: serverTimestamp(),
      spending: 0,
      isHost: true,
    })
    toast.success('Trip created successfully!')
    router.push(`/trips/${docRef.id}`)
  }
  catch (error) {
    console.error('Error creating trip:', error)
    toast.error('Failed to create trip')
  }
  finally {
    isSubmitting.value = false
  }
})

watch(() => values.tripCurrency, () => {
  setFieldValue('exchangeRate', exchangeRateToTwd.value)
})

async function writeTrip(tripData: NewTrip) {
  const docRef = await addDoc(collection(db, 'trips'), tripData)
  return docRef
}

async function writeTripMembers(tripId: string, member: NewTripMember) {
  const docRef = await addDoc(collection(db, 'trips', tripId, 'members'), member)
  return docRef
}

const onMembersChange = (updatedMembers: NewTripMember[]) => {
  console.log(updatedMembers)
}
</script>

<template>
  <form class="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-xl space-y-6" @submit.prevent="onSubmit">
    <h2 class="text-lg font-semibold text-gray-700 pb-4 m-0">
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
            <ui-input type="number" step=".00001" :placeholder="exchangeRateToTwd" v-bind="componentField" />
          </ui-form-control>
          <ui-form-description>
            1 {{ values.tripCurrency }} = {{ exchangeRateToTwd }} TWD
          </ui-form-description>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>
    </div>

    <add-trip-members-form
      :members="defaultMembers"
      :on-members-change="onMembersChange"
    />

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
