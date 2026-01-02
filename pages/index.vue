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
const searchTerm = ref('')

function navigateTo(path: string) {
  router.push(path)
}

const filteredTrips = computed(() => {
  if (!searchTerm.value) return trips.value
  return trips.value.filter(trip =>
    trip.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
  )
})

definePageMeta({
  middleware: ['auth'],
})
</script>

<template>
  <div class="min-h-screen">
    <!-- Header Section -->
    <header class="mb-10">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 class="text-3xl font-bold text-gray-900">
          行程一覽
        </h1>
        <ui-button
          class="w-fit"
          @click="navigateTo('/trips/new')"
        >
          <Icon name="lucide-plus" size="20" />
          新增行程
        </ui-button>
      </div>

      <!-- Search Bar -->
      <div class="relative max-w-md">
        <Icon name="lucide-search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <ui-input
          v-model="searchTerm"
          type="text"
          placeholder="搜尋行程..."
          class="pl-10 w-full"
        />
      </div>
    </header>

    <!-- Empty State -->
    <div v-if="filteredTrips.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <Icon name="lucide-search" class="w-8 h-8 text-gray-400" />
      </div>
      <h2 class="text-xl font-semibold text-gray-900 mb-2">
        找不到行程
      </h2>
      <p class="text-gray-500 mb-6">
        試試調整搜尋條件或新增一個行程
      </p>
      <ui-button @click="navigateTo('/trips/new')">
        <Icon name="lucide-plus" size="20" />
        新增行程
      </ui-button>
    </div>

    <!-- Trip Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      <div
        v-for="trip in filteredTrips"
        :key="trip.id"
        class="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer border border-gray-100 hover:border-indigo-200"
        @click="navigateTo(`/trips/${trip.id}`)"
      >
        <!-- Card Content -->
        <div class="p-6">
          <div class="mb-4">
            <div class="flex items-center gap-2 mb-2">
              <h3 class="text-lg font-semibold text-gray-900 truncate group-hover:text-indigo-600 transition-colors flex-1">
                {{ trip.name }}
              </h3>
              <ui-badge v-if="trip.archived" variant="secondary" class="text-xs shrink-0">
                <Icon name="lucide:archive" class="w-3 h-3 mr-1" />
                已封存
              </ui-badge>
            </div>
            <p class="text-xs text-gray-500 font-medium flex items-center gap-1">
              <Icon name="lucide-calendar" class="w-3.5 h-3.5" />
              {{ trip.createdAtString }}
            </p>
          </div>

          <div class="flex items-end justify-between pt-4 border-t border-gray-100">
            <div>
              <p class="text-xs text-gray-500 mb-1">
                總支出
              </p>
              <!-- Show TWD as primary -->
              <div class="flex items-baseline gap-2">
                <span class="text-xs font-semibold text-gray-600">TWD</span>
                <span class="text-2xl font-bold text-gray-900">
                  {{ parseFloat((trip.enabledTotalExpenses * trip.exchangeRate).toFixed(2)).toLocaleString() }}
                </span>
              </div>
              <!-- Show original currency below if different from TWD -->
              <div v-if="trip.tripCurrency !== 'TWD'" class="mt-1 flex items-baseline gap-1.5">
                <span class="text-xs text-gray-500">{{ trip.tripCurrency }}</span>
                <span class="text-sm text-gray-600">
                  {{ parseFloat(trip.enabledTotalExpenses.toFixed(2)).toLocaleString() }}
                </span>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1">
              <div class="flex items-center gap-2 text-sm text-indigo-600 font-medium group-hover:gap-3 transition-all">
                查看
                <Icon name="lucide-arrow-right" class="w-4 h-4" />
              </div>
              <p class="text-xs text-gray-500">
                {{ trip.expenseCount }} 筆支出
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
