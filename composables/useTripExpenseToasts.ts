import { toast } from 'vue-sonner'

interface ExpenseLike {
  id: string
  description?: string
  grandTotal?: number
  paidByMemberId: string
  isProcessing?: boolean
  hasPendingWrites?: boolean
}

interface MemberLike {
  name: string
}

export function shouldFireToastForExpense(
  expense: ExpenseLike,
  currentUserMemberId: string | undefined,
  seenIds: Set<string>,
): boolean {
  if (seenIds.has(expense.id))
    return false
  if (expense.isProcessing)
    return false
  if (expense.hasPendingWrites)
    return false
  if (currentUserMemberId && expense.paidByMemberId === currentUserMemberId)
    return false
  return true
}

export function formatExpenseToast(
  expense: ExpenseLike,
  membersMap: Record<string, MemberLike> | undefined,
): string {
  const memberName = membersMap?.[expense.paidByMemberId]?.name ?? 'Someone'
  const description = expense.description ?? 'a new expense'
  const amount = expense.grandTotal ?? 0
  return `${memberName} added ${description} — ${amount}`
}

export function useTripExpenseToasts(tripId: string) {
  const { tripExpenses } = useTripExpenses(tripId)
  const { tripMembersMap, currentUserMember } = useTripMembers(tripId)

  const seenIds = new Set<string>()
  let hasInitialized = false

  watch(
    tripExpenses,
    (expenses) => {
      if (!expenses)
        return

      if (!hasInitialized) {
        for (const exp of expenses)
          seenIds.add(exp.id)
        hasInitialized = true
        return
      }

      for (const exp of expenses) {
        if (!shouldFireToastForExpense(exp as ExpenseLike, currentUserMember.value?.id, seenIds))
          continue
        seenIds.add(exp.id)
        toast(formatExpenseToast(exp as ExpenseLike, tripMembersMap.value))
      }
    },
    { deep: true, immediate: true },
  )
}
