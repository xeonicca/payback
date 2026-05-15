/**
 * Verify "已支付" and "我花了" totals for a given user on a given trip.
 *
 * Mirrors the UI logic in composables/useTripBalances.ts:
 *   - paid  = sum of grandTotal across enabled expenses where paidByMemberId == me
 *   - owed  = sum of grandTotal * (myItemsTotal / itemsTotal) across enabled expenses
 *             that include me (fallback to flat split when items have no usable price
 *             or expense has no items)
 *
 * Usage: node verify-my-totals.js <tripId> <userId>
 */

const admin = require('firebase-admin')
const path = require('path')

const tripId = process.argv[2]
const userId = process.argv[3]
if (!tripId || !userId) {
  console.error('Usage: node verify-my-totals.js <tripId> <userId>')
  process.exit(1)
}

const serviceAccountPath = path.resolve(__dirname, '../service-account.json')
const serviceAccount = require(serviceAccountPath)

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

function calculateMemberOwed(expense, myId) {
  if (expense.items && expense.items.length > 0) {
    const itemsTotal = expense.items.reduce(
      (sum, item) => sum + (item.price * (item.quantity || 1)),
      0,
    )

    if (itemsTotal > 0) {
      let myItemsTotal = 0
      for (const item of expense.items) {
        let sharingMembers
        if (!item.sharedByMemberIds || item.sharedByMemberIds.length === 0) {
          sharingMembers = expense.sharedWithMemberIds
        }
        else {
          sharingMembers = item.sharedByMemberIds.filter(id =>
            expense.sharedWithMemberIds.includes(id),
          )
        }
        if (sharingMembers.length === 0 || !sharingMembers.includes(myId)) continue
        const lineTotal = item.price * (item.quantity || 1)
        myItemsTotal += lineTotal / sharingMembers.length
      }
      const proportion = myItemsTotal / itemsTotal
      return { owed: expense.grandTotal * proportion, mode: 'items' }
    }
    else {
      // Items exist but no usable prices → flat split fallback
      if (!expense.sharedWithMemberIds.includes(myId))
        return { owed: 0, mode: 'flat-fallback' }
      return {
        owed: expense.grandTotal / expense.sharedWithMemberIds.length,
        mode: 'flat-fallback',
      }
    }
  }
  else {
    if (!expense.sharedWithMemberIds.includes(myId))
      return { owed: 0, mode: 'flat' }
    return {
      owed: expense.grandTotal / expense.sharedWithMemberIds.length,
      mode: 'flat',
    }
  }
}

async function run() {
  console.log(`Trip: ${tripId}`)
  console.log(`User: ${userId}\n`)

  const [tripSnap, membersSnap, expensesSnap] = await Promise.all([
    db.doc(`trips/${tripId}`).get(),
    db.collection(`trips/${tripId}/members`).get(),
    db.collection(`trips/${tripId}/expenses`).get(),
  ])

  if (!tripSnap.exists) {
    console.error('Trip not found.')
    process.exit(1)
  }

  const trip = tripSnap.data()
  const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  console.log(`Trip name: ${trip.name}`)
  console.log(`Trip currency: ${trip.tripCurrency}  exchangeRate: ${trip.exchangeRate}`)
  console.log(`Members: ${members.length}  Expenses: ${expenses.length}\n`)

  const me = members.find(m => m.linkedUserId === userId)
  if (!me) {
    console.error(`No member is linked to user ${userId} on this trip.`)
    console.log('\nAvailable members:')
    members.forEach(m =>
      console.log(`  - ${m.name} (id=${m.id}) linkedUserId=${m.linkedUserId || '(none)'}`),
    )
    process.exit(1)
  }
  console.log(`Linked member: ${me.name} (id=${me.id})`)
  console.log(`  member.spending (Firestore field): ${(me.spending || 0).toFixed(2)}\n`)

  const enabled = expenses.filter(e => e.enabled && !e.isProcessing)
  const disabled = expenses.filter(e => !e.enabled)
  console.log(`Enabled expenses: ${enabled.length}, disabled: ${disabled.length}\n`)

  let paid = 0
  let owed = 0
  const paidRows = []
  const owedRows = []

  for (const e of enabled) {
    if (e.paidByMemberId === me.id) {
      paid += e.grandTotal || 0
      paidRows.push({ id: e.id, desc: e.description, amount: e.grandTotal })
    }
    const { owed: contrib, mode } = calculateMemberOwed(e, me.id)
    if (contrib > 0) {
      owed += contrib
      owedRows.push({ id: e.id, desc: e.description, share: contrib, mode, total: e.grandTotal })
    }
  }

  console.log('=== 已支付 (paid) ===')
  paidRows.forEach(r =>
    console.log(`  ${r.amount.toFixed(2)}  ${r.desc || '(no description)'}  [${r.id}]`),
  )
  console.log(`  ---`)
  console.log(`  TOTAL paid (trip currency ${trip.tripCurrency}): ${paid.toFixed(2)}`)
  console.log(`  TOTAL paid (home  currency ${trip.defaultCurrency || 'TWD'}): ${(paid * trip.exchangeRate).toFixed(2)}`)

  console.log('\n=== 我花了 (owed / consumption share) ===')
  owedRows.forEach(r =>
    console.log(`  ${r.share.toFixed(2)} / ${r.total.toFixed(2)}  [${r.mode}]  ${r.desc || '(no description)'}  [${r.id}]`),
  )
  console.log(`  ---`)
  console.log(`  TOTAL owed (trip currency ${trip.tripCurrency}): ${owed.toFixed(2)}`)
  console.log(`  TOTAL owed (home  currency ${trip.defaultCurrency || 'TWD'}): ${(owed * trip.exchangeRate).toFixed(2)}`)

  console.log('\n=== Compare ===')
  console.log(`  member.spending field    : ${(me.spending || 0).toFixed(2)}  (raw item-sum, no proportional tax/tip)`)
  console.log(`  useTripBalances.owed     : ${owed.toFixed(2)}  (proportional, what the UI shows)`)
  console.log(`  diff                     : ${(owed - (me.spending || 0)).toFixed(2)}`)
}

run().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
