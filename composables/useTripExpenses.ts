import type { Expense } from '@/types'
import { collection, orderBy, query } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { expenseConverter } from '@/utils/converter'

export function useTripExpenses(tripId: string) {
  const db = useFirestore()
  const expensesQuery = query(collection(db, 'trips', tripId, 'expenses').withConverter(expenseConverter), orderBy('createdAt', 'desc'))
  const tripExpenses = useCollection<Expense>(expensesQuery, {
    ssrKey: `trip-expenses-${tripId}`,
  })

  return {
    tripExpenses,
  }
}
