<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description?: string
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 text-center">
    <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
      <Icon :name="icon" class="w-8 h-8 text-gray-400" />
    </div>
    <h2 class="text-lg font-semibold text-gray-900 mb-2">
      {{ title }}
    </h2>
    <p v-if="description" class="text-sm text-gray-500 mb-6">
      {{ description }}
    </p>
    <slot />
  </div>
</template>
