// Re-analysing a receipt replaces its item list, which would drop the
// per-item splits (sharedByMemberIds) people set by hand. This carries them
// over to the new reading of the same receipt.
//
// Unit prices are what two readings of a receipt reliably agree on; names are
// not (a newer model fixes OCR mistakes and drops product-code prefixes). So
// every line is broken into quantity-1 units, units are matched on unit price,
// and the name only decides between units at the same price.

// Comparable product name: width, spacing, case and a leading code removed
function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^\d{3,}/, '')
}

function bigrams(text) {
  const grams = []
  for (let i = 0; i < text.length - 1; i++)
    grams.push(text.slice(i, i + 2))
  return grams.length ? grams : [text]
}

// Dice coefficient over character bigrams, 0..1
function nameSimilarity(a, b) {
  const x = bigrams(normalizeName(a))
  const y = bigrams(normalizeName(b))
  const pool = [...y]
  let shared = 0
  for (const gram of x) {
    const at = pool.indexOf(gram)
    if (at !== -1) {
      shared++
      pool.splice(at, 1)
    }
  }
  return (2 * shared) / (x.length + y.length)
}

function similarity(oldItem, newItem) {
  return Math.max(
    nameSimilarity(oldItem.name, newItem.name),
    oldItem.translatedName && newItem.translatedName
      ? nameSimilarity(oldItem.translatedName, newItem.translatedName)
      : 0,
  )
}

const cents = price => Math.round((price || 0) * 100)
const unitsOf = item => (Number.isInteger(item.quantity) && item.quantity > 1 ? item.quantity : 1)

// Order-insensitive identity of a split; '' means "shared by everyone"
const splitKey = ids => [...(ids ?? [])].sort().join(',')

function toUnits(items) {
  const units = []
  items.forEach((item, line) => {
    for (let i = 0; i < unitsOf(item); i++)
      units.push({ item, line, order: units.length })
  })
  return units
}

/**
 * Copies sharedByMemberIds from the old items onto the new ones.
 *
 * A new line takes the split of the old units it matched. When those units
 * were split differently (three of one product, each for a different person,
 * read back as one ×3 line), the line is divided into one line per split so
 * nobody's assignment is lost; the line totals still add up to the original.
 *
 * @returns {{ items: object[], carried: number, lost: number }} carried and
 *   lost count split units: carried were matched, lost found no new unit.
 */
function carryOverItemSplits(oldItems, newItems) {
  const oldUnits = toUnits(oldItems ?? [])
  const newUnits = toUnits(newItems ?? [])

  // Best-first assignment between units at the same unit price; identical
  // names fall back to receipt order, which both readings follow
  const pairs = []
  for (const n of newUnits) {
    for (const o of oldUnits) {
      if (cents(o.item.price) === cents(n.item.price))
        pairs.push({ n, o, score: similarity(o.item, n.item) })
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.o.order - b.o.order || a.n.order - b.n.order)

  const matchOf = new Map()
  const usedOld = new Set()
  for (const { n, o } of pairs) {
    if (matchOf.has(n) || usedOld.has(o))
      continue
    matchOf.set(n, o)
    usedOld.add(o)
  }

  const carried = oldUnits.filter(o => usedOld.has(o) && splitKey(o.item.sharedByMemberIds)).length
  const lost = oldUnits.filter(o => !usedOld.has(o) && splitKey(o.item.sharedByMemberIds)).length

  const items = []
  ;(newItems ?? []).forEach((newItem, line) => {
    // Group this line's units by the split they inherited, in first-seen order
    const groups = new Map()
    for (const unit of newUnits.filter(u => u.line === line)) {
      const ids = matchOf.get(unit)?.item.sharedByMemberIds
      const key = splitKey(ids)
      if (!groups.has(key))
        groups.set(key, { ids, size: 0 })
      groups.get(key).size++
    }

    const withSplit = (base, ids) => (splitKey(ids) ? { ...base, sharedByMemberIds: [...ids] } : { ...base })

    if (groups.size <= 1) {
      const [only] = groups.values()
      items.push(withSplit(newItem, only?.ids))
      return
    }

    // Divide the line; the last part takes the remainder so totals still match
    const total = unitsOf(newItem)
    let allocated = 0
    const parts = [...groups.values()]
    parts.forEach(({ ids, size }, i) => {
      const part = { ...newItem, quantity: size }
      if (newItem.lineTotal != null) {
        const share = i === parts.length - 1
          ? newItem.lineTotal - allocated
          : Math.round((newItem.lineTotal * size / total) * 100) / 100
        allocated += share
        part.lineTotal = share
      }
      items.push(withSplit(part, ids))
    })
  })

  return { items, carried, lost }
}

module.exports = { carryOverItemSplits, nameSimilarity, normalizeName }
