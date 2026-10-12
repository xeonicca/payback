const assert = require('node:assert')
const { test } = require('node:test')
const { contribution, isCounted, totalsDelta } = require('./expenseTotals')

const members = [{ id: 'a' }, { id: 'b' }]
const stamp = { seconds: 1 }

function expense(overrides = {}) {
  return {
    grandTotal: 100,
    enabled: true,
    isProcessing: false,
    sharedWithMemberIds: ['a', 'b'],
    ...overrides,
  }
}

// Totals after applying a sequence of writes, starting from an empty trip
function replay(writes) {
  const totals = { totalExpenses: 0, enabledTotalExpenses: 0, disabledTotalExpenses: 0, expenseCount: 0 }
  const spending = { a: 0, b: 0 }
  for (const [before, after] of writes) {
    const delta = totalsDelta(before, after, members)
    for (const key of Object.keys(totals)) totals[key] += delta.trip[key]
    for (const id of Object.keys(spending)) spending[id] += delta.spending[id]
  }
  return { totals, spending }
}

test('a manually entered expense counts as soon as it is created', () => {
  assert.deepStrictEqual(replay([[null, expense()]]).totals, {
    totalExpenses: 100,
    enabledTotalExpenses: 100,
    disabledTotalExpenses: 0,
    expenseCount: 1,
  })
})

test('a receipt being processed for the first time does not count until it finishes', () => {
  const uploading = expense({ isProcessing: true, grandTotal: 0 })
  assert.strictEqual(isCounted(uploading), false)
  const done = expense({ grandTotal: 240, processedAt: stamp })
  const { totals } = replay([[null, uploading], [uploading, done]])
  assert.strictEqual(totals.totalExpenses, 240)
  assert.strictEqual(totals.expenseCount, 1)
})

test('re-analysing a counted receipt applies only the change in amount', () => {
  const counted = expense({ grandTotal: 17674, processedAt: stamp })
  const reanalysing = { ...counted, isProcessing: true }
  const corrected = { ...counted, grandTotal: 19087 }
  const { totals } = replay([[null, counted], [counted, reanalysing], [reanalysing, corrected]])
  assert.strictEqual(totals.totalExpenses, 19087)
  assert.strictEqual(totals.expenseCount, 1)
})

test('a failed re-analysis leaves the totals unchanged', () => {
  const counted = expense({ processedAt: stamp })
  const reanalysing = { ...counted, isProcessing: true }
  const failed = { ...counted, processingError: 'boom' }
  const { totals } = replay([[null, counted], [counted, reanalysing], [reanalysing, failed]])
  assert.strictEqual(totals.totalExpenses, 100)
  assert.strictEqual(totals.expenseCount, 1)
})

test('deleting an expense in the middle of re-analysis removes it from the totals', () => {
  const counted = expense({ processedAt: stamp })
  const reanalysing = { ...counted, isProcessing: true }
  const { totals, spending } = replay([[null, counted], [counted, reanalysing], [reanalysing, null]])
  assert.deepStrictEqual(totals, { totalExpenses: 0, enabledTotalExpenses: 0, disabledTotalExpenses: 0, expenseCount: 0 })
  assert.deepStrictEqual(spending, { a: 0, b: 0 })
})

test('deleting a receipt that never finished processing changes nothing', () => {
  const uploading = expense({ isProcessing: true })
  const { totals } = replay([[null, uploading], [uploading, null]])
  assert.strictEqual(totals.expenseCount, 0)
  assert.strictEqual(totals.totalExpenses, 0)
})

test('disabling an expense moves it between buckets and drops member spending', () => {
  const on = expense()
  const off = expense({ enabled: false })
  const { totals, spending } = replay([[null, on], [on, off]])
  assert.deepStrictEqual(totals, { totalExpenses: 100, enabledTotalExpenses: 0, disabledTotalExpenses: 100, expenseCount: 1 })
  assert.deepStrictEqual(spending, { a: 0, b: 0 })
})

test('an edit that touches neither amount, sharing nor state produces a zero delta', () => {
  const before = expense()
  const after = expense({ category: 'food' })
  const delta = totalsDelta(before, after, members)
  assert.strictEqual(delta.isZero, true)
})

test('an expense with no amount contributes zero rather than NaN', () => {
  const blank = { isProcessing: false, sharedWithMemberIds: ['a', 'b'] }
  const withBlankItem = expense({ items: [{ name: 'x', sharedByMemberIds: ['a'] }] })
  assert.deepStrictEqual(contribution(blank, members).spending, { a: 0, b: 0 })
  assert.strictEqual(contribution(blank, members).trip.totalExpenses, 0)
  assert.deepStrictEqual(contribution(withBlankItem, members).spending, { a: 0, b: 0 })
})

test('member spending follows item-level sharing', () => {
  const withItems = expense({
    grandTotal: 300,
    items: [
      { name: 'x', price: 200, sharedByMemberIds: ['a'] },
      { name: 'y', price: 100 },
    ],
  })
  assert.deepStrictEqual(contribution(withItems, members).spending, { a: 250, b: 50 })
})
