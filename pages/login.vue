<script setup lang="ts">
import { toast } from 'vue-sonner'
import { dlog, dlogClear, dlogEnv, dlogRead } from '~/utils/debugLog'

definePageMeta({
  layout: false,
})

const {
  checkRedirectResult,
  isUserLoggedIn,
} = useLogin()
const sessionUser = useSessionUser()
const $router = useRouter()

const isLoading = ref(false)
const debugText = ref('')
const showDebug = ref(false)

function refreshDebug() {
  debugText.value = dlogRead()
}

function loginSuccessRedirect() {
  $router.replace('/')
  localStorage.removeItem('prevRoute')
  toast.success(`登入成功`, {
    description: `Hello ${sessionUser.value?.displayName || ''}`.trim() || undefined,
  })
}

// Watch for login state changes (e.g. after popup login completes)
watch(isUserLoggedIn, (loggedIn) => {
  if (loggedIn)
    loginSuccessRedirect()
})

onMounted(async () => {
  dlog('login:mounted', dlogEnv())
  isLoading.value = true
  const result = await checkRedirectResult()
  dlog('login:checkRedirectResult:returned', { hasResult: !!result, isLoggedIn: isUserLoggedIn.value })
  if (result || isUserLoggedIn.value)
    loginSuccessRedirect()

  isLoading.value = false
  refreshDebug()
  // Auto-open viewer if there's anything to show
  if (debugText.value)
    showDebug.value = true
})

function copyDebug() {
  navigator.clipboard?.writeText(debugText.value).catch(() => {})
  toast.success('Copied debug log')
}

function clearDebug() {
  dlogClear()
  refreshDebug()
}
</script>

<template>
  <div class="pt-[20vh] flex min-h-svh flex-col gap-6 bg-gradient-to-b from-slate-700 to-slate-300 p-6 md:p-10">
    <div class="flex w-full flex-col gap-6 items-center">
      <NuxtImg src="/logo-transparent.png" alt="logo" class="w-40 h-40" />
      <loading-spinner v-if="isLoading" size="lg" class="text-slate-200" />
      <LoginForm v-else />
    </div>

    <!-- Debug log viewer -->
    <div class="fixed bottom-2 right-2 z-50 max-w-[calc(100vw-1rem)]">
      <button
        type="button"
        class="rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-100 shadow"
        @click="showDebug = !showDebug; refreshDebug()"
      >
        {{ showDebug ? 'hide' : 'debug' }}
      </button>
      <div
        v-if="showDebug"
        class="mt-2 w-[min(95vw,540px)] rounded-lg bg-slate-900/95 p-3 text-slate-100 shadow-lg"
      >
        <div class="mb-2 flex gap-2 text-xs">
          <button type="button" class="rounded bg-slate-700 px-2 py-1" @click="refreshDebug">
            refresh
          </button>
          <button type="button" class="rounded bg-slate-700 px-2 py-1" @click="copyDebug">
            copy
          </button>
          <button type="button" class="rounded bg-red-700 px-2 py-1" @click="clearDebug">
            clear
          </button>
        </div>
        <pre class="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all text-[10px] leading-tight">{{ debugText || '(empty)' }}</pre>
      </div>
    </div>
  </div>
</template>
