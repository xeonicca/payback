import { AUTH_COOKIE_NAME } from 'vuefire/server'
import { getFirebaseAdminAuth } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV !== 'development') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const auth = getFirebaseAdminAuth()
  const body = await readBody(event).catch(() => ({}))
  const uid: string = body?.uid ?? process.env.DEV_TEST_USER_UID ?? 'dev-test-user'

  // Create custom token for the test uid
  const customToken = await auth.createCustomToken(uid)

  // Exchange for ID token via Firebase Auth REST API
  // (Admin SDK custom tokens cannot be used directly as session cookies)
  const apiKey = useRuntimeConfig().public.firebase.apiKey as string
  const signInRes = await $fetch<{ idToken: string }>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      body: { token: customToken, returnSecureToken: true },
    },
  )

  // Mint 5-day session cookie from the ID token
  const expiresInMs = 5 * 24 * 60 * 60 * 1000
  const sessionCookie = await auth.createSessionCookie(signInRes.idToken, { expiresIn: expiresInMs })

  setCookie(event, AUTH_COOKIE_NAME, sessionCookie, {
    maxAge: expiresInMs / 1000,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
  })

  const user = await auth.getUser(uid)
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    isAnonymous: user.providerData.length === 0,
    customToken,
  }
})
