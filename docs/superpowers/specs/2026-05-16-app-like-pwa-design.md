# App-like PWA — Design

**Date**: 2026-05-16
**Topic**: Make Payback behave like a native app — instant cache loading, Firestore offline read/write, refined update prompt, and in-app new-expense notifications.

## Goal

Four user-visible behaviors:

1. **Instant loading from cache** — opening the installed PWA paints UI from disk with no network round-trip.
2. **Offline capability** — viewing trips and creating/editing expenses works offline; writes queue and sync when reconnected.
3. **Update prompt** — when a new app version is available, surface it non-intrusively and let the user apply it on demand.
4. **New-expense notification** — when another trip member adds an expense to the trip you're currently viewing, show a toast with member name, description, and amount.

Push notifications (FCM) are explicitly out of scope. Notifications are in-app only.

## Out of scope

- Firebase Cloud Messaging / push notifications (system-level OS notifications).
- Cross-trip activity feed (toasts only fire on the trip page you're viewing).
- Server-rendered OG meta tags for share links (lost as a tradeoff of SPA mode; revisit only if a specific share link surfaces a real problem).
- Reimplementing trip-total / member-spending aggregation on the client (kept server-side in the existing Cloud Functions; see Section 2 for the resulting "totals catch up after sync" behavior).

## Section 1 — App shell (SPA-mode, instant cache loading)

### Change

Set `ssr: false` in `nuxt.config.ts`. Build now emits a single static `index.html` (the app shell) plus JS/CSS bundles. The service worker precaches all of these.

### Behavior

- Every navigation paints the cached shell from disk in <100ms.
- The client router then routes to the requested page; VueFire/Firestore hydrates data from its IndexedDB cache (see Section 2).
- Workbox `navigateFallback` changes from `/offline.html` to `/` (the precached shell). `public/offline.html` becomes unused and is deleted.

### Files affected

- `nuxt.config.ts` — add `ssr: false`; update `pwa.workbox.navigateFallback` to `/`; keep `navigateFallbackDenylist: [/^\/api/]` so API routes pass through.
- Delete `plugins/initUser.server.ts` (only `initUser.client.ts` runs in SPA mode).
- Delete `public/offline.html` if present.
- `server/middleware/session.ts` — unchanged; still runs for API routes.
- `server/api/*` — unchanged; SPA mode does not remove the Nitro server.

### Tradeoffs accepted

- Loss of server-rendered OG meta tags on share links. Acceptable per user decision.
- Brief flash of app shell before client-side `auth` middleware redirects an unauthenticated user to `/login`. Acceptable for app-like feel.

## Section 2 — Firestore offline persistence (full read + write with sync)

### Change

Configure Firestore SDK to use `persistentLocalCache` with `persistentMultipleTabManager`. New client plugin runs before VueFire initializes Firestore.

### Behavior

- All read documents are cached in IndexedDB. On next load (online or offline), `useDocument`/`useCollection` resolve from cache instantly, then stream live updates when network returns.
- Writes go to the local cache immediately and queue server-side. UI reflects the change instantly. When network returns, Firestore replays the queue.
- Multi-tab support: two tabs of the same trip share one cache; writes do not conflict.

### Files affected

- New: `plugins/firestore.client.ts` — calls `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` before VueFire initializes. Plugin ordering ensures this runs before `nuxt-vuefire` reads the Firestore instance.

### New UI surface

- **Connection state indicator**: small pill in the navbar / bottom bar.
  - Online: hidden.
  - Offline: amber dot + "Offline" label.
  - Syncing: transient spinner + "Syncing…" label while the write queue drains after reconnect.
  - Source: `navigator.onLine` + `online`/`offline` window events; sync state derived from a new `useConnectionState()` composable that tracks the count of docs with `metadata.hasPendingWrites === true` across active subscriptions.

- **Per-expense pending badge**: an expense row written offline shows a subtle "Pending sync" badge until the server confirms.
  - Source: Firestore `snapshot.metadata.hasPendingWrites` flag. VueFire exposes this via the bind result; if the version in use does not, fall back to the raw `onSnapshot` listener for the trip expenses collection just to read metadata, then attach the flag to each expense in the existing converter pipeline.

### Cloud Functions interaction (documented, not changed)

`functions/onExpenseChange.js` recomputes `totalExpenses`, `enabledTotalExpenses`, `disabledTotalExpenses`, `expenseCount` on the trip doc, and `spending` on member docs, server-side via `onDocumentCreated/Updated/Deleted` triggers.

When a user writes offline:
- The new expense row appears instantly in the local cache.
- The aggregated trip totals do not change until reconnect, when the Cloud Function runs and writes the updated trip doc.
- Result: the user sees the expense row appear instantly, then the trip total at the top of the page "jumps" to the correct value a moment after sync completes.

This is acceptable, honest behavior. No client-side recompute (would duplicate function logic and risk divergence).

## Section 3 — Update prompt (refinement of existing)

### Current state

`app.vue:5-15, 26-40` already wires up the PWA update flow:
- Watches `$pwa.needRefresh` (set by `@vite-pwa/nuxt` when the SW detects an installable update).
- On change, opens a blocking `<ui-alert-dialog>` with "Update Now" → `$pwa.updateServiceWorker()`.
- `nuxt.config.ts` sets `pwa.registerType: 'prompt'` and `pwa.client.periodicSyncForUpdates: 3600` (hourly polling).

### Change

Soften the prompt and add a refresh-on-focus trigger.

- Replace the blocking `<ui-alert-dialog>` in `app.vue` with a persistent sonner toast (`toast(..., { duration: Infinity })`) containing:
  - Title: "Update available".
  - Action button: "Update" → `$pwa.updateServiceWorker()`.
  - Dismiss "X" → close toast; will re-show on next `needRefresh` flip or next periodic check.
- After `updateServiceWorker()` returns and the new SW takes control, show a short success toast: "Updated to latest version." Hook into the `controllerchange` event on `navigator.serviceWorker` to know when activation completes.
- Add an on-focus update check: on `document.visibilitychange` returning to `visible`, if more than 5 minutes have passed since the last update check, call `$pwa.update()` (a wrapper around `registration.update()`). Mirrors native apps' refresh-on-resume.

### Files affected

- `app.vue` — remove the `<ui-alert-dialog>` block; replace with a watcher that calls `toast(...)` from vue-sonner; add the controllerchange success toast and visibilitychange refresh check.
- `nuxt.config.ts` — keep `periodicSyncForUpdates: 3600`; no config change.

## Section 4 — New-expense toast (in-app, current trip only)

### Behavior

While viewing a trip detail page, when another member's new expense lands in the Firestore subscription, fire one sonner toast: `"<Member> added <Description> — <Currency><Amount>"`. Tapping the toast does nothing (the expense list on the same page already shows the row). Self-dismisses after standard duration.

### Files affected

- New: `composables/useTripExpenseToasts.ts`.
- Edited: `pages/trips/[tripId]/index.vue` — one-line composable call (`useTripExpenseToasts(tripId)`).

### Composable logic

`useTripExpenseToasts(tripId)`:
1. Calls `useTripExpenses(tripId)` internally. The Firestore SDK deduplicates listeners on identical queries, so calling it from both the page and the composable does not create a second network subscription — the second `onSnapshot` registration shares the underlying stream.
2. Calls `useTripMembers(tripId)` to resolve member names.
3. Calls `useSessionUser()` and resolves the current user's `tripMember.id` for the current trip.
4. Maintains a ref `seenIds: Set<string>` and a boolean `hasInitialized`.
5. Watches the expenses array. On each change:
   - If `!hasInitialized`: populate `seenIds` with every current expense id and set `hasInitialized = true`. **No toasts fire on the initial snapshot.**
   - Otherwise, for each expense whose id is not in `seenIds`, evaluate filters:
     - **Skip** if `expense.isProcessing === true` (mid-OCR; will re-snapshot after processing completes — handled on next snapshot).
     - **Skip** if `expense.paidByMemberId === currentMember.id` (your own write).
     - **Skip** if the expense doc has `metadata.hasPendingWrites === true` (local optimistic write — see Section 2 metadata plumbing).
     - Otherwise fire `toast("<member.name> added <expense.description> — <formattedAmount>")`.
   - Add the id to `seenIds` regardless (so re-snapshots don't re-fire).

### Edge cases

- A processing expense flips `isProcessing: true → false` and updates `description`/`grandTotal`. The id is already in `seenIds` after the first snapshot, so no toast fires when it finishes processing. Acceptable — the alternative (toast on processing completion) would race with the original creator's UI.
- Member document not yet loaded when the expense lands: defer toast until `tripMembersMap.value.get(paidByMemberId)` resolves; if it never does, fall back to "Someone added …".
- Currency formatting: reuse the existing currency utility already used in expense list rendering (see `pages/trips/[tripId]/index.vue` for the in-use formatter).

## Cross-cutting concerns

### Auth flow under SPA mode

- `initUser.client.ts` continues to handle session bootstrap (already does).
- The brief "shell flash before redirect" for unauthenticated users on protected routes is accepted.
- Guest flow (anonymous in-app browser users) continues to work — `initUser.client.ts` already recovers from persisted anonymous Firebase user.

### Service worker update + cache invalidation

- Workbox `cleanupOutdatedCaches: true` (already set) handles old precache cleanup on activation.
- IndexedDB Firestore cache is unaffected by SW updates — it lives in a separate origin store managed by the Firestore SDK.

### Testing approach

- Manual smoke tests in Chrome DevTools:
  1. Install PWA → close → relaunch offline → verify trip list and a previously-viewed trip render from cache.
  2. Offline → add an expense → reconnect → verify expense persists and trip total updates after Cloud Function runs.
  3. Bump build → wait for update toast → click Update → verify success toast.
  4. With a second tab as a different member, add an expense → verify the toast fires on the first tab.
- Existing vitest setup is preserved. Unit tests for `useTripExpenseToasts` filtering logic (mock the expenses array and assert which toasts fire).

## Implementation order

1. SPA mode + Workbox `navigateFallback` change (Section 1).
2. Firestore `persistentLocalCache` plugin + connection state composable + UI pill (Section 2).
3. Update prompt refinement (Section 3).
4. New-expense toast composable + integration (Section 4).
5. Manual smoke tests above.

Each step is independently shippable.
