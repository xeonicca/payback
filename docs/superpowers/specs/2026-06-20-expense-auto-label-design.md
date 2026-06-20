# Design: Auto-labeling expenses with categories

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Goal

Automatically assign a category label to each expense, in a cost-efficient
way. Receipts already cost money to process (Gemini vision call), so labeling
must not add a second expensive call. Categories are user-editable.

## Core cost insight

The app already makes exactly one `gemini-2.5-flash` call per uploaded receipt
(`functions/receiptAnalysis.js`) that returns structured JSON. The `Expense`
type already has an unused optional `category` field (`types/index.ts:80`).

- **Receipts:** add `category` to the existing schema/prompt. The label rides
  the call we already pay for — marginal cost is a few output tokens (one word).
  A separate classification call would roughly double per-receipt cost; folding
  it in adds ~nothing.
- **Manual entries:** no image, so a *text-only* `gemini-2.5-flash` call on the
  description is dramatically cheaper than a receipt call (no image input).
- **Batch backfill:** one text call classifies a whole list of expenses, so
  cost per expense is minimal and existing unlabeled data gets fixed.

## Category set (fixed enum)

Store a stable English enum key; display a localized zh-TW label.

| Enum key | 顯示 (zh-TW) | Covers |
|---|---|---|
| `food` | 餐飲 | Restaurants, cafés, drinks, snacks |
| `groceries` | 超市雜貨 | Supermarkets, convenience stores |
| `transport` | 交通 | Taxi, train, flights, fuel, transit |
| `lodging` | 住宿 | Hotels, Airbnb |
| `activities` | 活動娛樂 | Attractions, tours, tickets, entertainment |
| `shopping` | 購物 | Retail, souvenirs, clothing |
| `other` | 其他 | Anything that doesn't fit |

`other` is the safe fallback so the model never forces a bad fit. Missing/empty
`category` means "unlabeled" (displayed as 未分類), and drives the batch query.

## Components

### 1. Shared category module — `utils/categories.ts`

Single source of truth, used by the Gemini schema, the Vue UI, and the batch
function:

- The ordered list of enum keys.
- zh-TW display label per key.
- Lucide icon name + color per key (for the display chip).
- A `coerceCategory(value)` helper that maps any unknown/invalid value to
  `other`.

> Note: Cloud Functions (`functions/`) may not import from the app's `utils/`
> directly depending on the build setup. If so, mirror the key list + labels in
> a small `functions/categories.js` and keep the two in sync (the enum keys are
> the contract). Implementation plan to confirm the import boundary.

### 2. Receipt path (free) — `functions/receiptAnalysis.js`

- Add `category` (enum of the 7 keys) to `receiptSchema`.
- Add one short rule block to `generatePrompt(...)`: pick the single best-fitting
  category for the receipt as a whole; default to `other` if unsure.
- `prepareFirestoreUpdateData` writes `category` alongside existing fields,
  passing it through `coerceCategory`.
- `reanalyzeReceipt` inherits this automatically (same pipeline).

### 3. Manual per-entry (opt-in) — new callable + `AddExpenseDrawer.vue`

- New callable Cloud Function `classifyExpenseText`:
  - Text-only `gemini-2.5-flash` (no image input).
  - Accepts either a single description string **or** a list
    `[{ id, description }]`; returns `category` / `[{ id, category }]`.
  - Same enum, tiny prompt, output coerced via `coerceCategory`.
- In `AddExpenseDrawer.vue` manual tab:
  - An opt-in toggle **自動分類**, **default OFF**.
  - The category field is a normal editable `<ui-select>` populated from the
    shared module; manual selection always allowed.
  - On save with the toggle ON: call `classifyExpenseText` with the description
    and store the returned category. With the toggle OFF: store whatever the
    user picked (or empty).

### 4. Batch backfill — `classifyExpenseText` (list mode) + trip header button

- A **自動分類未分類項目** button in the **trip expenses page header**.
- On click: gather all `enabled` expenses in the trip where `category` is empty,
  send them to `classifyExpenseText` in list mode (chunked, e.g. 50/call, to
  bound token size), write the returned categories back to Firestore.
- Only touches expenses with an empty category — never overwrites a user's
  manual choice or an existing label.

### 5. UI display & editing

- Category rendered as a small colored chip (icon + zh-TW label) on expense rows
  and the expense detail view. Quiet/secondary styling — amounts stay dominant
  (per the project design principles).
- Editable via `<ui-select>` in add/edit expense forms.
- Manual change always wins and is never overwritten by a later batch run
  (batch only fills empty categories).

## Data flow

- **Receipt:** upload → existing Gemini call now also returns `category` →
  reconcile → `prepareFirestoreUpdateData` writes `category` → Firestore.
- **Manual (toggle on):** save → `classifyExpenseText(description)` → store
  category on the new expense doc.
- **Batch:** button → query empty-category expenses → `classifyExpenseText(list)`
  (chunked) → write categories back.

## Error handling & guardrails

- Model returns invalid/unknown value → `coerceCategory` → `other`.
- Batch with zero unlabeled expenses → no call made.
- `classifyExpenseText` failure → category left empty, no blocking error
  (labeling is non-critical; receipt/expense save still succeeds).
- Batch chunked to bound per-call token size on large trips.

## Testing

- Unit: `coerceCategory` validation; reconcile still passes with the new field;
  batch chunking + "skip non-empty" logic.
- Mirror the existing `functions/validate-*.js` script pattern for a quick
  classification sanity check over sample descriptions/receipts.

## Out of scope (YAGNI)

- Per-category spending breakdowns / charts.
- Filtering or grouping the expense list by category.
- User-customizable category sets.
- Multi-language category display beyond zh-TW.
