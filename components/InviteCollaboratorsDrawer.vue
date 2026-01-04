<script setup lang="ts">
import type { Invitation } from '@/types'
import { toast } from 'vue-sonner'

const props = defineProps<{
  tripId: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { createInvitation, revokeInvitation, listInvitations } = useInvitation()

const invitations = ref<Invitation[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const expiresInDays = ref(7)
const generatedInvitation = ref<{
  code: string
  url: string
  expiresAt: string
} | null>(null)

// Load invitations when drawer opens
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

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('已複製到剪貼簿')
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

function getStatusText(status: string) {
  switch (status) {
    case 'pending': return '待接受'
    case 'accepted': return '已接受'
    case 'expired': return '已過期'
    case 'revoked': return '已撤銷'
    default: return status
  }
}

const pendingInvitations = computed(() =>
  invitations.value.filter(i => i.status === 'pending'),
)

const usedInvitations = computed(() =>
  invitations.value.filter(i => i.status !== 'pending'),
)
</script>

<template>
  <ui-drawer :open="open" @update:open="emit('update:open', $event)">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div class="space-y-6">
          <!-- Header -->
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-2xl font-bold text-gray-900 m-0 mb-1">
                邀請協作者
              </h2>
              <p class="text-sm text-gray-500 m-0">
                分享邀請連結讓其他人加入行程
              </p>
            </div>
            <ui-button variant="ghost" size="icon" @click="emit('update:open', false)">
              <Icon name="lucide:x" :size="20" />
            </ui-button>
          </div>

          <!-- Create Invitation Section -->
          <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-6 space-y-4">
            <div class="flex items-center gap-2">
              <Icon name="lucide:link" class="w-5 h-5 text-indigo-600" />
              <h3 class="text-lg font-semibold text-gray-900 m-0">
                建立新邀請連結
              </h3>
            </div>

            <!-- Expiry Selection -->
            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700">有效期限</label>
              <ui-select v-model="expiresInDays">
                <ui-select-trigger class="w-full">
                  <ui-select-value placeholder="選擇有效期限" />
                </ui-select-trigger>
                <ui-select-content>
                  <ui-select-group>
                    <ui-select-item :value="1">1 天</ui-select-item>
                    <ui-select-item :value="7">7 天</ui-select-item>
                    <ui-select-item :value="30">30 天</ui-select-item>
                    <ui-select-item :value="90">90 天</ui-select-item>
                  </ui-select-group>
                </ui-select-content>
              </ui-select>
            </div>

            <!-- Generate Button -->
            <ui-button
              class="w-full"
              :disabled="isCreating"
              @click="handleCreateInvitation"
            >
              <Icon v-if="isCreating" name="lucide:loader-circle" :size="20" class="mr-2 animate-spin" />
              <Icon v-else name="lucide:plus" :size="20" class="mr-2" />
              {{ isCreating ? '建立中...' : '建立邀請連結' }}
            </ui-button>

            <!-- Generated Invitation -->
            <div v-if="generatedInvitation" class="bg-white rounded-lg p-4 space-y-3 border border-indigo-300">
              <div class="flex items-center gap-2">
                <Icon name="lucide:check-circle" class="w-5 h-5 text-green-600" />
                <p class="text-sm font-medium text-gray-900 m-0">邀請連結已建立！</p>
              </div>

              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <ui-input
                    :value="generatedInvitation.url"
                    readonly
                    class="flex-1 font-mono text-sm"
                  />
                  <ui-button
                    size="sm"
                    variant="outline"
                    @click="copyToClipboard(generatedInvitation.url)"
                  >
                    <Icon name="lucide:copy" :size="16" />
                  </ui-button>
                </div>

                <p class="text-xs text-gray-500 m-0">
                  有效期限：{{ new Date(generatedInvitation.expiresAt).toLocaleDateString('zh-TW') }}
                </p>
              </div>
            </div>
          </div>

          <!-- Active Invitations -->
          <div v-if="pendingInvitations.length > 0" class="space-y-3">
            <h3 class="text-lg font-semibold text-gray-900 m-0">
              待接受的邀請 ({{ pendingInvitations.length }})
            </h3>

            <div class="space-y-2">
              <div
                v-for="invitation in pendingInvitations"
                :key="invitation.id"
                class="bg-white border border-gray-200 rounded-lg p-4"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 space-y-2">
                    <div class="flex items-center gap-2">
                      <code class="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                        {{ invitation.invitationCode }}
                      </code>
                      <ui-badge :variant="getStatusBadgeVariant(invitation.status)">
                        {{ getStatusText(invitation.status) }}
                      </ui-badge>
                    </div>

                    <div class="text-sm text-gray-600 space-y-1">
                      <p class="m-0">
                        <Icon name="lucide:calendar" class="w-4 h-4 inline mr-1" />
                        建立於：{{ new Date(invitation.createdAtString).toLocaleDateString('zh-TW') }}
                      </p>
                      <p class="m-0">
                        <Icon name="lucide:clock" class="w-4 h-4 inline mr-1" />
                        到期日：{{ new Date(invitation.expiresAtString).toLocaleDateString('zh-TW') }}
                      </p>
                    </div>

                    <div class="flex gap-2 mt-2">
                      <ui-button
                        size="sm"
                        variant="outline"
                        @click="copyToClipboard(`${window.location.origin}/invite/${invitation.invitationCode}`)"
                      >
                        <Icon name="lucide:copy" :size="16" class="mr-1" />
                        複製連結
                      </ui-button>
                    </div>
                  </div>

                  <ui-button
                    size="sm"
                    variant="ghost"
                    @click="handleRevokeInvitation(invitation.id)"
                  >
                    <Icon name="lucide:trash-2" :size="16" class="text-red-600" />
                  </ui-button>
                </div>
              </div>
            </div>
          </div>

          <!-- Used/Expired Invitations -->
          <div v-if="usedInvitations.length > 0" class="space-y-3">
            <h3 class="text-lg font-semibold text-gray-900 m-0">
              歷史邀請 ({{ usedInvitations.length }})
            </h3>

            <div class="space-y-2">
              <div
                v-for="invitation in usedInvitations"
                :key="invitation.id"
                class="bg-gray-50 border border-gray-200 rounded-lg p-4 opacity-75"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 space-y-2">
                    <div class="flex items-center gap-2">
                      <code class="text-sm font-mono bg-white px-2 py-1 rounded">
                        {{ invitation.invitationCode }}
                      </code>
                      <ui-badge :variant="getStatusBadgeVariant(invitation.status)">
                        {{ getStatusText(invitation.status) }}
                      </ui-badge>
                    </div>

                    <div class="text-sm text-gray-600">
                      <p class="m-0">
                        建立於：{{ new Date(invitation.createdAtString).toLocaleDateString('zh-TW') }}
                      </p>
                      <p v-if="invitation.usedAtString" class="m-0">
                        使用於：{{ new Date(invitation.usedAtString).toLocaleDateString('zh-TW') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div v-if="!isLoading && invitations.length === 0" class="text-center py-8">
            <Icon name="lucide:users" class="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p class="text-gray-500">尚無邀請記錄</p>
            <p class="text-sm text-gray-400">建立第一個邀請連結來邀請協作者</p>
          </div>

          <!-- Loading State -->
          <div v-if="isLoading" class="flex justify-center py-8">
            <Icon name="lucide:loader-circle" class="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        </div>
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
