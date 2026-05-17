import type { AppUser } from '@/types'
import { AUTH_COOKIE_NAME } from 'vuefire/server'
import { getFirebaseAdminAuth, mapDecodedTokenToAppUser } from '../utils/session'

export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, AUTH_COOKIE_NAME)
  if (!cookie)
    return

  // Verify directly via the Admin SDK instead of vuefire's decodeSessionCookie:
  // vuefire logs every verification failure (including the normal "cookie expired"
  // case) to stderr, which is just noise — the client recovers via the refresh
  // token in IndexedDB.
  try {
    const decoded = await getFirebaseAdminAuth().verifySessionCookie(cookie)
    event.context.appUser = mapDecodedTokenToAppUser(decoded) as AppUser
  }
  catch {
    deleteCookie(event, AUTH_COOKIE_NAME)
  }
})
