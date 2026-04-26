import type { App } from 'firebase-admin/app'
import type { H3Event } from 'h3'
import type { AppUser } from '@/types'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

let app: App

export function getFirebaseAdminApp() {
  if (getApps().length) {
    app = getApps()[0]
  }
  else {
    const config = useRuntimeConfig()
    const serviceAccount = JSON.parse(config.serviceAccount as string)
    app = initializeApp({ credential: cert(serviceAccount) })
  }
  return app
}

export function getFirebaseAdminAuth() {
  return getAdminAuth(getFirebaseAdminApp())
}

export function getFirebaseAdminFirestore() {
  return getFirestore(getFirebaseAdminApp())
}

interface TokenClaims {
  uid: string
  email?: string
  name?: string
  picture?: string
  firebase?: { sign_in_provider?: string }
}

export function mapDecodedTokenToAppUser(decoded: TokenClaims): AppUser {
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    displayName: decoded.name ?? null,
    photoURL: decoded.picture ?? null,
    isAnonymous: decoded.firebase?.sign_in_provider === 'anonymous',
  }
}

export function getUserFromSession(event: H3Event): AppUser | null {
  return event.context.appUser ?? null
}
