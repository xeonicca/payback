const REASON_CODES = Object.freeze({
  GRAND_TOTAL_MISMATCH: 'grand_total_mismatch',
  ITEM_COUNT_MISMATCH: 'item_count_mismatch',
  SUBTOTAL_MISMATCH: 'subtotal_mismatch',
  ITEM_LINE_TOTAL_MISMATCH: 'item_line_total_mismatch',
  CURRENCY_UNEXPECTED: 'currency_unexpected',
  ITEM_UNIT_PRICE_CORRECTED: 'item_unit_price_corrected',
})

const WARNING_CODES = new Set([
  REASON_CODES.GRAND_TOTAL_MISMATCH,
  REASON_CODES.ITEM_COUNT_MISMATCH,
  REASON_CODES.SUBTOTAL_MISMATCH,
  REASON_CODES.ITEM_LINE_TOTAL_MISMATCH,
  REASON_CODES.CURRENCY_UNEXPECTED,
])

function reconcileReceipt(parsedData, tripCurrency) {
  const reviewReasons = []
  const items = (parsedData.items || []).map(item => ({ ...item }))

  // Check 1: per-item line-total consistency
  for (const item of items) {
    if (item.lineTotal == null) continue
    const qty = item.quantity ?? 1
    const computed = item.price * qty
    const tolerance = Math.max(0.01, 0.02 * Math.abs(item.lineTotal))

    // Pattern A: unit-price slot contains the line total (qty > 1 and price ≈ lineTotal)
    if (qty > 1 && Math.abs(item.price - item.lineTotal) <= 0.01 * Math.abs(item.lineTotal)) {
      item.price = Math.round((item.lineTotal / qty) * 100) / 100
      reviewReasons.push(REASON_CODES.ITEM_UNIT_PRICE_CORRECTED)
      continue
    }

    // Pattern B: genuine mismatch
    if (Math.abs(computed - item.lineTotal) > tolerance) {
      reviewReasons.push(REASON_CODES.ITEM_LINE_TOTAL_MISMATCH)
    }
  }

  // Check 2: whole-receipt math
  if (parsedData.grandTotal != null) {
    const itemsTotal = items.reduce((sum, it) => {
      const lt = it.lineTotal ?? (it.price * (it.quantity ?? 1))
      return sum + lt
    }, 0)
    const expected = itemsTotal
      + (parsedData.taxAmount ?? 0)
      + (parsedData.serviceCharge ?? 0)
      + (parsedData.tip ?? 0)
      - (parsedData.discount ?? 0)
    const tolerance = Math.max(1, 0.02 * Math.abs(parsedData.grandTotal))
    if (Math.abs(expected - parsedData.grandTotal) > tolerance) {
      reviewReasons.push(REASON_CODES.GRAND_TOTAL_MISMATCH)
    }
  }

  // Check 3: item count cross-check
  if (parsedData.printedItemCount != null) {
    const totalQty = items.reduce((sum, it) => sum + (it.quantity ?? 1), 0)
    if (totalQty !== parsedData.printedItemCount) {
      reviewReasons.push(REASON_CODES.ITEM_COUNT_MISMATCH)
    }
  }

  // Check 4: currency sanity
  if (parsedData.currency && parsedData.currency !== tripCurrency) {
    reviewReasons.push(REASON_CODES.CURRENCY_UNEXPECTED)
  }

  // Check 5: subtotal sanity
  if (parsedData.subtotal != null) {
    const itemsTotal = items.reduce((sum, it) => {
      const lt = it.lineTotal ?? (it.price * (it.quantity ?? 1))
      return sum + lt
    }, 0)
    const tolerance = Math.max(1, 0.02 * Math.abs(parsedData.subtotal))
    if (Math.abs(itemsTotal - parsedData.subtotal) > tolerance) {
      reviewReasons.push(REASON_CODES.SUBTOTAL_MISMATCH)
    }
  }

  const dedupedReasons = [...new Set(reviewReasons)]
  const needsReview = dedupedReasons.some(r => WARNING_CODES.has(r))
  return { ...parsedData, items, needsReview, reviewReasons: dedupedReasons }
}

module.exports = { reconcileReceipt, REASON_CODES, WARNING_CODES }
