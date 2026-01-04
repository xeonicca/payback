import type {
  AuthError,
  User,
} from 'firebase/auth'
import type { AppUser } from '~/types'
import {
  getIdToken,
  getRedirectResult,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import { getCurrentUser, useFirebaseAuth, useIsCurrentUserLoaded } from 'vuefire'
import { useSessionUser } from './useSessionUser'

interface ReturnUser {
  user: AppUser
}

export default function useLogin() {
  const sessionUser = useSessionUser()

  // Only access Firebase on client to avoid SSR initialization issues
  const currentUser = import.meta.client ? useCurrentUser() : ref(null)
  const provider = import.meta.client ? new GoogleAuthProvider() : null
  const authError = ref<AuthError | null>(null)
  const auth = import.meta.client ? useFirebaseAuth()! : null

  const isCurrentUserLoaded = import.meta.client ? useIsCurrentUserLoaded() : ref(true)
  const isUserLoggedIn = computed(() => {
    // If session user exists, we're logged in regardless of Firebase state
    if (sessionUser.value)
      return true
    // Otherwise, check if Firebase auth is loaded and has a user (client-side only)
    return import.meta.client && isCurrentUserLoaded.value && !!currentUser.value
  })

  const setSession = async (user: User) => {
    const firebaseIdToken = await getIdToken(user)
    const data = await $fetch<AppUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken }),
    })
    sessionUser.value = data
  }

  const redirectToGoogleLogin = async () => {
    if (!auth || !provider) return
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
    if (!auth || !provider) return null

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
    if (!auth) return null

    if (import.meta.env.MODE === 'development') {
      const user = await getCurrentUser()
      if (user)
        await setSession(user)
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
    if (!auth) return

    try {
      // Call server logout endpoint to clear session cookie
      await $fetch('/api/auth/logout', {
        method: 'POST',
      })

      // Sign out from Firebase
      await signOut(auth)
      sessionUser.value = null
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
    catch (error) {
      // setCookie(null)
    }
  }

  return {
    loginWithGoogle,
    redirectToGoogleLogin,
    checkRedirectResult,
    setSession,
    checkUser,
    logout,
    authError,
    isUserLoggedIn,
  }
}
