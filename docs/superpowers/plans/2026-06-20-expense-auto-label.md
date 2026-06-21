# Expense Auto-Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically assign an editable category label to every expense — for free on receipt uploads (folded into the existing Gemini call), via an opt-in text-only call for new manual entries, and via a one-call batch button for backfilling existing unlabeled expenses.

**Architecture:** A single shared category taxonomy (7 keys) is the contract. The app side (`utils/categories.ts`, TS) drives the UI; the Cloud Functions side (`functions/categories.js`, CommonJS) drives the Gemini schemas — they are separate npm packages and cannot import across the boundary, so the key list is mirrored and kept in sync. Receipts get `category` added to the existing `receiptSchema`/prompt. A new `classifyExpense` callable does text-only classification of a list of `{id, description}` (used by both per-entry and batch). The UI shows category as a colored chip and edits it via pill buttons.

**Tech Stack:** Nuxt 4 / Vue 3 (`<script setup>`), TypeScript, Firebase (Firestore + Cloud Functions v2, `@google/genai` Gemini `gemini-2.5-flash`), Zod, Vitest (app), `node --test` (functions), Tailwind v4, shadcn-vue.

---

## File Structure

**Created:**
- `utils/categories.ts` — app-side taxonomy: keys, zh-TW labels, chip icon/color, `coerceCategory`, `getCategoryMeta`.
- `utils/categories.test.ts` — vitest unit tests for the app module.
- `functions/categories.js` — functions-side taxonomy: keys array, `coerceCategory`, `categoryEnum` (Zod).
- `functions/categories.test.js` — `node --test` unit tests for the functions module.
- `functions/classifyExpenseHelpers.js` — pure helpers `buildClassifyPrompt` / `parseClassifyResponse` + `responseSchema` (no network, no Firebase).
- `functions/classifyExpense.js` — the callable (mirrors `reanalyzeReceipt.js`: exports only the `onCall`).
- `functions/classifyExpenseHelpers.test.js` — `node --test` for the pure helpers.
- `components/CategoryChip.vue` — read-only display chip (icon + label, muted "未分類" when empty).
- `components/CategoryPicker.vue` — pill-button category selector (`v-model`), used by the drawer and edit dialog.
- `composables/useExpenseAutoLabel.ts` — client batch runner (filter unlabeled → chunk → call → write back).

**Modified:**
- `functions/receiptAnalysis.js` — add `category` to `receiptSchema` + prompt rule; pass-through in `prepareFirestoreUpdateData`.
- `functions/index.js` — register `classifyExpense`.
- `components/ExpenseItem.vue` — render `<category-chip>` in the row.
- `components/ExpenseBasicsEditDialog.vue` — category picker + include `category` in save payload.
- `pages/trips/[tripId]/expenses/[expenseId]/index.vue` — show chip; persist `category` in `saveBasics`.
- `components/AddExpenseDrawer.vue` — manual tab: category picker + 自動分類 toggle + background classify on save.
- `pages/trips/[tripId]/expenses/index.vue` — 自動分類 batch button in the list header.

`category` already exists on `NewExpense`/`Expense` (`types/index.ts:80`) and already passes through `utils/converter.ts:79` — no type/converter changes needed.

---

## Task 1: App-side category taxonomy

**Files:**
- Create: `utils/categories.ts`
- Test: `utils/categories.test.ts`

- [ ] **Step 1: Write the failing test**

Create `utils/categories.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CATEGORY_KEYS, coerceCategory, getCategoryMeta } from './categories'

describe('categories', () => {
  it('has the 7 expected keys in order', () => {
    expect(CATEGORY_KEYS).toEqual([
      'food', 'groceries', 'transport', 'lodging', 'activities', 'shopping', 'other',
    ])
  })

  it('coerces a known key to itself', () => {
    expect(coerceCategory('food')).toBe('food')
  })

  it('coerces unknown / empty / nullish to other', () => {
    expect(coerceCategory('FOOD')).toBe('other')
    expect(coerceCategory('nonsense')).toBe('other')
    expect(coerceCategory('')).toBe('other')
    expect(coerceCategory(undefined)).toBe('other')
    expect(coerceCategory(null)).toBe('other')
  })

  it('returns zh-TW label + icon for a known key', () => {
    const meta = getCategoryMeta('transport')
    expect(meta.label).toBe('交通')
    expect(meta.icon).toBe('lucide:car')
  })

  it('returns the other meta for an unknown key', () => {
    expect(getCategoryMeta('nope').label).toBe('其他')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run utils/categories.test.ts`
Expected: FAIL — cannot resolve `./categories`.

- [ ] **Step 3: Write minimal implementation**

Create `utils/categories.ts`:

```ts
export const CATEGORY_KEYS = [
  'food', 'groceries', 'transport', 'lodging', 'activities', 'shopping', 'other',
] as const

export type CategoryKey = typeof CATEGORY_KEYS[number]

interface CategoryMeta {
  key: CategoryKey
  label: string // zh-TW display label
  icon: string // @nuxt/icon name
  chipClass: string // Tailwind classes for the chip background + text
}

const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  food: { key: 'food', label: '餐飲', icon: 'lucide:utensils', chipClass: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  groceries: { key: 'groceries', label: '超市雜貨', icon: 'lucide:shopping-basket', chipClass: 'bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300' },
  transport: { key: 'transport', label: '交通', icon: 'lucide:car', chipClass: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  lodging: { key: 'lodging', label: '住宿', icon: 'lucide:bed-double', chipClass: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  activities: { key: 'activities', label: '活動娛樂', icon: 'lucide:ticket', chipClass: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300' },
  shopping: { key: 'shopping', label: '購物', icon: 'lucide:shopping-bag', chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  other: { key: 'other', label: '其他', icon: 'lucide:tag', chipClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value)
}

export function coerceCategory(value: unknown): CategoryKey {
  return isCategoryKey(value) ? value : 'other'
}

export function getCategoryMeta(value: unknown): CategoryMeta {
  return CATEGORY_META[coerceCategory(value)]
}

// Ordered metadata list for building pickers.
export const CATEGORY_LIST: CategoryMeta[] = CATEGORY_KEYS.map(k => CATEGORY_META[k])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run utils/categories.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add utils/categories.ts utils/categories.test.ts
git commit -m "feat(categories): add app-side expense category taxonomy"
```

---

## Task 2: Functions-side category taxonomy

**Files:**
- Create: `functions/categories.js`
- Test: `functions/categories.test.js`

> The functions package is a separate CommonJS npm package; it cannot import `utils/categories.ts`. This module mirrors the key list. If keys ever change, change BOTH files.

- [ ] **Step 1: Write the failing test**

Create `functions/categories.test.js`:

```js
const assert = require('node:assert')
const { test } = require('node:test')
const { CATEGORY_KEYS, coerceCategory, categoryEnum } = require('./categories')

test('CATEGORY_KEYS matches the app-side contract', () => {
  assert.deepStrictEqual(CATEGORY_KEYS, [
    'food', 'groceries', 'transport', 'lodging', 'activities', 'shopping', 'other',
  ])
})

test('coerceCategory keeps known keys and defaults the rest to other', () => {
  assert.strictEqual(coerceCategory('lodging'), 'lodging')
  assert.strictEqual(coerceCategory('FOOD'), 'other')
  assert.strictEqual(coerceCategory(''), 'other')
  assert.strictEqual(coerceCategory(undefined), 'other')
  assert.strictEqual(coerceCategory(null), 'other')
})

test('categoryEnum parses a valid key and rejects an invalid one', () => {
  assert.strictEqual(categoryEnum.parse('food'), 'food')
  assert.throws(() => categoryEnum.parse('nope'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test categories.test.js`
Expected: FAIL — cannot find module `./categories`.

- [ ] **Step 3: Write minimal implementation**

Create `functions/categories.js`:

```js
const { z } = require('zod')

// MUST stay in sync with utils/categories.ts CATEGORY_KEYS.
const CATEGORY_KEYS = [
  'food', 'groceries', 'transport', 'lodging', 'activities', 'shopping', 'other',
]

const categoryEnum = z.enum(CATEGORY_KEYS)

function coerceCategory(value) {
  return CATEGORY_KEYS.includes(value) ? value : 'other'
}

module.exports = { CATEGORY_KEYS, categoryEnum, coerceCategory }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && node --test categories.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/categories.js functions/categories.test.js
git commit -m "feat(categories): add functions-side category taxonomy"
```

---

## Task 3: Add category to the receipt analysis pipeline

**Files:**
- Modify: `functions/receiptAnalysis.js` (schema `receiptSchema` ~line 44-58; prompt `generatePrompt` rules ~line 143-216; `prepareFirestoreUpdateData` ~line 311-345)
- Test: `functions/receiptAnalysis.category.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `functions/receiptAnalysis.category.test.js`. This tests the pure `prepareFirestoreUpdateData` pass-through + coercion (no network, no Firestore writes — it returns a plain object):

```js
const assert = require('node:assert')
const { test } = require('node:test')
const { prepareFirestoreUpdateData, receiptSchema } = require('./receiptAnalysis')

test('receiptSchema includes a category field', () => {
  assert.ok('category' in receiptSchema.shape, 'receiptSchema.shape.category should exist')
})

test('prepareFirestoreUpdateData passes a valid category through', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], category: 'food', paidAtString: null, currency: 'TWD' },
    'TWD',
  )
  assert.strictEqual(out.category, 'food')
})

test('prepareFirestoreUpdateData coerces an unknown category to other', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], category: 'garbage', paidAtString: null, currency: 'TWD' },
    'TWD',
  )
  assert.strictEqual(out.category, 'other')
})

test('prepareFirestoreUpdateData defaults a missing category to other', () => {
  const out = prepareFirestoreUpdateData(
    { items: [], paidAtString: null, currency: 'TWD' },
    'TWD',
  )
  assert.strictEqual(out.category, 'other')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test receiptAnalysis.category.test.js`
Expected: FAIL — `receiptSchema.shape.category` missing and `out.category` undefined.

- [ ] **Step 3: Add `category` to the schema**

In `functions/receiptAnalysis.js`, add the import near the top (after the existing requires, ~line 11):

```js
const { categoryEnum, coerceCategory } = require('./categories')
```

In `receiptSchema` (the `z.object({ ... })` at ~line 44-58), add this field right after the `description` field (line 57):

```js
  category: categoryEnum.describe('The single best-fitting spending category for the whole receipt. food = restaurants/cafes/drinks/snacks; groceries = supermarkets/convenience stores; transport = taxi/train/flight/fuel/transit; lodging = hotels/lodging; activities = attractions/tours/tickets/entertainment; shopping = retail/clothing/souvenirs; other = anything that does not fit. Default to "other" if unsure.'),
```

- [ ] **Step 4: Add a category rule to the prompt**

In `generatePrompt` (~line 143-216), add a new rule after rule 9 (DESCRIPTION), before the `### EXAMPLE` line (~line 180):

```js
// (inside the returned template string, after rule 9)
```

Insert this text block into the template literal, immediately after the rule 9 paragraph:

```
10. **CATEGORY**
   Choose exactly ONE category for the whole receipt from: food, groceries, transport, lodging, activities, shopping, other.
   - food: restaurants, cafés, bars, drinks, snacks, prepared meals
   - groceries: supermarkets, convenience stores, raw ingredients
   - transport: taxi, train, bus, flights, fuel, parking, transit cards
   - lodging: hotels, hostels, guesthouses, Airbnb
   - activities: attractions, tours, tickets, museums, entertainment
   - shopping: retail goods, clothing, electronics, souvenirs
   - other: anything that does not clearly fit the above
   If you are unsure, use "other". Output the lowercase key only.
```

Also add `"category"` to the example JSON (~line 196-211) so the model sees the shape — add `"category": "groceries",` right after `"currency": "JPY",`.

- [ ] **Step 5: Write the category in `prepareFirestoreUpdateData`**

In `prepareFirestoreUpdateData` (~line 311-345), after the `reviewReasons` guard block (after line 331) and before the `receiptImageUrl` block, add:

```js
  // Category: coerce AI output to a known key; default to 'other'.
  firestoreUpdateData.category = coerceCategory(parsedDataFromAI.category)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd functions && node --test receiptAnalysis.category.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full functions test suite (no regressions)**

Run: `cd functions && node --test`
Expected: PASS — all existing + new tests.

- [ ] **Step 8: Commit**

```bash
git add functions/receiptAnalysis.js functions/receiptAnalysis.category.test.js
git commit -m "feat(receipt): classify category in the existing Gemini call"
```

---

## Task 4: `classifyExpense` callable (text-only) + pure helpers

**Files:**
- Create: `functions/classifyExpenseHelpers.js`
- Create: `functions/classifyExpenseHelpers.test.js`
- Create: `functions/classifyExpense.js`
- Modify: `functions/index.js`

The callable accepts `{ items: [{ id, description }] }` and returns `{ results: [{ id, category }] }`. Per-entry callers pass a single-item list. Thinking is disabled (`thinkingBudget: 0`) to minimise cost/latency — classification needs no reasoning budget.

> **Why two files:** the callable file (`classifyExpense.js`) must export ONLY the `onCall` so `index.js` can group it exactly like `reanalyzeReceipt` (client name `classifyExpense-classifyExpense`). The pure, network-free helpers live in `classifyExpenseHelpers.js` so they can be unit-tested without Firebase and without polluting the deployed function group.

- [ ] **Step 1: Write the failing test (pure helpers only — no network)**

Create `functions/classifyExpenseHelpers.test.js`:

```js
const assert = require('node:assert')
const { test } = require('node:test')
const { buildClassifyPrompt, parseClassifyResponse } = require('./classifyExpenseHelpers')

test('buildClassifyPrompt lists every category key and the input descriptions', () => {
  const prompt = buildClassifyPrompt([{ id: 'a', description: '計程車到機場' }])
  for (const key of ['food', 'groceries', 'transport', 'lodging', 'activities', 'shopping', 'other'])
    assert.ok(prompt.includes(key), `prompt should mention ${key}`)
  assert.ok(prompt.includes('計程車到機場'))
  assert.ok(prompt.includes('"id":"a"') || prompt.includes('"id": "a"'))
})

test('parseClassifyResponse coerces unknown categories and preserves ids', () => {
  const items = [{ id: 'a', description: 'x' }, { id: 'b', description: 'y' }]
  const text = JSON.stringify({ results: [
    { id: 'a', category: 'transport' },
    { id: 'b', category: 'garbage' },
  ] })
  assert.deepStrictEqual(parseClassifyResponse(text, items), [
    { id: 'a', category: 'transport' },
    { id: 'b', category: 'other' },
  ])
})

test('parseClassifyResponse fills missing ids with other', () => {
  const items = [{ id: 'a', description: 'x' }, { id: 'b', description: 'y' }]
  const text = JSON.stringify({ results: [{ id: 'a', category: 'food' }] })
  assert.deepStrictEqual(parseClassifyResponse(text, items), [
    { id: 'a', category: 'food' },
    { id: 'b', category: 'other' },
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test classifyExpenseHelpers.test.js`
Expected: FAIL — cannot find module `./classifyExpenseHelpers`.

- [ ] **Step 3: Write the pure helpers**

Create `functions/classifyExpenseHelpers.js`:

```js
const { logger } = require('firebase-functions/v2')
const { z } = require('zod')
const { CATEGORY_KEYS, categoryEnum, coerceCategory } = require('./categories')

const responseSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    category: categoryEnum,
  })),
})

/**
 * Build the classification prompt for a list of {id, description}.
 * @param {Array<{id: string, description: string}>} items
 * @returns {string}
 */
function buildClassifyPrompt(items) {
  const payload = items.map(it => ({ id: it.id, description: it.description }))
  return `
You are categorising travel expenses. For EACH input expense, choose exactly ONE category from this list (output the lowercase key only):
- food: restaurants, cafés, bars, drinks, snacks, prepared meals
- groceries: supermarkets, convenience stores, raw ingredients
- transport: taxi, train, bus, flights, fuel, parking, transit cards
- lodging: hotels, hostels, guesthouses, Airbnb
- activities: attractions, tours, tickets, museums, entertainment
- shopping: retail goods, clothing, electronics, souvenirs
- other: anything that does not clearly fit the above

Allowed keys: ${CATEGORY_KEYS.join(', ')}.
Descriptions may be in Traditional Chinese, English, or mixed. If unsure, use "other".
Return one result per input id, preserving the id exactly.

Input expenses (JSON):
${JSON.stringify(payload)}
`
}

/**
 * Parse the model response into a complete {id, category} list.
 * Coerces unknown categories to 'other' and fills any missing input id with 'other'.
 * @param {string} text - raw JSON text from the model
 * @param {Array<{id: string, description: string}>} items - original inputs
 * @returns {Array<{id: string, category: string}>}
 */
function parseClassifyResponse(text, items) {
  let byId = {}
  try {
    const parsed = JSON.parse(text)
    for (const r of parsed.results || []) {
      if (r && typeof r.id === 'string')
        byId[r.id] = coerceCategory(r.category)
    }
  }
  catch (err) {
    logger.error('Failed to parse classifyExpense response:', err)
    byId = {}
  }
  return items.map(it => ({ id: it.id, category: byId[it.id] ?? 'other' }))
}

module.exports = { responseSchema, buildClassifyPrompt, parseClassifyResponse }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && node --test classifyExpenseHelpers.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the callable**

Create `functions/classifyExpense.js` (mirrors `reanalyzeReceipt.js` — exports only the `onCall`):

```js
const { GoogleGenAI } = require('@google/genai')
const { logger } = require('firebase-functions/v2')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { zodToJsonSchema } = require('zod-to-json-schema')
const { responseSchema, buildClassifyPrompt, parseClassifyResponse } = require('./classifyExpenseHelpers')

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })

/**
 * Call Gemini to classify a list of expenses. Thinking disabled for cost.
 * @param {Array<{id: string, description: string}>} items
 * @returns {Promise<Array<{id: string, category: string}>>}
 */
async function classifyItems(items) {
  if (items.length === 0)
    return []
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ text: buildClassifyPrompt(items) }],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: zodToJsonSchema(responseSchema),
      thinkingConfig: { thinkingBudget: 0 },
    },
  })
  return parseClassifyResponse(result.text, items)
}

exports.classifyExpense = onCall({ region: 'us-west1' }, async (request) => {
  const items = request.data?.items
  if (!Array.isArray(items))
    throw new HttpsError('invalid-argument', 'items must be an array of { id, description }')

  // Defensive: drop malformed entries, cap list size to bound token cost.
  const clean = items
    .filter(it => it && typeof it.id === 'string' && typeof it.description === 'string' && it.description.trim())
    .slice(0, 100)

  try {
    const results = await classifyItems(clean)
    return { results }
  }
  catch (error) {
    logger.error('classifyExpense failed:', error)
    throw new HttpsError('internal', `Classification failed: ${error.message}`)
  }
})
```

- [ ] **Step 6: Register the function**

In `functions/index.js`, add after line 7:

```js
exports.classifyExpense = require('./classifyExpense')
```

- [ ] **Step 7: Verify functions still load**

Run: `cd functions && node -e "require('./index.js'); console.log('ok')"`
Expected: prints `ok` with no throw.

- [ ] **Step 8: Commit**

```bash
git add functions/classifyExpenseHelpers.js functions/classifyExpenseHelpers.test.js functions/classifyExpense.js functions/index.js
git commit -m "feat(functions): add classifyExpense text-only callable"
```

---

## Task 5: CategoryChip component + display in the expense row

**Files:**
- Create: `components/CategoryChip.vue`
- Modify: `components/ExpenseItem.vue` (template ~line 60-72)

- [ ] **Step 1: Create the chip component**

Create `components/CategoryChip.vue`:

```vue
<script setup lang="ts">
import { getCategoryMeta } from '@/utils/categories'

const props = defineProps<{
  category?: string
  // When true, render a muted placeholder for unlabeled expenses instead of the "other" chip.
  showUnlabeled?: boolean
}>()

const isUnlabeled = computed(() => !props.category)
const meta = computed(() => getCategoryMeta(props.category))
</script>

<template>
  <span
    v-if="!isUnlabeled || showUnlabeled"
    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none"
    :class="isUnlabeled ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500' : meta.chipClass"
  >
    <Icon :name="isUnlabeled ? 'lucide:tag' : meta.icon" class="h-2.5 w-2.5" />
    {{ isUnlabeled ? '未分類' : meta.label }}
  </span>
</template>
```

- [ ] **Step 2: Render the chip in the expense row**

In `components/ExpenseItem.vue`, inside the meta paragraph block, add the chip after the date/sharers line. Replace the `<div class="flex-1 min-w-0">` block (lines 61-72) so it reads:

```vue
    <!-- Description + meta -->
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-foreground m-0 line-clamp-2 leading-snug">
        {{ expense.description }}
        <Icon v-if="!expense.enabled" name="lucide:eye-off" class="w-3.5 h-3.5 text-muted-foreground inline-block align-text-top ml-0.5" />
      </p>
      <p class="text-xs text-muted-foreground m-0 mt-0.5 flex items-center gap-1.5">
        <span>
          {{ expense.paidAtObject.month }}/{{ expense.paidAtObject.day }} {{ expense.paidAtObject.hour }}:{{ expense.paidAtObject.minute }}
          <span class="mx-1">·</span>
          <span v-if="paidByMember" class="hidden lg:inline">{{ paidByMember.name }} 付款 · </span>
          {{ sharedMembers.length }}人分攤
        </span>
        <category-chip v-if="expense.category" :category="expense.category" />
      </p>
    </div>
```

- [ ] **Step 3: Verify the app builds / type-checks**

Run: `npx nuxt prepare && npx vue-tsc --noEmit` (if `vue-tsc` is unavailable, run `pnpm build` and confirm no errors referencing `CategoryChip` or `categories`).
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/CategoryChip.vue components/ExpenseItem.vue
git commit -m "feat(expense): show category chip in expense rows"
```

---

## Task 6: Category picker + display/edit on the expense detail page

**Files:**
- Create: `components/CategoryPicker.vue`
- Modify: `components/ExpenseBasicsEditDialog.vue` (state sync ~line 89-120; emit type ~line 18-25; template after Description ~line 189; `handleSave` ~line 137-165)
- Modify: `pages/trips/[tripId]/expenses/[expenseId]/index.vue` (`saveBasics` ~line 82-113)

- [ ] **Step 1: Create the picker component**

Create `components/CategoryPicker.vue`:

```vue
<script setup lang="ts">
import { CATEGORY_LIST } from '@/utils/categories'

const model = defineModel<string>({ default: '' })
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <button
      v-for="cat in CATEGORY_LIST"
      :key="cat.key"
      type="button"
      :aria-pressed="model === cat.key"
      class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
      :class="model === cat.key
        ? 'bg-primary text-primary-foreground'
        : 'bg-muted text-muted-foreground hover:text-foreground'"
      @click="model = model === cat.key ? '' : cat.key"
    >
      <Icon :name="cat.icon" class="h-3 w-3" />
      {{ cat.label }}
    </button>
  </div>
</template>
```

- [ ] **Step 2: Add category to the edit dialog state + emit + UI + save**

In `components/ExpenseBasicsEditDialog.vue`:

(a) Add a ref after line 38 (`const paidByMemberId = ref('')`):

```ts
const category = ref('')
```

(b) Extend the `save` emit payload type (lines 18-25) — add a `category` field:

```ts
  (e: 'save', payload: {
    description: string
    grandTotal: number | null
    inputCurrency: string
    exchangeRate: number
    paidAt: Date
    paidByMemberId: string
    category: string
  }): void
```

(c) In the open-sync watcher, after `paidByMemberId.value = exp.paidByMemberId` (line 101):

```ts
  category.value = exp.category ?? ''
```

(d) In `handleSave`, add `category: category.value` to the emitted object (inside the `emit('save', { ... })` call, lines 157-164):

```ts
    category: category.value,
```

(e) In the template, add a picker block right after the Description block (after line 189, before the Amount block):

```vue
        <!-- Category -->
        <div>
          <ui-label class="text-sm font-medium text-foreground">
            分類
          </ui-label>
          <category-picker v-model="category" class="mt-1.5" />
        </div>
```

- [ ] **Step 3: Persist category in `saveBasics`**

In `pages/trips/[tripId]/expenses/[expenseId]/index.vue`, the `saveBasics` payload type (lines 82-91) and the `update` object (lines 94-104) must carry category. Add `category: string` to the payload type, and after line 101 (inside the `update` object literal, after `paidAt`/`paidByMemberId` lines) add:

```ts
      category: payload.category || deleteField(),
```

`deleteField` is already imported (line 4). Storing `deleteField()` when the user clears the category keeps "unlabeled" = absent, consistent with the batch query.

- [ ] **Step 4: Show the chip on the detail page**

Still in `pages/trips/[tripId]/expenses/[expenseId]/index.vue`, render `<category-chip :category="expense.category" show-unlabeled @...>` near the description header. Locate the description heading in the template (search for `expense.description` / the basics section) and add directly beneath it:

```vue
        <button type="button" class="mt-1" @click="isEditingBasics = true">
          <category-chip :category="expense.category" show-unlabeled />
        </button>
```

This makes the chip a tap target that opens the existing basics editor (where the picker now lives). If a dedicated edit affordance already exists next to the description, place the chip beside it instead.

- [ ] **Step 5: Verify build / type-check**

Run: `npx nuxt prepare && npx vue-tsc --noEmit` (or `pnpm build`).
Expected: no errors; the `save` handler and emit payload types align (both include `category`).

- [ ] **Step 6: Commit**

```bash
git add components/CategoryPicker.vue components/ExpenseBasicsEditDialog.vue "pages/trips/[tripId]/expenses/[expenseId]/index.vue"
git commit -m "feat(expense): edit and display category on the detail page"
```

---

## Task 7: Manual-entry category picker + opt-in auto-label

**Files:**
- Modify: `components/AddExpenseDrawer.vue` (script: state, `submitManual`; templates: BOTH the desktop manual tab ~after line 637 and the mobile manual tab ~after line 1153)

The category picker + a 自動分類 toggle (default OFF) appear under the description in the manual tab. On save: the expense doc is created immediately and the drawer closes (UX stays instant); if the toggle is ON, classification runs in the background and patches the doc when it returns.

- [ ] **Step 1: Add state**

In `components/AddExpenseDrawer.vue` `<script setup>`, after `const selectedFile = ref<File | null>(null)` (line 32):

```ts
const manualCategory = ref<string>('')
const autoLabel = ref(false)
```

Add the imports needed for the background call near the top of the script (with the other imports):

```ts
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc as fsDoc, updateDoc } from 'firebase/firestore'
```

> `addDoc`, `collection`, `serverTimestamp`, `Timestamp` are already imported from `firebase/firestore` (line 6); add `doc as fsDoc` and `updateDoc` to that same import or as the separate line shown.

- [ ] **Step 2: Reset state when the drawer opens**

In the `watch(open, ...)` reset block, after `expenseItems.value = []` (line 265):

```ts
    manualCategory.value = ''
    autoLabel.value = false
```

- [ ] **Step 3: Wire category + background classify into `submitManual`**

In `submitManual` (lines 339-398), include the chosen category on the new doc and fire background classification when `autoLabel` is on. Modify the `addDoc(...)` call (lines 369-380) to capture the ref and add category, then add the background block after the drawer closes.

Replace the body from `const docRef = await addDoc(...)` through the success toast with:

```ts
    const docRef = await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), {
      ...formValues,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      exchangeRate: expenseExchangeRate.value,
      paidAt: Timestamp.fromDate(selectedDate),
      createdAt: Timestamp.fromDate(new Date()),
      isProcessing: false,
      enabled: true,
      createdByUserId: sessionUser.value?.uid,
      ...(manualCategory.value ? { category: manualCategory.value } : {}),
      ...(cleanItems.length > 0 ? { items: cleanItems } : {}),
    })

    open.value = false
    logEvent('add_expense', { method: 'manual', trip_id: props.trip.id })

    // Background auto-label: don't block the save/close. Patch the doc when it returns.
    if (autoLabel.value && formValues.description) {
      const description = formValues.description
      const tripId = props.trip.id
      void (async () => {
        try {
          const functions = getFunctions(undefined, 'us-west1')
          const classify = httpsCallable(functions, 'classifyExpense-classifyExpense')
          const res = await classify({ items: [{ id: docRef.id, description }] })
          const category = (res.data as { results?: Array<{ id: string, category: string }> })
            .results?.[0]?.category
          if (category)
            await updateDoc(fsDoc(db, 'trips', tripId, 'expenses', docRef.id), { category })
        }
        catch (err) {
          console.error('Auto-label failed:', err)
        }
      })()
    }

    toast.success('已新增支出', {
      action: {
        label: '查看支出',
        onClick: () => router.push(`/trips/${props.trip.id}/expenses/${docRef.id}`),
      },
    })
```

- [ ] **Step 4: Add the picker + toggle to the DESKTOP manual tab**

In the desktop template, immediately after the Description `ui-form-field` block (closes at line 637) and before the Items accordion (line 639), insert:

```vue
            <!-- Category + auto-label -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <ui-label class="text-sm">分類</ui-label>
                <label class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <ui-switch :model-value="autoLabel" @update:model-value="(v: boolean) => { autoLabel = v; if (v) manualCategory = '' }" />
                  自動分類
                </label>
              </div>
              <category-picker v-if="!autoLabel" v-model="manualCategory" />
              <p v-else class="text-xs text-muted-foreground">
                儲存後將自動判斷分類
              </p>
            </div>
```

- [ ] **Step 5: Add the same block to the MOBILE manual tab**

In the mobile template, immediately after the Description `ui-form-field` block (closes at line 1153) and before the Items accordion (line 1155), insert the SAME block as Step 4 (repeated verbatim — the engineer may be reading tasks out of order):

```vue
            <!-- Category + auto-label -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <ui-label class="text-sm">分類</ui-label>
                <label class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <ui-switch :model-value="autoLabel" @update:model-value="(v: boolean) => { autoLabel = v; if (v) manualCategory = '' }" />
                  自動分類
                </label>
              </div>
              <category-picker v-if="!autoLabel" v-model="manualCategory" />
              <p v-else class="text-xs text-muted-foreground">
                儲存後將自動判斷分類
              </p>
            </div>
```

- [ ] **Step 6: Verify build / type-check**

Run: `npx nuxt prepare && npx vue-tsc --noEmit` (or `pnpm build`).
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/AddExpenseDrawer.vue
git commit -m "feat(expense): manual category picker with opt-in auto-label"
```

---

## Task 8: Batch backfill button on the expenses page

**Files:**
- Create: `composables/useExpenseAutoLabel.ts`
- Modify: `pages/trips/[tripId]/expenses/index.vue` (header row ~line 145-156)

- [ ] **Step 1: Create the batch composable**

Create `composables/useExpenseAutoLabel.ts`:

```ts
import type { Expense } from '@/types'
import { doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { ref } from 'vue'
import { useFirestore } from 'vuefire'

interface ClassifyResult { results?: Array<{ id: string, category: string }> }

// Bound per-call token size; large trips run in several calls.
const CHUNK_SIZE = 50

export function useExpenseAutoLabel(tripId: string) {
  const db = useFirestore()
  const isRunning = ref(false)

  /**
   * Classify every enabled expense that has no category yet.
   * Returns the number of expenses labeled. Never overwrites an existing category.
   */
  async function runBatch(expenses: Expense[]): Promise<number> {
    const targets = expenses
      .filter(e => e.enabled && !e.category && e.description?.trim())
      .map(e => ({ id: e.id, description: e.description }))

    if (targets.length === 0)
      return 0

    isRunning.value = true
    let labeled = 0
    try {
      const functions = getFunctions(undefined, 'us-west1')
      const classify = httpsCallable<{ items: typeof targets }, ClassifyResult>(
        functions,
        'classifyExpense-classifyExpense',
      )

      for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE)
        const res = await classify({ items: chunk })
        const results = res.data.results ?? []
        await Promise.all(results.map(async (r) => {
          if (!r.category)
            return
          await updateDoc(doc(db, 'trips', tripId, 'expenses', r.id), { category: r.category })
          labeled += 1
        }))
      }
    }
    finally {
      isRunning.value = false
    }
    return labeled
  }

  return { isRunning, runBatch }
}
```

- [ ] **Step 2: Wire the button into the expenses page header**

In `pages/trips/[tripId]/expenses/index.vue` `<script setup>`, after the existing data hooks (after line 40 `const { tripMembers } = useTripMembers(...)`), add:

```ts
const { isRunning: isAutoLabeling, runBatch } = useExpenseAutoLabel(tripId as string)
const unlabeledCount = computed(() =>
  enabledExpenses.value.filter(e => !e.category && e.description?.trim()).length,
)

async function handleAutoLabel() {
  if (unlabeledCount.value === 0) {
    toast.info('沒有未分類的支出')
    return
  }
  try {
    const n = await runBatch(enabledExpenses.value)
    toast.success(`已自動分類 ${n} 筆支出`)
  }
  catch (error) {
    console.error('Batch auto-label failed:', error)
    toast.error('自動分類失敗')
  }
}
```

Add the toast import at the top of the script:

```ts
import { toast } from 'vue-sonner'
```

- [ ] **Step 3: Add the button to the header row**

In the same file, replace the header row's right-hand control group (the `<div class="flex items-center gap-2">` at lines 150-155 containing the show-hidden switch) with:

```vue
      <div class="flex items-center gap-3">
        <ui-button
          v-if="unlabeledCount > 0"
          type="button"
          variant="outline"
          size="sm"
          class="h-7 text-xs"
          :disabled="isAutoLabeling"
          @click="handleAutoLabel"
        >
          <Icon
            :name="isAutoLabeling ? 'lucide:loader-circle' : 'lucide:sparkles'"
            class="mr-1 h-3 w-3"
            :class="{ 'animate-spin': isAutoLabeling }"
          />
          自動分類 ({{ unlabeledCount }})
        </ui-button>
        <div class="flex items-center gap-2">
          <ui-label for="show-hidden" class="text-xs">
            顯示隱藏
          </ui-label>
          <ui-switch id="show-hidden" :model-value="showHiddenExpenses" @update:model-value="showHiddenExpenses = !showHiddenExpenses" />
        </div>
      </div>
```

- [ ] **Step 4: Verify build / type-check**

Run: `npx nuxt prepare && npx vue-tsc --noEmit` (or `pnpm build`).
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add composables/useExpenseAutoLabel.ts "pages/trips/[tripId]/expenses/index.vue"
git commit -m "feat(expense): batch auto-label button for unlabeled expenses"
```

---

## Final verification

- [ ] **Run all functions tests**

Run: `cd functions && node --test`
Expected: PASS (categories, receiptAnalysis.category, classifyExpenseHelpers + any pre-existing).

- [ ] **Run all app tests**

Run: `pnpm test -- --run`
Expected: PASS (categories).

- [ ] **Lint**

Run: `npx eslint . --fix`
Expected: no remaining errors in the changed files.

- [ ] **Manual smoke (real app, optional but recommended)**

Use the `verify` / `run` skill or `pnpm dev`:
1. Upload a receipt → expense gets a category chip after processing.
2. Add a manual expense with 自動分類 ON → chip appears shortly after save (background classify).
3. Add a manual expense with 自動分類 OFF + a picked category → that category sticks.
4. With existing unlabeled expenses present, click 自動分類 (N) in the expenses header → they get chips; the count drops to 0 and the button disappears.
5. Edit an expense's category in the basics dialog → it persists; clearing it returns the row to 未分類 and re-enables the batch button.

---

## Notes / guardrails recap

- **Cost:** receipts add only `category` to a call you already pay for. `classifyExpense` is text-only with `thinkingBudget: 0`; the batch sends up to 50 expenses per call.
- **No overwrite:** batch and the receipt/edit paths only ever set a category when one is chosen/derived; the batch filters on `!e.category`, so manual choices are never clobbered.
- **Unlabeled = absent:** clearing a category writes `deleteField()`, keeping the "未分類" state and the batch query consistent.
- **Sync contract:** `CATEGORY_KEYS` is duplicated in `utils/categories.ts` and `functions/categories.js`; their tests both assert the same 7-key list, so a drift breaks a test.
```
