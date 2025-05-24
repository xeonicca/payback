<script setup lang="ts">
const { loginWithGoogle } = useLogin()
</script>

<template>
  <div class="container mx-auto px-8">
    <p class="mb-4 text-sm text-slate-200 text-center">
      請使用 Google 帳號登入。
    </p>
    <ui-button variant="default" size="lg" class="w-full" @click="loginWithGoogle">
      Login with Google
    </ui-button>
  </div>
</template>
