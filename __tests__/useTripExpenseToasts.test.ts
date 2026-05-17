import { describe, expect, it } from 'vitest'
import { formatExpenseToast, shouldFireToastForExpense } from '@/composables/useTripExpenseToasts'

function expense(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? 'e1',
    description: 'Dinner',
    grandTotal: 1200,
    paidByMemberId: 'm-other',
    isProcessing: false,
    hasPendingWrites: false,
    ...overrides,
  }
}

describe('shouldFireToastForExpense', () => {
  it('returns true for a fresh expense from another member', () => {
    expect(shouldFireToastForExpense(expense(), 'm-me', new Set())).toBe(true)
  })

  it('returns false when the expense id was already seen', () => {
    const seen = new Set(['e1'])
    expect(shouldFireToastForExpense(expense({ id: 'e1' }), 'm-me', seen)).toBe(false)
  })

  it('returns false for own writes', () => {
    expect(shouldFireToastForExpense(expense({ paidByMemberId: 'm-me' }), 'm-me', new Set())).toBe(false)
  })

  it('returns false when isProcessing=true', () => {
    expect(shouldFireToastForExpense(expense({ isProcessing: true }), 'm-me', new Set())).toBe(false)
  })

  it('returns false when hasPendingWrites=true', () => {
    expect(shouldFireToastForExpense(expense({ hasPendingWrites: true }), 'm-me', new Set())).toBe(false)
  })

  it('still fires when currentUserMemberId is undefined (guest viewer)', () => {
    expect(shouldFireToastForExpense(expense(), undefined, new Set())).toBe(true)
  })
})

describe('formatExpenseToast', () => {
  const members = {
    'm-other': { name: 'Sarah' },
  }

  it('formats with member, description, and amount', () => {
    const msg = formatExpenseToast(expense(), members)
    expect(msg).toContain('Sarah')
    expect(msg).toContain('Dinner')
    expect(msg).toContain('1200')
  })

  it('falls back to "Someone" when member is unknown', () => {
    const msg = formatExpenseToast(expense({ paidByMemberId: 'm-unknown' }), members)
    expect(msg).toContain('Someone')
  })

  it('falls back to "a new expense" when description is missing', () => {
    const msg = formatExpenseToast(expense({ description: undefined }), members)
    expect(msg).toContain('a new expense')
  })
})
