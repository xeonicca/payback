const { z } = require('zod')

// MUST stay in sync with utils/categories.ts CATEGORY_KEYS.
const CATEGORY_KEYS = [
  'food',
  'groceries',
  'transport',
  'lodging',
  'activities',
  'shopping',
  'other',
]

const categoryEnum = z.enum(CATEGORY_KEYS)

function coerceCategory(value) {
  return CATEGORY_KEYS.includes(value) ? value : 'other'
}

module.exports = { CATEGORY_KEYS, categoryEnum, coerceCategory }
