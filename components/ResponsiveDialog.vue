<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  // Keep the description for screen readers only, when the title says enough
  hideDescription?: boolean
}>(), {
  hideDescription: false,
})

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
}>()

// Centered dialog on desktop; bottom sheet on phones/tablets so long forms can
// scroll while the actions stay pinned within thumb reach.
const isDesktop = useMediaQuery('(min-width: 1024px)')
</script>

<template>
  <ui-dialog v-if="isDesktop" :open="open" @update:open="(val) => emit('update:open', val)">
    <ui-dialog-content class="max-w-md max-h-[85dvh] flex flex-col gap-0 p-0" @open-auto-focus.prevent>
      <ui-dialog-header class="px-6 pt-6 pb-3">
        <ui-dialog-title>{{ title }}</ui-dialog-title>
        <ui-dialog-description class="text-sm text-muted-foreground" :class="{ 'sr-only': hideDescription }">
          {{ description }}
        </ui-dialog-description>
      </ui-dialog-header>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-1">
        <slot />
      </div>
      <ui-dialog-footer class="mt-3 flex-row items-center gap-2 border-t px-6 py-4">
        <slot name="footer" />
      </ui-dialog-footer>
    </ui-dialog-content>
  </ui-dialog>

  <ui-drawer v-else :open="open" @update:open="(val) => emit('update:open', val)">
    <ui-drawer-content class="data-[vaul-drawer-direction=bottom]:max-h-[92dvh]" @open-auto-focus.prevent>
      <div class="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
        <ui-drawer-header class="pb-2">
          <ui-drawer-title class="text-lg font-semibold">
            {{ title }}
          </ui-drawer-title>
          <ui-drawer-description class="text-sm text-muted-foreground" :class="{ 'sr-only': hideDescription }">
            {{ description }}
          </ui-drawer-description>
        </ui-drawer-header>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">
          <slot />
        </div>
        <ui-drawer-footer class="shrink-0 flex-row items-center border-t pt-3">
          <slot name="footer" />
        </ui-drawer-footer>
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
