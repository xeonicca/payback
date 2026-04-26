import type { AppUser } from '@/types'

import { getUserFromSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const cookie = getCookie(event, config.authCookieName)

  if (!cookie)
    return

  const user = await getUserFromSession(event)

  if (user) {
    event.context.appUser = {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      uid: user.uid,
      isAnonymous: user.providerData.length === 0,
    } as AppUser
  }
  else {
    // Session cookie is invalid or expired — clear it from:
    // 1. The response (so the browser drops it)
    // 2. The raw request header string
    // 3. H3's internal parsed cookie cache (event._cookies) — without this,
    //    VueFire's SSR plugin still reads the expired cookie from the cache
    //    even after we clear the raw header, causing an unhandled 500 error.
    const cookieName = config.authCookieName
    deleteCookie(event, cookieName)
    event.node.req.headers.cookie = (event.node.req.headers.cookie || '')
      .split(';')
      .filter(c => !c.trim().startsWith(`${cookieName}=`))
      .join(';') || undefined
    const cachedCookies = (event as any)._cookies
    if (cachedCookies)
      delete cachedCookies[cookieName]
  }
})
