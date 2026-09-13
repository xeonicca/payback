import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('native API CORS', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
    vi.stubGlobal('getHeader', (event: any, key: string) => event.headers[key])
    vi.stubGlobal('setHeader', (event: any, key: string, value: string) => {
      event.response[key] = value
    })
    vi.stubGlobal('setResponseStatus', (event: any, code: number) => {
      event.status = code
    })
    vi.stubGlobal('createError', (data: object) => Object.assign(new Error('Forbidden'), data))
  })

  async function run(origin: string, method = 'GET', path = '/api/auth/me', requestedMethod = 'POST') {
    const { default: handler } = await import('../../server/middleware/00-native-cors')
    const event = { path, method, headers: { origin, 'access-control-request-method': requestedMethod }, response: {} as Record<string, string>, status: 200 }
    const result = await handler(event as any)
    return { ...event, result }
  }

  it('allows the bundled iOS origin to read API responses without allowing cookies', async () => {
    const { response } = await run('capacitor://localhost')
    expect(response['Access-Control-Allow-Origin']).toBe('capacitor://localhost')
    expect(response['Access-Control-Allow-Credentials']).toBeUndefined()
    expect(response.Vary).toBe('Origin')
  })

  it('finishes native preflight before authentication or route execution', async () => {
    expect(await run('capacitor://localhost', 'OPTIONS')).toMatchObject({
      status: 204,
      result: '',
      response: { 'Access-Control-Allow-Headers': 'Authorization, Content-Type' },
    })
  })

  it('does not grant arbitrary websites or non-API routes access', async () => {
    expect((await run('https://evil.example')).response['Access-Control-Allow-Origin']).toBeUndefined()
    expect((await run('capacitor://localhost', 'GET', '/')).response).toEqual({})
  })

  it('rejects unsupported native preflight methods', async () => {
    await expect(run('capacitor://localhost', 'OPTIONS', '/api/auth/me', 'TRACE')).rejects.toMatchObject({ statusCode: 403 })
  })
})
