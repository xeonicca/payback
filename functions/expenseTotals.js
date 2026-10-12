// What each expense contributes to its trip's cached totals, and how those
// totals change when an expense is written. The triggers in onExpenseChange.js
// and repair-totals.mjs both use this, so a trip's cached totals always equal
// the sum of contribution() over its expenses.

const TRIP_FIELDS = ['totalExpenses', 'enabledTotalExpenses', 'disabledTotalExpenses', 'expenseCount']

// Split an expense's cost across members, by item when it has items
function calculateMemberSpending(expenseData, tripMembers) {
  const memberSpending = {}

  // Initialize all members with 0 spending
  tripMembers.forEach((member) => {
    memberSpending[member.id] = 0
  })

  // If expense has items, calculate based on item-level sharing
  if (expenseData.items && expenseData.items.length > 0) {
    expenseData.items.forEach((item) => {
      let sharingMembers = []

      // If item has no specific sharedByMemberIds, all members share it
      if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
        sharingMembers = tripMembers.map(member => member.id)
      }
      else {
        sharingMembers = item.sharedByMemberIds
      }

      // Skip if no members are sharing this item
      if (sharingMembers.length === 0)
        return

      // Calculate price per member for this item
      const pricePerMember = item.price / sharingMembers.length

      // Add the price to each sharing member's total
      sharingMembers.forEach((memberId) => {
        if (memberSpending[memberId] !== undefined) {
          memberSpending[memberId] += pricePerMember
        }
      })
    })
  }
  else {
    // If no items, use sharedWithMemberIds from expense level
    let sharingMembers = []

    // If expense has no specific sharedWithMemberIds, all members share it
    if (!expenseData.sharedWithMemberIds || expenseData.sharedWithMemberIds.length === 0) {
      sharingMembers = tripMembers.map(member => member.id)
    }
    else {
      sharingMembers = expenseData.sharedWithMemberIds
    }

    // Skip if no members are sharing this expense
    if (sharingMembers.length === 0) {
      return memberSpending
    }

    // Calculate price per member for the entire expense
    const pricePerMember = expenseData.grandTotal / sharingMembers.length

    // Add the price to each sharing member's total
    sharingMembers.forEach((memberId) => {
      if (memberSpending[memberId] !== undefined) {
        memberSpending[memberId] = pricePerMember
      }
    })
  }

  return memberSpending
}

/**
 * Whether an expense counts towards its trip's totals. A receipt being read for
 * the first time does not count yet; once any processing run has finished
 * (processedAt is set in the same write that clears isProcessing) it keeps
 * counting, including while it is being re-analysed.
 */
function isCounted(expense) {
  if (!expense)
    return false
  return !expense.isProcessing || expense.processedAt != null
}

/** An expense's share of its trip's totals; all zero when it does not count. */
function contribution(expense, tripMembers) {
  const spending = Object.fromEntries(tripMembers.map(member => [member.id, 0]))
  if (!isCounted(expense)) {
    return {
      trip: { totalExpenses: 0, enabledTotalExpenses: 0, disabledTotalExpenses: 0, expenseCount: 0 },
      spending,
    }
  }

  const amount = expense.grandTotal || 0
  // Missing means enabled, matching expenseConverter on the client
  const enabled = expense.enabled !== false
  // Disabled expenses are excluded from what members spent. Missing amounts
  // count as 0 so a half-written expense can't turn spending into NaN.
  if (enabled) {
    const priced = {
      ...expense,
      grandTotal: amount,
      items: expense.items?.map(item => ({ ...item, price: item.price || 0 })),
    }
    Object.assign(spending, calculateMemberSpending(priced, tripMembers))
  }

  return {
    trip: {
      totalExpenses: amount,
      enabledTotalExpenses: enabled ? amount : 0,
      disabledTotalExpenses: enabled ? 0 : amount,
      expenseCount: 1,
    },
    spending,
  }
}

/**
 * The change to a trip's totals when an expense goes from `before` to `after`.
 * Pass null for `before` on create and for `after` on delete.
 */
function totalsDelta(before, after, tripMembers) {
  const from = contribution(before, tripMembers)
  const to = contribution(after, tripMembers)

  const trip = Object.fromEntries(TRIP_FIELDS.map(field => [field, to.trip[field] - from.trip[field]]))
  const spending = Object.fromEntries(tripMembers.map(member => [
    member.id,
    to.spending[member.id] - from.spending[member.id],
  ]))

  const isZero = TRIP_FIELDS.every(field => trip[field] === 0)
    && Object.values(spending).every(change => change === 0)

  return { trip, spending, isZero }
}

module.exports = { calculateMemberSpending, contribution, isCounted, totalsDelta }
