# Robust Receipt Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI receipt extraction reliable: split identifiers from names, capture tax/service/discount/subtotal as first-class fields, reconcile math + item counts server-side, surface issues in the edit UI, and bump to a better model.

**Architecture:** Four cooperating layers — (1) expanded Zod schemas in `receiptAnalysis.js`; (2) rewritten Gemini prompt with explicit multi-line / forbidden-line / itemNumber / currency rules and one worked example; (3) a new `reconcile.js` module that runs 5 sanity checks and accumulates reason codes; (4) frontend that reads new fields and shows a review banner. Server-side function output writes `needsReview` + `reviewReasons` to Firestore.

**Tech Stack:** Node 22 + `@google/genai` (Cloud Functions, CommonJS) · `zod` + `zod-to-json-schema` · Node built-in `node:test` for reconcile unit tests (no new deps) · Nuxt 3 / Vue 3 / Tailwind for UI · existing Vitest at the root for any type-level checks.

**Spec:** `docs/superpowers/specs/2026-05-14-robust-receipt-extraction-design.md`

---

## File Map

**Cloud Functions (CommonJS):**
- `functions/receiptAnalysis.js` — modify: expand Zod schemas, rewrite prompt, bump model, replace `sanitizeItemPrices` with `reconcileReceipt`, expand `prepareFirestoreUpdateData`.
- `functions/reconcile.js` — **new**: pure module exporting `reconcileReceipt(parsedData, tripCurrency)`.
- `functions/__tests__/reconcile.test.js` — **new**: `node:test` suite for all 5 checks + orchestration.
- `functions/package.json` — modify: add `"test"` script.
- `functions/regression-receipts.js` — **new**: dev-only script that diffs the new pipeline against current Firestore data for the 20-receipt sample.

**Frontend (TypeScript + Vue):**
- `types/index.ts` — modify: extend `ExpenseDetailItem` and `Expense`.
- `utils/converter.ts` — modify: `expenseConverter.fromFirestore` reads new optional fields.
- `components/ExpenseDetailItem.vue` — modify: render `itemNumber` next to the name.
- `components/ExpenseReviewBanner.vue` — **new**: reads `reviewReasons[]`, renders warning banner.
- `pages/trips/[tripId]/expenses/[expenseId]/index.vue` — modify: mount banner.
- `pages/trips/[tripId]/expenses/[expenseId]/edit.vue` — modify: mount banner.

---

## Task 1: Add `node:test` runner to functions package

**Files:**
- Modify: `functions/package.json`

- [ ] **Step 1: Add `test` script**

Edit `functions/package.json` so the `"scripts"` block reads:

```json
"scripts": {
  "serve": "firebase emulators:start --only functions",
  "shell": "firebase functions:shell",
  "start": "npm run shell",
  "deploy": "firebase deploy --only functions",
  "logs": "firebase functions:log",
  "test": "node --test __tests__/"
}
```

No new dependencies — Node 22 ships `node:test` and `node:assert`.

- [ ] **Step 2: Create the test directory with a smoke test**

Create `functions/__tests__/smoke.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')

test('smoke', () => {
  assert.equal(1 + 1, 2)
})
```

- [ ] **Step 3: Run it**

Run from `functions/`: `npm test`
Expected: `# pass 1` with exit code 0.

- [ ] **Step 4: Commit**

```bash
git add functions/package.json functions/__tests__/smoke.test.js
git commit -m "chore(functions): add node:test runner and smoke test"
```

---

## Task 2: Reconcile module — file scaffold + reason-code constants

**Files:**
- Create: `functions/reconcile.js`
- Modify: `functions/__tests__/reconcile.test.js` (new — replaces smoke as the primary test suite; keep smoke for now)

- [ ] **Step 1: Write failing test for the public surface**

Create `functions/__tests__/reconcile.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reconcileReceipt, REASON_CODES } = require('../reconcile')

test('exports a function and reason-code constants', () => {
  assert.equal(typeof reconcileReceipt, 'function')
  assert.ok(REASON_CODES.GRAND_TOTAL_MISMATCH)
  assert.ok(REASON_CODES.ITEM_COUNT_MISMATCH)
  assert.ok(REASON_CODES.SUBTOTAL_MISMATCH)
  assert.ok(REASON_CODES.ITEM_LINE_TOTAL_MISMATCH)
  assert.ok(REASON_CODES.CURRENCY_UNEXPECTED)
  assert.ok(REASON_CODES.ITEM_UNIT_PRICE_CORRECTED)
})

test('returns parsedData with needsReview false and empty reasons when nothing is wrong', () => {
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 50, quantity: 2, lineTotal: 100 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(result.needsReview, false)
  assert.deepEqual(result.reviewReasons, [])
  assert.equal(result.items[0].price, 50)
})
```

- [ ] **Step 2: Run test, expect failure**

Run from `functions/`: `npm test -- --test-name-pattern reconcile`
Expected: FAIL — `Cannot find module '../reconcile'`.

- [ ] **Step 3: Create the module**

Create `functions/reconcile.js`:

```js
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
  const needsReview = reviewReasons.some(r => WARNING_CODES.has(r))
  return { ...parsedData, items, needsReview, reviewReasons }
}

module.exports = { reconcileReceipt, REASON_CODES, WARNING_CODES }
```

- [ ] **Step 4: Run tests, expect pass**

Run from `functions/`: `npm test`
Expected: 3 tests pass (smoke + 2 reconcile).

- [ ] **Step 5: Commit**

```bash
git add functions/reconcile.js functions/__tests__/reconcile.test.js
git commit -m "feat(functions): scaffold reconcileReceipt with reason-code constants"
```

---

## Task 3: Reconcile Check 1 — per-item line-total + unit-price correction

**Files:**
- Modify: `functions/reconcile.js`
- Modify: `functions/__tests__/reconcile.test.js`

- [ ] **Step 1: Write failing tests**

Append to `functions/__tests__/reconcile.test.js`:

```js
test('Check 1: auto-corrects unit price when model writes lineTotal into price slot', () => {
  // qty 3, lineTotal 300, but model wrote price=300 instead of 100
  const input = {
    grandTotal: 300,
    items: [{ name: 'a', price: 300, quantity: 3, lineTotal: 300 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(result.items[0].price, 100)
  assert.ok(result.reviewReasons.includes(REASON_CODES.ITEM_UNIT_PRICE_CORRECTED))
  assert.equal(result.needsReview, false, 'info-only code does not flip needsReview')
})

test('Check 1: flags genuine line-total mismatch without auto-correcting', () => {
  // qty 2 * 50 = 100, but receipt says lineTotal 120 — model misread something
  const input = {
    grandTotal: 120,
    items: [{ name: 'a', price: 50, quantity: 2, lineTotal: 120 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(result.items[0].price, 50, 'no auto-correct')
  assert.ok(result.reviewReasons.includes(REASON_CODES.ITEM_LINE_TOTAL_MISMATCH))
  assert.equal(result.needsReview, true)
})

test('Check 1: tolerates 2% rounding noise', () => {
  // 33.33 * 3 = 99.99 vs lineTotal 100 — within tolerance
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 33.33, quantity: 3, lineTotal: 100 }],
    currency: 'USD',
  }
  const result = reconcileReceipt(input, 'USD')
  assert.deepEqual(result.reviewReasons, [])
})

test('Check 1: skips items with null lineTotal', () => {
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 50, quantity: 2, lineTotal: null }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.deepEqual(result.reviewReasons, [])
})
```

- [ ] **Step 2: Run, expect failures**

Run from `functions/`: `npm test`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement Check 1**

Replace the body of `reconcileReceipt` in `functions/reconcile.js`:

```js
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
```

- [ ] **Step 4: Run, expect pass**

Run from `functions/`: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/reconcile.js functions/__tests__/reconcile.test.js
git commit -m "feat(functions): reconcile Check 1 — line-total + unit-price auto-correct"
```

---

## Task 4: Reconcile Check 2 — whole-receipt math

**Files:**
- Modify: `functions/reconcile.js`
- Modify: `functions/__tests__/reconcile.test.js`

- [ ] **Step 1: Write failing tests**

Append to `functions/__tests__/reconcile.test.js`:

```js
test('Check 2: flags grand-total mismatch beyond 2% tolerance', () => {
  // Real-world: Apurva Kempinski case. grandTotal 726000 but items sum to 1.6M.
  const input = {
    grandTotal: 726000,
    items: [
      { name: 'Bali Mt.', price: 480000, quantity: 3, lineTotal: 1440000 },
      { name: 'Espresso', price: 120000, quantity: 1, lineTotal: 120000 },
    ],
    serviceCharge: 60000,
    taxAmount: 66000,
    currency: 'IDR',
  }
  const result = reconcileReceipt(input, 'IDR')
  assert.ok(result.reviewReasons.includes(REASON_CODES.GRAND_TOTAL_MISMATCH))
  assert.equal(result.needsReview, true)
})

test('Check 2: accepts grand total when math reconciles with tax + service - discount + tip', () => {
  const input = {
    grandTotal: 1100,
    items: [{ name: 'x', price: 500, quantity: 2, lineTotal: 1000 }],
    taxAmount: 100,
    serviceCharge: 0,
    discount: 0,
    tip: 0,
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.GRAND_TOTAL_MISMATCH),
    false,
  )
})

test('Check 2: discount is subtracted', () => {
  // sum 1000 - discount 100 = 900
  const input = {
    grandTotal: 900,
    items: [{ name: 'x', price: 500, quantity: 2, lineTotal: 1000 }],
    discount: 100,
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.GRAND_TOTAL_MISMATCH),
    false,
  )
})

test('Check 2: tolerance is max(1, 2% of grandTotal)', () => {
  // grandTotal 50 USD — tolerance 1 (not 1.0)
  const input = {
    grandTotal: 50,
    items: [{ name: 'x', price: 49.5, quantity: 1, lineTotal: 49.5 }],
    currency: 'USD',
  }
  const result = reconcileReceipt(input, 'USD')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.GRAND_TOTAL_MISMATCH),
    false,
    '0.5 diff within 1-unit floor',
  )
})

test('Check 2: skipped when grandTotal is null', () => {
  const input = {
    grandTotal: null,
    items: [{ name: 'x', price: 500, quantity: 1, lineTotal: 500 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.GRAND_TOTAL_MISMATCH),
    false,
  )
})
```

- [ ] **Step 2: Run, expect failures**

Run from `functions/`: `npm test`
Expected: 5 new tests fail (or assertions inverted).

- [ ] **Step 3: Implement Check 2**

In `functions/reconcile.js`, add inside `reconcileReceipt` after Check 1 and before computing `needsReview`:

```js
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
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add functions/reconcile.js functions/__tests__/reconcile.test.js
git commit -m "feat(functions): reconcile Check 2 — whole-receipt math"
```

---

## Task 5: Reconcile Check 3 — item count vs `printedItemCount`

**Files:**
- Modify: `functions/reconcile.js`
- Modify: `functions/__tests__/reconcile.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```js
test('Check 3: flags item-count mismatch against printedItemCount', () => {
  const input = {
    grandTotal: 1000,
    items: [
      { name: 'a', price: 500, quantity: 1, lineTotal: 500 },
      { name: 'b', price: 500, quantity: 1, lineTotal: 500 },
    ],
    printedItemCount: 3, // receipt said 3 but we extracted 2
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.ok(result.reviewReasons.includes(REASON_CODES.ITEM_COUNT_MISMATCH))
  assert.equal(result.needsReview, true)
})

test('Check 3: passes when printedItemCount equals sum of quantities', () => {
  const input = {
    grandTotal: 1000,
    items: [
      { name: 'a', price: 500, quantity: 1, lineTotal: 500 },
      { name: 'b', price: 250, quantity: 2, lineTotal: 500 },
    ],
    printedItemCount: 3,
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.ITEM_COUNT_MISMATCH),
    false,
  )
})

test('Check 3: null quantity defaults to 1 when summing', () => {
  const input = {
    grandTotal: 1000,
    items: [
      { name: 'a', price: 500, quantity: null, lineTotal: 500 },
      { name: 'b', price: 500, quantity: null, lineTotal: 500 },
    ],
    printedItemCount: 2,
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.ITEM_COUNT_MISMATCH),
    false,
  )
})

test('Check 3: skipped when printedItemCount is null', () => {
  const input = {
    grandTotal: 1000,
    items: [{ name: 'a', price: 500, quantity: 1, lineTotal: 500 }],
    printedItemCount: null,
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.ITEM_COUNT_MISMATCH),
    false,
  )
})
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test` → new tests fail.

- [ ] **Step 3: Implement Check 3**

Add inside `reconcileReceipt` after Check 2:

```js
  // Check 3: item count cross-check
  if (parsedData.printedItemCount != null) {
    const totalQty = items.reduce((sum, it) => sum + (it.quantity ?? 1), 0)
    if (totalQty !== parsedData.printedItemCount) {
      reviewReasons.push(REASON_CODES.ITEM_COUNT_MISMATCH)
    }
  }
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add functions/reconcile.js functions/__tests__/reconcile.test.js
git commit -m "feat(functions): reconcile Check 3 — item count vs printedItemCount"
```

---

## Task 6: Reconcile Check 4 — unexpected currency

**Files:**
- Modify: `functions/reconcile.js`
- Modify: `functions/__tests__/reconcile.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```js
test('Check 4: flags when detected currency differs from tripCurrency', () => {
  // IDR Bali receipt on a TWD-default trip
  const input = {
    grandTotal: 11300,
    items: [{ name: 'a', price: 11300, quantity: 1, lineTotal: 11300 }],
    currency: 'IDR',
  }
  const result = reconcileReceipt(input, 'TWD')
  assert.ok(result.reviewReasons.includes(REASON_CODES.CURRENCY_UNEXPECTED))
})

test('Check 4: no flag when currencies match', () => {
  const input = {
    grandTotal: 11300,
    items: [{ name: 'a', price: 11300, quantity: 1, lineTotal: 11300 }],
    currency: 'IDR',
  }
  const result = reconcileReceipt(input, 'IDR')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.CURRENCY_UNEXPECTED),
    false,
  )
})

test('Check 4: skipped when currency is null', () => {
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 100, quantity: 1, lineTotal: 100 }],
    currency: null,
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.CURRENCY_UNEXPECTED),
    false,
  )
})
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test`.

- [ ] **Step 3: Implement Check 4**

Add inside `reconcileReceipt` after Check 3 — and update the signature to actually use `tripCurrency`:

```js
  // Check 4: currency sanity
  if (parsedData.currency && parsedData.currency !== tripCurrency) {
    reviewReasons.push(REASON_CODES.CURRENCY_UNEXPECTED)
  }
```

Also rename the parameter: `function reconcileReceipt(parsedData, tripCurrency)` (drop the underscore).

- [ ] **Step 4: Run, expect pass**

Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add functions/reconcile.js functions/__tests__/reconcile.test.js
git commit -m "feat(functions): reconcile Check 4 — currency vs tripCurrency"
```

---

## Task 7: Reconcile Check 5 — subtotal sanity

**Files:**
- Modify: `functions/reconcile.js`
- Modify: `functions/__tests__/reconcile.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```js
test('Check 5: flags when items do not sum to subtotal', () => {
  const input = {
    grandTotal: 1100,
    subtotal: 1000,
    taxAmount: 100,
    items: [
      { name: 'a', price: 300, quantity: 1, lineTotal: 300 }, // missing 700 somewhere
    ],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.ok(result.reviewReasons.includes(REASON_CODES.SUBTOTAL_MISMATCH))
})

test('Check 5: passes when items sum to subtotal', () => {
  const input = {
    grandTotal: 1100,
    subtotal: 1000,
    taxAmount: 100,
    items: [
      { name: 'a', price: 600, quantity: 1, lineTotal: 600 },
      { name: 'b', price: 400, quantity: 1, lineTotal: 400 },
    ],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.SUBTOTAL_MISMATCH),
    false,
  )
})

test('Check 5: skipped when subtotal is null', () => {
  const input = {
    grandTotal: 1100,
    subtotal: null,
    items: [{ name: 'a', price: 1100, quantity: 1, lineTotal: 1100 }],
    currency: 'JPY',
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.equal(
    result.reviewReasons.includes(REASON_CODES.SUBTOTAL_MISMATCH),
    false,
  )
})
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test`.

- [ ] **Step 3: Implement Check 5**

Add inside `reconcileReceipt` after Check 4:

```js
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
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add functions/reconcile.js functions/__tests__/reconcile.test.js
git commit -m "feat(functions): reconcile Check 5 — subtotal sanity"
```

---

## Task 8: Expand `expenseItemSchema` and `receiptSchema`

**Files:**
- Modify: `functions/receiptAnalysis.js` (lines 19–33 — schema definitions)

- [ ] **Step 1: Replace the schema block**

Replace lines 19–33 of `functions/receiptAnalysis.js` (`expenseItemSchema` + `receiptSchema` definitions) with:

```js
const SUPPORTED_CURRENCIES = [
  'JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CNY', 'KRW', 'SGD',
  'HKD', 'TWD', 'VND', 'MYR', 'THB', 'IDR', 'PHP', 'NZD', 'INR',
]

const expenseItemSchema = z.object({
  name: z.string().describe(
    'The clean human product name only. If the receipt name wraps across two physical lines (e.g. a Japanese name continuing on a second indented line before the price), concatenate both lines with a single space into one name. Do NOT include any line/serial number, product code, SKU, or barcode that appears alongside the name — those go in itemNumber.',
  ),
  itemNumber: z.string().nullable().describe(
    'Any receipt-printed identifier next to the item: line/serial number (e.g. "1", "001"), product code (e.g. "A201"), SKU, or JAN/EAN/UPC barcode (e.g. "4524541000672"). Strip leading punctuation like "#" or trailing "." Return null if no identifier is printed for this item.',
  ),
  translatedName: z.string().nullable().describe(
    'The name translated into the target output language ONLY. NEVER use a barcode, JAN/EAN/UPC code, SKU, or numeric product ID as a translation — those belong in itemNumber. If you cannot meaningfully translate (e.g. a proprietary or untranslatable product name), repeat the original name exactly. Do NOT include the original name alongside the translation.',
  ),
  quantity: z.number().nullable().describe('Count of items on this line. Default to 1 if not specified.'),
  price: z.number().describe(
    'The price per SINGLE unit. CAUTION: if the receipt shows "2 @ 10.00 = 20.00", the price is 10.00, NOT 20.00. Do not include currency symbols.',
  ),
  lineTotal: z.number().nullable().describe(
    'The line-total amount printed on the receipt for this item (the rightmost amount on the line). Should equal price * quantity. If only one amount is printed and quantity is 1, lineTotal equals price.',
  ),
})

const receiptSchema = z.object({
  grandTotal: z.number().nullable().describe('The final total amount paid including tax. Null if not printed.'),
  subtotal: z.number().nullable().describe('Pre-tax/service amount printed on the receipt (e.g. 小計, Subtotal). Null if not printed.'),
  taxAmount: z.number().nullable().describe('Sum of all tax lines on the receipt (内税, 外税, 消費税, VAT, GST, Tax). Null if not printed. Stored as a positive number.'),
  serviceCharge: z.number().nullable().describe('Service-charge line if printed (e.g. Phí dịch vụ, Service Charge, 服務費). Null if not printed.'),
  discount: z.number().nullable().describe('Total of discounts / vouchers / promotions deducted from the bill, as a POSITIVE number. Null if no discount.'),
  tip: z.number().nullable().describe('Gratuity / tip if printed. Null if not printed.'),
  printedItemCount: z.number().nullable().describe('The total-item-count printed on the receipt (e.g. 点数, 合計点数, Qty Total, Items: N). This is the receipt\'s own count — do not invent it from items.length. Null if not printed.'),
  paidAtString: z.string().nullable().describe('Date and time of purchase in YYYY-MM-DD HH:mm format. Null if not present.'),
  currency: z.enum(SUPPORTED_CURRENCIES).describe(
    'Currency code detected FROM the receipt itself (symbols ¥/$/€/Rp/₫, codes near totals, formatting). The Receipt Region Hint provided in the prompt is what we expect but NOT authoritative — override it if the receipt clearly shows a different currency. Pick the closest of the supported codes.',
  ),
  items: z.array(expenseItemSchema).describe('Real purchased items only. Do NOT include subtotals, tax lines, service charges, tips, discounts, vouchers, change due, loyalty points, free promotional items printed at 0, or store header/footer messages.'),
  description: z.string().nullable().describe('Concise 1-sentence summary in the TARGET output language only. Do not list every item. Do not provide bilingual output.'),
})
```

Also add `SUPPORTED_CURRENCIES` to the `module.exports` at the bottom of the file (just add `SUPPORTED_CURRENCIES,` next to `receiptSchema`).

- [ ] **Step 2: Sanity-check the Zod compile**

From `functions/`, run a one-shot:

```
node -e "const { receiptSchema, SUPPORTED_CURRENCIES } = require('./receiptAnalysis'); console.log('schema ok, currencies:', SUPPORTED_CURRENCIES.length)"
```

Expected: `schema ok, currencies: 18`.

- [ ] **Step 3: Run existing tests**

Run from `functions/`: `npm test`
Expected: still green (we haven't touched `reconcile` or its tests).

- [ ] **Step 4: Commit**

```bash
git add functions/receiptAnalysis.js
git commit -m "feat(functions): expand receipt schema with itemNumber, lineTotal, subtotal, tax, service, discount, tip, printedItemCount; currency as enum"
```

---

## Task 9: Rewrite the prompt + bump model to gemini-2.5-flash

**Files:**
- Modify: `functions/receiptAnalysis.js` (lines ~100–152: `generatePrompt` + `analyzeReceiptWithAI`)

- [ ] **Step 1: Rewrite `generatePrompt`**

Replace the existing `generatePrompt` function body with the following return value (keep the same signature, same arguments):

```js
function generatePrompt(receiptCurrency, outputLocale) {
  const language = languageMap[outputLocale] || 'English'
  const dateFormat = dateFormatMap[receiptCurrency] || 'DD/MM/YYYY'

  return `
Analyze the provided receipt image and extract data into the specified JSON structure.

### CONTEXT
- Receipt Region Hint: ${receiptCurrency} (informational only — NOT authoritative)
- Expected Date Format: ${dateFormat}
- Target Output Language: ${language}

### RULES

1. **MULTI-LINE ITEM NAMES**
   Receipt items often span two physical lines: the product name on line 1, then a continuation (size, weight, pack count, flavor) on line 2 followed by the price. Treat both lines as ONE item; concatenate them with a single space into 'name'. The 'price', 'quantity', and 'lineTotal' come from the LAST line of the group.
   Example: \`青のり入川えびせ\\n  んべい  2  1100  2200\` → name '青のり入川えびせんべい', qty 2, price 1100, lineTotal 2200.

2. **ITEM IDENTIFIERS → 'itemNumber'**
   If the receipt prints any identifier next to an item — line/serial number ('1.', '001'), product code, SKU, or full barcode (JAN/EAN/UPC, e.g. '4524541000672') — extract it into 'itemNumber' and EXCLUDE it from 'name'. 'name' should contain only the human product name. If no identifier is printed, 'itemNumber' is null.
   Examples:
   - '1. ペプシコーラ' → itemNumber '1', name 'ペプシコーラ'
   - '#A201 Pasta' → itemNumber 'A201', name 'Pasta'
   - '4524541000672 青のり入川えびせんべい' → itemNumber '4524541000672', name '青のり入川えびせんべい'

3. **PRICING LOGIC — UNIT PRICE vs LINE TOTAL**
   - 'price' is the UNIT price (price for ONE item).
   - 'lineTotal' is the line-total amount printed (rightmost amount on the line).
   - Check: price * quantity should equal lineTotal.
   - If qty 1 and only one amount is printed, lineTotal === price.

4. **NON-ITEM LINES — DO NOT PUT IN items[]**
   Do NOT include in items[]: subtotal/小計, tax/税/VAT/GST/消費税, service charge/Phí dịch vụ/服務費, tip/gratuity, discount/voucher/promotion, change due, points/loyalty, store header/footer messages, free promotional items printed at 0. Tax → 'taxAmount'. Service → 'serviceCharge'. Discount/voucher → 'discount' (positive number). Tip → 'tip'. Subtotal → 'subtotal'. Everything else: omit.

5. **printedItemCount**
   If the receipt prints a total item count line (点数, 合計点数, Qty Total, Items: N), extract it as printedItemCount. Otherwise null. Do NOT invent this from items.length.

6. **CURRENCY — DETECT FROM RECEIPT**
   Determine 'currency' from the receipt itself (symbols ¥/$/€/Rp/₫, codes near totals, locale formatting). The Receipt Region Hint above is what we expect but NOT authoritative — override it if the receipt clearly shows a different currency.

7. **TRANSLATION**
   For 'description' and 'translatedName', return text strictly in ${language}. NEVER use a barcode, JAN/EAN/UPC, SKU, or numeric product ID as a translation — those go in itemNumber. If you cannot produce a meaningful translation, repeat the original name exactly. Do not output bilingual "Original (Translation)" pairs.

8. **DATES**
   Parse ambiguous dates (e.g. 05/04/2024) using the regional format: ${dateFormat}. Output in YYYY-MM-DD HH:mm. Null if invalid or absent.

9. **DESCRIPTION**
   One short sentence in ${language} summarizing the receipt (e.g. "7-Eleven, snacks and drinks"). Do not list every item.

### EXAMPLE (illustrative — adapt to the actual receipt)

Imagine a Japanese supermarket receipt printing:
\`\`\`
お会計レシート
1. ペプシコーラ        150
2. 青のり入川えびせ
     んべい      2   1100   2200
小計         2350
消費税(10%)   235
合計         2585
点数: 3
\`\`\`

Expected JSON:
\`\`\`
{
  "grandTotal": 2585,
  "subtotal": 2350,
  "taxAmount": 235,
  "serviceCharge": null,
  "discount": null,
  "tip": null,
  "printedItemCount": 3,
  "paidAtString": null,
  "currency": "JPY",
  "items": [
    { "itemNumber": "1", "name": "ペプシコーラ", "translatedName": "...", "quantity": 1, "price": 150, "lineTotal": 150 },
    { "itemNumber": "2", "name": "青のり入川えびせんべい", "translatedName": "...", "quantity": 2, "price": 1100, "lineTotal": 2200 }
  ],
  "description": "..."
}
\`\`\`

Analyze the receipt now.
`
}
```

- [ ] **Step 2: Bump model + enable thinking**

In the same file, replace the `ai.models.generateContent({...})` call inside `analyzeReceiptWithAI` with:

```js
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { text: generatePrompt(tripCurrency, defaultCurrency) },
      imagePart,
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: zodToJsonSchema(receiptSchema),
      thinkingConfig: { thinkingBudget: -1 },
    },
  })
```

- [ ] **Step 3: Replace `sanitizeItemPrices` integration with `reconcileReceipt`**

Same file. At the top, add the require:

```js
const { reconcileReceipt } = require('./reconcile')
```

Then change the tail of `analyzeReceiptWithAI` from:

```js
  const parsedData = JSON.parse(result.text)

  // Apply price sanitization to catch AI extraction mistakes
  return sanitizeItemPrices(parsedData)
```

to:

```js
  const parsedData = JSON.parse(result.text)

  // Run server-side reconciliation: math checks, auto-correct unit-price slot,
  // accumulate reviewReasons + needsReview.
  return reconcileReceipt(parsedData, tripCurrency)
```

Update `analyzeReceiptWithAI`'s JSDoc to reflect the new return shape (`{...parsedData, needsReview, reviewReasons}`).

You can leave `sanitizeItemPrices` exported for now (any external callers — none expected — keep working), but it's no longer called.

- [ ] **Step 4: Run tests + Zod smoke**

From `functions/`:

```
npm test
node -e "const { receiptSchema } = require('./receiptAnalysis'); const { zodToJsonSchema } = require('zod-to-json-schema'); console.log(JSON.stringify(zodToJsonSchema(receiptSchema)).length, 'bytes')"
```

Expected: all tests pass; schema serializes (size in the low thousands).

- [ ] **Step 5: Commit**

```bash
git add functions/receiptAnalysis.js
git commit -m "feat(functions): rewrite Gemini prompt, bump to 2.5-flash with thinking, route through reconcile"
```

---

## Task 10: Persist `needsReview`, `reviewReasons`, and new receipt fields to Firestore

**Files:**
- Modify: `functions/receiptAnalysis.js` (`prepareFirestoreUpdateData`, around line 272)

- [ ] **Step 1: Update `prepareFirestoreUpdateData`**

Replace the function with:

```js
function prepareFirestoreUpdateData(parsedDataFromAI, tripCurrency, receiptImageUrl = null) {
  const paidAtTimestamp = convertToTimestamp(parsedDataFromAI.paidAtString, tripCurrency)

  // Strip transient fields that should not be written verbatim.
  const { paidAtString, ...restOfData } = parsedDataFromAI

  const firestoreUpdateData = {
    ...restOfData,
    isProcessing: false,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingError: null,
  }

  // needsReview + reviewReasons are produced by reconcileReceipt and travel
  // through restOfData unchanged. Guarantee they're present even on empty paths.
  if (firestoreUpdateData.needsReview == null) firestoreUpdateData.needsReview = false
  if (!Array.isArray(firestoreUpdateData.reviewReasons)) firestoreUpdateData.reviewReasons = []

  if (receiptImageUrl !== null) {
    firestoreUpdateData.receiptImageUrl = receiptImageUrl
  }

  if (paidAtTimestamp !== null) {
    firestoreUpdateData.paidAt = paidAtTimestamp
  }
  else {
    logger.warn('paidAtTimestamp is null, \'paidAt\' field will not be set.')
  }

  return firestoreUpdateData
}
```

The new schema fields (`subtotal`, `taxAmount`, etc.) flow through automatically via `...restOfData`.

- [ ] **Step 2: Confirm tests still pass**

Run from `functions/`: `npm test`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add functions/receiptAnalysis.js
git commit -m "feat(functions): persist needsReview, reviewReasons and new receipt fields"
```

---

## Task 11: Extend frontend types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Extend `ExpenseDetailItem`**

In `types/index.ts`, replace:

```ts
export interface ExpenseDetailItem {
  name: string
  price: number
  quantity?: number
  translatedName?: string
  sharedByMemberIds?: string[]
}
```

with:

```ts
export interface ExpenseDetailItem {
  name: string
  price: number
  quantity?: number
  translatedName?: string
  sharedByMemberIds?: string[]
  itemNumber?: string | null
  lineTotal?: number | null
}
```

- [ ] **Step 2: Extend `NewExpense`**

Add these optional fields inside the `NewExpense` interface (just before the closing brace):

```ts
  subtotal?: number | null
  taxAmount?: number | null
  serviceCharge?: number | null
  discount?: number | null
  tip?: number | null
  printedItemCount?: number | null
  needsReview?: boolean
  reviewReasons?: string[]
```

(These are inherited by `Expense`.)

- [ ] **Step 3: Sanity-check types**

Open `types/index.ts` in your IDE and confirm no red squiggles on the changed sections. If you want a CI-style check, run `pnpm build` from the repo root — Nuxt's build step type-checks. Slow (~30s) but authoritative.

Expected: no new TypeScript errors on `ExpenseDetailItem` or `NewExpense` / `Expense`.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "types: add itemNumber, lineTotal, and receipt review fields"
```

---

## Task 12: `expenseConverter` reads the new fields

**Files:**
- Modify: `utils/converter.ts`

- [ ] **Step 1: Extend the converter**

In `utils/converter.ts`, inside `expenseConverter.fromFirestore` (which returns an object spread), add the new fields just before the closing `} as Expense`:

```ts
      subtotal: data.subtotal ?? null,
      taxAmount: data.taxAmount ?? null,
      serviceCharge: data.serviceCharge ?? null,
      discount: data.discount ?? null,
      tip: data.tip ?? null,
      printedItemCount: data.printedItemCount ?? null,
      needsReview: data.needsReview ?? false,
      reviewReasons: data.reviewReasons ?? [],
```

The items array is already returned as `data.items || []` — `itemNumber` and `lineTotal` ride through as optional fields without converter changes.

- [ ] **Step 2: Sanity-check types**

Open `utils/converter.ts` in your IDE; no red squiggles. Or `pnpm build` for an authoritative check.

- [ ] **Step 3: Commit**

```bash
git add utils/converter.ts
git commit -m "feat(converter): read new receipt review and totals fields"
```

---

## Task 13: Render `itemNumber` in `ExpenseDetailItem.vue`

**Files:**
- Modify: `components/ExpenseDetailItem.vue`

- [ ] **Step 1: Add the itemNumber span**

In the template, replace the existing block (around line 94):

```vue
<div class="flex items-center gap-1.5">
  <span class="font-medium text-sm text-foreground">{{ item.name }}</span>
  <a
    v-if="googleSearchUrl"
    ...
```

with:

```vue
<div class="flex items-center gap-1.5 flex-wrap">
  <span
    v-if="item.itemNumber"
    class="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
  >
    {{ item.itemNumber }}
  </span>
  <span class="font-medium text-sm text-foreground">{{ item.name }}</span>
  <a
    v-if="googleSearchUrl"
    ...
```

(Leave the `<a>` tag and everything after it untouched.)

- [ ] **Step 2: Eyeball-test in the dev server**

Run from repo root: `pnpm dev`
Open any trip / expense that has parsed items. Confirm:
- Items without `itemNumber` render unchanged.
- Items with `itemNumber` show it as a small monospaced chip before the name.

(No old expense has `itemNumber` yet — to test before any reprocess, manually edit one expense doc in the Firestore console to add an `itemNumber` to one item.)

- [ ] **Step 3: Commit**

```bash
git add components/ExpenseDetailItem.vue
git commit -m "feat(ui): render itemNumber as a muted prefix chip"
```

---

## Task 14: `ExpenseReviewBanner.vue` component

**Files:**
- Create: `components/ExpenseReviewBanner.vue`

- [ ] **Step 1: Create the banner component**

Create `components/ExpenseReviewBanner.vue`:

```vue
<script setup lang="ts">
interface Props {
  reasons: string[]
}

const props = defineProps<Props>()

const WARNING_CODES = new Set([
  'grand_total_mismatch',
  'item_count_mismatch',
  'subtotal_mismatch',
  'item_line_total_mismatch',
  'currency_unexpected',
])

const MESSAGES: Record<string, string> = {
  grand_total_mismatch: '項目金額加總與收據總計不符，請檢查',
  item_count_mismatch: '項目數量與收據上的點數不一致',
  subtotal_mismatch: '項目加總與小計不符',
  item_line_total_mismatch: '部分項目的單價 × 數量與該行金額不符',
  currency_unexpected: '偵測到的貨幣與此次行程貨幣不同',
}

const warnings = computed(() =>
  Array.from(new Set(props.reasons.filter(r => WARNING_CODES.has(r))))
    .map(r => MESSAGES[r])
    .filter(Boolean),
)
</script>

<template>
  <div
    v-if="warnings.length > 0"
    class="border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 rounded-lg p-3 flex gap-3"
  >
    <Icon name="lucide:triangle-alert" class="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" :size="18" />
    <div class="flex-1 space-y-1">
      <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
        AI 辨識結果需要您檢查
      </p>
      <ul class="text-xs text-amber-800 dark:text-amber-200 space-y-0.5 list-disc list-inside">
        <li v-for="w in warnings" :key="w">
          {{ w }}
        </li>
      </ul>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Smoke render**

Add a `<ExpenseReviewBanner :reasons="['grand_total_mismatch','currency_unexpected']" />` line temporarily into `pages/trips/[tripId]/expenses/[expenseId]/index.vue` and confirm in `pnpm dev` that the banner appears with both messages.

Remove the temporary tag after verifying.

- [ ] **Step 3: Commit**

```bash
git add components/ExpenseReviewBanner.vue
git commit -m "feat(ui): add ExpenseReviewBanner for receipt extraction warnings"
```

---

## Task 15: Mount the banner on expense detail + edit pages

**Files:**
- Modify: `pages/trips/[tripId]/expenses/[expenseId]/index.vue`
- Modify: `pages/trips/[tripId]/expenses/[expenseId]/edit.vue`

- [ ] **Step 1: Mount in `index.vue`**

Open `pages/trips/[tripId]/expenses/[expenseId]/index.vue`. Locate the items-list section (search for `<ExpenseDetailItem` or the items wrapper `<div>`). Immediately ABOVE that section, add:

```vue
<ExpenseReviewBanner
  v-if="expense?.needsReview && expense?.reviewReasons?.length"
  :reasons="expense.reviewReasons"
  class="mb-4"
/>
```

Use whatever the local variable name for the loaded expense is (`expense`, `expenseData`, etc.) — match the surrounding code.

- [ ] **Step 2: Mount in `edit.vue`**

Same change in `pages/trips/[tripId]/expenses/[expenseId]/edit.vue` — above the items section.

- [ ] **Step 3: Eyeball-test**

In `pnpm dev`, open an expense and (via Firestore console or the regression script in Task 16) set `needsReview: true` and `reviewReasons: ['grand_total_mismatch']` on the doc. Confirm the banner shows on both pages and disappears when the fields are cleared.

- [ ] **Step 4: Commit**

```bash
git add pages/trips/[tripId]/expenses/[expenseId]/index.vue pages/trips/[tripId]/expenses/[expenseId]/edit.vue
git commit -m "feat(ui): mount ExpenseReviewBanner on expense detail and edit pages"
```

---

## Task 16: Regression script — diff new pipeline against current Firestore items

**Files:**
- Create: `functions/regression-receipts.js`

This is a dev tool, not deployed code. It downloads each receipt image already in Storage and re-runs the new pipeline locally, printing a diff so we can eyeball whether the rewrite improved things on the same 20-receipt sample.

- [ ] **Step 1: Create the script**

Create `functions/regression-receipts.js`:

```js
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
```

- [ ] **Step 2: Run it against the same 20 receipts** (requires user permission to read prod)

Run from `functions/`: `node regression-receipts.js 20`

Note: this hits prod Firestore + Storage and the Gemini API. Confirm with the user before running and ensure `GOOGLE_GENAI_API_KEY` is set in `functions/.env`.

Expected eyeball checks:
- The 餅屋 receipt's truncated names (`おひなたみかん 12`, `すっきりみかんゼ`, …) are now FULL.
- The Apurva Kempinski receipt has `needsReview: true` with `grand_total_mismatch`.
- The IDR-on-TWD-trip receipts have `currency: "IDR"` (not `"TWD"`) and `needsReview: true` with `currency_unexpected`.
- Service-charge / tax / voucher lines are NOT in `items[]` for the Vietnam/Bali/Indomaret receipts; they live in their dedicated fields.
- Items with leading numbers (e.g. `1. ペプシコーラ`) now have populated `itemNumber` and clean `name`.

- [ ] **Step 3: Commit**

```bash
git add functions/regression-receipts.js
git commit -m "chore(functions): add regression-receipts dev script for pipeline diff"
```

---

## Task 17: Cleanup — remove dead `sanitizeItemPrices` and update exports

**Files:**
- Modify: `functions/receiptAnalysis.js`

After Task 9 we left `sanitizeItemPrices` in the file but unused. Remove it.

- [ ] **Step 1: Delete the function**

Delete the `sanitizeItemPrices` function definition (the entire `/** Sanitize item prices... */` block + function body).

- [ ] **Step 2: Remove from `module.exports`**

In the `module.exports` block at the bottom, delete the `sanitizeItemPrices,` line.

- [ ] **Step 3: Grep for stragglers**

Run from repo root via Grep tool: search for `sanitizeItemPrices` across the repo. Expected: zero matches.

- [ ] **Step 4: Run tests**

From `functions/`: `npm test` → green.
Frontend types: open `receiptAnalysis.js` in IDE — no broken imports. Optional: `pnpm build` from repo root.

- [ ] **Step 5: Commit**

```bash
git add functions/receiptAnalysis.js
git commit -m "chore(functions): remove unused sanitizeItemPrices (superseded by reconcileReceipt)"
```

---

## Task 18: Final integration check + deploy notes

- [ ] **Step 1: Read the diff for the whole branch**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

Expected: ~15 commits, touching ~10 files.

- [ ] **Step 2: Run all unit tests**

From `functions/`: `npm test` → all green.
From repo root: `pnpm test` → all existing tests green (none of them should be affected; they cover `discount.ts` / `tax.ts`).

- [ ] **Step 3: Run the regression script one more time and save the output**

```bash
cd functions
node regression-receipts.js 20 > /tmp/regression-after.log 2>&1
```

Skim `/tmp/regression-after.log` and confirm the spec's success criteria (Task 16 step 2) hold.

- [ ] **Step 4: Note deploy steps for the user**

Don't deploy automatically. Tell the user:
- Cloud Functions deploy: `cd functions && pnpm deploy` (or `firebase deploy --only functions`).
- Frontend: standard Nuxt deploy pipeline.
- New env: none required — `GOOGLE_GENAI_API_KEY` already set; `gemini-2.5-flash` available on the same key.
- Rollback: revert this branch and redeploy. Old expense docs read fine through the new converter (new fields default to null/false/[]).

- [ ] **Step 5: Final commit (only if changes were made in Step 1–4)**

If steps above produced any code changes (unlikely — they're all verification), commit them under: `git commit -m "chore: final integration verification"`. Otherwise skip.

---

## Out of Scope

(From spec; deferred to follow-ups)
- Per-item highlighting on the edit page for the specific item that failed `item_line_total_mismatch`.
- Second-pass verification (OCR → parse pipeline) if 2.5-flash + reconciliation is still insufficient.
- Merging duplicate-item lines in the UI (the "three identical 青のり入" cases).
- Backfilling `itemNumber` / `lineTotal` / etc. on legacy expense docs — they remain `null`/absent and render fine.
