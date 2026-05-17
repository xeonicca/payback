const KEY = '__dlog'
const MAX = 12000

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error)
        return { name: v.name, message: v.message, code: (v as { code?: string }).code }
      return v
    })
  }
  catch {
    return String(value)
  }
}

export function dlog(msg: string, data?: unknown) {
  if (typeof window === 'undefined')
    return
  const time = new Date().toISOString().slice(11, 23)
  const entry = `${time} ${msg}${data === undefined ? '' : ` ${safeStringify(data)}`}`
  try {
    const prev = window.localStorage.getItem(KEY) ?? ''
    const next = (prev ? `${prev}\n${entry}` : entry).slice(-MAX)
    window.localStorage.setItem(KEY, next)
  }
  catch {
    // localStorage unavailable (private mode, quota) — ignore
  }
  // eslint-disable-next-line no-console
  console.log('[dlog]', entry)
}

export function dlogRead(): string {
  if (typeof window === 'undefined')
    return ''
  try {
    return window.localStorage.getItem(KEY) ?? ''
  }
  catch {
    return ''
  }
}

export function dlogClear() {
  if (typeof window === 'undefined')
    return
  try {
    window.localStorage.removeItem(KEY)
  }
  catch {}
}

export function dlogEnv() {
  if (typeof window === 'undefined')
    return {}
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return {
    standalone,
    ua: window.navigator.userAgent,
    href: window.location.href,
    hasHash: !!window.location.hash,
    referrer: document.referrer || null,
    ssKeys: (() => {
      try {
        return Object.keys(window.sessionStorage)
      }
      catch {
        return null
      }
    })(),
  }
}
