<script setup lang="ts">
const route = useRoute()
const shouldShowBackButton = computed(() => {
  return route.name !== 'trips-tripId'
})

const tripId = computed(() => {
  return route.params.tripId
})
</script>

<template>
  <div class="min-h-screen bg-slate-200 pt-safe">
    <navbar />
    <main class="container mx-auto px-6 pb-30">
      <nuxt-link v-if="shouldShowBackButton" :to="`/trips/${tripId}`" class="text-sm text-gray-500 flex items-center gap-1 mb-2">
        <icon name="lucide:arrow-left" size="16" /> 回到行程
      </nuxt-link>
      <slot />
    </main>
  </div>
  <trip-bottom-bar v-if="tripId" :trip-id="tripId as string" />
</template>
