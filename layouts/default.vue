<script setup lang="ts">
// No additional setup needed
</script>

<template>
  <div class="min-h-screen bg-slate-200 pt-safe">
    <keep-alive>
      <navbar />
    </keep-alive>

    <main class="container mx-auto px-6 pb-30">
      <slot />
    </main>
  </div>
</template>
