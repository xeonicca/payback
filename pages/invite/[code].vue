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
const step = ref<'info' | 'member-select'>('info')
const members = ref<Array<{ id: string, name: string, avatarEmoji: string, isHost: boolean, linkedUserId: string | null }>>([])
const isLoadingMembers = ref(false)
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
  if (!isUserLoggedIn.value)
    return false
  if (step.value !== 'member-select')
    return false
  if (joinAsNew.value) {
    return newMemberName.value.trim().length > 0 && newMemberEmoji.value
  }
  return selectedMemberId.value !== null
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
    step.value = 'member-select'

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
      <div v-if="isLoading.value" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4">
          <Icon name="lucide:loader-circle" class="w-12 h-12 text-indigo-600 animate-spin" />
          <p class="text-gray-600">
            載入邀請資訊...
          </p>
        </div>
      </div>

      <!-- Invitation Not Found -->
      <div v-else-if="!invitation" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
            <Icon name="lucide:x-circle" class="w-10 h-10 text-red-600" />
          </div>
          <h1 class="text-2xl font-bold text-gray-900 m-0">
            找不到邀請
          </h1>
          <p class="text-gray-600">
            此邀請連結無效或已被刪除
          </p>
          <ui-button @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Expired Invitation -->
      <div v-else-if="isExpired" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
            <Icon name="lucide:clock-x" class="w-10 h-10 text-amber-600" />
          </div>
          <h1 class="text-2xl font-bold text-gray-900 m-0">
            邀請已過期
          </h1>
          <p class="text-gray-600">
            此邀請連結已於 {{ new Date(invitation.expiresAtString).toLocaleDateString('zh-TW') }} 過期
          </p>
          <p class="text-sm text-gray-500">
            請聯絡行程主辦人 {{ invitation.invitedByName }} 取得新的邀請連結
          </p>
          <ui-button @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Revoked Invitation -->
      <div v-else-if="isRevoked" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
            <Icon name="lucide:ban" class="w-10 h-10 text-red-600" />
          </div>
          <h1 class="text-2xl font-bold text-gray-900 m-0">
            邀請已撤銷
          </h1>
          <p class="text-gray-600">
            此邀請連結已被主辦人撤銷
          </p>
          <ui-button @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Already Used -->
      <div v-else-if="isAlreadyUsed" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
            <Icon name="lucide:check-circle" class="w-10 h-10 text-green-600" />
          </div>
          <h1 class="text-2xl font-bold text-gray-900 m-0">
            邀請已使用
          </h1>
          <p class="text-gray-600">
            此邀請連結已被使用
          </p>
          <ui-button @click="router.push(`/trips/${invitation.tripId}`)">
            前往行程
          </ui-button>
        </div>
      </div>

      <!-- Valid Invitation -->
      <div v-else class="bg-white rounded-2xl shadow-xl overflow-hidden">
        <!-- Header -->
        <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
          <Icon name="lucide:users" class="w-16 h-16 mx-auto mb-4" />
          <h1 class="text-3xl font-bold m-0 mb-2">
            行程邀請
          </h1>
          <p class="text-indigo-100">
            {{ invitation.invitedByName }} 邀請您加入行程
          </p>
        </div>

        <!-- Content -->
        <div class="p-8 space-y-6">
          <!-- Trip Info -->
          <div class="bg-gray-50 rounded-xl p-6 space-y-3">
            <div class="flex items-center gap-3">
              <Icon name="lucide:map-pin" class="w-5 h-5 text-indigo-600" />
              <div class="flex-1">
                <p class="text-xs text-gray-500 m-0">
                  行程名稱
                </p>
                <p class="text-lg font-bold text-gray-900 m-0">
                  {{ invitation.tripName }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <Icon name="lucide:user" class="w-5 h-5 text-indigo-600" />
              <div class="flex-1">
                <p class="text-xs text-gray-500 m-0">
                  主辦人
                </p>
                <p class="text-base font-medium text-gray-900 m-0">
                  {{ invitation.invitedByName }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <Icon name="lucide:calendar" class="w-5 h-5 text-indigo-600" />
              <div class="flex-1">
                <p class="text-xs text-gray-500 m-0">
                  邀請有效期限
                </p>
                <p class="text-base font-medium text-gray-900 m-0">
                  {{ new Date(invitation.expiresAtString).toLocaleDateString('zh-TW') }}
                </p>
              </div>
            </div>
          </div>

          <!-- Step 1: Login Required -->
          <template v-if="!isUserLoggedIn">
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <Icon name="lucide:info" class="w-5 h-5 text-blue-600 mt-0.5" />
                <div class="flex-1">
                  <p class="text-sm text-blue-900 font-medium m-0 mb-1">
                    需要登入
                  </p>
                  <p class="text-sm text-blue-700 m-0">
                    請先登入才能接受邀請加入行程
                  </p>
                </div>
              </div>
            </div>

            <ui-button
              class="w-full"
              size="lg"
              @click="handleLogin"
            >
              <Icon name="lucide:log-in" :size="20" class="mr-2" />
              使用 Google 登入
            </ui-button>
          </template>

          <!-- Step 2: Loading Members -->
          <template v-else-if="isLoadingMembers">
            <div class="flex flex-col items-center justify-center py-6 space-y-3">
              <Icon name="lucide:loader-circle" class="w-8 h-8 text-indigo-600 animate-spin" />
              <p class="text-sm text-gray-500">
                載入成員資訊...
              </p>
            </div>
          </template>

          <!-- Step 3: Member Selection -->
          <template v-else-if="step === 'member-select'">
            <div class="space-y-4">
              <h3 class="text-base font-semibold text-gray-900 m-0">
                您想怎麼加入這趟旅程？
              </h3>

              <!-- Existing members to claim -->
              <div v-if="availableMembers.length > 0" class="space-y-2">
                <p class="text-sm text-gray-500 m-0">
                  我是現有成員：
                </p>
                <button
                  v-for="member in availableMembers"
                  :key="member.id"
                  class="w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left"
                  :class="selectedMemberId === member.id
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'"
                  @click="selectMember(member.id)"
                >
                  <span class="text-2xl">{{ member.avatarEmoji }}</span>
                  <span class="flex-1 font-medium text-gray-900">{{ member.name }}</span>
                  <Icon
                    v-if="selectedMemberId === member.id"
                    name="lucide:check-circle"
                    class="w-5 h-5 text-indigo-600"
                  />
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
                <Icon
                  v-if="joinAsNew"
                  name="lucide:check-circle"
                  class="w-5 h-5 text-indigo-600"
                />
              </button>

              <!-- New member form -->
              <div v-if="joinAsNew" class="space-y-3 pl-2">
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1 block">名稱</label>
                  <ui-input
                    v-model="newMemberName"
                    type="text"
                    placeholder="輸入你的名稱"
                  />
                </div>
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1 block">選擇頭像</label>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="emoji in availableEmojis"
                      :key="emoji"
                      class="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xl transition-all"
                      :class="newMemberEmoji === emoji
                        ? 'border-indigo-500 bg-indigo-50'
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
              <Icon v-if="isAccepting" name="lucide:loader-circle" :size="20" class="mr-2 animate-spin" />
              <Icon v-else name="lucide:check" :size="20" class="mr-2" />
              {{ isAccepting ? '加入中...' : '確認加入行程' }}
            </ui-button>
          </template>

          <div class="text-center">
            <ui-button variant="ghost" size="sm" @click="router.push('/')">
              取消
            </ui-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
