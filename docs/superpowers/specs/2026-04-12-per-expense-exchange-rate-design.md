# Per-Expense Exchange Rate

## Problem

The app currently uses a single trip-level exchange rate for all currency conversions. On longer trips, exchange rates fluctuate, and users may get different rates at different ATMs or payment methods. Users need the ability to capture the actual exchange rate per expense for accurate tracking.

## Decision Summary

- Each expense stores its own `exchangeRate` field, snapshotted at creation time
- The add/edit form fetches the latest rate from the existing CDN API and pre-fills it
- Users can manually override the rate per expense
- Trip-level `exchangeRate` remains as the seed/fallback value
- Existing expenses without the field fall back to `trip.exchangeRate`
- No changes to trip creation flow or the two-currency model (trip currency + home currency)

## Data Model Changes

### Expense type

Add one field:

```typescript
exchangeRate: number // rate from trip currency to home currency
```

### Trip type

No changes. `trip.exchangeRate` remains as:
- Fallback for expenses missing their own rate (backfill)
- Seed value when the rate API is unavailable

### Firestore converter

`expenseConverter` includes `exchangeRate` in serialization/deserialization. No migration needed — missing values fall back to trip rate at display time.

## Rate Fetching

### New composable: `useExchangeRate`

```
useExchangeRate(tripCurrency, defaultCurrency) → { rate, isLoading, error }
```

- Fetches latest rate from `@fawazahmed0/currency-api` (same CDN already used in trip creation)
- Returns the fetched rate, loading state, and error state
- Caller provides fallback (trip-level rate) if fetch fails

### When fetching happens

- **Add expense form opens** → fetch latest rate, pre-fill the exchange rate field
- **Edit expense form opens** → show the expense's stored rate (do not re-fetch unless user requests)

## Form Changes

### AddExpenseDrawer

- Add an exchange rate input field, pre-filled with fetched rate (or trip rate on failure)
- Show conversion preview: `1 {tripCurrency} = {rate} {defaultCurrency}`
- On save, store `exchangeRate` on the expense document
- Field is collapsible or secondary — most users won't need to touch it

### EditExpenseForm

- Show the expense's stored `exchangeRate` in the same input field
- User can edit it; saved on form submit
- No auto-refetch — the stored rate is the source of truth for existing expenses

## Display & Calculation Changes

### Conversion logic

All home-currency conversions use `expense.exchangeRate ?? trip.exchangeRate` instead of `trip.exchangeRate`:

- **ExpenseItem component** — per-expense conversion for list display
- **Expense detail page** — member splits, item breakdowns
- **Charts page** — daily/member/hourly breakdowns

### useCurrencyToggle

`toPrimary()` and `toSecondary()` accept an optional `exchangeRate` parameter:

```typescript
toPrimary(amount: number, exchangeRate?: number): number
toSecondary(amount: number, exchangeRate?: number): number
```

When provided, uses the expense-level rate. Falls back to trip rate otherwise.

### Balance calculations (useTripBalances)

No changes needed. All balance/settlement logic operates in trip currency (`grandTotal`). Currency conversion only happens at the display layer.

### Home currency totals

When displaying totals in home currency, sum each expense individually:

```
total = Σ (expense.grandTotal * expense.exchangeRate)
```

This replaces the current approach of converting the trip-currency total with a single rate.

## Scope Exclusions

- No historical rate API — only fetches latest rates
- No per-item exchange rates — rate is per expense, not per line item
- No changes to trip creation or trip-level settings
- No migration script — graceful fallback handles existing data
