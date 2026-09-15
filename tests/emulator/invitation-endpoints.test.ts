import { Timestamp } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFirestore, makeEvent, seedInvitation, stubH3Globals } from './helpers'

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
