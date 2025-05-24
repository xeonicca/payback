<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})
const { isUserLoggedIn } = useLogin()
</script>

<template>
  <div>
    <h1>Hello World: {{ isUserLoggedIn }}</h1>
  </div>
</template>
