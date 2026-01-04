import type { TripMember } from '@/types'
import { collection } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { tripMemberConverter } from '@/utils/converter'

export function useTripMembers(tripId: string) {
  const db = useFirestore()

  const tripMembers = useCollection<TripMember>(
    collection(db, 'trips', tripId, 'members').withConverter(tripMemberConverter),
    { ssrKey: `trip-members-${tripId}` },
  )

  const hostMember = computed(() => tripMembers.value?.find(member => member.isHost))

  const tripMembersMap = computed(() => tripMembers.value?.reduce((acc, member) => {
    acc[member.id] = member
    return acc
  }, {} as Record<string, TripMember>))

  return {
    tripMembers,
    hostMember,
    tripMembersMap,
  }
}
