<script setup lang="ts">
import { toast } from 'vue-sonner'

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
  isLoading.value = true
  const result = await checkRedirectResult()
  if (result || isUserLoggedIn.value)
    loginSuccessRedirect()

  isLoading.value = false
})
</script>

<template>
  <div class="pt-[20vh] flex min-h-svh flex-col gap-6 bg-gradient-to-b from-slate-700 to-slate-300 p-6 md:p-10">
    <div class="flex w-full flex-col gap-6 items-center">
      <NuxtImg src="/logo-transparent.png" alt="logo" class="w-40 h-40" />
      <template v-if="isLoading">
        <div class="flex flex-col items-center gap-3">
          <loading-spinner size="lg" class="text-slate-200" />
          <p class="text-sm text-slate-200 m-0">
            正在驗證登入...
          </p>
        </div>
      </template>
      <LoginForm v-else />
    </div>
  </div>
</template>
