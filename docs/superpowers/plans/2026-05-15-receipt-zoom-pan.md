# Receipt Image Zoom & Pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users tap the receipt image on the expense detail page to open a fullscreen viewer with pinch-zoom and pan.

**Architecture:** New self-contained `components/ReceiptViewer.vue` that wraps `@panzoom/panzoom` inside an existing `ui-dialog` overridden to fullscreen. The expense detail page replaces its inline `<img>` with a `<button>` that opens the viewer.

**Tech Stack:** Vue 3 / Nuxt 4, `reka-ui` Dialog (via shadcn-vue `ui-dialog`), `@panzoom/panzoom`, Tailwind CSS v4.

**Spec:** [`docs/superpowers/specs/2026-05-15-receipt-zoom-pan-design.md`](../specs/2026-05-15-receipt-zoom-pan-design.md)

---

## File Structure

- **Create:** `components/ReceiptViewer.vue` — fullscreen image viewer; self-contained; owns the Panzoom instance, lifecycle, and close affordances.
- **Modify:** `pages/trips/[tripId]/expenses/[expenseId]/index.vue` — swap the inline `<img>` for a `<button>` wrapping the same `<img>`, add an `isViewerOpen` ref, mount `<receipt-viewer>` near the other dialogs.
- **Modify:** `package.json` / `pnpm-lock.yaml` — add `@panzoom/panzoom` dependency.

There are no automated tests for this feature; verification is manual (see Task 5).

---

## Task 1: Add the `@panzoom/panzoom` dependency

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install the package**

Run:
```bash
pnpm add @panzoom/panzoom
```

Expected: `@panzoom/panzoom` appears under `dependencies` in `package.json`, and `pnpm-lock.yaml` updates. No build errors.

- [ ] **Step 2: Sanity-check the install**

Run:
```bash
pnpm list @panzoom/panzoom
```

Expected: prints a single version line (e.g. `@panzoom/panzoom 4.x.x`).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @panzoom/panzoom for receipt viewer"
```

---

## Task 2: Create the `ReceiptViewer` component skeleton

Build the component end-to-end as a single coherent unit. This task delivers a working viewer with all gesture handling, edge cases, and styling described in the spec.

**Files:**
- Create: `components/ReceiptViewer.vue`

- [ ] **Step 1: Create the file with the full component**

Create `components/ReceiptViewer.vue` with this exact content:

```vue
<script setup lang="ts">
import type Panzoom from '@panzoom/panzoom'
import { default as createPanzoom } from '@panzoom/panzoom'

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  alt?: string
}>(), {
  alt: '收據圖片',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const stage = ref<HTMLDivElement | null>(null)
const image = ref<HTMLImageElement | null>(null)
const isLoading = ref(true)
const hasError = ref(false)

let panzoom: ReturnType<typeof Panzoom> | null = null
let prefersReducedMotion = false

function close() {
  emit('update:open', false)
}

function onWheel(event: WheelEvent) {
  if (!panzoom) return
  panzoom.zoomWithWheel(event)
}

function onDoubleClick(event: MouseEvent) {
  if (!panzoom) return
  const current = panzoom.getScale()
  if (current > 1.01) {
    panzoom.reset()
  } else {
    panzoom.zoomToPoint(2, event)
  }
}

function destroyPanzoom() {
  if (!panzoom) return
  panzoom.destroy()
  panzoom = null
  stage.value?.removeEventListener('wheel', onWheel)
  stage.value?.removeEventListener('dblclick', onDoubleClick)
}

function initPanzoom() {
  if (!image.value || !stage.value) return
  if (panzoom) destroyPanzoom()

  panzoom = createPanzoom(image.value, {
    maxScale: 8,
    minScale: 1,
    contain: 'outside',
    step: 0.3,
    animate: !prefersReducedMotion,
    cursor: 'grab',
  })

  stage.value.addEventListener('wheel', onWheel, { passive: false })
  stage.value.addEventListener('dblclick', onDoubleClick)
}

function onImageLoad() {
  isLoading.value = false
  hasError.value = false
  nextTick(() => initPanzoom())
}

function onImageError() {
  isLoading.value = false
  hasError.value = true
}

watch(() => props.open, (open) => {
  if (open) {
    isLoading.value = true
    hasError.value = false
    if (typeof window !== 'undefined') {
      prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  } else {
    destroyPanzoom()
  }
})

onBeforeUnmount(() => {
  destroyPanzoom()
})
</script>

<template>
  <ui-dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <ui-dialog-content
      :show-close-button="false"
      class="!fixed !inset-0 !top-0 !left-0 !translate-x-0 !translate-y-0 !grid-cols-1 !max-w-none !w-screen !h-dvh !rounded-none !border-0 !p-0 !bg-black/95 !gap-0"
    >
      <ui-dialog-title class="sr-only">收據圖片</ui-dialog-title>

      <button
        type="button"
        aria-label="關閉"
        class="absolute z-10 top-safe right-3 mt-3 inline-flex items-center justify-center rounded-full bg-white/10 text-white w-10 h-10 backdrop-blur hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
        @click="close"
      >
        <Icon name="lucide:x" :size="20" />
      </button>

      <div
        v-if="isLoading"
        class="absolute inset-0 flex items-center justify-center text-white pointer-events-none"
      >
        <Icon name="lucide:loader-2" :size="32" class="animate-spin" />
      </div>

      <div
        v-if="hasError"
        class="absolute inset-0 flex items-center justify-center text-white text-sm"
      >
        無法載入圖片
      </div>

      <div
        ref="stage"
        class="w-screen h-dvh overflow-hidden touch-none select-none overscroll-contain flex items-center justify-center"
      >
        <img
          ref="image"
          :src="src"
          :alt="alt"
          class="block w-auto h-auto max-w-screen max-h-dvh"
          draggable="false"
          @load="onImageLoad"
          @error="onImageError"
        >
      </div>
    </ui-dialog-content>
  </ui-dialog>
</template>
```

Notes on the implementation:
- **Why `!` prefixes on the override classes:** `DialogContent.vue` uses `cn()` (tailwind-merge), which normally lets later classes win, but its base class string is a single long string with many position/sizing utilities. Using `!important` is the cleanest way to guarantee fullscreen override without forking the component.
- **Why `top-safe`:** the project depends on `tailwindcss-safe-area`, which exposes `top-safe` for `env(safe-area-inset-top)`.
- **Why `passive: false` on wheel:** Panzoom needs to `preventDefault()` to stop the page from scrolling when zooming with the trackpad.
- **Why `nextTick` before init:** wait for the image's intrinsic dimensions to be reflected in layout so `contain: 'outside'` computes bounds correctly.

- [ ] **Step 2: Verify the file compiles**

Run:
```bash
pnpm dev
```

Wait for "Nuxt is ready" output. Look for any TypeScript or Vue compiler errors mentioning `ReceiptViewer.vue` in the dev server output. If you see errors, fix them before moving on. Stop the dev server (`Ctrl+C`) when done.

Expected: No compiler errors for `ReceiptViewer.vue`. (The component is not yet used anywhere, so it won't actually render yet — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add components/ReceiptViewer.vue
git commit -m "feat(ui): add ReceiptViewer fullscreen zoom/pan component"
```

---

## Task 3: Wire the viewer into the expense detail page

**Files:**
- Modify: `pages/trips/[tripId]/expenses/[expenseId]/index.vue`

- [ ] **Step 1: Add the `isViewerOpen` ref**

In `pages/trips/[tripId]/expenses/[expenseId]/index.vue`, find the block of `ref` declarations around line 42-60 (the existing flags like `showDeleteDialog`, `isReanalyzing`, `editingItemIndex`, etc.). Add this line at the end of that block, after `isApplyingDiscount`:

```ts
const isReceiptViewerOpen = ref(false)
```

Use Edit to add it after the last `ref(false)` line in that group. If you're not sure which line is last, use Grep to find `isApplyingDiscount = ref` and add the new line directly below it.

- [ ] **Step 2: Replace the inline `<img>` with a button trigger**

Currently at line 857:

```vue
<img :src="receiptImageUrl" alt="收據圖片" loading="lazy" class="w-full max-h-96 object-contain rounded-lg">
```

Replace that line with:

```vue
<button
  type="button"
  aria-label="放大檢視收據"
  class="block w-full cursor-zoom-in rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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

- [ ] **Step 3: Mount the viewer near the bottom of the template**

Find the cluster of dialogs near the bottom of the template (search for `<expense-tax-deduction-dialog`). After the existing `</ui-alert-dialog>` block that closes out the discount/tax dialogs — i.e. just before the page's outermost closing `</div>` and `</template>` — add this:

```vue
<receipt-viewer
  v-if="receiptImageUrl"
  v-model:open="isReceiptViewerOpen"
  :src="receiptImageUrl"
/>
```

Place it as a sibling of the other dialogs (not nested inside any of them). It must be inside the page's outer wrapper element but outside any other dialog. If you're unsure where to put it, place it on a new line directly after the closing `</ui-alert-dialog>` that follows `showRevertDiscountDialog`.

- [ ] **Step 4: Verify the page compiles**

Run:
```bash
pnpm dev
```

Wait for "Nuxt is ready." Expected: no compiler errors mentioning `[expenseId]/index.vue` or `ReceiptViewer`. Leave the dev server running for the next task.

- [ ] **Step 5: Commit**

```bash
git add pages/trips/\[tripId\]/expenses/\[expenseId\]/index.vue
git commit -m "feat(ui): open receipt in fullscreen zoom/pan viewer"
```

---

## Task 4: Lint & typecheck

**Files:**
- (No file changes — verification only)

- [ ] **Step 1: Lint the changed files**

Run:
```bash
pnpm exec eslint components/ReceiptViewer.vue "pages/trips/[tripId]/expenses/[expenseId]/index.vue"
```

Expected: exit code 0, no errors. If there are warnings about kebab-case (e.g. `<UiDialog>` instead of `<ui-dialog>`), fix them — the project's ESLint config enforces kebab-case in templates. If there are unused-import warnings in `ReceiptViewer.vue`, fix them.

- [ ] **Step 2: If any lint errors were fixed, amend or follow-up commit**

If you made lint fixes:
```bash
git add components/ReceiptViewer.vue "pages/trips/[tripId]/expenses/[expenseId]/index.vue"
git commit -m "fix(lint): satisfy eslint for receipt viewer"
```

If lint passed clean, skip this step.

---

## Task 5: Manual verification

**Files:**
- (No file changes — verification only)

The feature is UI-only and gesture-driven, so verify by exercising it in a browser.

- [ ] **Step 1: Start the dev server (if not running)**

Run:
```bash
pnpm dev
```

Wait for "Nuxt is ready" and note the URL (typically http://localhost:3000).

- [ ] **Step 2: Navigate to an expense with a receipt image**

Open the app in Chrome. Log in. Open a trip with at least one expense that has a receipt image attached. If none exists, create one by uploading a receipt photo to a new expense and waiting for processing to complete.

- [ ] **Step 3: Desktop interactions**

In the expense detail page, scroll to the 收據圖片 card. Verify:
- Hovering the image shows the `cursor-zoom-in` cursor.
- Clicking the image opens a fullscreen black overlay with the image centered and fit to the viewport.
- The close button is visible in the top-right corner.
- Scrolling the mouse wheel over the image zooms in/out about the cursor.
- Dragging the image while zoomed in pans it.
- Dragging while at 1× (fit) does nothing (image stays put).
- Double-clicking toggles between fit and 2×.
- Pressing `Escape` closes the viewer.
- Clicking the X button closes the viewer.
- After closing, the page is back at the same scroll position with no visible flicker.

- [ ] **Step 4: Mobile interactions (DevTools mobile emulation)**

Open Chrome DevTools, toggle device toolbar, pick iPhone 14 Pro or similar. Reload the page. Verify:
- Tapping the receipt thumbnail opens the viewer.
- Pinching with two finger gestures (Cmd/Ctrl + drag in DevTools) zooms.
- Dragging while zoomed pans.
- Double-tapping toggles fit ↔ 2×.
- The page underneath does NOT scroll while the viewer is open (touch-none works).
- Tapping the X button closes.

- [ ] **Step 5: Reduced-motion check**

In Chrome DevTools, open the Command Palette (Ctrl/Cmd+Shift+P), run "Show Rendering", and enable "Emulate CSS media feature prefers-reduced-motion: reduce". Reload, open the viewer, double-click to zoom in. Expected: the zoom is instantaneous, no animated transition.

Disable reduced motion when done.

- [ ] **Step 6: Error path**

In DevTools Network tab, set throttling to "Offline". Open a different expense's receipt viewer. Expected: spinner appears briefly, then "無法載入圖片" message. The X close button still works.

Restore "Online" throttling when done.

- [ ] **Step 7: Stop the dev server**

`Ctrl+C` in the terminal running `pnpm dev`.

- [ ] **Step 8: Report results**

If any check failed, file a follow-up: describe what broke and where. If everything passed, the feature is complete — proceed to Task 6.

---

## Task 6: Finalize

**Files:**
- (No file changes)

- [ ] **Step 1: Confirm clean working tree**

Run:
```bash
git status
```

Expected: no uncommitted changes. If there are leftover changes from manual verification (e.g. accidental edits), revert or commit them as appropriate.

- [ ] **Step 2: Confirm commit log**

Run:
```bash
git log --oneline -5
```

Expected to see (in reverse order):
1. `feat(ui): open receipt in fullscreen zoom/pan viewer`
2. `feat(ui): add ReceiptViewer fullscreen zoom/pan component`
3. `chore: add @panzoom/panzoom for receipt viewer`
4. (optional) `fix(lint): satisfy eslint for receipt viewer` — only if Task 4 produced fixes.
5. `docs(spec): receipt image zoom & pan viewer design`

If the order is wrong or commits are missing, investigate before declaring done.
