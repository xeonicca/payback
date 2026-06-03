import type { ExpenseDetailItem } from '@/types'
import { calculateGrandTotal } from '@/utils/tax'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Applies a flat percentage discount to each item price.
 * Each item's new price = price × (1 − percentage / 100).
 * The new grandTotal is recomputed from the discounted items.
 */
export function applyDiscount(
  items: Array<ExpenseDetailItem>,
  percentage: number,
): { items: Array<ExpenseDetailItem>, grandTotal: number } {
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) {
    throw new Error('percentage must be between 0 and 100 (exclusive)')
  }
  const factor = 1 - percentage / 100
  const newItems = items.map(item => ({
    ...item,
    price: round2(item.price * factor),
  }))
  return {
    items: newItems,
    grandTotal: calculateGrandTotal(newItems),
  }
}
