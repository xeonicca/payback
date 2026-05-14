const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reconcileReceipt, REASON_CODES } = require('../reconcile')

test('exports a function and reason-code constants', () => {
  assert.equal(typeof reconcileReceipt, 'function')
  assert.ok(REASON_CODES.GRAND_TOTAL_MISMATCH)
  assert.ok(REASON_CODES.ITEM_COUNT_MISMATCH)
  assert.ok(REASON_CODES.SUBTOTAL_MISMATCH)
  assert.ok(REASON_CODES.ITEM_LINE_TOTAL_MISMATCH)
  assert.ok(REASON_CODES.CURRENCY_UNEXPECTED)
  assert.ok(REASON_CODES.ITEM_UNIT_PRICE_CORRECTED)
})

test('returns parsedData with needsReview false and empty reasons when nothing is wrong', () => {
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 50, quantity: 2, lineTotal: 100 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(result.needsReview, false)
  assert.deepEqual(result.reviewReasons, [])
  assert.equal(result.items[0].price, 50)
})

test('Check 1: auto-corrects unit price when model writes lineTotal into price slot', () => {
  // qty 3, lineTotal 300, but model wrote price=300 instead of 100
  const input = {
    grandTotal: 300,
    items: [{ name: 'a', price: 300, quantity: 3, lineTotal: 300 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(result.items[0].price, 100)
  assert.ok(result.reviewReasons.includes(REASON_CODES.ITEM_UNIT_PRICE_CORRECTED))
  assert.equal(result.needsReview, false, 'info-only code does not flip needsReview')
})

test('Check 1: flags genuine line-total mismatch without auto-correcting', () => {
  // qty 2 * 50 = 100, but receipt says lineTotal 120 — model misread something
  const input = {
    grandTotal: 120,
    items: [{ name: 'a', price: 50, quantity: 2, lineTotal: 120 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(result.items[0].price, 50, 'no auto-correct')
  assert.ok(result.reviewReasons.includes(REASON_CODES.ITEM_LINE_TOTAL_MISMATCH))
  assert.equal(result.needsReview, true)
})

test('Check 1: tolerates 2% rounding noise', () => {
  // 33.33 * 3 = 99.99 vs lineTotal 100 — within tolerance
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 33.33, quantity: 3, lineTotal: 100 }],
    currency: 'USD',
  }
  const result = reconcileReceipt(input, 'USD')
  assert.deepEqual(result.reviewReasons, [])
})

test('Check 1: skips items with null lineTotal', () => {
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 50, quantity: 2, lineTotal: null }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.deepEqual(result.reviewReasons, [])
})
