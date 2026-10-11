const PAGE_INDEX_REGEX = /page-(\d+)/i

/**
 * Parse the 1-based page number out of a receipt page path.
 * Only the basename is inspected, so path segments that happen to contain
 * "page-<n>" (a human-chosen trip id, say) cannot reorder pages.
 * @param {string} path - Storage path, e.g. trips/t1/expenses/e1/resized/page-2_1600x1600.jpeg
 * @returns {number} The page number, or Number.MAX_SAFE_INTEGER for a path
 *   without one (pre-feature uploads named after the original photo).
 */
function pageIndexOf(path) {
  const basename = String(path).split('/').pop() || ''
  const match = PAGE_INDEX_REGEX.exec(basename)
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER
}

/**
 * Sort page paths into receipt order: page-1, page-2, … then any unnumbered
 * paths alphabetically. Returns a new array.
 * @param {string[]} paths
 * @returns {string[]} A new, sorted array; the input is left untouched.
 */
function sortPagePaths(paths) {
  return [...paths].sort((a, b) => {
    const diff = pageIndexOf(a) - pageIndexOf(b)
    return diff !== 0 ? diff : String(a).localeCompare(String(b))
  })
}

/**
 * True when two page paths represent the same receipt page. Numbered pages
 * (page-N) are compared by page number rather than exact path, because the
 * Resize Images extension's IMG_SIZES/IMAGE_TYPE settings (configured in the
 * Firebase console, not versioned in this repo) can emit more than one
 * resized object per original upload — same page, different path (e.g.
 * page-1_1600x1600.jpeg and page-1_800x800.jpeg). Unnumbered paths
 * (pre-feature uploads named after the original photo) have no page number
 * to compare, so they fall back to exact equality — otherwise every
 * unnumbered path would collapse into "the same page" as any other.
 * @param {string} a
 * @param {string} b
 * @returns {boolean} True when a and b are the same receipt page.
 */
function isSamePage(a, b) {
  const indexA = pageIndexOf(a)
  const indexB = pageIndexOf(b)
  if (indexA === Number.MAX_SAFE_INTEGER || indexB === Number.MAX_SAFE_INTEGER)
    return a === b
  return indexA === indexB
}

/**
 * Append one uploaded page to an expense and decide whether this caller should
 * run the AI analysis. Called once per storage-trigger invocation.
 *
 * Exactly one caller per expense receives 'analyze': the one whose write
 * completes the set. The transaction serializes concurrent invocations, so the
 * decision cannot be taken twice.
 *
 * Takes a DocumentReference rather than a db handle so this module never
 * imports firebase-admin, which keeps it drivable from the emulator tests.
 *
 * @param {import('firebase-admin/firestore').DocumentReference} expenseRef
 * @param {string} resizedPath - Storage path of the resized page that just landed
 * @returns {Promise<{ status: 'analyze'|'waiting'|'duplicate'|'missing', paths: string[], expected: number|null }>}
 *   paths is the post-claim state of imageUrls, in receipt order, for every
 *   status except 'missing' (where there is no document to read it from).
 *   expected is the page count the gate is waiting for, or null for 'missing'.
 */
async function claimPageForAnalysis(expenseRef, resizedPath) {
  return expenseRef.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(expenseRef)
    if (!snapshot.exists) {
      return { status: 'missing', paths: [], expected: null }
    }

    const data = snapshot.data() || {}
    const existing = Array.isArray(data.imageUrls) ? data.imageUrls : []
    const expected = Number.isInteger(data.imageCount) && data.imageCount > 0
      ? data.imageCount
      : 1

    // The Resize Images extension retries on failure, and can also emit
    // multiple resized sizes for the same original, so the same page can
    // arrive more than once under different paths. Counting it twice would
    // analyze an incomplete receipt (or re-analyze a complete one).
    if (existing.some(path => isSamePage(path, resizedPath))) {
      return { status: 'duplicate', paths: sortPagePaths(existing), expected }
    }

    const paths = sortPagePaths([...existing, resizedPath])
    tx.update(expenseRef, { imageUrls: paths })

    // Count distinct pages, not array length: dedup above already keeps at
    // most one path per numbered page, but election must still be judged on
    // pages, not resized-object count.
    const distinctPageCount = new Set(paths.map(path => pageIndexOf(path))).size

    return { status: distinctPageCount >= expected ? 'analyze' : 'waiting', paths, expected }
  }, { maxAttempts: 10 })
}

module.exports = { pageIndexOf, sortPagePaths, claimPageForAnalysis, PAGE_INDEX_REGEX }
