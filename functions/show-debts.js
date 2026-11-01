/**
 * Shows debt relationships for a trip using the same logic as the app.
 * Usage: node show-debts.js <tripId>
 */

const admin = require('firebase-admin')
const path = require('path')

const tripId = process.argv[2]
if (!tripId) {
  console.error('Usage: node show-debts.js <tripId>')
  process.exit(1)
}

const serviceAccount = require(path.resolve(__dirname, '../service-account.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

function getMemberOwedAmount(memberId, enabledExpenses) {
  let totalOwed = 0

  for (const expense of enabledExpenses) {
    if (expense.items && expense.items.length > 0) {
      const itemsTotal = expense.items.reduce(
        (sum, item) => sum + item.price * (item.quantity || 1),
        0,
      )

      if (itemsTotal > 0) {
        let memberItemsTotal = 0
        for (const item of expense.items) {
          let sharingMembers = []
          if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
            sharingMembers = expense.sharedWithMemberIds
          }
          else {
            sharingMembers = item.sharedByMemberIds.filter(id =>
              expense.sharedWithMemberIds.includes(id),
            )
          }
          if (sharingMembers.length === 0 || !sharingMembers.includes(memberId)) continue
          const itemTotal = item.price * (item.quantity || 1)
          memberItemsTotal += itemTotal / sharingMembers.length
        }
        const memberProportion = memberItemsTotal / itemsTotal
        totalOwed += expense.grandTotal * memberProportion
      }
      else {
        if (expense.sharedWithMemberIds.includes(memberId)) {
          totalOwed += expense.grandTotal / expense.sharedWithMemberIds.length
        }
      }
    }
    else {
      if (expense.sharedWithMemberIds.includes(memberId)) {
        totalOwed += expense.grandTotal / expense.sharedWithMemberIds.length
      }
    }
  }

  return totalOwed
}

// --- Settlement: plain-JS port of calculateSettlements in utils/debt.ts. Keep in sync. ---

const MAX_MEMBERS_FOR_EXACT_GROUPING = 18
const ZERO_SUM_TOLERANCE_CENTS = 1

// Greedy within one group (cents): smallest debtors first, largest creditors first,
// so unavoidable splits land on the largest debtor.
function settleGroupGreedy(group) {
  const results = []
  const debtors = group
    .filter(m => m.cents < 0)
    .sort((a, b) => b.cents - a.cents)
    .map(m => ({ id: m.id, remaining: -m.cents }))
  const creditors = group
    .filter(m => m.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .map(m => ({ id: m.id, remaining: m.cents }))

  for (const debtor of debtors) {
    for (const creditor of creditors) {
      if (debtor.remaining < 1 || creditor.remaining < 1) continue
      const amount = Math.min(debtor.remaining, creditor.remaining)
      results.push({ fromId: debtor.id, toId: creditor.id, amount: amount / 100 })
      debtor.remaining -= amount
      creditor.remaining -= amount
    }
  }
  return results
}

// Split members into the maximum number of disjoint zero-sum groups (bitmask DP),
// so debtors pay a single person whenever the amounts allow it.
function partitionIntoZeroSumGroups(members) {
  const n = members.length
  const size = 1 << n
  const sums = new Float64Array(size)
  const dp = new Int8Array(size)
  const isZero = mask => Math.abs(sums[mask]) <= ZERO_SUM_TOLERANCE_CENTS

  for (let mask = 1; mask < size; mask++) {
    const lowBit = mask & -mask
    sums[mask] = sums[mask ^ lowBit] + members[31 - Math.clz32(lowBit)].cents
    let best = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) best = Math.max(best, dp[mask ^ (1 << i)])
    }
    dp[mask] = best + (isZero(mask) ? 1 : 0)
  }

  const groups = []
  let current = []
  let mask = size - 1
  while (mask) {
    if (isZero(mask) && current.length) {
      groups.push(current)
      current = []
    }
    const target = dp[mask] - (isZero(mask) ? 1 : 0)
    for (let i = 0; i < n; i++) {
      const bit = 1 << i
      if ((mask & bit) && dp[mask ^ bit] === target) {
        current.push(members[i])
        mask ^= bit
        break
      }
    }
  }
  if (current.length) groups.push(current)
  return groups
}

function calculateSettlements(members) {
  const active = members
    .filter(m => Math.abs(m.balance) > 0.01)
    .map(m => ({ id: m.id, cents: Math.round(m.balance * 100) }))
    .filter(m => m.cents !== 0)
  if (active.length === 0) return []
  const groups = active.length <= MAX_MEMBERS_FOR_EXACT_GROUPING
    ? partitionIntoZeroSumGroups(active)
    : [active]
  return groups.flatMap(settleGroupGreedy)
}

async function main() {
  const [membersSnap, expensesSnap] = await Promise.all([
    db.collection(`trips/${tripId}/members`).get(),
    db.collection(`trips/${tripId}/expenses`).get(),
  ])

  const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const enabledExpenses = expensesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.enabled && !e.isProcessing)

  // Calculate balances
  const balances = members.map((m) => {
    const paid = enabledExpenses
      .filter(e => e.paidByMemberId === m.id)
      .reduce((sum, e) => sum + e.grandTotal, 0)
    const owed = getMemberOwedAmount(m.id, enabledExpenses)
    return { ...m, paid, owed, balance: paid - owed }
  })

  console.log('=== Member Balances ===')
  balances.forEach(({ name, paid, owed, balance }) => {
    const sign = balance > 0.01 ? '+' : ''
    console.log(`  ${name}: paid ${paid.toFixed(0)}, owed ${owed.toFixed(0)}, balance ${sign}${balance.toFixed(0)}`)
  })

  const nameById = Object.fromEntries(balances.map(m => [m.id, m.name]))
  const settlements = calculateSettlements(balances.map(m => ({ id: m.id, balance: m.balance })))
    .map(s => ({ from: nameById[s.fromId], to: nameById[s.toId], amount: s.amount }))

  console.log('\n=== Settlements ===')
  if (settlements.length === 0) {
    console.log('  All settled!')
  }
  else {
    settlements.forEach(({ from, to, amount }) => {
      console.log(`  ${from}  →  ${to}  : ${Math.round(amount).toLocaleString()}`)
    })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
