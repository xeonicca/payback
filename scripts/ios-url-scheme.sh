#!/usr/bin/env bash
# Backwards-compatible entry point; see docs/ios.md.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/ios-configure.sh" "$@"
