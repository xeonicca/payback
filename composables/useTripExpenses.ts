import type { QueryNonFilterConstraint } from 'firebase/firestore'
import type { Expense } from '@/types'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { expenseConverter } from '@/utils/converter'

export function useTripExpenses(tripId: string, hasLimit = 0) {
  const db = useFirestore()
  const queryConditions = <QueryNonFilterConstraint[]>[
    orderBy('paidAt', 'desc'),
  ]
  if (hasLimit > 0) {
    queryConditions.push(limit(hasLimit))
  }
  const expensesQuery = query(collection(db, 'trips', tripId, 'expenses').withConverter(expenseConverter), ...queryConditions)
  const tripExpenses = useCollection<Expense>(expensesQuery, {
    ssrKey: `trip-expenses-${tripId}`,
  })

  return {
    tripExpenses,
  }
}
