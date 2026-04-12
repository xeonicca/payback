# Per-Expense Exchange Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store an exchange rate on each expense so conversions use per-expense rates instead of a single trip-level rate.

**Architecture:** Add `exchangeRate` field to Expense type. Create a `useExchangeRate` composable to fetch latest rates from the CDN API. Update forms to pre-fill and save per-expense rates. Update all display components and the currency toggle composable to accept per-expense rates.

**Tech Stack:** Vue 3, Nuxt 3, TypeScript, Firestore, VueFire, vee-validate

---

### Task 1: Add `exchangeRate` to Expense type and Firestore converter

**Files:**
- Modify: `types/index.ts:74-88` (NewExpense interface)
- Modify: `utils/converter.ts:66-97` (expenseConverter)

- [ ] **Step 1: Add `exchangeRate` field to `NewExpense` interface**

In `types/index.ts`, add the field after `inputCurrency`:

```typescript
exchangeRate?: number // Exchange rate from trip currency to home currency at time of expense
```

- [ ] **Step 2: Add `exchangeRate` to `expenseConverter.fromFirestore`**

In `utils/converter.ts`, inside the `expenseConverter.fromFirestore` return object, add after the `inputCurrency` line:

```typescript
exchangeRate: data.exchangeRate,
```

- [ ] **Step 3: Commit**

```bash
git add types/index.ts utils/converter.ts
git commit -m "feat: add exchangeRate field to Expense type and converter"
```

---

### Task 2: Create `useExchangeRate` composable

**Files:**
- Create: `composables/useExchangeRate.ts`

- [ ] **Step 1: Create the composable**

Create `composables/useExchangeRate.ts`:

```typescript
interface TwdCurrency {
  twd: Record<string, number>
}

export function useExchangeRate(
  tripCurrency: MaybeRef<string>,
  defaultCurrency: MaybeRef<string>,
  fallbackRate: MaybeRef<number>,
) {
  const rate = ref(toValue(fallbackRate))
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  async function fetchRate() {
    const tc = toValue(tripCurrency)
    const dc = toValue(defaultCurrency)

    // Same currency — rate is always 1
    if (tc === dc) {
      rate.value = 1
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const data = await $fetch<TwdCurrency>(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/twd.json',
      )

      const tcRate = data.twd[tc.toLowerCase()]
      const dcRate = data.twd[dc.toLowerCase()]

      if (tcRate && dcRate) {
        // exchangeRate = how many defaultCurrency units per 1 tripCurrency unit
        rate.value = Math.round((dcRate / tcRate) * 10000) / 10000
      }
      else {
        rate.value = toValue(fallbackRate)
      }
    }
    catch (e) {
      error.value = e instanceof Error ? e : new Error('Failed to fetch exchange rate')
      rate.value = toValue(fallbackRate)
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    rate,
    isLoading,
    error,
    fetchRate,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add composables/useExchangeRate.ts
git commit -m "feat: add useExchangeRate composable for fetching latest rates"
```

---

### Task 3: Update `useCurrencyToggle` to accept per-expense exchange rate

**Files:**
- Modify: `composables/useCurrencyToggle.ts`

- [ ] **Step 1: Add optional `exchangeRate` parameter to `toPrimary` and `toSecondary`**

Replace the current `toPrimary` and `toSecondary` functions in `composables/useCurrencyToggle.ts`:

```typescript
  const toPrimary = (amount: number, exchangeRate?: number): number => {
    if (!trip.value) return amount
    const rate = exchangeRate ?? trip.value.exchangeRate
    return showHomeCurrency.value ? amount * rate : amount
  }

  const toSecondary = (amount: number, exchangeRate?: number): number => {
    if (!trip.value) return amount
    const rate = exchangeRate ?? trip.value.exchangeRate
    return showHomeCurrency.value ? amount : amount * rate
  }
```

- [ ] **Step 2: Commit**

```bash
git add composables/useCurrencyToggle.ts
git commit -m "feat: support per-expense exchange rate in useCurrencyToggle"
```

---

### Task 4: Update `AddExpenseDrawer` to fetch and save exchange rate

**Files:**
- Modify: `components/AddExpenseDrawer.vue`

- [ ] **Step 1: Add exchange rate fetching and state**

In the `<script setup>` section, after the existing currency logic block (after line 46), add:

```typescript
// Exchange rate per expense
const { rate: fetchedRate, isLoading: isRateLoading, fetchRate } = useExchangeRate(
  () => props.trip.tripCurrency,
  () => props.trip.defaultCurrency,
  () => props.trip.exchangeRate,
)
const exchangeRateOverride = ref<number | null>(null)
const expenseExchangeRate = computed({
  get: () => exchangeRateOverride.value ?? fetchedRate.value,
  set: (val: number) => { exchangeRateOverride.value = val },
})
```

- [ ] **Step 2: Update `convertToTripCurrency` to use per-expense rate**

Replace the existing `convertToTripCurrency` function:

```typescript
function convertToTripCurrency(amount: number): number {
  if (!useHomeCurrency.value || !expenseExchangeRate.value)
    return amount
  return amount / expenseExchangeRate.value
}
```

- [ ] **Step 3: Fetch rate when drawer opens**

In the existing `watch(open, ...)` handler, add inside the `if (val)` block, after resetting the form:

```typescript
    exchangeRateOverride.value = null
    fetchRate()
```

- [ ] **Step 4: Save `exchangeRate` on manual submit**

In `submitManual`, update the `addDoc` call (around line 191) to include `exchangeRate`:

```typescript
    await addDoc(collection(db, 'trips', props.trip.id, 'expenses'), {
      ...formValues,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      exchangeRate: expenseExchangeRate.value,
      paidAt: Timestamp.fromDate(selectedDate),
      createdAt: Timestamp.fromDate(new Date()),
      isProcessing: false,
      enabled: true,
      createdByUserId: sessionUser.value?.uid,
    })
```

- [ ] **Step 5: Add exchange rate UI field in the manual tab (both desktop and mobile)**

In both the desktop and mobile manual tab sections, after the converted amount preview line (`<p v-if="convertedAmountPreview" ...>`), add:

```vue
                <div v-if="hasDifferentCurrencies" class="flex items-center gap-2 mt-2">
                  <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip.tripCurrency }} =</span>
                  <ui-input
                    v-model.number="expenseExchangeRate"
                    type="number"
                    step="0.0001"
                    min="0"
                    class="h-7 text-xs w-24"
                  />
                  <span class="text-xs text-muted-foreground">{{ trip.defaultCurrency }}</span>
                  <ui-button
                    v-if="isRateLoading"
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-6 px-1"
                    disabled
                  >
                    <Icon name="lucide:loader-2" class="h-3 w-3 animate-spin" />
                  </ui-button>
                </div>
```

- [ ] **Step 6: Commit**

```bash
git add components/AddExpenseDrawer.vue
git commit -m "feat: fetch and save per-expense exchange rate in AddExpenseDrawer"
```

---

### Task 5: Update `EditExpenseForm` to display and save exchange rate

**Files:**
- Modify: `components/EditExpenseForm.vue`

- [ ] **Step 1: Add exchange rate state**

In the `<script setup>` section, after the `hasDifferentCurrencies` computed (around line 37), add:

```typescript
const exchangeRateOverride = ref<number | null>(null)
const expenseExchangeRate = computed({
  get: () => exchangeRateOverride.value ?? props.expense.exchangeRate ?? props.trip.exchangeRate,
  set: (val: number) => { exchangeRateOverride.value = val },
})
```

- [ ] **Step 2: Update `convertToHomeCurrency` to use per-expense rate**

Replace the existing `convertToHomeCurrency` function:

```typescript
function convertToHomeCurrency(amount: number): number {
  const rate = props.expense.exchangeRate ?? props.trip.exchangeRate
  return Math.round(amount * rate * 100) / 100
}
```

- [ ] **Step 3: Update `convertToTripCurrency` to use per-expense rate**

Replace the existing `convertToTripCurrency` function:

```typescript
function convertToTripCurrency(amount: number): number {
  if (!useHomeCurrency.value || !expenseExchangeRate.value)
    return amount
  return amount / expenseExchangeRate.value
}
```

- [ ] **Step 4: Update item conversion in `onSubmit` to use per-expense rate**

In the `onSubmit` handler, replace the `itemsInTripCurrency` calculation:

```typescript
    const itemsInTripCurrency = useHomeCurrency.value
      ? (values.items || []).map(item => ({
          ...item,
          price: Math.round((item.price / expenseExchangeRate.value) * 100) / 100,
        }))
      : values.items
```

- [ ] **Step 5: Save `exchangeRate` in the `updateDoc` call**

In the `updateDoc` call inside `onSubmit`, add `exchangeRate`:

```typescript
    await updateDoc(doc(db, 'trips', props.trip.id, 'expenses', props.expense.id), {
      description: values.description,
      grandTotal: grandTotalInTripCurrency,
      inputCurrency: selectedCurrency.value,
      exchangeRate: expenseExchangeRate.value,
      paidAt: Timestamp.fromDate(selectedDate),
      paidByMemberId: values.paidByMemberId,
      sharedWithMemberIds: values.sharedWithMemberIds,
      items: itemsInTripCurrency,
    })
```

- [ ] **Step 6: Reset exchange rate override when form opens**

In the `watch(open, ...)` handler, add inside the `if (val)` block:

```typescript
    exchangeRateOverride.value = null
```

- [ ] **Step 7: Add exchange rate UI field in both desktop and mobile sections**

After the converted amount preview line in both desktop and mobile sections, add the same exchange rate input as in AddExpenseDrawer (without the loading spinner):

```vue
                <div v-if="hasDifferentCurrencies" class="flex items-center gap-2 mt-2">
                  <span class="text-xs text-muted-foreground whitespace-nowrap">1 {{ trip.tripCurrency }} =</span>
                  <ui-input
                    v-model.number="expenseExchangeRate"
                    type="number"
                    step="0.0001"
                    min="0"
                    class="h-7 text-xs w-24"
                  />
                  <span class="text-xs text-muted-foreground">{{ trip.defaultCurrency }}</span>
                </div>
```

- [ ] **Step 8: Commit**

```bash
git add components/EditExpenseForm.vue
git commit -m "feat: display and save per-expense exchange rate in EditExpenseForm"
```

---

### Task 6: Update `ExpenseItem` to use per-expense exchange rate

**Files:**
- Modify: `components/ExpenseItem.vue`

- [ ] **Step 1: Update `homeCurrencyAmount` to use per-expense rate**

Replace the existing `homeCurrencyAmount` computed:

```typescript
const homeCurrencyAmount = computed(() => {
  const rate = props.expense.exchangeRate ?? props.trip.exchangeRate
  return tripCurrencyAmount.value * rate
})
```

- [ ] **Step 2: Commit**

```bash
git add components/ExpenseItem.vue
git commit -m "feat: use per-expense exchange rate in ExpenseItem display"
```

---

### Task 7: Update expense detail page to use per-expense exchange rate

**Files:**
- Modify: `pages/trips/[tripId]/expenses/[expenseId].vue`

- [ ] **Step 1: Update `convertToDefaultCurrency` to use per-expense rate**

Replace the existing `convertToDefaultCurrency` computed:

```typescript
const convertToDefaultCurrency = computed(() => {
  if (!expense.value?.grandTotal)
    return 0
  const rate = expense.value.exchangeRate ?? trip.value?.exchangeRate ?? 1
  return Math.round(expense.value.grandTotal * rate * 100) / 100
})
```

- [ ] **Step 2: Update `sharedTotalByMember` to use per-expense rate**

In the `sharedTotalByMember` computed, replace all occurrences of `trip.value!.exchangeRate` with a local variable using the per-expense rate. At the top of the computed, add:

```typescript
  const rate = expense.value?.exchangeRate ?? trip.value?.exchangeRate ?? 1
```

Then replace `trip.value!.exchangeRate` with `rate` in lines 85, 126, and 127.

Specifically, the no-items branch (around line 85):

```typescript
        convertedTotal: expense.value!.grandTotal / sharedWithMemberIds.length * rate,
```

And the items forEach (around lines 126-127):

```typescript
      memberTotals[memberId].convertedTotal += pricePerMember * rate
```

- [ ] **Step 3: Update the template amount display to pass per-expense rate to `toPrimary`/`toSecondary`**

In the template, update the main amount display (around line 315-318) to pass the per-expense rate:

```vue
          <span class="text-primary">{{ primaryCurrency }} {{ toPrimary(expense?.grandTotal || 0, expense?.exchangeRate).toFixed(2) }}</span>
          <span v-if="hasDualCurrency" class="text-sm text-muted-foreground font-normal inline-flex items-center gap-1 ml-1">
            ≈ {{ secondaryCurrency }} {{ toSecondary(expense?.grandTotal || 0, expense?.exchangeRate).toFixed(2) }}
          </span>
```

- [ ] **Step 4: Update member split display to pass per-expense rate**

In the member split accordion section, update `toPrimary` and `toSecondary` calls (around lines 367-371) to include per-expense rate:

```vue
                      <div class="text-sm font-mono text-green-600 dark:text-green-400">
                        {{ primaryCurrency }} {{ toPrimary(sharedTotalByMember[member.id].total, expense?.exchangeRate).toFixed(2) || '0.00' }}
                      </div>
                      <div v-if="hasDualCurrency" class="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Icon name="lucide:equal-approximately" class="text-muted-foreground" size="12" />
                        <span>{{ secondaryCurrency }} {{ toSecondary(sharedTotalByMember[member.id].total, expense?.exchangeRate).toFixed(2) }}</span>
                      </div>
```

- [ ] **Step 5: Update item breakdown display to use per-expense rate**

In the item breakdown template (around lines 387-391), update the `toPrimary` calls:

```vue
                        ({{ usedHomeCurrency ? trip?.defaultCurrency : primaryCurrency }} {{ (usedHomeCurrency ? item.itemPrice * (expense?.exchangeRate || trip?.exchangeRate || 1) : toPrimary(item.itemPrice, expense?.exchangeRate)).toFixed(2) }} × {{ item.itemQuantity }} ÷ {{ item.sharingMembers.length }}人)
```

And the share per member amount:

```vue
                      {{ usedHomeCurrency ? trip?.defaultCurrency : primaryCurrency }} {{ (usedHomeCurrency ? item.sharePerMember * (expense?.exchangeRate || trip?.exchangeRate || 1) : toPrimary(item.sharePerMember, expense?.exchangeRate)).toFixed(2) }}
```

And the subtotal:

```vue
                      {{ usedHomeCurrency ? trip?.defaultCurrency : primaryCurrency }} {{ ((memberItemBreakdown[member.id] || []).reduce((sum, item) => sum + (usedHomeCurrency ? item.sharePerMember * (expense?.exchangeRate || trip?.exchangeRate || 1) : toPrimary(item.sharePerMember, expense?.exchangeRate)), 0)).toFixed(2) }}
```

- [ ] **Step 6: Commit**

```bash
git add pages/trips/[tripId]/expenses/[expenseId].vue
git commit -m "feat: use per-expense exchange rate on expense detail page"
```

---

### Task 8: Update charts page to use per-expense exchange rate

**Files:**
- Modify: `pages/trips/[tripId]/charts.vue`

- [ ] **Step 1: Update `formatAmount` to accept optional exchange rate**

The charts page uses `toPrimary` inside `formatAmount`. Since charts aggregate multiple expenses, individual per-expense rates can't be applied directly to `toPrimary`. Instead, update the daily spending and summary stats to pre-convert amounts using each expense's own rate.

Replace the `dailySpending` computed:

```typescript
const dailySpending = computed(() => {
  const grouped: Record<string, number> = {}
  for (const expense of enabledExpenses.value) {
    const key = `${expense.paidAtObject.month}/${expense.paidAtObject.day}`
    grouped[key] = (grouped[key] || 0) + expense.grandTotal
  }
  return Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }))
})
```

This stays the same because the chart data is in trip currency and `formatAmount` converts to primary. Update `formatAmount` to handle aggregates differently:

Replace `formatAmount`:

```typescript
function formatAmount(n: number) {
  const converted = toPrimary(n)
  if (converted >= 10000) return `${(converted / 1000).toFixed(0)}k`
  if (converted >= 1000) return `${(converted / 1000).toFixed(1)}k`
  return converted.toFixed(0)
}
```

For charts, aggregated totals still use the trip-level rate via `toPrimary` (no per-expense rate passed). This is acceptable because charts show summaries, and passing individual rates to aggregates is not meaningful. The per-expense rate matters most on individual expense display.

No changes needed for the charts page — the existing `toPrimary()` without a rate parameter already falls back to trip rate, which is correct for aggregated views.

- [ ] **Step 2: Commit** (skip if no changes needed)

If no changes were made, skip this commit.

---

### Task 9: Verify and test the full flow

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Run the linter**

```bash
npx eslint .
```

Fix any lint errors.

- [ ] **Step 3: Manual testing checklist**

1. Open add expense form → verify exchange rate field appears with fetched rate
2. Change the rate → verify the conversion preview updates
3. Save an expense → verify `exchangeRate` is stored in Firestore
4. View expense in list → verify it uses the per-expense rate for home currency display
5. Open expense detail → verify amounts use per-expense rate
6. Edit an expense → verify stored rate is shown, can be changed, saves correctly
7. View an old expense (without `exchangeRate` field) → verify it falls back to trip rate
8. Toggle currency on trip page → verify per-expense rates are used for individual items

- [ ] **Step 4: Final commit if lint fixes were needed**

```bash
git add -A
git commit -m "fix: lint fixes for per-expense exchange rate feature"
```
