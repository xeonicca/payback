import type { Expense, Trip, TripCollaborator } from '@/types'
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

  const isGuest = computed(() => {
    return currentUserCollaborator.value?.role === 'guest'
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
    // Owner and editors can manage all expenses (bulk operations)
    // Guests are excluded — they use fine-grained canEditExpense/canDeleteExpense
    if (isGuest.value)
      return false
    return isCollaborator.value || isOwner.value
  })

  const canAddExpenses = computed(() => {
    // All collaborators including guests can add expenses
    return isCollaborator.value
  })

  const canEditExpense = (expense: Expense) => {
    if (isOwner.value || currentUserCollaborator.value?.role === 'editor')
      return true
    if (isCollaborator.value && expense.createdByUserId === sessionUser.value?.uid)
      return true
    return false
  }

  const canDeleteExpense = (expense: Expense) => {
    if (isOwner.value || currentUserCollaborator.value?.role === 'editor')
      return true
    if (isCollaborator.value && expense.createdByUserId === sessionUser.value?.uid)
      return true
    return false
  }

  const canInvite = computed(() => {
    // Only owner can invite
    return isOwner.value
  })

  const canCreateTrip = computed(() => {
    // Guests cannot create new trips
    return !sessionUser.value?.isAnonymous
  })

  return {
    collaborators,
    currentUserCollaborator,
    isOwner,
    isCollaborator,
    isGuest,
    canEditTrip,
    canManageMembers,
    canManageExpenses,
    canAddExpenses,
    canEditExpense,
    canDeleteExpense,
    canInvite,
    canCreateTrip,
  }
}
