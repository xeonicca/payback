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

function reconcileReceipt(parsedData, _tripCurrency) {
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

  const needsReview = reviewReasons.some(r => WARNING_CODES.has(r))
  return { ...parsedData, items, needsReview, reviewReasons }
}

module.exports = { reconcileReceipt, REASON_CODES, WARNING_CODES }
