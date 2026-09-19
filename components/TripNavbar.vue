<script setup lang="ts">
import type { Trip } from '@/types'
import { doc } from 'firebase/firestore'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'
import { toast } from 'vue-sonner'

const sessionUser = useSessionUser()
const router = useRouter()
const route = useRoute()
const { logout } = useLogin()

const tripId = computed(() => route.params.tripId as string | undefined)

const db = useFirestore()
const tripDocRef = computed(() => {
  return tripId.value ? doc(db, 'trips', tripId.value).withConverter(tripConverter) : null
})
const trip = useDocument<Trip>(tripDocRef)

const navRef = useTemplateRef('navRef')

function updateNavHeight() {
  if (navRef.value) {
    document.documentElement.style.setProperty('--navbar-height', `${navRef.value.offsetHeight}px`)
  }
}

onMounted(() => {
  updateNavHeight()
  window.addEventListener('resize', updateNavHeight)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateNavHeight)
})

async function handleLogout() {
  try {
    await logout()
    toast.success('已登出')
    router.push('/login')
  }
  catch (error) {
    console.error('Error logging out:', error)
    toast.error('登出失敗')
  }
}
</script>

<template>
  <nav
    ref="navRef"
    class="sticky top-0 z-20 bg-slate-700 text-white pt-safe px-4 pb-2"
  >
    <div class="container mx-auto flex justify-between items-center h-10">
      <!-- Back + Trip Name -->
      <div class="flex items-center gap-2 min-w-0">
        <NuxtLink to="/" class="flex items-center text-slate-300 hover:text-white transition-colors flex-shrink-0">
          <Icon name="lucide:chevron-left" size="20" />
        </NuxtLink>
        <NuxtLink
          v-if="trip"
          :to="`/trips/${tripId}`"
          class="font-semibold text-sm truncate max-w-[200px] hover:text-blue-200 transition-colors"
        >
          {{ trip.name }}
        </NuxtLink>
      </div>

      <!-- User Avatar -->
      <ClientOnly>
        <template v-if="sessionUser">
          <ui-dropdown-menu>
            <ui-dropdown-menu-trigger as-child>
              <button class="rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-700">
                <ui-avatar class="size-8 cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all">
                  <ui-avatar-image :src="sessionUser.photoURL || ''" :alt="sessionUser.displayName || 'User'" />
                  <ui-avatar-fallback class="text-xs">
                    {{ sessionUser.displayName?.charAt(0) || sessionUser.email?.charAt(0) || 'U' }}
                  </ui-avatar-fallback>
                </ui-avatar>
              </button>
            </ui-dropdown-menu-trigger>
            <ui-dropdown-menu-content align="end" class="w-64">
              <ui-dropdown-menu-label>
                <div class="flex items-center gap-3">
                  <ui-avatar>
                    <ui-avatar-image :src="sessionUser.photoURL || ''" :alt="sessionUser.displayName || 'User'" />
                    <ui-avatar-fallback>{{ sessionUser.displayName?.charAt(0) || sessionUser.email?.charAt(0) || 'U' }}</ui-avatar-fallback>
                  </ui-avatar>
                  <div class="flex flex-col">
                    <p class="text-sm font-medium text-gray-900 m-0">
                      {{ sessionUser.displayName || '未知使用者' }}
                    </p>
                    <p class="text-xs text-gray-500 m-0 truncate">
                      {{ sessionUser.email }}
                    </p>
                  </div>
                </div>
              </ui-dropdown-menu-label>
              <ui-dropdown-menu-separator />
              <ui-dropdown-menu-item @click="handleLogout">
                <Icon name="lucide:log-out" class="w-4 h-4 mr-2" />
                登出
              </ui-dropdown-menu-item>
            </ui-dropdown-menu-content>
          </ui-dropdown-menu>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="hover:text-blue-200 text-sm">
            Login
          </NuxtLink>
        </template>
      </ClientOnly>
    </div>
  </nav>
</template>
