import { describe, expect, it } from 'vitest'
import { computeSoloSummary } from './soloSummary'

// Local noon on 2026-09-21, so every date below is interpreted in local time
const now = new Date(2026, 8, 21, 12, 0)

function expense(grandTotal: number, date: string, category?: string) {
  const [year, month, day] = date.split('-')
  return { grandTotal, category, paidAtObject: { year, month, day } }
}

describe('computeSoloSummary', () => {
  it('returns an empty summary with no daily average when there are no expenses', () => {
    expect(computeSoloSummary([], { now, archived: false })).toEqual({
      total: 0,
      today: 0,
      dailyAverage: null,
      days: 0,
      topCategory: null,
    })
  })

  it('counts a single day as one day', () => {
    const summary = computeSoloSummary([expense(100, '2026-09-21'), expense(50, '2026-09-21')], { now, archived: false })
    expect(summary).toMatchObject({ total: 150, today: 150, days: 1, dailyAverage: 150 })
  })

  it('counts calendar days from the first expense through today, inclusive', () => {
    const summary = computeSoloSummary([expense(300, '2026-09-19')], { now, archived: false })
    expect(summary).toMatchObject({ total: 300, today: 0, days: 3, dailyAverage: 100 })
  })

  it('handles unpadded month and day strings', () => {
    const summary = computeSoloSummary([expense(90, '2026-9-19')], { now, archived: false })
    expect(summary.days).toBe(3)
  })

  it('stops at the last expense for archived trips', () => {
    const summary = computeSoloSummary([expense(100, '2026-09-01'), expense(100, '2026-09-02')], { now, archived: true })
    expect(summary).toMatchObject({ days: 2, dailyAverage: 100 })
  })

  it('extends to a future-dated expense on active trips', () => {
    const summary = computeSoloSummary([expense(100, '2026-09-21'), expense(100, '2026-09-22')], { now, archived: false })
    expect(summary.days).toBe(2)
  })

  it('still totals expenses whose paidAt has not resolved yet', () => {
    const pending = { grandTotal: 40, paidAtObject: { year: '', month: '', day: '' } }
    const summary = computeSoloSummary([pending, expense(60, '2026-09-21')], { now, archived: false })
    expect(summary).toMatchObject({ total: 100, today: 60, days: 1, dailyAverage: 100 })
  })

  it('treats a pending-only list as one day', () => {
    const pending = { grandTotal: 40, paidAtObject: { year: '', month: '', day: '' } }
    expect(computeSoloSummary([pending], { now, archived: false })).toMatchObject({ total: 40, days: 1, dailyAverage: 40 })
  })

  it('picks the category with the highest total, ignoring uncategorized and unknown ones', () => {
    const summary = computeSoloSummary([
      expense(500, '2026-09-21'),
      expense(80, '2026-09-21', 'food'),
      expense(120, '2026-09-21', 'transport'),
      expense(999, '2026-09-21', 'not-a-category'),
    ], { now, archived: false })
    expect(summary.topCategory).toBe('transport')
  })

  it('breaks category ties by the fixed category order', () => {
    const summary = computeSoloSummary([
      expense(100, '2026-09-21', 'transport'),
      expense(100, '2026-09-21', 'food'),
    ], { now, archived: false })
    expect(summary.topCategory).toBe('food')
  })

  it('returns no top category when nothing is categorized', () => {
    expect(computeSoloSummary([expense(10, '2026-09-21')], { now, archived: false }).topCategory).toBeNull()
  })
})
