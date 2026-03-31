export default defineNuxtPlugin(() => {
  const router = useRouter()
  const { logEvent } = useAnalytics()

  router.afterEach((to) => {
    logEvent('page_view', {
      page_path: to.fullPath,
      page_title: to.meta.title as string || document.title,
    })
  })
})
