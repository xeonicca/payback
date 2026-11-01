// What each expense contributes to its trip's cached totals, and how those
// totals change when an expense is written. The triggers in onExpenseChange.js
// and repair-totals.mjs both use this, so a trip's cached totals always equal
// the sum of contribution() over its expenses.

const TRIP_FIELDS = ['totalExpenses', 'enabledTotalExpenses', 'disabledTotalExpenses', 'expenseCount']

// Each member's share of an expense, using the same formula as the app's
// useTripBalances().getMemberOwedAmount so cached spending matches the balances
// people see:
// - With priced items, each item is split among its sharers (its
//   sharedByMemberIds limited to the expense's sharedWithMemberIds, or everyone
//   on the expense when it lists none), and grandTotal is then distributed in
//   proportion to each member's item share, spreading tax, tips and discounts.
// - Otherwise grandTotal is split evenly across sharedWithMemberIds.
// An expense shared with nobody is charged to nobody. Ids that aren't trip
// members are ignored.
function calculateMemberSpending(expenseData, tripMembers) {
  const memberSpending = Object.fromEntries(tripMembers.map(member => [member.id, 0]))
  const sharedWith = expenseData.sharedWithMemberIds || []
  const grandTotal = expenseData.grandTotal || 0
  const items = expenseData.items || []

  const lineTotal = item => (item.price || 0) * (item.quantity || 1)
  const itemsTotal = items.reduce((sum, item) => sum + lineTotal(item), 0)

  if (items.length > 0 && itemsTotal > 0) {
    const itemShares = {}
    for (const item of items) {
      const sharers = (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0)
        ? sharedWith
        : item.sharedByMemberIds.filter(id => sharedWith.includes(id))
      if (sharers.length === 0)
        continue
      const perMember = lineTotal(item) / sharers.length
      for (const id of sharers)
        itemShares[id] = (itemShares[id] || 0) + perMember
    }
    for (const id of Object.keys(memberSpending))
      memberSpending[id] = grandTotal * ((itemShares[id] || 0) / itemsTotal)
    return memberSpending
  }

  // No items, or items without prices: split the whole expense evenly
  if (sharedWith.length === 0)
    return memberSpending
  const perMember = grandTotal / sharedWith.length
  for (const id of sharedWith) {
    if (memberSpending[id] !== undefined)
      memberSpending[id] += perMember
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
