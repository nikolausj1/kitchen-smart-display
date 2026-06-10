---
title: Apple TV / Frame TV Display PRD
created: 2026-05-30
modified: 2026-06-09
version: 2.0.2
author: Justin Nikolaus
tags: [smart-display, apple-tv, frame-tv, prd, tvos]
---

# Apple TV / Frame TV Display PRD

> Status: In progress (native pivot). Today view built; Photos and Now Playing next.

> IMPORTANT ARCHITECTURE CHANGE (v2.0.0, 2026-05-30): The original plan was a tvOS WKWebView wrapping the kitchen React app. That is IMPOSSIBLE: tvOS ships no WebKit (no UIWebView / WKWebView) by Apple's deliberate design, confirmed by compiler error (WebKit.framework absent from the tvOS SDK). The app is now NATIVE SwiftUI, reimplementing the three views and hitting the same Pi backend endpoints (/api/state, /api/sonos) plus Open-Meteo directly. The Pi-side work (LAN bind, /api/state, /api/sonos proxy) is unchanged and reused. The web-side TV bridge code (kioskMode.js, useSharedState.js, window.tvAction/photoNav, data-kiosk CSS) is now DEAD for the TV but harmless (gated behind ?kiosk=tv, which the native app never sends); flagged for later cleanup.

This document extends the Kitchen Smart Display to a second surface: a Samsung Frame TV driven by an Apple TV. It is a companion to `PRD - Smart Displays.md` (the source of truth for the kitchen display itself). Decisions here should be folded into `PRD - Smart Displays.md` once Phase 1 ships.

---

## 1. Context and where the project stands

The Kitchen Smart Display (Pi 5 + 15.6" touchscreen, React + Vite, Sonos / Immich / Open-Meteo) is mounted in the kitchen and in daily use. Code is roughly 90 percent complete:

- All three primary views shipped: Today, Photo Slideshow, Now Playing (with Jukebox)
- Settings view (localStorage-backed) shipped
- Pi-side deploy story working (`npm run deploy` does build, rsync, restart)
- Stubbed or missing on the kitchen side: Immich album picker UI in Settings, Sonos room picker UI in Settings, Google Calendar integration (deferred), URL routing / deep-linking

This PRD is a new thread not yet in `PRD - Smart Displays.md`: extend the same React app to the Frame TV via an Apple TV. The original spec has zero mention of secondary displays, mirroring, or Apple TV.

---

## 2. Users and scenarios

- Scenario A, school mornings. Kids and parents moving between kitchen and living areas on weekday mornings (roughly 6:00 to 8:00 AM). The TV shows the Today view (countdown timer, weather, date) so kids can see departure status from anywhere. Phase 1: Justin manually launches the tvOS app on the Apple TV; the boot picker auto-selects Today in the school-morning window. Auto-launch via Home Assistant is Phase 2.
- Scenario B, guests over or music on. Adults in the living room with music playing through Sonos. The TV shows Now Playing as an ambient album-art backdrop; anyone on the couch can pause, skip, or adjust volume with the Siri Remote. Phase 1: Justin manually launches the app; the boot picker auto-selects Now Playing when Sonos is already playing.
- Scenario C, default ambient. Whenever the app is launched outside school-morning hours and Sonos is not playing, the TV defaults to the Photos slideshow as a passive ambient display.

Interaction model: Justin is the launcher in all scenarios. Once launched, the family is mixed-active (mostly passive viewers; anyone can grab the Siri Remote for navigation or music control). The TV is read-only for configuration; all settings changes happen at the kitchen.

---

## 3. Goals and non-goals

### Goals (Phase 1)

- Show the Today, Photos, and Now Playing views on the Frame TV (via Apple TV) with the same data and behavior as the kitchen display.
- Family can navigate between views and control music with the Siri Remote.
- Today and photo behavior settings configured on the kitchen also apply to the TV automatically.
- Boot picker chooses the right view for the moment: school morning gives Today, music on gives Now Playing, otherwise Photos.

### Non-goals (Phase 1)

- No Home Assistant automation. The app is manually launched from the Apple TV home screen. Auto-launch on schedule or scene moves to Phase 2.
- No multi-room Sonos. Siri Remote volume and playback always target the "Main" room. No room picker, no group control from the TV.
- No Settings UI on the TV. All configuration happens on the kitchen. This is permanent, not a Phase 2 deferral.

---

## 4. Phase 1 scope (summary)

In scope:

- Three views reachable on the TV: Today, Photos, Now Playing
- Siri Remote: view navigation, photo prev/next, Sonos play/pause/prev/next/volume, Menu to exit
- Pi state API plus a React `useSharedState()` hook to sync a defined subset of settings from kitchen to TV (read-only on the TV)
- Boot-time view picker: school morning, then Sonos playing, then Photos
- tvOS app: native SwiftUI (NOT WKWebView; tvOS has no WebKit), reimplementing the views against the Pi endpoints. See the architecture-change banner at the top and section 7.4.
- `[data-kiosk="tv"]` CSS branch (hides the menu pill; future Now Playing redesign hooks here)
- Kitchen Settings UI extended to POST synced fields to the Pi on change
- Manual launch from the Apple TV home screen
- `PRD - Smart Displays.md` updated to document the new TV thread

Out of scope (Phase 2 or later):

- Home Assistant automation (auto-launch)
- TV-specific cinematic Now Playing layout
- Multi-room Sonos support
- TV Settings UI (permanent non-goal)

---

## 5. Functional requirements

### 5.1 Siri Remote interactions

- Navigation: swipe or click left and right cycles between Today, Photos, Now Playing. Settings is excluded (kitchen-only).
- Photos view: clickpad left/right is previous / next photo.
- Now Playing view: clickpad left/right is previous / next track; the play/pause button toggles play/pause; the dedicated volume buttons map to Sonos volume up/down (intercepted and routed to node-sonos-http-api, not TV audio).
- Today view: no interactive commands (glance-only).
- Menu button: exits the app (tvOS default behavior).
- Out of Phase 1: Settings access from the TV, Jukebox / station picker from the TV.

### 5.2 State sync model

| State | Sync mechanism | Notes |
|---|---|---|
| Sonos playback (track, play/pause, volume, station) | Already shared, both displays poll node-sonos-http-api | Zero new work on the data side; see 7.2 for the TV reachability proxy |
| Today walking / driving mode | Kitchen to Pi state API to TV (one-way) | TV is read-only; the user only toggles on the kitchen |
| Photos current image | Intentionally not synced | Each device runs its own slideshow timer through the same shuffled album |
| Photo display behavior (smart faces, crop mode, EXIF caption, seconds per photo) | Synced via Pi (read-only on TV) | TV slideshow uses identical cropping and timing rules to the kitchen |
| Active photo album(s) | Synced via Pi (read-only on TV) | When the kitchen changes album, the TV picks it up on the next cycle |
| Sonos room | Hardcoded to "Main" | User indifferent; hardcoding is simpler |

### 5.3 Settings fields that sync to the TV

The kitchen keeps its existing localStorage-backed Settings UI as the sole editor. When any synced field changes on the kitchen, it also POSTs to the Pi state API. The TV reads on mount plus polls; the TV has no Settings UI.

Synced (the whole subtree of each, to avoid cherry-picking field names):

- `location` (lat, lon, timezone)
- `school` (includes `drivingDepart`, `walkingDepart`, and the school-day config the boot picker reads)
- `slideshow` (includes `intervalMs` which is "seconds per photo", `displayMode`, `smartFaces`, `smartCropLossThreshold`, `autoDismissExif`, `exifVisibleSeconds`, `selectedAlbumIds`, `sortOrder`)

Not synced (per-device or kitchen-only):

- All Sonos config (room hardcoded to "Main"; the TV derives its API base, see 7.3)
- Timer color thresholds (per-device; divergence unlikely since rarely changed)
- Display settings (brightness, screen-off hours, screensaver, wake; kitchen-only, the TV does not dim)
- Night-mode schedule (kitchen-only behavior)
- Development variant toggles, system info

### 5.4 TV-only behaviors

- No auto-switch. The kitchen's runtime schedule watchers (swap Today and Photos at school times) do not run on the TV. Once a view is chosen, it stays.
- Boot-time view picker. When the tvOS app launches, the React app auto-picks an initial view based on time of day and weekday. See 5.5.
- No Settings UI. All configuration happens on the kitchen.
- No night-mode dimming. The Apple TV handles its own sleep; the Frame TV handles its own brightness.

### 5.5 Boot-time view picker (TV)

When the app loads with `?view=auto` (or no `?view=` param), in priority order:

1. Weekday (Mon to Fri) school-morning window gives Today. This always wins; school mornings are the point.
2. Sonos currently playing gives Now Playing. This auto-detects "music is on" without Home Assistant.
3. Otherwise, Photos.

The logic lives in `code/src/shell/AppShell.jsx` (React side, not Swift) so it can be iterated without rebuilding the tvOS app. It reuses the existing `computeInitialView()` for the school-morning decision, with one difference from the kitchen: on the TV, Today wins over Sonos during the school-morning window (the kitchen lets Sonos override).

### 5.6 Home Assistant launch contract

Deferred from Phase 1. Phase 1 is manually launched by Justin on the Apple TV. Home Assistant-driven launches (school-morning auto-trigger, guests scene) move to Phase 2.

---

## 6. Design requirements

### Phase 1: minimal TV adaptation via CSS branch

All visual changes live under `[data-kiosk="tv"]` selectors so kitchen styling is untouched.

- Menu pill: hidden. The Siri Remote replaces touch navigation.
- Today, Photos, Now Playing layouts: reuse kitchen visuals unchanged in Phase 1. If 10-foot viewing surfaces specific readability issues during use, font-scale tweaks ship as targeted CSS adjustments.
- Photo cropping behavior: identical to the kitchen (smart faces, crop mode, EXIF caption, portrait pairing), driven by synced settings, no TV-specific logic.

### Phase 2: cinematic Now Playing

Out of Phase 1 scope. Design open: giant album art, dim or dominant-color ambient background, minimal chrome. Figma work first, then a `[data-kiosk="tv"]` CSS branch for Now Playing specifically.

---

## 7. Architecture

### 7.1 Code layout

```
/Smart Display/
  code/                       # React + Vite (existing kitchen app)
  pi/                         # Kiosk server + autostart (existing)
  tvos/                       # SwiftUI tvOS app (Phase 1 shipped)
  docs/                       # specs + designs/
    Apple-TV-Display-PRD.md   # this file
  PRD - Smart Displays.md           # master spec
  BACKLOG.md                  # running tracker
```

`tvos/` is a sibling to `code/` and `pi/`. Single project, single spec. Xcode opens `tvos/` directly.

### 7.2 Pi-side changes (`pi/kiosk-server.py`)

- Change `BIND = '127.0.0.1'` to `BIND = '0.0.0.0'` so the Apple TV and other LAN clients can reach the dashboard.
- Add `GET /api/state` and `POST /api/state`. State is persisted to a JSON file on disk (for example `/home/pi/state.json`) so it survives Pi restarts.
- Add a Sonos passthrough proxy: `GET /api/sonos/<path>` forwards to `http://127.0.0.1:5005/<path>`. This lets the TV reach node-sonos-http-api over the already-LAN-exposed port 8080 without changing the Sonos service's own network bind. The kitchen is unaffected (it keeps calling localhost:5005 directly).

### 7.3 React-side changes (`code/`)

- `src/shell/AppShell.jsx`: parse `?view=today|photos|music|auto` and `?kiosk=tv`; set `<body data-kiosk="tv">` when `kiosk=tv`; expose `window.appNav(view)` (also accepts "next" / "prev" to cycle the three TV views); run the boot-time view picker (5.5) when `view=auto` or absent. On the TV, disable the kitchen-only schedule watchers and do not render the dim overlay.
- A new small module (for example `src/lib/kioskMode.js`) parses the URL params once and, in TV mode, overrides `sonos.apiBase` to `${location.origin}/api/sonos` so Sonos polling and actions route through the Pi proxy.
- `src/lib/settings.js`: on any change, POST the synced subset (5.3) to `/api/state`. The existing localStorage write stays canonical for the kitchen. The POST is gated off when running as the TV (read-only).
- New `src/hooks/useSharedState.js`: on the TV, read `/api/state` on mount plus poll every 30 seconds, and apply the subset into the settings store so existing hooks pick it up. Falls back to the last-known cached value (in WKWebView localStorage) if the Pi is unreachable.
- `src/views/PhotoSlideshow/PhotoSlideshow.jsx`: expose `window.photoNav('prev'|'next')` mapped to the existing advance / goBack logic (which already pauses auto-advance after a manual move, then resumes).
- TV-only CSS branch under `[data-kiosk="tv"]`: hide the menu pill in Phase 1; bump font sizes only if first testing shows a need.

### 7.4 tvOS app (`tvos/`) - NATIVE SwiftUI

No web view (tvOS has no WebKit). The app is native SwiftUI, generated from `project.yml` with XcodeGen. Bundle id `com.nikolaus.kitchendisplay.tv`, tvOS 17+.

Data layer (shared across views):
- `AppConfig.swift`: Pi base URL + endpoint helpers (`/api/state`, `/api/sonos/...`).
- `AppModel.swift`: `ObservableObject` owning settings (polled from `/api/state` every 30s), weather (every 30 min), and a 1Hz clock tick. Generic `fetchJSON` helper.
- `WeatherService.swift`: Open-Meteo fetch (Fahrenheit, all configured slot hours), WMO->SF Symbol mapping. Mirrors `useWeather.js`.
- Settings decode is lenient (per-field fallback to defaults that match `settings.js` DEFAULTS). Non-synced fields (timerThresholds, weatherSlots) use built-in defaults.

Views (Phase 1 build order):
- `TodayView.swift` (DONE): clock + date, departure countdown card with color bands (logic in `DepartureTimer.swift`, mirroring `useTimer.js` band thresholds), weather timeline. Read-only; driving is the default travel mode.
- Photos (next): native slideshow from the Immich manifest with smart-crop / face-aware positioning / portrait pairing.
- Now Playing (next): album art + transport via the `/api/sonos` proxy.

Siri Remote (lands with the view switcher):
- Swipe up/down: switch view (Today / Photos / Now Playing).
- Swipe left/right: context action (Photos prev/next photo; Now Playing prev/next track).
- Play/Pause + Select: Sonos play/pause via `/api/sonos/Main/playpause`.
- Menu: exits the app (tvOS default).
- Volume: NOT remote-controllable on tvOS (system handles it over CEC); deferred.

`Info.plist`: ATS exception for plain HTTP on the LAN.

Build note: build to `-destination 'generic/platform=tvOS Simulator'` (the toolchain ships the tvOS 26.5 SDK but only the 26.4 sim runtime is installed; pinning a concrete sim OS fails to resolve, the generic destination works). `BUILD SUCCEEDED` confirmed for the Today milestone.

### 7.5 Distribution

Annual Xcode rebuild and reinstall (paid Apple Developer account, one-year signing). Documented in `tvos/README.md`. Real-device install to the "Living Room" Apple TV needs the Developer Team ID set in `project.yml` (`DEVELOPMENT_TEAM`) then `xcodebuild -destination 'platform=tvOS,name=Living Room' -allowProvisioningUpdates`.

### 7.6 Deferred to Phase 2

- Home Assistant automation (auto-launch on schedule or scene)
- Cinematic TV-specific Now Playing layout
- Multi-room Sonos (volume targets "Main" only)

---

## 8. Decisions log

- Phase 1 scope: three views on the TV (Today, Photos, Now Playing). Settings excluded.
- Home Assistant automation: deferred to Phase 2.
- Settings storage: partial sync of an explicit subset (5.3); the kitchen remains the sole editor.
- Boot picker: weekday school morning gives Today (always wins), else Sonos playing gives Now Playing, else Photos.
- TV Now Playing layout: ship the kitchen layout as a fallback; cinematic redesign in Phase 2.
- Code location: sibling `tvos/` folder.
- "Display" sync clarified as the photo display settings (already in the synced list), not the kitchen brightness / dim settings.
- Mirroring versus independence: independence. Only the fields in 5.2 sync.
- Siri Remote scope: navigation, photo prev/next, and play/pause/prev/next/volume on Sonos.
- TV has no Settings UI, no night-mode dimming, and no auto-view-switch mid-session.
- Network resilience: the TV caches last-known state in localStorage as a fallback if the Pi is unreachable.
- Boot picker logic lives in React (`AppShell.jsx`), not Swift.
- Sonos reachability on the TV solved with a Pi-side `/api/sonos` proxy rather than rebinding node-sonos-http-api.

---

## 9. Milestones

Phase 1 ordering (Home Assistant automation moved to Phase 2):

1. Lock this PRD.
2. Update `PRD - Smart Displays.md` with the TV section.
3. Pi-side foundation changes (LAN bind, `/api/state`, `/api/sonos` proxy).
4. React URL params, `window.appNav`, `kiosk=tv` body attribute, boot picker, disable kitchen-only watchers on TV.
5. Pi state API client: `useSharedState()` hook plus settings write-through.
6. `window.photoNav` plus hide menu pill on TV.
7. tvOS webview app skeleton (loads `?view=auto&kiosk=tv`).
8. Siri Remote navigation plus Sonos wiring (volume, prev/next track, photo prev/next).
9. Build and validate in the tvOS simulator.
10. Deploy to the live Pi and verify the foundation checkpoint (10).
11. TV-optimized Now Playing layout (design then code; may slip to Phase 2).

Phase 2 (deferred):

- Home Assistant automation for school mornings (auto-launch Today on the TV)
- Home Assistant scene for guests-over (auto-launch Now Playing on the TV)
- Anything else that emerges during Phase 1 use

---

## 10. Verification and success criteria

### Foundation checkpoint (after the Pi and React state work)

1. `npm run deploy` pushes the Pi state API and LAN bind. From a laptop, `curl http://smartdisplay.local:8080/api/state` returns JSON.
2. From a laptop, opening `http://smartdisplay.local:8080/?view=music&kiosk=tv` loads Now Playing directly, `document.body.dataset.kiosk` equals "tv", and the menu pill is hidden.
3. In the browser console, `window.appNav('today')` switches the view; `?view=auto` boots to the right view based on weekday, time, and Sonos.
4. Changing a synced setting on the kitchen appears in `/api/state` within 30 seconds.
5. The kitchen still boots normally with no regressions when the URL has no query params.

### Phase 1 success (after the Siri Remote work)

- The family can launch the tvOS app on the Apple TV by hand, see the correct view for the time of day, and interact with the Siri Remote as documented in 5.1.
- The TV Today timer reads identical departure times to the kitchen.
- The TV photo slideshow shows photos from the same album(s) the kitchen is showing, with identical cropping and smart-faces behavior.
- Pause, skip, and volume on the Siri Remote affect Sonos audio (which plays through the Sonos speakers, not the TV).
- The TV has been used for one school week and one party night without surfacing a blocker bug.
