<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  confirmVariant?: 'default' | 'destructive'
  isLoading?: boolean
}>(), {
  confirmLabel: '確定',
  confirmVariant: 'default',
  isLoading: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
}>()

const isDesktop = useMediaQuery('(min-width: 1024px)')
</script>

<template>
  <ClientOnly>
    <ui-dialog v-if="isDesktop" :open="props.open" @update:open="emit('update:open', $event)">
      <ui-dialog-content class="max-w-md" :show-close-button="false">
        <ui-dialog-header>
          <ui-dialog-title>{{ props.title }}</ui-dialog-title>
          <ui-dialog-description v-if="props.description">
            {{ props.description }}
          </ui-dialog-description>
        </ui-dialog-header>
        <slot />
        <ui-dialog-footer>
          <ui-button type="button" variant="outline" :disabled="props.isLoading" @click="emit('update:open', false)">
            取消
          </ui-button>
          <ui-button type="button" :variant="props.confirmVariant" :disabled="props.isLoading" @click="emit('confirm')">
            <Icon v-if="props.isLoading" name="lucide:loader-2" :size="16" class="mr-2 animate-spin" />
            {{ props.confirmLabel }}
          </ui-button>
        </ui-dialog-footer>
      </ui-dialog-content>
    </ui-dialog>

    <ui-drawer v-else :open="props.open" @update:open="emit('update:open', $event)">
      <ui-drawer-content>
        <div class="mx-auto w-full max-w-md p-6">
          <div class="space-y-6">
            <div class="text-center">
              <ui-drawer-title class="text-xl font-bold text-foreground m-0">
                {{ props.title }}
              </ui-drawer-title>
              <ui-drawer-description v-if="props.description" class="text-sm text-muted-foreground m-0 mt-2">
                {{ props.description }}
              </ui-drawer-description>
            </div>
            <slot />
            <div class="flex gap-3">
              <ui-button type="button" variant="outline" class="flex-1" :disabled="props.isLoading" @click="emit('update:open', false)">
                取消
              </ui-button>
              <ui-button type="button" :variant="props.confirmVariant" class="flex-1" :disabled="props.isLoading" @click="emit('confirm')">
                <Icon v-if="props.isLoading" name="lucide:loader-2" :size="16" class="mr-2 animate-spin" />
                {{ props.confirmLabel }}
              </ui-button>
            </div>
          </div>
        </div>
      </ui-drawer-content>
    </ui-drawer>
  </ClientOnly>
</template>
