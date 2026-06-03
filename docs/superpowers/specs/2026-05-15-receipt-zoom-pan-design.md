# Receipt Image Zoom & Pan — Design Spec

**Date:** 2026-05-15
**Status:** Draft

## Problem

The receipt image on the expense detail page (`pages/trips/[tripId]/expenses/[expenseId]/index.vue:857`) is rendered inline at `max-h-96 object-contain`. Receipts often contain small print — totals, line items, tax breakdowns — that the user wants to verify against the parsed items. Today there's no way to look closer without leaving the app to open the image in a new tab.

## Goal

Let the user tap the receipt thumbnail to open a fullscreen viewer where they can pinch-zoom and pan to read any part of the image, then dismiss back to the expense detail.

## Non-goals

- Swiping between multiple receipt images. The data model has `imageUrls[]` but only the first is currently rendered; multi-image handling is out of scope.
- Rotation, download, share, crop, or any image editing.
- Annotating the receipt or linking pan position back to parsed items.

## User flow

1. On the expense detail page, the receipt image card shows the thumbnail as today, but with a `cursor-zoom-in` affordance and a subtle hover hint (no change to the surrounding card chrome).
2. User taps (or clicks) the image → fullscreen overlay opens, image centered and fitted to the viewport.
3. Inside the overlay:
   - **Pinch** (touch) zooms in/out about the gesture centroid.
   - **Wheel / trackpad pinch** zooms in/out about the cursor.
   - **Double-tap / double-click** toggles between fit-to-screen and a 2× zoom centered on the tap point.
   - **Drag** pans when zoomed in. When at fit-to-screen scale, drag does nothing.
   - **Close** via an `X` button (top-right, safe-area aware), `Escape` key, or backdrop click on empty space.
4. Closing returns the user to the expense detail with scroll position preserved.

## Technical approach

### Library

Use **`@panzoom/panzoom`** (timmywil/panzoom). Rationale:
- Vanilla, framework-agnostic — no Vue-specific quirks, attaches to a DOM element on mount and detaches on unmount.
- Built-in handling for pinch, wheel, drag, double-tap, bounds, min/max scale.
- TypeScript types ship with the package.
- ~5 kB gzipped, no peer dependencies.
- Avoids competing with `ui-dialog` chrome (which all-in-one viewers like PhotoSwipe or v-viewer would do).

Install: `pnpm add @panzoom/panzoom`.

### Containing modal

Use the existing **`ui-dialog`** (Reka UI under the hood) for the fullscreen overlay. It already gives us:
- Focus trap and `Escape`-to-close.
- Themed overlay (`DialogOverlay`).
- Portal rendering so it sits above all page content.
- Accessibility attributes (`role="dialog"`, labelled title).

We bypass the default centered card styling of `DialogContent` by passing custom classes — `tailwind-merge` (via `cn()` in `DialogContent.vue`) resolves the override of `top-[50%] left-[50%] translate-*`, `rounded-lg`, `border`, `p-6`, `max-w-*`, etc. The dialog becomes fullscreen, edge-to-edge, with a black backdrop. We pass `:show-close-button="false"` to suppress the built-in close button (which uses `top-4 right-4` and ignores iOS safe areas) and render our own safe-area-aware close button instead. The dialog gets an accessible title ("收據圖片") visually hidden via `sr-only`.

### Component

Create `components/ReceiptViewer.vue` — a self-contained fullscreen image viewer.

**Props**
- `open: boolean` — controlled open state.
- `src: string` — image URL.
- `alt?: string` — defaults to "收據圖片".

**Events**
- `update:open` — emitted on close (X button, Escape, backdrop click).

**Internal structure**
```
<ui-dialog :open="open" @update:open="…">
  <ui-dialog-content class="fullscreen black backdrop, no rounded card chrome">
    <ui-dialog-title class="sr-only">收據圖片</ui-dialog-title>
    <button class="absolute top-safe right-3 …" @click="close">
      <Icon name="lucide:x" />
    </button>
    <div ref="stage" class="w-screen h-dvh overflow-hidden touch-none select-none">
      <img ref="image" :src="src" :alt="alt" class="block max-w-none">
    </div>
  </ui-dialog-content>
</ui-dialog>
```

**Lifecycle**
- On mount (or when `open` flips to `true`): wait for image `load` event, then instantiate Panzoom on the `<img>` with options:
  - `maxScale: 8`
  - `minScale: 1` (fit-to-screen is scale 1; we size the image via CSS so it fits initially)
  - `contain: 'outside'` for natural pan bounds
  - `step: 0.3`
  - `animate: true`
  - Default `cursor: 'grab'` → `'grabbing'` on drag
- Bind `wheel` to the stage so trackpad/mouse-wheel zooms.
- Bind a `dblclick`/`dbltap` handler that toggles between scale 1 and scale 2 at the pointer position via `zoomToPoint`.
- On unmount or when `open` flips to `false`: call `panzoom.destroy()` and detach listeners.

**Initial fit**
We want scale 1 in Panzoom to mean "fits the viewport," so we size the `<img>` *element box* itself to fit the viewport via CSS: `max-w-screen max-h-dvh w-auto h-auto`. The image's natural aspect ratio is preserved, and its layout dimensions equal the largest box that fits inside the viewport — which is exactly what scale 1 represents in Panzoom. With `contain: 'outside'`, pan is naturally constrained to zero translation at scale 1 and opens up as the user zooms in. We delay Panzoom instantiation until the image's `load` event has fired so layout has settled and bounds are computed correctly.

**Background touch behavior**
- `touch-none` on the stage so the browser doesn't try to scroll/zoom the page itself.
- `overscroll-contain` to prevent pull-to-refresh on iOS Safari (PWA standalone mode also needs this).

### Integration on the expense detail page

In `pages/trips/[tripId]/expenses/[expenseId]/index.vue`:
- Add `const isViewerOpen = ref(false)` to the script setup block.
- Replace the existing `<img>` at line 857 with a `<button>` wrapping the same `<img>`, semantically clickable, with `cursor-zoom-in` and an `aria-label="放大檢視收據"`.
- Render `<receipt-viewer v-model:open="isViewerOpen" :src="receiptImageUrl" />` once at the bottom of the page near the other dialogs.
- Tap → set `isViewerOpen.value = true`.

The thumbnail layout (`w-full max-h-96 object-contain rounded-lg`) is unchanged.

### Edge cases

- **Image not yet loaded when viewer opens.** Show a centered spinner (`lucide:loader-2 animate-spin`) until `img.complete` is true, then init Panzoom. If the image errors, show "無法載入圖片" text and a close button only.
- **Very wide or tall receipts.** `contain: 'outside'` makes Panzoom keep the image edges within the viewport when zoomed in enough to fill it; below that, the image stays centered. This is the natural "Photos app" feel.
- **Rapid open/close.** Guard `panzoom.destroy()` with a null check; ignore double-emits of `update:open`.
- **Reduced motion preference.** When `prefers-reduced-motion: reduce` is set, pass `animate: false` to Panzoom so zoom transitions are instantaneous.
- **Keyboard a11y.** The trigger is a real `<button>`, so Enter/Space open the viewer. Inside the viewer, focus is trapped by `ui-dialog`; the close button is the first focusable element.

## Testing

This is a UI-only feature touching one page and one new component. Verification plan:

1. **Manual on desktop** (Chrome): click image → fullscreen opens → wheel zooms → drag pans → double-click toggles → Escape closes.
2. **Manual on mobile** (DevTools mobile emulation, plus real device if available): tap → opens → pinch → pan → double-tap toggle → X button closes. Confirm page underneath does not scroll while viewer is open and pull-to-refresh is disabled in the viewer.
3. **Tall and wide receipts**: spot-check with two real receipt images of different aspect ratios.
4. **Reduced motion**: enable in OS, confirm zoom snaps without animation.

No automated tests added — the value here is interaction feel, which isn't well captured by unit tests, and the integration is shallow (one wrapper component + one prop swap).

## Out of scope (future work)

- Multi-image gallery if/when expenses support multiple receipts.
- Sharing or downloading the receipt image.
- Highlighting parsed line items by tapping on them in the zoomed view.
