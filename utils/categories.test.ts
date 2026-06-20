import { describe, expect, it } from 'vitest'
import { CATEGORY_KEYS, coerceCategory, getCategoryMeta } from './categories'

describe('categories', () => {
  it('has the 7 expected keys in order', () => {
    expect(CATEGORY_KEYS).toEqual([
      'food', 'groceries', 'transport', 'lodging', 'activities', 'shopping', 'other',
    ])
  })

  it('coerces a known key to itself', () => {
    expect(coerceCategory('food')).toBe('food')
  })

  it('coerces unknown / empty / nullish to other', () => {
    expect(coerceCategory('FOOD')).toBe('other')
    expect(coerceCategory('nonsense')).toBe('other')
    expect(coerceCategory('')).toBe('other')
    expect(coerceCategory(undefined)).toBe('other')
    expect(coerceCategory(null)).toBe('other')
  })

  it('returns zh-TW label + icon for a known key', () => {
    const meta = getCategoryMeta('transport')
    expect(meta.label).toBe('交通')
    expect(meta.icon).toBe('lucide:car')
  })

  it('returns the other meta for an unknown key', () => {
    expect(getCategoryMeta('nope').label).toBe('其他')
  })
})
