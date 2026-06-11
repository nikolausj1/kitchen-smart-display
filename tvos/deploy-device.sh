#!/bin/sh
# Build, sign, install, and launch Kitchen Display TV on the real Apple TV.
# Usage: ./deploy-device.sh
set -e
cd "$(dirname "$0")"

DEVICE_ID="1E4E3F1F-DB68-5049-AFB7-244A8E91C5C5"   # Living Room Apple TV
BUNDLE_ID="com.nikolaus.kitchendisplay.tv"
SCHEME="KitchenDisplayTV"

echo "==> Generating project"
xcodegen generate >/dev/null

# Build with the GENERIC device destination so xcodebuild does NOT try to
# prepare/connect the physical Apple TV (which times out if the device is in a
# "needs to be unlocked / preparation errors" state). We install separately
# via devicectl below, which is more robust.
echo "==> Building + signing for device (generic)"
xcodebuild -project KitchenDisplayTV.xcodeproj -scheme "$SCHEME" \
  -configuration Debug \
  -destination "generic/platform=tvOS" \
  -allowProvisioningUpdates \
  build > /tmp/tvbuild.log 2>&1 || { tail -25 /tmp/tvbuild.log; exit 1; }
echo "    BUILD SUCCEEDED"

# Use the real build product, NOT the Index.noindex indexing copy (which is
# not a valid installable bundle).
APP=$(find ~/Library/Developer/Xcode/DerivedData -type d -name "$SCHEME.app" -path "*Build/Products/Debug-appletvos*" 2>/dev/null | grep -v Index.noindex | head -1)
echo "==> App: $APP"

echo "==> Installing to Apple TV"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP" 2>&1 | grep -E "App installed|bundleID|error" || true

echo "==> Launching"
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" 2>&1 | grep -iE "Launched|error" || true

echo "==> Done."
