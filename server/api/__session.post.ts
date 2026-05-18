import { AUTH_COOKIE_NAME } from 'vuefire/server'
import { getFirebaseAdminAuth } from '../utils/session'

// nuxt-vuefire only auto-registers /api/__session when ssr:true. We run ssr:false,
// so we own this endpoint — without it the POST falls through to the SPA index.html
// (200 OK, no Set-Cookie) and login silently fails.
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 5
const ID_TOKEN_MAX_AGE_SECONDS = 5 * 60

export default defineEventHandler(async (event) => {
  assertMethod(event, 'POST')
  const { token } = await readBody<{ token?: string }>(event)
  const adminAuth = getFirebaseAdminAuth()

  if (!token) {
    deleteCookie(event, AUTH_COOKIE_NAME)
    setResponseStatus(event, 204)
    return ''
  }

  const verified = await adminAuth.verifyIdToken(token)
  if (Date.now() / 1000 - verified.iat > ID_TOKEN_MAX_AGE_SECONDS) {
    setResponseStatus(event, 301)
    return ''
  }

  const sessionCookie = await adminAuth.createSessionCookie(token, {
    expiresIn: SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
  })
  setCookie(event, AUTH_COOKIE_NAME, sessionCookie, {
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    secure: true,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
  })
  setResponseStatus(event, 201)
  return ''
})
