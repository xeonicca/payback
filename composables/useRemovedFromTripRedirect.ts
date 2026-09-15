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

  function handleLostAccess(id: string) {
    if (expectedExits.delete(id))
      return
    toast.info('你已被移出此行程')
    router.replace('/')
  }

  watch(
    () => {
      const id = toValue(tripId)
      const uid = sessionUser.value?.uid
      return id && uid ? { id, uid } : null
    },
    (target, _previous, onCleanup) => {
      if (!target)
        return
      // Only react to losing access this listener has actually seen
      let hadAccess = false
      const unsubscribe = onSnapshot(
        doc(db, 'trips', target.id, 'collaborators', target.uid),
        (snapshot) => {
          if (snapshot.exists())
            hadAccess = true
          else if (hadAccess)
            handleLostAccess(target.id)
        },
        // Once removed, the rules may deny the listener instead of sending a delete
        (error) => {
          if (hadAccess && error.code === 'permission-denied')
            handleLostAccess(target.id)
        },
      )
      onCleanup(unsubscribe)
    },
    { immediate: true },
  )
}
