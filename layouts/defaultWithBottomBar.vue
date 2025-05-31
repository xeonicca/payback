<script setup lang="ts">
const { tripId } = useRoute().params
const { trip } = useTrip(tripId as string)
</script>

<template>
  <div class="min-h-screen bg-slate-200">
    <navbar />
    <main class="container mx-auto px-6 pb-30">
      <slot />
    </main>
    
  </div>
  <trip-bottom-bar v-if="tripId" :trip-id="tripId" />
</template>
