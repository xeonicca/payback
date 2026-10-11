import { describe, expect, it, vi } from 'vitest'
import { withRetries } from '@/utils/retry'

const noSleep = () => Promise.resolve()

describe('withRetries', () => {
  it('returns the value on first success without sleeping', async () => {
    const sleep = vi.fn(noSleep)
    const result = await withRetries(async () => 'done', { sleep })
    expect(result).toEqual({ ok: true, value: 'done' })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries after a failure and succeeds', async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce('done')
    const result = await withRetries(task, { sleep: noSleep })
    expect(result).toEqual({ ok: true, value: 'done' })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('gives up after three attempts and reports the last error', async () => {
    const task = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await withRetries(task, { sleep: noSleep })
    expect(result.ok).toBe(false)
    expect(task).toHaveBeenCalledTimes(3)
    if (!result.ok) {
      expect((result.error as Error).message).toBe('offline')
    }
  })

  it('backs off for longer between later attempts', async () => {
    const delays: number[] = []
    const task = vi.fn().mockRejectedValue(new Error('offline'))
    await withRetries(task, { delayMs: 100, sleep: async ms => void delays.push(ms) })
    expect(delays).toEqual([100, 200])
  })

  it('honours a custom attempt count', async () => {
    const task = vi.fn().mockRejectedValue(new Error('offline'))
    await withRetries(task, { attempts: 1, sleep: noSleep })
    expect(task).toHaveBeenCalledTimes(1)
  })
})
