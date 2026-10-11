const assert = require('node:assert/strict')
const { test } = require('node:test')
const { pageIndexOf, sortPagePaths } = require('../receiptPages')

const resized = name => `trips/t1/expenses/e1/resized/${name}`

test('pageIndexOf reads the page number out of a resized filename', () => {
  assert.equal(pageIndexOf(resized('page-1_1600x1600.jpeg')), 1)
  assert.equal(pageIndexOf(resized('page-12.jpg')), 12)
})

test('pageIndexOf ignores page-like text outside the basename', () => {
  assert.equal(pageIndexOf('trips/my-page-7-trip/expenses/e1/resized/page-2.jpg'), 2)
})

test('pageIndexOf returns a sort-last value for an unnumbered legacy filename', () => {
  assert.equal(pageIndexOf(resized('IMG_4021.jpg')), Number.MAX_SAFE_INTEGER)
})

test('sortPagePaths orders by page number, not arrival order', () => {
  const arrived = [resized('page-3.jpg'), resized('page-1.jpg'), resized('page-2.jpg')]
  assert.deepEqual(sortPagePaths(arrived), [
    resized('page-1.jpg'),
    resized('page-2.jpg'),
    resized('page-3.jpg'),
  ])
})

test('sortPagePaths sorts 10 after 9 (numeric, not lexicographic)', () => {
  const arrived = [resized('page-10.jpg'), resized('page-9.jpg')]
  assert.deepEqual(sortPagePaths(arrived), [resized('page-9.jpg'), resized('page-10.jpg')])
})

test('sortPagePaths puts unnumbered paths last and is stable among them', () => {
  const arrived = [resized('b.jpg'), resized('page-1.jpg'), resized('a.jpg')]
  assert.deepEqual(sortPagePaths(arrived), [
    resized('page-1.jpg'),
    resized('a.jpg'),
    resized('b.jpg'),
  ])
})

test('sortPagePaths does not mutate its input', () => {
  const arrived = [resized('page-2.jpg'), resized('page-1.jpg')]
  sortPagePaths(arrived)
  assert.deepEqual(arrived, [resized('page-2.jpg'), resized('page-1.jpg')])
})
