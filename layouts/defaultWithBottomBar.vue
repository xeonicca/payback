<script setup lang="ts">
const route = useRoute()

const tripId = computed(() => {
  return route.params.tripId as string | undefined
})
</script>

<template>
  <div class="min-h-screen bg-slate-200">
    <trip-navbar />

    <div v-if="tripId" class="container mx-auto px-6 pt-4">
      <guest-upgrade-banner :trip-id="tripId" />
    </div>

    <main class="container mx-auto px-6 pb-30 lg:pb-20">
      <slot />
    </main>
  </div>
  <back-to-top-button />
  <ClientOnly>
    <trip-bottom-bar v-if="tripId" :trip-id="tripId as string" />
  </ClientOnly>
</template>
