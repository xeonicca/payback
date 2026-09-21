<script setup lang="ts">
import type { TripCollaborator, TripMember } from '@/types'
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
import { CurrencyCode, supportedCurrencies } from '@/constants'
import { canSwitchToSolo, isSoloModeBroken, isSoloTrip } from '@/utils/tripMode'

definePageMeta({
  middleware: ['auth'],
})

const route = useRoute()
const router = useRouter()
const db = useFirestore()
const sessionUser = useSessionUser()
const { logEvent } = useAnalytics()

const tripId = route.params.tripId as string

// Fetch trip, members, and expenses
const { trip } = useTrip(tripId)
const { tripMembers, currentUserMember } = useTripMembers(tripId)
const { enabledExpenses } = useTripExpenses(tripId)
const { collaborators, isOwner, canInvite } = useTripCollaborators(tripId)
const { setCollaboratorReadOnly, removeCollaborator, resetPublicLink, setSoloMode } = useTripAccess()

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

const isSolo = computed(() => isSoloTrip(trip.value, tripMembers.value.length))
const soloModeBroken = computed(() => isSoloModeBroken(trip.value, tripMembers.value.length))
const canEnterSolo = computed(() => canSwitchToSolo({
  isOwner: isOwner.value,
  soloMode: trip.value?.soloMode ?? false,
  memberCount: tripMembers.value.length,
  collaboratorCount: trip.value?.collaboratorCount ?? 0,
}))

// The 成員/協作 tabs disappear in solo mode; don't leave the user on a hidden tab
watch(isSolo, (solo) => {
  if (solo && (activeTab.value === 'members' || activeTab.value === 'collaborators'))
    activeTab.value = 'settings'
})

const isSwitchingMode = ref(false)

async function handleSetSoloMode(enabled: boolean) {
  try {
    isSwitchingMode.value = true
    await setSoloMode(tripId, enabled)
    logEvent('toggle_solo_mode', { trip_id: tripId, enabled })
    toast.success(enabled ? '已切換為個人模式' : '已切換為團體旅程，可到「協作」邀請朋友')
  }
  catch (error: any) {
    console.error('Error switching solo mode:', error)
    toast.error(error.data?.message || '切換失敗，請稍後再試')
  }
  finally {
    isSwitchingMode.value = false
  }
}

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

// Collaborator access (owner only)
const updatingCollaboratorIds = ref<string[]>([])

async function handleToggleCanEdit(collaborator: TripCollaborator, canEdit: boolean) {
  const { userId } = collaborator
  updatingCollaboratorIds.value = [...updatingCollaboratorIds.value, userId]
  try {
    await setCollaboratorReadOnly(tripId, userId, !canEdit)
  }
  catch (error) {
    // The switch is bound to live Firestore data, so it snaps back on its own
    console.error('Error updating collaborator access:', error)
    toast.error('更新權限失敗')
  }
  finally {
    updatingCollaboratorIds.value = updatingCollaboratorIds.value.filter(id => id !== userId)
  }
}

const collaboratorToRemove = ref<TripCollaborator | null>(null)
const isRemovingCollaborator = ref(false)

async function confirmRemoveCollaborator() {
  const target = collaboratorToRemove.value
  if (!target)
    return
  try {
    isRemovingCollaborator.value = true
    await removeCollaborator(tripId, target.userId)
    toast.success(`已移除 ${target.displayName || '協作者'}`)
    collaboratorToRemove.value = null
  }
  catch (error) {
    console.error('Error removing collaborator:', error)
    toast.error('移除失敗')
  }
  finally {
    isRemovingCollaborator.value = false
  }
}

const showResetLinkDialog = ref(false)
const isResettingLink = ref(false)

async function confirmResetPublicLink() {
  try {
    isResettingLink.value = true
    await resetPublicLink(tripId)
    toast.success('已重設連結，舊連結已失效')
    showResetLinkDialog.value = false
  }
  catch (error) {
    console.error('Error resetting public link:', error)
    toast.error('重設連結失敗')
  }
  finally {
    isResettingLink.value = false
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

    logEvent('edit_trip', {
      trip_id: tripId,
      members_added: membersToAdd.value.length,
      members_removed: membersToDelete.value.length,
    })
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
  const cancelExpectedExit = expectTripExit(tripId)
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
    cancelExpectedExit()
    console.error('Error leaving trip:', error)
    toast.error(error.data?.message || '離開行程失敗')
  }
  finally {
    isLeaving.value = false
    showLeaveWarning.value = false
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
      <div v-if="currentUserMember" class="bg-card rounded-xl border p-5">
        <member-profile-form
          :trip-id="tripId"
          :member="currentUserMember"
          :members="tripMembers"
          show-cancel
          @saved="router.push(`/trips/${tripId}`)"
          @cancel="router.push(`/trips/${tripId}`)"
        />
      </div>

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
            <ui-tabs-trigger v-if="!isSolo" value="members" class="flex-1">
              成員
            </ui-tabs-trigger>
            <ui-tabs-trigger v-if="!isSolo" value="collaborators" class="flex-1">
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
          <ui-tabs-content v-if="!isSolo" value="members" force-mount class="p-5 data-[state=inactive]:hidden">
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
          <ui-tabs-content v-if="!isSolo" value="collaborators" class="p-5">
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
                  <template v-else>
                    <ui-badge variant="secondary" class="text-xs shrink-0">
                      {{ collaborator.role === 'guest' ? '訪客' : '編輯者' }}
                    </ui-badge>
                    <template v-if="isOwner">
                      <div class="flex items-center gap-1.5 shrink-0">
                        <ui-label :for="`can-edit-${collaborator.userId}`" class="text-xs text-muted-foreground">
                          可編輯
                        </ui-label>
                        <ui-switch
                          :id="`can-edit-${collaborator.userId}`"
                          :model-value="!collaborator.readOnly"
                          :disabled="updatingCollaboratorIds.includes(collaborator.userId)"
                          @update:model-value="(canEdit: boolean) => handleToggleCanEdit(collaborator, canEdit)"
                        />
                      </div>
                      <ui-button
                        type="button"
                        size="icon"
                        variant="ghost"
                        class="size-11 shrink-0"
                        :aria-label="`移除 ${collaborator.displayName || '協作者'}`"
                        @click="collaboratorToRemove = collaborator"
                      >
                        <Icon name="lucide:user-minus" :size="16" class="text-destructive" />
                      </ui-button>
                    </template>
                    <ui-badge v-else-if="collaborator.readOnly" variant="outline" class="text-xs shrink-0">
                      僅檢視
                    </ui-badge>
                  </template>
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
              <!-- Solo trips have no 成員 tab, so the owner edits their own profile here -->
              <template v-if="isSolo && currentUserMember">
                <div class="space-y-3">
                  <p class="text-sm font-semibold text-foreground m-0">
                    個人資料
                  </p>
                  <member-profile-form
                    :key="currentUserMember.id"
                    :trip-id="tripId"
                    :member="currentUserMember"
                    :members="tripMembers"
                  />
                </div>
                <ui-separator />
              </template>

              <!-- Solo mode switch -->
              <div v-if="isOwner" class="space-y-3">
                <div>
                  <p class="text-sm font-semibold text-foreground m-0">
                    個人模式
                  </p>
                  <p class="text-xs text-muted-foreground m-0 mt-1">
                    {{ trip?.soloMode
                      ? '目前為個人模式：隱藏分帳、邀請與成員管理。切換為團體旅程後即可邀請朋友。'
                      : '只有你一個人記帳時，可以隱藏分帳、邀請與成員管理。'
                    }}
                  </p>
                </div>
                <alert-banner v-if="soloModeBroken" icon="lucide:triangle-alert" title="個人模式未生效" variant="warning">
                  此行程有多位成員，已自動顯示團體功能。
                </alert-banner>
                <ui-button
                  v-if="trip?.soloMode"
                  type="button"
                  variant="outline"
                  class="w-full"
                  :disabled="isSwitchingMode"
                  @click="handleSetSoloMode(false)"
                >
                  <Icon name="lucide:users" :size="16" class="mr-2" />
                  切換為團體旅程
                </ui-button>
                <ui-button
                  v-else-if="canEnterSolo"
                  type="button"
                  variant="outline"
                  class="w-full"
                  :disabled="isSwitchingMode"
                  @click="handleSetSoloMode(true)"
                >
                  <Icon name="lucide:user" :size="16" class="mr-2" />
                  切換為個人模式
                </ui-button>
                <p v-else class="text-xs text-muted-foreground m-0">
                  行程只有你一位成員、且沒有其他協作者時，才能切換為個人模式。
                </p>
              </div>

              <!-- Public Join Toggle -->
              <div v-if="isOwner && !isSolo" class="space-y-3">
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
                <template v-if="trip?.isPublicInviteEnabled && publicJoinUrl">
                  <div class="flex items-center gap-2">
                    <ui-input :value="publicJoinUrl" readonly class="flex-1 font-mono text-sm" />
                    <ui-button size="sm" variant="outline" aria-label="複製連結" @click="copyToClipboard(publicJoinUrl)">
                      <Icon name="lucide:copy" :size="16" />
                    </ui-button>
                  </div>
                  <ui-button type="button" size="sm" variant="ghost" class="text-muted-foreground" @click="showResetLinkDialog = true">
                    <Icon name="lucide:refresh-cw" :size="14" class="mr-1.5" />
                    重設連結
                  </ui-button>
                </template>
              </div>

              <ui-separator v-if="isOwner && !isSolo" />

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

  <!-- Remove Collaborator Confirmation -->
  <ui-alert-dialog :open="!!collaboratorToRemove" @update:open="(open: boolean) => { if (!open) collaboratorToRemove = null }">
    <ui-alert-dialog-content>
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>移除 {{ collaboratorToRemove?.displayName || '協作者' }}？</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          對方將無法再查看此行程，他們建立的支出會保留。
          <template v-if="trip?.isPublicInviteEnabled">
            <br>
            此行程的加入連結目前開啟，對方仍可透過連結重新加入，建議一併重設連結。
          </template>
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-alert-dialog-cancel :disabled="isRemovingCollaborator">
          取消
        </ui-alert-dialog-cancel>
        <ui-button variant="destructive" :disabled="isRemovingCollaborator" @click="confirmRemoveCollaborator">
          <Icon v-if="isRemovingCollaborator" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isRemovingCollaborator ? '移除中...' : '移除' }}
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>

  <!-- Reset Public Link Confirmation -->
  <ui-alert-dialog v-model:open="showResetLinkDialog">
    <ui-alert-dialog-content>
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>重設加入連結？</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          重設後，舊的連結將失效，需要重新分享新連結。
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-alert-dialog-cancel :disabled="isResettingLink">
          取消
        </ui-alert-dialog-cancel>
        <ui-button :disabled="isResettingLink" @click="confirmResetPublicLink">
          <Icon v-if="isResettingLink" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isResettingLink ? '重設中...' : '重設' }}
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>

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
