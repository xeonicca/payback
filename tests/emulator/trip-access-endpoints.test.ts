import type { AppUser } from '@/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anonUser, clearFirestore, getAdminDb, googleUser, makeEvent, seedTrip, stubH3Globals } from './helpers'

vi.mock('~/server/utils/session', async (importOriginal) => {
  const helpers = await import('./helpers')
  return {
    ...await importOriginal<typeof import('~/server/utils/session')>(),
    getFirebaseAdminFirestore: helpers.getAdminDb,
  }
})

beforeEach(async () => {
  stubH3Globals()
  await clearFirestore()
})

async function readCollaborator(uid: string) {
  const db = getAdminDb()
  const [collaborator, trip] = await Promise.all([
    db.doc(`trips/t1/collaborators/${uid}`).get(),
    db.doc('trips/t1').get(),
  ])
  return {
    collaborator: collaborator.exists ? collaborator.data() : null,
    inArray: (trip.data()?.collaboratorUserIds ?? []).includes(uid),
    collaboratorCount: trip.data()?.collaboratorCount,
  }
}

const newMember = { name: 'New', avatarEmoji: '🐱' }

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('POST /api/trips/join', () => {
  async function callJoin(user: AppUser, body: Record<string, unknown>) {
    const { default: handler } = await import('~/server/api/trips/join.post')
    return handler(makeEvent({ user, body }))
  }

  beforeEach(() => seedTrip({
    trip: { isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' },
    members: [
      { id: 'm-free', name: 'Free' },
      { id: 'm-taken', name: 'Taken', linkedUserId: 'someone' },
    ],
  }))

  it('adds a Google user as an editor', async () => {
    expect(await callJoin(googleUser('alice'), { joinCode: 'JOIN1', memberId: 'm-free' }))
      .toEqual({ success: true, tripId: 't1' })
    const state = await readCollaborator('alice')
    expect(state.collaborator).toMatchObject({ role: 'editor', readOnly: false, joinedVia: 'public-link' })
    expect(state.inArray).toBe(true)
  })

  it('rejects anonymous users and writes nothing', async () => {
    await expect(callJoin(anonUser('anon'), { joinCode: 'JOIN1', newMember })).rejects.toMatchObject({
      statusCode: 403,
    })
    expect((await readCollaborator('anon')).collaborator).toBeNull()
  })

  it('writes nothing when the member is already linked', async () => {
    await expect(callJoin(googleUser('alice'), { joinCode: 'JOIN1', memberId: 'm-taken' })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect((await readCollaborator('alice')).collaborator).toBeNull()
  })

  it('rejects joins while public joining is off', async () => {
    await getAdminDb().doc('trips/t1').update({ isPublicInviteEnabled: false })
    await expect(callJoin(googleUser('alice'), { joinCode: 'JOIN1', newMember })).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('does not let a read-only collaborator re-join to shed readOnly', async () => {
    await seedTrip({
      collaborators: [{ uid: 'owner', role: 'owner' }, { uid: 'ro', role: 'editor', readOnly: true }],
      trip: { isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' },
    })
    await expect(callJoin(googleUser('ro'), { joinCode: 'JOIN1', newMember })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect((await readCollaborator('ro')).collaborator).toMatchObject({ readOnly: true })
  })

  it('rejects a malformed memberId', async () => {
    await expect(callJoin(googleUser('alice'), { joinCode: 'JOIN1', memberId: 'a/b' })).rejects.toMatchObject({
      statusCode: 400,
    })
    await expect(callJoin(googleUser('alice'), { joinCode: 'JOIN1', memberId: 5 })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect((await readCollaborator('alice')).collaborator).toBeNull()
  })

  it('re-applies view-only when someone who left rejoins through the public link', async () => {
    await seedTrip({
      collaborators: [{ uid: 'owner', role: 'owner' }, { uid: 'ro', role: 'editor', readOnly: true }],
      trip: { isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' },
      members: [{ id: 'm-ro', name: 'RO', linkedUserId: 'ro' }],
    })
    const { default: leave } = await import('~/server/api/trips/leave.post')
    await leave(makeEvent({ user: googleUser('ro'), body: { tripId: 't1' } }))
    await callJoin(googleUser('ro'), { joinCode: 'JOIN1', newMember })
    expect((await readCollaborator('ro')).collaborator).toMatchObject({ role: 'editor', readOnly: true })
  })
})

async function seedAccessFixture() {
  await seedTrip({
    collaborators: [
      { uid: 'owner', role: 'owner' },
      { uid: 'alice', role: 'editor' },
      { uid: 'guest', role: 'guest' },
    ],
    members: [
      { id: 'm-owner', name: 'Owner', linkedUserId: 'owner' },
      { id: 'm-alice', name: 'Alice', linkedUserId: 'alice' },
    ],
  })
  await getAdminDb().doc('trips/t1/expenses/e-alice').set({ description: 'Lunch', grandTotal: 30, createdByUserId: 'alice' })
}

async function callCollaborator(method: 'patch' | 'delete', user: AppUser, userId: string, body?: Record<string, unknown>) {
  const { default: handler } = method === 'patch'
    ? await import('~/server/api/trips/[tripId]/collaborators/[userId].patch')
    : await import('~/server/api/trips/[tripId]/collaborators/[userId].delete')
  return handler(makeEvent({ user, body, params: { tripId: 't1', userId } }))
}

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('PATCH /api/trips/:tripId/collaborators/:userId', () => {
  beforeEach(seedAccessFixture)

  it('lets the owner switch a collaborator to view-only and back', async () => {
    await callCollaborator('patch', googleUser('owner'), 'alice', { readOnly: true })
    expect((await readCollaborator('alice')).collaborator?.readOnly).toBe(true)
    await callCollaborator('patch', googleUser('owner'), 'alice', { readOnly: false })
    expect((await readCollaborator('alice')).collaborator?.readOnly).toBe(false)
  })

  it('rejects non-owners, the owner as target, unknown targets and bad bodies', async () => {
    await expect(callCollaborator('patch', googleUser('alice'), 'guest', { readOnly: true })).rejects.toMatchObject({ statusCode: 403 })
    await expect(callCollaborator('patch', googleUser('owner'), 'owner', { readOnly: true })).rejects.toMatchObject({ statusCode: 400 })
    await expect(callCollaborator('patch', googleUser('owner'), 'nobody', { readOnly: true })).rejects.toMatchObject({ statusCode: 404 })
    await expect(callCollaborator('patch', googleUser('owner'), 'alice', { readOnly: 'yes' })).rejects.toMatchObject({ statusCode: 400 })
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('DELETE /api/trips/:tripId/collaborators/:userId', () => {
  beforeEach(seedAccessFixture)

  it('removes access but keeps the member entry and their expenses', async () => {
    expect(await callCollaborator('delete', googleUser('owner'), 'alice')).toEqual({ success: true })

    const state = await readCollaborator('alice')
    expect(state.collaborator).toBeNull()
    expect(state.inArray).toBe(false)
    expect(state.collaboratorCount).toBe(2)

    const member = await getAdminDb().doc('trips/t1/members/m-alice').get()
    expect(member.exists).toBe(true)
    expect(member.data()?.linkedUserId).toBeUndefined()
    expect((await getAdminDb().doc('trips/t1/expenses/e-alice').get()).exists).toBe(true)
  })

  it('rejects non-owners, removing the owner and unknown targets', async () => {
    await expect(callCollaborator('delete', googleUser('alice'), 'guest')).rejects.toMatchObject({ statusCode: 403 })
    await expect(callCollaborator('delete', googleUser('owner'), 'owner')).rejects.toMatchObject({ statusCode: 400 })
    await expect(callCollaborator('delete', googleUser('owner'), 'nobody')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('does not decrement the count for a half-joined collaborator', async () => {
    await seedTrip({
      collaborators: [{ uid: 'owner', role: 'owner' }, { uid: 'orphan', role: 'editor', inArray: false }],
    })
    await callCollaborator('delete', googleUser('owner'), 'orphan')
    const state = await readCollaborator('orphan')
    expect(state.collaborator).toBeNull()
    expect(state.collaboratorCount).toBe(2)
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('POST /api/trips/leave', () => {
  beforeEach(seedAccessFixture)

  async function callLeave(user: AppUser) {
    const { default: handler } = await import('~/server/api/trips/leave.post')
    return handler(makeEvent({ user, body: { tripId: 't1' } }))
  }

  it('removes the caller the same way as an owner removal', async () => {
    expect(await callLeave(googleUser('alice'))).toEqual({ success: true })
    const state = await readCollaborator('alice')
    expect(state.collaborator).toBeNull()
    expect(state.inArray).toBe(false)
    expect((await getAdminDb().doc('trips/t1/members/m-alice').get()).data()?.linkedUserId).toBeUndefined()
  })

  it('keeps the owner in and rejects non-collaborators', async () => {
    await expect(callLeave(googleUser('owner'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(callLeave(googleUser('stranger'))).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('public join link', () => {
  beforeEach(() => seedTrip({ trip: { isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' } }))

  async function callReset(user: AppUser) {
    const { default: handler } = await import('~/server/api/trips/reset-public-link.post')
    return handler(makeEvent({ user, body: { tripId: 't1' } }))
  }

  async function callJoinInfo(joinCode: string) {
    const { default: handler } = await import('~/server/api/trips/join-info.get')
    return handler(makeEvent({ query: { joinCode } }))
  }

  it('reset issues a new code and kills the old one', async () => {
    const { publicJoinCode } = await callReset(googleUser('owner'))
    expect(publicJoinCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/)
    await expect(callJoinInfo('JOIN1')).rejects.toMatchObject({ statusCode: 404 })
    expect(await callJoinInfo(publicJoinCode)).toMatchObject({ tripId: 't1' })
  })

  it('reset is owner-only', async () => {
    await expect(callReset(googleUser('stranger'))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('first enable generates a 10-character code', async () => {
    await getAdminDb().doc('trips/t1').update({ isPublicInviteEnabled: false, publicJoinCode: null })
    const { default: handler } = await import('~/server/api/trips/toggle-public-invite.post')
    const result = await handler(makeEvent({ user: googleUser('owner'), body: { tripId: 't1', enabled: true } }))
    expect(result.publicJoinCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/)
  })
})
