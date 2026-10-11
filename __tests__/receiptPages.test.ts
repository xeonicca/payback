import { describe, expect, it } from 'vitest'
import { appendPages, MAX_RECEIPT_PAGES, pageFileName } from '@/utils/receiptPages'

function file(name: string, size = 100, lastModified = 1) {
  return { name, size, lastModified }
}

describe('appendPages', () => {
  it('appends to an empty list in the order given', () => {
    const { pages, rejected } = appendPages([], [file('a.jpg'), file('b.jpg')])
    expect(pages.map(p => p.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(rejected).toBe(0)
  })

  it('appends after existing pages rather than replacing them', () => {
    const { pages } = appendPages([file('a.jpg')], [file('b.jpg')])
    expect(pages.map(p => p.name)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('silently skips a file already in the list', () => {
    const { pages, rejected } = appendPages([file('a.jpg')], [file('a.jpg')])
    expect(pages).toHaveLength(1)
    expect(rejected).toBe(0)
  })

  it('treats same-name-different-size files as different pages', () => {
    const { pages } = appendPages([file('IMG_0001.jpg', 100)], [file('IMG_0001.jpg', 200)])
    expect(pages).toHaveLength(2)
  })

  it('stops at the cap and reports how many were rejected', () => {
    const existing = [file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg'), file('5.jpg')]
    const { pages, rejected } = appendPages(existing, [file('6.jpg'), file('7.jpg')])
    expect(pages).toHaveLength(5)
    expect(rejected).toBe(2)
  })

  it('honours a custom cap', () => {
    const { pages, rejected } = appendPages([], [file('a.jpg'), file('b.jpg')], 1)
    expect(pages).toHaveLength(1)
    expect(rejected).toBe(1)
  })

  it('does not mutate the existing array', () => {
    const existing = [file('a.jpg')]
    appendPages(existing, [file('b.jpg')])
    expect(existing).toHaveLength(1)
  })

  it('caps at five pages by default', () => {
    expect(MAX_RECEIPT_PAGES).toBe(5)
  })
})

describe('pageFileName', () => {
  it('numbers pages from 1 and keeps the extension', () => {
    expect(pageFileName(0, 'IMG_4021.jpg')).toBe('page-1.jpg')
    expect(pageFileName(2, 'IMG_4023.HEIC')).toBe('page-3.heic')
  })

  it('falls back to jpg when the original name has no usable extension', () => {
    expect(pageFileName(0, 'photo')).toBe('page-1.jpg')
    expect(pageFileName(0, 'photo.')).toBe('page-1.jpg')
    expect(pageFileName(0, 'weird.!!!')).toBe('page-1.jpg')
  })

  it('strips anything non-alphanumeric out of the extension', () => {
    expect(pageFileName(0, 'shot.jpg?v=2')).toBe('page-1.jpgv2')
  })
})
