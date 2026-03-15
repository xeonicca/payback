<script setup lang="ts">
withDefaults(defineProps<{
  emoji: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}>(), {
  size: 'md',
})

const sizeClasses: Record<string, string> = {
  'sm': 'size-6 text-sm',
  'md': 'size-8 text-lg',
  'lg': 'size-10 text-2xl',
  'xl': 'size-12 text-3xl',
  '2xl': 'size-14 text-4xl',
}
</script>

<template>
  <span
    class="inline-flex items-center justify-center shrink-0 rounded-full"
    :class="sizeClasses[size]"
  >{{ emoji }}</span>
</template>
