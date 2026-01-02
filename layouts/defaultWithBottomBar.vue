<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const shouldShowBackButton = computed(() => {
  return route.name !== 'trips-tripId'
})

const tripId = computed(() => {
  return route.params.tripId
})

// Fetch trip to check archived status
const trip = computed(() => {
  if (tripId.value) {
    const { trip: tripData } = useTrip(tripId.value as string)
    return tripData.value
  }
  return null
})
</script>

<template>
  <div class="min-h-screen bg-slate-200 pt-safe">
    <keep-alive>
      <navbar />
    </keep-alive>

    <!-- Archived Trip Banner -->
    <div
      v-if="trip?.archived"
      class="sticky top-0 z-40 bg-amber-600 text-white shadow-md"
    >
      <div class="container mx-auto px-6 py-3">
        <div class="flex items-center justify-center gap-2">
          <Icon name="lucide:archive" class="w-4 h-4" />
          <p class="text-sm font-medium m-0">
            此行程已封存 - 無法新增支出或編輯行程資訊
          </p>
        </div>
      </div>
    </div>

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
