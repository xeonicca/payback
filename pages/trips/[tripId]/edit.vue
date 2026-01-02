<script setup lang="ts">
import type { TripMember } from '@/types'
import { toTypedSchema } from '@vee-validate/zod'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { useForm } from 'vee-validate'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import { CurrencyCode, supportedCurrencies } from '@/constants'

definePageMeta({
  middleware: ['auth'],
})

const route = useRoute()
const router = useRouter()
const db = useFirestore()

const tripId = route.params.tripId as string

// Fetch trip, members, and expenses
const { trip } = useTrip(tripId)
const { tripMembers } = useTripMembers(tripId)
const { enabledExpenses } = useTripExpenses(tripId)

const formSchema = toTypedSchema(z.object({
  name: z.string().min(2).max(50),
  tripCurrency: z.string(),
  exchangeRate: z.number(),
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

// Track members locally for add/remove operations
const localMembers = ref<TripMember[]>([])
const membersToDelete = ref<string[]>([])
const membersToAdd = ref<Omit<TripMember, 'id' | 'createdAtString'>[]>([])

// Store original values for reset
const originalTripData = ref<{ name: string, tripCurrency: string, exchangeRate: number } | null>(null)
const originalMembers = ref<TripMember[]>([])

// Initialize form values when trip data loads
watch(trip, (newTrip) => {
  if (newTrip) {
    setFieldValue('name', newTrip.name)
    setFieldValue('tripCurrency', newTrip.tripCurrency)
    setFieldValue('exchangeRate', newTrip.exchangeRate)

    // Store original values for reset
    if (!originalTripData.value) {
      originalTripData.value = {
        name: newTrip.name,
        tripCurrency: newTrip.tripCurrency,
        exchangeRate: newTrip.exchangeRate,
      }
    }
  }
}, { immediate: true })

// Initialize local members when tripMembers loads
watch(tripMembers, (newMembers) => {
  if (newMembers && newMembers.length > 0 && localMembers.value.length === 0) {
    localMembers.value = [...newMembers]
    originalMembers.value = [...newMembers]
  }
}, { immediate: true })

const onSubmit = handleSubmit(async (values) => {
  try {
    isSubmitting.value = true

    // Update trip document
    const tripRef = doc(db, 'trips', tripId)
    await updateDoc(tripRef, {
      name: values.name,
      tripCurrency: values.tripCurrency,
      exchangeRate: values.tripCurrency === CurrencyCode.TWD ? 1 : values.exchangeRate,
    })

    // Delete removed members
    for (const memberId of membersToDelete.value) {
      await deleteDoc(doc(db, 'trips', tripId, 'members', memberId))
    }

    // Add new members
    for (const member of membersToAdd.value) {
      await addDoc(collection(db, 'trips', tripId, 'members'), {
        name: member.name,
        avatarEmoji: member.avatarEmoji,
        isHost: member.isHost,
        spending: member.spending,
        createdAt: new Date(),
      })
    }

    toast.success('Trip updated successfully!')
    router.push(`/trips/${tripId}`)
  }
  catch (error) {
    console.error('Error updating trip:', error)
    toast.error('Failed to update trip')
  }
  finally {
    isSubmitting.value = false
  }
})

watch(() => values.tripCurrency, () => {
  setFieldValue('exchangeRate', exchangeRateToTwd.value)
})

function onMembersChange(updatedMembers: TripMember[]) {
  // Find members that were removed
  const removedMembers = localMembers.value.filter(
    localMember => !updatedMembers.some(updatedMember => updatedMember.id === localMember.id),
  )

  // Find members that were added (they won't have an id or will have a temporary id)
  const addedMembers = updatedMembers.filter(
    updatedMember => !localMembers.value.some(localMember => localMember.id === updatedMember.id),
  )

  // Track deletions (only for members with real Firestore IDs)
  for (const removed of removedMembers) {
    if (removed.id && !removed.id.startsWith('temp-')) {
      if (!membersToDelete.value.includes(removed.id)) {
        membersToDelete.value.push(removed.id)
      }
    }
  }

  // Track additions
  for (const added of addedMembers) {
    if (!membersToAdd.value.some(m => m.name === added.name)) {
      membersToAdd.value.push({
        name: added.name,
        avatarEmoji: added.avatarEmoji,
        isHost: added.isHost,
        spending: added.spending,
        createdAt: new Date() as any,
      })
    }
  }

  localMembers.value = updatedMembers
}

function handleReset() {
  // Reset form values to original
  if (originalTripData.value) {
    setFieldValue('name', originalTripData.value.name)
    setFieldValue('tripCurrency', originalTripData.value.tripCurrency)
    setFieldValue('exchangeRate', originalTripData.value.exchangeRate)
  }

  // Reset members to original
  localMembers.value = [...originalMembers.value]
  membersToDelete.value = []
  membersToAdd.value = []

  toast.success('Form reset to original values')
}
</script>

<template>
  <form class="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-xl space-y-6" @submit.prevent="onSubmit">
    <div class="flex items-center justify-between pb-4">
      <h2 class="text-lg font-semibold text-gray-700 m-0">
        編輯行程
      </h2>
      <ui-button
        type="button"
        variant="ghost"
        size="icon"
        @click="router.push(`/trips/${tripId}`)"
      >
        <Icon name="lucide:x" :size="20" />
      </ui-button>
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
          <ui-form-label>行程幣值</ui-form-label>
          <ui-select v-bind="componentField">
            <ui-form-control>
              <ui-select-trigger class="w-full">
                <ui-select-value placeholder="請選擇幣值" />
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
          <ui-form-label>對台幣的匯率</ui-form-label>
          <ui-form-control>
            <ui-input type="number" step=".00001" :placeholder="exchangeRateToTwd.toString()" v-bind="componentField" />
          </ui-form-control>
          <ui-form-description>
            1 {{ values.tripCurrency }} = {{ exchangeRateToTwd }} TWD
          </ui-form-description>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>
    </div>

    <edit-trip-members-form
      v-if="localMembers.length > 0"
      :members="localMembers"
      :expenses="enabledExpenses"
      :on-members-change="onMembersChange"
    />

    <div class="flex gap-3">
      <ui-button
        type="button"
        variant="outline"
        class="flex-1"
        @click="handleReset"
      >
        <Icon name="lucide:rotate-ccw" :size="16" class="mr-2" />
        重設
      </ui-button>
      <ui-button
        type="submit"
        :disabled="isSubmitting"
        class="flex-1"
        variant="default"
      >
        {{ isSubmitting ? '更新中...' : '更新行程' }}
      </ui-button>
    </div>
  </form>
</template>
