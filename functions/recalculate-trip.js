/**
 * Recalculates member spending and trip totals from scratch based on existing expenses.
 * Use this after manually deleting/modifying expenses in Firebase console.
 *
 * Usage: node recalculate-trip.js <tripId>
 * Run from functions/ directory.
 */

const admin = require('firebase-admin')
const path = require('path')
// Same per-expense split the onExpenseChange triggers use
const { calculateMemberSpending } = require('./expenseTotals')

const tripId = process.argv[2]
if (!tripId) {
  console.error('Usage: node recalculate-trip.js <tripId>')
  process.exit(1)
}

const serviceAccountPath = path.resolve(__dirname, '../service-account.json')
const serviceAccount = require(serviceAccountPath)

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function recalculate() {
  console.log(`Recalculating trip: ${tripId}`)

  const [membersSnap, expensesSnap] = await Promise.all([
    db.collection(`trips/${tripId}/members`).get(),
    db.collection(`trips/${tripId}/expenses`).get(),
  ])

  const tripMembers = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  console.log(`Found ${tripMembers.length} members, ${expenses.length} expenses`)

  // Totals to recalculate
  let totalExpenses = 0
  let enabledTotalExpenses = 0
  let disabledTotalExpenses = 0
  let expenseCount = 0
  const memberSpendingTotals = {}
  tripMembers.forEach(m => (memberSpendingTotals[m.id] = 0))

  for (const expense of expenses) {
    if (expense.isProcessing) {
      console.log(`  Skipping processing expense: ${expense.id}`)
      continue
    }

    expenseCount++
    totalExpenses += expense.grandTotal || 0

    if (expense.enabled) {
      enabledTotalExpenses += expense.grandTotal || 0
      const spending = calculateMemberSpending(expense, tripMembers)
      for (const [memberId, amount] of Object.entries(spending)) {
        if (memberSpendingTotals[memberId] !== undefined)
          memberSpendingTotals[memberId] += amount
      }
    }
    else {
      disabledTotalExpenses += expense.grandTotal || 0
    }
  }

  console.log('\nRecalculated totals:')
  console.log(`  totalExpenses: ${totalExpenses}`)
  console.log(`  enabledTotalExpenses: ${enabledTotalExpenses}`)
  console.log(`  disabledTotalExpenses: ${disabledTotalExpenses}`)
  console.log(`  expenseCount: ${expenseCount}`)
  console.log('\nMember spending:')
  tripMembers.forEach(m =>
    console.log(`  ${m.name} (${m.id}): ${memberSpendingTotals[m.id].toFixed(2)}`),
  )

  // Write everything in a single transaction
  await db.runTransaction(async (transaction) => {
    const tripRef = db.doc(`trips/${tripId}`)
    transaction.update(tripRef, {
      totalExpenses,
      enabledTotalExpenses,
      disabledTotalExpenses,
      expenseCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    for (const [memberId, spending] of Object.entries(memberSpendingTotals)) {
      const memberRef = db.doc(`trips/${tripId}/members/${memberId}`)
      transaction.update(memberRef, { spending })
    }
  })

  console.log('\nDone. All values updated successfully.')
}

recalculate().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
