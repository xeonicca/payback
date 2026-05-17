import { dlog, dlogEnv } from '~/utils/debugLog'

export default defineNuxtPlugin(async () => {
  dlog('initUser:start', dlogEnv())
  const { checkUser, setSession } = useLogin()
  const sessionUser = useSessionUser()

  const data = await checkUser()
  dlog('initUser:checkUser:done', { hasUser: !!data, uid: data?.uid })

  if (data) {
    sessionUser.value = data
  }
  else {
    // Session cookie missing or expired — try to recover from the Firebase refresh
    // token in IndexedDB. Covers both guests who reopened a LINE/WhatsApp WebView
    // and Google users returning after the 14-day session cookie elapsed.
    try {
      const { getCurrentUser } = await import('vuefire')
      const user = await getCurrentUser()
      dlog('initUser:recover:getCurrentUser', { hasUser: !!user, uid: user?.uid })
      if (user) {
        await setSession(user)
      }
    }
    catch (e) {
      dlog('initUser:recover:error', e)
      // Recovery failed — user will need to log in again
    }
  }

  dlog('initUser:done', { hasSession: !!sessionUser.value })
  // Return object so Nuxt waits for this plugin before running route middleware
  return {}
})
