import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { PROJECT_ID } from './helpers'

let env: RulesTestEnvironment

function as(uid: string, provider = 'google.com') {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore()
}

const newExpense = (uid: string) => ({ description: 'Coffee', grandTotal: 10, createdByUserId: uid })

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'trips/t1'), {
      name: 'Trip',
      userId: 'owner',
      collaboratorUserIds: ['owner', 'editor', 'guest', 'viewer'],
    })
    const collaborator = (uid: string, role: string, readOnly = false) =>
      setDoc(doc(db, `trips/t1/collaborators/${uid}`), { userId: uid, role, readOnly })
    await collaborator('owner', 'owner')
    await collaborator('editor', 'editor')
    await collaborator('guest', 'guest')
    await collaborator('viewer', 'editor', true)
    // Half-joined (gap 3): collaborator doc exists but uid is not in collaboratorUserIds
    await collaborator('orphan', 'editor')
    await setDoc(doc(db, 'trips/t1/members/m-viewer'), { name: 'Viewer', avatarEmoji: '🐭', linkedUserId: 'viewer', spending: 0 })
    await setDoc(doc(db, 'trips/t1/expenses/e-owner'), { description: 'Dinner', grandTotal: 100, createdByUserId: 'owner' })
    await setDoc(doc(db, 'trips/t1/expenses/e-guest'), { description: 'Taxi', grandTotal: 50, createdByUserId: 'guest' })
    await setDoc(doc(db, 'invitations/inv1'), { tripId: 't1', invitationCode: 'CODE1', status: 'pending' })
  })
})

afterAll(async () => {
  await env.cleanup()
})

describe('invitations', () => {
  it('cannot be listed or read without signing in', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(db, 'invitations')))
    await assertFails(getDoc(doc(db, 'invitations/inv1')))
  })

  it('cannot be listed or read by a non-owner collaborator', async () => {
    await assertFails(getDocs(collection(as('editor'), 'invitations')))
    await assertFails(getDoc(doc(as('editor'), 'invitations/inv1')))
  })

  it('can be read by the trip owner', async () => {
    await assertSucceeds(getDoc(doc(as('owner'), 'invitations/inv1')))
  })
})

describe('expenses', () => {
  it('editor and guest can create', async () => {
    await assertSucceeds(addDoc(collection(as('editor'), 'trips/t1/expenses'), newExpense('editor')))
    await assertSucceeds(addDoc(collection(as('guest', 'anonymous'), 'trips/t1/expenses'), newExpense('guest')))
  })

  it('read-only collaborator can read but not create, update or delete', async () => {
    const db = as('viewer')
    await assertSucceeds(getDoc(doc(db, 'trips/t1/expenses/e-owner')))
    await assertFails(addDoc(collection(db, 'trips/t1/expenses'), newExpense('viewer')))
    await assertFails(updateDoc(doc(db, 'trips/t1/expenses/e-owner'), { grandTotal: 1 }))
    await assertFails(deleteDoc(doc(db, 'trips/t1/expenses/e-owner')))
  })

  it('guest can edit and delete only their own expenses', async () => {
    const db = as('guest', 'anonymous')
    await assertSucceeds(updateDoc(doc(db, 'trips/t1/expenses/e-guest'), { grandTotal: 55 }))
    await assertFails(updateDoc(doc(db, 'trips/t1/expenses/e-owner'), { grandTotal: 1 }))
    await assertFails(deleteDoc(doc(db, 'trips/t1/expenses/e-owner')))
    await assertSucceeds(deleteDoc(doc(db, 'trips/t1/expenses/e-guest')))
  })

  it('editor can edit anyone\'s expense', async () => {
    await assertSucceeds(updateDoc(doc(as('editor'), 'trips/t1/expenses/e-guest'), { grandTotal: 60 }))
  })

  it('half-joined collaborator cannot write', async () => {
    const db = as('orphan')
    await assertFails(addDoc(collection(db, 'trips/t1/expenses'), newExpense('orphan')))
    await assertFails(updateDoc(doc(db, 'trips/t1/expenses/e-owner'), { grandTotal: 1 }))
  })
})

describe('members', () => {
  it('read-only collaborator can rename their own member but not touch the ledger', async () => {
    const db = as('viewer')
    await assertSucceeds(updateDoc(doc(db, 'trips/t1/members/m-viewer'), { name: 'V2', avatarEmoji: '🐱' }))
    await assertFails(updateDoc(doc(db, 'trips/t1/members/m-viewer'), { spending: 999 }))
  })
})

describe('trips', () => {
  it('read-only collaborator can read the trip; half-joined cannot', async () => {
    await assertSucceeds(getDoc(doc(as('viewer'), 'trips/t1')))
    await assertFails(getDoc(doc(as('orphan'), 'trips/t1')))
  })
})
