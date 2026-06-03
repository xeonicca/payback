# App-like PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Payback feel like a native app — instant cache loading via SPA shell, full offline Firestore (read + write with sync), a non-blocking update prompt with focus-refresh, and in-app toast notifications when other trip members add expenses.

**Architecture:** Switch Nuxt to SPA mode (`ssr: false`) so the service worker precaches a single app shell HTML for sub-100ms paint. Enable Firestore IndexedDB persistence so reads/writes work offline and replay on reconnect. Replace the blocking update dialog with a sonner toast and add a visibility-based update check. Add a composable that watches the trip's expense subscription and fires sonner toasts for other members' new expenses, with strict guards against initial-load and self-write noise.

**Tech Stack:** Nuxt 3, VueFire, Firebase JS SDK v11 (Firestore with `persistentLocalCache`), `@vite-pwa/nuxt`, vue-sonner, vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-app-like-pwa-design.md`

---

## File Structure

**Created**
- `plugins/firestore.client.ts` — initializes Firestore with `persistentLocalCache` + multi-tab manager before VueFire reads the instance.
- `composables/useConnectionState.ts` — exposes `state: 'online' | 'offline' | 'syncing'` from `navigator.onLine` + pending-writes count.
- `components/ConnectionStatusPill.vue` — small pill UI shown only when state ≠ `'online'`.
- `composables/useTripExpenseToasts.ts` — watches trip expenses; fires toasts for other members' newly created expenses.
- `__tests__/useTripExpenseToasts.test.ts` — unit tests for the filter logic.

**Modified**
- `nuxt.config.ts` — add `ssr: false`; change `pwa.workbox.navigateFallback` to `/`.
- `app.vue` — replace `<ui-alert-dialog>` with sonner toast; add `visibilitychange` refresh check; show success toast on `controllerchange`.
- `components/Navbar.vue` — mount `<connection-status-pill />`.
- `pages/trips/[tripId]/index.vue` — call `useTripExpenseToasts(tripId as string)`.

**Deleted**
- `plugins/initUser.server.ts` — never runs in SPA mode.
- `public/offline.html` — superseded by precached shell.

---

## Phase 1 — SPA App Shell

### Task 1: Switch Nuxt to SPA mode

**Files:**
- Modify: `nuxt.config.ts`
- Delete: `plugins/initUser.server.ts`
- Delete: `public/offline.html`

- [ ] **Step 1: Add `ssr: false` to Nuxt config**

Edit `nuxt.config.ts`. Inside `defineNuxtConfig({ ... })`, add a top-level `ssr: false,` line directly after `compatibilityDate: '2025-05-15',`:

```ts
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  ssr: false,
  srcDir: '.',
  // ... rest unchanged
```

- [ ] **Step 2: Update Workbox `navigateFallback` to the precached shell**

In `nuxt.config.ts`, inside `pwa.workbox`, change:

```ts
navigateFallback: '/offline.html',
```

to:

```ts
navigateFallback: '/',
```

Keep `navigateFallbackDenylist: [/^\/api/]` exactly as-is so API routes are not served the shell.

- [ ] **Step 3: Delete dead SSR plugin**

```powershell
Remove-Item plugins\initUser.server.ts
```

- [ ] **Step 4: Delete unused offline fallback**

```powershell
Remove-Item public\offline.html
```

- [ ] **Step 5: Verify dev build boots in SPA mode**

```powershell
pnpm dev
```

Expected: Nuxt logs "✔ Vite client built". Open `http://localhost:3000/` in an incognito window — page renders. View page source — body should be largely empty (`<div id="__nuxt"></div>` placeholder) with no SSR-rendered markup. Stop dev (`Ctrl+C`).

- [ ] **Step 6: Verify production build emits a static shell**

```powershell
pnpm build
```

Expected: build completes without SSR-only warnings. `.output/public/index.html` exists and contains the static app shell.

- [ ] **Step 7: Commit**

```powershell
git add nuxt.config.ts; git commit -m "feat(pwa): switch to SPA mode for app-shell instant loading"
git add -A; git commit -m "chore(pwa): remove SSR-only plugin and offline fallback"
```

---

## Phase 2 — Firestore Offline Persistence

### Task 2: Firestore persistence plugin

**Files:**
- Create: `plugins/firestore.client.ts`

- [ ] **Step 1: Create the plugin**

Create `plugins/firestore.client.ts` with this exact content:

```ts
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { useFirebaseApp } from 'vuefire'

// Must run before VueFire reads the Firestore instance.
// `enforce: 'pre'` puts this plugin before nuxt-vuefire's auto-registered plugins.
export default defineNuxtPlugin({
  name: 'firestore-persistence',
  enforce: 'pre',
  setup() {
    const app = useFirebaseApp()
    initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    })
  },
})
```

- [ ] **Step 2: Verify persistence is active**

```powershell
pnpm dev
```

Open `http://localhost:3000/` in Chrome, sign in, visit a trip. Open DevTools → Application → IndexedDB. Expected: a database named `firestore/[default]/<project-id>/main` exists with non-empty `documents` store. Stop dev.

- [ ] **Step 3: Verify offline read works**

With dev server running and a trip page loaded, open DevTools → Network → set throttling to "Offline". Reload the page. Expected: the trip data still renders from cache. Restore "No throttling" and stop dev.

- [ ] **Step 4: Commit**

```powershell
git add plugins/firestore.client.ts; git commit -m "feat(firestore): enable persistent IndexedDB cache with multi-tab support"
```

### Task 3: Connection-state composable

**Files:**
- Create: `composables/useConnectionState.ts`

- [ ] **Step 1: Write the composable**

Create `composables/useConnectionState.ts`:

```ts
import { useFirestore, useIsFetching } from 'vuefire'
import { onScopeDispose, ref } from 'vue'
import { disableNetwork, enableNetwork } from 'firebase/firestore'

export type ConnectionState = 'online' | 'offline' | 'syncing'

let _shared: ReturnType<typeof create> | null = null

function create() {
  const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const justReconnected = ref(false)
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function onOnline() {
    const wasOffline = !isOnline.value
    isOnline.value = true
    if (wasOffline) {
      justReconnected.value = true
      if (reconnectTimer)
        clearTimeout(reconnectTimer)
      // Show "Syncing…" for 1500ms after reconnect to cover the
      // Firestore write-queue drain window. This is a UI heuristic;
      // the actual write replay happens in the SDK in the background.
      reconnectTimer = setTimeout(() => {
        justReconnected.value = false
      }, 1500)
    }
  }

  function onOffline() {
    isOnline.value = false
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }

  const state = computed<ConnectionState>(() => {
    if (!isOnline.value)
      return 'offline'
    if (justReconnected.value)
      return 'syncing'
    return 'online'
  })

  return { state, isOnline, justReconnected }
}

export function useConnectionState() {
  if (!_shared)
    _shared = create()
  return _shared
}
```

- [ ] **Step 2: Smoke-test in DevTools**

```powershell
pnpm dev
```

Open the homepage, then in DevTools Console:

```js
const c = window.__nuxt && document.querySelector('html')
// trigger offline event
window.dispatchEvent(new Event('offline'))
```

(Or use Network → Offline.) Visually verify in Vue DevTools that the `state` ref of any component using the composable flips to `'offline'`, and back to `'syncing'` then `'online'` within ~1.5s of going back online. Stop dev.

- [ ] **Step 3: Commit**

```powershell
git add composables/useConnectionState.ts; git commit -m "feat(pwa): add useConnectionState composable for online/offline/syncing UI"
```

### Task 4: Connection status pill component

**Files:**
- Create: `components/ConnectionStatusPill.vue`

- [ ] **Step 1: Build the component**

Create `components/ConnectionStatusPill.vue`:

```vue
<script setup lang="ts">
const { state } = useConnectionState()
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-200"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="state !== 'online'"
      :class="[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        state === 'offline'
          ? 'bg-amber-100 text-amber-900'
          : 'bg-slate-200 text-slate-700',
      ]"
      role="status"
      :aria-label="state === 'offline' ? 'Offline' : 'Syncing'"
    >
      <span
        v-if="state === 'offline'"
        class="w-2 h-2 rounded-full bg-amber-500"
        aria-hidden="true"
      />
      <span
        v-else
        class="w-3 h-3 inline-block animate-spin border-2 border-slate-400 border-t-transparent rounded-full"
        aria-hidden="true"
      />
      <span>{{ state === 'offline' ? 'Offline' : 'Syncing…' }}</span>
    </div>
  </Transition>
</template>
```

- [ ] **Step 2: Commit**

```powershell
git add components/ConnectionStatusPill.vue; git commit -m "feat(ui): add ConnectionStatusPill component"
```

### Task 5: Mount the pill in the navbar

**Files:**
- Modify: `components/Navbar.vue:108-153` (inside the right-side `<ul>` block)

- [ ] **Step 1: Add the pill before the avatar dropdown**

Open `components/Navbar.vue`. Locate the line:

```vue
      <ul class="flex place-items-center space-x-4">
        <li class="flex items-center">
          <ClientOnly>
```

Insert a new `<li>` before the existing `<li class="flex items-center">`:

```vue
      <ul class="flex place-items-center space-x-4">
        <li class="flex items-center">
          <ClientOnly>
            <connection-status-pill />
          </ClientOnly>
        </li>
        <li class="flex items-center">
          <ClientOnly>
```

(The existing avatar `<li>` and its content are untouched.)

- [ ] **Step 2: Manual verification**

```powershell
pnpm dev
```

Open the homepage. Throttle Network to "Offline" — expect the amber "Offline" pill to appear in the navbar. Switch back to "No throttling" — expect a brief "Syncing…" pill that fades out within ~1.5s, then nothing. Stop dev.

- [ ] **Step 3: Commit**

```powershell
git add components/Navbar.vue; git commit -m "feat(ui): show connection status pill in navbar"
```

---

## Phase 3 — Refined Update Prompt

### Task 6: Replace blocking dialog with sonner toast + on-focus refresh

**Files:**
- Modify: `app.vue` (entire file)

- [ ] **Step 1: Rewrite `app.vue`**

Replace the contents of `app.vue` with this exact content:

```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'

const { $pwa } = useNuxtApp()

const FIVE_MINUTES_MS = 5 * 60 * 1000
let lastUpdateCheck = Date.now()

// Show a persistent toast when an update is detected.
let updateToastId: string | number | undefined
watch(
  () => $pwa?.needRefresh && unref($pwa.needRefresh),
  (val) => {
    if (!val || updateToastId !== undefined)
      return
    updateToastId = toast('Update available', {
      description: 'A new version of the app is ready.',
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'Update',
        onClick: () => {
          $pwa!.updateServiceWorker()
        },
      },
    })
  },
  { immediate: true },
)

// Brief success confirmation after the new service worker takes over.
if (import.meta.client && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateToastId !== undefined) {
      toast.dismiss(updateToastId)
      updateToastId = undefined
    }
    toast.success('Updated to latest version')
  })

  // Check for an update when the tab returns to foreground after >5 min.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible')
      return
    const now = Date.now()
    if (now - lastUpdateCheck < FIVE_MINUTES_MS)
      return
    lastUpdateCheck = now
    // vite-pwa exposes `update()` on $pwa as a wrapper around registration.update()
    void $pwa?.update?.()
  })
}
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
    <NuxtPwaManifest />
  </NuxtLayout>

  <toaster position="top-center" style="top: calc(8px + env(safe-area-inset-top, 0px))" />
</template>
```

- [ ] **Step 2: Manual smoke test — toast appears**

```powershell
pnpm build; pnpm preview
```

Open the preview URL in Chrome, install the PWA (or use the tab). In DevTools Application → Service Workers, click "Update" to simulate a new SW. Expected: persistent "Update available" toast appears with an "Update" action button.

- [ ] **Step 3: Manual smoke test — success toast**

Click the "Update" action in the toast. Expected: page reloads (via the SW controllerchange) and "Updated to latest version" success toast appears briefly.

- [ ] **Step 4: Commit**

```powershell
git add app.vue; git commit -m "feat(pwa): replace blocking update dialog with toast and add focus-refresh check"
```

---

## Phase 4 — New-Expense Toast

### Task 7: useTripExpenseToasts composable (test-first)

**Files:**
- Create: `composables/useTripExpenseToasts.ts`
- Test: `__tests__/useTripExpenseToasts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/useTripExpenseToasts.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'

// Mocks must be hoisted with vi.hoisted so vi.mock factories can see them.
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  expenses: ref<any[]>([]),
  tripMembersMap: ref<Record<string, { id: string, name: string }>>({}),
  currentUserMember: ref<{ id: string } | undefined>(undefined),
}))

vi.mock('vue-sonner', () => ({ toast: mocks.toast }))
vi.mock('@/composables/useTripExpenses', () => ({
  useTripExpenses: () => ({ tripExpenses: mocks.expenses, enabledExpenses: mocks.expenses }),
}))
vi.mock('@/composables/useTripMembers', () => ({
  useTripMembers: () => ({ tripMembersMap: mocks.tripMembersMap, currentUserMember: mocks.currentUserMember }),
}))

import { useTripExpenseToasts } from '@/composables/useTripExpenseToasts'

function expense(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? 'e1',
    description: 'Dinner',
    grandTotal: 1200,
    paidByMemberId: 'm-other',
    isProcessing: false,
    hasPendingWrites: false,
    ...overrides,
  }
}

describe('useTripExpenseToasts', () => {
  beforeEach(() => {
    mocks.toast.mockReset()
    mocks.expenses.value = []
    mocks.tripMembersMap.value = {
      'm-me': { id: 'm-me', name: 'Me' },
      'm-other': { id: 'm-other', name: 'Sarah' },
    }
    mocks.currentUserMember.value = { id: 'm-me' }
  })

  it('does not fire toasts for expenses present at initial load', async () => {
    mocks.expenses.value = [expense({ id: 'e1' })]
    useTripExpenseToasts('trip-1')
    await nextTick()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('fires a toast for a new expense from another member', async () => {
    useTripExpenseToasts('trip-1')
    await nextTick()
    mocks.expenses.value = [expense({ id: 'e2' })]
    await nextTick()
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast.mock.calls[0][0]).toContain('Sarah')
    expect(mocks.toast.mock.calls[0][0]).toContain('Dinner')
    expect(mocks.toast.mock.calls[0][0]).toContain('1200')
  })

  it('does not fire for own writes (paidByMemberId === currentUserMember.id)', async () => {
    useTripExpenseToasts('trip-1')
    await nextTick()
    mocks.expenses.value = [expense({ id: 'e3', paidByMemberId: 'm-me' })]
    await nextTick()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('does not fire for expenses with isProcessing=true', async () => {
    useTripExpenseToasts('trip-1')
    await nextTick()
    mocks.expenses.value = [expense({ id: 'e4', isProcessing: true })]
    await nextTick()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('does not fire for expenses with hasPendingWrites=true', async () => {
    useTripExpenseToasts('trip-1')
    await nextTick()
    mocks.expenses.value = [expense({ id: 'e5', hasPendingWrites: true })]
    await nextTick()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('does not re-fire when an already-seen expense re-emits (e.g. processing→done)', async () => {
    useTripExpenseToasts('trip-1')
    await nextTick()
    mocks.expenses.value = [expense({ id: 'e6' })]
    await nextTick()
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    // Same id, updated content (simulates the document being re-snapshotted)
    mocks.expenses.value = [expense({ id: 'e6', description: 'Dinner (updated)' })]
    await nextTick()
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('falls back to "Someone" when the member is not in the members map', async () => {
    useTripExpenseToasts('trip-1')
    await nextTick()
    mocks.expenses.value = [expense({ id: 'e7', paidByMemberId: 'm-unknown' })]
    await nextTick()
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast.mock.calls[0][0]).toContain('Someone')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pnpm test -- __tests__/useTripExpenseToasts.test.ts
```

Expected: All 7 tests FAIL with "Cannot find module '@/composables/useTripExpenseToasts'".

- [ ] **Step 3: Implement the composable**

Create `composables/useTripExpenseToasts.ts`:

```ts
import { toast } from 'vue-sonner'
import { watch } from 'vue'
import { useTripExpenses } from '@/composables/useTripExpenses'
import { useTripMembers } from '@/composables/useTripMembers'

export function useTripExpenseToasts(tripId: string) {
  const { tripExpenses } = useTripExpenses(tripId)
  const { tripMembersMap, currentUserMember } = useTripMembers(tripId)

  const seenIds = new Set<string>()
  let hasInitialized = false

  watch(
    tripExpenses,
    (expenses) => {
      if (!expenses)
        return

      if (!hasInitialized) {
        for (const exp of expenses)
          seenIds.add(exp.id)
        hasInitialized = true
        return
      }

      for (const exp of expenses) {
        if (seenIds.has(exp.id))
          continue
        seenIds.add(exp.id)

        if (exp.isProcessing)
          continue
        if (exp.hasPendingWrites)
          continue
        if (currentUserMember.value && exp.paidByMemberId === currentUserMember.value.id)
          continue

        const memberName = tripMembersMap.value?.[exp.paidByMemberId]?.name ?? 'Someone'
        const description = exp.description ?? 'a new expense'
        const amount = exp.grandTotal ?? 0
        toast(`${memberName} added ${description} — ${amount}`)
      }
    },
    { deep: true, immediate: true },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
pnpm test -- __tests__/useTripExpenseToasts.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add composables/useTripExpenseToasts.ts __tests__/useTripExpenseToasts.test.ts
git commit -m "feat(trip): add useTripExpenseToasts for in-app new-expense notifications"
```

### Task 8: Expose `hasPendingWrites` on the expense converter

**Files:**
- Modify: `utils/converter.ts` (the `expenseConverter.fromFirestore` function, around line 71)
- Modify: `types/index.ts` (the `Expense` interface)

- [ ] **Step 1: Add `hasPendingWrites` to the `Expense` type**

Open `types/index.ts`, find the `Expense` interface, and add an optional `hasPendingWrites?: boolean` field at the end of the interface. (Optional because existing tests/fixtures may not set it.)

- [ ] **Step 2: Set it in the converter**

Open `utils/converter.ts`. In `expenseConverter.fromFirestore`, the `data` is read via `snapshot.data(options)`. The snapshot also has `metadata.hasPendingWrites`. Add to the returned object:

```ts
hasPendingWrites: snapshot.metadata.hasPendingWrites,
```

The final `return { ... } as Expense` block should now include this line alongside `id`, `description`, etc.

- [ ] **Step 3: Manual verification**

```powershell
pnpm dev
```

Open a trip page online. In DevTools Console:

```js
// In any component using the trip expenses:
// JSON.stringify($vm.tripExpenses[0]) — expect hasPendingWrites: false
```

Then throttle to Offline, add a new expense from the UI. The new expense in the list should have `hasPendingWrites: true` until you go back online. Stop dev.

- [ ] **Step 4: Commit**

```powershell
git add utils/converter.ts types/index.ts
git commit -m "feat(firestore): expose hasPendingWrites on Expense for offline-write detection"
```

### Task 9: Wire the toast composable into the trip page

**Files:**
- Modify: `pages/trips/[tripId]/index.vue` (around line 14, near the other composable calls)

- [ ] **Step 1: Call the composable from the page**

Open `pages/trips/[tripId]/index.vue`. After this existing line:

```ts
const { enabledExpenses: recentExpenses } = useTripExpenses(tripId as string, 5)
```

Add:

```ts
useTripExpenseToasts(tripId as string)
```

(No import needed — Nuxt auto-imports composables from `composables/`.)

- [ ] **Step 2: Manual two-tab test**

```powershell
pnpm dev
```

Open the same trip in two browser windows, each signed in as a different trip member (use the dev login helper from `reference_dev_login.md` if needed). In window A, add a new expense. Expected: window B shows a toast `"<member> added <description> — <amount>"` within ~1 second. Window A shows no toast.

- [ ] **Step 3: Commit**

```powershell
git add pages/trips/[tripId]/index.vue
git commit -m "feat(trip): show toast when another member adds an expense"
```

---

## Phase 5 — End-to-End Smoke Tests

### Task 10: Full PWA smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Build production bundle**

```powershell
pnpm build; pnpm preview
```

- [ ] **Step 2: Install PWA and verify instant load**

In Chrome, open the preview URL. Address bar → install icon → Install. Open the installed app. Close it. Reopen it. Expected: shell paints in <500ms with no spinner; trip list populates from Firestore cache within ~1s.

- [ ] **Step 3: Verify offline read**

Inside the installed app, open a trip. Disconnect network (OS-level WiFi off, or DevTools Offline). Reload by closing/reopening the app window. Expected: trip page renders from cache including the expense list.

- [ ] **Step 4: Verify offline write + sync**

Still offline, add a new expense. Expected: row appears immediately in the list with a "Pending sync" visual cue (the `hasPendingWrites` flag is true). Connection pill shows "Offline". Reconnect. Expected: connection pill briefly shows "Syncing…" then disappears; expense's `hasPendingWrites` becomes false; trip total at top of page updates a moment later (after the Cloud Function runs).

- [ ] **Step 5: Verify update prompt**

Change the app version (touch any file, run `pnpm build` again, restart `pnpm preview`). In the still-open installed app, wait up to 60s or trigger an update check by hiding/showing the window after the 5-minute window (for testing, edit the `FIVE_MINUTES_MS` constant temporarily to 5000 to make the focus check trigger fast). Expected: persistent "Update available" toast appears with "Update" action. Click it. Expected: app reloads, "Updated to latest version" toast appears briefly.

- [ ] **Step 6: Verify new-expense toast**

Open the trip in a second browser as a different member. Add an expense there. Expected: the installed app shows a toast `"<member> added <description> — <amount>"` within ~1s. No toast on the writer's side.

- [ ] **Step 7: Mark plan complete**

If all six smoke checks pass, the plan is complete. If any fail, file a follow-up note in the spec file and address before declaring done.

---

## Notes for the implementer

- **Plugin ordering**: `plugins/firestore.client.ts` uses `enforce: 'pre'` plus the name `firestore-persistence`. If a future Nuxt upgrade changes plugin ordering semantics, double-check that this still runs before any `nuxt-vuefire` plugin that touches Firestore.
- **`$pwa.update()` availability**: `@vite-pwa/nuxt` v1.1.x exposes `update()` on `$pwa` as a wrapper around `registration.update()`. If a future version drops that, replace `$pwa?.update?.()` with `navigator.serviceWorker.getRegistration().then(r => r?.update())`.
- **Trip total catch-up after offline write**: documented in the spec — do not attempt client-side recomputation. The total visibly jumps once the Cloud Function in `functions/onExpenseChange.js` runs server-side after sync. This is honest behavior.
- **Currency formatting in toast**: Task 7 uses a raw number for `grandTotal` (e.g. `1200`). This is v1 behavior — the toast is informational and the receipt of a number is unambiguous within the trip's currency context. The unit tests assert this format. If a future polish pass wants `NT$1,200`, route through the same formatter the expense list uses (`pages/trips/[tripId]/index.vue`) and update the test's `expect(...).toContain('1200')` accordingly.
- **No SSR-rendered OG tags**: accepted tradeoff. If a share link's missing OG preview becomes a real complaint, prerender just `/trips/[tripId]` via Nitro's `routeRules` with `prerender: true`.
