<script setup lang="ts">
import { collection, orderBy, query } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

const db = useFirestore()
const tripQuery = query(collection(db, 'trips'), orderBy('createdAt', 'desc'))
const trips = useCollection(tripQuery.withConverter(tripConverter), {
  once: true,
  ssrKey: 'trips-index',
})

const router = useRouter()
function navigateTo(path: string) {
  router.push(path)
}

definePageMeta({
  middleware: ['auth'],
})
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-xl font-extrabold text-primary">
        行程一覽
      </h1>
      <ui-button
        color="primary"
        size="sm"
        @click="navigateTo('/trips/new')"
      >
        <Icon name="lucide-plus" size="20" />
        新增行程
      </ui-button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="trip in trips"
        :key="trip.id"
        class="group relative bg-white rounded-xl shadow-sm hover:shadow-xl hover:border-indigo-200 transition-all duration-300 overflow-hidden cursor-pointer"
        @click="navigateTo(`/trips/${trip.id}`)"
      >
        <!-- Gradient Header -->
        <div class="h-2 bg-gradient-to-r from-blue-500 via-blue-500 to-indigo-700" />

        <!-- Content -->
        <div class="p-6">
          <!-- Trip Name and Currency -->
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Icon name="lucide-map-pin" class="text-indigo-600" size="20" />
              </div>
              <div>
                <h3 class="font-semibold text-gray-900 text-lg leading-tight group-hover:text-indigo-600 transition-colors">
                  {{ trip.name }}
                </h3>
              </div>
            </div>
            <div class="px-2.5 py-1 bg-gray-100 rounded-full">
              <span class="text-xs font-medium text-gray-600">{{ trip.tripCurrency }}</span>
            </div>
          </div>

          <!-- Trip Stats -->
          <div class="space-y-3 mb-6">
            <div class="flex items-center gap-3">
              <Icon name="lucide-calendar" class="text-gray-400" size="16" />
              <span class="text-sm text-gray-600">{{ trip.createdAtString }}</span>
            </div>
            <div class="flex items-center gap-3">
              <Icon name="lucide-receipt" class="text-gray-400" size="16" />
              <div class="flex items-baseline gap-1">
                <span class="text-xl font-bold text-gray-900">{{ trip.enabledTotalExpenses.toLocaleString() }}</span>
                <span class="text-sm text-gray-500">{{ trip.tripCurrency }}</span>
              </div>
            </div>
          </div>

          <!-- Action Area -->
          <div class="flex items-center justify-between pt-4 border-t border-gray-100">
            <div class="flex items-center gap-2 text-sm text-gray-500">
              <Icon name="lucide-eye" size="14" />
              <span>查看詳情</span>
            </div>
            <Icon name="lucide-arrow-right" class="text-gray-400 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" size="16" />
          </div>
        </div>

        <!-- Hover Effect Overlay -->
        <div class="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      </div>
    </div>
  </div>
</template>
