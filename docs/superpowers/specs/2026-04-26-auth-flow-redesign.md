# Auth Flow Redesign

**Date:** 2026-04-26
**Status:** Approved

## Problem

The current auth setup has two independent session cookies (`__session` managed by VueFire, and a custom cookie managed by `/api/auth/login`) verified by two parallel code paths. This creates an inconsistent state that surfaces as unhandled 500 errors when either cookie expires or becomes invalid. The `_cookies` hack in `server/middleware/session.ts` — which reaches into H3's private internal cache — is a symptom of this conflict and is fragile against H3/VueFire version changes.

A secondary need: Chrome DevTools MCP browser automation cannot complete Google OAuth (Google blocks WebDriver-flagged browsers), so auth-gated features cannot be tested automatically today.

## Goals

1. Eliminate 500 errors caused by expired/invalid session cookies
2. Consolidate to a single session cookie, owned by one code path
3. Preserve SSR-authenticated Firestore queries (needed when Firestore rules are tightened)
4. Enable DevTools MCP to authenticate without going through Google OAuth

## Architecture: Single `__session` Cookie

VueFire's `__session` cookie becomes the single session token. Both VueFire's own Nuxt plugins (SSR Firestore auth) and the custom Nitro middleware (`event.context.appUser` for API auth) read the same cookie independently. Each already handles invalid cookies gracefully (returns null, no throw).

### Why VueFire's Cookie Wins

- VueFire's `plugin-authenticate-user.server.js` calls `signInWithCustomToken` server-side to authenticate the Firebase client SDK — this makes SSR Firestore queries run as the authenticated user, which is required once Firestore security rules are tightened.
- VueFire's `plugin-mint-cookie.client.js` auto-renews the session every ~1 hour via `onIdTokenChanged`, so active users never hit the 5-day Firebase session expiry.
- VueFire's `decodeSessionCookie` catches all verification errors gracefully and returns null — no 500 possible from this path.

### Session Lifetime

| User state | Session behavior |
|---|---|
| Active (app open) | Renewed every ~1 hour automatically via `onIdTokenChanged` |
| Inactive < 5 days | Cookie still valid; no renewal needed |
| Inactive 5–14 days | Cookie expired; redirected to `/login`; recovered seamlessly via `browserLocalPersistence` |
| Inactive > 14 days | Same as above (was already the case with old 14-day custom cookie) |

Reducing from 14 days to 5 days for truly inactive users is acceptable: anonymous guests use `browserLocalPersistence` so Firebase restores their identity from IndexedDB on re-open, triggering `onIdTokenChanged` which re-mints the session before the first SSR request completes.

## Session Flow

### Login (Google or Anonymous)

```
Client: signInWithPopup / signInAnonymously
  → setSession(user)
      → getIdToken(user, true)          // force-refresh: VueFire /api/__session requires token issued < 5 min ago
      → POST /api/__session { token }   // VueFire's endpoint — mints __session cookie (5-day Firebase session)
      → GET /api/auth/me                // Nitro middleware runs, reads __session, sets event.context.appUser
      → sessionUser.value = data.user
```

### SSR Page Request (authenticated)

```
Request with __session cookie
  1. Nitro server middleware (server/middleware/session.ts)
       → decodeSessionCookie(__session) → DecodedIdToken
       → map to AppUser → event.context.appUser
  2. VueFire Nuxt plugin (plugin-user-token.server.js)
       → decodeSessionCookie(__session) → DecodedIdToken
  3. VueFire Nuxt plugin (plugin-authenticate-user.server.js)
       → createCustomToken(uid) → signInWithCustomToken
       → Firebase client SDK authenticated server-side
       → useDocument() / useCollection() queries run as user
  4. initUser.server.ts plugin
       → sessionUser.value = event.context.appUser
```

### SSR Page Request (expired/invalid cookie)

```
Request with invalid __session cookie
  1. Nitro middleware: decodeSessionCookie → null → deleteCookie → return (no error)
  2. VueFire plugins: decodeSessionCookie → null → skip signInWithCustomToken → continue
  3. initUser.server.ts: event.context.appUser is null → sessionUser.value = null
  4. auth route middleware: isUserLoggedIn = false → navigateTo('/login')
```

No 500. Clean redirect.

### API Route Request

```
Request with __session cookie (VueFire Nuxt plugins do NOT run for API routes)
  → Nitro middleware: decodeSessionCookie → AppUser → event.context.appUser
  → API handler: getUserFromSession(event) returns event.context.appUser (no re-verification)
```

### Logout

```
Client: logout()
  → POST /api/auth/logout
      → adminAuth.revokeRefreshTokens(uid)        // server-side revocation
      → deleteCookie(event, '__session')           // directly delete cookie server-side
  → signOut(auth)                                 // clears Firebase client state
      → beforeAuthStateChanged fires → VueFire calls POST /api/__session { token: undefined }
        → VueFire deleteCookie (cookie already gone, no-op)
  → sessionUser.value = null
```

### Inactive User Recovery (client-side)

```
initUser.client.ts mounts, no session cookie present
  → checkUser() returns null
  → getCurrentUser() from IndexedDB (browserLocalPersistence)
  → if user found (anonymous or Google): setSession(user) → re-mints __session
  → sessionUser.value populated
```

## Files Changed

### Deleted
- `server/api/auth/login.post.ts` — replaced by VueFire's `/api/__session`

### Modified

**`server/middleware/session.ts`**
- Read `__session` (VueFire's constant `AUTH_COOKIE_NAME`) instead of `config.authCookieName`
- Use `decodeSessionCookie(cookie, adminApp)` from `vuefire/server` instead of custom `getUserFromCookie`
- Map `DecodedIdToken` to `AppUser` (uid, email, displayName, photoURL, isAnonymous via `firebase_sign_in_provider === 'anonymous'`)
- On invalid cookie: `deleteCookie(event, '__session')` only — remove all raw header surgery and `_cookies` hack
- Import `ensureAdminApp` from `vuefire/server` to reuse VueFire's Admin instance (no second Admin SDK init)

**`server/utils/session.ts`**
- `getUserFromSession(event)` returns `event.context.appUser` directly — middleware has already verified the cookie, no re-verification in API handlers
- Remove `getUserFromCookie` (private helper, no longer used)
- Keep `getFirebaseAdminAuth()` and `getFirebaseAdminFirestore()` (still needed for logout revocation and other API routes)

**`composables/useLogin.ts`**
- `setSession(user)`: replace `POST /api/auth/login` with:
  1. `getIdToken(user, true)` — force-refresh ensures token age < 5 min (VueFire's `/api/__session` rejects older tokens)
  2. `POST /api/__session { token }` — VueFire mints `__session` cookie
  3. `const { user: appUser } = await $fetch<{ user: AppUser }>('/api/auth/me')` — reads `event.context.appUser` set by Nitro middleware
  4. `sessionUser.value = appUser`
- `checkRedirectResult` dev branch stays unchanged — it calls `getCurrentUser()` then `setSession()`, which now uses the new `setSession()` internals

**`server/api/auth/logout.post.ts`**
- Revoke Firebase refresh tokens server-side: `adminAuth.revokeRefreshTokens(appUser.uid)`
- Delete `__session` cookie: `deleteCookie(event, '__session', { httpOnly: true, path: '/', sameSite: 'lax', secure: true })`
- Remove references to `config.authCookieName`

**`nuxt.config.ts`**
- Remove `authCookieName` and `authCookieExpires` from `runtimeConfig`
- Keep `vuefire.auth.sessionCookie: true`

**`.env` / environment**
- Remove `NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_NAME`
- Remove `NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_EXPIRES`
- Add `DEV_TEST_USER_UID` (dev-only, see below)

### Added

**`server/api/auth/dev-login.post.ts`**

Dev-only endpoint for Chrome DevTools MCP browser automation. Bypasses Google OAuth by minting the session cookie entirely server-side.

```
Guards: NODE_ENV !== 'development' → throw 403 (endpoint doesn't exist in prod)

Flow:
  1. adminAuth.createCustomToken(uid)
       uid = body.uid ?? process.env.DEV_TEST_USER_UID ?? 'dev-test-user'
  2. Firebase Auth REST API: POST identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken
       body: { token: customToken, returnSecureToken: true }
       → returns { idToken }
  3. adminAuth.verifyIdToken(idToken) → decodedToken
  4. adminAuth.createSessionCookie(idToken, { expiresIn: 5 * 24 * 60 * 60 * 1000 })
  5. setCookie(event, '__session', sessionCookie, { httpOnly: true, ... })
  6. adminAuth.getUser(uid) → return AppUser
```

The UID should be an existing Firebase user (or will be auto-created on first use by Firebase custom token auth). Use a real dev account UID via `DEV_TEST_USER_UID` so test data in Firestore (trips, members) is accessible during testing.

**DevTools MCP usage pattern:**
```js
// Execute in browser console or via DevTools MCP evaluate tool:
await fetch('/api/auth/dev-login', { method: 'POST' })
location.reload()
// Page reloads authenticated — test auth-gated features normally
```

**`server/plugins/auth-error.ts`** (Nitro plugin — runs once at startup)

Safety net that catches any unhandled auth-related errors during SSR and converts them to login redirects instead of 500 pages:

```ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    if (!event) return
    const status = error.statusCode ?? (error as any).status
    if (status === 401 || status === 403) {
      sendRedirect(event, '/login', 302)
    }
  })
})
```

## Security Notes

- `dev-login` endpoint must throw 403 in non-development environments — checked at runtime via `process.env.NODE_ENV`, not build-time, so it cannot be accidentally deployed without the guard being active.
- `revokeRefreshTokens` on logout invalidates all active sessions for the user across devices, matching the previous behavior.
- `decodeSessionCookie` is called without `checkRevoked: true` (matches VueFire's own behavior). Revocation is handled at logout time rather than on every request — acceptable tradeoff for this app.
- `DEV_TEST_USER_UID` should not be committed to version control. Add to `.gitignore` or use a separate `.env.local`.
