<script setup lang="ts">
import { CATEGORY_LIST } from '@/utils/categories'

const model = defineModel<string>({ default: '' })
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <button
      v-for="cat in CATEGORY_LIST"
      :key="cat.key"
      type="button"
      :aria-pressed="model === cat.key"
      class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
      :class="model === cat.key
        ? 'bg-primary text-primary-foreground'
        : 'bg-muted text-muted-foreground hover:text-foreground'"
      @click="model = model === cat.key ? '' : cat.key"
    >
      <Icon :name="cat.icon" class="h-3 w-3" />
      {{ cat.label }}
    </button>
  </div>
</template>
