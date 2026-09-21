import type { CategoryKey } from '@/utils/categories'
import { CATEGORY_KEYS } from '@/utils/categories'

export interface SoloSummaryExpense {
  grandTotal: number
  category?: string
  paidAtObject: { year: string, month: string, day: string }
}

export interface SoloSummary {
  total: number
  today: number
  /** null when there are no expenses */
  dailyAverage: number | null
  days: number
  topCategory: CategoryKey | null
}

const MS_PER_DAY = 86_400_000

function dayIndex(year: number, month: number, day: number) {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value)
}

/** Amounts stay in trip currency; callers convert for display. */
export function computeSoloSummary(expenses: SoloSummaryExpense[], opts: { now: Date, archived: boolean }): SoloSummary {
  if (expenses.length === 0)
    return { total: 0, today: 0, dailyAverage: null, days: 0, topCategory: null }

  const todayIndex = dayIndex(opts.now.getFullYear(), opts.now.getMonth() + 1, opts.now.getDate())
  const byCategory: Partial<Record<CategoryKey, number>> = {}
  let total = 0
  let today = 0
  let first = Infinity
  let last = -Infinity

  for (const expense of expenses) {
    total += expense.grandTotal
    if (isCategoryKey(expense.category))
      byCategory[expense.category] = (byCategory[expense.category] ?? 0) + expense.grandTotal

    // A just-written expense has no server timestamp yet, so no date to place it on
    const { year, month, day } = expense.paidAtObject
    if (!year || !month || !day)
      continue
    const index = dayIndex(Number(year), Number(month), Number(day))
    if (index === todayIndex)
      today += expense.grandTotal
    first = Math.min(first, index)
    last = Math.max(last, index)
  }

  const end = opts.archived ? last : Math.max(last, todayIndex)
  const days = Number.isFinite(first) ? end - first + 1 : 1

  let topCategory: CategoryKey | null = null
  for (const key of CATEGORY_KEYS) {
    const amount = byCategory[key]
    if (amount !== undefined && (topCategory === null || amount > byCategory[topCategory]!))
      topCategory = key
  }

  return { total, today, dailyAverage: total / days, days, topCategory }
}
