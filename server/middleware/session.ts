import type { AppUser } from '@/types'

import { getUserFromSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)

  if (user) {
    event.context.appUser = {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      uid: user.uid,
    } as AppUser
  }
})
