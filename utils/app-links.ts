export function getSafeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return '/'
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || /[\\\r\n]/.test(decoded))
      return '/'
    const url = new URL(value, 'https://app.invalid')
    if (url.origin !== 'https://app.invalid' || url.pathname === '/login')
      return '/'
    return `${url.pathname}${url.search}${url.hash}`
  }
  catch {
    return '/'
  }
}

export function getAppLinkPath(value: string, siteUrl: string): string | null {
  try {
    const url = new URL(value)
    const customScheme = url.protocol === 'payback:' && url.host === 'app'
    const universalLink = url.protocol === 'https:' && !!siteUrl && url.origin === new URL(siteUrl).origin
    if ((!customScheme && !universalLink) || url.username || url.password)
      return null
    if (!/^\/(?:join|invite|guest)\/[\w-]+\/?$/.test(url.pathname)
      && !/^\/trips\/[\w-]+(?:\/[\w-]+)*\/?$/.test(url.pathname)) {
      return null
    }
    url.searchParams.delete('openExternalBrowser')
    return getSafeReturnPath(`${url.pathname}${url.search}${url.hash}`)
  }
  catch {
    return null
  }
}
