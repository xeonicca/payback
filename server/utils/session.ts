import type { App } from 'firebase-admin/app'
import type { H3Event } from 'h3'
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

let app: App

export function getFirebaseAdminAuth() {
  if (getApps().length) {
    app = getApps()[0]
  } else {
    const config = useRuntimeConfig()
    console.log('config', config)
    const serviceAccount = JSON.parse(config.serviceAccount as string)

    app = initializeApp({
      credential: cert(serviceAccount),
    })
  }

  return getAdminAuth(app)
}

async function getUserFromCookie(cookie: string) {
  const auth = getFirebaseAdminAuth()
  try {
    const token = await auth.verifySessionCookie(cookie, true)
    const user = await auth.getUser(token.uid)
    return user
  }
  catch (error) {
    console.error('getUserFromCookie error: ', error)
    return null
  }
}

export async function getUserFromSession(event: H3Event) {
  const config = useRuntimeConfig()

  // Get the cookie from the request
  const cookie = getCookie(event, config.authCookieName)
  if (!cookie)
    return null

  // get user from cookie value
  const user = await getUserFromCookie(cookie)

  return user
}
