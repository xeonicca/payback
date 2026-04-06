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
    // Session cookie is invalid or expired — clear it from both the
    // response (so the browser drops it) and the incoming request headers
    // (so VueFire's SSR plugin doesn't see it and throw an unhandled error)
    deleteCookie(event, config.authCookieName)
    const cookieName = config.authCookieName
    event.node.req.headers.cookie = (event.node.req.headers.cookie || '')
      .split(';')
      .filter(c => !c.trim().startsWith(`${cookieName}=`))
      .join(';') || undefined
  }
})
