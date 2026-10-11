/** A long receipt beyond this many photos stops being a realistic case and makes the AI call expensive. */
export const MAX_RECEIPT_PAGES = 5

/** The parts of a File this module needs, so tests need no File constructor. */
export interface PageFileLike {
  name: string
  size: number
  lastModified: number
}

function isSamePage(a: PageFileLike, b: PageFileLike): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

/**
 * Add newly picked photos to the pages already chosen.
 *
 * A file already in the list is skipped silently — the user re-picked the same
 * photo, which is harmless. A file that would exceed the cap is counted in
 * `rejected` so the caller can tell the user why it did not appear.
 */
export function appendPages<T extends PageFileLike>(
  existing: T[],
  incoming: T[],
  max: number = MAX_RECEIPT_PAGES,
): { pages: T[], rejected: number } {
  const pages = [...existing]
  let rejected = 0

  for (const candidate of incoming) {
    if (pages.some(page => isSamePage(page, candidate))) {
      continue
    }
    if (pages.length >= max) {
      rejected += 1
      continue
    }
    pages.push(candidate)
  }

  return { pages, rejected }
}

/**
 * Storage filename for a receipt page. The number is what the Cloud Function
 * sorts on, so page order survives uploads finishing out of order.
 * @param index - 0-based position in the picker
 * @param originalName - the photo's own filename, used only for its extension
 */
export function pageFileName(index: number, originalName: string): string {
  const rawExtension = originalName.includes('.') ? originalName.split('.').pop() ?? '' : ''
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `page-${index + 1}.${extension || 'jpg'}`
}
