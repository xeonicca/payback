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

interface LoginResponse {
  user: AppUser
}

export default function useLogin() {
  const sessionUser = useSessionUser()
  const currentUser = useCurrentUser()
  const provider = new GoogleAuthProvider()
  const authError = ref<AuthError | null>(null)
  const auth = useFirebaseAuth()!

  const isCurrentUserLoaded = useIsCurrentUserLoaded()
  const isUserLoggedIn = computed(() => {
    // If session user exists, we're logged in regardless of Firebase state
    if (sessionUser.value)
      return true
    // Otherwise, check if Firebase auth is loaded and has a user
    return isCurrentUserLoaded.value && !!currentUser.value
  })

  const setSession = async (user: User) => {
    const firebaseIdToken = await getIdToken(user)
    const data = await $fetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken }),
    })
    sessionUser.value = data.user
  }

  const redirectToGoogleLogin = async () => {
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
    if (import.meta.env.MODE === 'development') {
      await getCurrentUser()
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
    try {
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
