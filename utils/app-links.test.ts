import { describe, expect, it } from 'vitest'
import { getAppLinkPath, getSafeReturnPath } from './app-links'

describe('iOS invitation links and login return paths', () => {
  it.each([
    ['https://payback.example.com/join/ABC123?openExternalBrowser=1', '/join/ABC123'],
    ['https://payback.example.com/guest/GUEST1', '/guest/GUEST1'],
    ['payback://app/invite/INVITE1', '/invite/INVITE1'],
    ['payback://app/trips/trip-id/expenses', '/trips/trip-id/expenses'],
  ])('opens the intended internal route from %s', (url, expected) => {
    expect(getAppLinkPath(url, 'https://payback.example.com')).toBe(expected)
  })

  it.each([
    'https://evil.example/join/ABC',
    'https://payback.example.com.evil.example/join/ABC',
    'payback://evil/join/ABC',
    'javascript:alert(1)',
    'payback://app/api/admin/migrate',
    'com.google.callback:/oauth?code=123',
    'https://payback.example.com/login',
  ])('ignores unrelated or untrusted app links: %s', (url) => {
    expect(getAppLinkPath(url, 'https://payback.example.com')).toBeNull()
  })

  it('preserves valid login destinations', () => {
    expect(getSafeReturnPath('/trips/my-trip?tab=expenses')).toBe('/trips/my-trip?tab=expenses')
  })

  it.each(['//evil.example', '/\\evil.example', '/%2f%2fevil.example', '/login?redirect=/login', 'https://evil.example', undefined, ['/trips/a']])('rejects unsafe return paths: %s', (path) => {
    expect(getSafeReturnPath(path)).toBe('/')
  })
})
