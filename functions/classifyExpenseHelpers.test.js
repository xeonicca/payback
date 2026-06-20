const assert = require('node:assert')
const { test } = require('node:test')
const { buildClassifyPrompt, parseClassifyResponse } = require('./classifyExpenseHelpers')

test('buildClassifyPrompt lists every category key and the input descriptions', () => {
  const prompt = buildClassifyPrompt([{ id: 'a', description: '計程車到機場' }])
  for (const key of ['food', 'groceries', 'transport', 'lodging', 'activities', 'shopping', 'other'])
    assert.ok(prompt.includes(key), `prompt should mention ${key}`)
  assert.ok(prompt.includes('計程車到機場'))
  assert.ok(prompt.includes('"id":"a"') || prompt.includes('"id": "a"'))
})

test('parseClassifyResponse coerces unknown categories and preserves ids', () => {
  const items = [{ id: 'a', description: 'x' }, { id: 'b', description: 'y' }]
  const text = JSON.stringify({ results: [
    { id: 'a', category: 'transport' },
    { id: 'b', category: 'garbage' },
  ] })
  assert.deepStrictEqual(parseClassifyResponse(text, items), [
    { id: 'a', category: 'transport' },
    { id: 'b', category: 'other' },
  ])
})

test('parseClassifyResponse fills missing ids with other', () => {
  const items = [{ id: 'a', description: 'x' }, { id: 'b', description: 'y' }]
  const text = JSON.stringify({ results: [{ id: 'a', category: 'food' }] })
  assert.deepStrictEqual(parseClassifyResponse(text, items), [
    { id: 'a', category: 'food' },
    { id: 'b', category: 'other' },
  ])
})
