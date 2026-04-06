<script setup lang="ts">
import type { Invitation } from '@/types'
import { useMediaQuery } from '@vueuse/core'
import { toast } from 'vue-sonner'

const props = defineProps<{
  tripId: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const isDesktop = useMediaQuery('(min-width: 1024px)')

const { createInvitation, revokeInvitation, listInvitations } = useInvitation()
const { copyToClipboard } = useCopyToClipboard()
const baseUrl = useRequestURL().origin

const activeTab = ref<'collaborator' | 'guest'>('collaborator')

const invitations = ref<Invitation[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const expiresInDays = ref(7)
const maxUses = ref<number | null>(1)
const generatedInvitation = ref<{
  code: string
  url: string
  expiresAt: string
} | null>(null)

// Guest link state
const isCreatingGuest = ref(false)
const guestExpiresInDays = ref(7)
const guestMaxUses = ref<number | null>(null)
const generatedGuestInvitation = ref<{
  code: string
  url: string
  expiresAt: string
} | null>(null)

// Load invitations when modal opens
watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    await loadInvitations()
  }
}, { immediate: true })

async function loadInvitations() {
  try {
    isLoading.value = true
    invitations.value = await listInvitations(props.tripId)
  }
  catch (error: any) {
    console.error('Error loading invitations:', error)
    toast.error('載入邀請失敗')
  }
  finally {
    isLoading.value = false
  }
}

async function handleCreateInvitation() {
  try {
    isCreating.value = true
    const result = await createInvitation({
      tripId: props.tripId,
      expiresInDays: expiresInDays.value,
      maxUses: maxUses.value,
    })

    generatedInvitation.value = {
      code: result.invitationCode,
      url: result.invitationUrl,
      expiresAt: result.expiresAt,
    }

    toast.success('邀請連結已建立！')
    await loadInvitations()
  }
  catch (error: any) {
    console.error('Error creating invitation:', error)
    toast.error(error.message || '建立邀請失敗')
  }
  finally {
    isCreating.value = false
  }
}

async function handleCreateGuestInvitation() {
  try {
    isCreatingGuest.value = true
    const result = await createInvitation({
      tripId: props.tripId,
      expiresInDays: guestExpiresInDays.value,
      maxUses: guestMaxUses.value,
      type: 'guest',
    })

    generatedGuestInvitation.value = {
      code: result.invitationCode,
      url: result.invitationUrl,
      expiresAt: result.expiresAt,
    }

    toast.success('訪客連結已建立！')
    await loadInvitations()
  }
  catch (error: any) {
    console.error('Error creating guest invitation:', error)
    toast.error(error.message || '建立訪客連結失敗')
  }
  finally {
    isCreatingGuest.value = false
  }
}

async function handleRevokeInvitation(invitationId: string) {
  try {
    await revokeInvitation(invitationId)
    toast.success('邀請已撤銷')
    await loadInvitations()
  }
  catch (error: any) {
    console.error('Error revoking invitation:', error)
    toast.error(error.message || '撤銷邀請失敗')
  }
}

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case 'pending': return 'default'
    case 'accepted': return 'secondary'
    case 'expired': return 'destructive'
    case 'revoked': return 'secondary'
    default: return 'default'
  }
}

function getStatusText(invitation: Invitation) {
  if (invitation.status === 'pending' && invitation.usedCount > 0) {
    return `已使用 ${invitation.usedCount}${invitation.maxUses ? `/${invitation.maxUses}` : ''} 次`
  }
  switch (invitation.status) {
    case 'pending': return '待接受'
    case 'accepted': return '已使用完畢'
    case 'expired': return '已過期'
    case 'revoked': return '已撤銷'
    default: return invitation.status
  }
}

function getUsageText(invitation: Invitation) {
  if (invitation.maxUses === null)
    return '無限制'
  return `${invitation.usedCount}/${invitation.maxUses}`
}

function isActiveInvitation(i: Invitation) {
  if (i.status === 'pending')
    return true
  if (i.maxUses === null && i.status !== 'revoked' && i.status !== 'expired')
    return true
  return false
}

const personalInvitations = computed(() =>
  invitations.value.filter(i => i.type !== 'guest'),
)

const guestInvitations = computed(() =>
  invitations.value.filter(i => i.type === 'guest'),
)

const pendingInvitations = computed(() =>
  personalInvitations.value.filter(isActiveInvitation),
)

const usedInvitations = computed(() =>
  personalInvitations.value.filter(i => !isActiveInvitation(i)),
)

const pendingGuestInvitations = computed(() =>
  guestInvitations.value.filter(isActiveInvitation),
)

const usedGuestInvitations = computed(() =>
  guestInvitations.value.filter(i => !isActiveInvitation(i)),
)

function getInvitationUrl(invitation: Invitation) {
  if (invitation.type === 'guest')
    return `${baseUrl}/guest/${invitation.invitationCode}`
  return `${baseUrl}/invite/${invitation.invitationCode}?openExternalBrowser=1`
}
</script>

<template>
  <ClientOnly>
    <!-- Desktop: centered dialog -->
    <ui-dialog v-if="isDesktop" :open="open" @update:open="emit('update:open', $event)">
      <ui-dialog-content v-if="open" class="max-w-2xl max-h-[85vh] overflow-y-auto">
        <ui-dialog-header>
          <ui-dialog-title>邀請加入行程</ui-dialog-title>
          <ui-dialog-description>分享邀請連結讓其他人加入行程</ui-dialog-description>
        </ui-dialog-header>

        <!-- Tab Switcher -->
        <div class="flex gap-1 bg-muted rounded-lg p-1 mt-2">
          <button
            class="flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
            :class="activeTab === 'collaborator' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="activeTab = 'collaborator'"
          >
            <Icon name="lucide:users" class="w-4 h-4 inline mr-1" />
            協作者邀請
          </button>
          <button
            class="flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
            :class="activeTab === 'guest' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="activeTab = 'guest'"
          >
            <Icon name="lucide:user" class="w-4 h-4 inline mr-1" />
            訪客連結
          </button>
        </div>

        <div class="space-y-6 py-4">
          <!-- Collaborator Tab -->
          <template v-if="activeTab === 'collaborator'">
            <!-- Create Invitation Section -->
            <div class="bg-accent rounded-xl p-6 space-y-4">
              <div class="flex items-center gap-2">
                <Icon name="lucide:link" class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold text-foreground m-0">
                  建立新邀請連結
                </h3>
              </div>
              <p class="text-sm text-muted-foreground m-0">
                協作者需要 Google 帳號登入，可編輯所有支出
              </p>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-foreground">有效期限</label>
                  <ui-select v-model="expiresInDays">
                    <ui-select-trigger class="w-full">
                      <ui-select-value placeholder="選擇有效期限" />
                    </ui-select-trigger>
                    <ui-select-content>
                      <ui-select-group>
                        <ui-select-item :value="1">
                          1 天
                        </ui-select-item>
                        <ui-select-item :value="7">
                          7 天
                        </ui-select-item>
                        <ui-select-item :value="30">
                          30 天
                        </ui-select-item>
                        <ui-select-item :value="90">
                          90 天
                        </ui-select-item>
                      </ui-select-group>
                    </ui-select-content>
                  </ui-select>
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium text-foreground">使用次數</label>
                  <ui-select v-model="maxUses">
                    <ui-select-trigger class="w-full">
                      <ui-select-value placeholder="選擇使用次數" />
                    </ui-select-trigger>
                    <ui-select-content>
                      <ui-select-group>
                        <ui-select-item :value="1">
                          1 次
                        </ui-select-item>
                        <ui-select-item :value="5">
                          5 次
                        </ui-select-item>
                        <ui-select-item :value="10">
                          10 次
                        </ui-select-item>
                        <ui-select-item :value="null">
                          無限制
                        </ui-select-item>
                      </ui-select-group>
                    </ui-select-content>
                  </ui-select>
                </div>
              </div>

              <ui-button class="w-full" :disabled="isCreating" @click="handleCreateInvitation">
                <Icon v-if="isCreating" name="lucide:loader-circle" :size="20" class="mr-2 animate-spin" />
                <Icon v-else name="lucide:plus" :size="20" class="mr-2" />
                {{ isCreating ? '建立中...' : '建立邀請連結' }}
              </ui-button>

              <div v-if="generatedInvitation" class="bg-card rounded-lg p-4 space-y-3 border">
                <div class="flex items-center gap-2">
                  <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400" />
                  <p class="text-sm font-medium text-foreground m-0">
                    邀請連結已建立！
                  </p>
                </div>
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <ui-input :value="generatedInvitation.url" readonly class="flex-1 font-mono text-sm" />
                    <ui-button size="sm" variant="outline" @click="copyToClipboard(generatedInvitation.url)">
                      <Icon name="lucide:copy" :size="16" />
                    </ui-button>
                  </div>
                  <p class="text-xs text-muted-foreground m-0">
                    有效期限：{{ new Date(generatedInvitation.expiresAt).toLocaleDateString('zh-TW') }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Active Invitations -->
            <div v-if="pendingInvitations.length > 0" class="space-y-3">
              <h3 class="text-lg font-semibold text-foreground m-0">
                待接受的邀請 ({{ pendingInvitations.length }})
              </h3>
              <div class="space-y-2">
                <div
                  v-for="invitation in pendingInvitations"
                  :key="invitation.id"
                  class="bg-card border rounded-lg p-4"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 space-y-2">
                      <div class="flex items-center gap-2">
                        <code class="text-sm font-mono bg-muted px-2 py-1 rounded">{{ invitation.invitationCode }}</code>
                        <ui-badge :variant="getStatusBadgeVariant(invitation.status)">
                          {{ getStatusText(invitation) }}
                        </ui-badge>
                      </div>
                      <div class="text-sm text-muted-foreground space-y-1">
                        <p class="m-0">
                          <Icon name="lucide:calendar" class="w-4 h-4 inline mr-1" />
                          建立於：{{ invitation.createdAtString }}
                        </p>
                        <p class="m-0">
                          <Icon name="lucide:clock" class="w-4 h-4 inline mr-1" />
                          到期日：{{ invitation.expiresAtString }}
                        </p>
                        <p class="m-0">
                          <Icon name="lucide:users" class="w-4 h-4 inline mr-1" />
                          使用次數：{{ getUsageText(invitation) }}
                        </p>
                      </div>
                      <div class="flex gap-2 mt-2">
                        <ui-button size="sm" variant="outline" @click="copyToClipboard(getInvitationUrl(invitation))">
                          <Icon name="lucide:copy" :size="16" class="mr-1" />
                          複製連結
                        </ui-button>
                      </div>
                    </div>
                    <ui-button size="sm" variant="ghost" @click="handleRevokeInvitation(invitation.id)">
                      <Icon name="lucide:trash-2" :size="16" class="text-destructive" />
                    </ui-button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Used/Expired Invitations -->
            <div v-if="usedInvitations.length > 0" class="space-y-3">
              <h3 class="text-lg font-semibold text-foreground m-0">
                歷史邀請 ({{ usedInvitations.length }})
              </h3>
              <div class="space-y-2">
                <div
                  v-for="invitation in usedInvitations"
                  :key="invitation.id"
                  class="bg-muted/50 border rounded-lg p-4 opacity-75"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 space-y-2">
                      <div class="flex items-center gap-2">
                        <code class="text-sm font-mono bg-card px-2 py-1 rounded">{{ invitation.invitationCode }}</code>
                        <ui-badge :variant="getStatusBadgeVariant(invitation.status)">
                          {{ getStatusText(invitation) }}
                        </ui-badge>
                      </div>
                      <div class="text-sm text-muted-foreground">
                        <p class="m-0">
                          建立於：{{ invitation.createdAtString }}
                        </p>
                        <p v-if="invitation.usedAtString" class="m-0">
                          使用於：{{ invitation.usedAtString }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <empty-state v-if="!isLoading && personalInvitations.length === 0" icon="lucide:users" title="尚無邀請記錄" description="建立第一個邀請連結來邀請協作者" />
          </template>

          <!-- Guest Tab -->
          <template v-if="activeTab === 'guest'">
            <div class="bg-accent rounded-xl p-6 space-y-4">
              <div class="flex items-center gap-2">
                <Icon name="lucide:user" class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold text-foreground m-0">
                  建立訪客連結
                </h3>
              </div>
              <p class="text-sm text-muted-foreground m-0">
                訪客無需登入即可加入，適合在 LINE、WhatsApp 等聊天軟體分享。訪客只能新增支出及編輯自己建立的支出。
              </p>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-foreground">有效期限</label>
                  <ui-select v-model="guestExpiresInDays">
                    <ui-select-trigger class="w-full">
                      <ui-select-value placeholder="選擇有效期限" />
                    </ui-select-trigger>
                    <ui-select-content>
                      <ui-select-group>
                        <ui-select-item :value="1">
                          1 天
                        </ui-select-item>
                        <ui-select-item :value="7">
                          7 天
                        </ui-select-item>
                        <ui-select-item :value="30">
                          30 天
                        </ui-select-item>
                        <ui-select-item :value="90">
                          90 天
                        </ui-select-item>
                      </ui-select-group>
                    </ui-select-content>
                  </ui-select>
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium text-foreground">使用次數</label>
                  <ui-select v-model="guestMaxUses">
                    <ui-select-trigger class="w-full">
                      <ui-select-value placeholder="選擇使用次數" />
                    </ui-select-trigger>
                    <ui-select-content>
                      <ui-select-group>
                        <ui-select-item :value="1">
                          1 次
                        </ui-select-item>
                        <ui-select-item :value="5">
                          5 次
                        </ui-select-item>
                        <ui-select-item :value="10">
                          10 次
                        </ui-select-item>
                        <ui-select-item :value="null">
                          無限制
                        </ui-select-item>
                      </ui-select-group>
                    </ui-select-content>
                  </ui-select>
                </div>
              </div>

              <ui-button class="w-full" :disabled="isCreatingGuest" @click="handleCreateGuestInvitation">
                <Icon v-if="isCreatingGuest" name="lucide:loader-circle" :size="20" class="mr-2 animate-spin" />
                <Icon v-else name="lucide:plus" :size="20" class="mr-2" />
                {{ isCreatingGuest ? '建立中...' : '建立訪客連結' }}
              </ui-button>

              <div v-if="generatedGuestInvitation" class="bg-card rounded-lg p-4 space-y-3 border">
                <div class="flex items-center gap-2">
                  <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400" />
                  <p class="text-sm font-medium text-foreground m-0">
                    訪客連結已建立！
                  </p>
                </div>
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <ui-input :value="generatedGuestInvitation.url" readonly class="flex-1 font-mono text-sm" />
                    <ui-button size="sm" variant="outline" @click="copyToClipboard(generatedGuestInvitation.url)">
                      <Icon name="lucide:copy" :size="16" />
                    </ui-button>
                  </div>
                  <p class="text-xs text-muted-foreground m-0">
                    有效期限：{{ new Date(generatedGuestInvitation.expiresAt).toLocaleDateString('zh-TW') }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Active Guest Invitations -->
            <div v-if="pendingGuestInvitations.length > 0" class="space-y-3">
              <h3 class="text-lg font-semibold text-foreground m-0">
                有效的訪客連結 ({{ pendingGuestInvitations.length }})
              </h3>
              <div class="space-y-2">
                <div
                  v-for="invitation in pendingGuestInvitations"
                  :key="invitation.id"
                  class="bg-card border rounded-lg p-4"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 space-y-2">
                      <div class="flex items-center gap-2">
                        <code class="text-sm font-mono bg-muted px-2 py-1 rounded">{{ invitation.invitationCode }}</code>
                        <ui-badge variant="secondary">
                          訪客
                        </ui-badge>
                        <ui-badge :variant="getStatusBadgeVariant(invitation.status)">
                          {{ getStatusText(invitation) }}
                        </ui-badge>
                      </div>
                      <div class="text-sm text-muted-foreground space-y-1">
                        <p class="m-0">
                          <Icon name="lucide:clock" class="w-4 h-4 inline mr-1" />
                          到期日：{{ invitation.expiresAtString }}
                        </p>
                        <p class="m-0">
                          <Icon name="lucide:users" class="w-4 h-4 inline mr-1" />
                          使用次數：{{ getUsageText(invitation) }}
                        </p>
                      </div>
                      <div class="flex gap-2 mt-2">
                        <ui-button size="sm" variant="outline" @click="copyToClipboard(getInvitationUrl(invitation))">
                          <Icon name="lucide:copy" :size="16" class="mr-1" />
                          複製連結
                        </ui-button>
                      </div>
                    </div>
                    <ui-button size="sm" variant="ghost" @click="handleRevokeInvitation(invitation.id)">
                      <Icon name="lucide:trash-2" :size="16" class="text-destructive" />
                    </ui-button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Used/Expired Guest Invitations -->
            <div v-if="usedGuestInvitations.length > 0" class="space-y-3">
              <h3 class="text-lg font-semibold text-foreground m-0">
                歷史訪客連結 ({{ usedGuestInvitations.length }})
              </h3>
              <div class="space-y-2">
                <div
                  v-for="invitation in usedGuestInvitations"
                  :key="invitation.id"
                  class="bg-muted/50 border rounded-lg p-4 opacity-75"
                >
                  <div class="flex-1 space-y-2">
                    <div class="flex items-center gap-2">
                      <code class="text-sm font-mono bg-card px-2 py-1 rounded">{{ invitation.invitationCode }}</code>
                      <ui-badge variant="secondary">
                        訪客
                      </ui-badge>
                      <ui-badge :variant="getStatusBadgeVariant(invitation.status)">
                        {{ getStatusText(invitation) }}
                      </ui-badge>
                    </div>
                    <div class="text-sm text-muted-foreground">
                      <p class="m-0">
                        建立於：{{ invitation.createdAtString }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <empty-state v-if="!isLoading && guestInvitations.length === 0" icon="lucide:user" title="尚無訪客連結" description="建立訪客連結讓不需登入的人也能加入行程" />
          </template>

          <div v-if="isLoading" class="flex justify-center py-8">
            <loading-spinner />
          </div>
        </div>
      </ui-dialog-content>
    </ui-dialog>

    <!-- Mobile: bottom drawer -->
    <ui-drawer v-else :open="open" @update:open="emit('update:open', $event)">
      <ui-drawer-content>
        <div class="mx-auto w-full max-w-2xl p-6 max-h-[85dvh] overflow-y-auto">
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-2xl font-bold text-foreground m-0 mb-1">
                  邀請加入行程
                </h2>
                <p class="text-sm text-muted-foreground m-0">
                  分享邀請連結讓其他人加入行程
                </p>
              </div>
              <ui-button variant="ghost" size="icon" @click="emit('update:open', false)">
                <Icon name="lucide:x" :size="20" />
              </ui-button>
            </div>

            <!-- Tab Switcher -->
            <div class="flex gap-1 bg-muted rounded-lg p-1">
              <button
                class="flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
                :class="activeTab === 'collaborator' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="activeTab = 'collaborator'"
              >
                <Icon name="lucide:users" class="w-4 h-4 inline mr-1" />
                協作者
              </button>
              <button
                class="flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
                :class="activeTab === 'guest' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="activeTab = 'guest'"
              >
                <Icon name="lucide:user" class="w-4 h-4 inline mr-1" />
                訪客
              </button>
            </div>

            <!-- Collaborator Tab -->
            <template v-if="activeTab === 'collaborator'">
              <div class="bg-accent rounded-xl p-6 space-y-4">
                <div class="flex items-center gap-2">
                  <Icon name="lucide:link" class="w-5 h-5 text-primary" />
                  <h3 class="text-lg font-semibold text-foreground m-0">
                    建立協作者邀請
                  </h3>
                </div>
                <p class="text-sm text-muted-foreground m-0">
                  協作者需要 Google 帳號登入
                </p>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-foreground">有效期限</label>
                  <ui-select v-model="expiresInDays">
                    <ui-select-trigger class="w-full">
                      <ui-select-value placeholder="選擇有效期限" />
                    </ui-select-trigger>
                    <ui-select-content>
                      <ui-select-group>
                        <ui-select-item :value="1">
                          1 天
                        </ui-select-item>
                        <ui-select-item :value="7">
                          7 天
                        </ui-select-item>
                        <ui-select-item :value="30">
                          30 天
                        </ui-select-item>
                        <ui-select-item :value="90">
                          90 天
                        </ui-select-item>
                      </ui-select-group>
                    </ui-select-content>
                  </ui-select>
                </div>

                <ui-button class="w-full" :disabled="isCreating" @click="handleCreateInvitation">
                  <Icon v-if="isCreating" name="lucide:loader-circle" :size="20" class="mr-2 animate-spin" />
                  <Icon v-else name="lucide:plus" :size="20" class="mr-2" />
                  {{ isCreating ? '建立中...' : '建立邀請連結' }}
                </ui-button>

                <div v-if="generatedInvitation" class="bg-card rounded-lg p-4 space-y-3 border">
                  <div class="flex items-center gap-2">
                    <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400" />
                    <p class="text-sm font-medium text-foreground m-0">
                      邀請連結已建立！
                    </p>
                  </div>
                  <div class="space-y-2">
                    <div class="flex items-center gap-2">
                      <ui-input :value="generatedInvitation.url" readonly class="flex-1 font-mono text-sm" />
                      <ui-button size="sm" variant="outline" @click="copyToClipboard(generatedInvitation.url)">
                        <Icon name="lucide:copy" :size="16" />
                      </ui-button>
                    </div>
                    <p class="text-xs text-muted-foreground m-0">
                      有效期限：{{ new Date(generatedInvitation.expiresAt).toLocaleDateString('zh-TW') }}
                    </p>
                  </div>
                </div>
              </div>

              <div v-if="pendingInvitations.length > 0" class="space-y-3">
                <h3 class="text-lg font-semibold text-foreground m-0">
                  待接受的邀請 ({{ pendingInvitations.length }})
                </h3>
                <div class="space-y-2">
                  <div
                    v-for="invitation in pendingInvitations"
                    :key="invitation.id"
                    class="bg-card border rounded-lg p-4"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="flex-1 space-y-2">
                        <div class="flex items-center gap-2">
                          <code class="text-sm font-mono bg-muted px-2 py-1 rounded">{{ invitation.invitationCode }}</code>
                          <ui-badge :variant="getStatusBadgeVariant(invitation.status)">
                            {{ getStatusText(invitation) }}
                          </ui-badge>
                        </div>
                        <div class="text-sm text-muted-foreground space-y-1">
                          <p class="m-0">
                            <Icon name="lucide:clock" class="w-4 h-4 inline mr-1" />
                            到期日：{{ invitation.expiresAtString }}
                          </p>
                          <p class="m-0">
                            <Icon name="lucide:users" class="w-4 h-4 inline mr-1" />
                            使用次數：{{ getUsageText(invitation) }}
                          </p>
                        </div>
                        <div class="flex gap-2 mt-2">
                          <ui-button size="sm" variant="outline" @click="copyToClipboard(getInvitationUrl(invitation))">
                            <Icon name="lucide:copy" :size="16" class="mr-1" />
                            複製連結
                          </ui-button>
                        </div>
                      </div>
                      <ui-button size="sm" variant="ghost" @click="handleRevokeInvitation(invitation.id)">
                        <Icon name="lucide:trash-2" :size="16" class="text-destructive" />
                      </ui-button>
                    </div>
                  </div>
                </div>
              </div>

              <empty-state v-if="!isLoading && personalInvitations.length === 0" icon="lucide:users" title="尚無邀請記錄" description="建立第一個邀請連結來邀請協作者" />
            </template>

            <!-- Guest Tab -->
            <template v-if="activeTab === 'guest'">
              <div class="bg-accent rounded-xl p-6 space-y-4">
                <div class="flex items-center gap-2">
                  <Icon name="lucide:user" class="w-5 h-5 text-primary" />
                  <h3 class="text-lg font-semibold text-foreground m-0">
                    建立訪客連結
                  </h3>
                </div>
                <p class="text-sm text-muted-foreground m-0">
                  訪客無需登入，適合在聊天軟體分享
                </p>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-foreground">有效期限</label>
                  <ui-select v-model="guestExpiresInDays">
                    <ui-select-trigger class="w-full">
                      <ui-select-value placeholder="選擇有效期限" />
                    </ui-select-trigger>
                    <ui-select-content>
                      <ui-select-group>
                        <ui-select-item :value="1">
                          1 天
                        </ui-select-item>
                        <ui-select-item :value="7">
                          7 天
                        </ui-select-item>
                        <ui-select-item :value="30">
                          30 天
                        </ui-select-item>
                        <ui-select-item :value="90">
                          90 天
                        </ui-select-item>
                      </ui-select-group>
                    </ui-select-content>
                  </ui-select>
                </div>

                <ui-button class="w-full" :disabled="isCreatingGuest" @click="handleCreateGuestInvitation">
                  <Icon v-if="isCreatingGuest" name="lucide:loader-circle" :size="20" class="mr-2 animate-spin" />
                  <Icon v-else name="lucide:plus" :size="20" class="mr-2" />
                  {{ isCreatingGuest ? '建立中...' : '建立訪客連結' }}
                </ui-button>

                <div v-if="generatedGuestInvitation" class="bg-card rounded-lg p-4 space-y-3 border">
                  <div class="flex items-center gap-2">
                    <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600 dark:text-green-400" />
                    <p class="text-sm font-medium text-foreground m-0">
                      訪客連結已建立！
                    </p>
                  </div>
                  <div class="space-y-2">
                    <div class="flex items-center gap-2">
                      <ui-input :value="generatedGuestInvitation.url" readonly class="flex-1 font-mono text-sm" />
                      <ui-button size="sm" variant="outline" @click="copyToClipboard(generatedGuestInvitation.url)">
                        <Icon name="lucide:copy" :size="16" />
                      </ui-button>
                    </div>
                    <p class="text-xs text-muted-foreground m-0">
                      有效期限：{{ new Date(generatedGuestInvitation.expiresAt).toLocaleDateString('zh-TW') }}
                    </p>
                  </div>
                </div>
              </div>

              <div v-if="pendingGuestInvitations.length > 0" class="space-y-3">
                <h3 class="text-lg font-semibold text-foreground m-0">
                  有效的訪客連結 ({{ pendingGuestInvitations.length }})
                </h3>
                <div class="space-y-2">
                  <div
                    v-for="invitation in pendingGuestInvitations"
                    :key="invitation.id"
                    class="bg-card border rounded-lg p-4"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="flex-1 space-y-2">
                        <div class="flex items-center gap-2">
                          <code class="text-sm font-mono bg-muted px-2 py-1 rounded">{{ invitation.invitationCode }}</code>
                          <ui-badge variant="secondary">
                            訪客
                          </ui-badge>
                        </div>
                        <div class="flex gap-2 mt-2">
                          <ui-button size="sm" variant="outline" @click="copyToClipboard(getInvitationUrl(invitation))">
                            <Icon name="lucide:copy" :size="16" class="mr-1" />
                            複製連結
                          </ui-button>
                        </div>
                      </div>
                      <ui-button size="sm" variant="ghost" @click="handleRevokeInvitation(invitation.id)">
                        <Icon name="lucide:trash-2" :size="16" class="text-destructive" />
                      </ui-button>
                    </div>
                  </div>
                </div>
              </div>

              <empty-state v-if="!isLoading && guestInvitations.length === 0" icon="lucide:user" title="尚無訪客連結" description="建立訪客連結讓不需登入的人也能加入行程" />
            </template>

            <div v-if="isLoading" class="flex justify-center py-8">
              <loading-spinner />
            </div>
          </div>
        </div>
      </ui-drawer-content>
    </ui-drawer>
  </ClientOnly>
</template>
