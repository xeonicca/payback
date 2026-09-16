import type { MaybeRefOrGetter } from 'vue'
import { doc, onSnapshot } from 'firebase/firestore'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'

// Trips the current user is leaving on purpose (the leave button), so their own
// departure isn't reported as "you were removed".
const expectedExits = new Set<string>()

/** Call before leaving a trip. Returns a function that cancels the expectation if leaving fails. */
export function expectTripExit(tripId: string) {
  expectedExits.add(tripId)
  return () => {
    expectedExits.delete(tripId)
  }
}

/**
 * Sends the user home when they lose access to the trip they're looking at —
 * i.e. the owner removed them. Mount once, in app.vue.
 */
export function useRemovedFromTripRedirect(tripId: MaybeRefOrGetter<string | undefined>) {
  const db = useFirestore()
  const sessionUser = useSessionUser()
  const router = useRouter()

  watch(
    // A primitive key, so navigating within the same trip keeps one listener alive
    () => {
      const id = toValue(tripId)
      const uid = sessionUser.value?.uid
      return id && uid ? `${id}|${uid}` : ''
    },
    (key, _previous, onCleanup) => {
      if (!key)
        return
      const [id, uid] = key.split('|')
      let hadAccess = false
      let handled = false
      let unsubscribe: (() => void) | undefined

      function handleLostAccess() {
        // A removal can arrive as both a deleted doc and a permission error — react once
        if (handled)
          return
        handled = true
        unsubscribe?.()
        if (expectedExits.delete(id))
          return
        toast.info('你已被移出此行程')
        router.replace('/')
      }

      unsubscribe = onSnapshot(
        doc(db, 'trips', id, 'collaborators', uid),
        (snapshot) => {
          if (snapshot.exists())
            hadAccess = true
          else if (hadAccess)
            handleLostAccess()
        },
        // Once removed, the rules may deny the listener instead of sending a delete
        (error) => {
          if (hadAccess && error.code === 'permission-denied')
            handleLostAccess()
        },
      )

      onCleanup(() => {
        unsubscribe?.()
        // Don't let an unused leave expectation mute a later real removal
        expectedExits.delete(id)
      })
    },
    { immediate: true },
  )
}
