import type { Expense } from '@/types'

/**
 * Calculate how much a member has paid (sum of expenses they paid for)
 */
export function calculateMemberPaidAmount(expenses: Expense[], memberId: string): number {
  return expenses
    .filter(expense => expense.paidByMemberId === memberId)
    .reduce((total, expense) => total + expense.grandTotal, 0)
}

/**
 * Calculate how much a member owes (considering item-level sharing)
 */
export function calculateMemberOwedAmount(expenses: Expense[], memberId: string): number {
  let totalOwed = 0

  expenses.forEach((expense) => {
    // If expense has items, calculate based on item-level sharing
    if (expense.items && expense.items.length > 0) {
      expense.items.forEach((item) => {
        let sharingMembers: string[] = []

        // If item has no specific sharedByMemberIds, all expense members share it
        if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
          sharingMembers = expense.sharedWithMemberIds
        }
        else {
          // Only include members who are both in item sharing AND main expense sharing
          sharingMembers = item.sharedByMemberIds.filter(id =>
            expense.sharedWithMemberIds.includes(id),
          )
        }

        // Skip if no members are sharing this item or if this member isn't sharing
        if (sharingMembers.length === 0 || !sharingMembers.includes(memberId)) {
          return
        }

        // Calculate this member's share of this item
        const itemTotal = item.price * (item.quantity || 1)
        const sharePerMember = itemTotal / sharingMembers.length
        totalOwed += sharePerMember
      })
    }
    else {
      // If no items, use expense-level sharing
      if (expense.sharedWithMemberIds.includes(memberId)) {
        const sharePerMember = expense.grandTotal / expense.sharedWithMemberIds.length
        totalOwed += sharePerMember
      }
    }
  })

  return totalOwed
}

/**
 * Calculate member balance (paid - owed)
 */
export function calculateMemberBalance(expenses: Expense[], memberId: string): number {
  const paid = calculateMemberPaidAmount(expenses, memberId)
  const owed = calculateMemberOwedAmount(expenses, memberId)

  return paid - owed
}

/**
 * Calculate debt amount between two members
 * Positive value means member1 is owed money by member2
 * Negative value means member1 owes money to member2
 * Zero means they're settled
 */
export function calculateDebtAmount(expenses: Expense[], member1Id: string, member2Id: string): number {
  const member1Balance = calculateMemberBalance(expenses, member1Id)
  const member2Balance = calculateMemberBalance(expenses, member2Id)

  // If member1 has positive balance and member2 has negative balance,
  // member1 is owed money by member2
  if (member1Balance > 0 && member2Balance < 0) {
    return Math.min(member1Balance, Math.abs(member2Balance))
  }

  // If member1 has negative balance and member2 has positive balance,
  // member1 owes money to member2
  if (member1Balance < 0 && member2Balance > 0) {
    return -Math.min(Math.abs(member1Balance), member2Balance)
  }

  return 0
}
