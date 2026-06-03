export default defineNuxtPlugin(() => {
  const router = useRouter()
  const { logEvent, setUser, clearUser } = useAnalytics()
  const sessionUser = useSessionUser()

  router.afterEach((to) => {
    logEvent('page_view', {
      page_path: to.fullPath,
      page_title: to.meta.title as string || document.title,
    })
  })

  watch(sessionUser, (user) => {
    if (user)
      setUser(user)
    else
      clearUser()
  }, { immediate: true })
})
