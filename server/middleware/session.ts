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
    } as AppUser
  }
  else {
    // Session cookie is invalid or expired — clear it so VueFire
    // doesn't attempt to verify it and throw an unhandled error
    deleteCookie(event, config.authCookieName)
  }
})
