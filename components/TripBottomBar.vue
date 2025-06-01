<script setup lang="ts">
const props = defineProps<{
  tripId: string
}>()

const { tripMembers, hostMember } = useTripMembers(props.tripId)
const { trip } = useTrip(props.tripId)

const openUploadReceiptDrawer = ref(false)
</script>

<template>
  <div class="fixed bottom-safe-4 bottom-4 left-1/2 -translate-x-1/2 bg-slate-700 rounded-2xl shadow-lg flex items-center justify-between px-6 py-3 w-[calc(100vw_-_4rem)]">
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${tripId}`">
      <icon name="lucide:house" size="20" class="text-slate-200" />
    </nuxt-link>
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${tripId}/charts`">
      <icon name="lucide:chart-column-big" size="20" class="text-slate-200" />
    </nuxt-link>
    <div
      class="flex items-center justify-center w-14 h-14 rounded-full bg-amber-500 shadow-lg -mt-8"
      @click="openUploadReceiptDrawer = true"
    >
      <icon v-if="trip" name="lucide:zap" size="24" class="text-white" />
      <icon v-else name="lucide:loader-circle" size="24" class="text-white animate-spin" />
    </div>
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${tripId}/expenses`">
      <icon name="lucide:scroll-text" size="20" class="text-slate-200" />
    </nuxt-link>
    <nuxt-link class="size-10 flex items-center justify-center" :to="`/trips/${tripId}/edit`">
      <icon name="lucide:settings" size="20" class="text-slate-200" />
    </nuxt-link>
  </div>

  <ui-drawer v-if="trip" v-model:open="openUploadReceiptDrawer">
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm">
        <upload-receipt-form
          :trip="trip"
          :trip-members="tripMembers"
          :host-member="hostMember"
          @close="openUploadReceiptDrawer = false"
        />
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
