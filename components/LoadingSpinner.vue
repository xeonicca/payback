<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
}>(), {
  size: 'md',
})

const sizeClasses: Record<string, string> = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}
</script>

<template>
  <Icon
    name="lucide:loader-circle"
    class="text-primary animate-spin"
    :class="sizeClasses[size]"
  />
</template>
