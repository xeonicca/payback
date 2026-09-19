import { describe, expect, it } from 'vitest'
import { getApiRequestOptions, getPublicOrigin } from './api'

describe('app API transport', () => {
  it('keeps browser requests same-origin with cookies', async () => {
    expect(await getApiRequestOptions('/api/trips/join', false, 'https://api.example.com', async () => 'token')).toEqual({})
  })

  it('sends native identity to the configured HTTPS backend without cookies', async () => {
    expect(await getApiRequestOptions('/api/trips/join', true, 'https://payback.example.com/', async () => 'firebase-token')).toEqual({
      baseURL: 'https://payback.example.com',
      credentials: 'omit',
      headers: { Authorization: 'Bearer firebase-token' },
    })
  })

  it('allows public native requests without inventing authentication', async () => {
    expect(await getApiRequestOptions('/api/trips/join-info', true, 'https://payback.example.com', async () => null)).toMatchObject({ headers: {} })
  })

  it.each(['', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/api', 'https://example.com?x=1'])('rejects unsafe or ambiguous native API origins: %s', async (origin) => {
    await expect(getApiRequestOptions('/api/trips/join', true, origin, async () => 'secret')).rejects.toThrow()
  })

  it.each(['https://evil.example/api/trips', '//evil.example/api/trips', '/api/../external', '/api/\\evil', '/api/%2e%2e/external'])('never sends identity to arbitrary paths: %s', async (path) => {
    await expect(getApiRequestOptions(path, true, 'https://payback.example.com', async () => 'secret')).rejects.toThrow()
  })

  it('creates shareable links using the site origin on native', () => {
    expect(getPublicOrigin(true, 'https://payback.example.com/', 'capacitor://localhost')).toBe('https://payback.example.com')
    expect(getPublicOrigin(false, '', 'http://localhost:3000')).toBe('http://localhost:3000')
  })
})
