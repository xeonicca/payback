import { Capacitor } from '@capacitor/core'
import { getCurrentUser } from 'vuefire'
import { getApiRequestOptions } from '~/utils/api'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  // Accept typed request payloads without forcing every caller to add an
  // index signature. Nitro/$fetch performs the runtime serialization.
  body?: object
  query?: Record<string, unknown>
}

export function useApi() {
  const config = useRuntimeConfig()
  return async <T = unknown>(path: string, options: ApiOptions = {}): Promise<T> => {
    const transport = await getApiRequestOptions(
      path,
      Capacitor.isNativePlatform(),
      config.public.apiBaseUrl,
      async () => (await getCurrentUser())?.getIdToken() ?? null,
    )
    return await $fetch<T>(path, { ...options, ...transport }) as T
  }
}
