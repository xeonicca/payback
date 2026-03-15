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
import { CurrencyCode, animalEmojis, supportedCurrencies } from '@/constants'

definePageMeta({
  middleware: ['auth'],
})

const route = useRoute()
const router = useRouter()
const db = useFirestore()

const tripId = route.params.tripId as string

// Fetch trip, members, and expenses
const { trip } = useTrip(tripId)
const { tripMembers, currentUserMember } = useTripMembers(tripId)
const { enabledExpenses } = useTripExpenses(tripId)
const { collaborators, isOwner, canInvite } = useTripCollaborators(tripId)

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
const showInviteDrawer = ref(false)

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

    toast.success('行程已更新')
    router.push(`/trips/${tripId}`)
  }
  catch (error) {
    console.error('Error updating trip:', error)
    toast.error('更新失敗，請稍後再試')
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

  toast.success('已還原所有變更')
}

// Self-edit for non-owner collaborators
const selfEditName = ref('')
const selfEditAvatar = ref('')
const isSelfSubmitting = ref(false)

watch(currentUserMember, (member) => {
  if (member && !selfEditName.value) {
    selfEditName.value = member.name
    selfEditAvatar.value = member.avatarEmoji
  }
}, { immediate: true })

// Available emojis for self-edit (current user's emoji is always available)
const selfAvailableEmojis = computed(() => {
  const usedEmojis = tripMembers.value
    ?.filter(m => m.id !== currentUserMember.value?.id)
    .map(m => m.avatarEmoji) || []
  return animalEmojis.filter(emoji => !usedEmojis.includes(emoji))
})

async function handleSelfSave() {
  if (!currentUserMember.value)
    return

  const trimmedName = selfEditName.value.trim()
  if (!trimmedName) {
    toast.error('請輸入名稱')
    return
  }

  // Check for duplicate names (excluding self)
  const nameExists = tripMembers.value?.some(
    m => m.id !== currentUserMember.value!.id && m.name.toLowerCase() === trimmedName.toLowerCase(),
  )
  if (nameExists) {
    toast.error(`「${trimmedName}」已被其他成員使用`)
    return
  }

  try {
    isSelfSubmitting.value = true
    const memberRef = doc(db, 'trips', tripId, 'members', currentUserMember.value.id)
    await updateDoc(memberRef, {
      name: trimmedName,
      avatarEmoji: selfEditAvatar.value,
    })
    toast.success('個人資料已更新')
    router.push(`/trips/${tripId}`)
  }
  catch (error) {
    console.error('Error updating member:', error)
    toast.error('更新失敗，請稍後再試')
  }
  finally {
    isSelfSubmitting.value = false
  }
}

function handleArchiveClick() {
  if (!trip.value)
    return

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
  if (!trip.value)
    return

  const newArchivedState = !trip.value.archived

  try {
    isArchiving.value = true

    const tripRef = doc(db, 'trips', tripId)
    await updateDoc(tripRef, {
      archived: newArchivedState,
    })

    toast.success(newArchivedState ? '行程已封存' : '已取消封存')
    showArchiveWarning.value = false
  }
  catch (error) {
    console.error('Error toggling archive:', error)
    toast.error('操作失敗，請稍後再試')
  }
  finally {
    isArchiving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <!-- Header -->
    <div class="bg-white p-6 rounded-lg shadow-xl" :class="{ 'pb-0': isOwner }">
      <div class="flex items-center justify-between pb-4">
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-semibold text-gray-700 m-0">
            {{ isOwner ? '編輯行程' : '編輯個人資料' }}
          </h2>
          <ui-badge v-if="trip?.archived" variant="secondary" class="text-xs">
            已封存
          </ui-badge>
        </div>
        <ui-button
          v-if="isOwner"
          type="button"
          variant="ghost"
          size="icon"
          aria-label="關閉"
          @click="router.push(`/trips/${tripId}`)"
        >
          <Icon name="lucide:x" :size="20" />
        </ui-button>
      </div>

      <!-- ===== Non-owner: Self-edit profile only ===== -->
      <template v-if="!isOwner">
        <form v-if="currentUserMember" class="space-y-5 pb-6" @submit.prevent="handleSelfSave">
          <div class="flex items-center gap-4">
            <div class="w-16 h-16 flex items-center justify-center text-3xl bg-indigo-50 border-2 border-indigo-200 rounded-xl shrink-0">
              {{ selfEditAvatar }}
            </div>
            <div class="flex-1">
              <label for="self-edit-name" class="text-sm font-medium text-gray-700 mb-1.5 block">顯示名稱</label>
              <ui-input
                id="self-edit-name"
                v-model="selfEditName"
                type="text"
                placeholder="輸入你的名稱"
                class="h-12 text-base"
                :disabled="isSelfSubmitting"
              />
            </div>
          </div>

          <!-- Avatar grid -->
          <div class="space-y-1.5">
            <label class="text-sm font-medium text-gray-700">選擇頭像</label>
            <div class="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
              <button
                v-for="emoji in selfAvailableEmojis"
                :key="emoji"
                type="button"
                :class="{
                  'bg-indigo-500 ring-2 ring-indigo-500 ring-offset-1': selfEditAvatar === emoji,
                  'bg-white hover:bg-gray-100': selfEditAvatar !== emoji,
                }"
                class="aspect-square flex items-center justify-center text-xl rounded-lg border border-gray-200 transition-colors cursor-pointer"
                @click="selfEditAvatar = emoji"
              >
                {{ emoji }}
              </button>
            </div>
          </div>

          <div class="flex gap-3">
            <ui-button
              type="button"
              variant="outline"
              class="flex-1"
              :disabled="isSelfSubmitting"
              @click="router.push(`/trips/${tripId}`)"
            >
              取消
            </ui-button>
            <ui-button
              type="submit"
              class="flex-1"
              :disabled="isSelfSubmitting"
            >
              {{ isSelfSubmitting ? '儲存中...' : '儲存變更' }}
            </ui-button>
          </div>
        </form>

        <!-- Loading state -->
        <div v-else class="py-8 flex justify-center">
          <ui-skeleton class="w-full h-32" />
        </div>
      </template>

      <!-- ===== Owner: Full edit with tabs ===== -->
      <template v-else>
        <!-- Archived Notice -->
        <alert-banner v-if="trip?.archived" icon="lucide:archive" title="此行程已封存" variant="warning" class="mb-4">
          封存的行程無法編輯或新增支出。如需修改，請先取消封存。
        </alert-banner>

        <!-- Tabs -->
        <ui-tabs default-value="info">
          <ui-tabs-list class="w-full">
            <ui-tabs-trigger value="info" class="flex-1">
              <Icon name="lucide:settings" :size="14" class="mr-1.5" />
              行程資訊
            </ui-tabs-trigger>
            <ui-tabs-trigger value="members" class="flex-1" :disabled="!!trip?.archived">
              <Icon name="lucide:users" :size="14" class="mr-1.5" />
              成員
              <ui-badge variant="secondary" class="text-xs ml-1.5">
                {{ localMembers.length }}
              </ui-badge>
            </ui-tabs-trigger>
            <ui-tabs-trigger value="collaborators" class="flex-1">
              <Icon name="lucide:share-2" :size="14" class="mr-1.5" />
              協作
              <ui-badge variant="secondary" class="text-xs ml-1.5">
                {{ collaborators.length }}
              </ui-badge>
            </ui-tabs-trigger>
          </ui-tabs-list>

          <!-- Tab: Trip Info -->
          <ui-tabs-content value="info" force-mount class="pt-4 pb-6 data-[state=inactive]:hidden">
            <form class="space-y-5" @submit.prevent="onSubmit">
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
                    <ui-form-label>消費幣別</ui-form-label>
                    <ui-select v-bind="componentField" :disabled="trip?.archived">
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
                      <ui-input type="number" step=".00001" :placeholder="exchangeRateToTwd.toString()" :disabled="trip?.archived" v-bind="componentField" />
                    </ui-form-control>
                    <ui-form-description>
                      1 {{ values.tripCurrency }} ≈ {{ exchangeRateToTwd }} TWD（已自動帶入參考匯率，可手動調整）
                    </ui-form-description>
                    <ui-form-message />
                  </ui-form-item>
                </ui-form-field>
              </div>

              <div v-if="!trip?.archived" class="flex gap-3">
                <ui-button
                  type="button"
                  variant="outline"
                  class="flex-1"
                  @click="handleReset"
                >
                  <Icon name="lucide:rotate-ccw" :size="16" class="mr-2" />
                  還原
                </ui-button>
                <ui-button
                  type="submit"
                  :disabled="isSubmitting"
                  class="flex-1"
                  variant="default"
                >
                  {{ isSubmitting ? '儲存中...' : '儲存變更' }}
                </ui-button>
              </div>
            </form>
          </ui-tabs-content>

          <!-- Tab: Members -->
          <ui-tabs-content value="members" force-mount class="pt-4 pb-6 data-[state=inactive]:hidden">
            <edit-trip-members-form
              v-if="localMembers.length > 0 && !trip?.archived"
              :members="localMembers"
              :expenses="enabledExpenses"
              :on-members-change="onMembersChange"
            />

            <div v-if="!trip?.archived" class="flex gap-3 mt-5">
              <ui-button
                type="button"
                variant="outline"
                class="flex-1"
                @click="handleReset"
              >
                <Icon name="lucide:rotate-ccw" :size="16" class="mr-2" />
                還原
              </ui-button>
              <ui-button
                type="button"
                :disabled="isSubmitting"
                class="flex-1"
                variant="default"
                @click="onSubmit"
              >
                {{ isSubmitting ? '儲存中...' : '儲存變更' }}
              </ui-button>
            </div>
          </ui-tabs-content>

          <!-- Tab: Collaborators -->
          <ui-tabs-content value="collaborators" class="pt-4 pb-6">
            <div class="space-y-4">
              <!-- Collaborators List -->
              <div v-if="collaborators.length > 0" class="space-y-2">
                <div
                  v-for="collaborator in collaborators"
                  :key="collaborator.userId"
                  class="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <!-- Avatar -->
                  <div class="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center shrink-0">
                    <img
                      v-if="collaborator.photoURL"
                      :src="collaborator.photoURL"
                      :alt="collaborator.displayName || ''"
                      class="w-full h-full object-cover"
                    >
                    <Icon v-else name="lucide:user" class="w-5 h-5 text-gray-400" />
                  </div>

                  <!-- Info -->
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-gray-900 truncate m-0">
                      {{ collaborator.displayName || '未知使用者' }}
                    </p>
                    <p class="text-xs text-gray-500 truncate m-0">
                      {{ collaborator.email }}
                    </p>
                  </div>

                  <ui-badge v-if="collaborator.role === 'owner'" variant="default" class="text-xs shrink-0">
                    <Icon name="lucide:crown" :size="12" class="mr-1" />
                    主辦人
                  </ui-badge>
                  <ui-badge v-else variant="secondary" class="text-xs shrink-0">
                    編輯者
                  </ui-badge>
                </div>
              </div>

              <!-- Invite Button -->
              <ui-button
                v-if="canInvite"
                type="button"
                class="w-full"
                variant="outline"
                @click="showInviteDrawer = true"
              >
                <Icon name="lucide:user-plus" :size="16" class="mr-2" />
                邀請協作者
              </ui-button>
            </div>
          </ui-tabs-content>
        </ui-tabs>
      </template>
    </div>

    <!-- Archive Section (owner only) -->
    <div v-if="isOwner" class="p-6 bg-white rounded-lg shadow-xl">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold text-gray-900 m-0 mb-1">
            {{ trip?.archived ? '取消封存' : '封存行程' }}
          </h3>
          <p class="text-xs text-gray-500 m-0">
            {{ trip?.archived
              ? '取消封存後即可繼續編輯和新增支出'
              : '封存後將無法新增支出或修改行程設定'
            }}
          </p>
        </div>
        <ui-button
          type="button"
          :variant="trip?.archived ? 'outline' : 'destructive'"
          size="sm"
          :disabled="isArchiving"
          @click="handleArchiveClick"
        >
          <Icon :name="trip?.archived ? 'lucide:archive-restore' : 'lucide:archive'" :size="14" class="mr-1.5" />
          {{ isArchiving ? '處理中...' : (trip?.archived ? '取消封存' : '封存') }}
        </ui-button>
      </div>
    </div>
  </div>

  <!-- Invite Collaborators Drawer -->
  <invite-collaborators-drawer
    v-if="trip"
    :trip-id="tripId"
    :open="showInviteDrawer"
    @update:open="showInviteDrawer = $event"
  />

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
              確定要封存「{{ trip?.name }}」？
            </h2>
            <p class="text-sm text-gray-600 m-0">
              封存後會限制以下功能
            </p>
          </div>

          <!-- Warning Content -->
          <div class="space-y-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div class="flex items-start gap-2">
              <Icon name="lucide:x-circle" class="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <p class="text-sm text-gray-700 m-0">
                無法新增支出或修改行程設定
              </p>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
              <p class="text-sm text-gray-700 m-0">
                現有支出仍可查看和編輯
              </p>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="lucide:info" class="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <p class="text-sm text-gray-700 m-0">
                隨時可以取消封存
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
              {{ isArchiving ? '處理中...' : '確定封存' }}
            </ui-button>
          </div>
        </div>
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
