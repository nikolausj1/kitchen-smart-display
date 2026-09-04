---
title: "Today layouts - Board, Briefing, Ambient"
created: 2026-09-04
modified: 2026-09-04
version: 1.0
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, kitchen, today, layouts, panels, board, briefing, ambient]
---

# Today layouts

How the kitchen app renders a second, third and fourth Today, and how to add a
fifth. Built overnight 2026-09-03/04 from the ideas sourced from Theatrium
(BACKLOG Decisions Log 2026-08-31). Review artifacts: `_review/today-layouts/`.

## The one decision that shaped everything

Panels are pure presentational components, layouts are compositions, and one
hook feeds them. `views/TodayLayouts/`:

    tokens.css                theme variables + base classes; every panel reads ONLY these
    lib/format.js             time / date / data-age formatting shared by all panels
    lib/sun.js  lib/wear.js   moon phase, sun progress, what-to-wear rule (pure functions)
    data/useTodayData.js      THE hook: composes every existing hook + useDailyForecast + demo fixtures
    data/useDailyForecast.js  second Open-Meteo call: current, 5 days, sunrise/sunset (cached 12h)
    data/demo.js              ?demo=1 fixtures (only fill what live data leaves empty)
    panels/PanelFrame.jsx     shared chrome: optional label row + body
    panels/FreshnessStamp.jsx "just now" / "3 min ago" / "as of 12:36 pm"
    panels/<Name>Panel.jsx    Clock, WeatherNow, Forecast, SunMoon, WhatToWear, Departure, NowPlaying, Photo, School
    Board/  Briefing/  Ambient/   one <Name>Layout.jsx + .css each
    registry.js               layout ids and labels (plain data, imported by Settings)
    TodayLayoutSwitch.jsx     id -> component; 'framed' renders the untouched views/TodayView

A layout calls `useTodayData()` once and hands slices to panels. Because panels
never touch data or hardcode a colour, the same Clock renders on the dark Board
and the cream Briefing; a layout sets its palette by overriding the `--tl-*`
variables on its root element.

## Selection

`display.todayLayout` in the settings store, DEVICE scope, default `'framed'`,
so each screen keeps its own choice through the hub's per-device config.
Settings > Today screen > Layout. `?layout=<id>` in the URL previews one for
that page load without saving it (`lib/kioskMode.js` `REQUESTED_LAYOUT`).

## The data contract

`useTodayData()` returns `{ now, demo, greeting, settings, weather, moon, school,
timer, wear, music, photos }`; the exact field list is documented at the top of
`useTodayData.js`. Three things worth knowing:

- `now` ticks at 1 Hz; every other object is memoised on its real inputs so a
  tick does not churn identities. PhotoPanel is `React.memo` and keeps its
  timers in refs so a parent re-render never restarts a crossfade (the failure
  mode behind the 2026-08-24 frozen slideshow).
- It never calls `postTimerState`. The Framed Today remains the single
  authority that mirrors the countdown to the Apple TV.
- `?demo=1` fakes a Sonos track, a lunch, two activities and an 18-minute
  countdown; weather and photos stay live unless the live fetch has nothing.

## Rules the panels live by

- Size with `clamp()` / `vw` / `vh` / container-query units, never px. Every
  panel body is `container-type: size`, so **a layout must give each panel a
  definite track** (`minmax(0, 1fr)`, fixed `vh`); an `auto` track collapses
  the type to its clamp floor.
- Honest empty states, never invented numbers: "Nothing playing", "No forecast
  yet", "No photos".
- Values carry their age via `FreshnessStamp`; the hooks now expose `fetchedAt`.
- The project's lint runs the React Compiler rules: no `Date.now()` /
  `new Date()` / `Math.random()` in render (PhotoPanel's shuffle is seeded for
  exactly this reason), no `ref.current` reads in render, and do not build an
  object literal with a key named `current` and then read from it.

## The three compositions

- **Board** (`tl-board`): 12x6 grid, rows `repeat(5, minmax(0,1fr)) minmax(0,1.3fr)`.
  Clock 1-4/1-3, WeatherNow 5-8/1-3, Photo 9-12/1-4, Forecast 1-4/4-6, SunMoon
  5-8/4-5, WhatToWear 5-8/6, and bottom-right (9-12/5-6) the live countdown
  while `timer.mode === 'active'`, Now Playing otherwise. Seven panels is what
  fits at 1280x800 with these minimums; lunch/activities are not on the Board.
- **Briefing** (`tl-briefing`): cream paper, Fraunces (the `full` variable cut,
  so `opsz` and `SOFT` engage) for display sizes, Inter for body, no surfaces,
  hairline rules. Left 58%: masthead (house name constant + greeting), clock at
  ~30vh, Now Playing at the foot. Right 42%: weather, forecast, Departure when a
  countdown runs else School, sun and moon. Band colours are re-inked for paper.
- **Ambient** (`tl-ambient`): full-bleed PhotoPanel, caption and counter moved
  to the top corners, HUD along the bottom inside a 3vw/3vh margin: time, date,
  greeting left; weather and the "next thing" (countdown, leave-by, or first
  activity) right; a Now Playing chip centre only while playing or paused.

## Adding a layout or a panel

Layout: one folder with `<Name>Layout.jsx` (default export, no props, one
`useTodayData()` call, root `tl-root tl-<name>`) and `.css`; add the id to
`registry.js` and the component to `TodayLayoutSwitch.jsx`, and to
`VALID_LAYOUTS` in `lib/kioskMode.js`. Panel: `panels/<Name>Panel.jsx` + `.css`,
props in, `PanelFrame` around it, tokens only.

## Verifying without touching the kitchen

Run the dev server and load `http://localhost:5173/?device=dev-mac&layout=board`.
The `?device=` id is remembered per origin and routes all hub writes to a
scratch device record, never the kitchen's. For pixel-exact screenshots at the
panel sizes, puppeteer-core driving the installed Chrome works with no browser
download (the harness used for the review shots is described in
`_review/today-layouts/README.md`).

## Open

- Apple TV port of whichever layout wins (React first was the plan).
- Auto-select by time of day (Framed inside the school window, a layout after),
  reusing the latch in `tvos/Sources/RootView.swift` on the TV and the
  schedule watchers in `AppShell.jsx` on the kitchen.
- House name as a setting; the Board's missing lunch tile; a Briefing-safe
  weather icon set; Forecast tile spacing. Tracked in BACKLOG.
