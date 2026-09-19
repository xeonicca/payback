import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateWithNativeGoogle } from './native-auth'

const sdk = vi.hoisted(() => ({ signIn: vi.fn(), link: vi.fn(), credential: vi.fn(), nativeSignIn: vi.fn() }))
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: sdk.credential },
  signInWithCredential: sdk.signIn,
  linkWithCredential: sdk.link,
}))
vi.mock('@capacitor-firebase/authentication', () => ({ FirebaseAuthentication: { signInWithGoogle: sdk.nativeSignIn } }))

describe('native Google credential bridge', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    sdk.nativeSignIn.mockResolvedValue({ credential: { idToken: 'google-id-token' } })
    sdk.credential.mockReturnValue({ providerId: 'google.com' })
  })

  it('signs in the JavaScript SDK while leaving native authentication disabled', async () => {
    sdk.signIn.mockResolvedValue({ user: { uid: 'google-user' } })
    expect(await authenticateWithNativeGoogle({} as any)).toMatchObject({ uid: 'google-user' })
    expect(sdk.nativeSignIn).toHaveBeenCalledWith({ skipNativeAuth: true })
  })

  it('upgrades the existing anonymous JS identity without creating another account', async () => {
    const guest = { uid: 'guest-uid', isAnonymous: true }
    sdk.link.mockImplementation(async (user, credential) => {
      expect(user).toBe(guest)
      expect(credential).toEqual({ providerId: 'google.com' })
      return { user: { ...user, isAnonymous: false } }
    })
    expect(await authenticateWithNativeGoogle({ currentUser: guest } as any, true)).toEqual({ uid: 'guest-uid', isAnonymous: false })
    expect(sdk.signIn).not.toHaveBeenCalled()
  })

  it('never links credentials to a different identity if the user signs out during the native prompt', async () => {
    const auth = { currentUser: { uid: 'guest' } as any }
    sdk.nativeSignIn.mockImplementation(async () => {
      auth.currentUser = null
      return { credential: { idToken: 'token' } }
    })
    await expect(authenticateWithNativeGoogle(auth as any, true)).rejects.toThrow()
    expect(sdk.link).not.toHaveBeenCalled()
  })

  it('rejects missing credentials without attempting Firebase sign in', async () => {
    sdk.nativeSignIn.mockResolvedValue({})
    await expect(authenticateWithNativeGoogle({} as any)).rejects.toThrow()
    expect(sdk.signIn).not.toHaveBeenCalled()
  })
})
