import { beforeEach, describe, expect, it, vi } from 'vitest'

const vuefire = vi.hoisted(() => ({ getCurrentUser: vi.fn() }))
vi.mock('vuefire', () => vuefire)

describe('initUser client plugin', () => {
  const login = { checkUser: vi.fn(), setSession: vi.fn(), clearSession: vi.fn() }
  let sessionUser: { value: unknown }

  beforeEach(() => {
    vi.resetAllMocks()
    sessionUser = { value: null }
    vi.stubGlobal('defineNuxtPlugin', (fn: unknown) => fn)
    vi.stubGlobal('useLogin', () => login)
    vi.stubGlobal('useSessionUser', () => sessionUser)
  })

  async function run() {
    const { default: plugin } = await import('../../plugins/initUser.client')
    await (plugin as unknown as () => Promise<unknown>)()
  }

  it('keeps the session when the Firebase client login matches the cookie', async () => {
    login.checkUser.mockResolvedValue({ uid: 'u1' })
    vuefire.getCurrentUser.mockResolvedValue({ uid: 'u1' })
    await run()
    expect(sessionUser.value).toEqual({ uid: 'u1' })
    expect(login.clearSession).not.toHaveBeenCalled()
    expect(login.setSession).not.toHaveBeenCalled()
  })

  it('drops the session when the cookie outlived the Firebase client login', async () => {
    login.checkUser.mockResolvedValue({ uid: 'u1' })
    vuefire.getCurrentUser.mockResolvedValue(null)
    await run()
    expect(sessionUser.value).toBeNull()
    expect(login.clearSession).toHaveBeenCalled()
  })

  it('drops the session when the Firebase client login cannot be restored', async () => {
    login.checkUser.mockResolvedValue({ uid: 'u1' })
    vuefire.getCurrentUser.mockRejectedValue(new Error('auth/internal-error'))
    await run()
    expect(sessionUser.value).toBeNull()
    expect(login.clearSession).toHaveBeenCalled()
  })

  it('restores the session from the Firebase client login when the cookie is missing', async () => {
    login.checkUser.mockResolvedValue(undefined)
    vuefire.getCurrentUser.mockResolvedValue({ uid: 'u1' })
    await run()
    expect(login.setSession).toHaveBeenCalledWith({ uid: 'u1' })
    expect(login.clearSession).not.toHaveBeenCalled()
  })

  it('replaces a cookie that belongs to a different account', async () => {
    login.checkUser.mockResolvedValue({ uid: 'u1' })
    vuefire.getCurrentUser.mockResolvedValue({ uid: 'u2' })
    await run()
    expect(sessionUser.value).toBeNull()
    expect(login.setSession).toHaveBeenCalledWith({ uid: 'u2' })
  })

  it('stays logged out when restoring the session fails', async () => {
    login.checkUser.mockResolvedValue(undefined)
    vuefire.getCurrentUser.mockResolvedValue({ uid: 'u1' })
    login.setSession.mockRejectedValue(new Error('network'))
    await expect(run()).resolves.toBeUndefined()
    expect(sessionUser.value).toBeNull()
  })

  it('stays logged out when there is no session at all', async () => {
    login.checkUser.mockResolvedValue(undefined)
    vuefire.getCurrentUser.mockResolvedValue(null)
    await run()
    expect(sessionUser.value).toBeNull()
    expect(login.setSession).not.toHaveBeenCalled()
    expect(login.clearSession).not.toHaveBeenCalled()
  })
})
