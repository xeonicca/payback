import { describe, expect, it } from 'vitest'
import { mapDecodedTokenToAppUser } from '../../../server/utils/session'

describe('mapDecodedTokenToAppUser', () => {
  it('maps all fields for a Google user', () => {
    const decoded = {
      uid: 'abc123',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://example.com/photo.jpg',
      firebase: { sign_in_provider: 'google.com' },
    }
    expect(mapDecodedTokenToAppUser(decoded)).toEqual({
      uid: 'abc123',
      email: 'user@example.com',
      displayName: 'Test User',
      photoURL: 'https://example.com/photo.jpg',
      isAnonymous: false,
    })
  })

  it('returns null for optional fields when absent', () => {
    const decoded = {
      uid: 'anon123',
      firebase: { sign_in_provider: 'anonymous' },
    }
    expect(mapDecodedTokenToAppUser(decoded)).toEqual({
      uid: 'anon123',
      email: null,
      displayName: null,
      photoURL: null,
      isAnonymous: true,
    })
  })

  it('marks non-anonymous providers as not anonymous', () => {
    const decoded = {
      uid: 'u1',
      firebase: { sign_in_provider: 'password' },
    }
    expect(mapDecodedTokenToAppUser(decoded).isAnonymous).toBe(false)
  })
})
