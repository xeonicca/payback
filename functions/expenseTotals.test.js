const assert = require('node:assert')
const { test } = require('node:test')
const { calculateMemberSpending, contribution, isCounted, totalsDelta } = require('./expenseTotals')

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
  // Items without prices fall back to an even split of grandTotal, like the app
  assert.deepStrictEqual(contribution(withBlankItem, members).spending, { a: 50, b: 50 })
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

// --- calculateMemberSpending matches useTripBalances().getMemberOwedAmount ---

const trio = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

function assertSpending(actual, expected) {
  assert.deepStrictEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
  for (const [id, value] of Object.entries(expected))
    assert.ok(Math.abs(actual[id] - value) < 1e-9, `${id}: expected ${value}, got ${actual[id]}`)
}

test('tax and service charges are spread in proportion to item shares', () => {
  // items sum to 1000, grandTotal 1100 (10% service): a's 600 item → 660, shared 400 → 220 each
  const spending = calculateMemberSpending(expense({
    grandTotal: 1100,
    items: [
      { name: 'steak', price: 600, sharedByMemberIds: ['a'] },
      { name: 'wine', price: 400 },
    ],
  }), members)
  assertSpending(spending, { a: 880, b: 220 })
})

test('discounts are spread in proportion too, and shares sum to grandTotal', () => {
  const spending = calculateMemberSpending(expense({
    grandTotal: 900,
    sharedWithMemberIds: ['a', 'b', 'c'],
    items: [
      { name: 'x', price: 500, sharedByMemberIds: ['a'] },
      { name: 'y', price: 300, sharedByMemberIds: ['b', 'c'] },
      { name: 'z', price: 200 },
    ],
  }), trio)
  // item shares: a 500+66.67, b 150+66.67, c 150+66.67 of 1000, scaled by 0.9
  assertSpending(spending, { a: 510, b: 195, c: 195 })
  assert.ok(Math.abs(spending.a + spending.b + spending.c - 900) < 1e-9)
})

test('item quantity multiplies the line price', () => {
  const spending = calculateMemberSpending(expense({
    grandTotal: 400,
    items: [
      { name: 'beer', price: 100, quantity: 3, sharedByMemberIds: ['a'] },
      { name: 'snack', price: 100, sharedByMemberIds: ['b'] },
    ],
  }), members)
  assertSpending(spending, { a: 300, b: 100 })
})

test('an item with no sharers is split among the expense\'s members, not the whole trip', () => {
  const spending = calculateMemberSpending(expense({
    grandTotal: 100,
    sharedWithMemberIds: ['a', 'b'],
    items: [{ name: 'x', price: 100 }],
  }), trio)
  assertSpending(spending, { a: 50, b: 50, c: 0 })
})

test('item sharers outside the expense are ignored', () => {
  const spending = calculateMemberSpending(expense({
    grandTotal: 100,
    sharedWithMemberIds: ['a', 'b'],
    items: [{ name: 'x', price: 100, sharedByMemberIds: ['a', 'c'] }],
  }), trio)
  assertSpending(spending, { a: 100, b: 0, c: 0 })
})

test('an item shared only by people outside the expense is charged to nobody', () => {
  const spending = calculateMemberSpending(expense({
    grandTotal: 200,
    sharedWithMemberIds: ['a', 'b'],
    items: [
      { name: 'x', price: 100 },
      { name: 'y', price: 100, sharedByMemberIds: ['c'] },
    ],
  }), trio)
  assertSpending(spending, { a: 50, b: 50, c: 0 })
})

test('an expense shared with nobody is charged to nobody', () => {
  assertSpending(calculateMemberSpending(expense({ sharedWithMemberIds: [] }), members), { a: 0, b: 0 })
  assertSpending(calculateMemberSpending(expense({ sharedWithMemberIds: undefined }), members), { a: 0, b: 0 })
})

test('without items, grandTotal is split evenly across the expense\'s members', () => {
  const spending = calculateMemberSpending(expense({ grandTotal: 90, sharedWithMemberIds: ['a', 'b', 'c'] }), trio)
  assertSpending(spending, { a: 30, b: 30, c: 30 })
})

test('ids that are not trip members are ignored', () => {
  const spending = calculateMemberSpending(expense({ grandTotal: 100, sharedWithMemberIds: ['a', 'ghost'] }), members)
  assertSpending(spending, { a: 50, b: 0 })
})

test('re-saving an unchanged proportional expense produces a zero delta', () => {
  const e = expense({
    grandTotal: 1234.56,
    items: [
      { name: 'x', price: 333.33, sharedByMemberIds: ['a'] },
      { name: 'y', price: 777.77 },
    ],
  })
  assert.strictEqual(totalsDelta(e, { ...e, category: 'food' }, members).isZero, true)
})
