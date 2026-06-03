import { signInWithCustomToken } from 'firebase/auth'
import { useFirebaseAuth } from 'vuefire'

export default defineNuxtPlugin(() => {
  if (import.meta.env.PROD)
    return

  const auth = useFirebaseAuth()!
  const { setSession } = useLogin()

  // Usage in DevTools console:
  //   await window.__devLogin()
  //   await window.__devLogin('specific-uid')
  // @ts-expect-error dev-only global
  window.__devLogin = async (uid?: string) => {
    const body = uid ? JSON.stringify({ uid }) : undefined
    const res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      body,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    })
    const { customToken } = await res.json()
    const { user } = await signInWithCustomToken(auth, customToken)
    await setSession(user)
  }
})
