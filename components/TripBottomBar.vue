<script setup lang="ts">
const props = defineProps<{
  tripId: string
}>()

const route = useRoute()
const { tripMembers, hostMember, currentUserMember } = useTripMembers(props.tripId)
const { trip } = useTrip(props.tripId)
const { canManageExpenses } = useTripCollaborators(props.tripId)

const openExpenseDrawer = ref(false)

const canAddExpense = computed(() => trip.value && !trip.value.archived && canManageExpenses.value)

const navItems = computed(() => [
  { to: `/trips/${props.tripId}`, icon: 'lucide:house', label: '總覽', match: 'trips-tripId' },
  { to: `/trips/${props.tripId}/charts`, icon: 'lucide:chart-column-big', label: '統計', match: 'trips-tripId-charts' },
  { to: `/trips/${props.tripId}/expenses`, icon: 'lucide:scroll-text', label: '支出', match: 'trips-tripId-expenses' },
  { to: `/trips/${props.tripId}/edit`, icon: 'lucide:settings', label: '設定', match: 'trips-tripId-edit' },
])

function isActive(match: string) {
  return String(route.name) === match || String(route.name)?.startsWith(`${match}-`)
}
</script>

<template>
  <!-- ===== Mobile/Tablet: Bottom bar ===== -->
  <div class="lg:hidden relative">
    <div class="fixed bottom-safe-offset-4 left-1/2 -translate-x-1/2 bg-slate-700 rounded-2xl shadow-lg flex items-center justify-between px-6 py-2 w-[calc(100vw_-_4rem)] z-10">
      <nuxt-link
        v-for="(item, idx) in navItems.slice(0, 2)"
        :key="item.to"
        :to="item.to"
        class="size-10 flex items-center justify-center rounded-lg transition-colors"
        :class="isActive(item.match) ? 'text-white bg-slate-600' : 'text-slate-400'"
      >
        <Icon :name="item.icon" :size="20" />
      </nuxt-link>

      <!-- Center action button -->
      <button
        type="button"
        :disabled="!canAddExpense"
        class="flex items-center justify-center w-14 h-14 rounded-full shadow-lg -mt-8 transition-colors"
        :class="canAddExpense ? 'bg-amber-500 text-white' : 'bg-gray-400 text-white cursor-not-allowed'"
        :aria-label="trip?.archived ? '行程已封存' : '新增支出'"
        @click="canAddExpense && (openExpenseDrawer = true)"
      >
        <Icon v-if="trip?.archived" name="lucide:archive" :size="24" />
        <Icon v-else-if="!canManageExpenses" name="lucide:lock" :size="24" />
        <Icon v-else-if="trip" name="lucide:zap" :size="24" />
        <Icon v-else name="lucide:loader-circle" :size="24" class="animate-spin" />
      </button>

      <nuxt-link
        v-for="item in navItems.slice(2)"
        :key="item.to"
        :to="item.to"
        class="size-10 flex items-center justify-center rounded-lg transition-colors"
        :class="isActive(item.match) ? 'text-white bg-slate-600' : 'text-slate-400'"
      >
        <Icon :name="item.icon" :size="20" />
      </nuxt-link>
    </div>

    <!-- Gradient overlay -->
    <div class="fixed bottom-0 left-0 right-0 h-20 pointer-events-none bg-gradient-to-t from-slate-400/60 to-transparent" />
  </div>

  <!-- ===== Desktop: Floating pill buttons ===== -->
  <div class="hidden lg:flex fixed right-4 bottom-safe-offset-4 z-10 flex-col items-end gap-2">
    <div class="flex flex-col items-end gap-1.5">
      <nuxt-link
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2 pl-3 pr-2.5 py-1.5 rounded-full shadow-md border transition-colors"
        :class="isActive(item.match)
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-foreground border-border hover:bg-muted'"
      >
        <span class="text-xs font-medium">{{ item.label }}</span>
        <Icon :name="item.icon" :size="16" />
      </nuxt-link>
    </div>

    <button
      v-if="canAddExpense"
      type="button"
      aria-label="新增支出"
      class="size-12 rounded-full bg-amber-500 hover:bg-amber-400 text-white shadow-lg flex items-center justify-center transition-colors"
      @click="openExpenseDrawer = true"
    >
      <Icon name="lucide:zap" :size="22" />
    </button>
  </div>

  <ClientOnly>
    <add-expense-drawer
      v-if="trip"
      v-model:open="openExpenseDrawer"
      :trip="trip"
      :trip-members="tripMembers"
      :default-payer-member="currentUserMember || hostMember"
    />
  </ClientOnly>
</template>
