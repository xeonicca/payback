<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description?: string
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 text-center">
    <div class="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
      <Icon :name="icon" class="w-8 h-8 text-muted-foreground" />
    </div>
    <h2 class="text-lg font-semibold text-foreground mb-2">
      {{ title }}
    </h2>
    <p v-if="description" class="text-sm text-muted-foreground mb-6">
      {{ description }}
    </p>
    <slot />
  </div>
</template>
