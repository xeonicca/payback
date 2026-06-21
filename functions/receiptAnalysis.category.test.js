const assert = require('node:assert')
const { test } = require('node:test')
const { prepareFirestoreUpdateData, receiptSchema } = require('./receiptAnalysis')

test('receiptSchema includes a category field', () => {
  assert.ok('category' in receiptSchema.shape, 'receiptSchema.shape.category should exist')
})

test('prepareFirestoreUpdateData passes a valid category through', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], category: 'food', paidAtString: null, currency: 'TWD' },
    'TWD',
  )
  assert.strictEqual(out.category, 'food')
})

test('prepareFirestoreUpdateData coerces an unknown category to other', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], category: 'garbage', paidAtString: null, currency: 'TWD' },
    'TWD',
  )
  assert.strictEqual(out.category, 'other')
})

test('prepareFirestoreUpdateData defaults a missing category to other', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], paidAtString: null, currency: 'TWD' },
    'TWD',
  )
  assert.strictEqual(out.category, 'other')
})

test('prepareFirestoreUpdateData omits category when preserveCategory is set', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], category: 'food', paidAtString: null, currency: 'TWD' },
    'TWD',
    null,
    { preserveCategory: true },
  )
  assert.ok(!('category' in out), 'category should be absent so the existing value is kept')
})
