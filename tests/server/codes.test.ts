import { describe, expect, it, vi } from 'vitest'
import { CODE_ALPHABET, generateCode, generateUniqueCode } from '../../server/utils/codes'

describe('generateCode', () => {
  it('returns 10 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode()
      expect(code).toHaveLength(10)
      for (const ch of code)
        expect(CODE_ALPHABET).toContain(ch)
    }
  })

  it('honours a custom length', () => {
    expect(generateCode(6)).toHaveLength(6)
  })

  it('does not repeat across many calls', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateCode()))
    expect(codes.size).toBe(1000)
  })
})

describe('generateUniqueCode', () => {
  it('retries until the checker reports the code is free', async () => {
    const isTaken = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)
    const code = await generateUniqueCode(isTaken)
    expect(code).toHaveLength(10)
    expect(isTaken).toHaveBeenCalledTimes(3)
  })

  it('gives up after 5 collisions', async () => {
    await expect(generateUniqueCode(async () => true)).rejects.toThrow('unique code')
  })
})
