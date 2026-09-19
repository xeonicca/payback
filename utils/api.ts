export function requireHttpsOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('請設定 App 的 HTTPS 伺服器網址（NUXT_PUBLIC_API_BASE_URL / NUXT_PUBLIC_SITE_URL）')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('App 伺服器網址必須是 HTTPS origin，不能包含路徑或登入資訊')
  return url.origin
}

export async function getApiRequestOptions(
  path: string,
  native: boolean,
  apiBaseUrl: string,
  getToken: () => Promise<string | null>,
) {
  if (!path.startsWith('/api/') || /[\\%?#]/.test(path) || path.split('/').includes('..'))
    throw new Error('Invalid API path')
  if (!native)
    return {}
  const baseURL = requireHttpsOrigin(apiBaseUrl)
  const token = await getToken()
  return {
    baseURL,
    credentials: 'omit' as const,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }
}

export function getPublicOrigin(native: boolean, siteUrl: string, browserOrigin: string): string {
  return native ? requireHttpsOrigin(siteUrl) : browserOrigin
}
