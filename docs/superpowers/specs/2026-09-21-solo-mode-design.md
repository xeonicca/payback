# Solo Mode — Design

**Date:** 2026-09-21
**Status:** Approved (brainstorming), pending implementation plan

## Problem

Solo travelers use Payback to track their own spending, but every trip is built around
splitting: the home page shows balances, settlements, and a per-member overview; the
expense form asks who paid and who shares; settings expose members, collaborators, and
invite links. For a one-person trip this is noise, and a live public join link is enabled
by default.

## Goals

- Offer a **solo mode** for trips with a single member.
- Prompt the user to enter solo mode when creating a trip with only themselves.
- In solo mode, hide all splitting, sharing, invitation, and member-management UI.
- Replace the group overview with a personal spending summary.
- Allow switching **both ways** from settings (owner only), with no data migration.

## Non-goals

- Trip budgets (possible follow-up).
- Fixing the unwritten `memberCount` / `memberEmojis` trip-list footer (separate issue).
- Native iOS work — `ios/` is a Capacitor wrapper of the Nuxt build; changes ship via rebuild + sync.

## Approach

Explicit `soloMode` flag on the trip plus a `useTripMode()` composable that all surfaces
branch on. New UI lives in small dedicated components so large pages don't grow. Server
join/invite endpoints enforce the mode (hiding buttons alone would leave existing links working).

Rejected:
- **Derived mode** (`members.length === 1 && collaboratorCount === 1`) — would strip invite UI
  from 1-member trips the user deliberately kept as group trips.
- **Separate solo pages** — duplicates ~400-line pages that would drift.

## 1. Data and mode switching

### Data model
- `Trip.soloMode?: boolean` (and `NewTrip`) in `types/index.ts`.
- `tripConverter` in `utils/converter.ts` defaults missing to `false` — existing trips unaffected.

### `useTripMode()` composable
- `isSolo = trip.soloMode === true && members.length === 1` — inconsistent data falls back to group UI so nothing is hidden.
- `soloModeBroken = trip.soloMode === true && members.length > 1` — used to show a notice in settings.
- `canSwitchToSolo = isOwner && !trip.soloMode && members.length === 1 && collaboratorCount === 1 && no pending invitations`.

### Entering at creation (`pages/trips/new.vue`)
On submit, if the member list contains only the host, show a dialog:
「只有你一個人 — 要使用個人模式嗎？」 with actions 「個人模式」 / 「之後會邀請朋友」.
- 個人模式 → trip written with `soloMode: true`, `isPublicInviteEnabled: false`.
- 之後會邀請朋友 → normal group trip, as today.

### Group → solo (設定)
Shown only when `canSwitchToSolo`. Calls new endpoint
`POST /api/trips/[tripId]/solo-mode` with `{ enabled: true }`, which, after verifying owner
and the same preconditions server-side:
- sets `soloMode: true`
- sets `isPublicInviteEnabled: false`
- revokes all open invitations (collaborator and guest)

### Solo → group (設定)
Same endpoint with `{ enabled: false }` → sets `soloMode: false`. Public link stays **off**;
owner enables it in 協作 when ready. Expenses untouched (already paid by / shared with the
single member).

### Server guards
Return 403 「個人模式旅程無法加入」 when the trip has `soloMode: true`:
- `server/api/trips/join.post.ts`
- `server/api/invitations/create.post.ts`
- `server/api/invitations/accept.post.ts`

## 2. UI when `isSolo`

### Trip home (`pages/trips/[tripId]/index.vue`)
- Header: 「N 筆支出」 only — drop 「N 位成員」.
- Personal balance card and 旅程總覽 accordion replaced by new `components/TripSoloSummary.vue`:
  - Total spent — large, monospace, trip currency; converted home-currency amount below.
  - Tiles: 今日花費, 日均花費.
  - Top category, when any expense has a category.
- 結算建議 hidden entirely.
- Recent expenses unchanged.

### Expense form (`components/AddExpenseDrawer.vue`, all three copies: receipt tab, manual tab, mobile drawer)
- Hide payer picker and 分攤成員 picker; values still default to the single member so the data shape is unchanged.
- Hide `splitSummary` text.

### Expense detail (`pages/trips/[tripId]/expenses/[expenseId]/index.vue`)
- Hide payer line, sharer avatars, `ExpenseSharersEditDialog` and `ExpenseItemSplitDialog` entry points.

### Expense list rows (`components/ExpenseItem.vue`)
- Hide 「X 付款」 and sharer avatars → description, time, category, amount.

### 統計 (`pages/trips/[tripId]/charts.vue`)
- Hide per-member paid/owed/balance chart. Category and daily charts stay.

### 設定 (`pages/trips/[tripId]/edit.vue`)
- Hide 成員 and 協作 tabs.
- Owner's own name/emoji edit moves into 行程資訊 so it remains reachable.
- 設定 tab gains a 「個人模式」 section: switch action (to solo when `canSwitchToSolo`, to group when solo),
  a short explanation of what changes, and a notice when `soloModeBroken`.

### Bottom bar
No change — 總覽 / 統計 / 支出 / 設定 all still apply.

### Trip list (`pages/index.vue`)
Small 「個人」 badge on solo trips.

## 3. Summary calculation

Pure function in `utils/soloSummary.ts`, input: enabled expenses, trip currency/exchange
rate fields, archived flag, `now`.
- `total` — sum of enabled expense grand totals (trip currency), plus converted home-currency total using existing `exchangeRate` / `defaultCurrency`.
- `today` — sum of expenses whose `paidAt` falls on the current local date.
- `dailyAverage` — `total / days`, where `days` = calendar days from first expense `paidAt` to today (or to last expense if archived), floored at 1. No expenses → shown as 「—」.
- `topCategory` — category with the highest total; `null` if none categorized.

## 4. Edge cases

- `soloMode: true` with 2+ members (e.g. invite accepted before guard deployed): group UI shown, settings notice explains solo mode is inactive.
- Guest links (`/guest/{code}`): covered by revocation on switch plus accept guard.
- Archived trips: owner may still switch mode (display-only effect).
- Firestore rules: no change — `soloMode` is owner-updatable; join/invite writes already server-only.
- Deploy order: server guards before or with client. Flag defaults to `false`, so old clients treat solo trips as normal trips.

## 5. Testing

- **Unit (vitest)**: `utils/soloSummary.test.ts` — empty, single day, multi-day, archived, category ties/none, currency conversion.
- **Unit**: mode logic (`isSolo`, `soloModeBroken`, `canSwitchToSolo`) across member / collaborator / invitation combinations — extract as pure helpers for testability.
- **Server**: 403 paths on join, invitation create, invitation accept; solo-mode endpoint precondition checks and revocation.
- **Manual QA (browser)**: create solo trip via prompt; add expense (no pickers); home summary; 統計; 設定 tabs hidden; switch solo → group → solo; previously issued join link refused.
