import { AUTH_COOKIE_NAME } from 'vuefire/server'
import { getFirebaseAdminAuth } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const appUser = event.context.appUser

  if (appUser?.uid) {
    await getFirebaseAdminAuth().revokeRefreshTokens(appUser.uid)
  }

  deleteCookie(event, AUTH_COOKIE_NAME, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  return { user: null }
})
