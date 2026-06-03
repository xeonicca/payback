# Robust Receipt Extraction — Design

**Status:** Draft
**Date:** 2026-05-14
**Owner:** Steve Yu
**Touches:** `functions/receiptAnalysis.js`, `functions/onReceiptUploaded.js`, `functions/reanalyzeReceipt.js`, `types/index.ts`, `utils/converter.ts`, expense edit page

## Goal

Make AI receipt extraction reliable enough that the user almost never has to fix the AI's output, and when the AI is wrong, the UI tells them exactly where.

## Non-Goals

- Replacing Gemini with a different vendor.
- Rebuilding the receipt-upload UX (drawer, image cropping, etc.).
- Building a manual OCR fallback path.
- Backfilling old expenses with the new schema (new fields are nullable; legacy docs keep working).

## Problem Evidence

A pass over the 20 most-recent expenses (`functions/inspect-recent-receipts.js`) surfaced these distinct failure modes:

1. **Multi-line item names get truncated.** Receipts wrap long product names across two physical lines. The model treats only the first line as the name, dropping the suffix.
   *Examples:* `"おひなたみかん 12"` (likely `12個入`), `"すっきりみかんゼ"` → `ゼリー`, `"紅まどんなグミ("` (unmatched paren), `"青のり入川えびせ"` → `えびせんべい`.

2. **Barcodes leak into `translatedName`.** The 餅屋 receipt placed JAN codes (e.g., `4524541000672`) next to item names; the model used them as translations.

3. **`currency` field is wrong** on multi-country trips. Several IDR receipts (Apurva Kempinski Bali, Indomaret) saved with `currency: "TWD"`. The model is echoing `Receipt Region Currency: ${tripCurrency}` from the prompt context instead of reading the receipt.

4. **Tax / service / discount / freebies extracted as items.** `"SC Total"`, `"Tax Total"`, `"Phí dịch vụ (3%)"`, `"VOUCHER"` (negative price), `"Khăn lạnh miễn phí"` (qty=2, price=0). Math still adds up because everything ends up summing to grandTotal, but it pollutes the per-item breakdown and breaks per-item splitting.

5. **Math mismatch from quantity error.** Apurva Kempinski expense: `grandTotal: 726000` vs `itemsSum: 1686000`. Model wrote `qty=3` for the first item when the true quantity was 1. Nothing in the current pipeline catches this — `sanitizeItemPrices` only flags `price > grandTotal`.

6. **Cross-language hallucination.** Cyrillic `"піна F/T SP"` appeared in a Japanese receipt.

7. **No way to detect missed items.** Japanese receipts almost always print `点数: N` / `合計点数 N`. Currently nothing uses it.

## Approach

Four layers of defense, applied in order. Each layer is independently valuable:

1. **Schema redesign** — give the model dedicated places to put non-item totals so it stops cramming them into `items[]`.
2. **Prompt rewrite** — explicit rules for the failure modes above, plus one worked example.
3. **Server-side reconciliation** — verify math and item-count against the receipt's own printed totals; flag mismatches.
4. **Model upgrade** — `gemini-2.0-flash` → `gemini-2.5-flash` with thinking enabled.

---

## Section 1 — Schema Redesign

### New top-level fields on `receiptSchema`

| Field | Type | Why |
|---|---|---|
| `subtotal` | `number \| null` | Pre-tax/service amount printed on the receipt (e.g., `小計`). Used for reconciliation. |
| `taxAmount` | `number \| null` | Tax line(s) summed (`内税` / `外税` / `消費税` / VAT). |
| `serviceCharge` | `number \| null` | Service-charge line (e.g., `Phí dịch vụ`, `Service`). |
| `discount` | `number \| null` | Sum of discounts/vouchers/promotions. **Stored as a positive number** representing the amount deducted. |
| `tip` | `number \| null` | Gratuity if printed. |
| `printedItemCount` | `number \| null` | The receipt's own total-item-count line (`点数`, `合計点数`, `Qty Total`). Used to cross-check `sum(item.quantity)`. |

All fields are `nullable` — model returns `null` if not printed.

### Changes to `expenseItemSchema`

| Field | Change | Why |
|---|---|---|
| `price` | unchanged (unit price) | |
| `quantity` | unchanged | |
| `lineTotal` | **NEW**: `number \| null` | The line-total printed on the receipt for this item. Lets us verify `price * quantity ≈ lineTotal` per item, not just whole-receipt. |
| `itemNumber` | **NEW**: `string \| null` | Receipt-printed identifier next to the item: serial/line number (`1.`, `001`), product code, SKU, JAN/EAN/UPC barcode (`#A201`, `4524541000672`). Stored separately so `name` stays a clean searchable product name and so the UI can render the identifier as a small secondary line. |
| `name` | description rewritten: (a) handle line wrapping; (b) **no longer carries the identifier prefix** — that moves to `itemNumber`. | The current "keep identifiers in name" rule muddies search and translation (we already saw barcodes leak into `translatedName`). |
| `translatedName` | description rewritten to forbid barcodes/codes/IDs (see Section 2). No longer expected to preserve the identifier prefix. | |

We deliberately do **not** add a per-item confidence field — it adds complexity for marginal benefit, and our reconciliation flags + the existing edit UI cover the same ground.

### `currency` constraint

Change from free-form `z.string()` to `z.enum([...])` listing every currency in `timezoneMap`. This forces the model to pick one of {JPY, USD, EUR, GBP, …} and rejects malformed output.

### New result field for the orchestration layer

`prepareFirestoreUpdateData` will compute and write:

| Firestore field | Type | Set when |
|---|---|---|
| `needsReview` | `boolean` | Any reconciliation check failed |
| `reviewReasons` | `string[]` | Machine-readable codes for what failed (see Section 3) |

These two are **server-side derived**, not in `receiptSchema`. They never come from the model.

### Type updates

`types/index.ts` Expense type gains the optional fields. `utils/converter.ts` `expenseConverter` reads them with `??` defaults so legacy docs keep working.

---

## Section 2 — Prompt Rewrite

The new prompt is structured as: context → schema-level rules → forbidden-line list → one worked example.

Key additions and changes vs. today's prompt:

**1. Multi-line item names.**
> "Receipt items often span two physical lines: the product name on line 1, then a continuation (size, weight, pack count, flavor) on line 2 followed by the price. Treat both lines as one item; concatenate them with a single space into `name`. The `price`, `quantity`, and `lineTotal` belong to the last line of the group. Example: `青のり入川えびせ\n  んべい  2  1100  2200` → name `'青のり入川えびせんべい'`, qty 2, price 1100, lineTotal 2200."

**2. Forbidden item lines.**
> "Do NOT put any of these in `items[]`: subtotal/小計, tax/税/VAT, service charge, tip, discount/voucher/promotion, change due, points/loyalty, store header/footer messages, free promotional items printed at ¥0. Tax, service, discount, and tip go in their dedicated top-level fields. Subtotal goes in `subtotal`. Everything else: omit."

**3. Currency is detected from the receipt.**
> "Determine `currency` from the receipt itself (symbols ¥/$/€/Rp/₫, currency codes, formatting). The `Receipt Region Hint` below is what we expect but **not** authoritative — override it if the receipt clearly shows a different currency."

The context line is renamed `Receipt Region Hint:` to defuse the anchoring effect.

**4. Translation rules clarified.**
> "`translatedName` is a human-language translation. NEVER use a barcode, JAN/EAN/UPC code, SKU, or numeric product ID as a translation. If you cannot produce a meaningful translation (e.g., a proprietary product name), repeat the original `name` exactly."

**5. `printedItemCount` instruction.**
> "If the receipt prints a total item count (`点数`, `合計点数`, `Qty Total`, `Items: N`), extract it as `printedItemCount`. Otherwise null. This is the receipt's own item-count field — do not invent it from `items.length`."

**6. `lineTotal` instruction.**
> "For each item, also output `lineTotal`: the line-total printed on the receipt for that item (the rightmost amount on the line, equal to `price * quantity`). If only one amount is printed and quantity is 1, `lineTotal === price`."

**7. `itemNumber` instruction.**
> "If the receipt prints any identifier alongside the item — a line/serial number (`1.`, `001`), product code, SKU, or full barcode (JAN/EAN/UPC, e.g. `4524541000672`) — extract it into `itemNumber` and EXCLUDE it from `name`. `name` should contain only the human product name. If no identifier is printed, `itemNumber` is `null`. Examples: `1. ペプシコーラ` → `itemNumber: '1'`, `name: 'ペプシコーラ'`. `#A201 Pasta` → `itemNumber: 'A201'`, `name: 'Pasta'`. `4524541000672 青のり入川えびせんべい` → `itemNumber: '4524541000672'`, `name: '青のり入川えびせんべい'`."

**8. Worked example.**
A single-paragraph "here's what a receipt looks like and the JSON we want" example, including at least one item with an `itemNumber` and one with a multi-line wrapped name. One example, not a bilingual pair — Gemini's structured-output adheres better to in-context examples than to abstract rules.

### Prompt size budget

Today's prompt is ~50 lines. The rewrite lands around 100–120 lines including the worked example. Well under context limits and irrelevant for cost — image tokens dominate.

---

## Section 3 — Server-Side Reconciliation

After `analyzeReceiptWithAI` returns, replace today's single-check `sanitizeItemPrices` with a `reconcileReceipt(parsedData, tripCurrency)` function that runs the following checks in order. Each check that fails appends a code to `reviewReasons`.

Reason codes are classified as either **warning** or **info**. `needsReview = true` is set only when at least one *warning* code is appended; info codes track auto-corrections without forcing user review.

**Check 1 — Per-item line-total consistency.**
For each item with non-null `lineTotal`:
- If `quantity > 1` and `|price - lineTotal| ≤ 0.01 * lineTotal` — i.e. the model wrote the line total into the unit-price slot (today's known mistake pattern) — auto-correct: `price = round(lineTotal / quantity, 2)`. Append info code `item_unit_price_corrected`.
- Else if `|price * quantity - lineTotal| > 0.02 * lineTotal` — genuine mismatch — append warning code `item_line_total_mismatch`. Do not auto-correct.

**Check 2 — Whole-receipt math.**
Compute
```
expected = sum(items.lineTotal ?? price * quantity)
         + (taxAmount ?? 0)
         + (serviceCharge ?? 0)
         + (tip ?? 0)
         - (discount ?? 0)
```
If `|expected - grandTotal| > max(1, 0.02 * grandTotal)` (i.e. 2% or 1 currency unit, whichever is larger — handles rounding on small totals): flag `grand_total_mismatch`. Do not auto-correct — let the user resolve.

**Check 3 — Item count cross-check.**
If `printedItemCount != null` and `printedItemCount !== sum(item.quantity ?? 1)`: flag `item_count_mismatch`. Common cause: a wrapped item that the model collapsed into a single line (qty 1 when it should be 2), or vice versa.

**Check 4 — Currency sanity.**
If `currency != null` and `currency !== tripCurrency`: flag `currency_unexpected`. Don't override — the receipt may legitimately be in a different currency than the trip (e.g., transit through a layover), but the user should see the flag.

**Check 5 — Subtotal sanity.**
If `subtotal != null`, verify `|sum(items.lineTotal) - subtotal| ≤ max(1, 0.02 * subtotal)`. Flag `subtotal_mismatch` otherwise. This catches "model added a phantom item" or "model missed an item" without needing `printedItemCount`.

All flags are advisory — none of them block the expense from being saved. They feed the UI in Section 4.

### UI surfacing — scope for this spec

Minimum viable: in the expense edit page (`pages/trips/[tripId]/expenses/[expenseId]/edit.vue`), if `needsReview` is true, show a banner above the items list that lists the human-readable form of each `reviewReason`. No per-item highlighting in v1 — that's a follow-up.

Reason-code → message map (Traditional Chinese, since users are Taiwanese):

| Code | Tone | Message |
|---|---|---|
| `grand_total_mismatch` | warning | `項目金額加總與收據總計不符，請檢查` |
| `item_count_mismatch` | warning | `項目數量與收據上的點數不一致` |
| `subtotal_mismatch` | warning | `項目加總與小計不符` |
| `item_line_total_mismatch` | warning | `部分項目的單價 × 數量與該行金額不符` |
| `currency_unexpected` | warning | `偵測到的貨幣與此次行程貨幣不同` |
| `item_unit_price_corrected` | info | `已自動修正單價（原值疑似為小計）` |

Banner shows only when at least one warning code is present. Info codes are recorded in `reviewReasons` for debugging/telemetry but don't trigger the banner or set `needsReview`.

### `itemNumber` rendering

Wherever an item row is rendered (`components/ExpenseDetailItem.vue` and the items list on `pages/trips/[tripId]/expenses/[expenseId]/index.vue` / `edit.vue`), when `item.itemNumber` is non-null and non-empty, display it as a small muted prefix or label adjacent to the item name — e.g., `<span class="text-xs text-muted-foreground font-mono mr-2">{{ item.itemNumber }}</span>`. Exact placement follows existing layout; the point is the identifier is visible but visually secondary. No `itemNumber`-related reconciliation check is added.

---

## Section 4 — Model Upgrade

Change `model: 'gemini-2.0-flash'` → `model: 'gemini-2.5-flash'` with thinking enabled (via `config.thinkingConfig: { thinkingBudget: -1 }` per Google Gen AI SDK).

Rationale: line-wrap detection, currency disambiguation, and "is this a tax line or a real item" are visual + reasoning tasks. 2.5-flash with thinking is materially better at this class of task. The latency hit (~2–4s extra per receipt) is acceptable for a flow that already shows `isProcessing: true`.

If thinking + 2.5 turns out to cost more than acceptable in prod, fall back to `gemini-2.5-flash` *without* thinking — still better than 2.0-flash on extraction.

---

## Data Flow (end-to-end after changes)

```
Receipt upload (Firebase Storage)
  → onReceiptUploaded trigger
    → getImageAsBase64
    → analyzeReceiptWithAI (gemini-2.5-flash + thinking)
      → returns expanded schema (items[name,itemNumber,price,quantity,lineTotal] + subtotal + tax + service + discount + tip + printedItemCount)
    → reconcileReceipt(parsedData, tripCurrency)
      → runs 5 checks, accumulates reviewReasons
      → applies item_unit_price_corrected fix in place
    → prepareFirestoreUpdateData
      → writes new fields + needsReview + reviewReasons
  → Expense doc updated with isProcessing:false

Expense edit page
  → reads needsReview, reviewReasons
  → shows banner with reason messages if any warning-tone reason present
```

---

## Testing Strategy

**Unit tests** (new):
- `functions/__tests__/reconcile.test.js` — table-driven. One case per reason code: a fixture parsedData that should/shouldn't trigger that code. Cover the 2% / 1-unit tolerance edge.
- Reuse Vitest pattern from `utils/discount.test.ts` / `utils/tax.test.ts`.

**Regression test against real receipts** (new, manual but scripted):
- Extend `functions/inspect-recent-receipts.js` into `functions/regression-receipts.js` that:
  1. Pulls the same 20 receipts.
  2. Downloads each receipt image from GCS.
  3. Re-runs `analyzeReceiptWithAI` (new prompt + new model) against each.
  4. Prints a diff: per-receipt, how many items changed, did `needsReview` flip, did the truncation cases (餅屋 et al.) now contain the full names, did the currency get fixed on the Bali ones.
- Manual review of the output before declaring the change shippable.
- Run cost is bounded: 20 receipts × ~$0.005 each ≈ $0.10.

**Schema migration safety:**
- Old expense docs lack the new fields. `expenseConverter` defaults them to `null`. UI banner only renders when `needsReview === true`, so old docs render unchanged.

---

## Roll-out

1. Land schema + prompt + reconciliation behind no flag — function is server-side and only affects newly-uploaded receipts.
2. Run regression script before merge; eyeball results.
3. Ship. Monitor `processingError` and `reviewReasons` distribution for a week.
4. If `needsReview` rate exceeds ~25% of receipts, revisit prompt — likely a check is too strict.

---

## Open Questions

None blocking. Things explicitly deferred to follow-up specs:
- Per-item highlighting in the edit UI (which specific item failed `item_line_total_mismatch`).
- Optional second-pass verification (Plan C from earlier brainstorm) if 2.5-flash + reconciliation still misses cases.
- Merging duplicate-item lines in the UI (the "three identical 青のり入" cases).
