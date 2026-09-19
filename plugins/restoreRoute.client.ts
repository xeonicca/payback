import { Capacitor } from '@capacitor/core'
import { getAppLinkPath, getSafeReturnPath } from '~/utils/app-links'

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const config = useRuntimeConfig()
  const STORAGE_KEY = 'payback:lastRoute'

  // Capture before initial router navigation so startup cannot overwrite it.
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  }
  catch { /* Storage can be unavailable in private browsers. */ }

  nuxtApp.hook('app:mounted', async () => {
    if (Capacitor.isNativePlatform()) {
      const { App } = await import('@capacitor/app')
      const openLink = async (url: string) => {
        const path = getAppLinkPath(url, config.public.siteUrl)
        if (path)
          await router.push(path)
      }
      const listener = await App.addListener('appUrlOpen', ({ url }) => {
        void openLink(url)
      })
      nuxtApp.vueApp.onUnmount(() => {
        void listener.remove()
      })
      const launch = await App.getLaunchUrl()
      const launchPath = launch && getAppLinkPath(launch.url, config.public.siteUrl)
      if (launchPath) {
        await router.replace(launchPath)
        return
      }
    }
    // Explicit links (including login redirects) always take precedence.
    if (router.currentRoute.value.fullPath === '/' && saved) {
      const path = getSafeReturnPath(saved)
      if (path !== '/')
        await router.replace(path)
    }
  })

  // Save route on every navigation
  router.afterEach((to) => {
    if (to.path !== '/login') {
      try {
        localStorage.setItem(STORAGE_KEY, to.fullPath)
      }
      catch { /* Route persistence is optional. */ }
    }
  })
})
