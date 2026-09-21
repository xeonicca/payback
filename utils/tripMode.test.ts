import { describe, expect, it } from 'vitest'
import { canSwitchToSolo, isSoloModeBroken, isSoloTrip } from './tripMode'

describe('isSoloTrip', () => {
  it('is true for a solo trip with exactly one member', () => {
    expect(isSoloTrip({ soloMode: true }, 1)).toBe(true)
  })

  it('is false when the flag is off or missing', () => {
    expect(isSoloTrip({ soloMode: false }, 1)).toBe(false)
    expect(isSoloTrip({}, 1)).toBe(false)
    expect(isSoloTrip(null, 1)).toBe(false)
    expect(isSoloTrip(undefined, 1)).toBe(false)
  })

  it('falls back to group mode when a solo trip has extra members', () => {
    expect(isSoloTrip({ soloMode: true }, 2)).toBe(false)
  })

  it('is false while members are still loading', () => {
    expect(isSoloTrip({ soloMode: true }, 0)).toBe(false)
  })
})

describe('isSoloModeBroken', () => {
  it('flags a solo trip with more than one member', () => {
    expect(isSoloModeBroken({ soloMode: true }, 2)).toBe(true)
  })

  it('is false for healthy solo trips and group trips', () => {
    expect(isSoloModeBroken({ soloMode: true }, 1)).toBe(false)
    expect(isSoloModeBroken({ soloMode: false }, 3)).toBe(false)
    expect(isSoloModeBroken(null, 3)).toBe(false)
  })
})

describe('canSwitchToSolo', () => {
  const base = { isOwner: true, soloMode: false, memberCount: 1, collaboratorCount: 1 }

  it('allows the owner of a one-member, owner-only trip', () => {
    expect(canSwitchToSolo(base)).toBe(true)
  })

  it('allows legacy trips whose collaboratorCount is 0', () => {
    expect(canSwitchToSolo({ ...base, collaboratorCount: 0 })).toBe(true)
  })

  it('refuses non-owners, trips already solo, extra members and extra collaborators', () => {
    expect(canSwitchToSolo({ ...base, isOwner: false })).toBe(false)
    expect(canSwitchToSolo({ ...base, soloMode: true })).toBe(false)
    expect(canSwitchToSolo({ ...base, memberCount: 2 })).toBe(false)
    expect(canSwitchToSolo({ ...base, collaboratorCount: 2 })).toBe(false)
  })
})
