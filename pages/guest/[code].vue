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
const { isUserLoggedIn, loginAsGuest, checkRedirectResult } = useLogin()
const sessionUser = useSessionUser()

const isCheckingRedirect = ref(false)
const isAccepting = ref(false)

// Handle returning guests (session recovery from IndexedDB)
onMounted(async () => {
  isCheckingRedirect.value = true
  await checkRedirectResult()
  isCheckingRedirect.value = false
})

const isExpired = computed(() => {
  if (!invitation.value)
    return false
  return new Date(invitation.value.expiresAtString) < new Date()
})

const isAlreadyUsed = computed(() => {
  if (!invitation.value)
    return false
  if (invitation.value.status !== 'accepted')
    return false
  const maxUses = invitation.value.maxUses ?? 1
  return maxUses !== null && invitation.value.usedCount >= maxUses
})

const isRevoked = computed(() => {
  return invitation.value?.status === 'revoked'
})

const isGuestInvitation = computed(() => {
  return invitation.value?.type === 'guest'
})

// Member setup state (guests always create a new member)
const members = ref<Array<{ id: string, name: string, avatarEmoji: string, isHost: boolean, linkedUserId: string | null }>>([])
const isLoadingMembers = ref(false)
const membersLoaded = ref(false)
const selectedMemberId = ref<string | null>(null)
const joinAsNew = ref(true) // Default to new member for guests
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
  if (joinAsNew.value) {
    return newMemberName.value.trim().length > 0 && newMemberEmoji.value
  }
  return selectedMemberId.value !== null
})

// Check if invitation is usable
const isUsable = computed(() => {
  if (!invitation.value)
    return false
  if (!isGuestInvitation.value)
    return false
  if (isExpired.value || isRevoked.value || isAlreadyUsed.value)
    return false
  return invitation.value.status === 'pending'
    || (invitation.value.status === 'accepted' && invitation.value.maxUses === null)
})

// When invitation is valid: ensure anonymous session exists, then load members
const isInitializing = ref(false)
const initError = ref<string | null>(null)
watch([invitation], async ([inv]) => {
  if (!inv || !isUsable.value)
    return

  initError.value = null

  // If already logged in (returning guest or Google user), load members directly
  if (isUserLoggedIn.value) {
    await loadMembers()
    return
  }

  // First-time guest: silently create anonymous session so we can load members
  isInitializing.value = true
  try {
    const user = await loginAsGuest()
    if (user) {
      await loadMembers()
    }
    else {
      initError.value = '無法建立訪客連線，請稍後再試'
    }
  }
  catch (error) {
    console.error('Error initializing guest session:', error)
    initError.value = '無法建立訪客連線，請稍後再試'
  }
  finally {
    isInitializing.value = false
  }
}, { immediate: true })

async function loadMembers() {
  try {
    isLoadingMembers.value = true
    const { getInvitationMembers } = useInvitation()
    const result = await getInvitationMembers(invitationCode)
    members.value = result.members
    membersLoaded.value = true

    // If current user is already a member, redirect to trip page
    const currentUid = sessionUser.value?.uid
    if (currentUid && invitation.value) {
      const alreadyLinked = result.members.some(m => m.linkedUserId === currentUid)
      if (alreadyLinked) {
        toast.info('你已經是此行程的成員')
        router.replace(`/trips/${invitation.value.tripId}`)
        return
      }
    }

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

async function handleJoinAsGuest() {
  if (!canAccept.value || !isUserLoggedIn.value)
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
    console.error('Error joining as guest:', error)
    toast.error(error.message || '加入行程失敗')
  }
  finally {
    isAccepting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-slate-200 flex items-center justify-center p-6">
    <div class="w-full max-w-md">
      <!-- Loading State -->
      <div v-if="isLoading || isCheckingRedirect" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-4">
          <loading-spinner size="lg" />
          <p class="text-sm text-muted-foreground m-0">
            載入邀請資訊...
          </p>
        </div>
      </div>

      <!-- Invitation Not Found or Not Guest Type -->
      <div v-else-if="!invitation || !isGuestInvitation" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:link-2-off" class="w-9 h-9 text-red-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-foreground m-0 tracking-tight">
              連結無效
            </h1>
            <p class="text-sm text-muted-foreground m-0 leading-relaxed">
              此邀請連結不存在或已被刪除，請向邀請人索取新連結
            </p>
          </div>
        </div>
      </div>

      <!-- Expired Invitation -->
      <div v-else-if="isExpired" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:timer-off" class="w-9 h-9 text-amber-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-foreground m-0 tracking-tight">
              邀請已過期
            </h1>
            <p class="text-sm text-muted-foreground m-0 leading-relaxed">
              此連結已於 {{ new Date(invitation.expiresAtString).toLocaleDateString('zh-TW') }} 過期
            </p>
          </div>
          <p class="text-xs text-muted-foreground/70 m-0 leading-relaxed">
            請聯絡 <span class="font-medium text-foreground/70">{{ invitation.invitedByName }}</span> 重新發送邀請
          </p>
        </div>
      </div>

      <!-- Revoked Invitation -->
      <div v-else-if="isRevoked" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:ban" class="w-9 h-9 text-red-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-foreground m-0 tracking-tight">
              邀請已取消
            </h1>
            <p class="text-sm text-muted-foreground m-0 leading-relaxed">
              此邀請已被建立者撤銷，請聯絡建立者了解詳情
            </p>
          </div>
        </div>
      </div>

      <!-- Already Used -->
      <div v-else-if="isAlreadyUsed" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:check-circle-2" size="44" class="text-green-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-foreground m-0 tracking-tight">
              連結已用完
            </h1>
            <p class="text-sm text-muted-foreground m-0 leading-relaxed">
              此邀請連結的使用次數已達上限
            </p>
          </div>
        </div>
      </div>

      <!-- Valid Guest Invitation -->
      <div v-else class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <!-- Trip Info Header -->
        <div class="bg-slate-50 px-6 pt-10 pb-6 text-center border-b border-gray-100">
          <p class="text-sm text-muted-foreground m-0 mb-3">
            {{ invitation.invitedByName }} 邀請你加入
          </p>
          <h1 class="text-3xl font-bold text-foreground m-0 tracking-tight">
            {{ invitation.tripName }}
          </h1>
        </div>

        <!-- Content -->
        <div class="p-6 space-y-6">
          <!-- Loading / Initializing -->
          <template v-if="isInitializing || isLoadingMembers">
            <div class="flex flex-col items-center justify-center py-8 space-y-3">
              <loading-spinner />
              <p class="text-sm text-muted-foreground m-0">
                正在載入行程成員...
              </p>
            </div>
          </template>

          <!-- Error state -->
          <template v-else-if="initError">
            <div class="flex flex-col items-center justify-center py-8 space-y-4 text-center">
              <div class="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
                <Icon name="lucide:wifi-off" class="w-7 h-7 text-red-500" />
              </div>
              <p class="text-sm text-muted-foreground m-0">
                {{ initError }}
              </p>
            </div>
          </template>

          <!-- Member selection -->
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
                  class="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-300 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  :class="selectedMemberId === member.id
                    ? 'border-indigo-500 bg-indigo-50 shadow-sm shadow-indigo-100'
                    : 'border-gray-100 hover:border-gray-200 bg-white'"
                  @click="selectMember(member.id)"
                >
                  <member-avatar :emoji="member.avatarEmoji" size="lg" />
                  <span class="flex-1 font-medium text-foreground">{{ member.name }}</span>
                  <div
                    class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors duration-200"
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
                class="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-300 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                :class="joinAsNew
                  ? 'border-indigo-500 bg-indigo-50 shadow-sm shadow-indigo-100'
                  : 'border-gray-100 hover:border-gray-200 bg-white'"
                @click="selectJoinAsNew"
              >
                <div class="size-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <Icon name="lucide:user-plus" class="w-4 h-4 text-gray-500" />
                </div>
                <span class="flex-1 font-medium text-foreground">以新成員加入</span>
                <div
                  class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors duration-200"
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
                      class="w-11 h-11 rounded-lg border-2 flex items-center justify-center text-xl transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
              @click="handleJoinAsGuest"
            >
              <Icon v-if="isAccepting" name="lucide:loader-circle" class="w-5 h-5 mr-2 animate-spin" />
              {{ isAccepting ? '加入中...' : '以訪客身份加入' }}
            </ui-button>
            <p class="text-xs text-muted-foreground/60 m-0 mt-2 text-center">
              無需登入，稍後可連結 Google 帳號
            </p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
