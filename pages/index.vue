<script setup lang="ts">
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

const router = useRouter()
const searchTerm = ref('')
const db = useFirestore()
const sessionUser = useSessionUser()

// Fetch trips client-side only using useAsyncData
const { data: myTrips, error: tripsError, pending: tripsPending } = await useAsyncData(
  'my-trips',
  async () => {
    if (!sessionUser.value?.uid)
      return []

    const tripsQuery = query(
      collection(db, 'trips'),
      where('collaboratorUserIds', 'array-contains', sessionUser.value.uid),
      orderBy('createdAt', 'desc'),
    ).withConverter(tripConverter)

    const snapshot = await getDocs(tripsQuery)
    return snapshot.docs.map(doc => doc.data())
  },
  {
    server: false, // Client-side only
    lazy: true, // Non-blocking
  },
)

// Watch for errors and log them
watch(tripsError, (error) => {
  if (error) {
    console.error('Firestore Query Error:', error)
    console.error('Error message:', error.message)

    if (error.message?.includes('index')) {
      console.error('CREATE INDEX: Check the error message above for the Firebase Console link to create the index')
    }
  }
}, { immediate: true })

const trips = computed(() => myTrips.value || [])

function navigateTo(path: string) {
  router.push(path)
}

// Split active and archived trips
const activeTrips = computed(() => {
  const list = trips.value.filter(t => !t.archived)
  if (!searchTerm.value)
    return list
  return list.filter(t => t?.name?.toLowerCase().includes(searchTerm.value.toLowerCase()))
})

const archivedTrips = computed(() => {
  const list = trips.value.filter(t => t.archived)
  if (!searchTerm.value)
    return list
  return list.filter(t => t?.name?.toLowerCase().includes(searchTerm.value.toLowerCase()))
})

const showSearch = computed(() => trips.value.length >= 4)
const showArchived = ref(false)

definePageMeta({
  middleware: ['auth'],
})
</script>

<template>
  <div class="min-h-screen">
    <!-- Error Display -->
    <alert-banner v-if="tripsError" icon="lucide:alert-circle" title="Firestore Error" variant="error" class="mb-6">
      <p class="m-0 mb-2 font-mono">
        {{ tripsError.message }}
      </p>
      <p class="text-xs m-0">
        Check the browser console (F12) for the link to create the missing index.
      </p>
    </alert-banner>

    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center justify-between gap-4 mb-4">
        <h1 class="text-xl font-bold text-foreground">
          我的行程
        </h1>
        <ui-button
          size="sm"
          @click="navigateTo('/trips/new')"
        >
          <Icon name="lucide:plus" size="16" />
          新增行程
        </ui-button>
      </div>

      <!-- Search (only show with 4+ trips) -->
      <div v-if="showSearch" class="relative">
        <Icon name="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <ui-input
          v-model="searchTerm"
          type="text"
          placeholder="搜尋行程..."
          class="pl-10 w-full"
        />
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="tripsPending" class="flex justify-center py-20">
      <loading-spinner />
    </div>

    <!-- Empty State -->
    <empty-state
      v-else-if="!tripsError && activeTrips.length === 0 && archivedTrips.length === 0"
      :icon="searchTerm ? 'lucide:search' : 'lucide:map-pin'"
      :title="searchTerm ? '找不到行程' : '還沒有行程'"
      :description="searchTerm ? '試試其他搜尋條件' : '建立你的第一個行程，開始記帳分帳'"
    >
      <ui-button v-if="!searchTerm" @click="navigateTo('/trips/new')">
        <Icon name="lucide:plus" size="16" />
        新增行程
      </ui-button>
    </empty-state>

    <template v-else-if="!tripsError">
      <!-- Active Trip Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div
          v-for="trip in activeTrips"
          :key="trip.id"
          class="group bg-card rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer border border-border hover:border-slate-300"
          @click="navigateTo(`/trips/${trip.id}`)"
        >
          <div class="p-5">
            <!-- Trip name -->
            <h3 class="text-base font-semibold text-foreground truncate mb-1 leading-snug">
              {{ trip.name }}
            </h3>

            <!-- Owner for shared trips -->
            <p v-if="trip.userId !== sessionUser?.uid && trip.ownerDisplayName" class="text-xs text-muted-foreground mb-3">
              由 {{ trip.ownerDisplayName }} 建立
            </p>
            <div v-else class="mb-3" />

            <!-- Total + currency -->
            <div class="flex items-baseline gap-1.5 mb-4">
              <span class="text-2xl font-bold font-mono text-foreground tracking-tight">
                {{ parseFloat((trip.enabledTotalExpenses * trip.exchangeRate).toFixed(0)).toLocaleString() }}
              </span>
              <span class="text-xs font-medium text-muted-foreground">TWD</span>
              <template v-if="trip.tripCurrency !== 'TWD'">
                <span class="text-muted-foreground/40 mx-0.5">/</span>
                <span class="text-sm font-mono text-muted-foreground">
                  {{ parseFloat(trip.enabledTotalExpenses.toFixed(0)).toLocaleString() }}
                </span>
                <span class="text-xs text-muted-foreground/60">{{ trip.tripCurrency }}</span>
              </template>
            </div>

            <!-- Footer: members + meta -->
            <div class="flex items-center justify-between pt-3 border-t border-border">
              <div class="flex items-center gap-2">
                <!-- Member emoji avatars -->
                <div v-if="trip.memberEmojis && trip.memberEmojis.length > 0" class="flex -space-x-1">
                  <member-avatar
                    v-for="(emoji, i) in trip.memberEmojis.slice(0, 4)"
                    :key="i"
                    :emoji="emoji"
                    size="sm"
                  />
                  <span
                    v-if="trip.memberCount > 4"
                    class="size-6 text-xs font-medium bg-muted text-muted-foreground rounded-full inline-flex items-center justify-center"
                  >
                    +{{ trip.memberCount - 4 }}
                  </span>
                </div>
                <!-- Fallback: expense count -->
                <span class="text-xs text-muted-foreground flex items-center gap-1">
                  <Icon name="lucide:receipt" class="w-3 h-3" />
                  {{ trip.expenseCount }} 筆
                </span>
              </div>
              <Icon name="lucide:chevron-right" class="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
            </div>
          </div>
        </div>
      </div>

      <!-- Archived section -->
      <div v-if="archivedTrips.length > 0" class="mt-8">
        <button
          class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          @click="showArchived = !showArchived"
        >
          <Icon
            name="lucide:chevron-right"
            class="w-4 h-4 transition-transform"
            :class="showArchived ? 'rotate-90' : ''"
          />
          已封存 ({{ archivedTrips.length }})
        </button>

        <div v-if="showArchived" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <div
            v-for="trip in archivedTrips"
            :key="trip.id"
            class="group bg-card rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer border border-border hover:border-slate-300 opacity-60 hover:opacity-100"
            @click="navigateTo(`/trips/${trip.id}`)"
          >
            <div class="p-5">
              <div class="flex items-start gap-2 mb-3">
                <h3 class="text-base font-semibold text-foreground truncate flex-1 leading-snug">
                  {{ trip.name }}
                </h3>
                <ui-badge variant="secondary" class="text-xs shrink-0">
                  已封存
                </ui-badge>
              </div>

              <div class="flex items-baseline gap-1.5 mb-4">
                <span class="text-xl font-bold font-mono text-foreground tracking-tight">
                  {{ parseFloat((trip.enabledTotalExpenses * trip.exchangeRate).toFixed(0)).toLocaleString() }}
                </span>
                <span class="text-xs font-medium text-muted-foreground">TWD</span>
              </div>

              <div class="flex items-center justify-between pt-3 border-t border-border">
                <span class="text-xs text-muted-foreground">
                  {{ trip.expenseCount }} 筆支出
                </span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
