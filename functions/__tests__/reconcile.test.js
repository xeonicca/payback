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
