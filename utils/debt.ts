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

export interface Settlement {
  fromId: string
  toId: string
  amount: number
}

/**
 * Above this many non-zero members the exact grouping search (O(2^n · n)) is skipped
 * and everyone is settled with the plain greedy pass.
 */
const MAX_MEMBERS_FOR_EXACT_GROUPING = 18

/** Two cents-rounded balances can drift by a cent; treat sums this close to zero as settled. */
const ZERO_SUM_TOLERANCE_CENTS = 1

interface CentsBalance {
  id: string
  cents: number
}

/**
 * Greedy settlement within one group (amounts in cents).
 * Smallest debtors first so equal-balance members get symmetric treatment
 * and unavoidable splits land on the largest debtor.
 */
function settleGroupGreedy(group: CentsBalance[]): Settlement[] {
  const results: Settlement[] = []

  const debtors = group
    .filter(m => m.cents < 0)
    .sort((a, b) => b.cents - a.cents) // smallest debt first
    .map(m => ({ id: m.id, remaining: -m.cents }))

  const creditors = group
    .filter(m => m.cents > 0)
    .sort((a, b) => b.cents - a.cents) // largest credit first
    .map(m => ({ id: m.id, remaining: m.cents }))

  for (const debtor of debtors) {
    for (const creditor of creditors) {
      if (debtor.remaining < 1 || creditor.remaining < 1)
        continue
      const amount = Math.min(debtor.remaining, creditor.remaining)
      results.push({ fromId: debtor.id, toId: creditor.id, amount: amount / 100 })
      debtor.remaining -= amount
      creditor.remaining -= amount
    }
  }

  return results
}

/**
 * Partition members into the maximum number of disjoint groups whose balances sum to zero.
 * Each group of size k settles in at most k-1 payments, so maximizing the number of groups
 * minimizes total payments — and lets a debtor pay a single creditor whenever the amounts allow.
 *
 * dp[mask] = max zero-sum groups obtainable by peeling members off `mask` one at a time,
 * counting each intermediate mask that sums to zero. Members peeled off between two
 * consecutive zero-sum masks form one zero-sum group. Any members peeled off before the
 * first zero-sum mask (only when balances don't total zero) form a leftover group.
 */
function partitionIntoZeroSumGroups(members: CentsBalance[]): CentsBalance[][] {
  const n = members.length
  const size = 1 << n
  const sums = new Float64Array(size)
  const dp = new Int8Array(size)
  const isZero = (mask: number) => Math.abs(sums[mask]!) <= ZERO_SUM_TOLERANCE_CENTS

  for (let mask = 1; mask < size; mask++) {
    const lowBit = mask & -mask
    sums[mask] = sums[mask ^ lowBit]! + members[31 - Math.clz32(lowBit)]!.cents

    let best = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i))
        best = Math.max(best, dp[mask ^ (1 << i)]!)
    }
    dp[mask] = best + (isZero(mask) ? 1 : 0)
  }

  // Walk back from the full mask, cutting a group each time we pass a zero-sum mask.
  const groups: CentsBalance[][] = []
  let current: CentsBalance[] = []
  let mask = size - 1
  while (mask) {
    if (isZero(mask) && current.length) {
      groups.push(current)
      current = []
    }
    const target = dp[mask]! - (isZero(mask) ? 1 : 0)
    for (let i = 0; i < n; i++) {
      const bit = 1 << i
      if ((mask & bit) && dp[mask ^ bit] === target) {
        current.push(members[i]!)
        mask ^= bit
        break
      }
    }
  }
  if (current.length)
    groups.push(current)

  return groups
}

/**
 * Calculate the minimum set of payments to settle all debts.
 *
 * Members are first split into the largest possible number of independent zero-sum groups
 * (e.g. a debtor whose debt exactly matches one creditor's credit), so debtors pay a single
 * person whenever the amounts make that possible. Within each group a greedy pass settles
 * debts, pushing any unavoidable split onto the largest debtor.
 */
export function calculateSettlements(members: Array<{ id: string, balance: number }>): Settlement[] {
  const active: CentsBalance[] = members
    .filter(m => Math.abs(m.balance) > 0.01)
    .map(m => ({ id: m.id, cents: Math.round(m.balance * 100) }))
    .filter(m => m.cents !== 0)

  if (active.length === 0)
    return []

  const groups = active.length <= MAX_MEMBERS_FOR_EXACT_GROUPING
    ? partitionIntoZeroSumGroups(active)
    : [active]

  return groups.flatMap(settleGroupGreedy)
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
