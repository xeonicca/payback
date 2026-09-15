const assert = require('node:assert')
const { test } = require('node:test')
const { canModifyExpense } = require('./tripAccess')

const trip = { userId: 'owner', collaboratorUserIds: ['owner', 'editor', 'guest', 'viewer'] }
const expense = { createdByUserId: 'guest' }

test('owner and editor can modify any expense', () => {
  assert.strictEqual(canModifyExpense({ uid: 'owner', trip, collaborator: { role: 'owner' }, expense }), true)
  assert.strictEqual(canModifyExpense({ uid: 'editor', trip, collaborator: { role: 'editor' }, expense: { createdByUserId: 'owner' } }), true)
})

test('guest can modify only their own expense', () => {
  assert.strictEqual(canModifyExpense({ uid: 'guest', trip, collaborator: { role: 'guest' }, expense }), true)
  assert.strictEqual(canModifyExpense({ uid: 'guest', trip, collaborator: { role: 'guest' }, expense: { createdByUserId: 'owner' } }), false)
})

test('read-only collaborator cannot modify anything', () => {
  assert.strictEqual(canModifyExpense({ uid: 'viewer', trip, collaborator: { role: 'editor', readOnly: true }, expense }), false)
})

test('missing collaborator, trip, expense or array entry denies', () => {
  assert.strictEqual(canModifyExpense({ uid: 'stranger', trip, collaborator: null, expense }), false)
  assert.strictEqual(canModifyExpense({ uid: 'owner', trip: null, collaborator: { role: 'owner' }, expense }), false)
  assert.strictEqual(canModifyExpense({ uid: 'owner', trip, collaborator: { role: 'owner' }, expense: null }), false)
  assert.strictEqual(canModifyExpense({ uid: 'orphan', trip, collaborator: { role: 'editor' }, expense }), false)
})
