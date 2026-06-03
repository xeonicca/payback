import type { ExpenseDetailItem } from '@/types'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function calculateGrandTotal(items: Array<ExpenseDetailItem>): number {
  return round2(items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0))
}

/**
 * Removes an inclusive consumer-tax percentage from each item price.
 * Each item's new pre-tax price = price / (1 + percentage / 100).
 * The new grandTotal is recomputed from the deducted items.
 */
export function applyTaxDeduction(
  items: Array<ExpenseDetailItem>,
  percentage: number,
): { items: Array<ExpenseDetailItem>, grandTotal: number } {
  if (!Number.isFinite(percentage) || percentage <= 0) {
    throw new Error('percentage must be a positive number')
  }
  const factor = 1 + percentage / 100
  const newItems = items.map(item => ({
    ...item,
    price: round2(item.price / factor),
  }))
  return {
    items: newItems,
    grandTotal: calculateGrandTotal(newItems),
  }
}
