import type {
  AuthError,
  User,
} from 'firebase/auth'
import type { AppUser } from '~/types'
import {
  browserLocalPersistence,
  getIdToken,
  getRedirectResult,
  GoogleAuthProvider,
  inMemoryPersistence,
  linkWithPopup,
  linkWithRedirect,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import { getCurrentUser, useFirebaseAuth } from 'vuefire'
import { useSessionUser } from './useSessionUser'

interface ReturnUser {
  user: AppUser
}

export default function useLogin() {
  const sessionUser = useSessionUser()

  // Only access Firebase on client to avoid SSR initialization issues
  const provider = import.meta.client ? new GoogleAuthProvider() : null
  const authError = ref<AuthError | null>(null)
  const auth = import.meta.client ? useFirebaseAuth()! : null

  const isUserLoggedIn = computed(() => {
    // Only trust the server session for auth state
    // Don't use Firebase Auth's cached currentUser as it persists in IndexedDB
    // even after the server session expires
    return !!sessionUser.value
  })

  const { logEvent } = useAnalytics()

  const setSession = async (user: User) => {
    const token = await getIdToken(user, true)
    await $fetch('/api/__session', {
      method: 'POST',
      body: { token },
    })
    const { user: appUser } = await $fetch<{ user: AppUser }>('/api/auth/me')
    sessionUser.value = appUser
    logEvent('login', { method: 'google' })
  }

  const redirectToGoogleLogin = async () => {
    if (!auth || !provider)
      return
    await setPersistence(auth, inMemoryPersistence)
    try {
      await signInWithRedirect(auth, provider)
    }
    catch (e: unknown) {
      authError.value = e as AuthError
      console.error(e)
    }
  }

  const loginWithGoogle = async () => {
    if (!auth || !provider)
      return null

    if (import.meta.env.MODE === 'development') {
      try {
        const result = await signInWithPopup(auth, provider)
        await setSession(result.user)
      }
      catch (e: unknown) {
        authError.value = e as AuthError
        console.error(e)
      }
    }
    else {
      await redirectToGoogleLogin()
    }

    return sessionUser.value
  }

  const checkRedirectResult = async () => {
    if (!auth)
      return null

    if (import.meta.env.MODE === 'development') {
      try {
        const user = await getCurrentUser()
        if (user)
          await setSession(user)
      }
      catch (e: unknown) {
        // Stale cached Firebase user — clear it so it doesn't block fresh logins
        console.warn('Failed to restore session from cached user, signing out', e)
        await signOut(auth!)
      }
      return sessionUser.value
    }
    try {
      const result = await getRedirectResult(auth)
      if (result?.user) {
        await setSession(result.user)
      }

      return sessionUser.value
    }
    catch (e: unknown) {
      authError.value = e as AuthError
      console.error(e)
      return null
    }
  }

  const logout = async () => {
    if (!auth)
      return

    try {
      // Call server logout endpoint to clear session cookie
      await $fetch('/api/auth/logout', {
        method: 'POST',
      })

      // Sign out from Firebase
      await signOut(auth)
      sessionUser.value = null
      logEvent('logout')
    }
    catch (e: unknown) {
      authError.value = e as AuthError
      console.error(e)
    }
  }

  const checkUser = async () => {
    try {
      const data = await $fetch<ReturnUser>('/api/auth/me', {
        headers: useRequestHeaders(['cookie']) as HeadersInit,
      })

      if (!data)
        return null
      return data.user
    }
    catch {
      // setCookie(null)
    }
  }

  const loginAsGuest = async () => {
    if (!auth)
      return null

    try {
      // Use browserLocalPersistence so the anonymous identity survives
      // when in-app browsers (LINE/WhatsApp WebView) are closed and reopened
      await setPersistence(auth, browserLocalPersistence)
      const result = await signInAnonymously(auth)
      await setSession(result.user)
      return sessionUser.value
    }
    catch (e: unknown) {
      authError.value = e as AuthError
      console.error(e)
      return null
    }
  }

  const upgradeGuestAccount = async () => {
    if (!auth?.currentUser || !provider)
      return null

    try {
      let result
      if (import.meta.env.MODE === 'development') {
        result = await linkWithPopup(auth.currentUser, provider)
      }
      else {
        await linkWithRedirect(auth.currentUser, provider)
        return null // Will be handled by checkRedirectResult
      }

      // Refresh session with updated user info
      await setSession(result.user)
      return sessionUser.value
    }
    catch (e: unknown) {
      authError.value = e as AuthError
      console.error(e)
      return null
    }
  }

  return {
    loginWithGoogle,
    loginAsGuest,
    upgradeGuestAccount,
    redirectToGoogleLogin,
    checkRedirectResult,
    setSession,
    checkUser,
    logout,
    authError,
    isUserLoggedIn,
  }
}
