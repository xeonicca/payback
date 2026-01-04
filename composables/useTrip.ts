import type { Trip, TripMember } from '@/types'
import { doc } from 'firebase/firestore'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

export function useTrip(tripId: string) {
  const db = useFirestore()
  const trip = useDocument<Trip>(doc(db, 'trips', tripId).withConverter(tripConverter))

  return {
    trip,
  }
}
