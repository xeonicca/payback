import { beforeEach, describe, expect, it } from 'vitest'
import { clearFirestore, getAdminDb } from './helpers'

describe('emulator harness', () => {
  beforeEach(clearFirestore)

  it('reads back what it writes', async () => {
    const ref = getAdminDb().collection('smoke').doc('a')
    await ref.set({ ok: true })
    expect((await ref.get()).data()).toEqual({ ok: true })
  })
})
