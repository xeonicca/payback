export default defineNuxtPlugin(async () => {
  const { checkUser, setSession } = useLogin()
  const sessionUser = useSessionUser()

  const data = await checkUser()

  if (data) {
    sessionUser.value = data
  }
  else {
    // Session cookie missing — try to recover from persisted anonymous Firebase user
    // This handles the case where a guest closed the in-app browser (LINE/WhatsApp)
    // and reopened the link later. browserLocalPersistence keeps the anonymous user
    // in IndexedDB even after the session cookie expires.
    try {
      const { getCurrentUser } = await import('vuefire')
      const user = await getCurrentUser()
      if (user?.isAnonymous) {
        await setSession(user)
      }
    }
    catch {
      // Recovery failed — guest will need to rejoin
    }
  }

  // Return object so Nuxt waits for this plugin before running route middleware
  return {}
})
