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

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <ui-card
        v-for="trip in trips"
        :key="trip.id"
        class="transition-all duration-200 hover:shadow-lg hover:scale-[1.02] rounded-sm"
      >
        <ui-card-header class="flex flex-row items-start justify-between space-y-0 pb-2">
          <ui-card-title class="text-lg font-semibold">
            <div class="flex items-center gap-2">
              <Icon name="lucide-map-pin" class="text-indigo-700" />
              <span class="text-indigo-700">{{ trip.name }}</span>
            </div>
          </ui-card-title>
          <ui-badge>
            {{ trip.tripCurrency }}
          </ui-badge>
        </ui-card-header>

        <ui-card-content class="space-y-2">
          <div class="flex items-center gap-2">
            <Icon name="lucide-calendar" class="text-gray-500" />
            <span class="text-sm text-gray-500">{{ trip.createdAtString }}</span>
          </div>
          <div class="flex items-center gap-2">
            <Icon name="lucide:receipt" class="text-gray-500" />
            <span class="text-base font-extrabold">{{ trip.tripCurrency }} {{ trip.enabledTotalExpenses.toLocaleString() }}</span>
          </div>
        </ui-card-content>

        <ui-card-footer class="flex justify-end gap-2">
          <nuxt-link :to="`/trips/${trip.id}`">
            <ui-button
              color="gray"
              variant="outline"
            >
              <Icon name="lucide-eye" class="text-gray-500" />
              查看
            </ui-button>
          </nuxt-link>
          <!-- <nuxt-link :to="`/trips/${trip.id}/edit`">
            <ui-button
              color="primary"
              variant="ghost"
              icon="i-lucide-edit"
            >
              Edit
            </ui-button>
          </nuxt-link> -->
        </ui-card-footer>
      </ui-card>
    </div>
  </div>
</template>
