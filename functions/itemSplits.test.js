const assert = require('node:assert')
const { test } = require('node:test')
const { carryOverItemSplits } = require('./itemSplits')

const item = (name, price, extra = {}) => ({ name, price, quantity: 1, ...extra })
const split = (name, price, ids, extra = {}) => item(name, price, { sharedByMemberIds: ids, ...extra })
const splitsOf = items => items.map(i => i.sharedByMemberIds)

test('copies a split onto the re-read line with the same name and price', () => {
  const { items, carried, lost } = carryOverItemSplits(
    [split('Gラテ', 530, ['m1']), split('アイスアメリカーノ', 490, ['m2'])],
    [item('Gラテ', 530), item('アイスアメリカーノ', 490)],
  )
  assert.deepStrictEqual(splitsOf(items), [['m1'], ['m2']])
  assert.strictEqual(carried, 2)
  assert.strictEqual(lost, 0)
})

// The new model fixes OCR mistakes and drops code prefixes, so names drift
test('matches on price when the re-read spells the name differently', () => {
  const { items, lost } = carryOverItemSplits(
    [split('アニマル デイリーハーフ', 2178, ['m1']), split('0030レーズンクィーン軽', 151, ['m2']), split('養樂多', 159, ['m3'])],
    [item('アシマル デイリーハーフ', 2178), item('レーズンクィーン', 151), item('Y1000', 159)],
  )
  assert.deepStrictEqual(splitsOf(items), [['m1'], ['m2'], ['m3']])
  assert.strictEqual(lost, 0)
})

test('uses the name to tell apart products at the same price', () => {
  const { items } = carryOverItemSplits(
    [split('乾しいたけ', 600, ['m1']), split('アソパトン', 600, ['m2'])],
    [item('アソパトン 3個入り', 600), item('乾しいたけ', 600)],
  )
  assert.deepStrictEqual(splitsOf(items), [['m2'], ['m1']])
})

test('does not match a line whose price changed', () => {
  const { items, lost } = carryOverItemSplits(
    [split('コーヒー', 300, ['m1'])],
    [item('コーヒー', 350)],
  )
  assert.strictEqual(items[0].sharedByMemberIds, undefined)
  assert.strictEqual(lost, 1)
})

test('lines the user never split stay unsplit', () => {
  const { items, carried } = carryOverItemSplits(
    [item('水', 118), split('牛乳', 281, ['m1'])],
    [item('水', 118), item('牛乳', 281)],
  )
  assert.deepStrictEqual(splitsOf(items), [undefined, ['m1']])
  assert.strictEqual(carried, 1)
})

test('a merged line keeps the split when every old line agreed', () => {
  const { items } = carryOverItemSplits(
    [split('天草サブレ', 1000, ['m1', 'm2']), split('天草サブレ', 1000, ['m2', 'm1'])],
    [item('天草サブレ', 1000, { quantity: 2, lineTotal: 2000 })],
  )
  assert.strictEqual(items.length, 1)
  assert.deepStrictEqual(items[0].sharedByMemberIds, ['m1', 'm2'])
  assert.strictEqual(items[0].quantity, 2)
})

test('a merged line whose units belonged to different people is split back out', () => {
  const { items, carried, lost } = carryOverItemSplits(
    [split('アソパトン', 600, ['m1']), split('アソパトン', 600, ['m2']), split('アソパトン', 600, ['m3'])],
    [item('アソパトン 3個入り', 600, { quantity: 3, lineTotal: 1800 })],
  )
  assert.deepStrictEqual(items.map(i => [i.sharedByMemberIds, i.quantity, i.lineTotal]), [
    [['m1'], 1, 600],
    [['m2'], 1, 600],
    [['m3'], 1, 600],
  ])
  assert.strictEqual(carried, 3)
  assert.strictEqual(lost, 0)
})

test('a quantity line split across lines on the new read keeps its split', () => {
  const { items } = carryOverItemSplits(
    [split('おにぎり', 150, ['m1'], { quantity: 2 })],
    [item('おにぎり', 150), item('おにぎり', 150)],
  )
  assert.deepStrictEqual(splitsOf(items), [['m1'], ['m1']])
})

test('the re-read total is unchanged when a line is split back out', () => {
  const { items } = carryOverItemSplits(
    [split('栗', 680, ['m1']), item('栗', 680)],
    [item('栗', 680, { quantity: 2, lineTotal: 1360 })],
  )
  const sum = items.reduce((t, i) => t + i.lineTotal, 0)
  assert.strictEqual(sum, 1360)
  assert.deepStrictEqual(splitsOf(items), [['m1'], undefined])
})

test('new lines the receipt never had are left alone', () => {
  const { items } = carryOverItemSplits(
    [split('A', 100, ['m1'])],
    [item('A', 100), item('B', 200)],
  )
  assert.deepStrictEqual(splitsOf(items), [['m1'], undefined])
})

test('keeps every other field the new read produced', () => {
  const { items } = carryOverItemSplits(
    [split('A', 100, ['m1'], { translatedName: 'old', lineTotal: 90 })],
    [item('A', 100, { translatedName: 'new', lineTotal: 100, itemNumber: '7' })],
  )
  assert.deepStrictEqual(items[0], { name: 'A', price: 100, quantity: 1, translatedName: 'new', lineTotal: 100, itemNumber: '7', sharedByMemberIds: ['m1'] })
})

test('handles missing item lists', () => {
  assert.deepStrictEqual(carryOverItemSplits(undefined, [item('A', 1)]).items, [item('A', 1)])
  assert.deepStrictEqual(carryOverItemSplits([split('A', 1, ['m1'])], undefined).items, [])
})
