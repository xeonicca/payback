export default defineNuxtPlugin(async () => {
  const { checkUser, setSession } = useLogin()
  const sessionUser = useSessionUser()

  const data = await checkUser()

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
      if (user) {
        await setSession(user)
      }
    }
    catch {
      // Recovery failed — user will need to log in again
    }
  }

  // Return object so Nuxt waits for this plugin before running route middleware
  return {}
})
