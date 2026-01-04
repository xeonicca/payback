import type { TripCollaborator } from '@/types'
import { collection } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { tripCollaboratorConverter } from '@/utils/converter'

export function useTripCollaborators(tripId: string) {
  const db = useFirestore()
  const sessionUser = useSessionUser()

  // Client-only query to avoid SSR auth issues
  const collaborators = process.client
    ? useCollection<TripCollaborator>(collection(db, 'trips', tripId, 'collaborators').withConverter(tripCollaboratorConverter))
    : ref([])

  const currentUserCollaborator = computed(() => {
    if (!sessionUser.value) return null
    return collaborators.value.find(c => c.userId === sessionUser.value!.uid)
  })

  const isOwner = computed(() => {
    return currentUserCollaborator.value?.role === 'owner'
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
    return isCollaborator.value
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
