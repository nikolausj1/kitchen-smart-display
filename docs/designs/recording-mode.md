---
title: "Recording mode - public-safe Today view for screen recordings"
created: 2026-11-08
modified: 2026-11-08
version: 1.0
author: Claude Sonnet 5.5 (claude-sonnet-5-5)
tags: [design, today, demo, recording, portfolio, fixtures, privacy]
---

# Recording mode

`?record=1` turns the web app into something that can be screen-recorded and
published: entirely fictional data, a countdown that turns yellow seconds
after load, and no network at all. Built 2026-11-08 for the project vignette
on justinnikolaus.com.

## The URL

Start the dev server (`npm --prefix code run dev`, port 5173) and open:

    http://localhost:5173/?record=1&view=today

That is the Framed Today view (the kitchen's default): clock, weather slots,
lunch and activities, and the "Leave in N min" panel. It starts green at
8 min, and about 4 seconds after load the clock rolls to 7:35 and the panel
turns yellow at 7 min. Any other Today layout takes `&layout=`:

    &layout=board | briefing | ambient | entry | clock

`&view=photos` shows the slideshow over generated placeholder photos.

## Parameters

| Parameter | Default | Effect |
|---|---|---|
| `record=1` | off | The switch. Implies `demo=1`. |
| `yellowIn=N` | 4 | Seconds after load until the countdown goes green to yellow. |
| `travel=walking` | driving | Leave time 7:32 (walking) instead of 7:42 (driving). |
| `date=YYYY-MM-DD` | today if Mon-Fri, else next Monday | The fixture day. Must be a school day or the no-school layout shows. |
| `at=HH:MM:SS` | derived from `yellowIn` | Start the fixture clock here instead (overrides `yellowIn`). `at=07:35:20` is a still frame of yellow. |
| `layout=` | saved setting (framed) | Which Today layout. |

Bands (`timerThresholds`): green above 7 min, yellow 5 to 7, orange 1 to 4,
red at 0. With the default clock, orange arrives about 3 minutes after yellow;
for a still of orange or red use `at=07:38:30` or `at=07:42:05`.

## How it works

- **Fixture clock** (`code/src/lib/recordMode.js`). `window.Date` is replaced
  so "now" is a fixed day and time that then ticks in real time. Everything
  that reads the clock (the big clock, greeting, sky, calendar days, and the
  real countdown derivation in `frameserver/lib/countdown.mjs`) agrees with
  itself, so the yellow is the real band logic, not a painted state. `localStorage`
  is swapped for an in-memory copy for the page's life, so a browser that has
  shown the real house cannot leak its cached settings (real depart times,
  kids) into a recording, and fixture data is not left behind afterwards.
- **Offline fixture hub** (`code/src/lib/recordNetwork.js`). `window.fetch`
  answers the paths the Today view reads from fixtures: `/api/weather`
  (`demoFeed`), `/stub-photos/manifest.json` (`demoPhotos.js`), `/api/calendar`,
  `/api/schoolcal`, `/api/state` (no decisions, the travel mode from the URL,
  a school day). Everything else that would leave the page (the real hub,
  Open-Meteo, Sonos, settings writes) is refused in the browser with a plain
  network error that the hooks already treat as "offline". Dev-server files
  pass through. No request reaches the house or the internet.
- **Fixtures** (`code/src/views/TodayLayouts/data/demo.js`, `demoPhotos.js`).
  `demo.js` was sanitized IN PLACE: plain `?demo=1` is now public-safe too, so
  there is no unsafe fixture left to select by mistake. `?record=1` adds only
  the clock, the offline hub and the generated photos on top.

## The fictional cast

Calendars Alex and Jordan; children Milo and Theo; friends Casey and Rosa; the
Okafors; Willowbrook Elementary School; places on Cedar Park Rd, Quay St,
Orchard Ln, Fern St, Linden Way, Market Sq in the invented town of Maple
Harbor; Briefing masthead "Maple House". Photos are generated sky-and-hills
SVGs (`demoPhotos.js`). Keep new fixtures to this cast. Do not paste real
calendar titles, names or addresses into `demo.js`.

## What changes on screen during a clip

- The countdown band, green to yellow (the point). The clock minute rolls over
  at the same instant (7:34 to 7:35), which reads as a nice beat.
- Not built, available if wanted: a music track change (the demo track's
  elapsed time advances but it never changes track), a weather refresh (the
  fixture feed is refetched every poll but is identical), and orange or red
  within a clip (use `at=`).

## Known limits

- Real names remain in non-demo code paths only: the Briefing masthead
  constant (`BriefingLayout.jsx`, replaced by "Maple House" in demo and
  record mode) and the `Lawton` lunch-school default in `lib/settings.js` /
  `SettingsView.jsx` (a Settings field, never drawn on a Today screen, and no
  request carries it under `?record=1`). `config.js` and `settings.js` also
  hold the house's real coordinates; nothing prints them.
- The Settings, Music (Now Playing) and Plex views were not audited for
  recording; use the Today layouts and the slideshow.
- The HA demo entity ids were renamed (`person.alex`, `person.jordan`); a layout
  saved in the editor against `person.justin` shows that chip as missing in
  sample data.
- `?record=1` is for a laptop. Never put it in a kiosk URL: it freezes the
  clock to a fixture and blocks the hub.
