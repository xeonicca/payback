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

module.exports = { pageIndexOf, sortPagePaths, PAGE_INDEX_REGEX }
