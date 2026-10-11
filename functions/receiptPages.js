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
    return diff !== 0 ? diff : a.localeCompare(b)
  })
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
 * @returns {Promise<{ status: 'analyze'|'waiting'|'duplicate'|'missing', paths: string[] }>}
 *   paths is in receipt order and only meaningful for 'analyze'.
 */
async function claimPageForAnalysis(expenseRef, resizedPath) {
  return expenseRef.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(expenseRef)
    if (!snapshot.exists) {
      return { status: 'missing', paths: [] }
    }

    const data = snapshot.data() || {}
    const existing = Array.isArray(data.imageUrls) ? data.imageUrls : []

    // The Resize Images extension retries on failure, so the same page can
    // arrive twice. Counting it twice would analyze an incomplete receipt.
    if (existing.includes(resizedPath)) {
      return { status: 'duplicate', paths: sortPagePaths(existing) }
    }

    const paths = sortPagePaths([...existing, resizedPath])
    tx.update(expenseRef, { imageUrls: paths })

    const expected = Number.isInteger(data.imageCount) && data.imageCount > 0
      ? data.imageCount
      : 1

    return { status: paths.length >= expected ? 'analyze' : 'waiting', paths }
  })
}

module.exports = { pageIndexOf, sortPagePaths, claimPageForAnalysis, PAGE_INDEX_REGEX }
