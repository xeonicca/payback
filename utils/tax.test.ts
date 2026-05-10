import type { ExpenseDetailItem } from '@/types'
import { describe, expect, it } from 'vitest'
import { applyTaxDeduction, calculateGrandTotal } from './tax'

describe('calculateGrandTotal', () => {
  it('sums price × quantity across items', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 100, quantity: 2 },
      { name: 'b', price: 50, quantity: 1 },
    ]
    expect(calculateGrandTotal(items)).toBe(250)
  })

  it('treats missing quantity as 1', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 33.33 },
      { name: 'b', price: 66.67 },
    ]
    expect(calculateGrandTotal(items)).toBe(100)
  })

  it('rounds to 2 decimal places', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 0.1, quantity: 1 },
      { name: 'b', price: 0.2, quantity: 1 },
    ]
    expect(calculateGrandTotal(items)).toBe(0.3)
  })
})

describe('applyTaxDeduction', () => {
  it('removes a 10% inclusive tax from each item price', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 110, quantity: 1 },
    ]
    const result = applyTaxDeduction(items, 10)
    expect(result.items[0].price).toBe(100)
    expect(result.grandTotal).toBe(100)
  })

  it('removes an 8% inclusive tax across multiple items with quantities', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 108, quantity: 2 },
      { name: 'b', price: 54, quantity: 1 },
    ]
    const result = applyTaxDeduction(items, 8)
    expect(result.items[0].price).toBe(100)
    expect(result.items[1].price).toBe(50)
    expect(result.grandTotal).toBe(250)
  })

  it('rounds each item price to 2 decimal places', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 100, quantity: 1 },
    ]
    const result = applyTaxDeduction(items, 7)
    // 100 / 1.07 ≈ 93.4579... → 93.46
    expect(result.items[0].price).toBe(93.46)
    expect(result.grandTotal).toBe(93.46)
  })

  it('preserves item metadata (name, quantity, sharedByMemberIds, translatedName)', () => {
    const items: ExpenseDetailItem[] = [
      {
        name: 'sushi',
        price: 1080,
        quantity: 3,
        translatedName: '寿司',
        sharedByMemberIds: ['m1', 'm2'],
      },
    ]
    const result = applyTaxDeduction(items, 8)
    expect(result.items[0]).toEqual({
      name: 'sushi',
      price: 1000,
      quantity: 3,
      translatedName: '寿司',
      sharedByMemberIds: ['m1', 'm2'],
    })
    expect(result.grandTotal).toBe(3000)
  })

  it('does not mutate the input items array', () => {
    const items: ExpenseDetailItem[] = [
      { name: 'a', price: 110, quantity: 1 },
    ]
    const snapshot = JSON.parse(JSON.stringify(items))
    applyTaxDeduction(items, 10)
    expect(items).toEqual(snapshot)
  })

  it('throws when percentage is zero or negative', () => {
    const items: ExpenseDetailItem[] = [{ name: 'a', price: 100 }]
    expect(() => applyTaxDeduction(items, 0)).toThrow()
    expect(() => applyTaxDeduction(items, -5)).toThrow()
  })

  it('handles an empty items list', () => {
    const result = applyTaxDeduction([], 10)
    expect(result.items).toEqual([])
    expect(result.grandTotal).toBe(0)
  })
})
