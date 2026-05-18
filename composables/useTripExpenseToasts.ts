import { toast } from 'vue-sonner'

interface ExpenseLike {
  id: string
  description?: string
  grandTotal?: number
  paidByMemberId: string
  isProcessing?: boolean
  hasPendingWrites?: boolean
  createdAt?: unknown
}

interface MemberLike {
  name: string
}

const RECENCY_GRACE_MS = 5_000

function getCreatedAtMs(expense: ExpenseLike): number | null {
  const t = expense.createdAt as { toMillis?: () => number } | null | undefined
  if (t && typeof t.toMillis === 'function')
    return t.toMillis()
  return null
}

export function shouldFireToastForExpense(
  expense: ExpenseLike,
  currentUserMemberId: string | undefined,
  seenIds: Set<string>,
  cutoffMs?: number,
): boolean {
  if (seenIds.has(expense.id))
    return false
  if (expense.isProcessing)
    return false
  if (expense.hasPendingWrites)
    return false
  if (currentUserMemberId && expense.paidByMemberId === currentUserMemberId)
    return false
  if (cutoffMs !== undefined) {
    const createdAtMs = getCreatedAtMs(expense)
    if (createdAtMs !== null && createdAtMs < cutoffMs)
      return false
  }
  return true
}

export function formatExpenseToast(
  expense: ExpenseLike,
  membersMap: Record<string, MemberLike> | undefined,
  currency?: string,
): string {
  const memberName = membersMap?.[expense.paidByMemberId]?.name ?? 'Someone'
  const description = expense.description ?? 'a new expense'
  const amount = expense.grandTotal ?? 0
  const currencyPart = currency ? `${currency} ` : ''
  return `${memberName} added ${description} — ${currencyPart}${amount}`
}

export function useTripExpenseToasts(tripId: string) {
  const { trip } = useTrip(tripId)
  const { tripExpenses } = useTripExpenses(tripId)
  const { tripMembersMap, currentUserMember } = useTripMembers(tripId)

  const seenIds = new Set<string>()
  const cutoffMs = Date.now() - RECENCY_GRACE_MS

  watch(
    tripExpenses,
    (expenses) => {
      if (!expenses)
        return

      for (const exp of expenses) {
        if (seenIds.has(exp.id))
          continue
        seenIds.add(exp.id)
        if (shouldFireToastForExpense(exp as ExpenseLike, currentUserMember.value?.id, new Set(), cutoffMs))
          toast(formatExpenseToast(exp as ExpenseLike, tripMembersMap.value, trip.value?.tripCurrency))
      }
    },
    { deep: true, immediate: true },
  )
}
