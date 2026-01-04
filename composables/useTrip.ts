import type { Trip, TripMember } from '@/types'
import { doc } from 'firebase/firestore'
import { useDocument, useFirestore } from 'vuefire'
import { tripConverter } from '@/utils/converter'

export function useTrip(tripId: string) {
  const db = useFirestore()

  // Client-only to avoid SSR permission issues
  const trip = process.client
    ? useDocument<Trip>(doc(db, 'trips', tripId).withConverter(tripConverter))
    : ref(null)

  return {
    trip,
  }
}
