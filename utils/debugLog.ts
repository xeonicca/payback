const KEY = '__dlog'
const MAX = 40000
const SID_KEY = '__dlog_sid'

function getSid(): string {
  if (typeof window === 'undefined')
    return '-'
  try {
    let sid = window.sessionStorage.getItem(SID_KEY)
    if (!sid) {
      sid = Math.random().toString(36).slice(2, 8)
      window.sessionStorage.setItem(SID_KEY, sid)
    }
    return sid
  }
  catch {
    return '-'
  }
}

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
  const time = new Date().toISOString()
  const entry = `${time.slice(11, 23)} ${msg}${data === undefined ? '' : ` ${safeStringify(data)}`}`
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
  // Fire-and-forget ship to server so logs survive truncation/copy-paste
  try {
    const body = JSON.stringify({ ts: time, sid: getSid(), msg, data })
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/__dlog', new Blob([body], { type: 'application/json' }))
    }
    else {
      void fetch('/api/__dlog', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true })
    }
  }
  catch {
    // network unavailable — local copy still in localStorage
  }
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
