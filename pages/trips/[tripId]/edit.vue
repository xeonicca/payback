<script setup lang="ts">
import type { TripMember } from '@/types'
import { toTypedSchema } from '@vee-validate/zod'
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { useForm } from 'vee-validate'
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
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
import { animalEmojis, CurrencyCode, supportedCurrencies } from '@/constants'

definePageMeta({
  middleware: ['auth'],
})

const route = useRoute()
const router = useRouter()
const db = useFirestore()
const sessionUser = useSessionUser()

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
const activeTab = ref('info')
const isArchiving = ref(false)
const showArchiveWarning = ref(false)
const showUnarchiveWarning = ref(false)
const showInviteDrawer = ref(false)
const isTogglingPublicInvite = ref(false)
const { copyToClipboard } = useCopyToClipboard()

const baseUrl = useRequestURL().origin
const publicJoinUrl = computed(() => {
  if (!trip.value?.publicJoinCode)
    return null
  return `${baseUrl}/join/${trip.value.publicJoinCode}?openExternalBrowser=1`
})

async function handleTogglePublicInvite(enabled: boolean) {
  try {
    isTogglingPublicInvite.value = true
    await $fetch('/api/trips/toggle-public-invite', {
      method: 'POST',
      body: { tripId, enabled },
    })
    toast.success(enabled ? '已開放加入' : '已關閉加入')
  }
  catch (error: any) {
    console.error('Error toggling public invite:', error)
    toast.error(error.data?.message || '操作失敗')
  }
  finally {
    isTogglingPublicInvite.value = false
  }
}

// Track members locally for add/remove operations
const localMembers = ref<TripMember[]>([])
const membersToDelete = ref<string[]>([])
const membersToAdd = ref<Omit<TripMember, 'id' | 'createdAtString'>[]>([])

// Store original values for reset
const originalTripData = ref<{ name: string, tripCurrency: string, exchangeRate: number } | null>(null)
const originalMembers = ref<TripMember[]>([])

// Track unsaved changes
const hasUnsavedChanges = computed(() => {
  if (!originalTripData.value)
    return false

  const tripChanged = values.name !== originalTripData.value.name
    || values.tripCurrency !== originalTripData.value.tripCurrency
    || values.exchangeRate !== originalTripData.value.exchangeRate

  const membersChanged = membersToDelete.value.length > 0 || membersToAdd.value.length > 0

  return tripChanged || membersChanged
})

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (hasUnsavedChanges.value) {
    e.preventDefault()
  }
}

watch(hasUnsavedChanges, (dirty) => {
  if (dirty) {
    window.addEventListener('beforeunload', handleBeforeUnload)
  }
  else {
    window.removeEventListener('beforeunload', handleBeforeUnload)
  }
})

// Warn before route navigation
const showUnsavedChangesDialog = ref(false)
let resolveNavigation: ((allow: boolean) => void) | null = null

// Warn before browser close/refresh
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  if (resolveNavigation) {
    resolveNavigation(false)
    resolveNavigation = null
  }
  showUnsavedChangesDialog.value = false
})

onBeforeRouteLeave(() => {
  if (hasUnsavedChanges.value) {
    showUnsavedChangesDialog.value = true
    return new Promise<boolean>((resolve) => {
      resolveNavigation = resolve
    })
  }
})

watch(showUnsavedChangesDialog, (open) => {
  if (!open && resolveNavigation) {
    resolveNavigation(false)
    resolveNavigation = null
  }
})

function confirmUnsavedLeave() {
  resolveNavigation?.(true)
  resolveNavigation = null
  showUnsavedChangesDialog.value = false
}

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
    toast.error((error as Error).message || '更新失敗，請稍後再試')
  }
  finally {
    isSubmitting.value = false
  }
})

watch(() => values.tripCurrency, () => {
  setFieldValue('exchangeRate', exchangeRateToTwd.value)
})

function onMembersChange(updatedMembers: TripMember[]) {
  const removedMembers = localMembers.value.filter(
    localMember => !updatedMembers.some(updatedMember => updatedMember.id === localMember.id),
  )

  const addedMembers = updatedMembers.filter(
    updatedMember => !localMembers.value.some(localMember => localMember.id === updatedMember.id),
  )

  for (const removed of removedMembers) {
    if (removed.id && !removed.id.startsWith('temp-')) {
      if (!membersToDelete.value.includes(removed.id)) {
        membersToDelete.value.push(removed.id)
      }
    }
  }

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
  if (originalTripData.value) {
    setFieldValue('name', originalTripData.value.name)
    setFieldValue('tripCurrency', originalTripData.value.tripCurrency)
    setFieldValue('exchangeRate', originalTripData.value.exchangeRate)
  }

  localMembers.value = [...originalMembers.value]
  membersToDelete.value = []
  membersToAdd.value = []

  toast.success('已還原所有變更')
}

// Leave trip
const isLeaving = ref(false)
const showLeaveWarning = ref(false)

async function handleLeaveTrip() {
  try {
    isLeaving.value = true
    await $fetch('/api/trips/leave', {
      method: 'POST',
      body: { tripId },
    })

    // Anonymous guests should be fully signed out after leaving
    if (sessionUser.value?.isAnonymous) {
      const { logout } = useLogin()
      await logout()
      toast.success('已離開行程')
      router.replace('/login')
    }
    else {
      toast.success('已離開行程')
      router.replace('/')
    }
  }
  catch (error: any) {
    console.error('Error leaving trip:', error)
    toast.error(error.data?.message || '離開行程失敗')
  }
  finally {
    isLeaving.value = false
    showLeaveWarning.value = false
  }
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

  try {
    isSelfSubmitting.value = true
    await $fetch(`/api/trips/${tripId}/members/me`, {
      method: 'PATCH',
      body: { name: trimmedName, avatarEmoji: selfEditAvatar.value },
    })
    toast.success('個人資料已更新')
    router.push(`/trips/${tripId}`)
  }
  catch (error: any) {
    console.error('Error updating member:', error)
    if (error.status === 409) {
      toast.error(error.data?.message || `「${trimmedName}」已被其他成員使用`)
    }
    else {
      toast.error(error.data?.message || '更新失敗，請稍後再試')
    }
  }
  finally {
    isSelfSubmitting.value = false
  }
}

function handleArchiveClick() {
  if (!trip.value)
    return

  if (trip.value.archived) {
    showUnarchiveWarning.value = true
  }
  else {
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
    showUnarchiveWarning.value = false
  }
  catch (error) {
    console.error('Error toggling archive:', error)
    toast.error((error as Error).message || '操作失敗，請稍後再試')
  }
  finally {
    isArchiving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-xl font-bold text-foreground m-0 tracking-tight">
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
      <form v-if="currentUserMember" class="bg-card rounded-xl border p-5 space-y-5" @submit.prevent="handleSelfSave">
        <div class="flex items-center gap-4">
          <div class="size-16 flex items-center justify-center text-3xl bg-primary/10 border-2 border-primary/20 rounded-full shrink-0">
            {{ selfEditAvatar }}
          </div>
          <div class="flex-1">
            <label for="self-edit-name" class="text-sm font-medium text-foreground mb-1.5 block">顯示名稱</label>
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
        <div class="space-y-2">
          <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">選擇頭像</label>
          <div class="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
            <button
              v-for="emoji in selfAvailableEmojis"
              :key="emoji"
              type="button"
              :class="{
                'bg-primary ring-2 ring-primary ring-offset-1': selfEditAvatar === emoji,
                'bg-card hover:bg-muted': selfEditAvatar !== emoji,
              }"
              class="aspect-square flex items-center justify-center text-xl rounded-lg border border-border transition-colors cursor-pointer"
              @click="selfEditAvatar = emoji"
            >
              {{ emoji }}
            </button>
          </div>
        </div>

        <div class="flex gap-3 pt-1">
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
            <Icon v-if="isSelfSubmitting" name="lucide:loader-circle" :size="16" class="animate-spin mr-2" />
            {{ isSelfSubmitting ? '儲存中...' : '儲存變更' }}
          </ui-button>
        </div>
      </form>

      <!-- Loading state -->
      <div v-else class="py-8 flex justify-center">
        <ui-skeleton class="w-full h-32" />
      </div>

      <!-- Leave trip -->
      <div class="bg-card rounded-xl border p-5 space-y-3">
        <div>
          <p class="text-sm font-semibold text-foreground mb-2">
            離開行程
          </p>
          <p class="text-xs text-muted-foreground m-0 mt-1">
            離開後將無法查看或編輯此行程的支出
          </p>
        </div>
        <ui-button
          type="button"
          variant="destructive"
          class="w-full"
          :disabled="isLeaving"
          @click="showLeaveWarning = true"
        >
          <Icon name="lucide:log-out" :size="16" class="mr-2" />
          離開行程
        </ui-button>
      </div>
    </template>

    <!-- ===== Owner: Full edit with tabs ===== -->
    <template v-else>
      <!-- Archived Notice -->
      <alert-banner v-if="trip?.archived" icon="lucide:archive" title="此行程已封存" variant="warning">
        如需修改行程設定，請先取消封存。
      </alert-banner>

      <div class="bg-card rounded-xl border">
        <!-- Tabs -->
        <ui-tabs v-model="activeTab" default-value="info">
          <ui-tabs-list class="w-full rounded-b-none border-b">
            <ui-tabs-trigger value="info" class="flex-1">
              行程資訊
            </ui-tabs-trigger>
            <ui-tabs-trigger value="members" class="flex-1">
              成員
            </ui-tabs-trigger>
            <ui-tabs-trigger value="collaborators" class="flex-1">
              協作
            </ui-tabs-trigger>
            <ui-tabs-trigger value="settings" class="flex-1">
              設定
            </ui-tabs-trigger>
          </ui-tabs-list>

          <!-- Tab: Trip Info -->
          <ui-tabs-content value="info" force-mount class="p-5 data-[state=inactive]:hidden">
            <div class="space-y-5">
              <ui-form-field v-slot="{ componentField }" name="name" :validate-on-blur="!isFieldDirty">
                <ui-form-item>
                  <ui-form-label>行程名稱</ui-form-label>
                  <ui-form-control>
                    <ui-input type="text" placeholder="日本東京旅遊" :disabled="trip?.archived" v-bind="componentField" />
                  </ui-form-control>
                  <ui-form-message />
                </ui-form-item>
              </ui-form-field>

              <!-- Currency + exchange rate are related — tight sub-group -->
              <div class="space-y-3">
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
                      1 {{ values.tripCurrency }} ≈ {{ exchangeRateToTwd }} TWD（可手動調整）
                    </ui-form-description>
                    <ui-form-message />
                  </ui-form-item>
                </ui-form-field>
              </div>
            </div>
          </ui-tabs-content>

          <!-- Tab: Members -->
          <ui-tabs-content value="members" force-mount class="p-5 data-[state=inactive]:hidden">
            <edit-trip-members-form
              v-if="localMembers.length > 0 && !trip?.archived"
              :members="localMembers"
              :expenses="enabledExpenses"
              :on-members-change="onMembersChange"
            />

            <!-- Read-only member list for archived trips -->
            <div v-else-if="trip?.archived && localMembers.length > 0" class="space-y-2">
              <div
                v-for="member in localMembers"
                :key="member.id"
                class="flex items-center gap-3 py-2.5"
              >
                <div class="w-10 h-10 flex items-center justify-center bg-muted rounded-full text-xl shrink-0">
                  {{ member.avatarEmoji }}
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-foreground truncate m-0">
                    {{ member.name }}
                  </p>
                </div>
                <ui-badge v-if="member.isHost" variant="default" class="text-xs shrink-0">
                  建立者
                </ui-badge>
              </div>
            </div>
          </ui-tabs-content>

          <!-- Tab: Collaborators -->
          <ui-tabs-content value="collaborators" class="p-5">
            <div class="space-y-4">
              <div v-if="collaborators.length > 0" class="divide-y divide-border">
                <div
                  v-for="collaborator in collaborators"
                  :key="collaborator.userId"
                  class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div class="w-10 h-10 rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0">
                    <img
                      v-if="collaborator.photoURL"
                      :src="collaborator.photoURL"
                      :alt="collaborator.displayName || ''"
                      class="w-full h-full object-cover"
                    >
                    <Icon v-else name="lucide:user" class="w-5 h-5 text-muted-foreground" />
                  </div>

                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-foreground truncate m-0">
                      {{ collaborator.displayName || '未知使用者' }}
                    </p>
                    <p class="text-xs text-muted-foreground truncate m-0">
                      {{ collaborator.email }}
                    </p>
                  </div>

                  <ui-badge v-if="collaborator.role === 'owner'" variant="default" class="text-xs shrink-0">
                    <Icon name="lucide:crown" :size="12" class="mr-1" />
                    建立者
                  </ui-badge>
                  <ui-badge v-else variant="secondary" class="text-xs shrink-0">
                    編輯者
                  </ui-badge>
                </div>
              </div>

              <div v-if="collaborators.length === 0" class="py-4 text-center">
                <p class="text-sm text-muted-foreground m-0">
                  尚未邀請任何協作者
                </p>
                <p class="text-xs text-muted-foreground m-0 mt-1">
                  僅你可以存取此行程
                </p>
              </div>

              <ui-button
                v-if="canInvite"
                type="button"
                class="w-full"
                variant="outline"
                :disabled="!!trip?.archived"
                @click="showInviteDrawer = true"
              >
                <Icon name="lucide:user-plus" :size="16" class="mr-2" />
                {{ trip?.archived ? '行程已封存，無法邀請' : '邀請協作者' }}
              </ui-button>
            </div>
          </ui-tabs-content>

          <!-- Tab: Settings -->
          <ui-tabs-content value="settings" class="p-5">
            <div class="space-y-4">
              <!-- Public Join Toggle -->
              <div v-if="isOwner" class="space-y-3">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-semibold text-foreground m-0">
                      開放加入
                    </p>
                    <p class="text-xs text-muted-foreground m-0 mt-1">
                      開啟後任何人都可以透過連結加入行程
                    </p>
                  </div>
                  <ui-switch
                    :model-value="trip?.isPublicInviteEnabled ?? false"
                    :disabled="!!trip?.archived || isTogglingPublicInvite"
                    @update:model-value="handleTogglePublicInvite"
                  />
                </div>
                <div v-if="trip?.isPublicInviteEnabled && publicJoinUrl" class="flex items-center gap-2">
                  <ui-input :value="publicJoinUrl" readonly class="flex-1 font-mono text-sm" />
                  <ui-button size="sm" variant="outline" @click="copyToClipboard(publicJoinUrl)">
                    <Icon name="lucide:copy" :size="16" />
                  </ui-button>
                </div>
              </div>

              <ui-separator v-if="isOwner" />

              <div class="space-y-3">
                <div>
                  <p class="text-sm font-semibold text-foreground m-0">
                    {{ trip?.archived ? '取消封存行程' : '封存行程' }}
                  </p>
                  <p class="text-xs text-muted-foreground m-0 mt-1">
                    {{ trip?.archived
                      ? '取消封存後即可繼續編輯和新增支出'
                      : '封存後將無法新增支出或修改行程設定。現有支出仍可查看和編輯。'
                    }}
                  </p>
                </div>
                <ui-button
                  type="button"
                  :variant="trip?.archived ? 'outline' : 'destructive'"
                  class="w-full"
                  :disabled="isArchiving"
                  @click="handleArchiveClick"
                >
                  <Icon
                    :name="isArchiving ? 'lucide:loader-circle' : (trip?.archived ? 'lucide:archive-restore' : 'lucide:archive')"
                    :size="16"
                    class="mr-2"
                    :class="{ 'animate-spin': isArchiving }"
                  />
                  {{ isArchiving ? '處理中...' : (trip?.archived ? '取消封存' : '封存行程') }}
                </ui-button>
              </div>
            </div>
          </ui-tabs-content>
        </ui-tabs>
      </div>

      <!-- Save bar (only for info/members tabs) -->
      <div v-if="!trip?.archived && (activeTab === 'info' || activeTab === 'members')" class="space-y-3">
        <Transition name="fade-shift">
          <div v-if="hasUnsavedChanges" class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-amber-500 shrink-0" />
            <p class="text-xs font-medium text-amber-600 dark:text-amber-400 m-0">
              有尚未儲存的變更
            </p>
          </div>
        </Transition>
        <div class="flex gap-3">
          <ui-button
            type="button"
            variant="outline"
            class="flex-1"
            :disabled="!hasUnsavedChanges"
            @click="handleReset"
          >
            還原
          </ui-button>
          <ui-button
            :disabled="isSubmitting || !hasUnsavedChanges"
            class="flex-1"
            @click="onSubmit"
          >
            <Icon v-if="isSubmitting" name="lucide:loader-circle" :size="16" class="animate-spin mr-2" />
            {{ isSubmitting ? '儲存中...' : '儲存變更' }}
          </ui-button>
        </div>
      </div>
    </template>
  </div>

  <!-- Invite Collaborators Drawer -->
  <invite-collaborators-modal
    v-if="trip"
    :trip-id="tripId"
    :open="showInviteDrawer"
    @update:open="showInviteDrawer = $event"
  />

  <confirmation-dialog
    v-model:open="showArchiveWarning"
    :title="`確定要封存「${trip?.name}」？`"
    description="封存後會限制以下功能"
    confirm-label="確定封存"
    confirm-variant="destructive"
    :is-loading="isArchiving"
    @confirm="handleArchiveToggle"
  >
    <div class="space-y-2 text-sm">
      <div class="flex items-center gap-2 px-3 py-2 bg-destructive/10 rounded-lg">
        <Icon name="lucide:x" :size="14" class="text-destructive shrink-0" />
        <span class="text-foreground">無法新增支出或修改行程設定</span>
      </div>
      <div class="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
        <Icon name="lucide:check" :size="14" class="text-green-600 dark:text-green-400 shrink-0" />
        <span class="text-foreground">現有支出仍可查看和編輯</span>
      </div>
      <div class="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
        <Icon name="lucide:rotate-ccw" :size="14" class="text-muted-foreground shrink-0" />
        <span class="text-foreground">隨時可以取消封存</span>
      </div>
    </div>
  </confirmation-dialog>

  <confirmation-dialog
    v-model:open="showLeaveWarning"
    :title="`確定要離開「${trip?.name}」？`"
    description="離開後你將無法再查看或編輯此行程"
    confirm-label="確定離開"
    confirm-variant="destructive"
    :is-loading="isLeaving"
    @confirm="handleLeaveTrip"
  />

  <confirmation-dialog
    v-model:open="showUnarchiveWarning"
    :title="`確定要取消封存「${trip?.name}」？`"
    description="取消封存後將恢復以下功能"
    confirm-label="確定取消封存"
    :is-loading="isArchiving"
    @confirm="handleArchiveToggle"
  >
    <div class="space-y-2 text-sm">
      <div class="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
        <Icon name="lucide:check" :size="14" class="text-green-600 dark:text-green-400 shrink-0" />
        <span class="text-foreground">可以新增支出和修改行程設定</span>
      </div>
      <div class="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
        <Icon name="lucide:check" :size="14" class="text-green-600 dark:text-green-400 shrink-0" />
        <span class="text-foreground">協作者可以繼續編輯支出</span>
      </div>
    </div>
  </confirmation-dialog>

  <confirmation-dialog
    v-model:open="showUnsavedChangesDialog"
    title="離開並放棄變更？"
    description="你有尚未儲存的變更，離開後將會遺失。"
    confirm-label="確定離開"
    confirm-variant="destructive"
    @confirm="confirmUnsavedLeave"
  />
</template>

<style scoped>
.fade-shift-enter-active {
  transition: opacity 0.2s ease-out, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-shift-leave-active {
  transition: opacity 0.15s ease-in;
}
.fade-shift-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.fade-shift-leave-to {
  opacity: 0;
}
</style>
