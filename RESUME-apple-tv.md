# Resume note: Apple TV / Frame TV Phase 1 (NATIVE pivot)

Updated 2026-05-30. Branch: `feature/apple-tv-display`. Full design: `Apple-TV-Display-PRD.md` (v2.0.0).

## CRITICAL architecture fact
tvOS ships NO WebKit (no UIWebView/WKWebView) - confirmed by compiler error and SDK inspection. The original WKWebView-wrapper plan is dead. The Apple TV app is NATIVE SwiftUI, reimplementing the views and hitting the same Pi endpoints (/api/state, /api/sonos) + Open-Meteo. Build target chosen by user: native SwiftUI (not React Native, not AirPlay).

## DONE and verified
Web foundation (code/) - lint passes, deployed to live Pi:
- kioskMode.js, useSharedState.js, settings.js write-through, AppShell (appNav/tvAction/sonosCmd + TV gating), MenuPill TV-hide, PhotoSlideshow photoNav.
- NOTE: this web-side TV bridge is now DEAD CODE for the TV (native app doesn't use it). Harmless (gated behind ?kiosk=tv). Flagged for cleanup, not urgent. Kitchen unaffected.

Pi (pi/kiosk-server.py) - DEPLOYED, live, kitchen healthy (http 200):
- BIND 0.0.0.0; GET/POST /api/state -> /home/pi/state.json; GET /api/sonos/* proxy to 127.0.0.1:5005.

tvOS app (tvos/) - native SwiftUI, Today view BUILDS (** BUILD SUCCEEDED ** for appletvsimulator):
- project.yml (XcodeGen; bundle com.nikolaus.kitchendisplay.tv; tvOS 17+; SUPPORTED_PLATFORMS set; ATS exception).
- Sources/: KitchenDisplayTVApp.swift, AppConfig.swift, AppModel.swift, WeatherService.swift, DepartureTimer.swift, TodayView.swift, Info.plist.
- Build command that works: `xcodebuild -project KitchenDisplayTV.xcodeproj -scheme KitchenDisplayTV -configuration Debug -destination 'generic/platform=tvOS Simulator' -derivedDataPath ./.build-sim CODE_SIGNING_ALLOWED=NO build`
  (Toolchain has tvOS 26.5 SDK but only 26.4 sim runtime installed; pinning a concrete sim OS fails to resolve - use the GENERIC destination.)
- Runtime launch/screenshot in the sim was flaky in this environment ("no default display port", launch hangs) - NOT a code problem; build success is the validation. Worth a manual launch in Simulator.app to eyeball the Today view.

Docs - DONE:
- Apple-TV-Display-PRD.md bumped to v2.0.0 with the native-pivot architecture banner + section 7.4 rewrite.
- Smart Displays.md bumped to v16.0 / 2026-05-30, added "Secondary Display: Apple TV / Frame TV" section.

## NOT done yet (next)
1. Native Photos view (tvos/) - Immich manifest slideshow with smart crop / face-aware positioning / portrait pairing, matching code/src/views/PhotoSlideshow/PhotoSlideshow.jsx. Manifest is served at http://smartdisplay.local:8080/stub-photos/manifest.json (or Immich). Siri Remote prev/next.
2. Native Now Playing view (tvos/) - album art, track/artist/station, progress, transport via /api/sonos/Main/*. Mirror useSonosState.js parsing (/zones -> coordinator.state). Siri Remote play/pause/prev/next.
3. App shell + Siri Remote view switching (swipe up/down) + boot picker (school morning->Today, Sonos playing->NowPlaying, else Photos). Currently RootView shows TodayView only.
4. Clear stale test data in Pi /api/state (currently holds an incomplete test POST: lat 47.66, drivingDepart 7:42, intervalMs 6000). Harmless + self-heals on next kitchen settings change. To reset cleanly, change-and-save any setting on the kitchen.
5. Real-device install to "Living Room" Apple TV (available/paired): set DEVELOPMENT_TEAM in project.yml, then `xcodebuild -destination 'platform=tvOS,name=Living Room' -allowProvisioningUpdates`. Also need an app icon (Brand Assets) before device/App Store build. And verify the Apple TV's network path to smartdisplay.local:8080 (Mac had subnet/VLAN issues reaching the Pi earlier).

## Environment caveats
- Tool output stream has intermittently reordered/replayed/cancelled batches and silently dropped output. Verify each important step with a single command ending in a unique sentinel; do not trust large parallel batches.
- simctl launch/screenshot unreliable here; rely on BUILD SUCCEEDED + manual eyeball.
