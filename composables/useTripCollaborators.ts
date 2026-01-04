import type { Trip, TripCollaborator } from '@/types'
import { collection, doc } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { tripCollaboratorConverter } from '@/utils/converter'

export function useTripCollaborators(tripId: string) {
  const db = useFirestore()
  const sessionUser = useSessionUser()

  const trip = useDocument<Trip>(doc(db, 'trips', tripId).withConverter(tripConverter))

  const collaborators = useCollection<TripCollaborator>(
    collection(db, 'trips', tripId, 'collaborators').withConverter(tripCollaboratorConverter),
    { ssrKey: `trip-collaborators-${tripId}` },
  )

  const currentUserCollaborator = computed(() => {
    if (!sessionUser.value)
      return null
    return collaborators.value.find(c => c.userId === sessionUser.value!.uid)
  })

  const isOwner = computed(() => {
    return currentUserCollaborator.value?.role === 'owner' || trip.value?.userId === sessionUser.value?.uid
  })

  const isCollaborator = computed(() => {
    return !!currentUserCollaborator.value
  })

  const canEditTrip = computed(() => {
    // Only owner can edit trip settings
    return isOwner.value
  })

  const canManageMembers = computed(() => {
    // Only owner can manage members
    return isOwner.value
  })

  const canManageExpenses = computed(() => {
    // Both owner and editors can manage expenses
    return isCollaborator.value || isOwner.value
  })

  const canInvite = computed(() => {
    // Only owner can invite
    return isOwner.value
  })

  return {
    collaborators,
    currentUserCollaborator,
    isOwner,
    isCollaborator,
    canEditTrip,
    canManageMembers,
    canManageExpenses,
    canInvite,
  }
}
