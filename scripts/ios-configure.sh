#!/usr/bin/env bash
# Validate the real Firebase iOS registration and prepare its Google callback.
# --check validates without modifying files (also used by the Xcode build).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
GOOGLE_PLIST="$PROJECT_DIR/ios/App/App/GoogleService-Info.plist"
INFO_PLIST="$PROJECT_DIR/ios/App/App/Info.plist"
PB=/usr/libexec/PlistBuddy
CHECK_ONLY=false

fail() {
  echo "error: $* See docs/ios.md." >&2
  exit 1
}

if [[ "${1:-}" == --check && $# == 1 ]]; then
  CHECK_ONLY=true
elif [[ $# -gt 0 ]]; then
  fail "Usage: bash scripts/ios-configure.sh [--check]"
fi

[[ -f "$GOOGLE_PLIST" ]] || fail "Missing ios/App/App/GoogleService-Info.plist. Register com.payback.app as an iOS app in your existing Firebase project, download its configuration here, then run bash scripts/ios-configure.sh."
[[ -f "$INFO_PLIST" ]] || fail "Missing iOS Info.plist. Restore the checked-in ios/App project."
plutil -lint "$GOOGLE_PLIST" >/dev/null || fail "Firebase configuration is not a valid plist. Download it again from Firebase Console."

# Never print Firebase values. A web config or service-account key cannot be
# substituted for this iOS app configuration.
for key in BUNDLE_ID GOOGLE_APP_ID API_KEY GCM_SENDER_ID PROJECT_ID CLIENT_ID REVERSED_CLIENT_ID; do
  value="$("$PB" -c "Print :$key" "$GOOGLE_PLIST" 2>/dev/null)" || fail "Firebase configuration is missing $key. Enable Google sign-in and download a fresh iOS configuration."
  [[ -n "$value" ]] || fail "Firebase configuration has an empty $key."
done

bundle_id="$("$PB" -c 'Print :BUNDLE_ID' "$GOOGLE_PLIST")"
[[ "$bundle_id" == "${PRODUCT_BUNDLE_IDENTIFIER:-com.payback.app}" ]] || fail "Firebase BUNDLE_ID does not match the iOS target. Use the configuration registered for this bundle identifier."
google_scheme="$("$PB" -c 'Print :REVERSED_CLIENT_ID' "$GOOGLE_PLIST")"
[[ "$google_scheme" =~ ^com\.googleusercontent\.apps\.[a-zA-Z0-9-]+$ ]] || fail "Firebase REVERSED_CLIENT_ID is not a valid Google callback scheme."

index=0
google_index=
has_callback=false
while "$PB" -c "Print :CFBundleURLTypes:$index" "$INFO_PLIST" >/dev/null 2>&1; do
  name="$("$PB" -c "Print :CFBundleURLTypes:$index:CFBundleURLName" "$INFO_PLIST" 2>/dev/null || true)"
  [[ "$name" != com.payback.google ]] || google_index="$index"
  scheme_index=0
  while scheme="$("$PB" -c "Print :CFBundleURLTypes:$index:CFBundleURLSchemes:$scheme_index" "$INFO_PLIST" 2>/dev/null)"; do
    [[ "$scheme" != "$google_scheme" ]] || has_callback=true
    scheme_index=$((scheme_index + 1))
  done
  index=$((index + 1))
done

if [[ "$has_callback" == false ]]; then
  [[ "$CHECK_ONLY" == false ]] || fail "Google callback is not configured. Run bash scripts/ios-configure.sh, then rebuild."
  if [[ -z "$google_index" ]]; then
    google_index="$index"
    if ! "$PB" -c 'Print :CFBundleURLTypes' "$INFO_PLIST" >/dev/null 2>&1; then
      "$PB" -c 'Add :CFBundleURLTypes array' "$INFO_PLIST"
    fi
    "$PB" -c "Add :CFBundleURLTypes:$google_index dict" "$INFO_PLIST"
    "$PB" -c "Add :CFBundleURLTypes:$google_index:CFBundleURLName string com.payback.google" "$INFO_PLIST"
  else
    "$PB" -c "Delete :CFBundleURLTypes:$google_index:CFBundleURLSchemes" "$INFO_PLIST"
  fi
  "$PB" -c "Add :CFBundleURLTypes:$google_index:CFBundleURLSchemes array" "$INFO_PLIST"
  "$PB" -c "Add :CFBundleURLTypes:$google_index:CFBundleURLSchemes:0 string $google_scheme" "$INFO_PLIST"
fi

plutil -lint "$INFO_PLIST" >/dev/null
echo 'Firebase iOS configuration and Google callback verified.'
