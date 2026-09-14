export default defineNuxtPlugin(async () => {
  const { checkUser, setSession, clearSession } = useLogin()
  const sessionUser = useSessionUser()
  const { getCurrentUser } = await import('vuefire')

  const [data, user] = await Promise.all([
    checkUser(),
    getCurrentUser().catch(() => null),
  ])

  if (data && user?.uid === data.uid) {
    sessionUser.value = data
  }
  else if (user) {
    // Session cookie missing, expired or for another account — re-mint it from the
    // Firebase refresh token in IndexedDB. Covers both guests who reopened a
    // LINE/WhatsApp WebView and Google users returning after the session cookie elapsed.
    try {
      await setSession(user)
    }
    catch {
      // Recovery failed — user will need to log in again
    }
  }
  else if (data) {
    // Session cookie outlived the Firebase client login (e.g. Safari wipes IndexedDB
    // after 7 days idle). Firestore rules need the client login, so every query would
    // fail with "Missing or insufficient permissions" — drop the session and let the
    // auth middleware send the user to /login.
    await clearSession()
  }

  // Return object so Nuxt waits for this plugin before running route middleware
  return {}
})
