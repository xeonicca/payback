<script setup lang="ts">
import type { Trip } from '@/types'
import { doc } from 'firebase/firestore'
import { toast } from 'vue-sonner'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

const db = useFirestore()
const { tripId } = useRoute().params

const trip = useDocument<Trip>(doc(db, 'trips', tripId as string).withConverter(tripConverter))
const { tripMembers, hostMember } = useTripMembers(tripId as string)

const openUploadReceiptDrawer = ref(false)

if (!trip.value) {
  toast.error('行程不存在')
  navigateTo('/trips')
}
</script>

<template>
  <h1 class="text-2xl font-bold text-indigo-700">
    {{ trip?.name }}
  </h1>
  <div v-for="member in tripMembers" :key="member.id">
    <div class="flex items-center gap-2">
      <div class="text-sm text-gray-500">
        {{ member.name }}
      </div>
    </div>
  </div>

  <ui-drawer>
    <ui-drawer-trigger as-child>
      <ui-button variant="outline" class="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors flex items-center justify-center">
        <Icon name="mdi:plus" size="24" />
      </ui-button>
    </ui-drawer-trigger>
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm">
        <add-trip-expense-form :trip="trip!" :trip-members="tripMembers" :host-member="hostMember!" />
      </div>
    </ui-drawer-content>
  </ui-drawer>

  <ui-drawer v-model:open="openUploadReceiptDrawer">
    <ui-drawer-trigger as-child>
      <ui-button variant="outline" class="fixed bottom-22 right-6 w-14 h-14 bg-amber-500 text-white rounded-full shadow-lg hover:bg-amber-700 transition-colors flex items-center justify-center">
        <Icon name="lucide:zap" size="24" />
      </ui-button>
    </ui-drawer-trigger>
    <ui-drawer-content>
      <div class="mx-auto w-full max-w-sm">
        <upload-receipt-form
          :trip="trip!"
          :trip-members="tripMembers"
          :host-member="hostMember!"
          @close="openUploadReceiptDrawer = false"
        />
      </div>
    </ui-drawer-content>
  </ui-drawer>
</template>
