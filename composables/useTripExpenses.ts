import type { Expense } from '@/types'
import { collection } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { expenseConverter } from '@/utils/converter'

export function useTripExpenses(tripId: string) {
  const db = useFirestore()
  const tripExpenses = useCollection<Expense>(collection(db, 'trips', tripId, 'expenses').withConverter(expenseConverter))

  return {
    tripExpenses,
  }
}
