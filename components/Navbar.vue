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

// Check if we're on a trip detail page
const tripId = computed(() => route.params.tripId as string | undefined)
const isOnTripPage = computed(() => !!tripId.value)

// Fetch trip name if on trip page
const db = useFirestore()
const tripDocRef = computed(() => {
  return tripId.value ? doc(db, 'trips', tripId.value).withConverter(tripConverter) : null
})
const trip = useDocument<Trip>(tripDocRef)

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
    class="border-0
      bg-gradient-to-b
      scroll-mt-0
      from-slate-700
      from-10%
      to-slate-200
      via-slate-300
      via-80%
      text-white pt-2 px-4 pb-4"
  >
    <div class="container mx-auto flex justify-between items-center">
      <!-- Logo and Breadcrumb -->
      <div class="flex items-center gap-3">
        <NuxtLink to="/" class="flex items-center gap-2 hover:text-blue-200 flex-shrink-0">
          <NuxtImg
            src="/logo-transparent.png"
            alt="Payback Logo"
            width="80"
            height="80"
            class="rounded-full"
            loading="eager"
          />
        </NuxtLink>

        <!-- Breadcrumb when on trip pages -->
        <div v-if="isOnTripPage && trip" class="flex items-center gap-2 text-sm">
          <Icon name="lucide:chevron-right" size="16" class="text-blue-200" />
          <NuxtLink
            :to="`/trips/${tripId}`"
            class="hover:text-blue-200 font-medium truncate max-w-[200px] transition-colors"
          >
            {{ trip.name }}
          </NuxtLink>
        </div>
      </div>

      <ul class="flex place-items-center space-x-4">
        <li class="flex items-center">
          <ClientOnly>
            <template v-if="sessionUser">
              <ui-dropdown-menu>
                <ui-dropdown-menu-trigger as-child>
                  <button class="rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-700">
                    <ui-avatar class="cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all">
                      <ui-avatar-image :src="sessionUser.photoURL || ''" :alt="sessionUser.displayName || 'User'" />
                      <ui-avatar-fallback>{{ sessionUser.displayName?.charAt(0) || sessionUser.email?.charAt(0) || 'U' }}</ui-avatar-fallback>
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
              <NuxtLink to="/login" class="hover:text-blue-200">
                Login
              </NuxtLink>
            </template>
          </ClientOnly>
        </li>
      </ul>
    </div>
  </nav>
</template>
