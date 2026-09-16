# Trip Access Control

## Problem

A review of the invitation system found three gaps and two missing owner controls:

1. **Invitations are world-readable.** `firestore.rules` has `allow read: if true` on `invitations`, which covers list queries. Anyone with the public Firebase config can enumerate every pending code across all trips and accept it via `/api/invitations/accept`.
2. **Anonymous users get editor.** `accept.post.ts` and `join.post.ts` never check `user.isAnonymous`. The invite/join pages require Google login, but the APIs don't, so an anonymous session can accept a personal invite or public join link and receive `role: 'editor'` instead of `guest`.
3. **Accept/join are not atomic.** The collaborator doc is written before the member choice is validated. A bogus or already-linked `memberId` leaves an `editor` collaborator doc behind, without a `collaboratorUserIds` entry and without consuming the invitation. `isCollaborator()` in the rules only checks doc existence, so that user can create/update/delete expenses in a trip they can't read. A genuine user who hits this is locked out ("already a collaborator"). Concurrent accepts can also exceed `maxUses`.
4. **No read-only access.** Every collaborator can add expenses. Owners want to share a trip with people who should only view it.
5. **No way to remove someone.** Revoking an invitation only stops future uses. The collaborators list is display-only; the public join code can never be rotated.

Related: the `reanalyzeReceipt` callable has no auth check at all, so it would bypass any read-only restriction.

## Decisions

| Question | Decision |
|---|---|
| Who can be made read-only? | Every collaborator except the owner (guests and editors). |
| How is read-only modelled? | A `readOnly` flag orthogonal to `role`, so turning it off restores exactly the previous access, and guest→editor upgrade is unaffected. |
| Can a removed person rejoin via a link they still hold? | Yes (same as Google Docs/Notion). The owner revokes invites and resets the public link to keep them out. A ban list can't stop anonymous guests anyway. |
| View-only invite links? | Yes — a per-link option at creation. The public join link always grants normal editor access. |
| Where do owner actions run? | Server endpoints (Admin SDK), like existing `invitations/*` and `leave.post.ts`. Rules stay the backstop. |
| How do invite pages look up a code? | New server preview endpoint. Existing codes keep working; no migration. |

## Data Model

**`trips/{tripId}/collaborators/{uid}`** — add `readOnly: boolean`. Missing means `false`. Never set on the owner.

**`invitations/{id}`** — add `viewOnly: boolean`. Missing means `false`. Accepting copies it to the new collaborator's `readOnly`.

**Codes** — new `server/utils/codes.ts` exports `generateCode()`: 10 characters from `crypto.randomBytes` over an unambiguous alphabet (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`). Callers check the code is unused and retry on collision. Used for new invitation codes, first-time public join codes, and public link resets. Existing 6/8-character codes stay valid.

**Types** — `NewTripCollaborator.readOnly?: boolean`, `NewInvitation.viewOnly?: boolean`; `tripCollaboratorConverter` and `invitationConverter` default both to `false`.

## Enforcement

### Firestore rules

```
function collaboratorDoc(tripId) {
  return get(/databases/$(database)/documents/trips/$(tripId)/collaborators/$(request.auth.uid));
}
function canWrite(tripId) {
  return isCollaborator(tripId)
    && request.auth.uid in get(/databases/$(database)/documents/trips/$(tripId)).data.collaboratorUserIds
    && collaboratorDoc(tripId).data.get('readOnly', false) != true;
}
```

Requiring `collaboratorUserIds` membership as well as the collaborator doc makes any half-joined collaborator docs already in production (from gap 3) inert.

- **Invitations:** `allow read: if request.auth != null && isOwner(resource.data.tripId);` (was `if true`). Create/update/delete: `if false` — only server routes write invitations, and the old owner-only update rule let an owner retarget an invitation for their own trip at someone else's trip and then accept it. No client code reads invitations after this change.
- **Expense updates** keep `createdByUserId` unchanged, so nobody can reassign who created an expense (and with it, guest edit rights).
- **Expenses:** `create` requires `canWrite(tripId)` plus the existing `createdByUserId` check. `update, delete` require `canWrite(tripId)` plus the existing role-or-creator check.
- **Members:** unchanged. Read-only users can still edit their own linked member's `name`/`avatarEmoji` — that's their profile, not the ledger.
- **Collaborators:** unchanged (owner may write; server handles joins/removals).

### Server

- **`functions/reanalyzeReceipt.js`:** require `request.auth` (`unauthenticated`), then read the caller's collaborator doc; throw `permission-denied` unless it exists, is not `readOnly`, and the caller is owner/editor or the expense's `createdByUserId`. Mirrors the expense update rule.
- **`server/api/auth/upgrade.post.ts`:** unchanged behaviour — it only changes `role`, so `readOnly` carries over.

## Endpoints

### `GET /api/invitations/preview?code=` (new, no auth)

Returns what the invite/guest pages need before login, and nothing else:

```ts
{
  state: 'valid' | 'expired' | 'revoked' | 'used'
  type: 'personal' | 'guest'
  viewOnly: boolean
  tripName: string
  invitedByName: string
  expiresAt: string // ISO
}
```

404 if no invitation has that code. `state` is computed server-side (expiry from `expiresAt`, `used` when `maxUses !== null && usedCount >= maxUses`). `pages/invite/[code].vue` and `pages/guest/[code].vue` switch from `getInvitationByCode()` (Firestore query, removed) to this endpoint. The guest page's "already a member → redirect" uses `tripId` from `/api/invitations/members`, which already returns it.

### `GET /api/invitations/members` (changed)

Uses `getInvitationState` (must be `valid`) instead of `status === 'pending'`, so unlimited links the old `?? 1` bug marked `accepted` work again; returns **403** to anonymous sessions on personal invitations.

### `POST /api/invitations/create` (changed)

Accepts `viewOnly?: boolean`; stores it; uses `generateCode()`.

### `POST /api/invitations/accept` (changed)

All reads and writes run in one `db.runTransaction`. Reads first: invitation (query by code), trip, the caller's collaborator doc, and the chosen member doc if `memberId` is given. Then validate, in this order:

1. Invitation exists, not revoked, not expired, has uses left, caller hasn't used it.
2. `type !== 'guest' && user.isAnonymous` → **403** "Sign in with Google to accept this invitation".
3. The trip exists, and the invitation was issued by its owner (`invitedByUserId == trip.userId`) → otherwise **403** — defence in depth against invitations forged before the rules change. Checked before anything else about the trip, so a forged invitation can't be used to probe it.
4. Caller is not the trip owner, and not already a collaborator (so a read-only collaborator can't re-accept to shed `readOnly`).
5. If `memberId`: it's a plain id string, the member exists and has no `linkedUserId`.

Step 1's "caller hasn't used it" check (`usedByUserIds`) means a removed person can't rejoin through an invitation they already used; a different link, or the public link, still works.

Only if all pass: write the collaborator doc (`role` = `guest` for guest invites else `editor`; `readOnly` = invitation `viewOnly`), link or create the member, update invitation usage, and add the caller to `collaboratorUserIds` / increment `collaboratorCount`. Any failure writes nothing. Exception: an expired invitation still gets `status: 'expired'` committed, then the handler returns 400. Existing status codes and messages are kept for existing failure cases.

### `POST /api/trips/join` (changed)

Same transaction treatment (query trip by `publicJoinCode` inside the transaction). `user.isAnonymous` → **403**. Joiners get `role: 'editor'`, `readOnly: false`.

### `PATCH /api/trips/[tripId]/collaborators/[userId]` (new)

Body `{ readOnly: boolean }`. 401 unauthenticated; 403 caller isn't the trip owner; 400 target is the owner; 404 target isn't a collaborator. Updates `readOnly` only.

### `DELETE /api/trips/[tripId]/collaborators/[userId]` (new)

401/403 as above; 400 target is the owner; 404 target isn't a collaborator. Calls the shared helper below.

### `server/utils/collaborators.ts` → `removeCollaborator(db, tripId, userId)` (new)

One transaction: read the collaborator doc and members where `linkedUserId == userId`; delete the collaborator doc; delete `linkedUserId` on those members; `arrayRemove` from `collaboratorUserIds`, and decrement `collaboratorCount` only when the uid was actually in that array (half-joined docs were never counted). The member entries and the person's expenses stay. `server/api/trips/leave.post.ts` is refactored to use it.

It also records the departure at `trips/{tripId}/departed/{uid}` = `{ readOnly, departedAt }`. Accept and join read that record and re-apply `readOnly` to the returning collaborator, then clear it — otherwise a view-only collaborator could shed the restriction by leaving and rejoining through the public link (whose code every collaborator can read from the trip doc) or through any normal invitation. Clients can't touch this subcollection: unlisted paths are denied by default.

### `POST /api/trips/reset-public-link` (new)

Body `{ tripId }`. Owner only. Writes a fresh `generateCode()` to `publicJoinCode`; returns `{ publicJoinCode }`. The old `/join/<code>` URL then 404s. `toggle-public-invite.post.ts` switches to `generateCode()` for first-time codes.

## UI

All copy in Traditional Chinese, matching the app.

### Trip settings → Collaborators tab (`pages/trips/[tripId]/edit.vue`)

For the owner, each non-owner row gets:
- a `ui-switch` labelled 「可編輯」 (on = `readOnly: false`). Optimistic update via the PATCH endpoint; on failure revert and toast 「更新權限失敗」.
- a remove icon button (`lucide:user-minus`) opening an alert dialog: title 「移除 {name}？」, body 「對方將無法再查看此行程，他們建立的支出會保留。」, actions 取消 / 移除. On success toast 「已移除 {name}」.

Non-owners see the list read-only, with a 「僅檢視」 badge next to view-only people.

### Public link section (same page)

When a code exists, a 「重設連結」 button next to the copy button, confirming via alert dialog 「重設後，舊的連結將失效。」.

### Invite modal (`components/InviteCollaboratorsModal.vue`)

Both tabs' create sections (desktop dialog and mobile drawer) get a 「僅檢視」 switch, default off, passed as `viewOnly`. Links created view-only show a 「僅檢視」 badge in the lists. The create API response and `listInvitations` include `viewOnly`.

### Invite / guest pages

When `viewOnly`, show 「你將以僅檢視身份加入」 under the trip name.

### View-only user experience

`useTripCollaborators` adds `isReadOnly` (`currentUserCollaborator.readOnly && !isOwner`). When true, `canAddExpenses`, `canManageExpenses`, `canEditExpense()` and `canDeleteExpense()` all return `false`. The bottom bar already shows a lock icon when `canAddExpenses` is false. The trip overview page shows a quiet muted line with `lucide:eye`: 「你目前僅能檢視此行程」.

### Removed while viewing

A new `useRemovedFromTripRedirect(tripId)` composable watches the current user's collaborator doc. When it goes from present to absent after the collaborators list has loaded, it toasts 「你已被移出此行程」 and `router.replace('/')`. It's called once per trip page tree (the bottom-bar layout), so the toast doesn't repeat.

## Compatibility and Deploy

- Existing collaborators and invitations without the new fields behave as today (`readOnly`/`viewOnly` = `false`).
- **Deploy order:** web app first (invite pages stop reading Firestore directly), then `firebase deploy --only firestore:rules,functions`. Clients still on the old bundle break on invite pages once rules change; the PWA update resolves that.
- The iOS app isn't in this repo. Server and rules enforce read-only and removal for it too, but its UI won't reflect them until updated.

## Testing

**Emulator tests** (Firebase CLI 13.29 and Java 21 are installed). New dev dependency `@firebase/rules-unit-testing`; new script `test:emulator` running `firebase emulators:exec --only firestore "vitest run tests/emulator"`. `tests/emulator/**` is excluded from the default `vitest` run.

- `tests/emulator/firestore-rules.test.ts`:
  - unauthenticated and non-owner users can't get or list invitations; owner can.
  - read-only collaborator can't create, update or delete expenses; can update own member `name`/`avatarEmoji`.
  - guest can still edit/delete only their own expenses; editor any.
  - a collaborator doc whose uid is missing from `collaboratorUserIds` can't read the trip or write expenses (covers half-joined docs left by gap 3).
- `tests/emulator/access-endpoints.test.ts` — handlers run against the emulator via Admin SDK (`getFirebaseAdminFirestore` mocked to an emulator-connected instance; H3 globals stubbed as in existing server tests):
  - accept: anonymous + personal invite → 403, nothing written; bogus `memberId` → 404, nothing written and invite still usable; already-linked member → 400, nothing written; `viewOnly` invite → collaborator `readOnly: true`; `maxUses: 1` with two concurrent accepts → exactly one succeeds.
  - join: anonymous → 403, nothing written.
  - PATCH/DELETE collaborator: non-owner 403; targeting owner 400; success paths update/remove the right docs and unlink the member.
  - reset-public-link: old code no longer resolves via `join-info`.
  - preview: returns the documented shape and states; unknown code 404.

**Manual pass** in the browser using `window.__devLogin()`: create a view-only guest link, join as guest, confirm no add/edit affordances; toggle 可編輯 on and confirm adding works; remove the guest from another session and confirm the redirect.

## Out of Scope

- iOS app UI changes.
- Firebase Storage rules (not in this repo). A read-only user who can upload a receipt image to an expense's path would trigger `onReceiptUploaded`, which rewrites the expense — verify the Storage rules in the Firebase console.
- Rate limiting on accept/join, and locking down `/api/admin/migrate-collaborator-ids` (lower-severity findings from the same review).
- Blocking removed users from rejoining.
