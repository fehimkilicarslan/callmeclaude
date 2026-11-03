#!/usr/bin/env bash
# Build the CallMeClaude iPhone app and install it on a USB-connected iPhone.
# Usage: ./scripts/ios-install.sh [--team TEAMID] [--bundle com.you.callmeclaude] [--no-install]
set -euo pipefail
cd "$(dirname "$0")/../apps/ios"

TEAM=""; BUNDLE=""; INSTALL=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --team) TEAM="$2"; shift 2 ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --no-install) INSTALL=0; shift ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
done

command -v xcodegen >/dev/null || { echo "xcodegen missing: brew install xcodegen"; exit 1; }

if [[ ! -f Config/Local.xcconfig ]]; then
  [[ -z "$TEAM" ]] && read -rp "Apple Team ID (developer.apple.com → Membership): " TEAM
  [[ -z "$BUNDLE" ]] && read -rp "Unique bundle id (e.g. com.yourname.callmeclaude): " BUNDLE
  printf 'CMC_TEAM_ID = %s\nCMC_BUNDLE_ID = %s\n' "$TEAM" "$BUNDLE" > Config/Local.xcconfig
  echo "Wrote apps/ios/Config/Local.xcconfig (git-ignored)."
fi
BUNDLE_ID=$(sed -n 's/^CMC_BUNDLE_ID *= *//p' Config/Local.xcconfig)

xcodegen generate --quiet

if [[ $INSTALL -eq 0 ]]; then
  xcodebuild -project CallMeClaude.xcodeproj -scheme CallMeClaude -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath build -allowProvisioningUpdates build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
  exit 0
fi

DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && / (available|connected)/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]+-[0-9A-F]+-[0-9A-F]+-/) {print $i; exit}}' || true)
[[ -z "$DEVICE" ]] && { echo "No connected, unlocked iPhone found (xcrun devicectl list devices)."; exit 1; }

echo "Building for ${DEVICE}..."
xcodebuild -project CallMeClaude.xcodeproj -scheme CallMeClaude -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath build -allowProvisioningUpdates build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
xcrun devicectl device install app --device "$DEVICE" build/Build/Products/Debug-iphoneos/CallMeClaude.app
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID" >/dev/null && echo "✅ CallMeClaude installed and launched. Next: cmc pair"
