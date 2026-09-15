import { describe, expect, it } from 'vitest'
import { getInvitationState, normalizeMaxUses } from '../../server/utils/invitations'

const NOW = 1_000_000
const future = { toMillis: () => NOW + 1 }
const past = { toMillis: () => NOW - 1 }

describe('normalizeMaxUses', () => {
  it('treats a missing value as single-use and keeps null as unlimited', () => {
    expect(normalizeMaxUses(undefined)).toBe(1)
    expect(normalizeMaxUses(null)).toBeNull()
    expect(normalizeMaxUses(5)).toBe(5)
  })
})

describe('getInvitationState', () => {
  it('is valid while pending, unexpired and under its limit', () => {
    expect(getInvitationState({ status: 'pending', expiresAt: future, maxUses: 2, usedCount: 1 }, NOW)).toBe('valid')
  })

  it('reports revoked before anything else', () => {
    expect(getInvitationState({ status: 'revoked', expiresAt: past, maxUses: 1, usedCount: 1 }, NOW)).toBe('revoked')
  })

  it('reports expired from the status or the timestamp', () => {
    expect(getInvitationState({ status: 'expired', expiresAt: future }, NOW)).toBe('expired')
    expect(getInvitationState({ status: 'pending', expiresAt: past }, NOW)).toBe('expired')
  })

  it('reports used when the limit is reached', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: future, maxUses: 1, usedCount: 1 }, NOW)).toBe('used')
    expect(getInvitationState({ status: 'pending', expiresAt: future, usedCount: 1 }, NOW)).toBe('used')
  })

  it('never runs out when maxUses is null', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: future, maxUses: null, usedCount: 99 }, NOW)).toBe('valid')
  })

  it('treats a legacy accepted invitation without a usage count as used', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: future }, NOW)).toBe('used')
  })

  it('reports expired ahead of used', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: past, maxUses: 1, usedCount: 1 }, NOW)).toBe('expired')
  })
})
