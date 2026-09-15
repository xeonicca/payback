import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
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
      collaboratorUserIds: ['owner', 'editor', 'guest', 'viewer', 'legacy', 'roguest'],
    })
    const collaborator = (uid: string, role: string, readOnly = false) =>
      setDoc(doc(db, `trips/t1/collaborators/${uid}`), { userId: uid, role, readOnly })
    await collaborator('owner', 'owner')
    await collaborator('editor', 'editor')
    await collaborator('guest', 'guest')
    await collaborator('viewer', 'editor', true)
    // Half-joined (gap 3): collaborator doc exists but uid is not in collaboratorUserIds
    await collaborator('orphan', 'editor')
    // Legacy doc written before readOnly existed — no field at all
    await setDoc(doc(db, 'trips/t1/collaborators/legacy'), { userId: 'legacy', role: 'editor' })
    // Guest the owner has switched to view-only
    await collaborator('roguest', 'guest', true)
    await setDoc(doc(db, 'trips/t1/members/m-viewer'), { name: 'Viewer', avatarEmoji: '🐭', linkedUserId: 'viewer', spending: 0 })
    await setDoc(doc(db, 'trips/t1/expenses/e-owner'), { description: 'Dinner', grandTotal: 100, createdByUserId: 'owner' })
    await setDoc(doc(db, 'trips/t1/expenses/e-guest'), { description: 'Taxi', grandTotal: 50, createdByUserId: 'guest' })
    await setDoc(doc(db, 'trips/t1/expenses/e-roguest'), { description: 'Snacks', grandTotal: 20, createdByUserId: 'roguest' })
    // A second trip owned by someone else, with its own invitation
    await setDoc(doc(db, 'trips/t2'), { name: 'Other', userId: 'mallory', collaboratorUserIds: ['mallory'] })
    await setDoc(doc(db, 'trips/t2/collaborators/mallory'), { userId: 'mallory', role: 'owner', readOnly: false })
    await setDoc(doc(db, 'invitations/inv-m'), { tripId: 't2', invitationCode: 'MAL1', status: 'pending' })
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

  it('the owner can query their trip\'s invitations; other collaborators cannot', async () => {
    await assertSucceeds(getDocs(query(collection(as('owner'), 'invitations'), where('tripId', '==', 't1'))))
    await assertFails(getDocs(query(collection(as('editor'), 'invitations'), where('tripId', '==', 't1'))))
  })

  it('clients cannot create, update or delete invitations — not even owners', async () => {
    await assertFails(addDoc(collection(as('owner'), 'invitations'), { tripId: 't1', invitationCode: 'NEW1', status: 'pending' }))
    await assertFails(updateDoc(doc(as('owner'), 'invitations/inv1'), { status: 'revoked' }))
    await assertFails(deleteDoc(doc(as('owner'), 'invitations/inv1')))
    // Retargeting an invitation for your own trip at someone else's trip
    await assertFails(updateDoc(doc(as('mallory'), 'invitations/inv-m'), { tripId: 't1' }))
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
    await assertFails(deleteDoc(doc(db, 'trips/t1/expenses/e-owner')))
  })

  it('owner can create, update and delete', async () => {
    const db = as('owner')
    await assertSucceeds(addDoc(collection(db, 'trips/t1/expenses'), newExpense('owner')))
    await assertSucceeds(updateDoc(doc(db, 'trips/t1/expenses/e-guest'), { grandTotal: 65 }))
    await assertSucceeds(deleteDoc(doc(db, 'trips/t1/expenses/e-guest')))
  })

  it('collaborator doc without a readOnly field can still write', async () => {
    await assertSucceeds(addDoc(collection(as('legacy'), 'trips/t1/expenses'), newExpense('legacy')))
  })

  it('read-only guest cannot create, edit or delete — even their own expense', async () => {
    const db = as('roguest', 'anonymous')
    await assertFails(addDoc(collection(db, 'trips/t1/expenses'), newExpense('roguest')))
    await assertFails(updateDoc(doc(db, 'trips/t1/expenses/e-roguest'), { grandTotal: 25 }))
    await assertFails(deleteDoc(doc(db, 'trips/t1/expenses/e-roguest')))
  })

  it('nobody can reassign who created an expense', async () => {
    await assertFails(updateDoc(doc(as('guest', 'anonymous'), 'trips/t1/expenses/e-guest'), { createdByUserId: 'owner' }))
    await assertFails(updateDoc(doc(as('editor'), 'trips/t1/expenses/e-guest'), { createdByUserId: 'editor' }))
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
