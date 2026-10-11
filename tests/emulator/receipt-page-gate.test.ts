import { beforeEach, describe, expect, it } from 'vitest'
// functions/ is CommonJS; import the namespace and read properties off it.
import receiptPages from '../../functions/receiptPages.js'
import { clearFirestore, getAdminDb } from './helpers'

const { claimPageForAnalysis } = receiptPages as {
  claimPageForAnalysis: (ref: any, path: string) => Promise<{ status: string, paths: string[] }>
}

const EXPENSE_PATH = 'trips/t1/expenses/e1'
const page = (n: number) => `trips/t1/expenses/e1/resized/page-${n}_1600x1600.jpeg`

function expenseRef() {
  return getAdminDb().doc(EXPENSE_PATH)
}

async function seedExpense(fields: Record<string, unknown>) {
  await expenseRef().set({ description: 'Receipt Uploaded, processing', isProcessing: true, ...fields })
}

beforeEach(async () => {
  await clearFirestore()
})

describe('claimPageForAnalysis', () => {
  it('elects the single page of a one-page upload immediately', async () => {
    await seedExpense({ imageCount: 1 })
    const result = await claimPageForAnalysis(expenseRef(), page(1))
    expect(result.status).toBe('analyze')
    expect(result.paths).toEqual([page(1)])
  })

  it('treats a missing imageCount as a one-page upload', async () => {
    await seedExpense({})
    const result = await claimPageForAnalysis(expenseRef(), page(1))
    expect(result.status).toBe('analyze')
  })

  it('waits while the set is incomplete and elects exactly one analyzer', async () => {
    await seedExpense({ imageCount: 3 })

    const first = await claimPageForAnalysis(expenseRef(), page(1))
    expect(first.status).toBe('waiting')

    const second = await claimPageForAnalysis(expenseRef(), page(2))
    expect(second.status).toBe('waiting')

    const third = await claimPageForAnalysis(expenseRef(), page(3))
    expect(third.status).toBe('analyze')
    expect(third.paths).toEqual([page(1), page(2), page(3)])
  })

  it('returns pages in receipt order even when they arrive backwards', async () => {
    await seedExpense({ imageCount: 3 })
    await claimPageForAnalysis(expenseRef(), page(3))
    await claimPageForAnalysis(expenseRef(), page(2))
    const last = await claimPageForAnalysis(expenseRef(), page(1))
    expect(last.status).toBe('analyze')
    expect(last.paths).toEqual([page(1), page(2), page(3)])
  })

  it('persists imageUrls sorted so clients need no sorting', async () => {
    await seedExpense({ imageCount: 2 })
    await claimPageForAnalysis(expenseRef(), page(2))
    await claimPageForAnalysis(expenseRef(), page(1))
    const snap = await expenseRef().get()
    expect(snap.data()?.imageUrls).toEqual([page(1), page(2)])
  })

  it('ignores a re-fired duplicate path without counting it twice', async () => {
    await seedExpense({ imageCount: 2 })
    await claimPageForAnalysis(expenseRef(), page(1))

    const duplicate = await claimPageForAnalysis(expenseRef(), page(1))
    expect(duplicate.status).toBe('duplicate')

    const snap = await expenseRef().get()
    expect(snap.data()?.imageUrls).toEqual([page(1)])

    const second = await claimPageForAnalysis(expenseRef(), page(2))
    expect(second.status).toBe('analyze')
  })

  it('elects exactly one analyzer when all pages land concurrently', async () => {
    await seedExpense({ imageCount: 3 })
    const results = await Promise.all([
      claimPageForAnalysis(expenseRef(), page(1)),
      claimPageForAnalysis(expenseRef(), page(2)),
      claimPageForAnalysis(expenseRef(), page(3)),
    ])
    expect(results.filter(r => r.status === 'analyze')).toHaveLength(1)
    expect(results.filter(r => r.status === 'waiting')).toHaveLength(2)
  })

  it('reports a missing expense instead of throwing', async () => {
    const result = await claimPageForAnalysis(getAdminDb().doc('trips/t1/expenses/gone'), page(1))
    expect(result.status).toBe('missing')
  })
})
