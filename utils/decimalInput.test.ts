import { describe, expect, it } from 'vitest'
import { toDotDecimal } from './decimalInput'

describe('toDotDecimal', () => {
  it('turns a comma decimal separator into a dot', () => {
    expect(toDotDecimal('12,5')).toBe('12.5')
    expect(Number(toDotDecimal('12,5'))).toBe(12.5)
  })

  it('leaves dot decimals and integers alone', () => {
    expect(toDotDecimal('12.5')).toBe('12.5')
    expect(toDotDecimal('1200')).toBe('1200')
  })
})
