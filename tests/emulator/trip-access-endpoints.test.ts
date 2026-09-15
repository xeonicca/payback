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
})
