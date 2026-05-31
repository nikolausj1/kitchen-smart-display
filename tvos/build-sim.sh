#!/bin/sh
# Build, install, and launch Kitchen Display TV in the tvOS simulator.
# No code signing required for simulator builds.
set -e

cd "$(dirname "$0")"

SIM_NAME="Apple TV 4K (3rd generation)"
BUNDLE_ID="com.nikolaus.kitchendisplay.tv"
SCHEME="KitchenDisplayTV"

echo "==> Generating Xcode project"
xcodegen generate

echo "==> Building for the tvOS simulator"
DERIVED="$(pwd)/.build-sim"
xcodebuild -project KitchenDisplayTV.xcodeproj -scheme "$SCHEME" \
  -sdk appletvsimulator -configuration Debug \
  -destination "platform=tvOS Simulator,name=$SIM_NAME" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  build

APP_PATH="$DERIVED/Build/Products/Debug-appletvsimulator/$SCHEME.app"
echo "==> Built: $APP_PATH"

echo "==> Booting simulator: $SIM_NAME"
xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
open -a Simulator || true

echo "==> Installing + launching"
xcrun simctl install "$SIM_NAME" "$APP_PATH"
xcrun simctl launch "$SIM_NAME" "$BUNDLE_ID"

echo "==> Done."
