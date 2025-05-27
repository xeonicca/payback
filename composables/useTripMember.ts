import type { TripMember } from '@/types'
import { collection } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { tripMemberConverter } from '@/utils/converter'

export function useTripMembers(tripId: string) {
  const db = useFirestore()
  const tripMembers = useCollection<TripMember>(collection(db, 'trips', tripId, 'members').withConverter(tripMemberConverter))
  const hostMember = computed(() => tripMembers.value?.find(member => member.isHost))

  return {
    tripMembers,
    hostMember,
  }
}
