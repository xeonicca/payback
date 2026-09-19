# Payback for iOS

Payback keeps one Vue/Nuxt frontend for the web and iOS. Capacitor bundles the
static SPA for iOS; its API calls reach the deployed Nuxt/Nitro backend over
HTTPS. Web continues using the normal server build and session cookies. Native
requests use Firebase ID tokens, and the Firebase JavaScript SDK owns the user
identity on both platforms. The native authentication plugin only supplies
Google credentials (`skipNativeAuth: true`).

## Local prerequisites

- macOS with Xcode and an installed iOS Simulator runtime. Accept Xcode's license
  and finish its first-launch component installation.
- Node.js 22+ and pnpm 10.11.0, then `pnpm install`.
- The native deployment target is iOS 15.0, matching the installed authentication
  plugin and its Firebase 12.7+ dependency. Xcode resolves SDK packages using
  Swift Package Manager; initial resolution requires internet access.
- A real iOS Firebase app registration in the **same Firebase project** used by
  the existing web frontend and backend.

## Firebase registration

This project now has an iOS registration for `com.payback.app` in
`payback-travel-mate`. The local configuration has been downloaded and verified.
On another checkout, retrieve the existing app's configuration; do not create a
duplicate registration. The steps below also describe initial setup.

1. In Firebase Console, open Project settings → General → Your apps → Add app →
   iOS. Register bundle ID `com.payback.app`. If this identifier must change,
   update `capacitor.config.ts`, both target configurations in
   `ios/App/App.xcodeproj/project.pbxproj`, and the default bundle ID in
   `scripts/ios-configure.sh` together.
2. Confirm Authentication → Sign-in method has Google enabled. Keep Anonymous
   authentication enabled for the existing guest flow.
3. Download the iOS **GoogleService-Info.plist** into
   `ios/App/App/GoogleService-Info.plist`. It is ignored by git. Do not substitute
   a web Firebase configuration or an Admin SDK service-account JSON file.
4. Run `bash scripts/ios-configure.sh`. It checks the bundle ID and required
   Firebase/Google fields, then adds the Google callback scheme to Info.plist.
   Rerun after replacing the Firebase configuration. `--check` is read-only.
5. The Xcode project already includes the plist in Copy Bundle Resources. Its
   preflight stops with setup instructions if the file or callback is missing.
   The plugin initializes native Firebase itself; no duplicate AppDelegate
   initialization is necessary.

The generated Swift package configuration uses the Capacitor CLI 8.4+
authentication symlink workaround. Regenerate it with Capacitor sync; avoid
hand-editing `ios/App/CapApp-SPM/Package.swift`.

## Build configuration and backend

Keep the existing `NUXT_PUBLIC_FIREBASE_*` variables in `.env`. Add the public
HTTPS origins for the native API and links, replacing these example values:

```dotenv
NUXT_PUBLIC_API_BASE_URL=https://payback-red.vercel.app
NUXT_PUBLIC_SITE_URL=https://payback-red.vercel.app
```

The API origin must serve this version of the Nuxt backend, including Firebase
bearer-token authentication and CORS support for `capacitor://localhost`.
The site origin is used for shareable web links. These are public configuration,
not secrets. Keep the Firebase Admin service account on the server; never add it
to Capacitor configuration or the iOS app resources. A native static build does
not include a running Nitro server. `localhost` inside an iPhone app is the
phone, not your Mac or web deployment.

Changing these values requires rebuilding the bundled app. Deploying backend
changes is a separate operation; generating or syncing the iOS app does not
deploy anything.

```bash
# Existing web product
pnpm dev
pnpm build

# Static native frontend, native project sync, or sync and open Xcode
pnpm app:build
pnpm app:sync
pnpm app:ios
```

In Xcode, select the `App` scheme and an iPhone simulator, then Run. To compile
an unsigned simulator build from the repository root after configuration/sync:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/payback-ios-build CODE_SIGNING_ALLOWED=NO build
```

This requires the real Firebase plist even for simulator builds. A fabricated
configuration cannot verify Google login. In sandboxed automation,
CoreSimulator/XPC permission errors may require permission to run simulator
commands outside the sandbox.

If Xcode reports that iOS 26.4 is not installed but this Mac has the iOS 26.1
runtime, use the installed Xcode 26.1.1 for the command above by prefixing it
with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. This selects
Xcode for that command only and does not change the system-wide selection.

## Invitation links

The app registers `payback` as a URL scheme. Its route handling accepts app links
and supported links from the configured site origin. Exercise a running
simulator with an actual invitation token:

```bash
xcrun simctl openurl booted 'payback://app/join/REAL_INVITATION_TOKEN'
```

Use HTTPS web links for sharing so people can join without installing the app.
Opening those HTTPS links directly in iOS requires **Universal Links** setup:
add the `applinks:YOUR_SITE_HOST` Associated Domains capability in Xcode (this
creates the App entitlements file and sets its Code Signing Entitlements), then
serve an `apple-app-site-association` file from that host listing your Apple
team ID, bundle ID, and supported invitation paths. No domain or Apple team has
been guessed or configured in this repository. Without this setup, shared
HTTPS links open the web product.

## Device checks and distribution

For a physical device, add your Apple account in Xcode Settings → Accounts.
Select the App target → Signing & Capabilities, enable automatic signing, and
choose your team. Ensure the bundle ID matches Firebase. Select the connected
iPhone and Run. A simulator build does not validate device signing or hardware
camera access.

Before a TestFlight upload, verify on a real device:

- Google login, logout, session restoration after closing the app, and guest
  upgrade with the original guest UID/trips preserved.
- Invitation opening while logged out, login return, joining, member changes,
  and leaving trips against the configured backend.
- Camera and photo-library receipt upload, canceled pickers, denied permissions,
  and large receipt images.
- Expense changes offline and after reconnecting, including explicit handling
  of uploads that need connectivity.
- Keyboard and safe-area layout on small and large iPhones, scrolling, theme
  changes, and warm/cold invitation launches.

For TestFlight, configure App Store Connect, signing, app icon, version/build
numbers, privacy disclosures, support/privacy URLs, and the required account
management/authentication experience. Archive a Release build for a generic
iOS device, then validate and distribute through Xcode Organizer. These remote
account, backend deployment, and publishing steps are not performed by the
local migration scripts.

References: [Capacitor Firebase authentication setup](https://github.com/capawesome-team/capacitor-firebase/tree/main/packages/authentication),
[Google provider setup](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/setup-google.md),
[Firebase 12.7 platform requirements](https://github.com/firebase/firebase-ios-sdk/blob/12.7.0/Package.swift).
