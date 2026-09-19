# Payback iOS conversion

Approved direction: retain the Nuxt/Vue web product and ship the same interface
as bundled static assets in Capacitor on iOS. Keep Firebase data and functions.
The user's 2026-09-09 request authorizes implementation of this direction.

## Architecture

- Web continues using same-origin Nitro APIs and Firebase session cookies.
- iOS uses a configurable HTTPS API origin and Firebase ID tokens. The existing
  Nitro server verifies bearer tokens and supplies the same appUser context.
- Restrict native CORS to capacitor://localhost, with explicit methods/headers.
- The Firebase JavaScript SDK owns authentication, persistence, and Firestore.
  Native Google authentication only obtains credentials. Guest linking must
  preserve the anonymous user's UID and existing trip access.
- Bundle the SPA with no service worker or Nitro dependency. Configure native
  Firebase registration, photo permissions, and incoming invitation routes.
- Preserve native and web builds as separate commands. Do not deploy, publish,
  migrate data, or change existing web Firebase settings during implementation.
  Register the missing iOS Firebase app for the existing com.payback.app bundle
  as part of native setup; keep its downloaded client configuration ignored.

## User experience

Use existing Traditional Chinese UI. Support receipt camera/library selection
on iOS and preserve web upload inputs. Login returns to the requested route;
saved routes must not override invitation links. Sharing must use HTTPS web
links, never capacitor:// URLs. Native setup errors must be actionable.

## Verification

Test web cookie and native bearer authentication, invalid credentials, public
requests, CORS preflight, client origin validation, guest UID preservation,
and safe deep-link parsing. Run the existing test suite, targeted ESLint, web
build, native static build, Capacitor sync, and unsigned simulator compilation.
Inspect the rendered app at an iPhone viewport. Real Google login, camera,
offline receipt upload, and physical-device signing require device/account QA;
report those limits precisely rather than inferring success from compilation.
