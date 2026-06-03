/**
 * Re-runs the NEW analyzeReceiptWithAI pipeline against existing receipt
 * images and prints a side-by-side diff vs. what's currently stored.
 *
 * Usage: node regression-receipts.js [limit]
 * Costs: ~$0.005 per receipt at gemini-2.5-flash pricing.
 */

const admin = require('firebase-admin')
const path = require('path')
const { analyzeReceiptWithAI, getImageAsBase64, getContentTypeFromPath } = require('./receiptAnalysis')

const limit = Number.parseInt(process.argv[2] || '20', 10)
const serviceAccount = require(path.resolve(__dirname, '../service-account.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()
const bucket = admin.storage().bucket()

async function fetchSample() {
  const trips = await db.collection('trips').orderBy('createdAt', 'desc').limit(20).get()
  const out = []
  for (const t of trips.docs) {
    const exps = await t.ref.collection('expenses').orderBy('createdAt', 'desc').limit(10).get()
    for (const e of exps.docs) {
      const d = e.data()
      if (!d.receiptImageUrl) continue
      out.push({ tripId: t.id, expenseId: e.id, current: d, tripCurrency: t.data().tripCurrency, defaultCurrency: t.data().defaultCurrency || 'TWD' })
    }
  }
  return out
    .sort((a, b) => (b.current.createdAt?.toMillis?.() || 0) - (a.current.createdAt?.toMillis?.() || 0))
    .slice(0, limit)
}

function summarize(parsed) {
  const items = parsed.items || []
  const itemsSum = items.reduce((s, it) => s + (it.lineTotal ?? it.price * (it.quantity || 1)), 0)
  const qtyTotal = items.reduce((s, it) => s + (it.quantity || 1), 0)
  return {
    grandTotal: parsed.grandTotal,
    subtotal: parsed.subtotal,
    tax: parsed.taxAmount,
    service: parsed.serviceCharge,
    discount: parsed.discount,
    tip: parsed.tip,
    printedItemCount: parsed.printedItemCount,
    currency: parsed.currency,
    itemCount: items.length,
    qtyTotal,
    itemsSum,
  }
}

async function main() {
  const sample = await fetchSample()
  console.log(`Running regression on ${sample.length} receipts...\n`)

  for (const { tripId, expenseId, current, tripCurrency, defaultCurrency } of sample) {
    console.log('='.repeat(80))
    console.log(`${tripId}/${expenseId}  (trip ${tripCurrency})`)
    try {
      const imageBase64 = await getImageAsBase64(bucket.name, current.receiptImageUrl)
      const contentType = getContentTypeFromPath(current.receiptImageUrl)
      const fresh = await analyzeReceiptWithAI(imageBase64, contentType, tripCurrency, defaultCurrency)

      const oldSummary = summarize(current)
      const newSummary = summarize(fresh)
      console.log('OLD:', JSON.stringify(oldSummary))
      console.log('NEW:', JSON.stringify(newSummary))
      console.log('needsReview:', fresh.needsReview, 'reasons:', fresh.reviewReasons)

      // Show first 5 item names old vs new for line-wrap inspection.
      const oldNames = (current.items || []).slice(0, 5).map(it => `[${it.itemNumber ?? ''}] ${it.name}`)
      const newNames = (fresh.items || []).slice(0, 5).map(it => `[${it.itemNumber ?? ''}] ${it.name}`)
      console.log('OLD names:', oldNames)
      console.log('NEW names:', newNames)
    } catch (err) {
      console.error('FAILED:', err.message)
    }
    console.log('')
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
