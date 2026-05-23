---
title: "Smart Displays - Kitchen Display Project"
created: 2026-03-01
modified: 2026-05-21
version: 14.0
author: Claude Opus 4.7 (claude-opus-4-7)
tags:
---

# Kitchen Display

### Jobs to Be Done

**Help get the kids to school in the morning**
- Time and date
- Time-to-leave countdown (static time per school day to start)
- driving vs walking leave time (leave later when driving in cold/rain), tap to toggle between driving versus walking
  - Future: suppress this view on no-school days
- Weather
- What to wear - jacket weight (heavy, light, none), pants vs shorts, rain jacket, 
- Calendar / agenda (Google Calendar integration)
- Big color coated background that shows how soon we have to leave. yellow - almost time to go. Red - We need to leave now.
- Future: Import the schools lunch schedule, Show the kids school special activities like Library (To make sure books are in bag) Or after school activities, such as coding. 

**Music**
- What music is currently playing on Sonos
- Next / pause controls
- Choose a new playlist / station (Jukebox)

**Ambient / Photo Frame**
- Family photo slideshow when idle (served from Immich on the NAS)

**Security (future enhancement)**
- Who's at the front door? Doorbell cam view

---

### Views

1. **Photo Slideshow** - Fullscreen photo slideshow served from Immich (self-hosted). Default idle state.
2. **Now Playing** - Split screen: playback controls/metadata on left, album art on right.
3. **Today** - Daily briefing: time, countdown (school days), weather. Phase 1 focuses on time/date, weather timeline, and departure countdown. Future phases add calendar/agenda, what to wear recommendations, and school schedule awareness.


## Figma Links 

music-NowPlaying https://www.figma.com/design/V9TzOQY1M3pieFIVzgfnMb/Projects-04-2026?node-id=83-461&m=dev

music-StationPicker https://www.figma.com/design/V9TzOQY1M3pieFIVzgfnMb/Projects-04-2026?node-id=171-20&m=dev

nav menu https://www.figma.com/design/V9TzOQY1M3pieFIVzgfnMb/Projects-04-2026?node-id=195-158&m=dev



---

### Behavior

**Auto-suggest the correct view (timer-driven lifecycle)**
- 6:00 AM weekdays (M-F): Today screen auto-appears with default departure time from Settings
- Timer expiry + 15 minutes idle: transition to Photo Slideshow
- Timer canceled (X button): transition to no-timer state; 15 minutes idle on no-timer state: transition to Photo Slideshow
- Default / idle = Photo Slideshow (the "home base" for the display)
- Phase 1: No auto-interrupt for music. Sonos playback shows album art widget on Photo Slideshow; tap album art to enter Now Playing manually.
- Future: Music playing on Sonos = Now Playing (auto-interrupts photos, not Today)
- Future: Doorbell ring = Camera view (would require Home Assistant)

**Global navigation: Menu pill**
- Available on every view - tap any "dead area" (background, non-interactive region) to summon
- Interactive elements (buttons, toggles, swipe targets, album art widget) perform their own action and do not trigger the menu
- A frosted-glass translucent pill fades in (centered on screen) over a blurred background
- Four icons with labels: Photos (pinwheel icon), Music (music note), Today (calendar icon), Settings (gear icon)
- The current view's icon can be visually de-emphasized or highlighted
- Dismiss by tapping anywhere outside the pill, or by tapping an icon (navigates and dismisses simultaneously)
- Auto-fades after 4-5 seconds of no interaction

**Photo Slideshow interactions**
- Swipe left/right: previous/next photo
- Photo metadata (location, date, album): fades in on photo transition, auto-fades after 5-6 seconds. Passive - no gesture needed to show it, it appears and disappears on its own.
- Time widget (bottom-left): always visible. Tap to cycle through: time only > time + date > time + date + weather
- Album art widget (bottom-right): appears only when music is playing on Sonos. Tap to jump directly to Now Playing view.
- Tap photo background (dead area): summons menu pill

*Portrait photo handling:*
- Landscape photos display fullscreen as normal.
- Portrait (vertical) photos are buffered and displayed in pairs, side by side, to fill the landscape screen. As photos come in from the API, portraits are held in a buffer while landscapes continue to display. When two portraits have accumulated, they are shown together regardless of their album order.
- Fallback: if a portrait photo has been waiting in the buffer for more than 40 photos without a second portrait arriving, display it solo centered on screen with a blurred/enlarged version of itself as the background.
- Dual-portrait layout: two portrait photos side by side, each filling roughly half the screen width.

**Now Playing interactions**
- Left side: station/playlist name (tappable), artist, track title, progress bar, playback controls (prev / pause / next)
- Right side: album art (large)
- Time widget (bottom-left): always visible, same tap-to-cycle behavior as Photos
- Tap album art or any dead area: summons menu pill (consistent with all other views)
- When music stops on Sonos while on Now Playing: 15 minutes idle, then transition to Photo Slideshow

*Station/playlist picker (Jukebox):*
- Triggered by tapping the station/playlist name label on the left side (e.g., "Classic Rock Radio")
- A centered panel appears over the Now Playing screen with the picker grid inside. Now Playing remains visible (dimmed) around the panel edges.
- Picker header: back arrow + "Now Playing" label on the left to dismiss without selecting; "PICK YOUR VIBE" centered title
- Tapping the station name label again also dismisses the picker
- Grid layout: 2-column grid of horizontal list-cards. Each card shows a colored album art square (left), station/playlist name + source label (Pandora/Spotify) (right), and a numbered slot indicator (01, 02, etc.) in the top-right corner. Scrolls vertically if more items than fit in the panel.
- Currently playing station is indicated by a small animated equalizer (3-4 vertical bars bouncing with the beat / on a loop) shown inside its cell. The position within the cell can be refined in design, but it should be small and unobtrusive.
- Data source: Sonos Favorites (playlists and stations saved in the Sonos app)
- On selection: starts playing the selected station immediately, panel dismisses to reveal updated Now Playing screen with new album art and metadata
- Now Playing remains underneath the panel and music keeps playing during browsing

**Now Playing - potential features (not yet committed)**
- Skeuomorphic vinyl spin view: full-screen spinning record with album art on center label, walnut cabinet background, physical-looking transport buttons, green phosphor LCD metadata display, tonearm. Concept mockup exists (vinyl-spin-mockup.html).
- Presets / speaker group management: create or trigger saved Sonos presets (e.g., "Dinner Party" groups Kitchen + Dining + Living Room at set volumes). Available via node-sonos-http-api `GET /preset/[name]` and grouping endpoints.
- See what's playing in other groups: show a "whole house" view of all Sonos zones and what each group is currently playing. Available via `GET /zones` endpoint.

**Today view interactions**
- Phase 1 layout (four quadrants): time/date (top-left), countdown timer (right side, full height), weather timeline (bottom-left)
- Low density, high visuals - readable from the breakfast table at 6-8 feet
- Tap background (dead area): summons menu pill

*Timer states:*
- **Active timer (default):** Color-coded countdown background on right side. Shows "LEAVE IN [number] MIN" (or "LEAVE NOW" at zero). Close button (subtle icon, upper-right corner of timer panel) cancels the timer. Tap target for close button is generous (44x44px minimum) even though the visual element is small.
  - Color progression thresholds (applies to all timers, default and manual):
    - Green = more than 7 minutes remaining
    - Yellow = 4-7 minutes remaining
    - Orange = 1-3 minutes remaining
    - Red = 0 minutes remaining ("LEAVE NOW")
  - Default timer (auto-loaded from Settings on weekday mornings): shows driving/walking toggle at bottom of timer panel. Tap to switch between leave times.
  - Manual timer (set via the set-timer flow): does not show driving/walking toggle.
- **No-timer state:** Right side shows "NO TIMER" in subdued text with a "SET" button at bottom. Displayed when: timer is canceled, user navigates to Today outside the auto-show window, or on weekends. After 15 minutes of no interaction, transitions to Photo Slideshow.
- **Set-timer state:** Right side shows a scroll picker with hour, minute, and AM/PM columns. Current selection is bold/white, adjacent values are faded above and below. "DONE" button at bottom confirms and starts the timer. A timer set from this screen follows the same lifecycle (color progression, 15-minute post-expiry transition to Photos).

*Timer lifecycle:*
- 6:00 AM on weekdays (M-F): Today screen auto-appears with default departure time from Settings
- Timer counts down, color shifts through thresholds as time decreases
- At expiry: shows "LEAVE NOW" (red state)
- 15 minutes after expiry: transitions to Photo Slideshow
- Cancel (X button): transitions to no-timer state (not directly to Photos)
- No-timer state + 15 minutes idle: transitions to Photo Slideshow
- Manually navigating to Today via menu outside auto-show window: shows no-timer state with weather

*Weather timeline (bottom-left):*
- Five time slots: 8AM, 11AM, 2PM, 5PM, 8PM
- Each slot shows: weather condition icon (color-coded) and temperature
- No night icon variants - sun icons represent clear conditions regardless of time of day
- Phase 1 scope: weather timeline only
- Future phases: calendar/agenda integration, what-to-wear recommendations (jacket weight, shorts vs. pants), school schedule awareness (suppress countdown on no-school days, show special activities like Library or after-school coding)

*WMO weather code to icon mapping (13 icons):*
- **Clear** (sun icon, orange): WMO codes 0 (clear sky), 1 (mainly clear)
- **Partly Cloudy** (sun behind cloud): WMO code 2
- **Mostly Cloudy** (sun peeking behind larger cloud): WMO code 3
- **Overcast** (cloud only): used as fallback or for fully overcast conditions
- **Light Drizzle** (cloud, single drop): WMO code 51
- **Drizzle** (cloud, two drops): WMO codes 53, 55
- **Rain** (cloud, angled lines): WMO codes 61 (light rain), 63 (rain), 80 (light showers), 81 (showers)
- **Heavy Rain** (cloud, heavy angled lines): WMO codes 65 (heavy rain), 82 (heavy showers)
- **Thunderstorm** (cloud, rain + lightning bolt): WMO codes 95, 96, 99
- **Freezing Rain** (cloud, mixed drops + x marks): WMO codes 56 (light freezing drizzle), 57 (freezing drizzle), 66 (light freezing rain), 67 (freezing rain)
- **Snow** (cloud, few x/flake marks): WMO codes 71 (light snow), 77 (snow grains)
- **Heavy Snow** (cloud, dense x/flake marks): WMO codes 73 (snow), 75 (heavy snow), 85 (light snow showers), 86 (snow showers)
- **Fog** (cloud with horizontal lines): WMO codes 45 (fog), 48 (rime fog)

Icon style: line-art with consistent stroke weight. Color accents: orange for sun elements, blue for rain/snow drops, yellow for lightning. Designed in Figma (artboard: node 83:113).

**Screen dimming**
- Time-based dimming schedule (bright during day, dim in evening, off/very dim at night)
- Future enhancement: Connect to Home Assistant for presence-based or light-level control

**Settings page**
- Entry point: Settings icon in the menu pill (accessible from any screen)
- Full-screen overlay with back button to return to current view
- Also serves as the initial setup/onboarding flow on first boot

Settings sections:

*Photo Management*
- Immich source selection (which Immich album(s) or smart-search results feed the slideshow)
- Immich server URL and API key (entered during onboarding, stored locally on the Pi)
- Slideshow timing (seconds per photo)
- Transition style (fade, slide, Ken Burns, etc.)
- Photo display mode (fill screen vs. fit with letterboxing)

*Music / Sonos*
- Sonos room selection (auto-discovered from the network)

*Today View*
- School departure time (countdown target). Default values: driving = 7:42 AM, walking = 7:32 AM (school starts at 7:50 AM).
- Driving vs. walking default
- Weather thresholds for clothing recommendations (heavy jacket, light jacket, none, shorts vs. pants)
- Which Google Calendar(s) to display

*Display*
- Brightness level / dimming schedule
- Screen-off hours (e.g., 11 PM to 6 AM)
- Auto-view switching rules (time-based rules for which view shows when)
- Screensaver behavior (show photos, go black, or dim current view)

*Development / Iteration*
- Design variant selector per view (toggle between layout variants for Photos, Now Playing, Today)
- Can be removed or hidden once designs are finalized, or kept as a power-user feature

*System (informational)*
- Wi-Fi status
- IP address
- node-sonos-http-api status (running/not running)
- Software version

---
### Hardware 

**Computer**
- Raspberry Pi 5 (4GB+ RAM) - DECIDED
- Running Chromium in kiosk mode, serving a local web app

**Frame**
- Wooden frame with white matte - visually similar to Echo Show 15
- Wall-mounted next to an outlet (not recessed)
- French cleat mounting system

**Frame approach: Modified shadow box (recommended)**
- Buy a deep shadow box frame from Hobby Lobby, Michaels, or Amazon (~$15-30)
- Size needed: roughly 16x10" inner dimension to fit a 15.6" display (measure your actual panel first)
- Buy or order white matte board; cut a window to expose just the screen area
- Mount the display panel inside the shadow box with adhesive strips or small brackets
- Mount the Pi on the back of the frame with standoffs or velcro
- Route HDMI + USB + power cables inside the frame
- French cleat on back for wall mounting
- Total frame cost: ~$20-40 in materials
- Key tips from builders:
  - Use a fresh, sharp blade for matte cuts (X-Acto or matte cutter)
  - Go matte finish on the frame, not glossy (reduces glare)
  - Measure twice - the matte window should be ~2-3mm smaller than the active screen area on each side to hide bezels
  - Shadow box depth gives room for the Pi and cables behind the display

### Frame Links 
![[Pasted image 20260313114503.png]]
**How Josh built a large digital picture frame with a 3:2 aspect ratio which is perfect for all DSLR photographers**
https://www.thedigitalpictureframe.com/build-3-by-2-aspect-ratio-digital-picture-frame-raspberry-pi/



---

### Software Stack

**Architecture: Web app in kiosk browser (no Home Assistant dependency)**
- Raspberry Pi OS (Bookworm)
- Chromium in fullscreen kiosk mode on startup
- Frontend: React + Vite (served locally as static files after build)
- Photos: Immich (self-hosted, runs on the Synology NAS or the Windows NUC, accessed over the LAN via its REST API)
- Calendar: Google Calendar API (direct, OAuth 2.0) - deferred to a future phase, not in Phase 1
- Weather: Open-Meteo API (free, no API key, no sign-up)
- Music: node-sonos-http-api (local REST API on the Pi, direct Sonos control)
- No Home Assistant in the loop. Four independent API integrations, all running locally or via direct cloud API calls. HA only becomes relevant if future enhancements (doorbell camera, presence-based dimming) are pursued.

**Music control: node-sonos-http-api (direct to Sonos)**
- GitHub: github.com/jishi/node-sonos-http-api
- Runs on the Pi as a Node.js service, auto-discovers Sonos speakers on the local network
- Exposes full Sonos control as a local REST API on port 5005
- No cloud dependency, no Home Assistant dependency for music - controls keep working even if HA goes down
- Key endpoints:
  - `GET /[Room]/state` - current track (title, artist, album, albumArtURI, absoluteAlbumArtURI, duration, elapsedTime), volume, playState, next track, shuffle/repeat, equalizer
  - `GET /[Room]/play`, `/pause`, `/next`, `/previous` - transport controls
  - `GET /[Room]/volume/[0-100]` or `/volume/+10` - volume control
  - `GET /[Room]/favorites` - list Sonos Favorites (playlists, stations saved in Sonos app)
  - `GET /[Room]/favorite/[name]` - play a specific Sonos Favorite by name
  - `GET /zones` - full system topology: all speakers, groups, what's playing on each group
  - `GET /[Room]/join/[OtherRoom]` - group speakers together
  - `GET /[Room]/leave` - ungroup a speaker
  - `GET /preset/[name]` - trigger saved presets (groupings + volumes)
- Album art: returns both relative and absolute URLs, embeddable directly in `<img>` tags
- Real-time updates: supports webhooks (POST callbacks on state changes) configured in `settings.json`. UPnP-based, so pair with light 1-2 second polling on `/state` for smooth progress bar updates.
- Sonos Favorites = the Jukebox source. Save playlists and stations as Sonos Favorites in the Sonos app, and they appear in the API with names and art.
- Additional capability (future enhancement): can see all zones, group/ungroup speakers, and trigger presets for whole-house audio scenes.

**Photos: Immich (self-hosted)**
- Immich is an open-source, self-hosted Google Photos replacement with iOS and Android apps that auto-backup phone camera rolls. Runs in Docker.
- Hosted on the home network (Synology NAS via Container Manager if supported, otherwise on the Windows NUC alongside Plex pulling photo storage from the NAS).
- How it works:
  1. Family members install the Immich iOS app and enable auto-backup, the same pattern as Google Photos.
  2. Photos and videos sync to the Immich server on the home network. Existing Google Photos archive is migrated in via Google Takeout + `immich-go`.
  3. Curated album(s) in Immich define what the kitchen display shows. Other albums can feed future photo frames in other rooms.
  4. The kiosk app calls the Immich REST API (e.g. `/api/albums/{id}/assets`, `/api/assets/{id}/thumbnail`) over the LAN to list and fetch photos.
  5. New photos added to a curated album appear automatically on the display via periodic polling.
- Authentication: a long-lived Immich API key generated in the Immich UI and stored in the kiosk app's local config. No OAuth, no refresh tokens, no Google Cloud project.
- Multi-frame strategy: future additional photo frames (other rooms) point at the same Immich server, optionally at different albums (e.g. kitchen = "Family + Kids," bedroom = "Travel").

**Why not Google Photos APIs (decision context, 2026-05-21):**
- The original plan was the Google Photos Ambient API in OAuth Testing mode. Confirmed via Google's published docs and an independent second-opinion review that this path is not viable for a personal home project:
  - Ambient API is gated behind acceptance into Google's Photos Partner Program (business-oriented, low realistic odds for a hobby project).
  - Library API after April 2025 is restricted to media the app itself uploaded. Pre-existing Google Photos albums are not accessible.
  - Picker API requires per-session manual selection, wrong UX for an always-on ambient display.
  - OAuth Testing-status refresh tokens expire after 7 days for non-basic-identity scopes, which would break the display weekly even if any of the above worked.
- Immich avoids all of the above and is the supported community pattern for self-built smart-display photo frames in 2026.

**Why no Home Assistant:**
- This is a single-purpose display, not a general HA dashboard
- Every data source has a direct API: Immich (LAN), Open-Meteo weather API, node-sonos-http-api (LAN). Google Calendar (OAuth) is deferred to a future phase.
- Adding HA as a middleware layer adds complexity, latency, and a failure point with no benefit
- If future enhancements are pursued (doorbell camera, presence-based dimming), HA can be added later for just those features without rearchitecting anything

**Frontend: React + Vite**
- Develop on laptop with hot reload, `vite build` produces static files, copy to Pi
- Each view is an independent React component (PhotoSlideshow, NowPlaying, TodayView, Settings, JukeboxGrid)
- Each API integration is a custom hook (useSonosState, useImmichPhotos, useWeather, and later useCalendarEvents)
- Claude Code generates high-quality React, which matters for rapid design iteration
- No Node.js server needed at runtime for the frontend - just static files served to Chromium
- node-sonos-http-api is the only persistent Node process on the Pi

**Why this stack:**
- Component model matches the project perfectly: independent views, independent data sources
- Easy to iterate on any single view without touching the others
- Browser handles all rendering, touch events, animations
- Four independent integrations means any one can break without taking down the others

---

### Build Plan

**The Display (single build, four independent feature tracks)**

*Photos*
- Immich integration via REST API + long-lived API key
- Onboarding flow: enter Immich server URL + API key, pick album(s) from a list returned by Immich
- Slideshow with configurable timing, transitions, display mode
- Time/date widget overlay

*Today View*
- Phase 1: Weather API integration (Open-Meteo), time-to-leave countdown with color-coded background, driving vs. walking toggle, timer set/cancel flow, no-timer state, WMO weather code to icon mapping
- Future: Google Calendar API integration (direct OAuth), what to wear recommendations based on weather thresholds, school schedule awareness

*Music*
- node-sonos-http-api running on the Pi
- Now Playing view with transport controls, metadata, progress bar, album art, and station/playlist picker (Jukebox as a centered panel overlay on top of Now Playing). Album art widget on Photo Slideshow as entry point.
- Webhook + polling for real-time state sync
- Sonos room selection (via Settings page)

*Shell and Navigation*
- Chromium kiosk mode setup on Raspberry Pi OS
- Menu pill (frosted-glass translucent overlay with four icons, auto-fade)
- Timer-driven view switching (Today auto-show at 6 AM weekdays, 15-minute idle transitions to Photos)
- Screen dimming schedule
- Settings page (accessible from menu pill)
- Design variant toggle for iteration during development

**Future enhancements (only if desired later)**
- Photo grid mode: option in Settings to display multiple photos at once in an irregular grid layout (e.g., four photos of varying sizes). An alternative to the single-photo slideshow for when you want to see more photos at a glance.
- Now Playing auto-interrupt (auto-switch to Now Playing when music starts on Sonos)
- Today view: calendar/agenda integration, what-to-wear recommendations, school schedule awareness
- Doorbell camera view (would require Home Assistant)
- Presence-based dimming (would require Home Assistant)
- Speaker grouping/ungrouping controls
- Whole-house audio presets
- Vinyl spin view or other Now Playing visual modes

---

### Reference Links

**Shadow box frame build guides (most relevant):**
- [Instructables - Pi in a Shadow Box (step-by-step with photos)](https://www.instructables.com/Wireless-Raspberry-Pi-Digital-Picture-Frame-in-a-S/)
- [rberrypi - Shadow box enclosure with matte board cutting guide](http://rberrypi.blogspot.com/2013/05/a-raspberry-pi-based-digital-picture.html)
- [Instructables - Pi Media Panel 15"/17" screen (thin build, ~1" depth)](https://www.instructables.com/How-to-Make-a-Raspberry-Pi-Media-Panel-fka-Digita/)

**Other frame inspiration and build guides:**
- [Matter of Fractions - Pre-built hardwood smart displays](https://matteroffractions.com/products/24-smart-display)
- [NexFoto - Pi 4 + 15.6" monitor in handmade wooden frame](https://nexfoto.com/blogs/news/how-to-build-a-raspberry-pi-digital-picture-frame-with-google-photos-integration)
- [Nemdub - DIY Kitchen Wall Display](https://www.nemdub.com/diy-kitchen-wall-display/)
- [DAKboard - DIY Wall Display guide](https://blog.dakboard.com/diy-wall-display/)
- [Medium - Wall-Mounted Pi Display Frame (matte vs glossy lessons)](https://medium.com/@cjfit219/building-a-wall-mounted-raspberry-pi-display-frame-e931fc1b5023)
- [Instructables - DIY 24" Digital Picture Frame](https://www.instructables.com/DIY-Raspberry-Pi-24-Digital-Picture-Photo-Frame/)
- [Instructables - Pi Media Panel with 15"/17" screen](https://www.instructables.com/How-to-Make-a-Raspberry-Pi-Media-Panel-fka-Digita/)
- [Scott Hanselman - Wall Mounted Family Calendar](https://www.hanselman.com/blog/how-to-build-a-wall-mounted-family-calendar-and-dashboard-with-a-raspberry-pi-and-cheap-monitor)
- [TheDigitalPictureFrame.com - 2025 build guide](https://www.thedigitalpictureframe.com/how-to-build-the-best-raspberry-pi-digital-picture-frame-with-bookworm-wayland-2025-edition-pi-2-3-4-5/)

**Software references:**
- [Home Assistant wall-mounted touchscreen community thread](https://community.home-assistant.io/t/dashboard-on-wall-mounted-touchscreen-display-with-raspberry-pi/840296)
- [The Stock Pot - Smart Home Dashboard with Pi 5](https://www.thestockpot.net/videos/home-assistant-wall-display)
- [Stanislav Khromov - Smart kitchen display with Pi](https://khromov.se/building-a-smart-kitchen-display-using-a-raspberry-pi/)

**Hardware references:**
- [HAMTYSAN 15.6" Touchscreen on Amazon](https://www.amazon.com/HAMTYSAN-Raspberry-1920x1080-Touchscreen-Dual-Speakers/dp/B0DRF6WLHZ)
- [Waveshare 15.6" Capacitive Touchscreen on Amazon](https://www.amazon.com/15-6inch-HDMI-LCD-case-Resolution/dp/B07QXKKHRF)
- [Official Raspberry Pi Monitor (non-touch)](https://www.raspberrypi.com/products/raspberry-pi-monitor/)
- [Arzopa - Guide to Portable Monitors for Pi](https://www.arzopa.com/blogs/guide/portable-monitors-for-raspberry-pi)

---

### Decisions Made

- **Orientation:** Landscape
- **Music service:** Spotify (replacing Pandora dependency)
- **Music control architecture:** Direct to Sonos via node-sonos-http-api (local REST API on the Pi). No Home Assistant dependency.
- **Overall architecture:** No Home Assistant. Three direct API integrations for Phase 1: Immich (LAN), Open-Meteo weather API, node-sonos-http-api (LAN). Google Calendar API moves to a future phase. Single build, no phased rollout for the kiosk app itself.
- **Jukebox data source:** Sonos Favorites (save playlists/stations in the Sonos app, they appear in the API)
- **Jukebox ingress:** Tap the station/playlist name label on the left side of Now Playing. A centered panel appears over Now Playing (which dims behind it) to reveal the picker grid. Station name label is the trigger (not the album art itself, not a separate Browse button).
- **Jukebox grid style:** Commercial jukebox style - compact horizontal list-cards with small art + text, source label (Pandora/Spotify), numbered slots, scrollable vertically. Header: "PICK YOUR VIBE."
- **Album art tap behavior:** Treated as dead space - summons the menu pill, consistent with tapping dead areas on all other views.
- **Jukebox dismiss:** "Now Playing" back button at top of picker, or tap the station name label again to toggle closed.
- **Today view (formerly Morning Helper):** Single glanceable screen, low density, high visuals - kids see it from the breakfast table. Phase 1 layout: four quadrants with time/date (top-left), countdown timer (right side), weather timeline (bottom-left).
- **Menu pill (formerly nav bar):** Centered frosted-glass translucent pill with four icons: Photos (pinwheel), Music (music note), Today (calendar), Settings (gear). Summoned by tapping dead area on any view. Dismissed by tapping outside the pill or by selecting an item. Auto-fades after 4-5 seconds. Background blurs when pill is visible.
- **Settings access:** Via the menu pill. No hidden long-press gesture.
- **Timer model:** Default departure time configured in Settings, auto-loaded on weekday mornings (M-F) at 6:00 AM. Default timer shows driving/walking toggle. Manual timers (set via Today screen picker) do not show the toggle.
- **Timer cancel behavior:** Close button (X) on timer panel transitions to no-timer state (not directly to Photos). No-timer state shows "NO TIMER" with a "SET" button.
- **Idle timeout (universal):** 15 minutes of no interaction on expired timer, no-timer state, or Now Playing with music stopped all transition to Photo Slideshow.
- **Today auto-show:** 6:00 AM on weekdays (M-F). Timer lifecycle drives transitions, no fixed end-time window.
- **Today outside auto-show:** Navigating to Today via menu outside the morning auto-show shows the no-timer state with weather.
- **Phase 1 music scope:** Now Playing with transport controls, album art, and station/playlist picker (Jukebox). No auto-interrupt from Sonos playback. Album art widget on Photo Slideshow is the entry point to Now Playing.
- **Countdown color thresholds:** Green = more than 7 min, yellow = 4-7 min, orange = 1-3 min, red = 0 min ("LEAVE NOW"). Applies to all timers (default and manual).
- **School time defaults:** School starts at 7:50 AM. Driving departure = 7:42 AM. Walking departure = 7:32 AM.
- **Portrait photo handling:** Buffer portrait photos and display them in pairs side by side. If a portrait waits more than 40 photos without a partner, display it solo with a blurred background. Landscape photos display fullscreen as normal.
- **Weather API:** Open-Meteo (free, no API key, no sign-up, no credit card). Returns hourly forecasts with WMO weather codes.
- **Weather icons:** 13 custom line-art icons (no night variants). WMO codes mapped to: clear, partly cloudy, mostly cloudy, overcast, light drizzle, drizzle, rain, heavy rain, thunderstorm, freezing rain, snow, heavy snow, fog.
- **Frame:** Modified shadow box approach (~$20-40, not $600 pre-made)
- **Computer:** Raspberry Pi 5 8GB (Vemico starter kit - board + active cooler + 27W PSU)
- **Display:** EVICIV 15.6" Touchscreen (B0CYLTZSWD) - glossy + F FORITO matte anti-glare film
- **Photos:** Immich, self-hosted on the home network (Synology NAS via Container Manager preferred, NUC alongside Plex as the fallback). Decided 2026-05-21 after confirming the Google Photos Ambient API requires Partner Program acceptance (not realistic for a personal project), the Library API was restricted in April 2025 to app-uploaded media only, the Picker API is wrong UX for an ambient slideshow, and OAuth Testing-mode refresh tokens expire weekly. Immich also unlocks future photo frames in other rooms pointing at the same library.
- **Settings page:** Accessible from menu pill. Full-screen overlay. Covers: photo management (Immich server URL + API key, album selection, slideshow timing, transitions), Sonos room selection, Today view config (departure time, weather thresholds; calendar config when added in a future phase), display settings (brightness, screen-off hours, screensaver behavior), design variant toggle, and system info. Also serves as onboarding flow on first boot.
- **Hardware ordered:** 2026-03-25, arriving Friday 2026-03-27

---

### Pandora to Spotify Migration

The core challenge: Pandora's algorithm (Music Genome Project, 450+ musical characteristics, years of thumbs data) cannot be directly transferred. Spotify uses a completely different recommendation engine. There is no perfect migration - but there are good-enough options depending on how much effort you want to put in.

**Option 1: Transfer tool + manual radio recreation (easiest, good enough for most stations)**
- Use Soundiiz or FreeYourMusic to transfer your thumbed-up songs as playlists into Spotify
- For each Pandora station, create a Spotify radio from the seed artist(s) and save it as a playlist
- Multi-seed stations: follow all seed artists on Spotify, then use Spotify's "artist radio" from each and merge into one playlist
- Limitation: Spotify artist radio only generates ~50 songs and doesn't auto-refresh like Pandora stations do
- Cost: FreeYourMusic $14.99 one-time, Soundiiz free tier (limited) or paid for thumbs-up transfers

**Option 2: Export Pandora data first, then import (more thorough)**
- Use Pandora-Export (github.com/mdavis-xyz/Pandora-Export) - Python script that exports your thumbs up AND thumbs down per station as JSON. Gives you a structured file with every like tied to its station.
- Use Pandabye (github.com/jkairys/pandabye) - exports thumbs to CSV format
- Once exported, use Soundiiz or TuneMyMusic to import the thumbed-up tracks into Spotify playlists (one playlist per station)
- Thumbs-down data can't be imported into Spotify, but you can manually "hide" songs in Spotify that you know you dislike

**Option 3: Custom algorithm approach (most faithful, technical)**
- The Data Hackr built an open approach that recreates Pandora's multi-seed artist radio using Spotify's API
- You pass in multiple seed artists (just like Pandora) and it generates a radio-like playlist using Spotify's related artist graph and popularity weighting
- Supports 100+ seed artists, generates playlists in seconds with caching
- Can filter out specific artists you don't want (replicating thumbs-down behavior)
- Requires Python and Spotify API credentials, but could be a fun Claude Code project
- See: thedatahackr.com/posts/projects/music/how-i-recreated-pandora-on-spotify

**Option 4: Start fresh and train Spotify's algorithm (least effort, slowest)**
- Like your seed artists on Spotify, listen actively for a few weeks
- Use Spotify's Daily Mixes, Discover Weekly, and Blend features to build taste profiles
- Spotify will learn your preferences over time - no shortcut, but no migration headaches either

**Important caveats:**
- TuneMyMusic may no longer work with Pandora (reports of Pandora blocking API access as of mid-2025)
- Pandora limits display to 1,000 thumbed tracks, so very old stations may lose some history
- No tool transfers thumbs-down data - only thumbs-up/likes carry over

---

### Open Questions

No open questions blocking phase 1. All decisions have been made.

**Deferred (future phases):**
- **Now Playing auto-show behavior:** When music auto-interrupt is added in a future phase, what are the exact rules? (Auto-switch to Now Playing when music starts? Only from Photos, or also from no-timer Today? What happens when music stops?)

Note: The following are configurable via the Settings page and don't need to be decided upfront: Immich source/album selection, Google Calendar(s) to show (future), school departure time, weather thresholds, Sonos room name.
