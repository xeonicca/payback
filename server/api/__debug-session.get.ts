import { AUTH_COOKIE_NAME } from 'vuefire/server'
import { getFirebaseAdminAuth } from '../utils/session'

export default defineEventHandler(async (event) => {
  const cookieNames = Object.keys(parseCookies(event))
  const sessionCookie = getCookie(event, AUTH_COOKIE_NAME)
  let decodeError: string | null = null
  let decodedUid: string | null = null

  if (sessionCookie) {
    try {
      const decoded = await getFirebaseAdminAuth().verifySessionCookie(sessionCookie)
      decodedUid = decoded.uid
    }
    catch (e) {
      decodeError = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }
  }

  return {
    cookieNames,
    sessionCookiePresent: !!sessionCookie,
    sessionCookieLen: sessionCookie?.length ?? 0,
    decodedUid,
    decodeError,
    contextAppUserUid: (event.context as { appUser?: { uid?: string } }).appUser?.uid ?? null,
  }
})
