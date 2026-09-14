import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/utils/session', () => ({ getFirebaseAdminAuth: () => ({}) }))
vi.mock('vuefire/server', () => ({ AUTH_COOKIE_NAME: '__session' }))

describe('session endpoint (POST /api/__session)', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
    vi.stubGlobal('assertMethod', () => {})
    vi.stubGlobal('readBody', async (event: any) => event.body)
    vi.stubGlobal('setResponseStatus', (event: any, status: number) => {
      event.status = status
    })
    vi.stubGlobal('deleteCookie', (event: any, name: string, options?: object) => {
      event.deletedCookie = { name, ...options }
    })
  })

  it('clears the session cookie on the path it was set on', async () => {
    const { default: handler } = await import('../../server/api/__session.post')
    const event = { body: {} } as any
    await handler(event)
    expect(event.status).toBe(204)
    // Without an explicit path the browser scopes the deletion to /api and keeps the real cookie
    expect(event.deletedCookie).toMatchObject({ name: '__session', path: '/' })
  })
})
