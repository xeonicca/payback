import type { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatFirebaseDateAndTime,
  formatFirebaseDate,
  formatFirebaseTime,
  formatFirebaseTimestamp,
} from './date'

function makeTimestamp(ms: number): Timestamp {
  return { toMillis: () => ms } as unknown as Timestamp
}

// 2024-03-15 12:00:00 UTC — noon UTC so the calendar date stays March 15
// in any timezone from UTC-12 to UTC+11 (UTC+12 and beyond flip to March 16)
const MARCH_15_NOON_UTC = Date.UTC(2024, 2, 15, 12, 0, 0)

describe('formatFirebaseTimestamp', () => {
  it('returns empty string for null', () => {
    expect(formatFirebaseTimestamp(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatFirebaseTimestamp(undefined)).toBe('')
  })

  it('returns a string matching YYYY/MM/DD, HH:mm format', () => {
    const result = formatFirebaseTimestamp(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}, \d{2}:\d{2}$/)
  })

  it('includes the correct year', () => {
    const result = formatFirebaseTimestamp(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result.startsWith('2024/')).toBe(true)
  })
})

describe('formatFirebaseDate', () => {
  it('returns empty string for null', () => {
    expect(formatFirebaseDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatFirebaseDate(undefined)).toBe('')
  })

  it('returns a string matching YYYY/MM/DD format', () => {
    const result = formatFirebaseDate(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}$/)
  })

  it('contains the correct year', () => {
    const result = formatFirebaseDate(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result.startsWith('2024/')).toBe(true)
  })

  it('does not include time components', () => {
    const result = formatFirebaseDate(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result).not.toContain(':')
    expect(result.split('/')).toHaveLength(3)
  })
})

describe('formatFirebaseTime', () => {
  it('returns empty string for null', () => {
    expect(formatFirebaseTime(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatFirebaseTime(undefined)).toBe('')
  })

  it('returns a string matching HH:mm format', () => {
    const result = formatFirebaseTime(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })

  it('does not include date components', () => {
    const result = formatFirebaseTime(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result.split(':')).toHaveLength(2)
    expect(result).not.toContain('/')
  })
})

describe('formatFirebaseDateAndTime', () => {
  it('returns all-empty object for null', () => {
    expect(formatFirebaseDateAndTime(null)).toEqual({
      year: '',
      month: '',
      day: '',
      hour: '',
      minute: '',
    })
  })

  it('returns all-empty object for undefined', () => {
    expect(formatFirebaseDateAndTime(undefined)).toEqual({
      year: '',
      month: '',
      day: '',
      hour: '',
      minute: '',
    })
  })

  it('returns an object with all five string fields populated', () => {
    const result = formatFirebaseDateAndTime(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result).toHaveProperty('year')
    expect(result).toHaveProperty('month')
    expect(result).toHaveProperty('day')
    expect(result).toHaveProperty('hour')
    expect(result).toHaveProperty('minute')
    for (const key of ['year', 'month', 'day', 'hour', 'minute'] as const) {
      expect(typeof result[key]).toBe('string')
      expect(result[key]).not.toBe('')
    }
  })

  it('returns the correct year', () => {
    const result = formatFirebaseDateAndTime(makeTimestamp(MARCH_15_NOON_UTC))
    expect(result.year).toBe('2024')
  })

  it('returns numeric-only strings for all fields', () => {
    const result = formatFirebaseDateAndTime(makeTimestamp(MARCH_15_NOON_UTC))
    for (const key of ['year', 'month', 'day', 'hour', 'minute'] as const) {
      expect(result[key]).toMatch(/^\d+$/)
    }
  })
})

describe('formatDate', () => {
  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('')
  })

  it('returns a string matching YYYY/MM/DD, HH:mm format', () => {
    const result = formatDate(new Date(MARCH_15_NOON_UTC))
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}, \d{2}:\d{2}$/)
  })

  it('includes the correct year', () => {
    const result = formatDate(new Date(MARCH_15_NOON_UTC))
    expect(result.startsWith('2024/')).toBe(true)
  })
})
