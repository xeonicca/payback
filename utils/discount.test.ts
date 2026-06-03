import type { ExpenseDetailItem } from '@/types'
import { describe, expect, it } from 'vitest'
import { applyDiscount } from './discount'

describe('applyDiscount', () => {
  it('subtracts a 10% discount from each item price', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 100, quantity: 1 },
    ]
    const result = applyDiscount(items, 10)
    expect(result.items[0].price).toBe(90)
    expect(result.grandTotal).toBe(90)
  })

  it('matches the user expectation: 62780 @ 7% → ~58385.40', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'meal', price: 62780, quantity: 1 },
    ]
    const result = applyDiscount(items, 7)
    expect(result.grandTotal).toBe(58385.4)
  })

  it('applies discount across multiple items with quantities', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 100, quantity: 2 },
      { name: 'b', price: 50, quantity: 1 },
    ]
    const result = applyDiscount(items, 20)
    expect(result.items[0].price).toBe(80)
    expect(result.items[1].price).toBe(40)
    expect(result.grandTotal).toBe(200)
  })

  it('rounds each item price to 2 decimal places', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 99.99, quantity: 1 },
    ]
    const result = applyDiscount(items, 15)
    // 99.99 × 0.85 = 84.9915 → 84.99
    expect(result.items[0].price).toBe(84.99)
  })

  it('preserves item metadata (name, quantity, sharedByMemberIds, translatedName)', () => {
    const items: ExpenseDetailItem[] = [
      {
        name: 'sushi',
        price: 1000,
        quantity: 3,
        translatedName: '寿司',
        sharedByMemberIds: ['m1', 'm2'],
      },
    ]
    const result = applyDiscount(items, 10)
    expect(result.items[0]).toEqual({
      name: 'sushi',
      price: 900,
      quantity: 3,
      translatedName: '寿司',
      sharedByMemberIds: ['m1', 'm2'],
    })
    expect(result.grandTotal).toBe(2700)
  })

  it('does not mutate the input items array', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 100, quantity: 1 },
    ]
    const snapshot = JSON.parse(JSON.stringify(items))
    applyDiscount(items, 10)
    expect(items).toEqual(snapshot)
  })

  it('throws for invalid percentages', () => {
    const items: ExpenseDetailItem[] = [{ name: 'a', price: 100 }]
    expect(() => applyDiscount(items, 0)).toThrow()
    expect(() => applyDiscount(items, -5)).toThrow()
    expect(() => applyDiscount(items, 100)).toThrow()
    expect(() => applyDiscount(items, 150)).toThrow()
  })

  it('handles an empty items list', () => {
    const result = applyDiscount([], 10)
    expect(result.items).toEqual([])
    expect(result.grandTotal).toBe(0)
  })
})
