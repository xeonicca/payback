export default defineNuxtPlugin(() => {
  const router = useRouter()
  const STORAGE_KEY = 'payback:lastRoute'

  // Restore last route on initial load
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && saved !== '/' && saved !== router.currentRoute.value.fullPath) {
    router.replace(saved)
  }

  // Save route on every navigation
  router.afterEach((to) => {
    if (to.path !== '/login') {
      localStorage.setItem(STORAGE_KEY, to.fullPath)
    }
  })
})
