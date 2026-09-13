import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ verifyIdToken: vi.fn(), verifySessionCookie: vi.fn() }))
vi.mock('../../server/utils/session', async original => ({
  ...await original<typeof import('../../server/utils/session')>(),
  getFirebaseAdminAuth: () => auth,
}))
vi.mock('vuefire/server', () => ({ AUTH_COOKIE_NAME: '__session' }))

describe('shared web/native session middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
    vi.stubGlobal('getHeader', (event: any, key: string) => event.headers[key])
    vi.stubGlobal('getCookie', (event: any) => event.cookie)
    vi.stubGlobal('deleteCookie', (event: any) => {
      event.deletedCookie = true
    })
    vi.stubGlobal('createError', (data: object) => Object.assign(new Error('Unauthorized'), data))
  })

  async function run(headers = {}, cookie?: string) {
    const { default: middleware } = await import('../../server/middleware/session')
    const event = { headers, cookie, context: {} as any, deletedCookie: false }
    await middleware(event as any)
    return event
  }

  it('accepts a verified Firebase ID token from iOS', async () => {
    auth.verifyIdToken.mockResolvedValue({ uid: 'ios-user', firebase: { sign_in_provider: 'anonymous' } })
    const event = await run({ authorization: 'Bearer native-token' })
    expect(event.context.appUser).toMatchObject({ uid: 'ios-user', isAnonymous: true })
    expect(auth.verifyIdToken).toHaveBeenCalledWith('native-token', true)
  })

  it('continues to accept existing browser session cookies', async () => {
    auth.verifySessionCookie.mockResolvedValue({ uid: 'web-user' })
    expect((await run({}, 'web-cookie')).context.appUser.uid).toBe('web-user')
    expect(auth.verifyIdToken).not.toHaveBeenCalled()
  })

  it('rejects invalid bearer tokens without falling back to another identity', async () => {
    auth.verifyIdToken.mockRejectedValue(new Error('expired'))
    await expect(run({ authorization: 'Bearer bad' }, 'valid-cookie')).rejects.toMatchObject({ statusCode: 401 })
    expect(auth.verifySessionCookie).not.toHaveBeenCalled()
  })

  it('rejects malformed authorization', async () => {
    await expect(run({ authorization: 'Basic abc' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('clears expired browser cookies and leaves public requests unauthenticated', async () => {
    auth.verifySessionCookie.mockRejectedValue(new Error('expired'))
    expect(await run({}, 'expired')).toMatchObject({ context: {}, deletedCookie: true })
    expect((await run()).context).toEqual({})
  })
})
