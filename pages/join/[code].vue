<script setup lang="ts">
import { toast } from 'vue-sonner'
import { animalEmojis } from '@/constants'

const { logEvent } = useAnalytics()

definePageMeta({
  layout: false,
})

const route = useRoute()
const router = useRouter()
const joinCode = route.params.code as string

const { isUserLoggedIn, loginWithGoogle, checkRedirectResult } = useLogin()
const sessionUser = useSessionUser()

const isCheckingRedirect = ref(false)
const isLoading = ref(true)
const isJoining = ref(false)
const errorState = ref<'not-found' | 'disabled' | null>(null)

const tripInfo = ref<{
  tripId: string
  tripName: string
  ownerDisplayName: string
  members: Array<{ id: string, name: string, avatarEmoji: string, isHost: boolean, linkedUserId: string | null }>
} | null>(null)

// Member selection state
const selectedMemberId = ref<string | null>(null)
const joinAsNew = ref(false)
const newMemberName = ref('')
const newMemberEmoji = ref(animalEmojis[0])

const availableMembers = computed(() => {
  return tripInfo.value?.members.filter(m => !m.linkedUserId) ?? []
})

const usedEmojis = computed(() => {
  return tripInfo.value?.members.map(m => m.avatarEmoji) ?? []
})

const availableEmojis = computed(() => {
  return animalEmojis.filter(e => !usedEmojis.value.includes(e))
})

const canJoin = computed(() => {
  if (!isUserLoggedIn.value || !tripInfo.value)
    return false
  if (joinAsNew.value)
    return newMemberName.value.trim().length > 0 && newMemberEmoji.value
  return selectedMemberId.value !== null
})

onMounted(async () => {
  isCheckingRedirect.value = true
  await checkRedirectResult()
  isCheckingRedirect.value = false
})

// Load trip info when user logs in
watch(isUserLoggedIn, async (loggedIn) => {
  if (loggedIn)
    await loadTripInfo()
}, { immediate: true })

async function loadTripInfo() {
  try {
    isLoading.value = true
    const result = await $fetch<typeof tripInfo.value>('/api/trips/join-info', {
      query: { joinCode },
    })
    tripInfo.value = result

    // Check if user is already a member
    const currentUid = sessionUser.value?.uid
    if (currentUid && result) {
      const alreadyLinked = result.members.some(m => m.linkedUserId === currentUid)
      if (alreadyLinked) {
        toast.info('你已經是此行程的成員')
        router.replace(`/trips/${result.tripId}`)
        return
      }
    }

    if (availableEmojis.value.length > 0)
      newMemberEmoji.value = availableEmojis.value[0]
  }
  catch (error: any) {
    const status = error.statusCode || error.data?.statusCode
    if (status === 404)
      errorState.value = 'not-found'
    else if (status === 400)
      errorState.value = 'disabled'
    else
      errorState.value = 'not-found'
  }
  finally {
    isLoading.value = false
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

async function handleJoin() {
  if (!canJoin.value)
    return

  try {
    isJoining.value = true

    const memberChoice = joinAsNew.value
      ? { newMember: { name: newMemberName.value.trim(), avatarEmoji: newMemberEmoji.value } }
      : { memberId: selectedMemberId.value! }

    const result = await $fetch<{ success: boolean, tripId: string }>('/api/trips/join', {
      method: 'POST',
      body: { joinCode, ...memberChoice },
    })

    logEvent('join_trip', { method: 'public_link', trip_id: result.tripId })
    toast.success('已成功加入行程！')
    router.push(`/trips/${result.tripId}`)
  }
  catch (error: any) {
    console.error('Error joining trip:', error)
    toast.error(error.data?.message || error.message || '加入行程失敗')
  }
  finally {
    isJoining.value = false
  }
}

async function handleLogin() {
  await loginWithGoogle()
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
            載入行程資訊...
          </p>
        </div>
      </div>

      <!-- Not Found -->
      <div v-else-if="errorState === 'not-found'" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:link-2-off" class="w-9 h-9 text-red-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-foreground m-0 tracking-tight">
              連結無效
            </h1>
            <p class="text-sm text-muted-foreground m-0 leading-relaxed">
              此加入連結不存在，請向行程建立者索取新連結
            </p>
          </div>
          <ui-button variant="link" size="sm" @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Joining Disabled -->
      <div v-else-if="errorState === 'disabled'" class="bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:lock" class="w-9 h-9 text-amber-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-foreground m-0 tracking-tight">
              加入已關閉
            </h1>
            <p class="text-sm text-muted-foreground m-0 leading-relaxed">
              此行程目前不開放加入，請聯絡行程建立者
            </p>
          </div>
          <ui-button variant="link" size="sm" @click="router.push('/')">
            返回首頁
          </ui-button>
        </div>
      </div>

      <!-- Valid Join Page -->
      <div v-else-if="tripInfo" class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <!-- Trip Info Header -->
        <div class="bg-slate-50 px-6 pt-10 pb-6 text-center border-b border-gray-100">
          <p class="text-sm text-muted-foreground m-0 mb-3">
            加入行程
          </p>
          <h1 class="text-3xl font-bold text-foreground m-0 tracking-tight">
            {{ tripInfo.tripName }}
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

          <!-- Step 2: Member Selection -->
          <template v-else>
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

            <!-- Join Button -->
            <ui-button
              class="w-full mt-2"
              size="lg"
              :disabled="!canJoin || isJoining"
              @click="handleJoin"
            >
              <Icon v-if="isJoining" name="lucide:loader-circle" class="w-5 h-5 mr-2 animate-spin" />
              {{ isJoining ? '加入中...' : '加入行程' }}
            </ui-button>
          </template>

          <!-- Cancel link -->
          <div class="text-center pt-2">
            <button class="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors outline-none focus-visible:text-muted-foreground" @click="router.push('/')">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
