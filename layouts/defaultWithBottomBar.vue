<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const shouldShowBackButton = computed(() => {
  return route.name !== 'trips-tripId'
})

const tripId = computed(() => {
  return route.params.tripId
})
</script>

<template>
  <div class="min-h-screen bg-slate-200 pt-safe">
    <keep-alive>
      <navbar />
    </keep-alive>
    <main class="container mx-auto px-6 pb-30">
      <ui-button
        v-if="shouldShowBackButton"
        class="text-gray-500 flex items-center gap-1 mb-2 px-0"
        variant="link"
        size="sm"
        @click="router.back()"
      >
        <icon name="lucide:arrow-left" size="16" /> 上一頁
      </ui-button>
      <slot />
    </main>
  </div>
  <trip-bottom-bar v-if="tripId" :trip-id="tripId as string" />
</template>
