const assert = require('node:assert')
const { test } = require('node:test')
const { CATEGORY_KEYS, coerceCategory, categoryEnum } = require('./categories')

test('CATEGORY_KEYS matches the app-side contract', () => {
  assert.deepStrictEqual(CATEGORY_KEYS, [
    'food',
    'groceries',
    'transport',
    'lodging',
    'activities',
    'shopping',
    'other',
  ])
})

test('coerceCategory keeps known keys and defaults the rest to other', () => {
  assert.strictEqual(coerceCategory('lodging'), 'lodging')
  assert.strictEqual(coerceCategory('FOOD'), 'other')
  assert.strictEqual(coerceCategory(''), 'other')
  assert.strictEqual(coerceCategory(undefined), 'other')
  assert.strictEqual(coerceCategory(null), 'other')
})

test('categoryEnum parses a valid key and rejects an invalid one', () => {
  assert.strictEqual(categoryEnum.parse('food'), 'food')
  assert.throws(() => categoryEnum.parse('nope'))
})
