import type { AppUser } from '@/types'
import { AUTH_COOKIE_NAME, decodeSessionCookie } from 'vuefire/server'
import { getFirebaseAdminApp, mapDecodedTokenToAppUser } from '../utils/session'

export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, AUTH_COOKIE_NAME)
  if (!cookie)
    return

  const decoded = await decodeSessionCookie(cookie, getFirebaseAdminApp())

  if (decoded) {
    event.context.appUser = mapDecodedTokenToAppUser(decoded) as AppUser
  }
  else {
    deleteCookie(event, AUTH_COOKIE_NAME)
  }
})
