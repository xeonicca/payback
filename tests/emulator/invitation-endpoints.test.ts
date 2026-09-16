import type { AppUser } from '@/types'
import { Timestamp } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anonUser, clearFirestore, getAdminDb, googleUser, makeEvent, seedInvitation, seedTrip, stubH3Globals } from './helpers'

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

async function callPreview(query: Record<string, unknown>) {
  const { default: handler } = await import('~/server/api/invitations/preview.get')
  return handler(makeEvent({ query }))
}

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('GET /api/invitations/preview', () => {
  it('returns only the public fields', async () => {
    await seedInvitation('VALID1', { viewOnly: true, type: 'guest', maxUses: null })
    const preview = await callPreview({ code: 'VALID1' })
    expect(preview).toEqual({
      state: 'valid',
      type: 'guest',
      viewOnly: true,
      tripName: 'Test Trip',
      invitedByName: 'Owner',
      expiresAt: expect.any(String),
    })
  })

  it('reports revoked, expired and used invitations', async () => {
    await seedInvitation('REV', { status: 'revoked' })
    await seedInvitation('EXP', { expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await seedInvitation('USED', { status: 'accepted', usedCount: 1 })
    expect((await callPreview({ code: 'REV' })).state).toBe('revoked')
    expect((await callPreview({ code: 'EXP' })).state).toBe('expired')
    expect((await callPreview({ code: 'USED' })).state).toBe('used')
  })

  it('404s on an unknown code and 400s without one', async () => {
    await expect(callPreview({ code: 'NOPE' })).rejects.toMatchObject({ statusCode: 404 })
    await expect(callPreview({})).rejects.toMatchObject({ statusCode: 400 })
  })
})

async function callAccept(user: AppUser, body: Record<string, unknown>) {
  const { default: handler } = await import('~/server/api/invitations/accept.post')
  return handler(makeEvent({ user, body }))
}

async function seedAcceptFixture() {
  await seedTrip({
    members: [
      { id: 'm-host', name: 'Host', linkedUserId: 'owner' },
      { id: 'm-free', name: 'Free' },
      { id: 'm-taken', name: 'Taken', linkedUserId: 'someone' },
    ],
  })
}

async function readState(uid: string, code: string) {
  const db = getAdminDb()
  const [collaborator, trip, invitation] = await Promise.all([
    db.doc(`trips/t1/collaborators/${uid}`).get(),
    db.doc('trips/t1').get(),
    db.doc(`invitations/${code}`).get(),
  ])
  return {
    collaborator: collaborator.exists ? collaborator.data() : null,
    inArray: (trip.data()?.collaboratorUserIds ?? []).includes(uid),
    invitation: invitation.data(),
  }
}

const newMember = { name: 'New', avatarEmoji: '🐱' }

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('POST /api/invitations/accept', () => {
  beforeEach(seedAcceptFixture)

  it('links a Google user to an existing member as an editor', async () => {
    await seedInvitation('P1')
    expect(await callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'm-free' }))
      .toEqual({ success: true, tripId: 't1' })

    const state = await readState('alice', 'P1')
    expect(state.collaborator).toMatchObject({ role: 'editor', readOnly: false })
    expect(state.inArray).toBe(true)
    expect(state.invitation).toMatchObject({ status: 'accepted', usedCount: 1 })
    expect((await getAdminDb().doc('trips/t1/members/m-free').get()).data()?.linkedUserId).toBe('alice')
  })

  it('rejects anonymous users on personal invitations and writes nothing', async () => {
    await seedInvitation('P1')
    await expect(callAccept(anonUser('anon'), { invitationCode: 'P1', newMember }))
      .rejects
      .toMatchObject({ statusCode: 403 })

    const state = await readState('anon', 'P1')
    expect(state.collaborator).toBeNull()
    expect(state.invitation?.usedCount).toBe(0)
  })

  it('gives anonymous users on guest invitations the guest role', async () => {
    await seedInvitation('G1', { type: 'guest', maxUses: null })
    await callAccept(anonUser('anon'), { invitationCode: 'G1', newMember })

    expect((await readState('anon', 'G1')).collaborator).toMatchObject({ role: 'guest', readOnly: false })
    const linked = await getAdminDb().collection('trips/t1/members').where('linkedUserId', '==', 'anon').get()
    expect(linked.docs[0]?.data()).toMatchObject({ name: 'New', avatarEmoji: '🐱' })
  })

  it('writes nothing when the member does not exist, so the user can retry', async () => {
    await seedInvitation('P1')
    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'nope' }))
      .rejects
      .toMatchObject({ statusCode: 404 })

    const state = await readState('alice', 'P1')
    expect(state.collaborator).toBeNull()
    expect(state.invitation?.usedCount).toBe(0)

    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'm-free' }))
      .resolves
      .toMatchObject({ success: true })
  })

  it('writes nothing when the member is already linked', async () => {
    await seedInvitation('P1')
    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'm-taken' }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    expect((await readState('alice', 'P1')).collaborator).toBeNull()
  })

  it('starts view-only invitees as read-only', async () => {
    await seedInvitation('V1', { viewOnly: true })
    await callAccept(googleUser('alice'), { invitationCode: 'V1', newMember })
    expect((await readState('alice', 'V1')).collaborator).toMatchObject({ role: 'editor', readOnly: true })
  })

  it('marks expired invitations as expired and rejects them', async () => {
    await seedInvitation('EXP', { expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await expect(callAccept(googleUser('alice'), { invitationCode: 'EXP', newMember }))
      .rejects
      .toMatchObject({ statusCode: 400 })

    const state = await readState('alice', 'EXP')
    expect(state.invitation?.status).toBe('expired')
    expect(state.collaborator).toBeNull()
  })

  it('lets exactly one of two concurrent users take a single-use invitation', async () => {
    await seedInvitation('P1')
    const results = await Promise.allSettled([
      callAccept(googleUser('alice'), { invitationCode: 'P1', newMember: { name: 'A', avatarEmoji: '🐱' } }),
      callAccept(googleUser('bob'), { invitationCode: 'P1', newMember: { name: 'B', avatarEmoji: '🐶' } }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((await readState('alice', 'P1')).invitation?.usedCount).toBe(1)
  })

  it('rejects invitations the trip owner did not issue', async () => {
    await seedInvitation('FORGED', { invitedByUserId: 'mallory' })
    await expect(callAccept(googleUser('mallory'), { invitationCode: 'FORGED', newMember }))
      .rejects
      .toMatchObject({ statusCode: 403 })
    expect((await readState('mallory', 'FORGED')).collaborator).toBeNull()
  })

  it('keeps unlimited invitations open', async () => {
    await seedInvitation('U1', { maxUses: null })
    await callAccept(googleUser('alice'), { invitationCode: 'U1', newMember: { name: 'A', avatarEmoji: '🐱' } })
    await callAccept(googleUser('bob'), { invitationCode: 'U1', newMember: { name: 'B', avatarEmoji: '🐶' } })
    expect((await readState('bob', 'U1')).invitation).toMatchObject({ status: 'pending', usedCount: 2 })
  })

  it('rejects revoked invitations', async () => {
    await seedInvitation('R1', { status: 'revoked' })
    await expect(callAccept(googleUser('alice'), { invitationCode: 'R1', memberId: 'm-free' }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    expect((await readState('alice', 'R1')).collaborator).toBeNull()
  })

  it('does not let an existing read-only collaborator re-accept to shed readOnly', async () => {
    await seedTrip({ collaborators: [{ uid: 'owner', role: 'owner' }, { uid: 'ro', role: 'editor', readOnly: true }] })
    await seedInvitation('P2')
    await expect(callAccept(googleUser('ro'), { invitationCode: 'P2', newMember }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    expect((await readState('ro', 'P2')).collaborator).toMatchObject({ readOnly: true })
  })

  it('re-applies view-only when someone who left accepts a new invitation', async () => {
    await seedTrip({ collaborators: [{ uid: 'owner', role: 'owner' }, { uid: 'ro', role: 'editor', readOnly: true }] })
    const { default: leave } = await import('~/server/api/trips/leave.post')
    await leave(makeEvent({ user: googleUser('ro'), body: { tripId: 't1' } }))
    await seedInvitation('P3')
    await callAccept(googleUser('ro'), { invitationCode: 'P3', newMember })
    expect((await readState('ro', 'P3')).collaborator).toMatchObject({ readOnly: true })
  })

  it('does not let the owner accept their own invitation', async () => {
    await seedInvitation('OWN')
    await expect(callAccept(googleUser('owner'), { invitationCode: 'OWN', newMember }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    const state = await readState('owner', 'OWN')
    expect(state.collaborator).toMatchObject({ role: 'owner' })
    expect(state.invitation?.usedCount).toBe(0)
  })

  it('keeps a used-up invitation marked accepted after it expires', async () => {
    await seedInvitation('DONE', { status: 'accepted', usedCount: 1, expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await expect(callAccept(googleUser('alice'), { invitationCode: 'DONE', newMember }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    expect((await readState('alice', 'DONE')).invitation?.status).toBe('accepted')
  })

  it('rejects a malformed memberId', async () => {
    await seedInvitation('P1')
    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'a/b' }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 5 }))
      .rejects
      .toMatchObject({ statusCode: 400 })
    expect((await readState('alice', 'P1')).invitation?.usedCount).toBe(0)
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('POST /api/invitations/create', () => {
  async function callCreate(user: AppUser, body: Record<string, unknown>) {
    const { default: handler } = await import('~/server/api/invitations/create.post')
    return handler(makeEvent({ user, body }))
  }

  beforeEach(() => seedTrip())

  it('stores viewOnly and uses a 10-character code', async () => {
    const result = await callCreate(googleUser('owner'), { tripId: 't1', type: 'guest', maxUses: null, viewOnly: true })
    expect(result.invitationCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/)
    expect(result.invitationUrl).toBe(`http://localhost:3000/guest/${result.invitationCode}`)

    const stored = (await getAdminDb().doc(`invitations/${result.invitationId}`).get()).data()
    expect(stored).toMatchObject({ viewOnly: true, type: 'guest', maxUses: null })
  })

  it('defaults viewOnly to false', async () => {
    const result = await callCreate(googleUser('owner'), { tripId: 't1' })
    expect((await getAdminDb().doc(`invitations/${result.invitationId}`).get()).data()?.viewOnly).toBe(false)
  })

  it('rejects non-owners', async () => {
    await expect(callCreate(googleUser('stranger'), { tripId: 't1' })).rejects.toMatchObject({ statusCode: 403 })
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('GET /api/invitations/list', () => {
  it('reports unlimited invitations as unlimited and includes viewOnly', async () => {
    await seedTrip()
    await seedInvitation('U1', { maxUses: null })
    const { default: handler } = await import('~/server/api/invitations/list.get')
    const list = await handler(makeEvent({ user: googleUser('owner'), query: { tripId: 't1' } }))
    expect(list[0]).toMatchObject({ invitationCode: 'U1', maxUses: null, viewOnly: false })
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('GET /api/invitations/members', () => {
  async function callMembers(user: AppUser, invitationCode: string) {
    const { default: handler } = await import('~/server/api/invitations/members.get')
    return handler(makeEvent({ user, query: { invitationCode } }))
  }

  beforeEach(seedAcceptFixture)

  it('lists members for an unlimited link the old bug marked accepted', async () => {
    await seedInvitation('U2', { status: 'accepted', maxUses: null, usedCount: 1 })
    const result = await callMembers(googleUser('alice'), 'U2')
    expect(result.tripId).toBe('t1')
    expect(result.members.map((m: { id: string }) => m.id)).toContain('m-free')
  })

  it('hides a personal invitation\'s members from anonymous sessions', async () => {
    await seedInvitation('P1')
    await expect(callMembers(anonUser('anon'), 'P1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('still serves guest invitations to anonymous sessions', async () => {
    await seedInvitation('G1', { type: 'guest', maxUses: null })
    expect((await callMembers(anonUser('anon'), 'G1')).tripId).toBe('t1')
  })

  it('rejects used-up and expired invitations', async () => {
    await seedInvitation('USED', { status: 'accepted', usedCount: 1 })
    await seedInvitation('EXP', { expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await expect(callMembers(googleUser('alice'), 'USED')).rejects.toMatchObject({ statusCode: 400 })
    await expect(callMembers(googleUser('alice'), 'EXP')).rejects.toMatchObject({ statusCode: 400 })
  })
})
