export type RetryResult<T> = { ok: true, value: T } | { ok: false, error: unknown }

export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number
  /** Base backoff; attempt N waits delayMs * N. */
  delayMs?: number
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Run a task up to `attempts` times, returning a result object instead of
 * throwing, so callers can report partial failure across several parallel
 * tasks without unhandled rejections.
 */
export async function withRetries<T>(
  task: () => Promise<T>,
  { attempts = 3, delayMs = 800, sleep = defaultSleep }: RetryOptions = {},
): Promise<RetryResult<T>> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { ok: true, value: await task() }
    }
    catch (error) {
      lastError = error
      if (attempt < attempts) {
        await sleep(delayMs * attempt)
      }
    }
  }

  return { ok: false, error: lastError }
}
