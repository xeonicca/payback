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
  <div class="inline-flex items-center rounded-full bg-white/15 p-0.5 text-xs font-medium">
    <button
      type="button"
      class="rounded-full px-2.5 py-1 transition-colors"
      :class="!showHomeCurrency
        ? 'bg-white text-slate-800 shadow-sm'
        : 'text-white/70 hover:text-white'"
      @click="showHomeCurrency && emit('toggle')"
    >
      {{ tripCurrency }}
    </button>
    <button
      type="button"
      class="rounded-full px-2.5 py-1 transition-colors"
      :class="showHomeCurrency
        ? 'bg-white text-slate-800 shadow-sm'
        : 'text-white/70 hover:text-white'"
      @click="!showHomeCurrency && emit('toggle')"
    >
      {{ defaultCurrency }}
    </button>
  </div>
</template>
