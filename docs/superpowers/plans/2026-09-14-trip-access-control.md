# Trip Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the invitation access-control gaps (world-listable invitations, anonymous editor escalation, non-atomic accept/join) and add per-collaborator view-only access, view-only invite links, collaborator removal and public link reset.

**Architecture:** Every access change runs through Nitro server endpoints using the Firebase Admin SDK; multi-document changes run in Firestore transactions. Firestore rules are the backstop: expense writes require a non-read-only collaborator who is also listed in `collaboratorUserIds`. Invite pages look codes up through a new server preview endpoint instead of querying Firestore.

**Tech Stack:** Nuxt 4 / Nitro (H3), firebase-admin 13, Firestore rules v2, Vue 3 + shadcn-vue, vitest 3, Firebase Emulator Suite + `@firebase/rules-unit-testing`, Cloud Functions v2 (CommonJS, `node --test`).

**Spec:** `docs/superpowers/specs/2026-09-14-trip-access-control-design.md`

**Conventions:**
- Code style is `@antfu/eslint-config`: no semicolons, single quotes, 2-space indent, kebab-case components in templates (`<ui-switch>`).
- Server routes import helpers explicitly (`import { … } from '~/server/utils/…'`); don't rely on Nitro auto-imports for our own utils.
- Commit directly to `main`, staging only the files named in the task. End every commit message with the session's attribution trailer.
- Run lint on touched files before each commit: `npx eslint <files>`.

---

## File Structure

**Create**
| File | Responsibility |
|---|---|
| `vitest.emulator.config.ts` | Vitest config for tests that need the Firestore emulator |
| `tests/emulator/helpers.ts` | Emulator Admin DB, H3 global stubs, fake events, seed helpers |
| `tests/emulator/smoke.test.ts` | Proves the harness reaches the emulator |
| `tests/emulator/firestore-rules.test.ts` | Security rules tests |
| `tests/emulator/invitation-endpoints.test.ts` | preview / create / accept endpoint tests |
| `tests/emulator/trip-access-endpoints.test.ts` | join / collaborator PATCH+DELETE / leave / reset-public-link tests |
| `server/utils/codes.ts` | Crypto-random codes + uniqueness checkers |
| `server/utils/invitations.ts` | Invitation state derivation, `maxUses` normalisation |
| `server/utils/collaborators.ts` | `getOwnedTrip()`, `removeCollaborator()` |
| `server/api/invitations/preview.get.ts` | Public invitation preview |
| `server/api/trips/[tripId]/collaborators/[userId].patch.ts` | Set `readOnly` |
| `server/api/trips/[tripId]/collaborators/[userId].delete.ts` | Remove collaborator |
| `server/api/trips/reset-public-link.post.ts` | Rotate public join code |
| `functions/tripAccess.js` + `functions/tripAccess.test.js` | `canModifyExpense()` for callables |
| `composables/useTripAccess.ts` | Client wrappers for owner access endpoints |
| `composables/useRemovedFromTripRedirect.ts` | Redirect when the current user loses access |
| `tests/server/codes.test.ts`, `tests/server/invitations.test.ts` | Pure unit tests |

**Modify**
`vitest.config.ts`, `package.json`, `firestore.rules`, `types/index.ts`, `utils/converter.ts`, `functions/reanalyzeReceipt.js`, `server/api/invitations/{accept.post,create.post,list.get}.ts`, `server/api/trips/{join.post,leave.post,toggle-public-invite.post}.ts`, `composables/useInvitation.ts`, `composables/useTripCollaborators.ts`, `pages/invite/[code].vue`, `pages/guest/[code].vue`, `pages/join/[code].vue`, `components/InviteCollaboratorsModal.vue`, `pages/trips/[tripId]/edit.vue`, `pages/trips/[tripId]/index.vue`, `pages/trips/[tripId]/expenses/index.vue`, `app.vue`.

---

### Task 1: Emulator test harness

**Files:**
- Modify: `package.json`, `vitest.config.ts`
- Create: `vitest.emulator.config.ts`, `tests/emulator/helpers.ts`, `tests/emulator/smoke.test.ts`

- [ ] **Step 1: Add the rules testing library**

Run: `pnpm add -D @firebase/rules-unit-testing`
Expected: `package.json` devDependencies gains `@firebase/rules-unit-testing`.

- [ ] **Step 2: Add the emulator script**

In `package.json` `scripts`, after `"test:ui": "vitest --ui"`, add:

```json
    "test:emulator": "firebase emulators:exec --only firestore --project demo-payback \"vitest run --config vitest.emulator.config.ts\""
```

(`demo-` project IDs never touch a real Firebase project.)

- [ ] **Step 3: Keep emulator tests out of the default run and add the `~` alias**

Replace `vitest.config.ts` with:

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'functions/**', 'tests/emulator/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '~': path.resolve(__dirname, './'),
    },
  },
})
```

- [ ] **Step 4: Create `vitest.emulator.config.ts`**

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Runs only under `pnpm test:emulator`, which starts the Firestore emulator
// and sets FIRESTORE_EMULATOR_HOST. Files share one emulator, so run serially.
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/emulator/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '~': path.resolve(__dirname, './'),
    },
  },
})
```

- [ ] **Step 5: Create `tests/emulator/helpers.ts`**

```ts
import type { AppUser } from '@/types'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { vi } from 'vitest'

export const PROJECT_ID = 'demo-payback'
const APP_NAME = 'emulator-tests'

export function getAdminDb() {
  const app = getApps().find(a => a.name === APP_NAME) ?? initializeApp({ projectId: PROJECT_ID }, APP_NAME)
  return getFirestore(app)
}

export async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host)
    throw new Error('FIRESTORE_EMULATOR_HOST is not set — run via `pnpm test:emulator`')
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
}

export function stubH3Globals() {
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('createError', (data: { statusCode: number, statusMessage: string }) =>
    Object.assign(new Error(data.statusMessage), data))
  vi.stubGlobal('readBody', async (event: any) => event.body ?? {})
  vi.stubGlobal('getQuery', (event: any) => event.query ?? {})
  vi.stubGlobal('getRouterParam', (event: any, name: string) => event.params?.[name])
  vi.stubGlobal('getRequestURL', () => new URL('http://localhost:3000'))
}

export function makeEvent(opts: {
  user?: AppUser | null
  body?: unknown
  query?: Record<string, unknown>
  params?: Record<string, string>
} = {}): any {
  return {
    context: opts.user ? { appUser: opts.user } : {},
    body: opts.body,
    query: opts.query,
    params: opts.params,
  }
}

export function googleUser(uid: string): AppUser {
  return { uid, email: `${uid}@example.com`, displayName: uid, photoURL: null, isAnonymous: false }
}

export function anonUser(uid: string): AppUser {
  return { uid, email: null, displayName: null, photoURL: null, isAnonymous: true }
}

export interface SeedCollaborator {
  uid: string
  role: 'owner' | 'editor' | 'guest'
  readOnly?: boolean
  /** false = collaborator doc exists but uid is missing from collaboratorUserIds (half-joined) */
  inArray?: boolean
}

export async function seedTrip(opts: {
  tripId?: string
  ownerUid?: string
  collaborators?: SeedCollaborator[]
  members?: Array<{ id: string, name: string, linkedUserId?: string }>
  trip?: Record<string, unknown>
} = {}) {
  const db = getAdminDb()
  const tripId = opts.tripId ?? 't1'
  const ownerUid = opts.ownerUid ?? 'owner'
  const collaborators = opts.collaborators ?? [{ uid: ownerUid, role: 'owner' }]
  const tripRef = db.collection('trips').doc(tripId)

  await tripRef.set({
    name: 'Test Trip',
    userId: ownerUid,
    collaboratorUserIds: collaborators.filter(c => c.inArray !== false).map(c => c.uid),
    collaboratorCount: collaborators.length,
    isPublicInviteEnabled: false,
    publicJoinCode: null,
    ...opts.trip,
  })
  for (const c of collaborators) {
    await tripRef.collection('collaborators').doc(c.uid).set({
      userId: c.uid,
      role: c.role,
      readOnly: c.readOnly ?? false,
      email: null,
      displayName: c.uid,
      photoURL: null,
    })
  }
  for (const m of opts.members ?? []) {
    await tripRef.collection('members').doc(m.id).set({
      name: m.name,
      avatarEmoji: '🐭',
      isHost: false,
      spending: 0,
      createdAt: Timestamp.now(),
      ...(m.linkedUserId ? { linkedUserId: m.linkedUserId } : {}),
    })
  }
  return tripRef
}

export async function seedInvitation(id: string, data: Record<string, unknown> = {}) {
  await getAdminDb().collection('invitations').doc(id).set({
    tripId: 't1',
    tripName: 'Test Trip',
    invitedByUserId: 'owner',
    invitedByName: 'Owner',
    invitationCode: id,
    status: 'pending',
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: Timestamp.now(),
    maxUses: 1,
    usedCount: 0,
    usedByUserIds: [],
    type: 'personal',
    ...data,
  })
}
```

- [ ] **Step 6: Create `tests/emulator/smoke.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { clearFirestore, getAdminDb } from './helpers'

describe('emulator harness', () => {
  beforeEach(clearFirestore)

  it('reads back what it writes', async () => {
    const ref = getAdminDb().collection('smoke').doc('a')
    await ref.set({ ok: true })
    expect((await ref.get()).data()).toEqual({ ok: true })
  })
})
```

- [ ] **Step 7: Run it**

Run: `pnpm test:emulator`
Expected: emulator starts, `tests/emulator/smoke.test.ts` 1 passed, emulator shuts down, exit code 0.

Run: `pnpm vitest run`
Expected: existing tests pass; no `tests/emulator` files collected.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts vitest.emulator.config.ts tests/emulator/helpers.ts tests/emulator/smoke.test.ts
git commit -m "test: add Firestore emulator test harness"
```

---

### Task 2: Crypto-random codes

**Files:**
- Create: `server/utils/codes.ts`, `tests/server/codes.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/server/codes.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import { CODE_ALPHABET, generateCode, generateUniqueCode } from '../../server/utils/codes'

describe('generateCode', () => {
  it('returns 10 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode()
      expect(code).toHaveLength(10)
      for (const ch of code)
        expect(CODE_ALPHABET).toContain(ch)
    }
  })

  it('honours a custom length', () => {
    expect(generateCode(6)).toHaveLength(6)
  })

  it('does not repeat across many calls', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateCode()))
    expect(codes.size).toBe(1000)
  })
})

describe('generateUniqueCode', () => {
  it('retries until the checker reports the code is free', async () => {
    const isTaken = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)
    const code = await generateUniqueCode(isTaken)
    expect(code).toHaveLength(10)
    expect(isTaken).toHaveBeenCalledTimes(3)
  })

  it('gives up after 5 collisions', async () => {
    await expect(generateUniqueCode(async () => true)).rejects.toThrow('unique code')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/server/codes.test.ts`
Expected: FAIL — cannot resolve `../../server/utils/codes`.

- [ ] **Step 3: Implement** — `server/utils/codes.ts`

```ts
import type { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

// No 0/O, 1/I/L — codes get read aloud and retyped from chat apps.
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
// Largest multiple of the alphabet size below 256, so `byte % size` is unbiased.
const UNBIASED_LIMIT = 256 - (256 % CODE_ALPHABET.length)

export function generateCode(length = 10): string {
  let code = ''
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= UNBIASED_LIMIT)
        continue
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === length)
        break
    }
  }
  return code
}

export async function generateUniqueCode(isTaken: (code: string) => Promise<boolean>, length = 10): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(length)
    if (!(await isTaken(code)))
      return code
  }
  throw new Error('Could not generate a unique code')
}

export function invitationCodeTaken(db: Firestore) {
  return async (code: string) =>
    !(await db.collection('invitations').where('invitationCode', '==', code).limit(1).get()).empty
}

export function publicJoinCodeTaken(db: Firestore) {
  return async (code: string) =>
    !(await db.collection('trips').where('publicJoinCode', '==', code).limit(1).get()).empty
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run tests/server/codes.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add server/utils/codes.ts tests/server/codes.test.ts
git commit -m "feat(server): add crypto-random invite code generator"
```

---

### Task 3: Invitation state helper (fixes unlimited links)

Existing code does `invitation.maxUses ?? 1`, which turns `null` (unlimited) into `1` — so "無限制" links currently stop working after one use. This helper treats only a *missing* `maxUses` as 1.

**Files:**
- Create: `server/utils/invitations.ts`, `tests/server/invitations.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/server/invitations.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { getInvitationState, normalizeMaxUses } from '../../server/utils/invitations'

const NOW = 1_000_000
const future = { toMillis: () => NOW + 1 }
const past = { toMillis: () => NOW - 1 }

describe('normalizeMaxUses', () => {
  it('treats a missing value as single-use and keeps null as unlimited', () => {
    expect(normalizeMaxUses(undefined)).toBe(1)
    expect(normalizeMaxUses(null)).toBeNull()
    expect(normalizeMaxUses(5)).toBe(5)
  })
})

describe('getInvitationState', () => {
  it('is valid while pending, unexpired and under its limit', () => {
    expect(getInvitationState({ status: 'pending', expiresAt: future, maxUses: 2, usedCount: 1 }, NOW)).toBe('valid')
  })

  it('reports revoked before anything else', () => {
    expect(getInvitationState({ status: 'revoked', expiresAt: past, maxUses: 1, usedCount: 1 }, NOW)).toBe('revoked')
  })

  it('reports expired from the status or the timestamp', () => {
    expect(getInvitationState({ status: 'expired', expiresAt: future }, NOW)).toBe('expired')
    expect(getInvitationState({ status: 'pending', expiresAt: past }, NOW)).toBe('expired')
  })

  it('reports used when the limit is reached', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: future, maxUses: 1, usedCount: 1 }, NOW)).toBe('used')
    expect(getInvitationState({ status: 'pending', expiresAt: future, usedCount: 1 }, NOW)).toBe('used')
  })

  it('never runs out when maxUses is null', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: future, maxUses: null, usedCount: 99 }, NOW)).toBe('valid')
  })

  it('treats a legacy accepted invitation without a usage count as used', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: future }, NOW)).toBe('used')
  })

  it('reports expired ahead of used', () => {
    expect(getInvitationState({ status: 'accepted', expiresAt: past, maxUses: 1, usedCount: 1 }, NOW)).toBe('expired')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/server/invitations.test.ts`
Expected: FAIL — cannot resolve `../../server/utils/invitations`.

- [ ] **Step 3: Implement** — `server/utils/invitations.ts`

```ts
import type { InvitationPreviewState } from '~/types'

interface InvitationStateFields {
  status?: string
  expiresAt: { toMillis: () => number }
  maxUses?: number | null
  usedCount?: number
}

/** A missing maxUses predates multi-use links and means single-use; null means unlimited. */
export function normalizeMaxUses(maxUses: number | null | undefined): number | null {
  return maxUses === undefined ? 1 : maxUses
}

/** Precedence: revoked > expired > used > valid. */
export function getInvitationState(invitation: InvitationStateFields, nowMs = Date.now()): InvitationPreviewState {
  if (invitation.status === 'revoked')
    return 'revoked'
  if (invitation.status === 'expired' || invitation.expiresAt.toMillis() < nowMs)
    return 'expired'
  const maxUses = normalizeMaxUses(invitation.maxUses)
  // 'accepted' is only written once a finite limit is used up; legacy docs have no usedCount
  if (maxUses !== null && (invitation.status === 'accepted' || (invitation.usedCount ?? 0) >= maxUses))
    return 'used'
  return 'valid'
}
```

`InvitationPreviewState` is added to `types/index.ts` in Task 4 — do Task 4 Step 1 now if you're running tasks out of order, otherwise add this export to `types/index.ts` at the end of the file:

```ts
export type InvitationPreviewState = 'valid' | 'expired' | 'revoked' | 'used'
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run tests/server/invitations.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add server/utils/invitations.ts tests/server/invitations.test.ts types/index.ts
git commit -m "feat(server): derive invitation state in one place, keep null maxUses unlimited"
```

### Task 4: Types and collaborator converter

**Files:**
- Modify: `types/index.ts` (interfaces at lines ~130–166), `utils/converter.ts:118-143`

- [ ] **Step 1: Extend the types**

In `types/index.ts`, add `readOnly` to `NewTripCollaborator`:

```ts
export interface NewTripCollaborator {
  userId: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  role: 'owner' | 'editor' | 'guest'
  /** View-only access. Missing means false. Never set on the owner. */
  readOnly?: boolean
  joinedAt: Timestamp | FieldValue
  invitedBy?: string
}
```

Add `viewOnly` to `NewInvitation`, after `type?: 'personal' | 'guest'`:

```ts
  /** People who join through this link start read-only. Missing means false. */
  viewOnly?: boolean
```

At the end of the file, next to `InvitationPreviewState` (added in Task 3), add:

```ts
export interface InvitationPreview {
  state: InvitationPreviewState
  type: 'personal' | 'guest'
  viewOnly: boolean
  tripName: string
  invitedByName: string
  /** ISO timestamp */
  expiresAt: string
}
```

- [ ] **Step 2: Carry `readOnly` through the collaborator converter**

In `utils/converter.ts`, `tripCollaboratorConverter.toFirestore` — add after `role: collaborator.role,`:

```ts
      readOnly: collaborator.readOnly ?? false,
```

and in `fromFirestore`, after `role: data.role,`:

```ts
      readOnly: data.readOnly === true,
```

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm vitest run && npx eslint types/index.ts utils/converter.ts`
Expected: all tests pass, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts utils/converter.ts
git commit -m "feat(types): add readOnly collaborators and viewOnly invitations"
```

---

### Task 5: Firestore rules

**Files:**
- Modify: `firestore.rules`
- Create: `tests/emulator/firestore-rules.test.ts`

- [ ] **Step 1: Write the failing rules tests** — `tests/emulator/firestore-rules.test.ts`

```ts
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { PROJECT_ID } from './helpers'

let env: RulesTestEnvironment

function as(uid: string, provider = 'google.com') {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore()
}

const newExpense = (uid: string) => ({ description: 'Coffee', grandTotal: 10, createdByUserId: uid })

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'trips/t1'), {
      name: 'Trip',
      userId: 'owner',
      collaboratorUserIds: ['owner', 'editor', 'guest', 'viewer'],
    })
    const collaborator = (uid: string, role: string, readOnly = false) =>
      setDoc(doc(db, `trips/t1/collaborators/${uid}`), { userId: uid, role, readOnly })
    await collaborator('owner', 'owner')
    await collaborator('editor', 'editor')
    await collaborator('guest', 'guest')
    await collaborator('viewer', 'editor', true)
    // Half-joined (gap 3): collaborator doc exists but uid is not in collaboratorUserIds
    await collaborator('orphan', 'editor')
    await setDoc(doc(db, 'trips/t1/members/m-viewer'), { name: 'Viewer', avatarEmoji: '🐭', linkedUserId: 'viewer', spending: 0 })
    await setDoc(doc(db, 'trips/t1/expenses/e-owner'), { description: 'Dinner', grandTotal: 100, createdByUserId: 'owner' })
    await setDoc(doc(db, 'trips/t1/expenses/e-guest'), { description: 'Taxi', grandTotal: 50, createdByUserId: 'guest' })
    await setDoc(doc(db, 'invitations/inv1'), { tripId: 't1', invitationCode: 'CODE1', status: 'pending' })
  })
})

describe('invitations', () => {
  it('cannot be listed or read without signing in', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(db, 'invitations')))
    await assertFails(getDoc(doc(db, 'invitations/inv1')))
  })

  it('cannot be listed or read by a non-owner collaborator', async () => {
    await assertFails(getDocs(collection(as('editor'), 'invitations')))
    await assertFails(getDoc(doc(as('editor'), 'invitations/inv1')))
  })

  it('can be read by the trip owner', async () => {
    await assertSucceeds(getDoc(doc(as('owner'), 'invitations/inv1')))
  })
})

describe('expenses', () => {
  it('editor and guest can create', async () => {
    await assertSucceeds(addDoc(collection(as('editor'), 'trips/t1/expenses'), newExpense('editor')))
    await assertSucceeds(addDoc(collection(as('guest', 'anonymous'), 'trips/t1/expenses'), newExpense('guest')))
  })

  it('read-only collaborator can read but not create, update or delete', async () => {
    const db = as('viewer')
    await assertSucceeds(getDoc(doc(db, 'trips/t1/expenses/e-owner')))
    await assertFails(addDoc(collection(db, 'trips/t1/expenses'), newExpense('viewer')))
    await assertFails(updateDoc(doc(db, 'trips/t1/expenses/e-owner'), { grandTotal: 1 }))
    await assertFails(deleteDoc(doc(db, 'trips/t1/expenses/e-owner')))
  })

  it('guest can edit and delete only their own expenses', async () => {
    const db = as('guest', 'anonymous')
    await assertSucceeds(updateDoc(doc(db, 'trips/t1/expenses/e-guest'), { grandTotal: 55 }))
    await assertFails(updateDoc(doc(db, 'trips/t1/expenses/e-owner'), { grandTotal: 1 }))
    await assertFails(deleteDoc(doc(db, 'trips/t1/expenses/e-owner')))
    await assertSucceeds(deleteDoc(doc(db, 'trips/t1/expenses/e-guest')))
  })

  it('editor can edit anyone\'s expense', async () => {
    await assertSucceeds(updateDoc(doc(as('editor'), 'trips/t1/expenses/e-guest'), { grandTotal: 60 }))
  })

  it('half-joined collaborator cannot write', async () => {
    const db = as('orphan')
    await assertFails(addDoc(collection(db, 'trips/t1/expenses'), newExpense('orphan')))
    await assertFails(updateDoc(doc(db, 'trips/t1/expenses/e-owner'), { grandTotal: 1 }))
  })
})

describe('members', () => {
  it('read-only collaborator can rename their own member but not touch the ledger', async () => {
    const db = as('viewer')
    await assertSucceeds(updateDoc(doc(db, 'trips/t1/members/m-viewer'), { name: 'V2', avatarEmoji: '🐱' }))
    await assertFails(updateDoc(doc(db, 'trips/t1/members/m-viewer'), { spending: 999 }))
  })
})

describe('trips', () => {
  it('read-only collaborator can read the trip; half-joined cannot', async () => {
    await assertSucceeds(getDoc(doc(as('viewer'), 'trips/t1')))
    await assertFails(getDoc(doc(as('orphan'), 'trips/t1')))
  })
})
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm test:emulator`
Expected: FAIL — `invitations` (both "cannot be listed…" tests), `read-only collaborator can read but not create…`, and `half-joined collaborator cannot write` fail; the rest pass.

- [ ] **Step 3: Update the rules**

Replace `firestore.rules` with:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // Helper: check if user is a collaborator on the trip
    function isCollaborator(tripId) {
      return exists(/databases/$(database)/documents/trips/$(tripId)/collaborators/$(request.auth.uid));
    }

    // Helper: check if user is the trip owner
    function isOwner(tripId) {
      return get(/databases/$(database)/documents/trips/$(tripId)).data.userId == request.auth.uid;
    }

    // Helper: the user's collaborator doc on the trip
    function collaboratorDoc(tripId) {
      return get(/databases/$(database)/documents/trips/$(tripId)/collaborators/$(request.auth.uid));
    }

    // Helper: get the user's collaborator role ('owner', 'editor', 'guest')
    function getRole(tripId) {
      return collaboratorDoc(tripId).data.role;
    }

    // Helper: may this user change the ledger (expenses)?
    // Requires both the collaborator doc and a collaboratorUserIds entry, so any
    // half-joined collaborator docs left by the old non-atomic accept stay inert.
    function canWrite(tripId) {
      return isCollaborator(tripId)
        && request.auth.uid in get(/databases/$(database)/documents/trips/$(tripId)).data.collaboratorUserIds
        && collaboratorDoc(tripId).data.get('readOnly', false) != true;
    }

    // Helper: check if user is NOT an anonymous guest
    function isNotAnonymous() {
      return request.auth.token.firebase.sign_in_provider != 'anonymous';
    }

    // Trips collection
    match /trips/{tripId} {
      // Only non-anonymous users can create their own trip
      allow create: if request.auth != null
        && isNotAnonymous()
        && request.resource.data.userId == request.auth.uid;

      // Users can read trips they collaborate on (includes owner)
      allow read: if request.auth != null
        && request.auth.uid in resource.data.collaboratorUserIds;

      // Only owner can update/delete trip settings
      allow update, delete: if request.auth != null
        && resource.data.userId == request.auth.uid;

      // Collaborators subcollection
      match /collaborators/{collaboratorId} {
        // Any collaborator can read the collaborator list
        allow read: if request.auth != null
          && request.auth.uid in get(/databases/$(database)/documents/trips/$(tripId)).data.collaboratorUserIds;

        // Only owner can manage collaborators (server API handles join/remove via Admin SDK)
        allow write: if request.auth != null
          && get(/databases/$(database)/documents/trips/$(tripId)).data.userId == request.auth.uid;
      }

      // Members subcollection
      match /members/{memberId} {
        // Any collaborator can read members
        allow read: if request.auth != null
          && request.auth.uid in get(/databases/$(database)/documents/trips/$(tripId)).data.collaboratorUserIds;

        // Only owner can create/delete trip members
        allow create, delete: if request.auth != null
          && get(/databases/$(database)/documents/trips/$(tripId)).data.userId == request.auth.uid;

        // Owner can update any member
        // Collaborators (including guests and read-only) can update their own linked member (name and avatar only)
        allow update: if request.auth != null && (
          get(/databases/$(database)/documents/trips/$(tripId)).data.userId == request.auth.uid
          || (
            resource.data.linkedUserId == request.auth.uid
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'avatarEmoji'])
          )
        );
      }

      // Expenses subcollection
      match /expenses/{expenseId} {
        // Any collaborator can read expenses
        allow read: if request.auth != null
          && request.auth.uid in get(/databases/$(database)/documents/trips/$(tripId)).data.collaboratorUserIds;

        // Non-read-only collaborators can create expenses
        // Enforce createdByUserId matches the authenticated user (if provided)
        allow create: if request.auth != null
          && canWrite(tripId)
          && (!('createdByUserId' in request.resource.data)
              || request.resource.data.createdByUserId == request.auth.uid);

        // Owner/editor can update/delete any expense
        // Other non-read-only collaborators can update/delete expenses they created
        // Nobody can reassign who created an expense
        allow update: if request.auth != null
          && canWrite(tripId)
          && (
            getRole(tripId) in ['owner', 'editor']
            || resource.data.createdByUserId == request.auth.uid
          )
          && request.resource.data.get('createdByUserId', null) == resource.data.get('createdByUserId', null);

        allow delete: if request.auth != null
          && canWrite(tripId)
          && (
            getRole(tripId) in ['owner', 'editor']
            || resource.data.createdByUserId == request.auth.uid
          );
      }
    }

    // Invitations collection
    match /invitations/{invitationId} {
      // Only the trip owner can read invitations. Invite pages look codes up through
      // GET /api/invitations/preview, so the code stays a secret.
      allow read: if request.auth != null
        && isOwner(resource.data.tripId);

      // Invitations are created, used and revoked only by server routes (Admin SDK).
      // Client writes are denied outright: an owner could otherwise point an invitation
      // for their own trip at someone else's trip and accept it.
      allow create, update, delete: if false;
    }
  }
}
```

- [ ] **Step 4: Run to verify all rules tests pass**

Run: `pnpm test:emulator`
Expected: `firestore-rules.test.ts` 16 passed; smoke test still passes.

(The Step 1 listing shows the original 10 tests. The code review added 6 more — owner-scoped invitation queries, client invitation writes denied (including retargeting an invitation at another trip), owner CRUD, a collaborator doc with no `readOnly` field, a read-only guest on their own expense, and `createdByUserId` pinned on update — plus a half-joined delete assertion. See `tests/emulator/firestore-rules.test.ts`.)

Do **not** deploy the rules yet — the invite pages still query `invitations` directly until Task 14. Deployment happens in Task 18.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/emulator/firestore-rules.test.ts
git commit -m "fix(rules): lock invitations to owners, block read-only and half-joined expense writes"
```

---

### Task 6: Permission check in `reanalyzeReceipt`

The callable currently has no auth check. Its `catch` block writes an error state onto the expense, so the check must run **before** the `try`.

**Files:**
- Create: `functions/tripAccess.js`, `functions/tripAccess.test.js`
- Modify: `functions/reanalyzeReceipt.js:1-31`

- [ ] **Step 1: Write the failing test** — `functions/tripAccess.test.js`

```js
const assert = require('node:assert')
const { test } = require('node:test')
const { canModifyExpense } = require('./tripAccess')

const trip = { userId: 'owner', collaboratorUserIds: ['owner', 'editor', 'guest', 'viewer'] }
const expense = { createdByUserId: 'guest' }

test('owner and editor can modify any expense', () => {
  assert.strictEqual(canModifyExpense({ uid: 'owner', trip, collaborator: { role: 'owner' }, expense }), true)
  assert.strictEqual(canModifyExpense({ uid: 'editor', trip, collaborator: { role: 'editor' }, expense: { createdByUserId: 'owner' } }), true)
})

test('guest can modify only their own expense', () => {
  assert.strictEqual(canModifyExpense({ uid: 'guest', trip, collaborator: { role: 'guest' }, expense }), true)
  assert.strictEqual(canModifyExpense({ uid: 'guest', trip, collaborator: { role: 'guest' }, expense: { createdByUserId: 'owner' } }), false)
})

test('read-only collaborator cannot modify anything', () => {
  assert.strictEqual(canModifyExpense({ uid: 'viewer', trip, collaborator: { role: 'editor', readOnly: true }, expense }), false)
})

test('missing collaborator, trip, expense or array entry denies', () => {
  assert.strictEqual(canModifyExpense({ uid: 'stranger', trip, collaborator: null, expense }), false)
  assert.strictEqual(canModifyExpense({ uid: 'owner', trip: null, collaborator: { role: 'owner' }, expense }), false)
  assert.strictEqual(canModifyExpense({ uid: 'owner', trip, collaborator: { role: 'owner' }, expense: null }), false)
  assert.strictEqual(canModifyExpense({ uid: 'orphan', trip, collaborator: { role: 'editor' }, expense }), false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd functions && node --test tripAccess.test.js`
Expected: FAIL — `Cannot find module './tripAccess'`.

- [ ] **Step 3: Implement** — `functions/tripAccess.js`

```js
/**
 * Mirrors the Firestore rule for expense update/delete, for callables that
 * modify expenses with the Admin SDK (which bypasses rules).
 */
function canModifyExpense({ uid, trip, collaborator, expense }) {
  if (!uid || !trip || !collaborator || !expense)
    return false
  if (!(trip.collaboratorUserIds || []).includes(uid))
    return false
  if (collaborator.readOnly === true)
    return false
  return collaborator.role === 'owner'
    || collaborator.role === 'editor'
    || expense.createdByUserId === uid
}

module.exports = { canModifyExpense }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd functions && node --test tripAccess.test.js`
Expected: 4 passing tests.

- [ ] **Step 5: Wire it into `functions/reanalyzeReceipt.js`**

Add after the `require('./receiptAnalysis')` block (line 9):

```js
const { canModifyExpense } = require('./tripAccess')
```

Then insert between the `expenseId` validation (ends line 29) and `logger.info(\`Re-analyzing receipt…\`)` (line 31):

```js
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to re-analyze receipts')
  }

  // Check access before the try block: its catch writes an error state onto the expense.
  const [tripSnap, collaboratorSnap, expenseSnap] = await Promise.all([
    db.doc(`trips/${tripId}`).get(),
    db.doc(`trips/${tripId}/collaborators/${request.auth.uid}`).get(),
    db.doc(`trips/${tripId}/expenses/${expenseId}`).get(),
  ])
  const allowed = canModifyExpense({
    uid: request.auth.uid,
    trip: tripSnap.exists ? tripSnap.data() : null,
    collaborator: collaboratorSnap.exists ? collaboratorSnap.data() : null,
    expense: expenseSnap.exists ? expenseSnap.data() : null,
  })
  if (!allowed) {
    throw new HttpsError('permission-denied', 'You cannot modify this expense')
  }
```

- [ ] **Step 6: Run the functions test suite**

Run: `cd functions && npm test`
Expected: all tests pass (existing + 4 new).

- [ ] **Step 7: Commit**

```bash
git add functions/tripAccess.js functions/tripAccess.test.js functions/reanalyzeReceipt.js
git commit -m "fix(functions): require expense write access to re-analyze receipts"
```

### Task 7: Invitation preview endpoint

**Files:**
- Create: `server/api/invitations/preview.get.ts`, `tests/emulator/invitation-endpoints.test.ts`

- [ ] **Step 1: Create the endpoint test file with the preview tests** — `tests/emulator/invitation-endpoints.test.ts`

```ts
import type { AppUser } from '@/types'
import { Timestamp } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anonUser, clearFirestore, getAdminDb, googleUser, makeEvent, seedInvitation, seedTrip, stubH3Globals } from './helpers'

vi.mock('~/server/utils/session', async (importOriginal) => {
  const helpers = await import('./helpers')
  return {
    ...await importOriginal<typeof import('~/server/utils/session')>(),
    getFirebaseAdminFirestore: helpers.getAdminDb,
  }
})

beforeEach(async () => {
  stubH3Globals()
  await clearFirestore()
})

async function callPreview(query: Record<string, unknown>) {
  const { default: handler } = await import('~/server/api/invitations/preview.get')
  return handler(makeEvent({ query }))
}

describe('GET /api/invitations/preview', () => {
  it('returns only the public fields', async () => {
    await seedInvitation('VALID1', { viewOnly: true, type: 'guest', maxUses: null })
    const preview = await callPreview({ code: 'VALID1' })
    expect(preview).toEqual({
      state: 'valid',
      type: 'guest',
      viewOnly: true,
      tripName: 'Test Trip',
      invitedByName: 'Owner',
      expiresAt: expect.any(String),
    })
  })

  it('reports revoked, expired and used invitations', async () => {
    await seedInvitation('REV', { status: 'revoked' })
    await seedInvitation('EXP', { expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await seedInvitation('USED', { status: 'accepted', usedCount: 1 })
    expect((await callPreview({ code: 'REV' })).state).toBe('revoked')
    expect((await callPreview({ code: 'EXP' })).state).toBe('expired')
    expect((await callPreview({ code: 'USED' })).state).toBe('used')
  })

  it('404s on an unknown code and 400s without one', async () => {
    await expect(callPreview({ code: 'NOPE' })).rejects.toMatchObject({ statusCode: 404 })
    await expect(callPreview({})).rejects.toMatchObject({ statusCode: 400 })
  })
})
```

(`AppUser`, `anonUser`, `getAdminDb`, `googleUser` and `seedTrip` are used by the accept/create tests added in Tasks 8–9; lint may flag them as unused until then.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:emulator`
Expected: FAIL — cannot resolve `~/server/api/invitations/preview.get`.

- [ ] **Step 3: Implement** — `server/api/invitations/preview.get.ts`

```ts
import type { InvitationPreview } from '~/types'
import { getInvitationState } from '~/server/utils/invitations'
import { getFirebaseAdminFirestore } from '~/server/utils/session'

// Public: invite/guest pages call this before the visitor signs in.
// Returns only what those pages display — never the tripId or who used the link.
export default defineEventHandler(async (event): Promise<InvitationPreview> => {
  const { code } = getQuery(event)
  if (!code || typeof code !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'code is required' })
  }

  const snapshot = await getFirebaseAdminFirestore()
    .collection('invitations')
    .where('invitationCode', '==', code)
    .limit(1)
    .get()

  if (snapshot.empty) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }

  const invitation = snapshot.docs[0].data()
  return {
    state: getInvitationState(invitation),
    type: invitation.type === 'guest' ? 'guest' : 'personal',
    viewOnly: invitation.viewOnly === true,
    tripName: invitation.tripName || '',
    invitedByName: invitation.invitedByName || '',
    expiresAt: invitation.expiresAt.toDate().toISOString(),
  }
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:emulator`
Expected: preview tests 3 passed; earlier emulator tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/invitations/preview.get.ts tests/emulator/invitation-endpoints.test.ts
git commit -m "feat(api): add public invitation preview endpoint"
```

---

### Task 8: Atomic invitation accept

**Files:**
- Modify: `server/api/invitations/accept.post.ts` (full rewrite)
- Test: `tests/emulator/invitation-endpoints.test.ts` (append)

- [ ] **Step 1: Append the failing accept tests** to `tests/emulator/invitation-endpoints.test.ts`

```ts
async function callAccept(user: AppUser, body: Record<string, unknown>) {
  const { default: handler } = await import('~/server/api/invitations/accept.post')
  return handler(makeEvent({ user, body }))
}

async function seedAcceptFixture() {
  await seedTrip({
    members: [
      { id: 'm-host', name: 'Host', linkedUserId: 'owner' },
      { id: 'm-free', name: 'Free' },
      { id: 'm-taken', name: 'Taken', linkedUserId: 'someone' },
    ],
  })
}

async function readState(uid: string, code: string) {
  const db = getAdminDb()
  const [collaborator, trip, invitation] = await Promise.all([
    db.doc(`trips/t1/collaborators/${uid}`).get(),
    db.doc('trips/t1').get(),
    db.doc(`invitations/${code}`).get(),
  ])
  return {
    collaborator: collaborator.exists ? collaborator.data() : null,
    inArray: (trip.data()?.collaboratorUserIds ?? []).includes(uid),
    invitation: invitation.data(),
  }
}

const newMember = { name: 'New', avatarEmoji: '🐱' }

describe('POST /api/invitations/accept', () => {
  beforeEach(seedAcceptFixture)

  it('links a Google user to an existing member as an editor', async () => {
    await seedInvitation('P1')
    expect(await callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'm-free' }))
      .toEqual({ success: true, tripId: 't1' })

    const state = await readState('alice', 'P1')
    expect(state.collaborator).toMatchObject({ role: 'editor', readOnly: false })
    expect(state.inArray).toBe(true)
    expect(state.invitation).toMatchObject({ status: 'accepted', usedCount: 1 })
    expect((await getAdminDb().doc('trips/t1/members/m-free').get()).data()?.linkedUserId).toBe('alice')
  })

  it('rejects anonymous users on personal invitations and writes nothing', async () => {
    await seedInvitation('P1')
    await expect(callAccept(anonUser('anon'), { invitationCode: 'P1', newMember }))
      .rejects.toMatchObject({ statusCode: 403 })

    const state = await readState('anon', 'P1')
    expect(state.collaborator).toBeNull()
    expect(state.invitation?.usedCount).toBe(0)
  })

  it('gives anonymous users on guest invitations the guest role', async () => {
    await seedInvitation('G1', { type: 'guest', maxUses: null })
    await callAccept(anonUser('anon'), { invitationCode: 'G1', newMember })

    expect((await readState('anon', 'G1')).collaborator).toMatchObject({ role: 'guest', readOnly: false })
    const linked = await getAdminDb().collection('trips/t1/members').where('linkedUserId', '==', 'anon').get()
    expect(linked.docs[0]?.data()).toMatchObject({ name: 'New', avatarEmoji: '🐱' })
  })

  it('writes nothing when the member does not exist, so the user can retry', async () => {
    await seedInvitation('P1')
    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'nope' }))
      .rejects.toMatchObject({ statusCode: 404 })

    const state = await readState('alice', 'P1')
    expect(state.collaborator).toBeNull()
    expect(state.invitation?.usedCount).toBe(0)

    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'm-free' }))
      .resolves.toMatchObject({ success: true })
  })

  it('writes nothing when the member is already linked', async () => {
    await seedInvitation('P1')
    await expect(callAccept(googleUser('alice'), { invitationCode: 'P1', memberId: 'm-taken' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect((await readState('alice', 'P1')).collaborator).toBeNull()
  })

  it('starts view-only invitees as read-only', async () => {
    await seedInvitation('V1', { viewOnly: true })
    await callAccept(googleUser('alice'), { invitationCode: 'V1', newMember })
    expect((await readState('alice', 'V1')).collaborator).toMatchObject({ role: 'editor', readOnly: true })
  })

  it('marks expired invitations as expired and rejects them', async () => {
    await seedInvitation('EXP', { expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await expect(callAccept(googleUser('alice'), { invitationCode: 'EXP', newMember }))
      .rejects.toMatchObject({ statusCode: 400 })

    const state = await readState('alice', 'EXP')
    expect(state.invitation?.status).toBe('expired')
    expect(state.collaborator).toBeNull()
  })

  it('lets exactly one of two concurrent users take a single-use invitation', async () => {
    await seedInvitation('P1')
    const results = await Promise.allSettled([
      callAccept(googleUser('alice'), { invitationCode: 'P1', newMember: { name: 'A', avatarEmoji: '🐱' } }),
      callAccept(googleUser('bob'), { invitationCode: 'P1', newMember: { name: 'B', avatarEmoji: '🐶' } }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((await readState('alice', 'P1')).invitation?.usedCount).toBe(1)
  })

  it('rejects invitations the trip owner did not issue', async () => {
    await seedInvitation('FORGED', { invitedByUserId: 'mallory' })
    await expect(callAccept(googleUser('mallory'), { invitationCode: 'FORGED', newMember }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect((await readState('mallory', 'FORGED')).collaborator).toBeNull()
  })

  it('keeps unlimited invitations open', async () => {
    await seedInvitation('U1', { maxUses: null })
    await callAccept(googleUser('alice'), { invitationCode: 'U1', newMember: { name: 'A', avatarEmoji: '🐱' } })
    await callAccept(googleUser('bob'), { invitationCode: 'U1', newMember: { name: 'B', avatarEmoji: '🐶' } })
    expect((await readState('bob', 'U1')).invitation).toMatchObject({ status: 'pending', usedCount: 2 })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:emulator`
Expected: FAIL — at least "rejects anonymous users…" (currently succeeds), "writes nothing when the member does not exist…" (collaborator doc left behind), "writes nothing when the member is already linked…", "starts view-only invitees…", and "keeps unlimited invitations open" fail.

- [ ] **Step 3: Rewrite** `server/api/invitations/accept.post.ts`

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { getInvitationState, normalizeMaxUses } from '~/server/utils/invitations'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const { invitationCode, memberId, newMember } = await readBody(event)

  if (!invitationCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invitationCode is required',
    })
  }

  if (!memberId && !newMember) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either memberId or newMember is required',
    })
  }

  if (newMember && (!newMember.name || !newMember.avatarEmoji)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'newMember requires name and avatarEmoji',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // One transaction: every check runs before any write, so a failed accept leaves
    // no half-joined collaborator behind, and concurrent accepts can't exceed maxUses.
    const outcome = await db.runTransaction(async (tx) => {
      const invitationSnapshot = await tx.get(
        db.collection('invitations').where('invitationCode', '==', invitationCode).limit(1),
      )
      if (invitationSnapshot.empty) {
        throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
      }

      const invitationDoc = invitationSnapshot.docs[0]
      const invitation = invitationDoc.data()
      const tripRef = db.collection('trips').doc(invitation.tripId)
      const collaboratorRef = tripRef.collection('collaborators').doc(user.uid)
      const memberRef = memberId ? tripRef.collection('members').doc(memberId) : null

      const [tripDoc, collaboratorDoc, memberDoc] = await Promise.all([
        tx.get(tripRef),
        tx.get(collaboratorRef),
        memberRef ? tx.get(memberRef) : Promise.resolve(null),
      ])

      const state = getInvitationState(invitation)
      if (state === 'revoked') {
        throw createError({ statusCode: 400, statusMessage: 'Invitation has been revoked' })
      }
      if (state === 'expired') {
        // Persist the expiry, then report it once the transaction commits
        if (invitation.status !== 'expired')
          tx.update(invitationDoc.ref, { status: 'expired' })
        return { expired: true as const }
      }
      if (state === 'used') {
        throw createError({ statusCode: 400, statusMessage: 'Invitation has reached its usage limit' })
      }
      if ((invitation.usedByUserIds ?? []).includes(user.uid)) {
        throw createError({ statusCode: 400, statusMessage: 'You have already used this invitation' })
      }
      if (invitation.type !== 'guest' && user.isAnonymous) {
        throw createError({ statusCode: 403, statusMessage: 'Sign in with Google to accept this invitation' })
      }
      if (!tripDoc.exists) {
        throw createError({ statusCode: 404, statusMessage: 'Trip not found' })
      }
      // Defence in depth: only invitations the trip's owner issued are honoured
      if (invitation.invitedByUserId !== tripDoc.data()?.userId) {
        throw createError({ statusCode: 403, statusMessage: 'Invitation is not valid for this trip' })
      }
      if (collaboratorDoc.exists) {
        throw createError({ statusCode: 400, statusMessage: 'You are already a collaborator on this trip' })
      }
      if (memberDoc && !memberDoc.exists) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found' })
      }
      if (memberDoc?.data()?.linkedUserId) {
        throw createError({ statusCode: 400, statusMessage: 'This member is already linked to another user' })
      }

      // Add user as collaborator (guest invitations get 'guest' role)
      tx.set(collaboratorRef, {
        userId: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        role: invitation.type === 'guest' ? 'guest' : 'editor',
        readOnly: invitation.viewOnly === true,
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: invitation.invitedByUserId,
      })

      // Link to existing member or create new member
      if (memberRef) {
        tx.update(memberRef, { linkedUserId: user.uid })
      }
      else {
        tx.set(tripRef.collection('members').doc(), {
          name: newMember.name,
          avatarEmoji: newMember.avatarEmoji,
          isHost: false,
          spending: 0,
          createdAt: FieldValue.serverTimestamp(),
          linkedUserId: user.uid,
        })
      }

      const maxUses = normalizeMaxUses(invitation.maxUses)
      const usedCount = (invitation.usedCount ?? 0) + 1
      tx.update(invitationDoc.ref, {
        status: maxUses !== null && usedCount >= maxUses ? 'accepted' : 'pending',
        usedCount,
        usedByUserIds: FieldValue.arrayUnion(user.uid),
        usedByUserId: user.uid,
        usedAt: FieldValue.serverTimestamp(),
      })

      tx.update(tripRef, {
        collaboratorCount: FieldValue.increment(1),
        collaboratorUserIds: FieldValue.arrayUnion(user.uid),
      })

      return { expired: false as const, tripId: tripRef.id }
    })

    if (outcome.expired) {
      throw createError({ statusCode: 400, statusMessage: 'Invitation has expired' })
    }

    return {
      success: true,
      tripId: outcome.tripId,
    }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error accepting invitation:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to accept invitation',
    })
  }
})
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test:emulator`
Expected: all accept tests (10) pass, plus everything earlier.

- [ ] **Step 5: Commit**

```bash
git add server/api/invitations/accept.post.ts tests/emulator/invitation-endpoints.test.ts
git commit -m "fix(api): accept invitations atomically and keep anonymous users out of personal invites"
```

---

**Review follow-up (applied in a second commit):** input checks for `memberId` (string, no `/`) and `newMember` (string fields); the expired branch only marks `pending` invitations expired, so used-up ones keep `accepted`; an explicit "owner can't accept their own invitation" 400 after the issuer check; and five more tests — revoked, an existing read-only collaborator can't re-accept to shed `readOnly`, owner accepting their own invite, used-up-then-expired keeps `accepted`, malformed `memberId`. Total accept tests: 15.

---

### Task 9: View-only invitation creation; unlimited links in the list and members lookup

**Files:**
- Modify: `server/api/invitations/create.post.ts`, `server/api/invitations/list.get.ts`, `server/api/invitations/members.get.ts`
- Test: `tests/emulator/invitation-endpoints.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
describe('POST /api/invitations/create', () => {
  async function callCreate(user: AppUser, body: Record<string, unknown>) {
    const { default: handler } = await import('~/server/api/invitations/create.post')
    return handler(makeEvent({ user, body }))
  }

  beforeEach(() => seedTrip())

  it('stores viewOnly and uses a 10-character code', async () => {
    const result = await callCreate(googleUser('owner'), { tripId: 't1', type: 'guest', maxUses: null, viewOnly: true })
    expect(result.invitationCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/)
    expect(result.invitationUrl).toBe(`http://localhost:3000/guest/${result.invitationCode}`)

    const stored = (await getAdminDb().doc(`invitations/${result.invitationId}`).get()).data()
    expect(stored).toMatchObject({ viewOnly: true, type: 'guest', maxUses: null })
  })

  it('defaults viewOnly to false', async () => {
    const result = await callCreate(googleUser('owner'), { tripId: 't1' })
    expect((await getAdminDb().doc(`invitations/${result.invitationId}`).get()).data()?.viewOnly).toBe(false)
  })

  it('rejects non-owners', async () => {
    await expect(callCreate(googleUser('stranger'), { tripId: 't1' })).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET /api/invitations/list', () => {
  it('reports unlimited invitations as unlimited and includes viewOnly', async () => {
    await seedTrip()
    await seedInvitation('U1', { maxUses: null })
    const { default: handler } = await import('~/server/api/invitations/list.get')
    const list = await handler(makeEvent({ user: googleUser('owner'), query: { tripId: 't1' } }))
    expect(list[0]).toMatchObject({ invitationCode: 'U1', maxUses: null, viewOnly: false })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:emulator`
Expected: FAIL — code doesn't match the 10-char pattern, `viewOnly` missing, list returns `maxUses: 1`.

- [ ] **Step 3: Update `server/api/invitations/create.post.ts`**

Add imports after the existing `firebase-admin/firestore` import:

```ts
import { generateUniqueCode, invitationCodeTaken } from '~/server/utils/codes'
```

Replace the body destructuring:

```ts
  const { tripId, expiresInDays = 7, maxUses = 1, type = 'personal', viewOnly = false } = await readBody(event)
```

Replace the code generation (`// Generate random invitation code (6 characters)` and the `Math.random()` line) with:

```ts
    const invitationCode = await generateUniqueCode(invitationCodeTaken(db))
```

In `invitationData`, after `type: validatedType,` add:

```ts
      viewOnly: viewOnly === true,
```

- [ ] **Step 4: Update `server/api/invitations/list.get.ts`**

Add the import:

```ts
import { normalizeMaxUses } from '~/server/utils/invitations'
```

Replace `maxUses: data.maxUses ?? 1,` with:

```ts
        maxUses: normalizeMaxUses(data.maxUses),
        viewOnly: data.viewOnly === true,
```

- [ ] **Step 4b: Members lookup uses the same validity rules as accept**

`members.get.ts` still requires `status === 'pending'`, so unlimited links the old `?? 1` bug flipped to `accepted` keep failing in the UI even though accept now takes them; it also shows a personal invitation's member list to anonymous sessions. Append these tests:

```ts
describe('GET /api/invitations/members', () => {
  async function callMembers(user: AppUser, invitationCode: string) {
    const { default: handler } = await import('~/server/api/invitations/members.get')
    return handler(makeEvent({ user, query: { invitationCode } }))
  }

  beforeEach(seedAcceptFixture)

  it('lists members for an unlimited link the old bug marked accepted', async () => {
    await seedInvitation('U2', { status: 'accepted', maxUses: null, usedCount: 1 })
    const result = await callMembers(googleUser('alice'), 'U2')
    expect(result.tripId).toBe('t1')
    expect(result.members.map((m: { id: string }) => m.id)).toContain('m-free')
  })

  it('hides a personal invitation\'s members from anonymous sessions', async () => {
    await seedInvitation('P1')
    await expect(callMembers(anonUser('anon'), 'P1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('still serves guest invitations to anonymous sessions', async () => {
    await seedInvitation('G1', { type: 'guest', maxUses: null })
    expect((await callMembers(anonUser('anon'), 'G1')).tripId).toBe('t1')
  })

  it('rejects used-up and expired invitations', async () => {
    await seedInvitation('USED', { status: 'accepted', usedCount: 1 })
    await seedInvitation('EXP', { expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await expect(callMembers(googleUser('alice'), 'USED')).rejects.toMatchObject({ statusCode: 400 })
    await expect(callMembers(googleUser('alice'), 'EXP')).rejects.toMatchObject({ statusCode: 400 })
  })
})
```

Then in `server/api/invitations/members.get.ts`, replace `import { Timestamp } from 'firebase-admin/firestore'` with `import { getInvitationState } from '~/server/utils/invitations'`, and replace the two validity checks (the `invitation.status !== 'pending'` block and the `expiresAt` block) with:

```ts
    // Same validity rules as accept: unlimited links stay open after their first use
    const state = getInvitationState(invitation)
    if (state !== 'valid') {
      throw createError({
        statusCode: 400,
        statusMessage: `Invitation is ${state}`,
      })
    }

    // Personal invitations are for Google accounts; don't show their member list to guests
    if (invitation.type !== 'guest' && user.isAnonymous) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Sign in with Google to accept this invitation',
      })
    }
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test:emulator`
Expected: create (3), list (1) and members (4) tests pass; everything earlier still passes.

- [ ] **Step 6: Commit**

```bash
git add server/api/invitations/create.post.ts server/api/invitations/list.get.ts server/api/invitations/members.get.ts tests/emulator/invitation-endpoints.test.ts
git commit -m "feat(api): support view-only invitations and crypto-random codes"
```

### Task 10: Atomic public join, no anonymous joins

**Files:**
- Modify: `server/api/trips/join.post.ts` (full rewrite)
- Create: `tests/emulator/trip-access-endpoints.test.ts`

- [ ] **Step 1: Create the test file with the join tests** — `tests/emulator/trip-access-endpoints.test.ts`

```ts
import type { AppUser } from '@/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anonUser, clearFirestore, getAdminDb, googleUser, makeEvent, seedTrip, stubH3Globals } from './helpers'

vi.mock('~/server/utils/session', async (importOriginal) => {
  const helpers = await import('./helpers')
  return {
    ...await importOriginal<typeof import('~/server/utils/session')>(),
    getFirebaseAdminFirestore: helpers.getAdminDb,
  }
})

beforeEach(async () => {
  stubH3Globals()
  await clearFirestore()
})

async function readCollaborator(uid: string) {
  const db = getAdminDb()
  const [collaborator, trip] = await Promise.all([
    db.doc(`trips/t1/collaborators/${uid}`).get(),
    db.doc('trips/t1').get(),
  ])
  return {
    collaborator: collaborator.exists ? collaborator.data() : null,
    inArray: (trip.data()?.collaboratorUserIds ?? []).includes(uid),
    collaboratorCount: trip.data()?.collaboratorCount,
  }
}

const newMember = { name: 'New', avatarEmoji: '🐱' }

describe('POST /api/trips/join', () => {
  async function callJoin(user: AppUser, body: Record<string, unknown>) {
    const { default: handler } = await import('~/server/api/trips/join.post')
    return handler(makeEvent({ user, body }))
  }

  beforeEach(() => seedTrip({
    trip: { isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' },
    members: [
      { id: 'm-free', name: 'Free' },
      { id: 'm-taken', name: 'Taken', linkedUserId: 'someone' },
    ],
  }))

  it('adds a Google user as an editor', async () => {
    expect(await callJoin(googleUser('alice'), { joinCode: 'JOIN1', memberId: 'm-free' }))
      .toEqual({ success: true, tripId: 't1' })
    const state = await readCollaborator('alice')
    expect(state.collaborator).toMatchObject({ role: 'editor', readOnly: false, joinedVia: 'public-link' })
    expect(state.inArray).toBe(true)
  })

  it('rejects anonymous users and writes nothing', async () => {
    await expect(callJoin(anonUser('anon'), { joinCode: 'JOIN1', newMember }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect((await readCollaborator('anon')).collaborator).toBeNull()
  })

  it('writes nothing when the member is already linked', async () => {
    await expect(callJoin(googleUser('alice'), { joinCode: 'JOIN1', memberId: 'm-taken' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect((await readCollaborator('alice')).collaborator).toBeNull()
  })

  it('rejects joins while public joining is off', async () => {
    await getAdminDb().doc('trips/t1').update({ isPublicInviteEnabled: false })
    await expect(callJoin(googleUser('alice'), { joinCode: 'JOIN1', newMember }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:emulator`
Expected: FAIL — "rejects anonymous users…" (currently succeeds) and "writes nothing when the member is already linked" (collaborator doc left behind); `readOnly` is also missing from the first test's collaborator.

- [ ] **Step 3: Rewrite** `server/api/trips/join.post.ts`

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  // The public link grants editor access, which anonymous guests never get
  if (user.isAnonymous) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Sign in with Google to join this trip',
    })
  }

  const { joinCode, memberId, newMember } = await readBody(event)

  if (!joinCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'joinCode is required',
    })
  }

  if (!memberId && !newMember) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either memberId or newMember is required',
    })
  }

  if (newMember && (!newMember.name || !newMember.avatarEmoji)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'newMember requires name and avatarEmoji',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()

    // One transaction: every check runs before any write
    const tripId = await db.runTransaction(async (tx) => {
      const tripsSnapshot = await tx.get(
        db.collection('trips').where('publicJoinCode', '==', joinCode).limit(1),
      )
      if (tripsSnapshot.empty) {
        throw createError({ statusCode: 404, statusMessage: 'Trip not found' })
      }

      const tripDoc = tripsSnapshot.docs[0]
      const tripData = tripDoc.data()
      const collaboratorRef = tripDoc.ref.collection('collaborators').doc(user.uid)
      const memberRef = memberId ? tripDoc.ref.collection('members').doc(memberId) : null

      const [collaboratorDoc, memberDoc] = await Promise.all([
        tx.get(collaboratorRef),
        memberRef ? tx.get(memberRef) : Promise.resolve(null),
      ])

      if (!tripData.isPublicInviteEnabled) {
        throw createError({ statusCode: 400, statusMessage: 'Public joining is disabled for this trip' })
      }
      if (collaboratorDoc.exists) {
        throw createError({ statusCode: 400, statusMessage: 'You are already a collaborator on this trip' })
      }
      if (tripData.userId === user.uid) {
        throw createError({ statusCode: 400, statusMessage: 'You are the owner of this trip' })
      }
      if (memberDoc && !memberDoc.exists) {
        throw createError({ statusCode: 404, statusMessage: 'Member not found' })
      }
      if (memberDoc?.data()?.linkedUserId) {
        throw createError({ statusCode: 400, statusMessage: 'This member is already linked to another user' })
      }

      tx.set(collaboratorRef, {
        userId: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL || null,
        role: 'editor',
        readOnly: false,
        joinedAt: FieldValue.serverTimestamp(),
        joinedVia: 'public-link',
      })

      if (memberRef) {
        tx.update(memberRef, { linkedUserId: user.uid })
      }
      else {
        tx.set(tripDoc.ref.collection('members').doc(), {
          name: newMember.name,
          avatarEmoji: newMember.avatarEmoji,
          isHost: false,
          spending: 0,
          createdAt: FieldValue.serverTimestamp(),
          linkedUserId: user.uid,
        })
      }

      tx.update(tripDoc.ref, {
        collaboratorCount: FieldValue.increment(1),
        collaboratorUserIds: FieldValue.arrayUnion(user.uid),
      })

      return tripDoc.id
    })

    return {
      success: true,
      tripId,
    }
  }
  catch (error: any) {
    if (error.statusCode)
      throw error

    console.error('Error joining trip:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to join trip',
    })
  }
})
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test:emulator`
Expected: join tests (4) pass; everything earlier still passes.

- [ ] **Step 5: Commit**

```bash
git add server/api/trips/join.post.ts tests/emulator/trip-access-endpoints.test.ts
git commit -m "fix(api): join via public link atomically and require Google sign-in"
```

---

### Task 11: Remove collaborators and toggle view-only

**Files:**
- Create: `server/utils/collaborators.ts`, `server/api/trips/[tripId]/collaborators/[userId].patch.ts`, `server/api/trips/[tripId]/collaborators/[userId].delete.ts`
- Modify: `server/api/trips/leave.post.ts` (full rewrite)
- Test: `tests/emulator/trip-access-endpoints.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
async function seedAccessFixture() {
  await seedTrip({
    collaborators: [
      { uid: 'owner', role: 'owner' },
      { uid: 'alice', role: 'editor' },
      { uid: 'guest', role: 'guest' },
    ],
    members: [
      { id: 'm-owner', name: 'Owner', linkedUserId: 'owner' },
      { id: 'm-alice', name: 'Alice', linkedUserId: 'alice' },
    ],
  })
  await getAdminDb().doc('trips/t1/expenses/e-alice').set({ description: 'Lunch', grandTotal: 30, createdByUserId: 'alice' })
}

async function callCollaborator(method: 'patch' | 'delete', user: AppUser, userId: string, body?: Record<string, unknown>) {
  const { default: handler } = method === 'patch'
    ? await import('~/server/api/trips/[tripId]/collaborators/[userId].patch')
    : await import('~/server/api/trips/[tripId]/collaborators/[userId].delete')
  return handler(makeEvent({ user, body, params: { tripId: 't1', userId } }))
}

describe('PATCH /api/trips/:tripId/collaborators/:userId', () => {
  beforeEach(seedAccessFixture)

  it('lets the owner switch a collaborator to view-only and back', async () => {
    await callCollaborator('patch', googleUser('owner'), 'alice', { readOnly: true })
    expect((await readCollaborator('alice')).collaborator?.readOnly).toBe(true)
    await callCollaborator('patch', googleUser('owner'), 'alice', { readOnly: false })
    expect((await readCollaborator('alice')).collaborator?.readOnly).toBe(false)
  })

  it('rejects non-owners, the owner as target, unknown targets and bad bodies', async () => {
    await expect(callCollaborator('patch', googleUser('alice'), 'guest', { readOnly: true })).rejects.toMatchObject({ statusCode: 403 })
    await expect(callCollaborator('patch', googleUser('owner'), 'owner', { readOnly: true })).rejects.toMatchObject({ statusCode: 400 })
    await expect(callCollaborator('patch', googleUser('owner'), 'nobody', { readOnly: true })).rejects.toMatchObject({ statusCode: 404 })
    await expect(callCollaborator('patch', googleUser('owner'), 'alice', { readOnly: 'yes' })).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('DELETE /api/trips/:tripId/collaborators/:userId', () => {
  beforeEach(seedAccessFixture)

  it('removes access but keeps the member entry and their expenses', async () => {
    expect(await callCollaborator('delete', googleUser('owner'), 'alice')).toEqual({ success: true })

    const state = await readCollaborator('alice')
    expect(state.collaborator).toBeNull()
    expect(state.inArray).toBe(false)
    expect(state.collaboratorCount).toBe(2)

    const member = await getAdminDb().doc('trips/t1/members/m-alice').get()
    expect(member.exists).toBe(true)
    expect(member.data()?.linkedUserId).toBeUndefined()
    expect((await getAdminDb().doc('trips/t1/expenses/e-alice').get()).exists).toBe(true)
  })

  it('rejects non-owners, removing the owner and unknown targets', async () => {
    await expect(callCollaborator('delete', googleUser('alice'), 'guest')).rejects.toMatchObject({ statusCode: 403 })
    await expect(callCollaborator('delete', googleUser('owner'), 'owner')).rejects.toMatchObject({ statusCode: 400 })
    await expect(callCollaborator('delete', googleUser('owner'), 'nobody')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('POST /api/trips/leave', () => {
  beforeEach(seedAccessFixture)

  async function callLeave(user: AppUser) {
    const { default: handler } = await import('~/server/api/trips/leave.post')
    return handler(makeEvent({ user, body: { tripId: 't1' } }))
  }

  it('removes the caller the same way as an owner removal', async () => {
    expect(await callLeave(googleUser('alice'))).toEqual({ success: true })
    const state = await readCollaborator('alice')
    expect(state.collaborator).toBeNull()
    expect(state.inArray).toBe(false)
    expect((await getAdminDb().doc('trips/t1/members/m-alice').get()).data()?.linkedUserId).toBeUndefined()
  })

  it('keeps the owner in and rejects non-collaborators', async () => {
    await expect(callLeave(googleUser('owner'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(callLeave(googleUser('stranger'))).rejects.toMatchObject({ statusCode: 400 })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:emulator`
Expected: FAIL — cannot resolve the `[userId].patch` / `[userId].delete` routes (leave tests pass already; they guard the refactor).

- [ ] **Step 3: Create** `server/utils/collaborators.ts`

```ts
import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'

/** Loads a trip, throwing 404 if it's missing and 403 unless `uid` owns it. */
export async function getOwnedTrip(db: Firestore, tripId: string, uid: string): Promise<DocumentData> {
  const tripDoc = await db.collection('trips').doc(tripId).get()
  if (!tripDoc.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Trip not found' })
  }
  const trip = tripDoc.data()!
  if (trip.userId !== uid) {
    throw createError({ statusCode: 403, statusMessage: 'Only the trip owner can manage access' })
  }
  return trip
}

/**
 * Takes a user's access away in one transaction: deletes their collaborator doc,
 * drops them from collaboratorUserIds and unlinks their member entry. The member
 * entry and the expenses they created stay. Returns false if they weren't a collaborator.
 */
export async function removeCollaborator(db: Firestore, tripId: string, userId: string): Promise<boolean> {
  const tripRef = db.collection('trips').doc(tripId)
  const collaboratorRef = tripRef.collection('collaborators').doc(userId)

  return db.runTransaction(async (tx) => {
    const [collaboratorDoc, linkedMembers] = await Promise.all([
      tx.get(collaboratorRef),
      tx.get(tripRef.collection('members').where('linkedUserId', '==', userId)),
    ])
    if (!collaboratorDoc.exists)
      return false

    for (const member of linkedMembers.docs)
      tx.update(member.ref, { linkedUserId: FieldValue.delete() })
    tx.delete(collaboratorRef)
    tx.update(tripRef, {
      collaboratorUserIds: FieldValue.arrayRemove(userId),
      collaboratorCount: FieldValue.increment(-1),
    })
    return true
  })
}
```

- [ ] **Step 4: Create** `server/api/trips/[tripId]/collaborators/[userId].patch.ts`

```ts
import { getOwnedTrip } from '~/server/utils/collaborators'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const tripId = getRouterParam(event, 'tripId')
  const userId = getRouterParam(event, 'userId')
  if (!tripId || !userId) {
    throw createError({ statusCode: 400, statusMessage: 'tripId and userId are required' })
  }

  const { readOnly } = await readBody(event)
  if (typeof readOnly !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'readOnly (boolean) is required' })
  }

  const db = getFirebaseAdminFirestore()
  const trip = await getOwnedTrip(db, tripId, user.uid)
  if (userId === trip.userId) {
    throw createError({ statusCode: 400, statusMessage: 'The trip owner always has full access' })
  }

  const collaboratorRef = db.collection('trips').doc(tripId).collection('collaborators').doc(userId)
  if (!(await collaboratorRef.get()).exists) {
    throw createError({ statusCode: 404, statusMessage: 'Not a collaborator on this trip' })
  }

  await collaboratorRef.update({ readOnly })
  return { success: true, readOnly }
})
```

- [ ] **Step 5: Create** `server/api/trips/[tripId]/collaborators/[userId].delete.ts`

```ts
import { getOwnedTrip, removeCollaborator } from '~/server/utils/collaborators'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const tripId = getRouterParam(event, 'tripId')
  const userId = getRouterParam(event, 'userId')
  if (!tripId || !userId) {
    throw createError({ statusCode: 400, statusMessage: 'tripId and userId are required' })
  }

  const db = getFirebaseAdminFirestore()
  const trip = await getOwnedTrip(db, tripId, user.uid)
  if (userId === trip.userId) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot remove the trip owner' })
  }

  if (!(await removeCollaborator(db, tripId, userId))) {
    throw createError({ statusCode: 404, statusMessage: 'Not a collaborator on this trip' })
  }

  return { success: true }
})
```

- [ ] **Step 6: Rewrite** `server/api/trips/leave.post.ts` on top of the shared helper

```ts
import { removeCollaborator } from '~/server/utils/collaborators'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  const { tripId } = await readBody(event)

  if (!tripId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'tripId is required',
    })
  }

  try {
    const db = getFirebaseAdminFirestore()
    const tripDoc = await db.collection('trips').doc(tripId).get()

    if (!tripDoc.exists) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Trip not found',
      })
    }

    // Owner cannot leave their own trip
    if (tripDoc.data()!.userId === user.uid) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Trip owner cannot leave the trip',
      })
    }

    if (!(await removeCollaborator(db, tripId, user.uid))) {
      throw createError({
        statusCode: 400,
        statusMessage: 'You are not a collaborator on this trip',
      })
    }

    return { success: true }
  }
  catch (error: any) {
    if (error.statusCode) {
      throw error
    }

    console.error('Error leaving trip:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to leave trip',
    })
  }
})
```

- [ ] **Step 7: Run to verify they pass**

Run: `pnpm test:emulator`
Expected: PATCH (2), DELETE (2) and leave (2) tests pass; everything earlier still passes.

- [ ] **Step 8: Commit**

```bash
git add server/utils/collaborators.ts "server/api/trips/[tripId]/collaborators" server/api/trips/leave.post.ts tests/emulator/trip-access-endpoints.test.ts
git commit -m "feat(api): let owners remove collaborators and switch them to view-only"
```

---

### Task 12: Reset the public join link

**Files:**
- Create: `server/api/trips/reset-public-link.post.ts`
- Modify: `server/api/trips/toggle-public-invite.post.ts:1,47-50`
- Test: `tests/emulator/trip-access-endpoints.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
describe('public join link', () => {
  beforeEach(() => seedTrip({ trip: { isPublicInviteEnabled: true, publicJoinCode: 'JOIN1' } }))

  async function callReset(user: AppUser) {
    const { default: handler } = await import('~/server/api/trips/reset-public-link.post')
    return handler(makeEvent({ user, body: { tripId: 't1' } }))
  }

  async function callJoinInfo(joinCode: string) {
    const { default: handler } = await import('~/server/api/trips/join-info.get')
    return handler(makeEvent({ query: { joinCode } }))
  }

  it('reset issues a new code and kills the old one', async () => {
    const { publicJoinCode } = await callReset(googleUser('owner'))
    expect(publicJoinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/)
    await expect(callJoinInfo('JOIN1')).rejects.toMatchObject({ statusCode: 404 })
    expect(await callJoinInfo(publicJoinCode)).toMatchObject({ tripId: 't1' })
  })

  it('reset is owner-only', async () => {
    await expect(callReset(googleUser('stranger'))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('first enable generates a 10-character code', async () => {
    await getAdminDb().doc('trips/t1').update({ isPublicInviteEnabled: false, publicJoinCode: null })
    const { default: handler } = await import('~/server/api/trips/toggle-public-invite.post')
    const result = await handler(makeEvent({ user: googleUser('owner'), body: { tripId: 't1', enabled: true } }))
    expect(result.publicJoinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:emulator`
Expected: FAIL — cannot resolve `reset-public-link.post`; the toggle test fails the 10-char pattern (current code is 8 chars and may contain 0/1/O/I/L).

- [ ] **Step 3: Create** `server/api/trips/reset-public-link.post.ts`

```ts
import { generateUniqueCode, publicJoinCodeTaken } from '~/server/utils/codes'
import { getOwnedTrip } from '~/server/utils/collaborators'
import { getFirebaseAdminFirestore, getUserFromSession } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { tripId } = await readBody(event)
  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'tripId is required' })
  }

  const db = getFirebaseAdminFirestore()
  await getOwnedTrip(db, tripId, user.uid)

  // The old /join/<code> URL stops resolving as soon as this is written
  const publicJoinCode = await generateUniqueCode(publicJoinCodeTaken(db))
  await db.collection('trips').doc(tripId).update({ publicJoinCode })

  return { publicJoinCode }
})
```

- [ ] **Step 4: Use the generator in `server/api/trips/toggle-public-invite.post.ts`**

Add the import below the existing one:

```ts
import { generateUniqueCode, publicJoinCodeTaken } from '~/server/utils/codes'
```

Replace:

```ts
      updateData.publicJoinCode = Math.random().toString(36).substring(2, 10).toUpperCase()
```

with:

```ts
      updateData.publicJoinCode = await generateUniqueCode(publicJoinCodeTaken(db))
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test:emulator`
Expected: public link tests (3) pass; full emulator suite green.

- [ ] **Step 6: Commit**

```bash
git add server/api/trips/reset-public-link.post.ts server/api/trips/toggle-public-invite.post.ts tests/emulator/trip-access-endpoints.test.ts
git commit -m "feat(api): add public join link reset"
```

### Task 13: Client composables

No unit tests here — these wrap `$fetch` and vuefire bindings. They're exercised by the manual pass in Task 18.

**Files:**
- Create: `composables/useTripAccess.ts`
- Modify: `composables/useInvitation.ts`, `composables/useTripCollaborators.ts`

- [ ] **Step 1: Create** `composables/useTripAccess.ts`

```ts
/** Owner-only access management. The server enforces ownership; these just call it. */
export function useTripAccess() {
  function setCollaboratorReadOnly(tripId: string, userId: string, readOnly: boolean) {
    return $fetch<{ success: boolean, readOnly: boolean }>(`/api/trips/${tripId}/collaborators/${userId}`, {
      method: 'PATCH',
      body: { readOnly },
    })
  }

  function removeCollaborator(tripId: string, userId: string) {
    return $fetch<{ success: boolean }>(`/api/trips/${tripId}/collaborators/${userId}`, {
      method: 'DELETE',
    })
  }

  function resetPublicLink(tripId: string) {
    return $fetch<{ publicJoinCode: string }>('/api/trips/reset-public-link', {
      method: 'POST',
      body: { tripId },
    })
  }

  return { setCollaboratorReadOnly, removeCollaborator, resetPublicLink }
}
```

- [ ] **Step 2: Add preview + `viewOnly` to** `composables/useInvitation.ts`

Change the type import on line 1:

```ts
import type { Invitation, InvitationPreview } from '@/types'
```

Add to `CreateInvitationParams`:

```ts
  viewOnly?: boolean
```

Add this function inside `useInvitation()`, after `getInvitationMembers`:

```ts
  // Public lookup used by the invite/guest pages before sign-in
  function getInvitationPreview(invitationCode: string): Promise<InvitationPreview> {
    return $fetch<InvitationPreview>('/api/invitations/preview', {
      query: { code: invitationCode },
    })
  }
```

and add `getInvitationPreview,` to the returned object. Leave `getInvitationByCode` in place for now — Task 14 removes it once no page uses it.

- [ ] **Step 3: Add `isReadOnly` to** `composables/useTripCollaborators.ts`

After the `isGuest` computed, add:

```ts
  const isReadOnly = computed(() => {
    // The owner always has full access, whatever their collaborator doc says
    return !isOwner.value && currentUserCollaborator.value?.readOnly === true
  })
```

Replace `canManageExpenses`, `canAddExpenses`, `canEditExpense` and `canDeleteExpense` with:

```ts
  const canManageExpenses = computed(() => {
    // Owner and editors can manage all expenses (bulk operations)
    // Guests are excluded — they use fine-grained canEditExpense/canDeleteExpense
    if (isGuest.value || isReadOnly.value)
      return false
    return isCollaborator.value || isOwner.value
  })

  const canAddExpenses = computed(() => {
    // All collaborators including guests can add expenses, unless they're view-only
    return isCollaborator.value && !isReadOnly.value
  })

  const canEditExpense = (expense: Expense) => {
    if (isReadOnly.value)
      return false
    if (isOwner.value || currentUserCollaborator.value?.role === 'editor')
      return true
    if (isCollaborator.value && expense.createdByUserId === sessionUser.value?.uid)
      return true
    return false
  }

  const canDeleteExpense = (expense: Expense) => {
    if (isReadOnly.value)
      return false
    if (isOwner.value || currentUserCollaborator.value?.role === 'editor')
      return true
    if (isCollaborator.value && expense.createdByUserId === sessionUser.value?.uid)
      return true
    return false
  }
```

Add `isReadOnly,` to the returned object after `isGuest,`.

- [ ] **Step 4: Lint and run the unit suite**

Run: `npx eslint composables/useTripAccess.ts composables/useInvitation.ts composables/useTripCollaborators.ts && pnpm vitest run`
Expected: no lint errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add composables/useTripAccess.ts composables/useInvitation.ts composables/useTripCollaborators.ts
git commit -m "feat(composables): add view-only permissions and access management wrappers"
```

---

### Task 14: Invite, guest and join pages

After this task nothing on the client reads the `invitations` collection, which is what makes the Task 5 rules deployable.

**Files:**
- Modify: `pages/guest/[code].vue`, `pages/invite/[code].vue`, `pages/join/[code].vue`, `composables/useInvitation.ts`, `utils/converter.ts`

- [ ] **Step 1: Guest page — load the preview instead of querying Firestore** (`pages/guest/[code].vue`)

Add to the imports at the top of `<script setup>`:

```ts
import type { InvitationPreview } from '@/types'
```

Replace line 13 (`const { invitation, isLoading } = useInvitation().getInvitationByCode(invitationCode)`) with:

```ts
const invitation = ref<InvitationPreview | null>(null)
const isLoading = ref(true)
useInvitation().getInvitationPreview(invitationCode)
  .then((preview) => {
    invitation.value = preview
  })
  .catch(() => {
    invitation.value = null
  })
  .finally(() => {
    isLoading.value = false
  })
```

Replace the `isExpired`, `isAlreadyUsed`, `isRevoked` and `isGuestInvitation` computeds (lines 27–48) with:

```ts
const isExpired = computed(() => invitation.value?.state === 'expired')
const isAlreadyUsed = computed(() => invitation.value?.state === 'used')
const isRevoked = computed(() => invitation.value?.state === 'revoked')
const isGuestInvitation = computed(() => invitation.value?.type === 'guest')
```

Replace the `isUsable` computed (lines 78–88) with:

```ts
// Check if invitation is usable
const isUsable = computed(() => invitation.value?.state === 'valid' && isGuestInvitation.value)
```

In `loadMembers()`, the preview has no `tripId`, so take it from the members response. Replace:

```ts
    const currentUid = sessionUser.value?.uid
    if (currentUid && invitation.value) {
      const alreadyLinked = result.members.some(m => m.linkedUserId === currentUid)
      if (alreadyLinked) {
        toast.info('你已經是此行程的成員')
        router.replace(`/trips/${invitation.value.tripId}`)
        return
      }
    }
```

with:

```ts
    const currentUid = sessionUser.value?.uid
    if (currentUid) {
      const alreadyLinked = result.members.some(m => m.linkedUserId === currentUid)
      if (alreadyLinked) {
        toast.info('你已經是此行程的成員')
        router.replace(`/trips/${result.tripId}`)
        return
      }
    }
```

In the template, the expired card: replace `new Date(invitation.expiresAtString)` with `new Date(invitation.expiresAt)`.

In the valid-invitation header, directly after the `<h1>` holding `{{ invitation.tripName }}`, add:

```vue
          <p v-if="invitation.viewOnly" class="flex items-center justify-center gap-1.5 text-xs text-muted-foreground m-0 mt-3">
            <Icon name="lucide:eye" :size="14" />
            你將以僅檢視身份加入
          </p>
```

- [ ] **Step 2: Invite page — preview, view-only hint, Google-only** (`pages/invite/[code].vue`)

Add to the imports at the top of `<script setup>`:

```ts
import type { InvitationPreview } from '@/types'
```

Replace line 15 (`const { invitation, isLoading } = useInvitation().getInvitationByCode(invitationCode)`) with:

```ts
const invitation = ref<InvitationPreview | null>(null)
const isLoading = ref(true)
useInvitation().getInvitationPreview(invitationCode)
  .then((preview) => {
    invitation.value = preview
  })
  .catch(() => {
    invitation.value = null
  })
  .finally(() => {
    isLoading.value = false
  })
```

After `const sessionUser = useSessionUser()`, add:

```ts
// Personal invitations grant editor access, so an anonymous guest session must sign in with Google
const needsGoogleLogin = computed(() => !isUserLoggedIn.value || !!sessionUser.value?.isAnonymous)
```

Replace the `isExpired`, `isAlreadyUsed` and `isRevoked` computeds (lines 28–45) with:

```ts
const isExpired = computed(() => invitation.value?.state === 'expired')
const isAlreadyUsed = computed(() => invitation.value?.state === 'used')
const isRevoked = computed(() => invitation.value?.state === 'revoked')
```

In `canAccept`, replace `if (!isUserLoggedIn.value || !membersLoaded.value)` with:

```ts
  if (needsGoogleLogin.value || !membersLoaded.value)
```

Replace the `isUsable` computed and the `watch([isUserLoggedIn, invitation], …)` below it (lines 77–91) with:

```ts
// Load members once the user is signed in with Google and the invitation is valid
const isUsable = computed(() => invitation.value?.state === 'valid')

watch([needsGoogleLogin, invitation], async ([needsLogin, inv]) => {
  if (!needsLogin && inv && isUsable.value) {
    await loadMembers()
  }
}, { immediate: true })
```

In `loadMembers()`, the preview has no `tripId`, so take it from the members response. Replace:

```ts
    const currentUid = sessionUser.value?.uid
    if (currentUid && invitation.value) {
      const alreadyLinked = result.members.some(m => m.linkedUserId === currentUid)
      if (alreadyLinked) {
        toast.info('你已經是此行程的成員')
        router.replace(`/trips/${invitation.value.tripId}`)
        return
      }
    }
```

with:

```ts
    const currentUid = sessionUser.value?.uid
    if (currentUid) {
      const alreadyLinked = result.members.some(m => m.linkedUserId === currentUid)
      if (alreadyLinked) {
        toast.info('你已經是此行程的成員')
        router.replace(`/trips/${result.tripId}`)
        return
      }
    }
```

In the template:
- Expired card: replace `new Date(invitation.expiresAtString)` with `new Date(invitation.expiresAt)`.
- Replace the whole `<!-- Already Used -->` block (it links to `invitation.tripId`, which the preview no longer exposes) with:

```vue
      <!-- Already Used -->
      <div v-else-if="isAlreadyUsed" class="animate-card-in bg-white rounded-2xl shadow-lg border border-gray-100 p-10">
        <div class="flex flex-col items-center justify-center space-y-5 text-center">
          <div class="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center">
            <Icon name="lucide:check-circle-2" size="44" class="text-green-500" />
          </div>
          <div class="space-y-2">
            <h1 class="text-xl font-bold text-foreground m-0 tracking-tight">
              連結已用完
            </h1>
            <p class="text-sm text-muted-foreground m-0 leading-relaxed">
              此邀請連結的使用次數已達上限。如果你已經加入，可以從首頁進入行程
            </p>
          </div>
          <ui-button @click="router.push('/')">
            前往首頁
            <Icon name="lucide:arrow-right" class="w-4 h-4 ml-1.5" />
          </ui-button>
        </div>
      </div>
```

- In the valid-invitation header, directly after the `<h1>` holding `{{ invitation.tripName }}`, add:

```vue
          <p v-if="invitation.viewOnly" class="flex items-center justify-center gap-1.5 text-xs text-muted-foreground m-0 mt-3">
            <Icon name="lucide:eye" :size="14" />
            你將以僅檢視身份加入
          </p>
```
- Replace `<template v-if="!isUserLoggedIn">` (Step 1: Login Required) with `<template v-if="needsGoogleLogin">`, and replace its first paragraph's text with:

```vue
              <p class="text-sm text-muted-foreground m-0 leading-relaxed">
                {{ sessionUser?.isAnonymous ? '此邀請需要 Google 帳號，訪客身份無法使用' : '登入後即可加入行程，和大家一起分帳' }}
              </p>
```

Signing in with Google from an anonymous session replaces that browser's guest identity. Guest trips stay linked to the old anonymous account. That's acceptable here: personal invites are meant for Google users.

- [ ] **Step 3: Join page — Google-only** (`pages/join/[code].vue`)

After `const sessionUser = useSessionUser()`, add:

```ts
// The public link grants editor access, so an anonymous guest session must sign in with Google
const needsGoogleLogin = computed(() => !isUserLoggedIn.value || !!sessionUser.value?.isAnonymous)
```

In `canJoin`, replace `if (!isUserLoggedIn.value || !tripInfo.value)` with:

```ts
  if (needsGoogleLogin.value || !tripInfo.value)
```

Replace:

```ts
// Load trip info when user logs in
watch(isUserLoggedIn, async (loggedIn) => {
  if (loggedIn)
    await loadTripInfo()
}, { immediate: true })
```

with:

```ts
// join-info needs no sign-in: load it straight away so the login step can render,
// and again after sign-in so the "already a member" redirect sees the new user
watch(needsGoogleLogin, async () => {
  await loadTripInfo()
}, { immediate: true })
```

(Before this change a signed-out visitor never loaded trip info, so `isLoading` stayed `true` and the page showed only the spinner.)

In the template, replace `<template v-if="!isUserLoggedIn">` with `<template v-if="needsGoogleLogin">`, and replace its first paragraph with:

```vue
              <p class="text-sm text-muted-foreground m-0 leading-relaxed">
                {{ sessionUser?.isAnonymous ? '此邀請需要 Google 帳號，訪客身份無法使用' : '登入後即可加入行程，和大家一起分帳' }}
              </p>
```

- [ ] **Step 4: Remove the now-unused Firestore lookup**

In `composables/useInvitation.ts`, delete `getInvitationByCode` and its entry in the returned object, then delete the now-unused imports:

```ts
import { collection, query, where } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'
import { invitationConverter } from '@/utils/converter'
```

In `utils/converter.ts`, delete `invitationConverter` (lines 145–173) and remove `Invitation` from the type import on line 8.

Run: `npx eslint composables/useInvitation.ts utils/converter.ts "pages/guest/[code].vue" "pages/invite/[code].vue" "pages/join/[code].vue"`
Expected: no errors (in particular, no remaining references to `getInvitationByCode` or `invitationConverter`).

- [ ] **Step 5: Check the pages in the browser**

Run `pnpm dev`. In a private window, open `/guest/<code>` and `/invite/<code>` for a real invitation from the invite modal, plus a made-up code:
- valid codes render the trip name and inviter; the made-up code shows 「連結無效」
- DevTools → Network: no Firestore `Listen` channel request for `invitations`; one `GET /api/invitations/preview?code=…`

- [ ] **Step 6: Commit**

```bash
git add "pages/guest/[code].vue" "pages/invite/[code].vue" "pages/join/[code].vue" composables/useInvitation.ts utils/converter.ts
git commit -m "feat(invite): look up invitations via the preview endpoint and require Google for editor links"
```

### Task 15: View-only option in the invite modal

**Files:**
- Modify: `components/InviteCollaboratorsModal.vue`

Line numbers below refer to the file before this task; the desktop dialog and mobile drawer duplicate their markup, so each change is made twice.

- [ ] **Step 1: Script state and API calls**

After `const guestMaxUses = ref<number | null>(null)` (line 32), add:

```ts
const viewOnly = ref(false)
const guestViewOnly = ref(false)
```

In `handleCreateInvitation`, add `viewOnly: viewOnly.value,` after `maxUses: maxUses.value,`.
In `handleCreateGuestInvitation`, add `viewOnly: guestViewOnly.value,` after `type: 'guest',`.

- [ ] **Step 2: The switch, in all four create sections**

Insert immediately **before** each create button:
- desktop collaborator — before `<ui-button class="w-full" :disabled="isCreating" …>` (line 276)
- mobile collaborator — before the same button (line 603)

```vue
              <div class="flex items-center justify-between gap-3">
                <div>
                  <ui-label for="invite-view-only" class="text-sm font-medium text-foreground">
                    僅檢視
                  </ui-label>
                  <p class="text-xs text-muted-foreground m-0 mt-0.5">
                    加入者只能查看，無法新增或編輯支出
                  </p>
                </div>
                <ui-switch id="invite-view-only" v-model="viewOnly" />
              </div>
```

- desktop guest — before `<ui-button class="w-full" :disabled="isCreatingGuest" …>` (line 431)
- mobile guest — before the same button (line 694)

```vue
              <div class="flex items-center justify-between gap-3">
                <div>
                  <ui-label for="guest-view-only" class="text-sm font-medium text-foreground">
                    僅檢視
                  </ui-label>
                  <p class="text-xs text-muted-foreground m-0 mt-0.5">
                    訪客只能查看，無法新增或編輯支出
                  </p>
                </div>
                <ui-switch id="guest-view-only" v-model="guestViewOnly" />
              </div>
```

(The desktop and mobile variants never render together — `v-if="isDesktop"` / `v-else` — so the repeated ids don't collide.)

- [ ] **Step 3: Badge on view-only links, in all four pending lists**

Insert after the status badge in each pending-list row header — desktop collaborator (after line 300), desktop guest (after line 458), mobile collaborator (after line 626), and mobile guest (after the 「訪客」 badge ending line 717):

```vue
                        <ui-badge v-if="invitation.viewOnly" variant="outline">
                          僅檢視
                        </ui-badge>
```

- [ ] **Step 4: Check it in the browser**

Run `pnpm dev`, open a trip you own → 設定 → 協作者 → 邀請協作者:
- both tabs show the 僅檢視 switch, off by default
- creating a link with it on shows the 僅檢視 badge on that link
- at 400px width (DevTools device toolbar), the switch row doesn't overflow the drawer

Run: `npx eslint components/InviteCollaboratorsModal.vue`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/InviteCollaboratorsModal.vue
git commit -m "feat(invite): add view-only option to invitation links"
```

---

### Task 16: Access controls in trip settings

**Files:**
- Modify: `pages/trips/[tripId]/edit.vue`

- [ ] **Step 1: Script**

Line 2 — change the type import to:

```ts
import type { TripCollaborator, TripMember } from '@/types'
```

After line 37 (`const { collaborators, isOwner, canInvite } = useTripCollaborators(tripId)`), add:

```ts
const { setCollaboratorReadOnly, removeCollaborator, resetPublicLink } = useTripAccess()
```

After `handleTogglePublicInvite` (ends line 103), add:

```ts
// Collaborator access (owner only)
const updatingCollaboratorIds = ref<string[]>([])

async function handleToggleCanEdit(collaborator: TripCollaborator, canEdit: boolean) {
  const { userId } = collaborator
  updatingCollaboratorIds.value = [...updatingCollaboratorIds.value, userId]
  try {
    await setCollaboratorReadOnly(tripId, userId, !canEdit)
  }
  catch (error) {
    // The switch is bound to live Firestore data, so it snaps back on its own
    console.error('Error updating collaborator access:', error)
    toast.error('更新權限失敗')
  }
  finally {
    updatingCollaboratorIds.value = updatingCollaboratorIds.value.filter(id => id !== userId)
  }
}

const collaboratorToRemove = ref<TripCollaborator | null>(null)
const isRemovingCollaborator = ref(false)

async function confirmRemoveCollaborator() {
  const target = collaboratorToRemove.value
  if (!target)
    return
  try {
    isRemovingCollaborator.value = true
    await removeCollaborator(tripId, target.userId)
    toast.success(`已移除 ${target.displayName || '協作者'}`)
    collaboratorToRemove.value = null
  }
  catch (error) {
    console.error('Error removing collaborator:', error)
    toast.error('移除失敗')
  }
  finally {
    isRemovingCollaborator.value = false
  }
}

const showResetLinkDialog = ref(false)
const isResettingLink = ref(false)

async function confirmResetPublicLink() {
  try {
    isResettingLink.value = true
    await resetPublicLink(tripId)
    toast.success('已重設連結，舊連結已失效')
    showResetLinkDialog.value = false
  }
  catch (error) {
    console.error('Error resetting public link:', error)
    toast.error('重設連結失敗')
  }
  finally {
    isResettingLink.value = false
  }
}
```

- [ ] **Step 2: Collaborator rows**

In the Collaborators tab, replace the two role badges (lines 675–681):

```vue
                  <ui-badge v-if="collaborator.role === 'owner'" variant="default" class="text-xs shrink-0">
                    <Icon name="lucide:crown" :size="12" class="mr-1" />
                    建立者
                  </ui-badge>
                  <ui-badge v-else variant="secondary" class="text-xs shrink-0">
                    編輯者
                  </ui-badge>
```

with:

```vue
                  <ui-badge v-if="collaborator.role === 'owner'" variant="default" class="text-xs shrink-0">
                    <Icon name="lucide:crown" :size="12" class="mr-1" />
                    建立者
                  </ui-badge>
                  <template v-else>
                    <ui-badge variant="secondary" class="text-xs shrink-0">
                      {{ collaborator.role === 'guest' ? '訪客' : '編輯者' }}
                    </ui-badge>
                    <template v-if="isOwner">
                      <div class="flex items-center gap-1.5 shrink-0">
                        <ui-label :for="`can-edit-${collaborator.userId}`" class="text-xs text-muted-foreground">
                          可編輯
                        </ui-label>
                        <ui-switch
                          :id="`can-edit-${collaborator.userId}`"
                          :model-value="!collaborator.readOnly"
                          :disabled="updatingCollaboratorIds.includes(collaborator.userId)"
                          @update:model-value="(canEdit: boolean) => handleToggleCanEdit(collaborator, canEdit)"
                        />
                      </div>
                      <ui-button
                        type="button"
                        size="icon"
                        variant="ghost"
                        class="size-11 shrink-0"
                        :aria-label="`移除 ${collaborator.displayName || '協作者'}`"
                        @click="collaboratorToRemove = collaborator"
                      >
                        <Icon name="lucide:user-minus" :size="16" class="text-destructive" />
                      </ui-button>
                    </template>
                    <ui-badge v-else-if="collaborator.readOnly" variant="outline" class="text-xs shrink-0">
                      僅檢視
                    </ui-badge>
                  </template>
```

- [ ] **Step 3: Reset link button**

In the Settings tab, replace the public-link row (lines 728–733):

```vue
                <div v-if="trip?.isPublicInviteEnabled && publicJoinUrl" class="flex items-center gap-2">
                  <ui-input :value="publicJoinUrl" readonly class="flex-1 font-mono text-sm" />
                  <ui-button size="sm" variant="outline" @click="copyToClipboard(publicJoinUrl)">
                    <Icon name="lucide:copy" :size="16" />
                  </ui-button>
                </div>
```

with:

```vue
                <template v-if="trip?.isPublicInviteEnabled && publicJoinUrl">
                  <div class="flex items-center gap-2">
                    <ui-input :value="publicJoinUrl" readonly class="flex-1 font-mono text-sm" />
                    <ui-button size="sm" variant="outline" aria-label="複製連結" @click="copyToClipboard(publicJoinUrl)">
                      <Icon name="lucide:copy" :size="16" />
                    </ui-button>
                  </div>
                  <ui-button type="button" size="sm" variant="ghost" class="text-muted-foreground" @click="showResetLinkDialog = true">
                    <Icon name="lucide:refresh-cw" :size="14" class="mr-1.5" />
                    重設連結
                  </ui-button>
                </template>
```

- [ ] **Step 4: Confirmation dialogs**

Insert directly before `<!-- Invite Collaborators Drawer -->` (line 804):

```vue
  <!-- Remove Collaborator Confirmation -->
  <ui-alert-dialog :open="!!collaboratorToRemove" @update:open="(open: boolean) => { if (!open) collaboratorToRemove = null }">
    <ui-alert-dialog-content>
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>移除 {{ collaboratorToRemove?.displayName || '協作者' }}？</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          對方將無法再查看此行程，他們建立的支出會保留。
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-alert-dialog-cancel :disabled="isRemovingCollaborator">
          取消
        </ui-alert-dialog-cancel>
        <ui-button variant="destructive" :disabled="isRemovingCollaborator" @click="confirmRemoveCollaborator">
          <Icon v-if="isRemovingCollaborator" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isRemovingCollaborator ? '移除中...' : '移除' }}
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>

  <!-- Reset Public Link Confirmation -->
  <ui-alert-dialog v-model:open="showResetLinkDialog">
    <ui-alert-dialog-content>
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>重設加入連結？</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          重設後，舊的連結將失效，需要重新分享新連結。
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-alert-dialog-cancel :disabled="isResettingLink">
          取消
        </ui-alert-dialog-cancel>
        <ui-button :disabled="isResettingLink" @click="confirmResetPublicLink">
          <Icon v-if="isResettingLink" name="lucide:loader-2" class="animate-spin mr-2" :size="16" />
          {{ isResettingLink ? '重設中...' : '重設' }}
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog-content>
  </ui-alert-dialog>
```

- [ ] **Step 5: Check it in the browser**

Run `pnpm dev`. As the owner (use `window.__devLogin()` for a second account in another browser profile), with one collaborator on the trip:
- 設定 → 協作者: the collaborator row shows its role badge, a 可編輯 switch and a remove button; the owner row shows only 建立者
- flipping 可編輯 off persists across a reload; the collaborator's session sees 僅檢視 on their own row
- remove → dialog → 移除: the row disappears and the toast shows
- 設定 → 設定: 重設連結 → 重設 changes the URL in the input; the old `/join/<code>` shows the page's not-found state
- at 400px width the collaborator row still fits (name truncates)

Run: `npx eslint "pages/trips/[tripId]/edit.vue"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "pages/trips/[tripId]/edit.vue"
git commit -m "feat(trip): let owners switch collaborators to view-only, remove them, and reset the join link"
```

### Task 17: View-only experience and the removal redirect

The spec places the redirect in the bottom-bar layout, but `pages/trips/[tripId]/edit.vue` uses the default layout, so a removed user sitting on the settings page would never be redirected. It's mounted once in `app.vue` instead, keyed off the route's `tripId`.

**Files:**
- Create: `composables/useRemovedFromTripRedirect.ts`
- Modify: `app.vue`, `pages/trips/[tripId]/edit.vue:304-332`, `pages/trips/[tripId]/index.vue:15,364-366`, `pages/trips/[tripId]/expenses/index.vue:41-43,172-173`

- [ ] **Step 1: Create** `composables/useRemovedFromTripRedirect.ts`

```ts
import type { MaybeRefOrGetter } from 'vue'
import { doc, onSnapshot } from 'firebase/firestore'
import { toast } from 'vue-sonner'
import { useFirestore } from 'vuefire'

// Trips the current user is leaving on purpose (the leave button), so their own
// departure isn't reported as "you were removed".
const expectedExits = new Set<string>()

/** Call before leaving a trip. Returns a function that cancels the expectation if leaving fails. */
export function expectTripExit(tripId: string) {
  expectedExits.add(tripId)
  return () => {
    expectedExits.delete(tripId)
  }
}

/**
 * Sends the user home when they lose access to the trip they're looking at —
 * i.e. the owner removed them. Mount once, in app.vue.
 */
export function useRemovedFromTripRedirect(tripId: MaybeRefOrGetter<string | undefined>) {
  const db = useFirestore()
  const sessionUser = useSessionUser()
  const router = useRouter()

  function handleLostAccess(id: string) {
    if (expectedExits.delete(id))
      return
    toast.info('你已被移出此行程')
    router.replace('/')
  }

  watch(
    () => {
      const id = toValue(tripId)
      const uid = sessionUser.value?.uid
      return id && uid ? { id, uid } : null
    },
    (target, _previous, onCleanup) => {
      if (!target)
        return
      // Only react to losing access this listener has actually seen
      let hadAccess = false
      const unsubscribe = onSnapshot(
        doc(db, 'trips', target.id, 'collaborators', target.uid),
        (snapshot) => {
          if (snapshot.exists())
            hadAccess = true
          else if (hadAccess)
            handleLostAccess(target.id)
        },
        // Once removed, the rules may deny the listener instead of sending a delete
        (error) => {
          if (hadAccess && error.code === 'permission-denied')
            handleLostAccess(target.id)
        },
      )
      onCleanup(unsubscribe)
    },
    { immediate: true },
  )
}
```

- [ ] **Step 2: Mount it in** `app.vue`

After `const { $pwa } = useNuxtApp()`, add:

```ts
const route = useRoute()
useRemovedFromTripRedirect(() => route.params.tripId as string | undefined)
```

- [ ] **Step 3: Don't report a voluntary leave as a removal** (`pages/trips/[tripId]/edit.vue`)

Replace `handleLeaveTrip` (lines 304–332) with:

```ts
async function handleLeaveTrip() {
  const cancelExpectedExit = expectTripExit(tripId)
  try {
    isLeaving.value = true
    await $fetch('/api/trips/leave', {
      method: 'POST',
      body: { tripId },
    })

    // Anonymous guests should be fully signed out after leaving
    if (sessionUser.value?.isAnonymous) {
      const { logout } = useLogin()
      await logout()
      toast.success('已離開行程')
      router.replace('/login')
    }
    else {
      toast.success('已離開行程')
      router.replace('/')
    }
  }
  catch (error: any) {
    cancelExpectedExit()
    console.error('Error leaving trip:', error)
    toast.error(error.data?.message || '離開行程失敗')
  }
  finally {
    isLeaving.value = false
    showLeaveWarning.value = false
  }
}
```

- [ ] **Step 4: Tell view-only users why they can't add** (`pages/trips/[tripId]/index.vue`)

Line 15 — change to:

```ts
const { canAddExpenses, isReadOnly } = useTripCollaborators(tripId as string)
```

In the 「近期支出紀錄」 header, directly after the `<ui-badge v-else-if="trip.archived" …>已封存</ui-badge>` block (lines 364–366), add:

```vue
          <span v-else-if="isReadOnly" class="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="lucide:eye" :size="14" />
            你目前僅能檢視此行程
          </span>
```

- [ ] **Step 5: Hide bulk auto-labelling from people who can't edit every expense** (`pages/trips/[tripId]/expenses/index.vue`)

Auto-labelling writes `category` onto every unlabelled expense. View-only users can't write at all, and guests can only write their own, so for both the button can only fail. After line 41 (`const { tripMembers } = useTripMembers(tripId as string)`), add:

```ts
const { canManageExpenses } = useTripCollaborators(tripId as string)
```

and change the button's `v-if="unlabeledCount > 0"` (line 173) to:

```vue
          v-if="unlabeledCount > 0 && canManageExpenses"
```

- [ ] **Step 6: Check it in the browser**

Run `pnpm dev` with two browser profiles: owner, and a collaborator (`window.__devLogin('collab-test')`) who has joined the trip.
- Owner turns the collaborator's 可編輯 off. Collaborator (no reload): the bottom-bar button shows the lock, the overview shows 「你目前僅能檢視此行程」, the + buttons are gone, an expense's detail page has no edit/delete controls, and 自動分類 is hidden.
- Owner turns 可編輯 back on: the collaborator can add an expense again.
- Collaborator opens 設定: can still change their own name/avatar.
- Owner removes the collaborator while the collaborator is on the overview **and**, separately, on 設定: both times the collaborator gets 「你已被移出此行程」 and lands on `/`.
- Collaborator (re-invited) uses 離開行程: sees 「已離開行程」 only, not the removal toast.

Run: `npx eslint composables/useRemovedFromTripRedirect.ts app.vue "pages/trips/[tripId]/edit.vue" "pages/trips/[tripId]/index.vue" "pages/trips/[tripId]/expenses/index.vue"`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add composables/useRemovedFromTripRedirect.ts app.vue "pages/trips/[tripId]/edit.vue" "pages/trips/[tripId]/index.vue" "pages/trips/[tripId]/expenses/index.vue"
git commit -m "feat(trip): show view-only state and send removed users home"
```

---

### Task 18: Full verification and deploy handoff

- [ ] **Step 1: Run every suite**

```bash
pnpm vitest run
pnpm test:emulator
cd functions && npm test && cd ..
npx eslint .
pnpm build
```

Expected: all pass; the build completes without errors.

- [ ] **Step 2: End-to-end pass** (`pnpm dev`, owner + a private window)

1. Owner creates a guest link with 僅檢視 on → the private window opens it → joins as a guest → sees 「你目前僅能檢視此行程」 and no add/edit controls.
2. Owner flips that guest's 可編輯 on → the guest can add an expense, and edit only their own.
3. In the private window (still an anonymous guest), open a **personal** invite link → the page asks for Google sign-in and never shows member selection.
4. Owner removes the guest → the guest is sent to `/` with the removal toast.
5. `curl "http://localhost:3000/api/invitations/preview?code=<code>"` returns only `state, type, viewOnly, tripName, invitedByName, expiresAt`.

- [ ] **Step 3: Stop and hand off deployment to the user**

Deploying is outward-facing — don't run these without the user's go-ahead. Order matters: clients on the old bundle query `invitations` directly, which the new rules deny.

1. Deploy the web app through the usual pipeline.
2. `firebase deploy --only firestore:rules`
3. `firebase deploy --only functions:reanalyzeReceipt`

Before deploying, check production for pending invitations whose `invitedByUserId` differs from their trip's `userId` (e.g. anything a client created directly under the old rules) — accept now rejects those with 403. Ship the accept change (Task 8) and the invite-page Google prompt (Task 14) in the same web deploy.

Before the rules deploy, confirm no production trip is missing `collaboratorUserIds` — `canWrite` denies expense writes on such trips (they're already unreadable under the trip read rule). `server/api/admin/migrate-collaborator-ids.post.ts` backfills them.

Remind the user of the open item from the spec: check the Firebase Storage rules in the console. If a view-only user can upload a receipt image to an expense's path, `onReceiptUploaded` will rewrite that expense.
