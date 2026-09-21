import type { AppUser } from '@/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFirestore, getAdminDb, googleUser, makeEvent, seedInvitation, seedTrip, stubH3Globals } from './helpers'

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

async function readTrip() {
  return (await getAdminDb().doc('trips/t1').get()).data()!
}

const newMember = { name: 'New', avatarEmoji: '🐱' }

// eslint-disable-next-line test/prefer-lowercase-title -- matches the HTTP method, not a sentence
describe('POST /api/trips/[tripId]/solo-mode', () => {
  async function callSoloMode(user: AppUser, enabled: unknown, tripId = 't1') {
    const { default: handler } = await import('~/server/api/trips/[tripId]/solo-mode.post')
    return handler(makeEvent({ user, body: { enabled }, params: { tripId } }))
  }

  beforeEach(() => seedTrip({
    trip: { isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' },
    members: [{ id: 'm-owner', name: 'Owner', linkedUserId: 'owner' }],
  }))

  it('turns solo mode on, closes the public link and revokes pending invitations', async () => {
    await seedInvitation('INV1')
    await seedInvitation('INV2', { type: 'guest' })
    await seedInvitation('OLD', { status: 'accepted' })

    expect(await callSoloMode(googleUser('owner'), true))
      .toEqual({ success: true, soloMode: true, revokedInvitations: 2 })

    expect(await readTrip()).toMatchObject({ soloMode: true, isPublicInviteEnabled: false })
    const db = getAdminDb()
    expect((await db.doc('invitations/INV1').get()).data()?.status).toBe('revoked')
    expect((await db.doc('invitations/INV2').get()).data()?.status).toBe('revoked')
    expect((await db.doc('invitations/OLD').get()).data()?.status).toBe('accepted')
  })

  it('turns solo mode off without reopening the public link', async () => {
    await getAdminDb().doc('trips/t1').update({ soloMode: true, isPublicInviteEnabled: false })
    expect(await callSoloMode(googleUser('owner'), false))
      .toEqual({ success: true, soloMode: false, revokedInvitations: 0 })
    expect(await readTrip()).toMatchObject({ soloMode: false, isPublicInviteEnabled: false })
  })

  it('refuses non-owners', async () => {
    await expect(callSoloMode(googleUser('mallory'), true)).rejects.toMatchObject({ statusCode: 403 })
    expect((await readTrip()).soloMode).toBeUndefined()
  })

  it('refuses a non-boolean body', async () => {
    await expect(callSoloMode(googleUser('owner'), 'yes')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 for a missing trip', async () => {
    await expect(callSoloMode(googleUser('owner'), true, 'nope')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses to enter solo mode with more than one member', async () => {
    await getAdminDb().doc('trips/t1/members/m-2').set({ name: 'Friend', avatarEmoji: '🐱' })
    await expect(callSoloMode(googleUser('owner'), true)).rejects.toMatchObject({ statusCode: 400 })
    expect((await readTrip()).soloMode).toBeUndefined()
  })

  it('refuses to enter solo mode while another collaborator exists', async () => {
    await seedTrip({
      collaborators: [{ uid: 'owner', role: 'owner' }, { uid: 'bob', role: 'editor' }],
      members: [{ id: 'm-owner', name: 'Owner', linkedUserId: 'owner' }],
    })
    await expect(callSoloMode(googleUser('owner'), true)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('solo trip guards', () => {
  beforeEach(() => seedTrip({
    trip: { soloMode: true, isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' },
    members: [{ id: 'm-owner', name: 'Owner', linkedUserId: 'owner' }],
  }))

  it('refuses public-link joins', async () => {
    const { default: handler } = await import('~/server/api/trips/join.post')
    await expect(handler(makeEvent({ user: googleUser('alice'), body: { joinCode: 'JOIN1', newMember } })))
      .rejects
      .toMatchObject({ statusCode: 403 })
    expect((await getAdminDb().doc('trips/t1/collaborators/alice').get()).exists).toBe(false)
  })

  it('refuses creating invitations', async () => {
    const { default: handler } = await import('~/server/api/invitations/create.post')
    await expect(handler(makeEvent({ user: googleUser('owner'), body: { tripId: 't1' } })))
      .rejects
      .toMatchObject({ statusCode: 403 })
  })

  it('refuses accepting an invitation issued before the switch', async () => {
    await seedInvitation('INV1')
    const { default: handler } = await import('~/server/api/invitations/accept.post')
    await expect(handler(makeEvent({ user: googleUser('alice'), body: { invitationCode: 'INV1', newMember } })))
      .rejects
      .toMatchObject({ statusCode: 403 })
    expect((await getAdminDb().doc('trips/t1/collaborators/alice').get()).exists).toBe(false)
  })

  it('refuses enabling the public link but allows disabling it', async () => {
    const { default: handler } = await import('~/server/api/trips/toggle-public-invite.post')
    await expect(handler(makeEvent({ user: googleUser('owner'), body: { tripId: 't1', enabled: true } })))
      .rejects
      .toMatchObject({ statusCode: 400 })
    await expect(handler(makeEvent({ user: googleUser('owner'), body: { tripId: 't1', enabled: false } })))
      .resolves
      .toMatchObject({ success: true, isPublicInviteEnabled: false })
  })
})
