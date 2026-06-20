<script setup lang="ts">
import { getCategoryMeta } from '@/utils/categories'

const props = defineProps<{
  category?: string
  // When true, render a muted placeholder for unlabeled expenses instead of the "other" chip.
  showUnlabeled?: boolean
}>()

const isUnlabeled = computed(() => !props.category)
const meta = computed(() => getCategoryMeta(props.category))
</script>

<template>
  <span
    v-if="!isUnlabeled || showUnlabeled"
    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none"
    :class="isUnlabeled ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500' : meta.chipClass"
  >
    <Icon :name="isUnlabeled ? 'lucide:tag' : meta.icon" class="h-2.5 w-2.5" />
    {{ isUnlabeled ? '未分類' : meta.label }}
  </span>
</template>
