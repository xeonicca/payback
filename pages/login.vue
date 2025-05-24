<script setup lang="ts">
const {
  loginWithGoogle,
  checkRedirectResult,
  isUserLoggedIn,
} = useLogin()
const $router = useRouter()

function login() {
  loginWithGoogle()
}
const isLoading = ref(false)

function loginSuccessRedirect() {
  $router.replace('/')
  localStorage.removeItem('prevRoute')
  // toast.success('登入成功')
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
  <div>
    <h1>Login: {{ isUserLoggedIn }}</h1>
    <button @click="login">
      Login
    </button>
  </div>
</template>
