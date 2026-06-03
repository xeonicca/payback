import type { Analytics } from 'firebase/analytics'
import type { AppUser } from '@/types'
import { logEvent as firebaseLogEvent, getAnalytics, isSupported, setUserId, setUserProperties } from 'firebase/analytics'

let analytics: Analytics | null = null

async function getAnalyticsInstance(): Promise<Analytics | null> {
  if (analytics)
    return analytics

  const supported = await isSupported()
  if (!supported)
    return null

  analytics = getAnalytics()
  return analytics
}

export function useAnalytics() {
  async function logEvent(eventName: string, params?: Record<string, any>) {
    if (import.meta.server)
      return

    const instance = await getAnalyticsInstance()
    if (instance) {
      firebaseLogEvent(instance, eventName, params)
    }
  }

  async function setUser(user: AppUser) {
    if (import.meta.server)
      return

    const instance = await getAnalyticsInstance()
    if (instance) {
      setUserId(instance, user.uid)
      setUserProperties(instance, {
        is_guest: user.isAnonymous,
        has_email: !!user.email,
      })
    }
  }

  async function clearUser() {
    if (import.meta.server)
      return

    const instance = await getAnalyticsInstance()
    if (instance) {
      setUserId(instance, null)
    }
  }

  return { logEvent, setUser, clearUser }
}
