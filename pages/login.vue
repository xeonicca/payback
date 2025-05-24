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
    description: `Hello ${sessionUser.value?.displayName}`,
  })
}

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
      <LoginForm />
    </div>
  </div>
</template>
