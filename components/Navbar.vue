<script setup lang="ts">
const { logout } = useLogin()
const sessionUser = useSessionUser()
const router = useRouter()

async function handleSignOut() {
  try {
    await logout()
    await router.push('/login')
  }
  catch (error) {
    console.error('Error signing out:', error)
  }
}

const dropdownItems = [
  {
    label: 'Sign out',
    icon: 'i-lucide-log-out',
    click: handleSignOut,
  },
]
</script>

<template>
  <nav
    class="border-0
      bg-gradient-to-b
      from-slate-700
      from-10%
      to-slate-200
      via-slate-300
      via-80%
      text-white pt-2 px-4 pb-4"
  >
    <div class="container mx-auto flex justify-between items-center">
      <NuxtLink to="/" class="flex items-center gap-2 hover:text-blue-200">
        <NuxtImg
          src="/logo-transparent.png"
          alt="Payback Logo"
          width="100"
          height="100"
          class="rounded-full"
          loading="eager"
        />
      </NuxtLink>
      <ul class="flex place-items-center space-x-4">
        <li class="flex items-center">
          <NuxtLink to="/" class="hover:text-blue-200 p-2 rounded-full hover:bg-blue-500 transition-colors" title="Dashboard">
            <Icon name="lucide:home" size="20" />
          </NuxtLink>
        </li>
        <li class="flex items-center">
          <NuxtLink to="/expenses/add" class="hover:text-blue-200 p-2 rounded-full hover:bg-blue-500 transition-colors" title="Add Expense">
            <Icon name="lucide:receipt" size="20" />
          </NuxtLink>
        </li>
        <li class="flex items-center">
          <NuxtLink to="/trips/add" class="hover:text-blue-200 p-2 rounded-full hover:bg-blue-500 transition-colors" title="Add Trip">
            <Icon name="lucide:plane" size="20" />
          </NuxtLink>
        </li>
        <li class="flex items-center">
          <template v-if="sessionUser">
            <ui-avatar>
              <ui-avatar-image :src="sessionUser.photoURL || ''" :alt="sessionUser.displayName || 'User'" />
              <ui-avatar-fallback>{{ sessionUser.displayName?.charAt(0) || sessionUser.email?.charAt(0) || 'U' }}</ui-avatar-fallback>
            </ui-avatar>
          </template>
          <NuxtLink v-else to="/login" class="hover:text-blue-200">
            Login
          </NuxtLink>
        </li>
      </ul>
    </div>
  </nav>
</template>
