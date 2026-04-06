import { getAnalytics, isSupported, logEvent as firebaseLogEvent } from 'firebase/analytics'
import type { Analytics } from 'firebase/analytics'

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

  return { logEvent }
}
