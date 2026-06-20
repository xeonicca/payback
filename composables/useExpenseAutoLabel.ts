import type { Expense } from '@/types'
import { doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { ref } from 'vue'
import { useFirestore } from 'vuefire'

interface ClassifyResult { results?: Array<{ id: string, category: string }> }

// Bound per-call token size; large trips run in several calls.
const CHUNK_SIZE = 50

export function useExpenseAutoLabel(tripId: string) {
  const db = useFirestore()
  const isRunning = ref(false)

  /**
   * Classify every enabled expense that has no category yet.
   * Returns the number of expenses labeled. Never overwrites an existing category.
   */
  async function runBatch(expenses: Expense[]): Promise<number> {
    const targets = expenses
      .filter(e => e.enabled && !e.category && e.description?.trim())
      .map(e => ({ id: e.id, description: e.description }))

    if (targets.length === 0)
      return 0

    isRunning.value = true
    let labeled = 0
    try {
      const functions = getFunctions(undefined, 'us-west1')
      const classify = httpsCallable<{ items: typeof targets }, ClassifyResult>(
        functions,
        'classifyExpense-classifyExpense',
      )

      for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE)
        const res = await classify({ items: chunk })
        const results = res.data.results ?? []
        await Promise.all(results.map(async (r) => {
          if (!r.category)
            return
          await updateDoc(doc(db, 'trips', tripId, 'expenses', r.id), { category: r.category })
          labeled += 1
        }))
      }
    }
    finally {
      isRunning.value = false
    }
    return labeled
  }

  return { isRunning, runBatch }
}
