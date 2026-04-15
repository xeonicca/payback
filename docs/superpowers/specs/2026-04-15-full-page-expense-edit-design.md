# Full-Page Expense Edit Route

## Problem

The current `EditExpenseForm.vue` is rendered inside a bottom drawer on mobile and a centered dialog on desktop. The form has many fields — description, amount, currency toggle, exchange rate, date, payer, shared members, and a variable-length items list (each with name/price/quantity/translation/per-item sharing). On mobile this exceeds the comfortable space for a bottom sheet, forcing excessive scrolling within a constrained viewport.

## Decision Summary

- Replace dialog/drawer with a dedicated full-page route on **all platforms** (no mobile/desktop branching)
- Route: `/trips/:tripId/expenses/:expenseId/edit`
- Sticky bottom action bar with primary "儲存變更" and secondary "取消"
- Detail page's "編輯" dropdown item navigates to the edit route
- Cancel returns to the detail page via `router.back()`
- After save, navigate back to detail page
- Single-column layout (no desktop two-column split)
- Delete `components/EditExpenseForm.vue` — form logic moves into the page

## Routing & Navigation

### New route

`pages/trips/[tripId]/expenses/[expenseId]/edit.vue`

Uses the existing `default-with-bottom-bar` layout and `auth` middleware:

```typescript
definePageMeta({
  middleware: ['auth'],
  layout: 'default-with-bottom-bar',
})
```

### Detail page changes

`pages/trips/[tripId]/expenses/[expenseId].vue`:

- Remove `EditExpenseForm` import and the `<edit-expense-form>` block
- Remove `showEditDialog` ref
- Change "編輯" dropdown item from `@click="showEditDialog = true"` to a `nuxt-link` (or `navigateTo`) targeting the edit route

### Save / cancel flow

- Save: write to Firestore, toast success, `router.back()` to return to detail
- Cancel: `router.back()` (no confirmation, dirty state is discarded)

## Page Structure

```
┌─────────────────────────────────┐
│ ← 上一頁                        │  back link (existing pattern)
├─────────────────────────────────┤
│ 編輯支出                        │  page title
│                                 │
│ 支出描述                        │
│ [textarea]                      │
│                                 │
│ 支出金額          [改用 TWD]    │
│ [JPY] [____________]            │
│ ≈ TWD 123.45 (1 JPY = [0.23] TWD) │
│                                 │
│ 支出日期                        │
│ [date picker]                   │
│                                 │
│ 付款人          平分成員        │
│ ○ Steve         ☑ Steve         │
│ ○ Michelle      ☑ Michelle      │
│ ...                             │
│                                 │
│ 購買明細             [+ 新增]   │
│ [item 1: name, price, qty, ...] │
│ [item 2: name, price, qty, ...] │
│                                 │
│ (scrollable)                    │
├─────────────────────────────────┤
│ [        儲存變更        ]      │  sticky bottom
│           取消                  │
└─────────────────────────────────┘
```

The page content scrolls naturally beneath the sticky bottom bar. Bottom bar uses `pb-safe` for iOS safe area.

## Permissions

- Use `useTripCollaborators` to check `canEditExpense(expense)`
- If user lacks permission, show toast and redirect to detail page after data loads (mirrors existing detail page error handling)

## Form Logic

All current logic from `EditExpenseForm.vue` moves into the page unchanged:

- Currency selection (`currencyOverride`, `selectedCurrency`, `useHomeCurrency`)
- Exchange rate state (`exchangeRateOverride`, `expenseExchangeRate`)
- Conversion functions (`convertToTripCurrency`, `convertToHomeCurrency`)
- Items management (`addItem`, `removeItem`, `updateItem`, `updateItemSharing`)
- `onSubmit` writes to Firestore via `updateDoc`
- Reactive sync of `grandTotal` from `calculatedTotal` (item totals)

The exchange rate input remains inline in the conversion preview (existing inline pattern).

## File Changes

1. **Create** `pages/trips/[tripId]/expenses/[expenseId]/edit.vue` — contains the form, loads `expense`/`trip`/`tripMembers`, handles save/cancel
2. **Delete** `components/EditExpenseForm.vue`
3. **Modify** `pages/trips/[tripId]/expenses/[expenseId].vue`:
   - Remove `EditExpenseForm` import (line 9)
   - Remove `showEditDialog` ref (line 42)
   - Replace "編輯" dropdown item handler with navigation to edit route
   - Remove the `<edit-expense-form>` block (lines 460-468)

## Out of Scope

- No changes to `AddExpenseDrawer` (add stays as a drawer/dialog)
- No multi-step wizard
- No inline editing on the detail page
- No "discard changes?" confirmation dialog (cancel discards silently)
- No autosave or draft persistence
