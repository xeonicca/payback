<script setup lang="ts">
import type { Trip } from '~/types'

defineProps<{
  trip: Trip
}>()

const emit = defineEmits<{
  (e: 'openUploadReceiptDrawer'): void
}>()
</script>

<template>
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-700 rounded-2xl shadow-lg flex items-center justify-between px-6 py-3 w-[350px]">
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${trip.id}`">
      <icon name="lucide:house" size="20" class="text-slate-200" />
    </nuxt-link>
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${trip.id}/charts`">
      <icon name="lucide:chart-column-big" size="20" class="text-slate-200" />
    </nuxt-link>
    <div
      class="flex items-center justify-center w-14 h-14 rounded-full bg-amber-500 shadow-lg -mt-8"
      @click="emit('openUploadReceiptDrawer')"
    >
      <icon name="lucide:zap" size="24" class="text-white" />
    </div>
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${trip.id}/expenses`">
      <icon name="lucide:scroll-text" size="20" class="text-slate-200" />
    </nuxt-link>
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${trip.id}/edit`">
      <icon name="lucide:settings" size="20" class="text-slate-200" />
    </nuxt-link>
  </div>
</template>
