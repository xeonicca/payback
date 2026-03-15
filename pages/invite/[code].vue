<script setup lang="ts">
import { toast } from 'vue-sonner'
import { animalEmojis } from '@/constants'

definePageMeta({
  layout: false,
})

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
  <div class="min-h-screen bg-slate-200 flex items-center justify-center p-6">
    <div class="w-full max-w-md">
      <!-- Loading State -->
      <div v-if="isLoading" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-4">
          <loading-spinner size="lg" />
          <p class="text-sm text-gray-500 m-0">
            載入邀請資訊...
          </p>
        </div>
      </div>

      <!-- Invitation Not Found -->
      <div v-else-if="!invitation" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:link-2-off" class="w-9 h-9 text-red-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-gray-900 m-0 tracking-tight">
              連結無效
            </h1>
            <p class="text-sm text-gray-500 m-0 leading-relaxed">
              此邀請連結不存在或已被刪除，請向邀請人索取新連結
            </p>
          </div>
          <ui-button variant="link" size="sm" @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Expired Invitation -->
      <div v-else-if="isExpired" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:timer-off" class="w-9 h-9 text-amber-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-gray-900 m-0 tracking-tight">
              邀請已過期
            </h1>
            <p class="text-sm text-gray-500 m-0 leading-relaxed">
              此連結已於 {{ new Date(invitation.expiresAtString).toLocaleDateString('zh-TW') }} 過期
            </p>
          </div>
          <p class="text-xs text-gray-400 m-0 leading-relaxed">
            請聯絡 <span class="font-medium text-gray-600">{{ invitation.invitedByName }}</span> 重新發送邀請
          </p>
          <ui-button variant="link" size="sm" @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Revoked Invitation -->
      <div v-else-if="isRevoked" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:ban" class="w-9 h-9 text-red-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-gray-900 m-0 tracking-tight">
              邀請已取消
            </h1>
            <p class="text-sm text-gray-500 m-0 leading-relaxed">
              此邀請已被主辦人撤銷，請聯絡主辦人了解詳情
            </p>
          </div>
          <ui-button variant="link" size="sm" @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Already Used -->
      <div v-else-if="isAlreadyUsed" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:check-circle-2" class="w-9 h-9 text-green-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-gray-900 m-0 tracking-tight">
              已加入行程
            </h1>
            <p class="text-sm text-gray-500 m-0 leading-relaxed">
              此邀請已被使用，你可以直接進入行程
            </p>
          </div>
          <ui-button @click="router.push(`/trips/${invitation.tripId}`)">
            前往行程
            <Icon name="lucide:arrow-right" class="w-4 h-4 ml-1.5" />
          </ui-button>
        </div>
      </div>

      <!-- Valid Invitation -->
      <div v-else class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <!-- Trip Info Header -->
        <div class="bg-slate-50 px-6 pt-10 pb-6 text-center border-b border-gray-100">
          <p class="text-sm text-muted-foreground m-0 mb-3">
            {{ invitation.invitedByName }} 邀請你加入
          </p>
          <h1 class="text-3xl font-bold text-gray-900 m-0 tracking-tight">
            {{ invitation.tripName }}
          </h1>
        </div>

        <!-- Content -->
        <div class="p-6 space-y-6">
          <!-- Step 1: Login Required -->
          <template v-if="!isUserLoggedIn">
            <div class="text-center">
              <p class="text-sm text-muted-foreground m-0 leading-relaxed">
                登入後即可加入行程，和大家一起分帳
              </p>

              <ui-button
                class="w-full mt-6"
                size="lg"
                @click="handleLogin"
              >
                <Icon name="lucide:log-in" class="w-5 h-5 mr-2" />
                使用 Google 帳號登入
              </ui-button>

              <p class="text-xs text-muted-foreground/60 m-0 mt-3">
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
              <p class="text-sm text-muted-foreground m-0 leading-relaxed">
                選擇你在行程中的身份，或以新成員加入：
              </p>

              <!-- Existing members to claim -->
              <div v-if="availableMembers.length > 0" class="space-y-2.5">
                <button
                  v-for="member in availableMembers"
                  :key="member.id"
                  class="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-300 text-left"
                  :class="selectedMemberId === member.id
                    ? 'border-indigo-500 bg-indigo-50 shadow-sm shadow-indigo-100'
                    : 'border-gray-100 hover:border-gray-200 bg-white'"
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
                <div class="flex-1 border-t border-gray-100" />
                <span class="text-xs text-gray-400">或</span>
                <div class="flex-1 border-t border-gray-100" />
              </div>

              <!-- Join as new member -->
              <button
                class="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-300 text-left"
                :class="joinAsNew
                  ? 'border-indigo-500 bg-indigo-50 shadow-sm shadow-indigo-100'
                  : 'border-gray-100 hover:border-gray-200 bg-white'"
                @click="selectJoinAsNew"
              >
                <div class="size-10 bg-gray-100 rounded-full flex items-center justify-center">
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
              <div v-if="joinAsNew" class="space-y-4 rounded-xl bg-gray-50 p-4">
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
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="emoji in availableEmojis"
                      :key="emoji"
                      class="w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xl transition-all duration-300"
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
              class="w-full mt-2"
              size="lg"
              :disabled="!canAccept || isAccepting"
              @click="handleAccept"
            >
              <Icon v-if="isAccepting" name="lucide:loader-circle" class="w-5 h-5 mr-2 animate-spin" />
              {{ isAccepting ? '加入中...' : '加入行程' }}
            </ui-button>
          </template>

          <!-- Cancel link -->
          <div class="text-center pt-2">
            <button class="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors" @click="router.push('/')">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
