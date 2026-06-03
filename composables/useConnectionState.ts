export type ConnectionState = 'online' | 'offline' | 'syncing'

let _shared: ReturnType<typeof create> | null = null

function create() {
  const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const justReconnected = ref(false)
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function onOnline() {
    const wasOffline = !isOnline.value
    isOnline.value = true
    if (wasOffline) {
      justReconnected.value = true
      if (reconnectTimer)
        clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        justReconnected.value = false
      }, 1500)
    }
  }

  function onOffline() {
    isOnline.value = false
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }

  const state = computed<ConnectionState>(() => {
    if (!isOnline.value)
      return 'offline'
    if (justReconnected.value)
      return 'syncing'
    return 'online'
  })

  return { state, isOnline, justReconnected }
}

export function useConnectionState() {
  if (!_shared)
    _shared = create()
  return _shared
}
