/**
 * Recomputes trip totals (totalExpenses, enabledTotalExpenses,
 * disabledTotalExpenses, expenseCount) and member `spending` from the expense
 * documents — the source of truth — and repairs the incrementally-maintained
 * caches where they have drifted. It uses contribution() from expenseTotals.js,
 * the same rule the onExpenseChange triggers apply, so a repaired trip stays
 * in step with them.
 *
 * Usage: node repair-totals.mjs            # dry run, prints the drift
 *        node repair-totals.mjs --apply    # writes the corrections
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const { contribution } = createRequire(import.meta.url)('./expenseTotals.js')
const here = path.dirname(fileURLToPath(import.meta.url))
const sa = JSON.parse(readFileSync(path.resolve(here, '../service-account.json'), 'utf8'))
initializeApp({ credential: cert(sa) })
const db = getFirestore()

const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.01

const trips = await db.collection('trips').get()
let drifted = 0
const writes = []

for (const tripDoc of trips.docs) {
  const trip = tripDoc.data()
  const [expensesSnap, membersSnap] = await Promise.all([
    tripDoc.ref.collection('expenses').get(),
    tripDoc.ref.collection('members').get(),
  ])
  const expenses = expensesSnap.docs.map(d => d.data())
  const memberIds = membersSnap.docs.map(d => d.id)

  // Same per-expense rule the triggers apply, summed over the trip
  const members = memberIds.map(id => ({ id }))
  let total = 0, enabled = 0, disabled = 0, count = 0
  const spending = Object.fromEntries(memberIds.map(id => [id, 0]))
  for (const e of expenses) {
    const c = contribution(e, members)
    total += c.trip.totalExpenses
    enabled += c.trip.enabledTotalExpenses
    disabled += c.trip.disabledTotalExpenses
    count += c.trip.expenseCount
    for (const id of memberIds) spending[id] += c.spending[id]
  }

  const fixes = {}
  if (!near(trip.totalExpenses, total)) fixes.totalExpenses = total
  if (!near(trip.enabledTotalExpenses, enabled)) fixes.enabledTotalExpenses = enabled
  if (!near(trip.disabledTotalExpenses, disabled)) fixes.disabledTotalExpenses = disabled
  if ((trip.expenseCount ?? 0) !== count) fixes.expenseCount = count

  const memberFixes = membersSnap.docs
    .filter(m => !near(m.data().spending, spending[m.id]))
    .map(m => ({ ref: m.ref, name: m.data().name, from: m.data().spending ?? 0, to: spending[m.id] }))

  if (Object.keys(fixes).length === 0 && memberFixes.length === 0)
    continue

  drifted++
  console.log(`\n${tripDoc.id}  ${trip.name}  (${expenses.length} expenses, ${memberIds.length} members)`)
  for (const [k, v] of Object.entries(fixes))
    console.log(`  ${k}: ${Number(trip[k] ?? 0).toFixed(2)} -> ${Number(v).toFixed(2)}`)
  for (const m of memberFixes)
    console.log(`  member ${m.name}.spending: ${m.from.toFixed(2)} -> ${m.to.toFixed(2)}`)

  if (Object.keys(fixes).length)
    writes.push({ ref: tripDoc.ref, data: fixes })
  for (const m of memberFixes)
    writes.push({ ref: m.ref, data: { spending: m.to } })
}

console.log(`\n${drifted} of ${trips.size} trips drifted; ${writes.length} document(s) to update.`)

if (!APPLY) {
  console.log('DRY RUN — nothing written. Re-run with --apply to repair.')
  process.exit(0)
}

let batch = db.batch()
let n = 0
for (const w of writes) {
  batch.update(w.ref, w.data)
  if (++n % 400 === 0) {
    await batch.commit()
    batch = db.batch()
  }
}
if (n % 400 !== 0)
  await batch.commit()
console.log(`APPLIED ${writes.length} update(s).`)
process.exit(0)
