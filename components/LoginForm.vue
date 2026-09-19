<script setup lang="ts">
const { loginWithGoogle, authError } = useLogin()
const isSigningIn = ref(false)

async function signIn() {
  isSigningIn.value = true
  try {
    await loginWithGoogle()
  }
  finally {
    isSigningIn.value = false
  }
}
</script>

<template>
  <div class="container mx-auto px-8">
    <p class="mb-4 text-sm text-slate-200 text-center">
      請使用 Google 帳號登入。
    </p>
    <ui-button variant="default" size="lg" class="w-full" :disabled="isSigningIn" @click="signIn">
      {{ isSigningIn ? '登入中…' : '使用 Google 登入' }}
    </ui-button>
    <p v-if="authError" role="alert" class="mt-3 text-sm text-white">
      登入未完成，請確認網路連線後重試。
    </p>
  </div>
</template>
