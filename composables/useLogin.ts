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

const PENDING_UPGRADE_KEY = 'payback:pendingGuestUpgrade'

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

  // Drop only this browser's session cookie. Unlike logout(), this does not revoke
  // refresh tokens, so the user's other devices stay signed in.
  const clearSession = async () => {
    sessionUser.value = null
    await $fetch('/api/__session', { method: 'POST', body: {} }).catch(() => {})
  }

  // A guest upgrade in production bounces through a redirect, so remember it across the reload
  function rememberPendingUpgrade(tripId?: string) {
    if (!import.meta.client)
      return
    try {
      localStorage.setItem(PENDING_UPGRADE_KEY, tripId ?? '')
    }
    catch {}
  }

  function takePendingUpgrade(): { pending: boolean, tripId?: string } {
    if (!import.meta.client)
      return { pending: false }
    try {
      const value = localStorage.getItem(PENDING_UPGRADE_KEY)
      if (value === null)
        return { pending: false }
      localStorage.removeItem(PENDING_UPGRADE_KEY)
      return { pending: true, tripId: value || undefined }
    }
    catch {
      return { pending: false }
    }
  }

  // Promote the guest's collaborator records now that the account has a real provider
  const finishGuestUpgrade = async (tripId?: string) => {
    try {
      await $fetch('/api/auth/upgrade', { method: 'POST', body: { tripId } })
    }
    catch (error) {
      console.error('Error finishing guest upgrade:', error)
    }
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

        const pendingUpgrade = takePendingUpgrade()
        if (pendingUpgrade.pending)
          await finishGuestUpgrade(pendingUpgrade.tripId)
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

  const upgradeGuestAccount = async (options?: { tripId?: string }) => {
    if (!auth?.currentUser || !provider)
      return null

    if (import.meta.env.MODE !== 'development') {
      rememberPendingUpgrade(options?.tripId)
      try {
        await linkWithRedirect(auth.currentUser, provider)
      }
      catch (e: unknown) {
        takePendingUpgrade()
        throw e
      }
      return null // finished by checkRedirectResult when the user comes back
    }

    const result = await linkWithPopup(auth.currentUser, provider)
    await setSession(result.user)
    await finishGuestUpgrade(options?.tripId)
    return sessionUser.value
  }

  /**
   * Signs in with Google, but links to the current anonymous account when the user
   * is a guest — otherwise their guest trips would be stranded on an abandoned uid.
   * Falls back to a plain sign-in when that Google account is already a Payback user.
   */
  const signInOrLinkWithGoogle = async (options?: { tripId?: string }) => {
    if (sessionUser.value?.isAnonymous !== true)
      return { user: await loginWithGoogle(), linkedGuest: false, conflict: false }

    try {
      const user = await upgradeGuestAccount(options)
      return { user, linkedGuest: true, conflict: false }
    }
    catch (e: unknown) {
      const code = (e as AuthError)?.code
      authError.value = e as AuthError
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        // That Google account already exists; sign in as it instead. Trips joined as a
        // guest stay under the old anonymous identity — the caller warns the user.
        return { user: await loginWithGoogle(), linkedGuest: false, conflict: true }
      }
      throw e
    }
  }

  return {
    loginWithGoogle,
    loginAsGuest,
    upgradeGuestAccount,
    signInOrLinkWithGoogle,
    redirectToGoogleLogin,
    checkRedirectResult,
    setSession,
    clearSession,
    checkUser,
    logout,
    authError,
    isUserLoggedIn,
  }
}
