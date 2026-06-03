import type { Analytics } from 'firebase/analytics'
import type { AppUser } from '@/types'
import type { AnalyticsEventName, LogEventArgs } from '@/types/analytics'
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
  async function logEvent<K extends AnalyticsEventName>(eventName: K, ...args: LogEventArgs<K>) {
    if (import.meta.server)
      return

    const instance = await getAnalyticsInstance()
    if (instance) {
      // Cast: Firebase's CustomEventName type rejects GA reserved names
      // (page_view, login, ...) which we deliberately use.
      firebaseLogEvent(instance, eventName as string, args[0] as Record<string, any>)
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
