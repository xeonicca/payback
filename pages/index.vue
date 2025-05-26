<script setup lang="ts">
import { collection } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'

const db = useFirestore()
const trips = useCollection(collection(db, 'trips'), {
  once: true,
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
      <h1 class="text-xl font-bold text-primary">
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
        class="transition-all duration-200 hover:shadow-lg hover:scale-[1.02]"
      >
        <ui-card-header class="flex flex-row items-start justify-between space-y-0 pb-2">
          <ui-card-title class="text-lg font-semibold">
            <div class="flex items-center gap-2">
              <Icon name="lucide-map-pin" class="text-gray-500" />
              <span class="text-dark">{{ trip.name }}</span>
            </div>
          </ui-card-title>
          <ui-badge>
            {{ trip.tripCurrency }}
          </ui-badge>
        </ui-card-header>

        <ui-card-content class="space-y-2">
          <div class="flex items-center gap-2">
            <Icon name="lucide-calendar" class="text-gray-500" />
            <span>{{ trip.createdAt.toDate().toLocaleDateString() }}</span>
          </div>
          <!-- <div class="flex items-center gap-2">
            <ui-icon name="i-lucide-receipt" class="text-gray-500" />
            <span>${{ trip.totalExpenses.toLocaleString() }}</span>
          </div> -->
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
