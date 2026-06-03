# Resume note: Apple TV / Frame TV

Updated 2026-06-03. Branch: `feature/apple-tv-display` (now pushed to GitHub).
Source of truth: `Apple-TV-Display-PRD.md` and the "Secondary Display" section
of `Smart Displays.md`.

## Status: Phase 1 SHIPPED

The Apple TV app is a native SwiftUI app (tvOS has no WebKit, so it is NOT a
web-view wrapper) running on the living-room Frame TV. All views are live:
Today, Photos, Now Playing, and a TV-local Settings screen.

Code lives in `tvos/` (XcodeGen project from `project.yml`).
- Build + deploy to the real Apple TV: `cd tvos && ./deploy-device.sh`
  (builds with `-destination 'generic/platform=tvOS'`, signs with team
  6A4J2GTB6F, installs + launches on "Living Room").
- Simulator loop: `open -a Simulator` FIRST (attaches the TVOut display, else
  screenshots fail with "no default display port"), then build
  `-destination 'generic/platform=tvOS Simulator'`, install via `simctl`,
  `simctl io <udid> screenshot`. Sim builds hit the Pi by IP
  (`#if targetEnvironment(simulator)` in AppConfig.swift) since the sim doesn't
  resolve `smartdisplay.local`; the device uses `.local`.
- Sim-only debug flags (UserDefaults on the app bundle; all
  `#if targetEnvironment(simulator)`, can't ship): `debug.view` (force a view),
  `debug.fakeMusic`, `debug.forcePair` (force portrait pairs).

## What works (shipped + deployed)
- Three views + Settings; Siri Remote nav (swipe up/down = switch view,
  left/right = prev/next, play-pause/select = Sonos). No screensaver
  (isIdleTimerDisabled).
- Picture-frame mat (toggleable in Settings): Figma-width off-white paper mat,
  corner album art (when Sonos playing/recent), handwritten Caveat photo+music
  metadata by exact Figma coords. Suppressed on Today.
- Photos: cover-crop with face-aware framing, 2-up portrait pairs w/ black
  divider + per-photo captions, Left=true previous (30-item history), TV-local
  photo duration + album picker.
- Settings sync kitchen->TV read-only via Pi `/api/state` (30s poll).
- Live Today-timer mirroring: kitchen posts its timer; TV shows the same
  countdown/band/travel-pill. Kitchen travel default is weather-aware.

## Pi backend (`pi/kiosk-server.py`, deployed)
- BIND 0.0.0.0; GET/POST `/api/state` (POST MERGES keys -> `/home/pi/state.json`);
  `/api/sonos/*` proxy to 127.0.0.1:5005.
- The Pi only serves the built app + this server; it has NO Node, scripts, or
  Immich creds. The photo manifest is built on the Mac
  (`node --env-file=.env code/scripts/build-photo-manifest.mjs`) and rsynced via
  `npm run deploy`.

## Open / deferred (next-session candidates)
1. Verify on a real school morning: the weather-based walking/driving default +
   timer mirroring (auto-arm only fires in the morning window; logic is
   unit-tested but not yet seen end-to-end live).
2. Automated Immich manifest rebuild (nightly + a kitchen "rebuild" button) —
   DEFERRED pending a decision: the Pi can't run it (no Node/Immich creds), so
   either make the Pi self-sufficient (install Node + creds; check where Immich
   runs) or have the Mac do it + Pi triggers via SSH.
3. Home Assistant auto-launch (school mornings -> Today, guests scene ->
   Now Playing) — the original Phase 2 goal; turns manual launch into ambient.
4. Merge `feature/apple-tv-display` -> main once it's proven in daily use.
5. Cosmetic: Now Playing mat treatment; cold-threshold (35F) -> a Settings row.

## Environment caveats
- tvOS sim screenshots only work if Simulator.app is opened first (display
  attach). `simctl launch` can hang; rely on BUILD SUCCEEDED + screenshot.
- The real Apple TV's RSD/dev tunnel occasionally wedges; an Apple TV reboot or
  Wi-Fi toggle clears it. Xcode GUI Run is the fallback when CLI install fails.
