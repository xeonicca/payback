const assert = require('node:assert/strict')
const { test } = require('node:test')
const { generatePrompt, pageLabel, receiptSchema, prepareFirestoreUpdateData } = require('../receiptAnalysis')

test('a single-image prompt says nothing about multiple images', () => {
  const prompt = generatePrompt('JPY', 'TWD', 1)
  assert.equal(prompt.includes('MULTI-IMAGE RECEIPT'), false)
  assert.equal(prompt.includes('pageBreakUncertain'), false)
  assert.ok(prompt.includes('Analyze the provided receipt image'))
})

test('generatePrompt defaults to the single-image form when no count is given', () => {
  assert.equal(generatePrompt('JPY', 'TWD'), generatePrompt('JPY', 'TWD', 1))
})

test('a multi-image prompt states the page count and the seam rules', () => {
  const prompt = generatePrompt('JPY', 'TWD', 3)
  assert.ok(prompt.includes('MULTI-IMAGE RECEIPT (3 IMAGES)'))
  assert.ok(prompt.includes('ONE continuous receipt'))
  assert.ok(prompt.includes('OVERLAP'), 'must warn about double-counting overlapping lines')
  assert.ok(prompt.includes('CUTS a line'), 'must explain a line cut at the bottom edge')
  assert.ok(prompt.includes('pageBreakUncertain'), 'must name the escape hatch')
  assert.ok(prompt.includes('IMAGE 3'), 'must identify the final image')
})

test('a multi-image prompt keeps all ten single-image rules', () => {
  const single = generatePrompt('JPY', 'TWD', 1)
  const multi = generatePrompt('JPY', 'TWD', 3)
  for (const marker of ['MULTI-LINE ITEM NAMES', 'printedItemCount', 'CURRENCY — DETECT FROM RECEIPT', 'CATEGORY']) {
    assert.ok(single.includes(marker), `single prompt lost ${marker}`)
    assert.ok(multi.includes(marker), `multi prompt lost ${marker}`)
  }
})

test('pageLabel returns null for a single image', () => {
  assert.equal(pageLabel(0, 1), null)
})

test('pageLabel tells each image which edges it joins', () => {
  assert.ok(pageLabel(0, 3).includes('IMAGE 1 of 3'))
  assert.ok(pageLabel(0, 3).includes('continues onto IMAGE 2'))

  assert.ok(pageLabel(1, 3).includes('continues from IMAGE 1'))
  assert.ok(pageLabel(1, 3).includes('continues onto IMAGE 3'))

  assert.ok(pageLabel(2, 3).includes('continues from IMAGE 2'))
  assert.ok(pageLabel(2, 3).includes('final section'))
  assert.equal(pageLabel(2, 3).includes('continues onto'), false)
})

test('receiptSchema accepts pageBreakUncertain', () => {
  assert.ok('pageBreakUncertain' in receiptSchema.shape)
})

test('prepareFirestoreUpdateData does not persist the raw pageBreakUncertain flag', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], category: 'food', paidAtString: null, currency: 'TWD', pageBreakUncertain: true },
    'TWD',
  )
  assert.equal('pageBreakUncertain' in out, false, 'the signal belongs in reviewReasons')
})
