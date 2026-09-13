import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.fn()
let capturedHandler: ((error: unknown, context: unknown) => void) | undefined

vi.mock('h3', () => ({ sendRedirect: redirect }))

describe('authentication error handling', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    capturedHandler = undefined
    vi.stubGlobal('defineNitroPlugin', (plugin: any) => {
      plugin({
        hooks: {
          hook: (_name: string, handler: any) => {
            capturedHandler = handler
          },
        },
      })
      return capturedHandler
    })
  })

  async function run(path: string, statusCode: number) {
    const { default: plugin } = await import('../../server/plugins/auth-error')
    const errorHandler = plugin as unknown as (error: unknown, context: unknown) => void
    errorHandler({ statusCode }, { event: { path } })
  }

  it('keeps API authentication failures as JSON errors', async () => {
    await run('/api/trips/join', 401)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects browser page authentication failures to login', async () => {
    await run('/trips/example', 403)
    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ path: '/trips/example' }), '/login', 302)
  })
})
