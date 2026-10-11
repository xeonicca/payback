# Multi-Image Receipt Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user photograph one long receipt as up to 5 pages and have Gemini read them as a single continuous bill into one expense.

**Architecture:** The client creates the expense with `imageCount: N`, then uploads `page-1.jpg` … `page-N.jpg`. The storage trigger fires once per file; a Firestore transaction appends each resized path to `imageUrls` and elects exactly one invocation — the one that completes the set — to make a single Gemini call with all pages, labeled and accompanied by seam rules so the model knows where each photo was cut off.

**Tech Stack:** Nuxt 4 / Vue 3 (`<script setup>`, kebab-case components), Firebase Storage + Firestore, Cloud Functions v2 (CommonJS, `node --test`), `@google/genai` (gemini-2.5-flash), zod, vitest (unit + Firestore emulator), Tailwind v4 + shadcn-vue.

**Spec:** `docs/superpowers/specs/2026-10-11-multi-image-receipt-upload-design.md`

---

## Background for someone new to this codebase

Read this before Task 1; it will save you an hour of confusion.

**How a receipt becomes an expense today.** `components/AddExpenseDrawer.vue` creates a Firestore expense doc with `isProcessing: true`, then uploads one image to `trips/{tripId}/expenses/{expenseId}/{originalFileName}`. A **Firebase "Resize Images" extension** (configured in the Firebase console — *not* in this repo) writes a downscaled copy to `trips/{tripId}/expenses/{expenseId}/resized/...`. That resized write fires `functions/onReceiptUploaded.js`, which calls Gemini and updates the expense doc with items/totals and `isProcessing: false`.

**The problem this plan solves.** `onObjectFinalized` fires **once per file**. Upload 3 pages and you get 3 concurrent invocations, each doing its own Gemini call and each overwriting the expense with its own partial reading.

**Paths stored in Firestore are storage paths, not URLs**, despite the `imageUrls` / `receiptImageUrl` names. The client turns them into displayable URLs with `getDownloadURL(storageRef(storage, path))`.

**The Resize Images extension's actual configuration**, measured against the production bucket on 2026-10-11 (279 expense folders inspected, every one identical). Nothing in this repo records it, and the gate's correctness depends on it, so it is written down here:

| Observed | Value |
|---|---|
| Resized objects per original | Exactly **1** |
| Output name | `{original basename}_{size}.{ext}` — e.g. `image_800x800.jpg` |
| Size | `800x800` (bounding box) |
| Original file | **Deleted** after a successful resize |

Consequences for this plan:
- Uploading `page-2.jpg` produces `resized/page-2_800x800.jpg`, so `pageIndexOf` reads the page number off the basename as intended.
- Every existing receipt is named `image_800x800.jpg` because mobile camera capture names its file `image.jpg`. Legacy paths therefore carry no page number — which is exactly the `Number.MAX_SAFE_INTEGER` fallback case, and why unnumbered paths must dedupe by exact path rather than by page number.
- One output per original means counting array entries would have worked today. The gate counts distinct page numbers anyway, so a console change to `IMG_SIZES` or `IMAGE_TYPE` cannot later cause a half-parsed receipt.
- 800x800 is a tight bound for a long receipt in one frame. Each page of a multi-page capture is a closer photo, so per-line resolution improves relative to a single zoomed-out shot — a quality argument in this feature's favour, not just a completeness one.

**Commands** (run from the repo root unless stated):

| What | Command |
|---|---|
| Cloud Functions tests | `cd functions; node --test` |
| Frontend unit tests | `pnpm vitest run` |
| Firestore emulator tests | `pnpm test:emulator` |
| Lint (one file) | `npx eslint <path>` |
| Dev server | `pnpm dev` |

**Do not run `npx eslint .` and expect it to pass.** Although `CLAUDE.md` documents it, the project has ~10,100 pre-existing lint problems across 163 files (much of it in `docs/`, `.agents/` and generated output). **Lint only the files your task touches**, and compare against a baseline if that file already had problems.

Measured baseline for the files this plan touches — all clean **except** one:

| File | Pre-existing problems |
|---|---|
| `functions/receiptAnalysis.js`, `onReceiptUploaded.js`, `reanalyzeReceipt.js` | 0 |
| `functions/reconcile.js` + its test | 2 (`antfu/if-newline`, `perfectionist/sort-imports`) |
| `functions/regression-receipts.js` | **15** |
| `types/index.ts`, `utils/converter.ts` | 0 |
| `components/AddExpenseDrawer.vue`, `ReceiptViewer.vue`, `ExpenseReviewBanner.vue` | 0 |
| `pages/trips/[tripId]/expenses/[expenseId]/index.vue` | 0 |

Leave pre-existing problems alone — fixing them is unrelated scope that would bloat the diff. Just don't add new ones.

**`pnpm dev` talks to the real Firebase project** (no emulator, see `memory/reference_dev_targets_production.md`). Any manual verification creates real trips and expenses and spends real Gemini calls. Use a throwaway trip.

**Conventions that are enforced:** components are kebab-case in templates (`<ui-button>`, never `<UiButton>`) — ESLint fails otherwise. UI strings are Traditional Chinese. `functions/` is CommonJS (`require`/`module.exports`); the Nuxt app is ESM TypeScript.

**Commit directly to `main`** and stage only the files each task names (see `memory/feedback_commit_to_main.md`). End every commit message with the two attribution lines shown in the commit steps.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `functions/receiptPages.js` | Page bookkeeping for the server: parse a page index out of a path, sort paths into page order, and run the transaction that elects one analyzer. |
| `functions/__tests__/receiptPages.test.js` | Unit tests for the two pure functions above. |
| `tests/emulator/receipt-page-gate.test.ts` | Emulator tests for the transaction gate (concurrency, duplicates, incomplete sets). |
| `utils/receiptPages.ts` | Page bookkeeping for the client: append-with-dedupe-and-cap, and `page-N.ext` naming. |
| `__tests__/receiptPages.test.ts` | Unit tests for the above. |
| `utils/retry.ts` | Generic "try N times, report ok/failed" helper with an injectable sleep so it is testable. |
| `__tests__/retry.test.ts` | Unit tests for the above. |
| `components/ReceiptPagePicker.vue` | The incremental page picker UI. Extracted because `AddExpenseDrawer` renders the receipt tab twice (desktop + mobile) and this control is ~40 lines of markup. |

### Modified files

| File | Change |
|---|---|
| `types/index.ts` | `NewExpense` gains `imageCount?: number`. |
| `utils/converter.ts` | `expenseConverter` maps `imageCount`. |
| `functions/reconcile.js` | New `PAGE_BREAK_UNCERTAIN` reason code + Check 6. |
| `functions/receiptAnalysis.js` | `analyzeReceiptWithAI` takes an array of images; `generatePrompt` takes a page count and emits seam rules; `receiptSchema` gains `pageBreakUncertain`; `prepareFirestoreUpdateData` strips it. |
| `functions/onReceiptUploaded.js` | Uses the transaction gate; analyzes all pages in one call. |
| `functions/reanalyzeReceipt.js` | Re-analyzes every page, with a fallback for pre-feature expenses. |
| `functions/regression-receipts.js` | Updated to the new `analyzeReceiptWithAI` signature. |
| `components/AddExpenseDrawer.vue` | `selectedFiles: File[]`, the new picker in both breakpoints, `imageCount` on create, `page-N` upload names, retry-then-fail. |
| `components/ReceiptViewer.vue` | Takes `srcs: string[]` + `startIndex`; prev/next buttons, page indicator, arrow keys. |
| `pages/trips/[tripId]/expenses/[expenseId]/index.vue` | Resolves every page to a URL, stacks them, opens the viewer at the tapped page. |
| `components/ExpenseReviewBanner.vue` | Message for `page_break_uncertain`. |

### Dependency order

Tasks 1–4 are server-side and independent of 5–8 (client-side). Task 9 (wiring the drawer) needs Tasks 7+8. Task 11 (detail page) needs Task 10. Do them in the order written.

---

## Task 1: Server-side page bookkeeping

**Files:**
- Create: `functions/receiptPages.js`
- Test: `functions/__tests__/receiptPages.test.js`

The page index is parsed from the **basename only**. Firestore auto-IDs contain no hyphens, so matching against the full path would be safe today, but a human-supplied trip ID could contain `page-9` and silently reorder someone's receipt.

- [ ] **Step 1: Write the failing test**

Create `functions/__tests__/receiptPages.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pageIndexOf, sortPagePaths } = require('../receiptPages')

const resized = (name) => `trips/t1/expenses/e1/resized/${name}`

test('pageIndexOf reads the page number out of a resized filename', () => {
  assert.equal(pageIndexOf(resized('page-1_1600x1600.jpeg')), 1)
  assert.equal(pageIndexOf(resized('page-12.jpg')), 12)
})

test('pageIndexOf ignores page-like text outside the basename', () => {
  assert.equal(pageIndexOf('trips/my-page-7-trip/expenses/e1/resized/page-2.jpg'), 2)
})

test('pageIndexOf returns a sort-last value for an unnumbered legacy filename', () => {
  assert.equal(pageIndexOf(resized('IMG_4021.jpg')), Number.MAX_SAFE_INTEGER)
})

test('sortPagePaths orders by page number, not arrival order', () => {
  const arrived = [resized('page-3.jpg'), resized('page-1.jpg'), resized('page-2.jpg')]
  assert.deepEqual(sortPagePaths(arrived), [
    resized('page-1.jpg'),
    resized('page-2.jpg'),
    resized('page-3.jpg'),
  ])
})

test('sortPagePaths sorts 10 after 9 (numeric, not lexicographic)', () => {
  const arrived = [resized('page-10.jpg'), resized('page-9.jpg')]
  assert.deepEqual(sortPagePaths(arrived), [resized('page-9.jpg'), resized('page-10.jpg')])
})

test('sortPagePaths puts unnumbered paths last and is stable among them', () => {
  const arrived = [resized('b.jpg'), resized('page-1.jpg'), resized('a.jpg')]
  assert.deepEqual(sortPagePaths(arrived), [
    resized('page-1.jpg'),
    resized('a.jpg'),
    resized('b.jpg'),
  ])
})

test('sortPagePaths does not mutate its input', () => {
  const arrived = [resized('page-2.jpg'), resized('page-1.jpg')]
  sortPagePaths(arrived)
  assert.deepEqual(arrived, [resized('page-2.jpg'), resized('page-1.jpg')])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions; node --test --test-name-pattern="pageIndexOf|sortPagePaths"`

Expected: FAIL — `Cannot find module '../receiptPages'`.

- [ ] **Step 3: Write the implementation**

Create `functions/receiptPages.js`:

```js
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
 * @returns {string[]}
 */
function sortPagePaths(paths) {
  return [...paths].sort((a, b) => {
    const diff = pageIndexOf(a) - pageIndexOf(b)
    return diff !== 0 ? diff : a.localeCompare(b)
  })
}

module.exports = { pageIndexOf, sortPagePaths, PAGE_INDEX_REGEX }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd functions; node --test --test-name-pattern="pageIndexOf|sortPagePaths"`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add functions/receiptPages.js functions/__tests__/receiptPages.test.js
git commit -m "feat(receipts): add page-path ordering helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 2: The analysis gate (transaction)

**Files:**
- Modify: `functions/receiptPages.js`
- Test: `tests/emulator/receipt-page-gate.test.ts`

This is the heart of the feature. `claimPageForAnalysis` is called once per storage trigger invocation and returns one of four statuses. Exactly one caller per expense ever gets `'analyze'`.

It takes a `DocumentReference` and uses `expenseRef.firestore.runTransaction`, so it never imports `firebase-admin` itself — that is what lets the emulator test drive it with a test admin app.

`imageUrls` is **written back sorted**, so clients reading the field get page order for free and never have to sort.

- [ ] **Step 1: Write the failing test**

Create `tests/emulator/receipt-page-gate.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
// functions/ is CommonJS; import the namespace and read properties off it.
import receiptPages from '../../functions/receiptPages.js'
import { clearFirestore, getAdminDb } from './helpers'

const { claimPageForAnalysis } = receiptPages as {
  claimPageForAnalysis: (ref: any, path: string) => Promise<{ status: string, paths: string[] }>
}

const EXPENSE_PATH = 'trips/t1/expenses/e1'
const page = (n: number) => `trips/t1/expenses/e1/resized/page-${n}_1600x1600.jpeg`

function expenseRef() {
  return getAdminDb().doc(EXPENSE_PATH)
}

async function seedExpense(fields: Record<string, unknown>) {
  await expenseRef().set({ description: 'Receipt Uploaded, processing', isProcessing: true, ...fields })
}

beforeEach(async () => {
  await clearFirestore()
})

describe('claimPageForAnalysis', () => {
  it('elects the single page of a one-page upload immediately', async () => {
    await seedExpense({ imageCount: 1 })
    const result = await claimPageForAnalysis(expenseRef(), page(1))
    expect(result.status).toBe('analyze')
    expect(result.paths).toEqual([page(1)])
  })

  it('treats a missing imageCount as a one-page upload', async () => {
    await seedExpense({})
    const result = await claimPageForAnalysis(expenseRef(), page(1))
    expect(result.status).toBe('analyze')
  })

  it('waits while the set is incomplete and elects exactly one analyzer', async () => {
    await seedExpense({ imageCount: 3 })

    const first = await claimPageForAnalysis(expenseRef(), page(1))
    expect(first.status).toBe('waiting')

    const second = await claimPageForAnalysis(expenseRef(), page(2))
    expect(second.status).toBe('waiting')

    const third = await claimPageForAnalysis(expenseRef(), page(3))
    expect(third.status).toBe('analyze')
    expect(third.paths).toEqual([page(1), page(2), page(3)])
  })

  it('returns pages in receipt order even when they arrive backwards', async () => {
    await seedExpense({ imageCount: 3 })
    await claimPageForAnalysis(expenseRef(), page(3))
    await claimPageForAnalysis(expenseRef(), page(2))
    const last = await claimPageForAnalysis(expenseRef(), page(1))
    expect(last.status).toBe('analyze')
    expect(last.paths).toEqual([page(1), page(2), page(3)])
  })

  it('persists imageUrls sorted so clients need no sorting', async () => {
    await seedExpense({ imageCount: 2 })
    await claimPageForAnalysis(expenseRef(), page(2))
    await claimPageForAnalysis(expenseRef(), page(1))
    const snap = await expenseRef().get()
    expect(snap.data()?.imageUrls).toEqual([page(1), page(2)])
  })

  it('ignores a re-fired duplicate path without counting it twice', async () => {
    await seedExpense({ imageCount: 2 })
    await claimPageForAnalysis(expenseRef(), page(1))

    const duplicate = await claimPageForAnalysis(expenseRef(), page(1))
    expect(duplicate.status).toBe('duplicate')

    const snap = await expenseRef().get()
    expect(snap.data()?.imageUrls).toEqual([page(1)])

    const second = await claimPageForAnalysis(expenseRef(), page(2))
    expect(second.status).toBe('analyze')
  })

  it('elects exactly one analyzer when all pages land concurrently', async () => {
    await seedExpense({ imageCount: 3 })
    const results = await Promise.all([
      claimPageForAnalysis(expenseRef(), page(1)),
      claimPageForAnalysis(expenseRef(), page(2)),
      claimPageForAnalysis(expenseRef(), page(3)),
    ])
    expect(results.filter(r => r.status === 'analyze')).toHaveLength(1)
    expect(results.filter(r => r.status === 'waiting')).toHaveLength(2)
  })

  it('reports a missing expense instead of throwing', async () => {
    const result = await claimPageForAnalysis(getAdminDb().doc('trips/t1/expenses/gone'), page(1))
    expect(result.status).toBe('missing')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:emulator`

Expected: FAIL — `claimPageForAnalysis is not a function`.

If instead the whole file fails to import, the CommonJS interop needs the namespace form already used above (`import receiptPages from '...'` then destructure); do not switch to a named import.

- [ ] **Step 3: Write the implementation**

Append to `functions/receiptPages.js`, before `module.exports`:

```js
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
```

Update the exports line:

```js
module.exports = { pageIndexOf, sortPagePaths, claimPageForAnalysis, PAGE_INDEX_REGEX }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:emulator`

Expected: PASS — 8 new tests in `receipt-page-gate.test.ts`, and the pre-existing emulator suites still green.

- [ ] **Step 5: Commit**

```bash
git add functions/receiptPages.js tests/emulator/receipt-page-gate.test.ts
git commit -m "feat(receipts): elect one analyzer per multi-page upload

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 3: `page_break_uncertain` review reason

**Files:**
- Modify: `functions/reconcile.js:1-16` (reason codes) and the end of `reconcileReceipt`
- Test: `functions/__tests__/reconcile.test.js`

The AI sets `pageBreakUncertain: true` when it could not reconstruct a line that was cut at an image boundary. `reconcileReceipt` turns that into a review reason so the existing banner surfaces it.

- [ ] **Step 1: Write the failing test**

Append to `functions/__tests__/reconcile.test.js`:

```js
test('Check 6: flags an unresolved line at a multi-image page boundary', () => {
  const input = {
    grandTotal: 100,
    items: [{ name: 'a', price: 100, quantity: 1, lineTotal: 100 }],
    currency: 'JPY',
    pageBreakUncertain: true,
  }
  const result = reconcileReceipt(input, 'JPY')
  assert.ok(result.reviewReasons.includes(REASON_CODES.PAGE_BREAK_UNCERTAIN))
  assert.equal(result.needsReview, true, 'an unreadable seam needs human review')
})

test('Check 6: a cleanly resolved or single-image receipt is not flagged', () => {
  const clean = { grandTotal: 100, items: [], currency: 'JPY', pageBreakUncertain: false }
  assert.equal(reconcileReceipt(clean, 'JPY').reviewReasons.includes(REASON_CODES.PAGE_BREAK_UNCERTAIN), false)

  const absent = { grandTotal: 100, items: [], currency: 'JPY' }
  assert.equal(reconcileReceipt(absent, 'JPY').reviewReasons.includes(REASON_CODES.PAGE_BREAK_UNCERTAIN), false)

  const nulled = { grandTotal: 100, items: [], currency: 'JPY', pageBreakUncertain: null }
  assert.equal(reconcileReceipt(nulled, 'JPY').reviewReasons.includes(REASON_CODES.PAGE_BREAK_UNCERTAIN), false)
})
```

Also extend the existing first test in that file (`exports a function and reason-code constants`) with one more assertion:

```js
  assert.ok(REASON_CODES.PAGE_BREAK_UNCERTAIN)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions; node --test --test-name-pattern="Check 6"`

Expected: FAIL — `result.reviewReasons.includes(undefined)` is false, so the first assertion fails.

- [ ] **Step 3: Write the implementation**

In `functions/reconcile.js`, add the code to `REASON_CODES`:

```js
const REASON_CODES = Object.freeze({
  GRAND_TOTAL_MISMATCH: 'grand_total_mismatch',
  ITEM_COUNT_MISMATCH: 'item_count_mismatch',
  SUBTOTAL_MISMATCH: 'subtotal_mismatch',
  ITEM_LINE_TOTAL_MISMATCH: 'item_line_total_mismatch',
  CURRENCY_UNEXPECTED: 'currency_unexpected',
  ITEM_UNIT_PRICE_CORRECTED: 'item_unit_price_corrected',
  PAGE_BREAK_UNCERTAIN: 'page_break_uncertain',
})
```

Add it to `WARNING_CODES` so it flips `needsReview`:

```js
const WARNING_CODES = new Set([
  REASON_CODES.GRAND_TOTAL_MISMATCH,
  REASON_CODES.ITEM_COUNT_MISMATCH,
  REASON_CODES.SUBTOTAL_MISMATCH,
  REASON_CODES.ITEM_LINE_TOTAL_MISMATCH,
  REASON_CODES.CURRENCY_UNEXPECTED,
  REASON_CODES.PAGE_BREAK_UNCERTAIN,
])
```

Then add Check 6 immediately after the Check 5 block (just before `const dedupedReasons = ...`):

```js
  // Check 6: the AI could not reconstruct a line cut at a multi-image boundary
  if (parsedData.pageBreakUncertain === true) {
    reviewReasons.push(REASON_CODES.PAGE_BREAK_UNCERTAIN)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions; node --test`

Expected: PASS — all previous tests plus the 2 new ones (47 total).

- [ ] **Step 5: Commit**

```bash
git add functions/reconcile.js functions/__tests__/reconcile.test.js
git commit -m "feat(receipts): flag unreadable page seams for review

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 4: Multi-image prompt, labels, and schema

**Files:**
- Modify: `functions/receiptAnalysis.js` (`generatePrompt` at `:149`, `analyzeReceiptWithAI` at `:269`, `receiptSchema` at `:61`, `prepareFirestoreUpdateData` at `:356`)
- Test: `functions/__tests__/receiptAnalysis.prompt.test.js` (create)

Two things make multi-image reading work: **a text label immediately before each image** (otherwise N inline images are just N images and the model guesses the order), and **seam rules** telling it what a cut-off line looks like.

The multi-page content goes in its own `### MULTI-IMAGE RECEIPT` section rather than as new numbered rules. The existing 10 rules are tuned and renumbering them risks regressing single-image extraction.

- [ ] **Step 1: Write the failing test**

Create `functions/__tests__/receiptAnalysis.prompt.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generatePrompt, pageLabel, receiptSchema, prepareFirestoreUpdateData } = require('../receiptAnalysis')

test('a single-image prompt says nothing about multiple images', () => {
  const prompt = generatePrompt('JPY', 'TWD', 1)
  assert.equal(prompt.includes('MULTI-IMAGE RECEIPT'), false)
  assert.equal(prompt.includes('pageBreakUncertain'), false)
  assert.ok(prompt.includes('Analyze the provided receipt image'))
})

test('generatePrompt defaults to the single-image form when no count is given', () => {
  assert.equal(generatePrompt('JPY', 'TWD'), generatePrompt('JPY', 'TWD', 1))
})

test('a multi-image prompt states the page count and the seam rules', () => {
  const prompt = generatePrompt('JPY', 'TWD', 3)
  assert.ok(prompt.includes('MULTI-IMAGE RECEIPT (3 IMAGES)'))
  assert.ok(prompt.includes('ONE continuous receipt'))
  assert.ok(prompt.includes('OVERLAP'), 'must warn about double-counting overlapping lines')
  assert.ok(prompt.includes('CUTS a line'), 'must explain a line cut at the bottom edge')
  assert.ok(prompt.includes('pageBreakUncertain'), 'must name the escape hatch')
  assert.ok(prompt.includes('IMAGE 3'), 'must identify the final image')
})

test('a multi-image prompt keeps all ten single-image rules', () => {
  const single = generatePrompt('JPY', 'TWD', 1)
  const multi = generatePrompt('JPY', 'TWD', 3)
  for (const marker of ['MULTI-LINE ITEM NAMES', 'printedItemCount', 'CURRENCY — DETECT FROM RECEIPT', 'CATEGORY']) {
    assert.ok(single.includes(marker), `single prompt lost ${marker}`)
    assert.ok(multi.includes(marker), `multi prompt lost ${marker}`)
  }
})

test('pageLabel returns null for a single image', () => {
  assert.equal(pageLabel(0, 1), null)
})

test('pageLabel tells each image which edges it joins', () => {
  assert.ok(pageLabel(0, 3).includes('IMAGE 1 of 3'))
  assert.ok(pageLabel(0, 3).includes('continues onto IMAGE 2'))

  assert.ok(pageLabel(1, 3).includes('continues from IMAGE 1'))
  assert.ok(pageLabel(1, 3).includes('continues onto IMAGE 3'))

  assert.ok(pageLabel(2, 3).includes('continues from IMAGE 2'))
  assert.ok(pageLabel(2, 3).includes('final section'))
  assert.equal(pageLabel(2, 3).includes('continues onto'), false)
})

test('receiptSchema accepts pageBreakUncertain', () => {
  assert.ok('pageBreakUncertain' in receiptSchema.shape)
})

test('prepareFirestoreUpdateData does not persist the raw pageBreakUncertain flag', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], category: 'food', paidAtString: null, currency: 'TWD', pageBreakUncertain: true },
    'TWD',
  )
  assert.equal('pageBreakUncertain' in out, false, 'the signal belongs in reviewReasons')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions; node --test --test-name-pattern="prompt|pageLabel|pageBreakUncertain"`

Expected: FAIL — `pageLabel` is not a function, and the multi-image assertions fail.

- [ ] **Step 3: Write the implementation**

**3a.** In `receiptSchema` (`functions/receiptAnalysis.js:61`), add this field after `category`:

```js
  pageBreakUncertain: z.boolean().nullable().describe('Multi-image receipts only. True if a line item was cut off at the boundary between two images and you could NOT reconstruct it from the adjacent image. False when every boundary resolved cleanly, or when there is only one image.'),
```

**3b.** Replace the signature and opening of `generatePrompt` (`:149`). The function currently starts:

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
```

Change it to:

```js
function generatePrompt(receiptCurrency, outputLocale, pageCount = 1) {
  const language = languageMap[outputLocale] || 'English'
  const dateFormat = dateFormatMap[receiptCurrency] || 'DD/MM/YYYY'
  const isMultiPage = pageCount > 1

  const opener = isMultiPage
    ? `Analyze the ${pageCount} provided images — consecutive photographs of ONE single long receipt — and extract data into the specified JSON structure.`
    : 'Analyze the provided receipt image and extract data into the specified JSON structure.'

  const multiPageSection = isMultiPage
    ? `
### MULTI-IMAGE RECEIPT (${pageCount} IMAGES)

The images are sections of ONE continuous receipt, ordered from top to bottom: IMAGE 1 is the top, IMAGE ${pageCount} is the bottom. They are NOT separate receipts. Produce ONE combined result.

A. **OVERLAP** — the photographs deliberately overlap. A line fully visible in two consecutive images is ONE item. Never emit it twice.
B. **CUT LINES** — the bottom edge of an image often CUTS a line in half: the product name is legible but its amount is off-frame, or the text is clipped mid-character. That line almost always appears complete at the top of the NEXT image. Emit it ONCE, taking name, price, quantity and lineTotal from whichever image shows the COMPLETE line — the one with a printed amount wins.
C. **READ TOTALS ONCE** — grandTotal, subtotal, taxAmount, serviceCharge, discount, tip, the date and printedItemCount are each read ONCE, from wherever they are printed (usually the final image). A store header repeated across images is the same header, not new data.
D. **ORDER** — items[] follows receipt order: every item from IMAGE 1, then IMAGE 2, and so on.
E. **WHEN IN DOUBT** — if a line is cut at an image boundary and you CANNOT reconstruct it from the adjacent image, still emit your best reading of it and set "pageBreakUncertain": true. Set "pageBreakUncertain": false when every boundary resolved cleanly.
`
    : ''

  return `
${opener}

### CONTEXT
- Receipt Region Hint: ${receiptCurrency} (informational only — NOT authoritative)
- Expected Date Format: ${dateFormat}
- Target Output Language: ${language}
${multiPageSection}
### RULES
```

Leave the ten numbered rules and everything after them untouched.

**3c.** Add `pageLabel` immediately above `analyzeReceiptWithAI`:

```js
/**
 * Build the text label that precedes one image in a multi-image request, so
 * the model knows which edge of the receipt this image joins. Without labels,
 * N inline images carry no ordering information at all.
 * @param {number} index - 0-based image position
 * @param {number} total - total number of images
 * @returns {string|null} The label, or null when there is only one image.
 */
function pageLabel(index, total) {
  if (total <= 1) {
    return null
  }
  const position = `IMAGE ${index + 1} of ${total}`
  if (index === 0) {
    return `--- ${position} — top of the receipt, continues onto IMAGE 2 ---`
  }
  if (index === total - 1) {
    return `--- ${position} — continues from IMAGE ${index}, final section ---`
  }
  return `--- ${position} — continues from IMAGE ${index}, continues onto IMAGE ${index + 2} ---`
}
```

**3d.** Replace `analyzeReceiptWithAI` (`:269`) entirely:

```js
/**
 * Analyze one receipt using Gemini. Several images are read as consecutive
 * sections of ONE long receipt in a single call — never as separate receipts.
 * @param {Array<{base64: string, contentType: string}>} images - Pages in receipt order
 * @param {string} tripCurrency - The trip destination currency
 * @param {string} defaultCurrency - The user's default currency
 * @returns {Promise<object>} Reconciled receipt data with needsReview and reviewReasons
 */
async function analyzeReceiptWithAI(images, tripCurrency, defaultCurrency) {
  const pages = Array.isArray(images) ? images : [images]
  if (pages.length === 0) {
    throw new Error('analyzeReceiptWithAI requires at least one image')
  }

  const contents = [{ text: generatePrompt(tripCurrency, defaultCurrency, pages.length) }]
  pages.forEach((page, index) => {
    const label = pageLabel(index, pages.length)
    if (label) {
      contents.push({ text: label })
    }
    contents.push({ inlineData: { mimeType: page.contentType, data: page.base64 } })
  })

  logger.log(`Sending request to Gemini API with structured schema (${pages.length} image(s))...`)
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: zodToJsonSchema(receiptSchema),
      thinkingConfig: { thinkingBudget: -1 },
    },
  })

  const parsedData = JSON.parse(result.text)

  // Run server-side reconciliation: math checks, auto-correct unit-price slot,
  // accumulate reviewReasons + needsReview.
  return reconcileReceipt(parsedData, tripCurrency)
}
```

**3e.** In `prepareFirestoreUpdateData` (`:356`), add `pageBreakUncertain` to the stripped fields. The destructure currently reads:

```js
  const { paidAtString, currency: _detectedCurrency, category: _rawCategory, ...restOfData } = parsedDataFromAI
```

Change it to:

```js
  const { paidAtString, currency: _detectedCurrency, category: _rawCategory, pageBreakUncertain: _pageBreakUncertain, ...restOfData } = parsedDataFromAI
```

and extend the comment above it with one more bullet:

```js
  // - pageBreakUncertain: consumed by reconcileReceipt, which converts it into
  //   the page_break_uncertain review reason; the raw flag is not persisted.
```

**3f.** Add `pageLabel` to `module.exports`:

```js
module.exports = {
  generatePrompt,
  pageLabel,
  getImageAsBase64,
  analyzeReceiptWithAI,
  convertToTimestamp,
  prepareFirestoreUpdateData,
  getContentTypeFromPath,
  timezoneMap,
  languageMap,
  dateFormatMap,
  receiptSchema,
  expenseItemSchema,
  SUPPORTED_CURRENCIES,
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions; node --test`

Expected: PASS — all tests including the 8 new prompt tests. The existing `receiptAnalysis.category.test.js` must stay green; it calls `prepareFirestoreUpdateData` with the same signature.

- [ ] **Step 5: Commit**

```bash
git add functions/receiptAnalysis.js functions/__tests__/receiptAnalysis.prompt.test.js
git commit -m "feat(receipts): read several images as one long receipt

Label each image with its position and teach the model what a line cut at
an image boundary looks like, so overlapping photos are not double-counted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 5: Wire the storage trigger

**Files:**
- Modify: `functions/onReceiptUploaded.js`

No new tests: this file is a thin composition of pieces already covered by Tasks 1–4, and testing it would mean mocking `onObjectFinalized`, the storage SDK and Gemini. It is verified end-to-end in Task 12.

Note the ordering: the **non-image guard stays before the claim**, so a non-image file never enters `imageUrls`.

- [ ] **Step 1: Extend the imports**

At the top of `functions/onReceiptUploaded.js`, add `getContentTypeFromPath` to the destructured require and add the new module:

```js
const {
  getImageAsBase64,
  analyzeReceiptWithAI,
  prepareFirestoreUpdateData,
  getContentTypeFromPath,
} = require('./receiptAnalysis')
const { claimPageForAnalysis } = require('./receiptPages')
```

- [ ] **Step 2: Replace the analysis block**

The file currently runs, after the non-image guard:

```js
  logger.info(`Analyzing image: ${filePath}`)

  try {
    const imageBase64 = await getImageAsBase64(fileBucket, filePath)

    // Analyze with AI (includes price sanitization)
    const parsedDataFromAI = await analyzeReceiptWithAI(
      imageBase64,
      contentType,
      tripCurrency,
      defaultCurrency,
    )
    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Prepare Firestore update data
    const firestoreUpdateData = prepareFirestoreUpdateData(
      parsedDataFromAI,
      tripCurrency,
      filePath, // receiptImageUrl
    )

    const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)
    await expenseDocRef.update(firestoreUpdateData)
```

Replace from `logger.info(\`Analyzing image: ...\`)` through that `await expenseDocRef.update(firestoreUpdateData)` with:

```js
  const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)

  // Each page of a multi-image receipt fires this function separately. The
  // claim decides, atomically, whether this invocation is the one that has the
  // complete set and should run the analysis.
  //
  // The claim must be inside error handling: runTransaction rejects on
  // contention exhaustion or UNAVAILABLE, this trigger is registered without
  // `retry`, and the other invocations have already bailed — so an unhandled
  // rejection means the page is never recorded, nothing re-evaluates the gate,
  // and the expense sits in 處理中 forever with no error written anywhere.
  let claim
  try {
    claim = await claimPageForAnalysis(expenseDocRef, filePath)
  }
  catch (error) {
    logger.error('Failed to record the uploaded page:', error)
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'fail',
      reason: 'claim_error',
      tripId,
      expenseId,
      error: error.message || 'Unknown error',
    })
    // An unrecorded page means the set can never complete, so fail the expense
    // rather than leaving it processing indefinitely.
    try {
      await expenseDocRef.update({
        isProcessing: false,
        processingError: `Could not record an uploaded receipt page: ${error.message || 'Unknown error'}.`,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    catch (updateError) { logger.error(updateError) }
    return
  }

  if (claim.status !== 'analyze') {
    logger.info(`Page ${filePath} recorded with status '${claim.status}' (${claim.paths.length} of ${claim.expected}); not analyzing in this invocation.`)
    return
  }

  logger.info(`Analyzing ${claim.paths.length} page(s): ${claim.paths.join(', ')}`)

  try {
    const pages = await Promise.all(claim.paths.map(async path => ({
      base64: await getImageAsBase64(fileBucket, path),
      // The event's contentType describes only the page that triggered this
      // invocation, so derive each page's type from its own extension.
      contentType: getContentTypeFromPath(path),
    })))

    // Analyze with AI (includes price sanitization)
    const parsedDataFromAI = await analyzeReceiptWithAI(
      pages,
      tripCurrency,
      defaultCurrency,
    )
    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Prepare Firestore update data. The first page in receipt order is the
    // expense's representative image.
    const firestoreUpdateData = prepareFirestoreUpdateData(
      parsedDataFromAI,
      tripCurrency,
      claim.paths[0], // receiptImageUrl
    )

    await expenseDocRef.update(firestoreUpdateData)
```

Leave the surrounding `logger.info(...)` success/failure structured events and the `catch` block as they are, except for Step 3.

- [ ] **Step 3: Add `pageCount` to the two structured log events**

In the success event, add one field:

```js
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'success',
      tripId,
      expenseId,
      pageCount: claim.paths.length,
      itemCount: parsedDataFromAI.items?.length ?? 0,
      needsReview: parsedDataFromAI.needsReview ?? false,
      currency: parsedDataFromAI.currency ?? null,
    })
```

In the `catch` block's failure event, add the same field:

```js
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'fail',
      reason: 'ai_error',
      tripId,
      expenseId,
      pageCount: claim.paths.length,
      error: error.message || 'Unknown error',
    })
```

- [ ] **Step 4: Verify nothing regressed and the file is consistent**

Run: `cd functions; node --test`

Expected: PASS, same count as Task 4.

Run: `npx eslint functions/onReceiptUploaded.js`

Expected: no output (clean).

Check by eye that `expenseDocRef` is now declared exactly once in the function (it was previously declared inside the `try` block, and separately in both error paths as `expenseDocRefError` / `expenseDocRefGeneralError` — those two keep their own declarations and are fine).

Run: `grep -n "expenseDocRef" functions/onReceiptUploaded.js`

Expected: the new single `const expenseDocRef = db.doc(...)` before the claim, plus its uses; no duplicate `const expenseDocRef` inside `try`.

- [ ] **Step 5: Commit**

```bash
git add functions/onReceiptUploaded.js
git commit -m "feat(receipts): analyze all pages once the set is complete

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 6: Re-analysis and the regression script

**Files:**
- Modify: `functions/reanalyzeReceipt.js:66-107`
- Modify: `functions/regression-receipts.js:26,62-64`

Both callers must move to the new array signature. `reanalyzeReceipt` also gains the fallback for expenses created before this feature, which have a `receiptImageUrl` but an empty `imageUrls`.

- [ ] **Step 1: Add the import to `reanalyzeReceipt.js`**

After the existing `require('./receiptAnalysis')` block, add:

```js
const { sortPagePaths } = require('./receiptPages')
```

- [ ] **Step 2: Replace the image-resolution block**

`functions/reanalyzeReceipt.js` currently has:

```js
    const expenseData = expenseDoc.data()
    const receiptImageUrl = expenseData.receiptImageUrl

    if (!receiptImageUrl) {
      throw new HttpsError('failed-precondition', 'Expense does not have a receipt image')
    }
```

Replace with:

```js
    const expenseData = expenseDoc.data()

    // Expenses created before multi-page upload have only receiptImageUrl.
    const storedPages = Array.isArray(expenseData.imageUrls) ? expenseData.imageUrls : []
    const pagePaths = storedPages.length > 0
      ? sortPagePaths(storedPages)
      : (expenseData.receiptImageUrl ? [expenseData.receiptImageUrl] : [])

    if (pagePaths.length === 0) {
      throw new HttpsError('failed-precondition', 'Expense does not have a receipt image')
    }
```

- [ ] **Step 3: Replace the download-and-analyze block**

The file currently has:

```js
    logger.info(`Downloading image from: ${receiptImageUrl}`)

    // Download image from Storage using default bucket
    const bucketName = storageBucket.name
    const imageBase64 = await getImageAsBase64(bucketName, receiptImageUrl)
    const contentType = getContentTypeFromPath(receiptImageUrl)

    logger.info(`Image downloaded, content type: ${contentType}`)

    // Analyze with AI
    const parsedDataFromAI = await analyzeReceiptWithAI(
      imageBase64,
      contentType,
      tripCurrency,
      defaultCurrency,
    )
```

Replace with:

```js
    logger.info(`Downloading ${pagePaths.length} page(s): ${pagePaths.join(', ')}`)

    // Download every page from Storage using default bucket
    const bucketName = storageBucket.name
    const pages = await Promise.all(pagePaths.map(async path => ({
      base64: await getImageAsBase64(bucketName, path),
      contentType: getContentTypeFromPath(path),
    })))

    logger.info(`${pages.length} page(s) downloaded`)

    // Analyze with AI — several pages are read as one continuous receipt
    const parsedDataFromAI = await analyzeReceiptWithAI(
      pages,
      tripCurrency,
      defaultCurrency,
    )
```

- [ ] **Step 4: Add `pageCount` to the success log event**

In `reanalyzeReceipt.js`, the success event gains one field:

```js
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'success',
      mode: 'reanalyze',
      tripId,
      expenseId,
      pageCount: pages.length,
      itemCount: parsedDataFromAI.items?.length ?? 0,
      needsReview: parsedDataFromAI.needsReview ?? false,
      currency: parsedDataFromAI.currency ?? null,
    })
```

- [ ] **Step 5: Update the regression script**

In `functions/regression-receipts.js`, line 62-64 currently reads:

```js
      const imageBase64 = await getImageAsBase64(bucket.name, current.receiptImageUrl)
      const contentType = getContentTypeFromPath(current.receiptImageUrl)

      const fresh = await analyzeReceiptWithAI(imageBase64, contentType, tripCurrency, defaultCurrency)
```

Replace with:

```js
      const imageBase64 = await getImageAsBase64(bucket.name, current.receiptImageUrl)
      const contentType = getContentTypeFromPath(current.receiptImageUrl)

      const fresh = await analyzeReceiptWithAI([{ base64: imageBase64, contentType }], tripCurrency, defaultCurrency)
```

This script deliberately keeps reading the single `receiptImageUrl`: it replays historical single-image receipts to compare extraction quality, so feeding it multiple pages would change what it measures.

- [ ] **Step 6: Verify**

Run: `cd functions; node --test`

Expected: PASS, unchanged count.

Run: `npx eslint functions/reanalyzeReceipt.js`

Expected: clean.

Run: `npx eslint functions/regression-receipts.js`

Expected: **15 problems, all pre-existing** (this file was already failing lint before the plan started). Confirm your one-line change added none of them — the count must still be 15, not 16. Do not fix the pre-existing ones; that is unrelated scope. Count by reading eslint's own `✖ N problems` line, not by grepping for the words "error"/"warning", which also match the summary line.

Run: `grep -rn "analyzeReceiptWithAI(" functions/*.js`

Expected: three call sites (`onReceiptUploaded.js`, `reanalyzeReceipt.js`, `regression-receipts.js`), each passing an array or a `pages` variable — **no call passing a bare base64 string**.

- [ ] **Step 7: Commit**

```bash
git add functions/reanalyzeReceipt.js functions/regression-receipts.js
git commit -m "feat(receipts): re-analyze every page of a multi-page receipt

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 7: Types and converter

**Files:**
- Modify: `types/index.ts:86`
- Modify: `utils/converter.ts:89`

- [ ] **Step 1: Add `imageCount` to `NewExpense`**

In `types/index.ts`, the `NewExpense` interface has:

```ts
  imageUrls?: string[] // URLs of uploaded images
```

Change those two lines to:

```ts
  imageUrls?: string[] // Storage paths of the uploaded receipt pages, in receipt order
  imageCount?: number // Pages the client is uploading; the analysis gate waits for this many
```

- [ ] **Step 2: Map it in the converter**

In `utils/converter.ts`, `expenseConverter.fromFirestore` has:

```ts
      imageUrls: data.imageUrls || [],
```

Add the count right after it:

```ts
      imageUrls: data.imageUrls || [],
      imageCount: data.imageCount,
```

- [ ] **Step 3: Verify types compile**

Run: `npx eslint types/index.ts utils/converter.ts`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts utils/converter.ts
git commit -m "feat(receipts): add imageCount to the expense model

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 8: Client-side page bookkeeping

**Files:**
- Create: `utils/receiptPages.ts`
- Test: `__tests__/receiptPages.test.ts`

This holds the picker's logic so it can be tested without a DOM. The repo has no `@vue/test-utils` or jsdom, so component rendering is not unit-testable here — keep logic out of the component.

Two behaviors worth being precise about: a **duplicate** is skipped silently (the user re-picked the same photo; nothing is wrong), while an **over-cap** file is counted and reported so the caller can toast.

- [ ] **Step 1: Write the failing test**

Create `__tests__/receiptPages.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run __tests__/receiptPages.test.ts`

Expected: FAIL — cannot resolve `@/utils/receiptPages`.

- [ ] **Step 3: Write the implementation**

Create `utils/receiptPages.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run __tests__/receiptPages.test.ts`

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add utils/receiptPages.ts __tests__/receiptPages.test.ts
git commit -m "feat(receipts): add client-side receipt page helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 9: Upload retry helper

**Files:**
- Create: `utils/retry.ts`
- Test: `__tests__/retry.test.ts`

With 5 pages instead of 1, a single flaky upload on hotel wifi is five times likelier. Retrying is what lets `imageCount` stay immutable — see the spec's note on why lowering it would strand the expense.

The `sleep` function is injected so tests do not wait.

- [ ] **Step 1: Write the failing test**

Create `__tests__/retry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { withRetries } from '@/utils/retry'

const noSleep = () => Promise.resolve()

describe('withRetries', () => {
  it('returns the value on first success without sleeping', async () => {
    const sleep = vi.fn(noSleep)
    const result = await withRetries(async () => 'done', { sleep })
    expect(result).toEqual({ ok: true, value: 'done' })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries after a failure and succeeds', async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce('done')
    const result = await withRetries(task, { sleep: noSleep })
    expect(result).toEqual({ ok: true, value: 'done' })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('gives up after three attempts and reports the last error', async () => {
    const task = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await withRetries(task, { sleep: noSleep })
    expect(result.ok).toBe(false)
    expect(task).toHaveBeenCalledTimes(3)
    if (!result.ok) {
      expect((result.error as Error).message).toBe('offline')
    }
  })

  it('backs off for longer between later attempts', async () => {
    const delays: number[] = []
    const task = vi.fn().mockRejectedValue(new Error('offline'))
    await withRetries(task, { delayMs: 100, sleep: async ms => void delays.push(ms) })
    expect(delays).toEqual([100, 200])
  })

  it('honours a custom attempt count', async () => {
    const task = vi.fn().mockRejectedValue(new Error('offline'))
    await withRetries(task, { attempts: 1, sleep: noSleep })
    expect(task).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run __tests__/retry.test.ts`

Expected: FAIL — cannot resolve `@/utils/retry`.

- [ ] **Step 3: Write the implementation**

Create `utils/retry.ts`:

```ts
export type RetryResult<T> = { ok: true, value: T } | { ok: false, error: unknown }

export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number
  /** Base backoff; attempt N waits delayMs * N. */
  delayMs?: number
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Run a task up to `attempts` times, returning a result object instead of
 * throwing, so callers can report partial failure across several parallel
 * tasks without unhandled rejections.
 */
export async function withRetries<T>(
  task: () => Promise<T>,
  { attempts = 3, delayMs = 800, sleep = defaultSleep }: RetryOptions = {},
): Promise<RetryResult<T>> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { ok: true, value: await task() }
    }
    catch (error) {
      lastError = error
      if (attempt < attempts) {
        await sleep(delayMs * attempt)
      }
    }
  }

  return { ok: false, error: lastError }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run __tests__/retry.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add utils/retry.ts __tests__/retry.test.ts
git commit -m "feat: add a retry helper that reports instead of throwing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 10: The page picker component

**Files:**
- Create: `components/ReceiptPagePicker.vue`

A native file input replaces its own selection on every pick, so it cannot append — hence a hidden input driven by buttons. Extracted into a component because `AddExpenseDrawer` renders the receipt tab twice (desktop and mobile) and this is ~40 lines of markup.

Target appearance:

```
上傳收據（僅支援圖片格式）
┌──────────────────────────────┐
│  📷  選擇收據圖片             │   ← empty state
└──────────────────────────────┘

第 1 頁   IMG_4021.jpg        ✕   ← after picking
第 2 頁   IMG_4022.jpg        ✕
┌──────────────────────────────┐
│  +  新增頁面                  │
└──────────────────────────────┘
共 2 頁 · 依新增順序辨識；拍攝時請與上一張稍微重疊
```

- [ ] **Step 1: Create the component**

Create `components/ReceiptPagePicker.vue`:

```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'
import { appendPages, MAX_RECEIPT_PAGES } from '@/utils/receiptPages'

const props = withDefaults(defineProps<{
  /** Unique per breakpoint — the desktop and mobile drawers both render one. */
  id: string
  max?: number
}>(), {
  max: MAX_RECEIPT_PAGES,
})

const pages = defineModel<File[]>({ default: () => [] })

const input = ref<HTMLInputElement | null>(null)

function openPicker() {
  input.value?.click()
}

function onChange(event: Event) {
  const element = event.target as HTMLInputElement
  const incoming = Array.from(element.files ?? [])
  // Clear the input so re-picking the same photo still fires `change`.
  element.value = ''
  if (incoming.length === 0) {
    return
  }

  const { pages: next, rejected } = appendPages(pages.value, incoming, props.max)
  pages.value = next

  if (rejected > 0) {
    toast.error(`最多 ${props.max} 頁`)
  }
}

function removePage(index: number) {
  pages.value = pages.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div class="grid w-full items-center gap-1.5">
    <ui-label :for="id">
      上傳收據（僅支援圖片格式）
    </ui-label>

    <input
      :id="id"
      ref="input"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onChange"
    >

    <ui-button
      v-if="pages.length === 0"
      type="button"
      variant="outline"
      class="w-full justify-center border-dashed h-20"
      @click="openPicker"
    >
      <Icon name="lucide:camera" class="w-4 h-4 mr-2" />
      選擇收據圖片
    </ui-button>

    <template v-else>
      <ul class="space-y-1">
        <li
          v-for="(page, index) in pages"
          :key="`${page.name}-${page.size}-${page.lastModified}`"
          class="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
        >
          <span class="text-xs font-medium text-muted-foreground whitespace-nowrap">
            第 {{ index + 1 }} 頁
          </span>
          <span class="flex-1 text-xs truncate">{{ page.name }}</span>
          <ui-button
            type="button"
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            :aria-label="`移除第 ${index + 1} 頁`"
            @click="removePage(index)"
          >
            <Icon name="lucide:x" :size="14" />
          </ui-button>
        </li>
      </ul>

      <ui-button
        v-if="pages.length < max"
        type="button"
        variant="outline"
        class="w-full justify-center border-dashed"
        @click="openPicker"
      >
        <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
        新增頁面
      </ui-button>

      <p class="text-xs text-muted-foreground">
        共 {{ pages.length }} 頁 · 依新增順序辨識；拍攝時請與上一張稍微重疊
      </p>
    </template>
  </div>
</template>
```

The overlap hint in that last line is load-bearing: the AI's seam rules (Task 4, rule B) rely on a cut line reappearing in the next photo.

- [ ] **Step 2: Lint it**

Run: `npx eslint components/ReceiptPagePicker.vue`

Expected: clean. If ESLint complains about component casing, the fix is kebab-case tags (`<ui-button>`), never PascalCase.

- [ ] **Step 3: Commit**

```bash
git add components/ReceiptPagePicker.vue
git commit -m "feat(receipts): add an incremental receipt page picker

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 11: Wire the drawer

**Files:**
- Modify: `components/AddExpenseDrawer.vue` — `:34` (state), `:269` (reset), `:322-360` (`submitReceipt`), `:471-482` (desktop template), `:968-979` (mobile template)

The drawer keeps closing instantly; uploads continue in the background exactly as today. What is new is that failures are retried and, if they still fail, written onto the expense so it does not sit in 處理中 forever.

- [ ] **Step 1: Swap the state**

At `components/AddExpenseDrawer.vue:34`:

```ts
const selectedFile = ref<File | null>(null)
```

becomes:

```ts
const selectedFiles = ref<File[]>([])
```

Add the new imports. The file already imports from `firebase/firestore` and `firebase/storage`; add these two lines to the import block:

```ts
import { pageFileName } from '@/utils/receiptPages'
import { withRetries } from '@/utils/retry'
```

- [ ] **Step 2: Fix the reset**

In the `watch(open, ...)` block at `:269`:

```ts
    selectedFile.value = null
```

becomes:

```ts
    selectedFiles.value = []
```

- [ ] **Step 3: Rewrite `submitReceipt`**

Replace the whole function (`:322-360`) with:

```ts
async function submitReceipt(formValues: { paidByMemberId: string, sharedWithMemberIds: string[] }) {
  if (selectedFiles.value.length === 0) {
    toast.error('請上傳收據')
    return
  }

  isSubmitting.value = true
  try {
    const db = useFirestore()
    const storage = getStorage()
    const files = [...selectedFiles.value]

    const expense: NewExpense = {
      description: 'Receipt Uploaded, processing',
      grandTotal: 0,
      paidByMemberId: formValues.paidByMemberId,
      sharedWithMemberIds: formValues.sharedWithMemberIds,
      createdAt: serverTimestamp(),
      paidAt: serverTimestamp(),
      isProcessing: true,
      enabled: true,
      createdByUserId: sessionUser.value?.uid,
      exchangeRate: expenseExchangeRate.value,
      // The analysis gate waits for exactly this many pages before calling the AI.
      imageCount: files.length,
    }

    const expenseDoc = await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), expense)

    // Uploads continue after the drawer closes, as they always have.
    void uploadReceiptPages(db, storage, expenseDoc.id, files)

    open.value = false
    logEvent('add_expense', { method: 'receipt', trip_id: props.trip.id, page_count: files.length })
    toast.success(files.length > 1
      ? `收據上傳成功（共 ${files.length} 頁），正在解析收據中...`
      : '收據上傳成功，正在解析收據中...')
  }
  catch (error) {
    console.error('Error uploading receipt:', error)
    toast.error((error as Error).message || '收據上傳失敗，請重新上傳')
  }
  finally {
    isSubmitting.value = false
  }
}

/**
 * Upload every page, retrying a flaky one before giving up.
 *
 * imageCount is never revised: if it were lowered, nothing would re-check the
 * analysis gate — the last storage trigger has already fired and bailed — and
 * the expense would sit in 處理中 forever. So a page that cannot be uploaded
 * fails the whole expense, with a message the user can act on.
 */
async function uploadReceiptPages(
  db: ReturnType<typeof useFirestore>,
  storage: ReturnType<typeof getStorage>,
  expenseId: string,
  files: File[],
) {
  const results = await Promise.all(files.map((file, index) => {
    const path = `trips/${props.trip.id}/expenses/${expenseId}/${pageFileName(index, file.name)}`
    return withRetries(() => uploadBytes(storageRef(storage, path), file))
  }))

  const failed = results.filter(result => !result.ok).length
  if (failed === 0) {
    return
  }

  console.error('Receipt page upload failed', results.filter(result => !result.ok))
  try {
    await updateDoc(fsDoc(db, 'trips', props.trip.id, 'expenses', expenseId), {
      isProcessing: false,
      processingError: `${failed} 張收據圖片上傳失敗，請刪除這筆支出後重新上傳。`,
    })
  }
  catch (error) {
    console.error('Could not record the upload failure on the expense', error)
  }
  toast.error('收據圖片上傳失敗，請重新上傳')
}
```

`addDoc`, `updateDoc`, `doc as fsDoc`, `collection`, `serverTimestamp`, `getStorage`, `ref as storageRef` and `uploadBytes` are all already imported at the top of this file — do not re-import them.

- [ ] **Step 4: Replace both file inputs with the picker**

Desktop, at `:472-482`, this block:

```vue
            <div class="grid w-full items-center gap-1.5">
              <ui-label for="picture-desktop">
                上傳收據（僅支援圖片格式）
              </ui-label>
              <ui-input
                id="picture-desktop"
                type="file"
                accept="image/*"
                @change="(e: Event) => selectedFile = (e.target as HTMLInputElement).files?.[0] ?? null"
              />
            </div>
```

becomes:

```vue
            <receipt-page-picker id="picture-desktop" v-model="selectedFiles" />
```

Mobile, at `:969-979`, the same block with `picture-mobile` becomes:

```vue
              <receipt-page-picker id="picture-mobile" v-model="selectedFiles" />
```

Both breakpoints bind the same `selectedFiles`, so a user who resizes mid-entry keeps their pages. Nuxt auto-imports the component; no import statement is needed.

- [ ] **Step 5: Verify no references to the old state survive**

Run: `grep -n "selectedFile\b" components/AddExpenseDrawer.vue`

Expected: no output.

Run: `npx eslint components/AddExpenseDrawer.vue`

Expected: clean.

Run: `pnpm vitest run`

Expected: PASS, all frontend unit tests.

- [ ] **Step 6: Commit**

```bash
git add components/AddExpenseDrawer.vue
git commit -m "feat(receipts): upload a long receipt as several pages

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 12: Multi-page receipt viewer

**Files:**
- Modify: `components/ReceiptViewer.vue`

Navigation is **buttons and arrow keys, not swipe**: the viewer runs Panzoom, where a horizontal drag already means *pan the zoomed image*. A swipe handler would fight the gesture that makes a zoomed receipt readable.

- [ ] **Step 1: Confirm the only consumer**

Run: `grep -rn "receipt-viewer" --include="*.vue" . | grep -v node_modules`

Expected: only `pages/trips/[tripId]/expenses/[expenseId]/index.vue`. If anything else turns up, it must be updated in Task 13 too — the `src` prop is being replaced.

- [ ] **Step 2: Replace the props and add page state**

The props block currently reads:

```ts
const props = withDefaults(defineProps<{
  open: boolean
  src: string
  alt?: string
}>(), {
  alt: '收據圖片',
})
```

Replace with:

```ts
const props = withDefaults(defineProps<{
  open: boolean
  /** Pages in receipt order. A single-page receipt passes one entry. */
  srcs: string[]
  /** Page to open on, 0-based. */
  startIndex?: number
  alt?: string
}>(), {
  alt: '收據圖片',
  startIndex: 0,
})
```

Then add, immediately after the existing `const hasError = ref(false)`:

```ts
const currentIndex = ref(props.startIndex)
const pageCount = computed(() => props.srcs.length)
const currentSrc = computed(() => props.srcs[currentIndex.value] ?? props.srcs[0] ?? '')
const currentAlt = computed(() =>
  pageCount.value > 1 ? `${props.alt}第 ${currentIndex.value + 1} 頁` : props.alt,
)

function goToPage(delta: number) {
  const next = currentIndex.value + delta
  if (next < 0 || next >= pageCount.value) {
    return
  }
  // The <img> is keyed on src, so a new element mounts and `load` fires again,
  // which re-runs onImageLoad → initPanzoom for the new page.
  destroyPanzoom()
  isLoading.value = true
  hasError.value = false
  currentIndex.value = next
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open || pageCount.value < 2) {
    return
  }
  if (event.key === 'ArrowLeft') {
    goToPage(-1)
  }
  else if (event.key === 'ArrowRight') {
    goToPage(1)
  }
}
```

- [ ] **Step 3: Reset the page on open and manage the key listener**

The existing `watch(() => props.open, ...)` block is:

```ts
watch(() => props.open, (open) => {
  if (open) {
    isLoading.value = true
    hasError.value = false
    if (typeof window !== 'undefined') {
      prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  }
  else {
    destroyPanzoom()
  }
})
```

Replace with:

```ts
watch(() => props.open, (open) => {
  if (open) {
    currentIndex.value = Math.min(Math.max(props.startIndex, 0), Math.max(pageCount.value - 1, 0))
    isLoading.value = true
    hasError.value = false
    if (typeof window !== 'undefined') {
      prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.addEventListener('keydown', onKeydown)
    }
  }
  else {
    destroyPanzoom()
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeydown)
    }
  }
})
```

And extend the existing unmount hook:

```ts
onBeforeUnmount(() => {
  destroyPanzoom()
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
  }
})
```

- [ ] **Step 4: Update the template**

Replace the `<img>` element:

```vue
        <img
          ref="image"
          :src="src"
          :alt="alt"
          class="block w-auto h-auto max-w-screen max-h-dvh"
          draggable="false"
          @load="onImageLoad"
          @error="onImageError"
        >
```

with (note the `:key`, which is what makes `load` fire again on page change):

```vue
        <img
          ref="image"
          :key="currentSrc"
          :src="currentSrc"
          :alt="currentAlt"
          class="block w-auto h-auto max-w-screen max-h-dvh"
          draggable="false"
          @load="onImageLoad"
          @error="onImageError"
        >
```

Then add the navigation controls immediately after the closing `</div>` of the `ref="stage"` element and before `</ui-dialog-content>`. The `bottom-safe-offset-4` class comes from the safe-area plugin already used by `TripBottomBar.vue` and `BackToTopButton.vue`; it keeps the controls clear of the iPhone home indicator:

```vue
      <div
        v-if="pageCount > 1"
        class="absolute z-10 bottom-safe-offset-4 left-0 right-0 flex items-center justify-center gap-3"
      >
        <button
          type="button"
          aria-label="上一頁"
          :disabled="currentIndex === 0"
          class="inline-flex items-center justify-center rounded-full bg-white/10 text-white w-11 h-11 backdrop-blur hover:bg-white/20 disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
          @click="goToPage(-1)"
        >
          <Icon name="lucide:chevron-left" :size="20" />
        </button>

        <span class="text-sm text-white/90 tabular-nums select-none">
          {{ currentIndex + 1 }} / {{ pageCount }}
        </span>

        <button
          type="button"
          aria-label="下一頁"
          :disabled="currentIndex === pageCount - 1"
          class="inline-flex items-center justify-center rounded-full bg-white/10 text-white w-11 h-11 backdrop-blur hover:bg-white/20 disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
          @click="goToPage(1)"
        >
          <Icon name="lucide:chevron-right" :size="20" />
        </button>
      </div>
```

Finally update the dialog description so it mentions paging:

```vue
      <ui-dialog-description class="sr-only">
        使用手指縮放或滑鼠滾輪縮放收據圖片，可拖曳查看細節；多頁收據可使用上一頁、下一頁按鈕或左右方向鍵切換。
      </ui-dialog-description>
```

- [ ] **Step 5: Verify**

Run: `grep -n "props.src\b\|:src=\"src\"" components/ReceiptViewer.vue`

Expected: no output — the old single-src prop is fully gone.

Run: `npx eslint components/ReceiptViewer.vue`

Expected: clean. (The app will not typecheck against the old `src` prop until Task 13 updates the caller; that is expected.)

- [ ] **Step 6: Commit**

```bash
git add components/ReceiptViewer.vue
git commit -m "feat(receipts): page through a multi-page receipt in the viewer

Buttons and arrow keys rather than swipe: horizontal drag already pans the
zoomed image.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 13: Show every page on the expense detail page

**Files:**
- Modify: `pages/trips/[tripId]/expenses/[expenseId]/index.vue` — `:304-308` (URL resolution), `:598-600` (reanalyze guard), `:854-891` (receipt card), `:1045-1049` (viewer)
- Modify: `components/ExpenseReviewBanner.vue`

- [ ] **Step 1: Resolve every page to a download URL**

At `:304-308`:

```ts
const receiptImageUrl = computedAsync(async () => {
  const storage = useFirebaseStorage()
  const ref = storageRef(storage, expense.value?.receiptImageUrl)
  return await getDownloadURL(ref)
}, null)
```

Replace with:

```ts
// Storage paths of the receipt pages. Expenses created before multi-page
// upload have only receiptImageUrl.
const receiptPagePaths = computed<string[]>(() => {
  const pages = expense.value?.imageUrls ?? []
  if (pages.length > 0) {
    return pages
  }
  return expense.value?.receiptImageUrl ? [expense.value.receiptImageUrl] : []
})

const receiptImageUrls = computedAsync<string[]>(async () => {
  const paths = receiptPagePaths.value
  if (paths.length === 0) {
    return []
  }
  const storage = useFirebaseStorage()
  return Promise.all(paths.map(path => getDownloadURL(storageRef(storage, path))))
}, [])

const receiptViewerIndex = ref(0)

function openReceiptViewer(index: number) {
  receiptViewerIndex.value = index
  isReceiptViewerOpen.value = true
}
```

- [ ] **Step 2: Update the reanalyze guard**

At `:598-600`:

```ts
async function reanalyzeReceipt() {
  if (!expense.value?.receiptImageUrl || expense.value?.isProcessing)
    return
```

becomes:

```ts
async function reanalyzeReceipt() {
  if (receiptPagePaths.value.length === 0 || expense.value?.isProcessing)
    return
```

- [ ] **Step 3: Stack the pages in the receipt card**

At `:854`, the card's opening condition:

```vue
        <div v-if="receiptImageUrl" class="bg-card rounded-xl border p-4 space-y-2">
```

becomes:

```vue
        <div v-if="receiptImageUrls.length" class="bg-card rounded-xl border p-4 space-y-2">
```

Leave the card header (the 收據圖片 label and the 重新分析收據 button) exactly as it is. Then replace the single image button at `:879-891`:

```vue
          <button
            type="button"
            aria-label="放大檢視收據"
            class="block w-full cursor-zoom-in rounded-lg overflow-hidden focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2"
            @click="isReceiptViewerOpen = true"
          >
            <img
              :src="receiptImageUrl"
              alt="收據圖片"
              loading="lazy"
              class="w-full max-h-96 object-contain rounded-lg"
            >
          </button>
```

with:

```vue
          <div class="space-y-3">
            <div v-for="(src, index) in receiptImageUrls" :key="src" class="space-y-1">
              <div v-if="receiptImageUrls.length > 1" class="text-xs text-muted-foreground">
                第 {{ index + 1 }} 頁
              </div>
              <button
                type="button"
                :aria-label="receiptImageUrls.length > 1 ? `放大檢視收據第 ${index + 1} 頁` : '放大檢視收據'"
                class="block w-full cursor-zoom-in rounded-lg overflow-hidden focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2"
                @click="openReceiptViewer(index)"
              >
                <img
                  :src="src"
                  :alt="receiptImageUrls.length > 1 ? `收據圖片第 ${index + 1} 頁` : '收據圖片'"
                  loading="lazy"
                  class="w-full max-h-96 object-contain rounded-lg"
                >
              </button>
            </div>
          </div>
```

- [ ] **Step 4: Pass all pages to the viewer**

At `:1045-1049`:

```vue
    <receipt-viewer
      v-if="receiptImageUrl"
      v-model:open="isReceiptViewerOpen"
      :src="receiptImageUrl"
    />
```

becomes:

```vue
    <receipt-viewer
      v-if="receiptImageUrls.length"
      v-model:open="isReceiptViewerOpen"
      :srcs="receiptImageUrls"
      :start-index="receiptViewerIndex"
    />
```

- [ ] **Step 5: Add the review-banner message**

In `components/ExpenseReviewBanner.vue`, add the code to the local `WARNING_CODES` set:

```ts
const WARNING_CODES = new Set([
  'grand_total_mismatch',
  'item_count_mismatch',
  'subtotal_mismatch',
  'item_line_total_mismatch',
  'currency_unexpected',
  'page_break_uncertain',
])
```

and its message to `MESSAGES`:

```ts
const MESSAGES: Record<string, string> = {
  grand_total_mismatch: '項目金額加總與收據總計不符，請檢查',
  item_count_mismatch: '項目數量與收據上的點數不一致',
  subtotal_mismatch: '項目加總與小計不符',
  item_line_total_mismatch: '部分項目的單價 × 數量與該行金額不符',
  currency_unexpected: '偵測到的貨幣與此次行程貨幣不同',
  page_break_uncertain: '跨頁交接處可能有項目被截斷，請確認明細',
}
```

- [ ] **Step 6: Verify**

Run: `grep -n "receiptImageUrl\b" "pages/trips/[tripId]/expenses/[expenseId]/index.vue"`

Expected: only the two reads inside `receiptPagePaths` (`expense.value?.receiptImageUrl`). No `receiptImageUrl` as a local computed or template binding.

Run: `npx eslint .`

Expected: clean, whole project.

Run: `pnpm vitest run`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "pages/trips/[tripId]/expenses/[expenseId]/index.vue" components/ExpenseReviewBanner.vue
git commit -m "feat(receipts): show every page of a multi-page receipt

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E2www2zUvr4LmcGiAAVDVq"
```

---

## Task 14: Full verification

Automated tests cover the pure logic and the transaction gate. They cannot cover the part most likely to be wrong: whether the Resize Images extension names files the way `pageIndexOf` expects, and whether Gemini actually stitches the pages. That needs a real run.

**`pnpm dev` and deployed functions both hit the real Firebase project.** Use a throwaway trip and expect real Gemini charges.

- [ ] **Step 1: Run every automated check**

```bash
cd functions && node --test && cd ..
pnpm vitest run
pnpm test:emulator
npx eslint .
```

Expected: all green. Record the test counts; a drop means something was deleted rather than fixed.

- [ ] **Step 2: Deploy the functions**

```bash
pnpm dlx firebase-tools deploy --only functions
```

Expected: `onReceiptUploaded` and `reanalyzeReceipt` deploy successfully.

If deployment is not available to you, stop here and report that Steps 3–7 are unverified rather than marking them done.

- [ ] **Step 3: Verify a single-page upload still works (regression)**

Run `pnpm dev`, open a throwaway trip, add an expense from one receipt photo.

Expected: items and total extracted as before; the detail page shows one image with **no** `第 1 頁` label and **no** page controls in the viewer. This is the most important check in the task — the shared code path means multi-page work can break ordinary uploads.

- [ ] **Step 4: Verify a long receipt across 3 pages**

Photograph a long receipt in 3 overlapping shots. Add the expense, picking page 1, then `+ 新增頁面` twice.

Expected:
- The picker lists `第 1 頁` … `第 3 頁` in the order added, each removable.
- The drawer closes immediately; the toast reads `收據上傳成功（共 3 頁），正在解析收據中...`.
- In Firestore, the expense has `imageCount: 3` and, once analysis finishes, `imageUrls` with 3 **sorted** `resized/page-N` paths.
- Items from all three photos appear once each — **specifically check the line that was cut at each seam: it must appear exactly once, with a price.**
- The grand total matches the receipt's printed total.

- [ ] **Step 5: Check the logs for the gate**

```bash
pnpm dlx firebase-tools functions:log --only onReceiptUploaded
```

Expected: for that expense, two invocations logging `status 'waiting'` and exactly **one** logging `Analyzing 3 page(s)`. Two "Analyzing" lines means the gate is broken.

- [ ] **Step 6: Verify viewing and re-analysis**

On the expense detail page:
- Three stacked images labeled `第 1 頁` / `第 2 頁` / `第 3 頁`.
- Tapping page 2 opens the viewer showing `2 / 3`; arrows and the ← → keys move between pages; pinch/scroll zoom still works on each.
- 重新分析收據 completes and produces the same items (it re-reads all three pages).

- [ ] **Step 7: Verify an old expense still renders**

Open an expense created before this change (one with `receiptImageUrl` but no `imageUrls`).

Expected: its image displays, no page label, no page controls, and 重新分析收據 still works.

- [ ] **Step 8: Verify the cap**

Try to add a 6th page.

Expected: the `+ 新增頁面` button is hidden at 5 pages, and selecting 6 at once keeps the first 5 and toasts `最多 5 頁`.

- [ ] **Step 9: Report**

State plainly which steps passed, which failed with their output, and which were skipped. Do not mark the task complete if any step was skipped.

---

## Deferred / explicitly out of scope

Do not build these; they were considered and declined during design:

- Thumbnail previews and drag-to-reorder in the picker — add order is the page order.
- Swipe navigation in the viewer — conflicts with Panzoom's drag-to-pan.
- Client-side stitching of pages into one tall image — destroys small print on downscale and loses per-page viewing.
- A stalled-upload retry banner. If the Resize Images extension silently fails on a page, the expense sits in 處理中 indefinitely. This is already true for single uploads today, so it is not a new failure mode — but N pages give it N times the opportunity. This is the documented limitation to revisit first if it bites in practice.
