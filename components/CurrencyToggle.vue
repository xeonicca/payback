<script setup lang="ts">
const props = defineProps<{
  tripCurrency: string
  defaultCurrency: string
  showHomeCurrency: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()
</script>

<template>
  <div class="inline-flex items-center rounded-full bg-muted p-0.5 text-xs font-medium">
    <button
      type="button"
      class="rounded-full px-2.5 py-1 transition-colors"
      :class="!showHomeCurrency
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'"
      @click="showHomeCurrency && emit('toggle')"
    >
      {{ tripCurrency }}
    </button>
    <button
      type="button"
      class="rounded-full px-2.5 py-1 transition-colors"
      :class="showHomeCurrency
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'"
      @click="!showHomeCurrency && emit('toggle')"
    >
      {{ defaultCurrency }}
    </button>
  </div>
</template>
