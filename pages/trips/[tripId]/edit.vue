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
const isArchiving = ref(false)
const showArchiveWarning = ref(false)

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

function handleArchiveClick() {
  if (!trip.value) return

  // If already archived, unarchive directly
  if (trip.value.archived) {
    handleArchiveToggle()
  }
  else {
    // Show warning before archiving
    showArchiveWarning.value = true
  }
}

async function handleArchiveToggle() {
  if (!trip.value) return

  const newArchivedState = !trip.value.archived

  try {
    isArchiving.value = true

    const tripRef = doc(db, 'trips', tripId)
    await updateDoc(tripRef, {
      archived: newArchivedState,
    })

    toast.success(newArchivedState ? 'Trip archived successfully' : 'Trip unarchived successfully')
    showArchiveWarning.value = false
  }
  catch (error) {
    console.error('Error toggling archive:', error)
    toast.error('Failed to update trip archive status')
  }
  finally {
    isArchiving.value = false
  }
}
</script>

<template>
  <form class="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-xl space-y-6" @submit.prevent="onSubmit">
    <div class="flex items-center justify-between pb-4">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold text-gray-700 m-0">
          編輯行程
        </h2>
        <ui-badge v-if="trip?.archived" variant="secondary" class="text-xs">
          已封存
        </ui-badge>
      </div>
      <ui-button
        type="button"
        variant="ghost"
        size="icon"
        @click="router.push(`/trips/${tripId}`)"
      >
        <Icon name="lucide:x" :size="20" />
      </ui-button>
    </div>

    <!-- Archived Notice -->
    <div v-if="trip?.archived" class="p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <div class="flex items-start gap-3">
        <Icon name="lucide:archive" class="w-5 h-5 text-amber-600 mt-0.5" />
        <div class="flex-1">
          <h3 class="text-sm font-semibold text-amber-900 m-0 mb-1">
            此行程已封存
          </h3>
          <p class="text-sm text-amber-700 m-0">
            封存的行程無法編輯或新增支出。現有支出仍可編輯。如需修改行程設定，請先取消封存。
          </p>
        </div>
      </div>
    </div>

    <div class="space-y-4">
      <ui-form-field v-slot="{ componentField }" name="name" :validate-on-blur="!isFieldDirty">
        <ui-form-item>
          <ui-form-label>行程名稱</ui-form-label>
          <ui-form-control>
            <ui-input type="text" placeholder="日本東京旅遊" :disabled="trip?.archived" v-bind="componentField" />
          </ui-form-control>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>

      <ui-form-field v-slot="{ componentField }" name="tripCurrency" :validate-on-blur="!isFieldDirty">
        <ui-form-item>
          <ui-form-label>行程幣值</ui-form-label>
          <ui-select v-bind="componentField" :disabled="trip?.archived">
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
            <ui-input type="number" step=".00001" :placeholder="exchangeRateToTwd.toString()" :disabled="trip?.archived" v-bind="componentField" />
          </ui-form-control>
          <ui-form-description>
            1 {{ values.tripCurrency }} = {{ exchangeRateToTwd }} TWD
          </ui-form-description>
          <ui-form-message />
        </ui-form-item>
      </ui-form-field>
    </div>

    <edit-trip-members-form
      v-if="localMembers.length > 0 && !trip?.archived"
      :members="localMembers"
      :expenses="enabledExpenses"
      :on-members-change="onMembersChange"
    />

    <div v-if="!trip?.archived" class="flex gap-3">
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

    <!-- Archive Section -->
    <div class="pt-6 border-t border-gray-200">
      <div class="space-y-4">
        <div>
          <h3 class="text-base font-semibold text-gray-900 m-0 mb-2">
            {{ trip?.archived ? '取消封存行程' : '封存行程' }}
          </h3>
          <p class="text-sm text-gray-600 m-0 mb-4">
            {{ trip?.archived
              ? '取消封存後，您可以繼續編輯行程資訊和新增支出。'
              : '封存行程後，將無法編輯行程資訊或新增新支出。現有支出仍可編輯。'
            }}
          </p>
        </div>
        <ui-button
          type="button"
          :variant="trip?.archived ? 'default' : 'destructive'"
          :disabled="isArchiving"
          @click="handleArchiveClick"
        >
          <Icon :name="trip?.archived ? 'lucide:archive-restore' : 'lucide:archive'" :size="16" class="mr-2" />
          {{ isArchiving ? '處理中...' : (trip?.archived ? '取消封存行程' : '封存行程') }}
        </ui-button>
      </div>
    </div>
  </form>

  <!-- Archive Warning Drawer -->
  <ui-drawer v-model:open="showArchiveWarning">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-md p-6">
        <div class="space-y-6">
          <!-- Warning Icon -->
          <div class="flex justify-center">
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <Icon name="lucide:alert-triangle" class="w-8 h-8 text-red-600" />
            </div>
          </div>

          <!-- Warning Title -->
          <div class="text-center space-y-2">
            <h2 class="text-xl font-bold text-gray-900 m-0">
              確定要封存此行程？
            </h2>
            <p class="text-sm text-gray-600 m-0">
              此操作會限制行程的編輯功能
            </p>
          </div>

          <!-- Warning Content -->
          <div class="space-y-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div class="flex items-start gap-2">
              <Icon name="lucide:x-circle" class="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <p class="text-sm text-gray-700 m-0">
                <strong>無法新增支出：</strong>封存後將無法新增任何新的支出記錄
              </p>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="lucide:x-circle" class="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <p class="text-sm text-gray-700 m-0">
                <strong>無法編輯行程：</strong>行程名稱、幣值、匯率和成員將無法修改
              </p>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
              <p class="text-sm text-gray-700 m-0">
                <strong>可以編輯現有支出：</strong>已存在的支出仍可查看和編輯
              </p>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="lucide:info" class="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <p class="text-sm text-gray-700 m-0">
                <strong>可以取消封存：</strong>之後可以在編輯頁面取消封存來恢復編輯功能
              </p>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex gap-3">
            <ui-button
              type="button"
              variant="outline"
              class="flex-1"
              :disabled="isArchiving"
              @click="showArchiveWarning = false"
            >
              取消
            </ui-button>
            <ui-button
              type="button"
              variant="destructive"
              class="flex-1"
              :disabled="isArchiving"
              @click="handleArchiveToggle"
            >
              <Icon name="lucide:archive" :size="16" class="mr-2" />
              {{ isArchiving ? '處理中...' : '確定封存' }}
            </ui-button>
          </div>
        </div>
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
