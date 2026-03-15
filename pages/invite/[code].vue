<script setup lang="ts">
import { toast } from 'vue-sonner'
import { animalEmojis } from '@/constants'

const route = useRoute()
const router = useRouter()
const invitationCode = route.params.code as string

const { invitation, isLoading } = useInvitation().getInvitationByCode(invitationCode)
const { isUserLoggedIn, loginWithGoogle } = useLogin()

const isAccepting = ref(false)
const isExpired = computed(() => {
  if (!invitation.value)
    return false
  return new Date(invitation.value.expiresAtString) < new Date()
})

const isAlreadyUsed = computed(() => {
  return invitation.value?.status === 'accepted'
})

const isRevoked = computed(() => {
  return invitation.value?.status === 'revoked'
})

// Member selection state
const members = ref<Array<{ id: string, name: string, avatarEmoji: string, isHost: boolean, linkedUserId: string | null }>>([])
const isLoadingMembers = ref(false)
const membersLoaded = ref(false)
const selectedMemberId = ref<string | null>(null)
const joinAsNew = ref(false)
const newMemberName = ref('')
const newMemberEmoji = ref(animalEmojis[0])

const availableMembers = computed(() => {
  return members.value.filter(m => !m.linkedUserId)
})

const usedEmojis = computed(() => {
  return members.value.map(m => m.avatarEmoji)
})

const availableEmojis = computed(() => {
  return animalEmojis.filter(e => !usedEmojis.value.includes(e))
})

const canAccept = computed(() => {
  if (!isUserLoggedIn.value || !membersLoaded.value)
    return false
  if (joinAsNew.value) {
    return newMemberName.value.trim().length > 0 && newMemberEmoji.value
  }
  return selectedMemberId.value !== null
})

// Current step for progress indicator
const currentStep = computed(() => {
  if (!isUserLoggedIn.value)
    return 1
  if (!membersLoaded.value)
    return 2
  return 2
})

// Load members when user logs in and invitation is valid
watch([isUserLoggedIn, invitation], async ([loggedIn, inv]) => {
  if (loggedIn && inv && inv.status === 'pending' && !isExpired.value) {
    await loadMembers()
  }
}, { immediate: true })

async function loadMembers() {
  try {
    isLoadingMembers.value = true
    const { getInvitationMembers } = useInvitation()
    const result = await getInvitationMembers(invitationCode)
    members.value = result.members
    membersLoaded.value = true

    // Default emoji to first available
    if (availableEmojis.value.length > 0) {
      newMemberEmoji.value = availableEmojis.value[0]
    }
  }
  catch (error: any) {
    console.error('Error loading members:', error)
    toast.error(error.message || '無法載入成員資訊')
  }
  finally {
    isLoadingMembers.value = false
  }
}

function selectMember(memberId: string) {
  joinAsNew.value = false
  selectedMemberId.value = memberId
}

function selectJoinAsNew() {
  selectedMemberId.value = null
  joinAsNew.value = true
}

async function handleAccept() {
  if (!canAccept.value)
    return

  try {
    isAccepting.value = true
    const { acceptInvitation } = useInvitation()

    const memberChoice = joinAsNew.value
      ? { newMember: { name: newMemberName.value.trim(), avatarEmoji: newMemberEmoji.value } }
      : { memberId: selectedMemberId.value! }

    const result = await acceptInvitation(invitationCode, memberChoice)

    toast.success('已成功加入行程！')
    router.push(`/trips/${result.tripId}`)
  }
  catch (error: any) {
    console.error('Error accepting invitation:', error)
    toast.error(error.message || '加入行程失敗')
  }
  finally {
    isAccepting.value = false
  }
}

async function handleLogin() {
  await loginWithGoogle()
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Loading State -->
      <div v-if="isLoading" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4">
          <loading-spinner size="lg" />
          <p class="text-gray-500 text-sm">
            載入邀請資訊...
          </p>
        </div>
      </div>

      <!-- Invitation Not Found -->
      <div v-else-if="!invitation" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:link-2-off" class="w-8 h-8 text-red-500" />
          </div>
          <div class="space-y-1">
            <h1 class="text-xl font-bold text-gray-900 m-0">
              連結無效
            </h1>
            <p class="text-sm text-gray-500 m-0">
              此邀請連結不存在或已被刪除，請向邀請人索取新連結
            </p>
          </div>
          <ui-button variant="outline" @click="router.push('/')">
            <Icon name="lucide:home" :size="16" class="mr-1.5" />
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Expired Invitation -->
      <div v-else-if="isExpired" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:timer-off" class="w-8 h-8 text-amber-500" />
          </div>
          <div class="space-y-1">
            <h1 class="text-xl font-bold text-gray-900 m-0">
              邀請已過期
            </h1>
            <p class="text-sm text-gray-500 m-0">
              此連結已於 {{ new Date(invitation.expiresAtString).toLocaleDateString('zh-TW') }} 過期
            </p>
          </div>
          <div class="bg-gray-50 rounded-lg p-3 w-full">
            <p class="text-xs text-gray-500 m-0">
              請聯絡 <span class="font-medium text-gray-700">{{ invitation.invitedByName }}</span> 重新發送邀請
            </p>
          </div>
          <ui-button variant="outline" @click="router.push('/')">
            <Icon name="lucide:home" :size="16" class="mr-1.5" />
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Revoked Invitation -->
      <div v-else-if="isRevoked" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:ban" class="w-8 h-8 text-red-500" />
          </div>
          <div class="space-y-1">
            <h1 class="text-xl font-bold text-gray-900 m-0">
              邀請已取消
            </h1>
            <p class="text-sm text-gray-500 m-0">
              此邀請已被主辦人撤銷，請聯絡主辦人了解詳情
            </p>
          </div>
          <ui-button variant="outline" @click="router.push('/')">
            <Icon name="lucide:home" :size="16" class="mr-1.5" />
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Already Used -->
      <div v-else-if="isAlreadyUsed" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:check-circle-2" class="w-8 h-8 text-green-500" />
          </div>
          <div class="space-y-1">
            <h1 class="text-xl font-bold text-gray-900 m-0">
              已加入行程
            </h1>
            <p class="text-sm text-gray-500 m-0">
              此邀請已被使用，你可以直接進入行程
            </p>
          </div>
          <ui-button @click="router.push(`/trips/${invitation.tripId}`)">
            前往行程
            <Icon name="lucide:arrow-right" :size="16" class="ml-1.5" />
          </ui-button>
        </div>
      </div>

      <!-- Valid Invitation -->
      <div v-else class="bg-white rounded-2xl shadow-xl overflow-hidden">
        <!-- Hero Header with Trip Name -->
        <div class="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 pt-8 pb-6 text-white text-center">
          <p class="text-indigo-200 text-sm m-0 mb-3">
            {{ invitation.invitedByName }} 邀請你加入
          </p>
          <h1 class="text-2xl font-bold m-0 mb-1">
            {{ invitation.tripName }}
          </h1>
        </div>

        <!-- Step Indicator -->
        <div class="px-8 pt-5 pb-2">
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1.5">
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                :class="isUserLoggedIn
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-600'"
              >
                <Icon v-if="isUserLoggedIn" name="lucide:check" :size="14" />
                <span v-else>1</span>
              </div>
              <span class="text-xs font-medium" :class="isUserLoggedIn ? 'text-gray-400' : 'text-gray-900'">登入</span>
            </div>
            <div class="flex-1 h-px bg-gray-200" />
            <div class="flex items-center gap-1.5">
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                :class="currentStep >= 2
                  ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-600'
                  : 'bg-gray-100 text-gray-400'"
              >
                2
              </div>
              <span class="text-xs font-medium" :class="currentStep >= 2 ? 'text-gray-900' : 'text-gray-400'">選擇身份</span>
            </div>
          </div>
        </div>

        <!-- Content -->
        <div class="p-8 pt-4 space-y-5">
          <!-- Step 1: Login Required -->
          <template v-if="!isUserLoggedIn">
            <div class="text-center space-y-4">
              <div class="space-y-1">
                <p class="text-sm text-gray-600 m-0">
                  登入後即可加入行程，和大家一起分帳
                </p>
              </div>

              <ui-button
                class="w-full"
                size="lg"
                @click="handleLogin"
              >
                <Icon name="lucide:log-in" :size="18" class="mr-2" />
                使用 Google 帳號登入
              </ui-button>

              <p class="text-xs text-gray-400 m-0">
                首次使用會自動建立帳號
              </p>
            </div>
          </template>

          <!-- Loading Members -->
          <template v-else-if="isLoadingMembers">
            <div class="flex flex-col items-center justify-center py-8 space-y-3">
              <loading-spinner />
              <p class="text-sm text-gray-500 m-0">
                正在載入行程成員...
              </p>
            </div>
          </template>

          <!-- Step 2: Member Selection -->
          <template v-else-if="membersLoaded">
            <div class="space-y-4">
              <p class="text-sm text-gray-600 m-0">
                選擇你在行程中的身份，或以新成員加入：
              </p>

              <!-- Existing members to claim -->
              <div v-if="availableMembers.length > 0" class="space-y-2">
                <button
                  v-for="member in availableMembers"
                  :key="member.id"
                  class="w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left"
                  :class="selectedMemberId === member.id
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'"
                  @click="selectMember(member.id)"
                >
                  <member-avatar :emoji="member.avatarEmoji" size="lg" />
                  <span class="flex-1 font-medium text-gray-900">{{ member.name }}</span>
                  <div
                    class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
                    :class="selectedMemberId === member.id
                      ? 'border-indigo-600 bg-indigo-600'
                      : 'border-gray-300'"
                  >
                    <Icon
                      v-if="selectedMemberId === member.id"
                      name="lucide:check"
                      class="w-3 h-3 text-white"
                    />
                  </div>
                </button>
              </div>

              <!-- Divider -->
              <div v-if="availableMembers.length > 0" class="flex items-center gap-3">
                <div class="flex-1 border-t border-gray-200" />
                <span class="text-xs text-gray-400">或</span>
                <div class="flex-1 border-t border-gray-200" />
              </div>

              <!-- Join as new member -->
              <button
                class="w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left"
                :class="joinAsNew
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'"
                @click="selectJoinAsNew"
              >
                <div class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <Icon name="lucide:user-plus" class="w-4 h-4 text-gray-500" />
                </div>
                <span class="flex-1 font-medium text-gray-900">以新成員加入</span>
                <div
                  class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
                  :class="joinAsNew
                    ? 'border-indigo-600 bg-indigo-600'
                    : 'border-gray-300'"
                >
                  <Icon
                    v-if="joinAsNew"
                    name="lucide:check"
                    class="w-3 h-3 text-white"
                  />
                </div>
              </button>

              <!-- New member form -->
              <div v-if="joinAsNew" class="space-y-3 rounded-xl bg-gray-50 p-4">
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1.5 block">你的名稱</label>
                  <ui-input
                    v-model="newMemberName"
                    type="text"
                    placeholder="例：小明"
                  />
                </div>
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1.5 block">選擇頭像</label>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="emoji in availableEmojis"
                      :key="emoji"
                      class="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xl transition-all"
                      :class="newMemberEmoji === emoji
                        ? 'border-indigo-500 bg-indigo-50 scale-110'
                        : 'border-gray-200 hover:border-gray-300'"
                      @click="newMemberEmoji = emoji"
                    >
                      {{ emoji }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Accept Button -->
            <ui-button
              class="w-full"
              size="lg"
              :disabled="!canAccept || isAccepting"
              @click="handleAccept"
            >
              <Icon v-if="isAccepting" name="lucide:loader-circle" :size="18" class="mr-2 animate-spin" />
              {{ isAccepting ? '加入中...' : '加入行程' }}
            </ui-button>
          </template>

          <!-- Cancel link -->
          <div class="text-center pt-1">
            <button class="text-xs text-gray-400 hover:text-gray-600 transition-colors" @click="router.push('/')">
              取消
            </button>
          </div>
        </div>
      </div>

      <!-- App context for first-time users -->
      <p v-if="invitation && !isExpired && !isRevoked && !isAlreadyUsed" class="text-center text-xs text-gray-400 mt-4">
        Payback — 旅行分帳，輕鬆搞定
      </p>
    </div>
  </div>
</template>
