# Multi-Image Receipt Upload

## Problem

Long receipts don't fit in one photo. A supermarket or izakaya bill can run well past what
a phone camera captures legibly in a single frame, and today `AddExpenseDrawer` accepts
exactly one `File`. The user's only options are a photo too zoomed-out to read or
hand-entering the items that fell off the frame.

The architectural obstacle is the analysis trigger. `onReceiptUploaded` is an
`onObjectFinalized` handler, so it fires **once per uploaded file**. Three photos would
produce three concurrent invocations, each running its own Gemini call and each
overwriting the same expense document with partial results.

## Design

One expense, N page images, **one** Gemini call that reads them as a single continuous
receipt.

### Data model

`Expense` gains:

| Field | Meaning |
|---|---|
| `imageCount?: number` | How many pages the client promised to upload. Drives the analysis gate. |
| `imageUrls?: string[]` | Ordered resized-page storage paths. Already declared in `types/index.ts:86` and mapped in `utils/converter.ts:89`; previously unused. Becomes the source of truth. |

`receiptImageUrl` keeps holding **page 1** for backward compatibility —
`regression-receipts.js`, `inspect-recent-receipts.js`, and any already-deployed client
read it. No migration: existing expenses have an empty `imageUrls` and are served by the
fallback described under *Viewing*.

### Client — incremental page picker

A native file input replaces its own selection on each pick and therefore cannot append.
The control becomes a hidden input plus visible state:

```
上傳收據（僅支援圖片格式）
┌──────────────────────────────┐
│  📷  選擇收據圖片             │   ← empty state
└──────────────────────────────┘

第 1 頁   IMG_4021.jpg        ✕   ← after picking
第 2 頁   IMG_4022.jpg        ✕
第 3 頁   IMG_4023.jpg        ✕
┌──────────────────────────────┐
│  +  新增頁面                  │
└──────────────────────────────┘
共 3 頁 · 依新增順序辨識；拍攝時請與上一張稍微重疊
```

- `selectedFile: File | null` becomes `selectedFiles: File[]`, appended on each pick.
- `multiple` stays on the input so several pages *can* be grabbed at once, but the
  expected flow is one page at a time via `+ 新增頁面`.
- The input's `value` is cleared after every pick — otherwise re-picking the same file
  fires no `change` event.
- Duplicates are dropped by `name + size + lastModified`.
- Cap of **5** pages, with a `最多 5 頁` toast when a pick would exceed it. Beyond that the
  Gemini call gets expensive and the case stops being realistic.
- Each page is individually removable. Without that, one bad shot means restarting the
  expense.
- Both breakpoint templates get the control: desktop (`AddExpenseDrawer.vue:478`) and
  mobile (`:975`).

The overlap hint in the last line is load-bearing — it is what makes the seam
reconstruction below reliable.

**Page order comes from list position**, i.e. the order the user added them. This is
strictly better than reading a `FileList` in whatever order the OS returns.

### Client — submit

`submitReceipt` writes the expense with `imageCount: n` and `isProcessing: true`, then
uploads each file as `page-1.<ext>` … `page-N.<ext>`.

The drawer closes instantly and uploads continue in the background, matching today's
behavior.

Partial failure is handled by **retrying the failed page** (two further attempts with a
short backoff), not by adjusting `imageCount`. If a page still fails after retries, the
client sets `processingError` and clears `isProcessing` on the expense.

`imageCount` is therefore written exactly once, at creation, and never revised. This
matters: lowering it later would not work, because nothing re-evaluates the gate after the
last storage trigger has already fired and bailed — the expense would strand in 處理中,
which is precisely what lowering the count was meant to avoid. Retrying keeps a single
writer and a single gate.

Analyzing a partial upload was considered and rejected: a missing middle page yields a
confidently wrong grand total, which is worse than telling the user the upload failed.

### Coordination — `onReceiptUploaded.js`

The existing resized-path regex already matches. A transaction is inserted between path
parsing and analysis:

1. Read `imageUrls` (default `[]`) and `imageCount` (default `1`).
2. If a recorded path has the **same page number** as this one, return — the Resize Images
   extension retries, and a re-fired file must not be counted twice. Page number rather
   than exact path, because `IMG_SIZES` and `IMAGE_TYPE` in that extension are
   comma-separated lists configured in the Firebase console and not versioned in this
   repo: if either ever holds two values, one uploaded page yields two distinct resized
   paths. Counting entries would then fire the analysis with a page still missing *and*
   return `analyze` to every later arrival, duplicating Gemini spend. Counting distinct
   page numbers is correct under either configuration, and leaves `imageUrls` holding at
   most one path per page, so the analyzer can never feed the model the same page twice.
   Paths with no `page-N` basename (pre-feature uploads) fall back to exact-path equality,
   so two different legacy filenames are not mistaken for one page.
3. Append the path.
4. **The invocation whose write brings the count of distinct page numbers up to
   `imageCount` is the analyzer.** The transaction guarantees exactly one such write.
   Every other invocation returns having done nothing. The comparison is `>=`, not `===`,
   so an unexpected extra page cannot strand the receipt.

The claim runs with `{ maxAttempts: 10 }` (the default 5 can be exhausted by a 5-page
burst contending on one document) and **inside** error handling. A rejected transaction
would otherwise escape the handler: the trigger is registered without `retry`, the other
invocations have already bailed, and nothing re-evaluates the gate — so the expense would
sit in 處理中 forever with no error recorded. The caller instead logs a `claim_error`
outcome and writes `processingError`. Enabling `retry: true` on the trigger was considered
and declined: redelivery is safe for the claim itself, but the same flag would also retry
Gemini failures, multiplying AI spend on exactly the receipts that already failed.

The analyzer sorts paths by the integer parsed out of `page-(\d+)` in the filename — not
by arrival order, so a slow upload cannot scramble pages — downloads all pages, and makes
a single Gemini call. It passes the first sorted path to `prepareFirestoreUpdateData` as
`receiptImageUrl`, so that field is written by exactly one writer, in the same update as
the analysis results.

Single-page upload is just `imageCount: 1`: same code path, no special case.

The structured `receipt_extraction` log event gains `pageCount`.

### AI call — `receiptAnalysis.js`

`analyzeReceiptWithAI(images, tripCurrency, defaultCurrency)` where `images` is
`[{ base64, contentType }]`. Three call sites update: `onReceiptUploaded`,
`reanalyzeReceipt`, `regression-receipts`.

#### Labeled image parts

Text and image parts interleave so each image announces its own position:

```
--- IMAGE 1 of 3 (receipt continues onto IMAGE 2) ---                 [image 1]
--- IMAGE 2 of 3 (continues from IMAGE 1, continues onto IMAGE 3) --- [image 2]
--- IMAGE 3 of 3 (final section) ---                                  [image 3]
```

Unlabeled, N inline images are just N images and the model guesses which edge joins which.

#### Seam rules

`generatePrompt` takes a page count and adds these rules only when `pageCount > 1`:

1. These are photos of **one continuous receipt**, top to bottom, in the order given — not
   separate receipts.
2. The bottom of an image often **cuts a line mid-way**: name legible, price off-frame, or
   text clipped. That line usually appears complete at the top of the next image. Emit it
   **once**, taking values from whichever image shows it complete — the one with a printed
   amount wins.
3. A line fully visible in **both** images (the overlap region) is **one** item, not two.
4. Totals, tax, and `printedItemCount` are read **once**, from wherever printed — usually
   the final image.

#### Unresolvable seams

`receiptSchema` gains `pageBreakUncertain: z.boolean().nullable()`. When a line is cut at a
seam and cannot be reconstructed from the next image, the model emits its best reading and
sets this true.

- `reconcileReceipt` turns `pageBreakUncertain === true` into a new reason code
  `page_break_uncertain`, added to both `REASON_CODES` and `WARNING_CODES`, so
  `needsReview` fires.
- `ExpenseReviewBanner.vue` gains the message `跨頁交接處可能有項目被截斷，請確認明細` and
  the code in its local `WARNING_CODES`.
- `prepareFirestoreUpdateData` strips the raw `pageBreakUncertain` before writing, the same
  way it strips `currency` today. The signal lives in `reviewReasons`.

#### Existing safety net

When a receipt prints its own item count (点数 / 合計点数 / Items: N), the existing
`item_count_mismatch` check catches a seam item that was dropped *or* double-counted — for
free, with no new code. This is the strongest available verification that stitching worked.

### Reanalyze — `reanalyzeReceipt.js`

Reads `imageUrls`, falling back to `[receiptImageUrl]` for pre-feature expenses, downloads
every page, and makes one call. The failed-precondition check becomes "has no receipt image
at all" rather than "has no `receiptImageUrl`".

The expense detail page's enable condition (`index.vue:599`) becomes "has any receipt
image".

### Viewing

`receiptImageUrl` (the single `computedAsync` at `index.vue:304`) becomes
`receiptImageUrls`, mapping every path in `imageUrls` through `getDownloadURL`, and falling
back to `[receiptImageUrl]` when `imageUrls` is empty.

The 收據圖片 card stacks each page vertically, labeled `第 N 頁` when there is more than
one. Tapping page *i* opens `ReceiptViewer` at index *i*.

`ReceiptViewer.vue` takes `srcs: string[]` plus a start index. Navigation is **prev/next
buttons with a `2 / 3` indicator, plus keyboard arrows** — not swipe. The viewer runs
Panzoom, where horizontal drag already means *pan the zoomed image*; a swipe handler would
fight the gesture that makes a zoomed receipt inspectable in the first place. Panzoom is
re-initialized on page change (`initPanzoom` already destroys and rebuilds, and
`fitImageToStage` re-fits per image).

## Testing

`functions/` uses `node --test`. Unit tests, no AI calls:

- **Page sort** — out-of-order arrival, a missing page number, a duplicate path.
- **Multi-page prompt** — labels and seam rules present when `pageCount > 1` and absent
  when it is 1.
- **Reconcile** — `pageBreakUncertain: true` produces `page_break_uncertain` and sets
  `needsReview`; `false` / `null` produce neither.

The transaction gate is tested against the Firestore emulator via the existing
`pnpm test:emulator`: concurrent appends elect exactly one analyzer, a duplicate path
elects none, and an incomplete set elects none.

## Known limitation

If the Resize Images extension silently fails on a page, the expense sits in 處理中
indefinitely. This is already true for single uploads, so no new failure mode is
introduced — but N pages give it N times the opportunity. The fix, if it proves annoying in
practice, is a stalled-upload retry banner on the expense detail page; deliberately out of
scope here.

## Out of scope

- Thumbnail previews and drag-to-reorder in the picker (order is controlled by add order).
- Swipe navigation in the receipt viewer (Panzoom gesture conflict).
- Client-side stitching of pages into one tall image (destroys small print on downscale,
  and loses per-page viewing).
- A stalled-upload retry banner.
