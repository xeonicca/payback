<script setup lang="ts">
import type { NewTrip, NewTripMember } from '@/types'
import { toTypedSchema } from '@vee-validate/zod'
import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
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

const { values, isFieldDirty, handleSubmit, setFieldValue, validateField } = useForm({
  validationSchema: formSchema,
})

const currentStep = ref(1)

async function goToStep(step: number) {
  if (step === 2) {
    const nameResult = await validateField('name')
    const currencyResult = await validateField('tripCurrency')
    if (!nameResult.valid || !currencyResult.valid)
      return
  }
  currentStep.value = step
}

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
    name: sessionUser.value!.displayName || '使用者',
    avatarEmoji: '🐭',
    isHost: true,
    createdAt: serverTimestamp(),
    spending: 0,
    linkedUserId: sessionUser.value!.uid,
  },
]

const allMembers = ref<NewTripMember[]>([...defaultMembers])

const onSubmit = handleSubmit(async (values) => {
  try {
    isSubmitting.value = true

    const tripData: NewTrip = {
      name: values.name,
      tripCurrency: values.tripCurrency,
      exchangeRate: values.tripCurrency === CurrencyCode.TWD ? 1 : values.exchangeRate,
      defaultCurrency: CurrencyCode.TWD,
      createdAt: serverTimestamp(),
      userId: sessionUser.value!.uid,
      expenseCount: 0,
      archived: false,
      collaboratorCount: 1, // Owner is the first collaborator
      isPublicInviteEnabled: true,
      collaboratorUserIds: [sessionUser.value!.uid],
      ownerDisplayName: sessionUser.value!.displayName || '',
    }

    const docRef = await writeTrip(tripData)

    // Initialize owner as collaborator
    await writeTripCollaborator(docRef.id, sessionUser.value!.uid, {
      userId: sessionUser.value!.uid,
      email: sessionUser.value!.email,
      displayName: sessionUser.value!.displayName,
      photoURL: sessionUser.value!.photoURL,
      role: 'owner',
      joinedAt: serverTimestamp(),
    })

    // Save all trip members
    for (const member of allMembers.value) {
      await writeTripMembers(docRef.id, member)
    }

    const { logEvent } = useAnalytics()
    logEvent('create_trip', { trip_id: docRef.id })
    toast.success('行程建立成功！')
    router.push(`/trips/${docRef.id}`)
  }
  catch (error) {
    console.error('Error creating trip:', error)
    toast.error('建立行程失敗，請稍後再試')
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

async function writeTripCollaborator(tripId: string, userId: string, collaborator: any) {
  const docRef = doc(db, 'trips', tripId, 'collaborators', userId)
  await setDoc(docRef, collaborator)
  return docRef
}

function onMembersChange(updatedMembers: NewTripMember[]) {
  allMembers.value = updatedMembers
}
</script>

<template>
  <form class="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-xl space-y-6" @submit.prevent="onSubmit">
    <!-- Step Indicator -->
    <div class="flex items-center gap-2">
      <template v-for="step in 3" :key="step">
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors disabled:cursor-not-allowed"
          :class="{
            'bg-indigo-600 text-white': currentStep === step,
            'bg-indigo-100 text-indigo-600 hover:bg-indigo-200': currentStep > step,
            'bg-gray-200 text-gray-400': currentStep < step,
          }"
          :disabled="currentStep < step"
          @click="goToStep(step)"
        >
          {{ step }}
        </button>
        <div
          v-if="step < 3"
          class="flex-1 h-0.5 rounded-full transition-colors"
          :class="currentStep > step ? 'bg-indigo-600' : 'bg-gray-200'"
        />
      </template>
    </div>

    <!-- Step 1: Trip Info -->
    <div v-show="currentStep === 1" class="space-y-5">
      <div>
        <h2 class="text-lg font-semibold text-gray-700 pb-1 m-0">
          建立新行程
        </h2>
        <p class="text-sm text-gray-500 m-0">
          為你的旅行取個名字，選擇消費的幣別
        </p>
      </div>

      <div class="space-y-4">
        <ui-form-field v-slot="{ componentField }" name="name" :validate-on-blur="!isFieldDirty">
          <ui-form-item>
            <ui-form-label>行程名稱</ui-form-label>
            <ui-form-control>
              <ui-input type="text" placeholder="日本東京旅遊" v-bind="componentField" />
            </ui-form-control>
            <ui-form-message />
          </ui-form-item>
        </ui-form-field>

        <ui-form-field v-slot="{ componentField }" name="tripCurrency" :validate-on-blur="!isFieldDirty">
          <ui-form-item>
            <ui-form-label>消費幣別</ui-form-label>
            <ui-select v-bind="componentField">
              <ui-form-control>
                <ui-select-trigger class="w-full">
                  <ui-select-value placeholder="選擇旅行當地的幣別" />
                </ui-select-trigger>
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
            <ui-form-label>匯率換算</ui-form-label>
            <ui-form-control>
              <ui-input type="number" step=".00001" :placeholder="exchangeRateToTwd.toString()" v-bind="componentField" />
            </ui-form-control>
            <ui-form-description>
              1 {{ values.tripCurrency }} ≈ {{ exchangeRateToTwd }} TWD（已自動帶入參考匯率，可手動調整）
            </ui-form-description>
            <ui-form-message />
          </ui-form-item>
        </ui-form-field>
      </div>

      <ui-button
        type="button"
        class="w-full"
        @click="goToStep(2)"
      >
        下一步：加入成員
        <Icon name="lucide:arrow-right" :size="16" class="ml-1" />
      </ui-button>
    </div>

    <!-- Step 2: Members -->
    <div v-show="currentStep === 2" class="space-y-5">
      <div>
        <h2 class="text-lg font-semibold text-gray-700 pb-1 m-0">
          加入旅伴
        </h2>
        <p class="text-sm text-gray-500 m-0">
          新增一起分帳的成員，之後也可以再調整
        </p>
      </div>

      <add-trip-members-form
        :members="allMembers"
        :on-members-change="onMembersChange"
      />

      <div class="flex gap-3">
        <ui-button
          type="button"
          variant="outline"
          class="flex-1"
          @click="goToStep(1)"
        >
          <Icon name="lucide:arrow-left" :size="16" class="mr-1" />
          上一步
        </ui-button>
        <ui-button
          type="button"
          class="flex-1"
          @click="goToStep(3)"
        >
          下一步：確認
          <Icon name="lucide:arrow-right" :size="16" class="ml-1" />
        </ui-button>
      </div>
    </div>

    <!-- Step 3: Review & Confirm -->
    <div v-show="currentStep === 3" class="space-y-5">
      <div>
        <h2 class="text-lg font-semibold text-gray-700 pb-1 m-0">
          確認行程資訊
        </h2>
        <p class="text-sm text-gray-500 m-0">
          確認以下資訊無誤後，即可建立行程
        </p>
      </div>

      <!-- Trip info summary -->
      <div class="space-y-3">
        <div class="p-4 bg-gray-50 rounded-lg space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-500">行程名稱</span>
            <span class="text-sm font-semibold text-gray-900">{{ values.name }}</span>
          </div>
          <ui-separator />
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-500">消費幣別</span>
            <span class="text-sm font-semibold text-gray-900">{{ values.tripCurrency }}</span>
          </div>
          <template v-if="values.tripCurrency !== CurrencyCode.TWD">
            <ui-separator />
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-500">匯率</span>
              <span class="text-sm font-mono text-gray-900">1 {{ values.tripCurrency }} ≈ {{ values.exchangeRate }} TWD</span>
            </div>
          </template>
        </div>

        <!-- Members summary -->
        <div class="p-4 bg-gray-50 rounded-lg">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm text-gray-500">行程成員</span>
            <span class="text-sm font-semibold text-gray-900">{{ allMembers.length }} 人</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="member in allMembers"
              :key="member.name"
              class="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-full text-sm"
            >
              <span class="text-base">{{ member.avatarEmoji }}</span>
              <span class="text-gray-700 font-medium">{{ member.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex gap-3">
        <ui-button
          type="button"
          variant="outline"
          class="flex-1"
          @click="goToStep(2)"
        >
          <Icon name="lucide:arrow-left" :size="16" class="mr-1" />
          上一步
        </ui-button>
        <ui-button
          type="submit"
          :disabled="isSubmitting"
          class="flex-1"
          variant="default"
        >
          {{ isSubmitting ? '建立中...' : '建立行程' }}
        </ui-button>
      </div>
    </div>
  </form>
</template>
