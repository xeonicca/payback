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
import { dlog } from '~/utils/debugLog'
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
    dlog('setSession:start', { uid: user.uid, isAnonymous: user.isAnonymous })
    const token = await getIdToken(user, true)
    dlog('setSession:tokenLen', { len: token.length })
    let sessionStatus: number | null = null
    let sessionHeaders: Record<string, string> | null = null
    let sessionType: string | null = null
    let sessionFromSW: boolean | null = null
    try {
      // Use raw fetch so we can read status + headers, bypass SW with cache: 'no-store'
      const res = await fetch('/api/__session', {
        method: 'POST',
        body: JSON.stringify({ token }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
      })
      sessionStatus = res.status
      sessionType = res.type
      sessionFromSW = (res as Response & { fromServiceWorker?: boolean }).fromServiceWorker ?? null
      sessionHeaders = {}
      res.headers.forEach((v, k) => {
        sessionHeaders![k] = v
      })
    }
    catch (e) {
      dlog('setSession:cookieFetch:error', e)
    }
    dlog('setSession:cookieSet', { status: sessionStatus, type: sessionType, fromSW: sessionFromSW, headers: sessionHeaders })

    try {
      const dbg = await $fetch('/api/__debug-session', { credentials: 'include' })
      dlog('setSession:debug', dbg)
    }
    catch (e) {
      dlog('setSession:debug:error', e)
    }

    const { user: appUser } = await $fetch<{ user: AppUser }>('/api/auth/me', {
      credentials: 'include',
    })
    dlog('setSession:me', { hasUser: !!appUser, uid: appUser?.uid })
    sessionUser.value = appUser
    logEvent('login', { method: 'google' })
    dlog('setSession:done')
  }

  const redirectToGoogleLogin = async () => {
    if (!auth || !provider) {
      dlog('redirect:abort', { hasAuth: !!auth, hasProvider: !!provider })
      return
    }
    dlog('redirect:setPersistence')
    await setPersistence(auth, inMemoryPersistence)
    try {
      dlog('redirect:signInWithRedirect:call')
      await signInWithRedirect(auth, provider)
      dlog('redirect:signInWithRedirect:returned')
    }
    catch (e: unknown) {
      authError.value = e as AuthError
      dlog('redirect:error', e)
      console.error(e)
    }
  }

  const loginWithGoogle = async () => {
    dlog('loginWithGoogle:start', { mode: import.meta.env.MODE })
    if (!auth || !provider) {
      dlog('loginWithGoogle:abort', { hasAuth: !!auth, hasProvider: !!provider })
      return null
    }

    if (import.meta.env.MODE === 'development') {
      try {
        const result = await signInWithPopup(auth, provider)
        dlog('loginWithGoogle:popup:done', { uid: result.user.uid })
        await setSession(result.user)
      }
      catch (e: unknown) {
        authError.value = e as AuthError
        dlog('loginWithGoogle:popup:error', e)
        console.error(e)
      }
    }
    else {
      await redirectToGoogleLogin()
    }

    return sessionUser.value
  }

  const checkRedirectResult = async () => {
    dlog('checkRedirect:start', { mode: import.meta.env.MODE, hasAuth: !!auth })
    if (!auth)
      return null

    if (import.meta.env.MODE === 'development') {
      try {
        const user = await getCurrentUser()
        dlog('checkRedirect:dev:getCurrentUser', { hasUser: !!user, uid: user?.uid })
        if (user)
          await setSession(user)
      }
      catch (e: unknown) {
        // Stale cached Firebase user — clear it so it doesn't block fresh logins
        dlog('checkRedirect:dev:error', e)
        console.warn('Failed to restore session from cached user, signing out', e)
        await signOut(auth!)
      }
      return sessionUser.value
    }
    try {
      dlog('checkRedirect:getRedirectResult:call')
      const result = await getRedirectResult(auth)
      dlog('checkRedirect:getRedirectResult:done', {
        hasResult: !!result,
        hasUser: !!result?.user,
        uid: result?.user?.uid,
        providerId: result?.providerId,
        currentUserUid: auth.currentUser?.uid ?? null,
      })
      if (result?.user) {
        await setSession(result.user)
      }

      return sessionUser.value
    }
    catch (e: unknown) {
      authError.value = e as AuthError
      dlog('checkRedirect:error', e)
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
