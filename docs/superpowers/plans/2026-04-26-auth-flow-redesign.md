# Auth Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse two conflicting session cookies into VueFire's single `__session` cookie, eliminate 500 errors on cookie expiry, and add a dev-only server endpoint that lets Chrome DevTools MCP authenticate without Google OAuth.

**Architecture:** VueFire's existing `__session` cookie (auto-renewed every ~1 hour via `onIdTokenChanged`) becomes the single session token. The custom Nitro middleware reads it using VueFire's own `decodeSessionCookie` helper, setting `event.context.appUser` for all API routes. `setSession()` in the client composable calls VueFire's `/api/__session` endpoint instead of the now-deleted `/api/auth/login`. A dev-only `POST /api/auth/dev-login` endpoint mints the session cookie entirely server-side, bypassing Google OAuth.

**Tech Stack:** Nuxt 3, Nitro server middleware, VueFire (`vuefire/server`: `decodeSessionCookie`, `AUTH_COOKIE_NAME`), Firebase Admin SDK, vitest

---

## File Map

| File | Action | Reason |
|---|---|---|
| `server/utils/session.ts` | Modify | Export `getFirebaseAdminApp`; extract `mapDecodedTokenToAppUser`; simplify `getUserFromSession` to read from context |
| `server/middleware/session.ts` | Rewrite | Use `decodeSessionCookie` + `AUTH_COOKIE_NAME` from `vuefire/server`; remove `_cookies` hack |
| `server/api/auth/logout.post.ts` | Modify | Revoke Firebase refresh tokens; delete `__session` directly; remove `config.authCookieName` |
| `composables/useLogin.ts` | Modify | `setSession()` calls `/api/__session` + `/api/auth/me` instead of `/api/auth/login` |
| `nuxt.config.ts` | Modify | Remove `authCookieName` and `authCookieExpires` from `runtimeConfig` |
| `server/api/auth/login.post.ts` | Delete | Replaced entirely by VueFire's `/api/__session` |
| `server/api/auth/dev-login.post.ts` | Create | Dev-only endpoint: custom token → REST sign-in → session cookie |
| `server/plugins/auth-error.ts` | Create | Nitro plugin error hook: redirect 401/403 to `/login` instead of 500 |
| `tests/server/utils/session.test.ts` | Create | Unit test for `mapDecodedTokenToAppUser` |
| `.env` | Modify | Remove old cookie vars; add `DEV_TEST_USER_UID` |

---

## Task 1: Simplify `server/utils/session.ts`

**Files:**
- Modify: `server/utils/session.ts`
- Create: `tests/server/utils/session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/utils/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapDecodedTokenToAppUser } from '../../../server/utils/session'

describe('mapDecodedTokenToAppUser', () => {
  it('maps all fields for a Google user', () => {
    const decoded = {
      uid: 'abc123',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://example.com/photo.jpg',
      firebase: { sign_in_provider: 'google.com' },
    }
    expect(mapDecodedTokenToAppUser(decoded)).toEqual({
      uid: 'abc123',
      email: 'user@example.com',
      displayName: 'Test User',
      photoURL: 'https://example.com/photo.jpg',
      isAnonymous: false,
    })
  })

  it('returns null for optional fields when absent', () => {
    const decoded = {
      uid: 'anon123',
      firebase: { sign_in_provider: 'anonymous' },
    }
    expect(mapDecodedTokenToAppUser(decoded)).toEqual({
      uid: 'anon123',
      email: null,
      displayName: null,
      photoURL: null,
      isAnonymous: true,
    })
  })

  it('marks non-anonymous providers as not anonymous', () => {
    const decoded = {
      uid: 'u1',
      firebase: { sign_in_provider: 'password' },
    }
    expect(mapDecodedTokenToAppUser(decoded).isAnonymous).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
pnpm test tests/server/utils/session.test.ts
```

Expected: `Error: mapDecodedTokenToAppUser is not a function` (or similar — not exported yet).

- [ ] **Step 3: Rewrite `server/utils/session.ts`**

Replace the entire file with:

```ts
import type { App } from 'firebase-admin/app'
import type { H3Event } from 'h3'
import type { AppUser } from '@/types'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

let app: App

export function getFirebaseAdminApp() {
  if (getApps().length) {
    app = getApps()[0]
  }
  else {
    const config = useRuntimeConfig()
    const serviceAccount = JSON.parse(config.serviceAccount as string)
    app = initializeApp({ credential: cert(serviceAccount) })
  }
  return app
}

export function getFirebaseAdminAuth() {
  return getAdminAuth(getFirebaseAdminApp())
}

export function getFirebaseAdminFirestore() {
  return getFirestore(getFirebaseAdminApp())
}

interface TokenClaims {
  uid: string
  email?: string
  name?: string
  picture?: string
  firebase?: { sign_in_provider?: string }
}

export function mapDecodedTokenToAppUser(decoded: TokenClaims): AppUser {
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    displayName: decoded.name ?? null,
    photoURL: decoded.picture ?? null,
    isAnonymous: decoded.firebase?.sign_in_provider === 'anonymous',
  }
}

export function getUserFromSession(event: H3Event): AppUser | null {
  return event.context.appUser ?? null
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
pnpm test tests/server/utils/session.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/session.ts tests/server/utils/session.test.ts
git commit -m "refactor: simplify session utils, export mapDecodedTokenToAppUser"
```

---

## Task 2: Rewrite `server/middleware/session.ts`

**Files:**
- Modify: `server/middleware/session.ts`

This middleware now reads `__session` using VueFire's own `decodeSessionCookie`. No more raw header surgery or `_cookies` hack.

- [ ] **Step 1: Replace the file**

```ts
import type { AppUser } from '@/types'
import { AUTH_COOKIE_NAME, decodeSessionCookie } from 'vuefire/server'
import { getFirebaseAdminApp, mapDecodedTokenToAppUser } from '../utils/session'

export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, AUTH_COOKIE_NAME)
  if (!cookie)
    return

  const decoded = await decodeSessionCookie(cookie, getFirebaseAdminApp())

  if (decoded) {
    event.context.appUser = mapDecodedTokenToAppUser(decoded) as AppUser
  }
  else {
    deleteCookie(event, AUTH_COOKIE_NAME)
  }
})
```

- [ ] **Step 2: Start dev server and verify the app still works**

```bash
pnpm dev
```

Navigate to `http://localhost:3000`. If already logged in (browser has a `__session` cookie from VueFire's auto-mint), the app should load normally with your user session. If not logged in, it should redirect to `/login`.

Log in via Google — the app should work end-to-end. Check the browser's DevTools → Application → Cookies — you should see `__session` set after login (VueFire's auto-mint fires on `onIdTokenChanged`). You should NOT see `pb-session` being set anymore... actually you will still see it because `setSession()` still calls `/api/auth/login`. That's fine — we remove that in Task 4. For now, the middleware only reads `__session` and ignores `pb-session`.

- [ ] **Step 3: Commit**

```bash
git add server/middleware/session.ts
git commit -m "refactor: rewrite session middleware to use VueFire decodeSessionCookie"
```

---

## Task 3: Update `server/api/auth/logout.post.ts`

**Files:**
- Modify: `server/api/auth/logout.post.ts`

- [ ] **Step 1: Replace the file**

```ts
import { AUTH_COOKIE_NAME } from 'vuefire/server'
import { getFirebaseAdminAuth } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  const appUser = event.context.appUser

  if (appUser?.uid) {
    await getFirebaseAdminAuth().revokeRefreshTokens(appUser.uid)
  }

  deleteCookie(event, AUTH_COOKIE_NAME, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  return { user: null }
})
```

- [ ] **Step 2: Test logout in dev**

While logged in at `http://localhost:3000`, click the logout button. Verify:
- You are redirected to `/login`
- DevTools → Application → Cookies: `__session` cookie is gone

- [ ] **Step 3: Commit**

```bash
git add server/api/auth/logout.post.ts
git commit -m "refactor: logout revokes refresh tokens and deletes __session cookie"
```

---

## Task 4: Update `composables/useLogin.ts` — new `setSession`

**Files:**
- Modify: `composables/useLogin.ts`

`setSession` stops calling `/api/auth/login` and instead calls VueFire's `/api/__session` with a force-refreshed token, then fetches the user from `/api/auth/me`.

Note: VueFire's `/api/__session` endpoint requires the ID token to have been issued within the last 5 minutes. `getIdToken(user, true)` forces a fresh token to guarantee this.

- [ ] **Step 1: Replace `setSession` in `composables/useLogin.ts`**

Find and replace only the `setSession` function (lines 44–52 in the original file):

Old:
```ts
const setSession = async (user: User) => {
  const firebaseIdToken = await getIdToken(user)
  const data = await $fetch<AppUser>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ firebaseIdToken }),
  })
  sessionUser.value = data
  logEvent('login', { method: 'google' })
}
```

New:
```ts
const setSession = async (user: User) => {
  const token = await getIdToken(user, true)
  await $fetch('/api/__session', {
    method: 'POST',
    body: { token },
  })
  const { user: appUser } = await $fetch<{ user: AppUser }>('/api/auth/me')
  sessionUser.value = appUser
  logEvent('login', { method: 'google' })
}
```

- [ ] **Step 2: Remove the unused `AppUser` import reference**

The `AppUser` type is still needed for the `$fetch` generic. No change to imports required — `AppUser` is imported from `~/types` already at the top of the file.

- [ ] **Step 3: Test the full login flow in dev**

```bash
pnpm dev
```

1. Log out (if logged in)
2. Navigate to `http://localhost:3000/login`
3. Click "Sign in with Google" — complete the popup
4. Verify you are redirected to `/` and your username appears
5. DevTools → Application → Cookies: `__session` cookie is present, `pb-session` is NOT present (it's no longer set by any server code now)
6. Refresh the page — you should remain logged in (session persists via `__session`)

- [ ] **Step 4: Test anonymous login**

1. Log out
2. Click "Continue as guest" (or however `loginAsGuest` is triggered in the UI)
3. Verify you are logged in as a guest
4. DevTools → Application → Cookies: `__session` is present

- [ ] **Step 5: Commit**

```bash
git add composables/useLogin.ts
git commit -m "refactor: setSession calls /api/__session and /api/auth/me instead of /api/auth/login"
```

---

## Task 5: Delete `server/api/auth/login.post.ts`

**Files:**
- Delete: `server/api/auth/login.post.ts`

Now that `setSession` no longer calls `/api/auth/login`, this endpoint is dead code.

- [ ] **Step 1: Delete the file**

```bash
git rm server/api/auth/login.post.ts
```

- [ ] **Step 2: Verify nothing still imports it**

```bash
grep -r "auth/login" . --include="*.ts" --include="*.vue" | grep -v node_modules | grep -v ".git"
```

Expected: no results.

- [ ] **Step 3: Verify dev server still starts and login works**

```bash
pnpm dev
```

Full login flow should still work (Task 4 verified this already).

- [ ] **Step 4: Commit**

```bash
git commit -m "remove: delete /api/auth/login endpoint, replaced by VueFire /api/__session"
```

---

## Task 6: Update `nuxt.config.ts`

**Files:**
- Modify: `nuxt.config.ts`

- [ ] **Step 1: Remove `authCookieName` and `authCookieExpires` from `runtimeConfig`**

In `nuxt.config.ts`, find and remove these two lines from the `runtimeConfig` block:

```ts
// Remove these two lines:
authCookieName: process.env.NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_NAME,
authCookieExpires: process.env.NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_EXPIRES,
```

The `runtimeConfig` block should now look like:
```ts
runtimeConfig: {
  public: {
    firebase: {
      apiKey: process.env.NUXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.VERCEL_URL,
      projectId: process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NUXT_PUBLIC_FIREBASE_APP_ID,
      storageBucket: process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    },
  },
  serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS,
},
```

- [ ] **Step 2: Verify no remaining references to `authCookieName` or `authCookieExpires`**

```bash
grep -r "authCookieName\|authCookieExpires\|FIREBASE_AUTH_COOKIE" . --include="*.ts" --include="*.vue" | grep -v node_modules | grep -v ".git"
```

Expected: no results.

- [ ] **Step 3: Restart dev server and verify startup**

```bash
pnpm dev
```

Expected: no TypeScript errors about undefined config keys.

- [ ] **Step 4: Commit**

```bash
git add nuxt.config.ts
git commit -m "refactor: remove authCookieName and authCookieExpires from runtimeConfig"
```

---

## Task 7: Add `server/api/auth/dev-login.post.ts`

**Files:**
- Create: `server/api/auth/dev-login.post.ts`

This endpoint is the DevTools MCP testing bypass. It mints a valid `__session` cookie entirely server-side, skipping Google OAuth. It only works in `NODE_ENV=development`.

The endpoint uses the Firebase Auth REST API to exchange a custom token for a real ID token (the Admin SDK's `createCustomToken` cannot be directly used as a session cookie — it must go through sign-in first).

- [ ] **Step 1: Create the file**

```ts
import { AUTH_COOKIE_NAME } from 'vuefire/server'
import { getFirebaseAdminAuth } from '~/server/utils/session'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV !== 'development') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const auth = getFirebaseAdminAuth()
  const body = await readBody(event).catch(() => ({}))
  const uid: string = body?.uid ?? process.env.DEV_TEST_USER_UID ?? 'dev-test-user'

  // Step 1: create custom token for the test uid
  const customToken = await auth.createCustomToken(uid)

  // Step 2: exchange for ID token via Firebase Auth REST API
  // (Admin SDK custom tokens cannot be used directly as session cookies)
  const apiKey = useRuntimeConfig().public.firebase.apiKey as string
  const signInRes = await $fetch<{ idToken: string }>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      body: { token: customToken, returnSecureToken: true },
    },
  )

  // Step 3: mint 5-day session cookie from the ID token
  const expiresInMs = 5 * 24 * 60 * 60 * 1000
  const sessionCookie = await auth.createSessionCookie(signInRes.idToken, { expiresIn: expiresInMs })

  setCookie(event, AUTH_COOKIE_NAME, sessionCookie, {
    maxAge: expiresInMs / 1000,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
  })

  // Step 4: return AppUser so the caller can inspect who they are logged in as
  const user = await auth.getUser(uid)
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    isAnonymous: user.providerData.length === 0,
  }
})
```

- [ ] **Step 2: Add `DEV_TEST_USER_UID` to `.env`**

Open `.env` and add:

```
DEV_TEST_USER_UID=<your-firebase-uid>
```

Replace `<your-firebase-uid>` with the UID of your real Firebase dev account. You can find this in the Firebase console → Authentication → Users, or by logging in normally and checking the network request to `/api/auth/me`.

Also remove the now-unused vars:
```
# Remove these two lines:
NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_NAME=pb-session
NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_EXPIRES=1209600000
```

- [ ] **Step 3: Test `dev-login` manually**

```bash
pnpm dev
```

Open `http://localhost:3000` while NOT logged in, then in the browser console:

```js
const res = await fetch('/api/auth/dev-login', { method: 'POST' })
const data = await res.json()
console.log(data) // Should show your AppUser
location.reload()
```

After reload, you should be authenticated as the test user. DevTools → Application → Cookies: `__session` is present.

- [ ] **Step 4: Verify the endpoint is blocked in production mode**

```bash
curl -X POST http://localhost:3000/api/auth/dev-login
```

Then set `NODE_ENV=production` temporarily and restart:

```bash
NODE_ENV=production pnpm dev
curl -X POST http://localhost:3000/api/auth/dev-login
```

Expected: `403 Forbidden`.

Restore dev mode:
```bash
pnpm dev
```

- [ ] **Step 5: Commit**

```bash
git add server/api/auth/dev-login.post.ts .env
git commit -m "feat: add dev-only /api/auth/dev-login endpoint for DevTools MCP automation"
```

---

## Task 8: Add `server/plugins/auth-error.ts`

**Files:**
- Create: `server/plugins/auth-error.ts`

This Nitro plugin is a safety net. It catches any unhandled 401/403 errors that slip through during SSR page rendering and converts them to a login redirect rather than an error page.

- [ ] **Step 1: Create `server/plugins/` directory and file**

```bash
mkdir -p server/plugins
```

Create `server/plugins/auth-error.ts`:

```ts
import { sendRedirect } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    if (!event)
      return
    const status = (error as any).statusCode ?? (error as any).status
    if (status === 401 || status === 403) {
      sendRedirect(event, '/login', 302)
    }
  })
})
```

- [ ] **Step 2: Verify dev server starts without errors**

```bash
pnpm dev
```

Expected: clean startup, no errors about the new plugin.

- [ ] **Step 3: Commit**

```bash
git add server/plugins/auth-error.ts
git commit -m "feat: add Nitro error plugin to redirect auth failures to /login"
```

---

## Task 9: End-to-end verification

Run through every auth path to confirm nothing regressed.

- [ ] **Step 1: Verify normal Google login**

```bash
pnpm dev
```

1. Clear all cookies for `localhost:3000`
2. Navigate to `http://localhost:3000` → redirected to `/login`
3. Sign in with Google → popup completes → redirected to `/`
4. DevTools → Cookies: `__session` present, `pb-session` absent
5. Refresh page → still logged in
6. Navigate to a trip page → SSR renders with user data (no 500)

- [ ] **Step 2: Verify logout**

1. Click logout
2. Redirected to `/login`
3. DevTools → Cookies: `__session` gone
4. Navigating to `/` redirects to `/login`

- [ ] **Step 3: Verify expired cookie handling**

Manually corrupt the `__session` cookie value in DevTools (Application → Cookies → double-click the value → change a character → Enter).

Refresh the page. Expected:
- No 500 error
- Redirected to `/login` cleanly

- [ ] **Step 4: Verify DevTools MCP flow**

In browser console while logged out:

```js
const res = await fetch('/api/auth/dev-login', { method: 'POST' })
console.log(await res.json())
location.reload()
```

Expected: authenticated as your dev account after reload. Navigate to a trip page — data loads correctly.

- [ ] **Step 5: Verify API routes still work**

While logged in, open DevTools → Network and check that any API call (e.g., joining a trip, creating an invitation) returns 200 (not 401). The Nitro middleware still sets `event.context.appUser` for API routes, so `getUserFromSession` works.

- [ ] **Step 6: Verify anonymous guest recovery**

This tests the `initUser.client.ts` recovery path for anonymous users whose session cookie expired but who still have a Firebase anonymous identity in IndexedDB (`browserLocalPersistence`).

1. Log in as a guest via the normal login flow
2. Wait for login to complete (DevTools → Cookies: `__session` present)
3. Manually delete the `__session` cookie in DevTools → Application → Cookies
4. Refresh the page
5. Expected: the client plugin calls `getCurrentUser()` → finds the anonymous user in IndexedDB → calls `setSession(user)` → `/api/__session` re-minted → `__session` cookie appears again → user remains logged in without redirect to `/login`

If the user IS redirected to `/login`, that is the expected fallback (server sees no cookie → redirects). The client plugin then fires, recovers the session, and navigates back. Both behaviours are acceptable — the important thing is no 500 error and no broken state.

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: address issues found during e2e verification"
```

---

## Task 10: TypeScript check

- [ ] **Step 1: Run TypeScript compiler**

```bash
pnpm nuxt typecheck
```

Expected: no errors. If errors appear about removed `config.authCookieName` references:

```bash
grep -r "authCookieName\|authCookieExpires" . --include="*.ts" --include="*.vue" | grep -v node_modules | grep -v ".git"
```

Fix any remaining references — these would be in files not touched by this plan.

- [ ] **Step 2: Run linter**

```bash
npx eslint .
```

Fix any lint errors (likely import ordering in new files).

- [ ] **Step 3: Commit fixes**

```bash
git add .
git commit -m "fix: resolve TypeScript and lint issues from auth refactor"
```
