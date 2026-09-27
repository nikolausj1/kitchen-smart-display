---
title: "Today layouts - Board, Briefing, Ambient, Entry board, Flip clock"
created: 2026-09-04
modified: 2026-09-27
version: 1.4
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, kitchen, today, layouts, panels, board, briefing, ambient, entry, flip-clock, layout-spec, weather-panels, countdowns, calendar-views, blocks, clocks, shape]
---

# Today layouts

How the web app renders the Today screens beyond the original Framed one, and
how to add another. Board, Briefing and Ambient were built overnight
2026-09-03/04 from the ideas sourced from Theatrium (BACKLOG Decisions Log
2026-08-31); review artifacts: `_review/today-layouts/`. Since then: the Entry
board (2026-09-24, `entry-board.md`); the Board and the Entry board drawn from
a per-screen layout spec that the layout editor edits (2026-09-24,
`layout-editor.md`); the Flip clock (2026-09-24, below); and five more
panel types for the spec layouts, four weather panels and a single
countdown, with the screens' weather now from the hub's feed (2026-09-26,
`panels-and-controls.md`, chunk 2); and ten more on 2026-09-27, four
calendar views and six blocks and clocks, the shape a block like text and
image (`panels-and-controls.md`, chunks 3 and 4).

## The one decision that shaped everything

Panels are pure presentational components, layouts are compositions, and one
hook feeds them. `views/TodayLayouts/`:

    tokens.css                theme variables + base classes; every panel reads ONLY these
    registry.js               layout ids and labels (plain data, imported by Settings)
    TodayLayoutSwitch.jsx     id -> component; 'framed' renders the untouched views/TodayView
    layoutSpec.js             the layout spec: types, the two default boards, normalizeSpec, day parts (pure)
    editBridge.js             the app's half of the layout editor's message channel
    lib/format.js             time / date / data-age formatting shared by all panels
    lib/sun.js  lib/wear.js   moon phase, sun progress, what-to-wear rule (pure functions)
    lib/agenda.js             agenda and countdown helpers for the Entry board (pure)
    lib/lumaSampler.js        how bright a photo is, cell by cell (the Entry backdrop)
    lib/backdropLuma.js       adaptive darkness from that grid (pure; backdropLuma.test.mjs)
    lib/weatherPanels.js      the weather panels' parts: hours, curve, rain, alerts (pure; weatherPanels.test.mjs)
    lib/tileColor.js          an art-above countdown card's colour: marker, art, calendar (tileColor.test.mjs)
    lib/calendarViews.js      the calendar views' parts: up next, the grids, the shared options, the window (calendarViews.test.mjs)
    lib/clocks.js             the clocks' parts: time zones and offsets, hand angles, the flip clock's fit (clocks.test.mjs)
    lib/dates.js              the date formats and the day counts: ISO week, day of the year, school days (dates.test.mjs)
    data/useTodayData.js      THE hook: composes every existing hook + useDailyForecast + demo fixtures
    data/useDailyForecast.js  current, 7 days, sunrise/sunset from the hub's weather feed (Open-Meteo as fallback)
    data/demo.js              ?demo=1 fixtures (only fill what live data leaves empty; ?demoWeather=1 forces the weather)
    data/demoMode.js          the demo switch as a store (?demo=1, or the editor's Sample data)
    data/wmo.js               WMO weather-code lookups (mirrors hooks/useWeather.js)
    panels/PanelFrame.jsx     shared chrome: optional label row + body
    panels/FreshnessStamp.jsx "just now" / "3 min ago" / "as of 12:36 pm"
    panels/schemas.js         every panel's knobs, as plain data (the layout editor's inspector)
    panels/<Name>Panel.jsx    Clock, WeatherNow, Forecast, Hourly, Conditions, Precip, Alert, SunMoon,
                              WhatToWear, Departure, NowPlaying, Photo, School, Agenda, Countdowns,
                              Countdown, Headline, UpNext, DayList, WeekGrid, MonthGrid, FlipClock,
                              AnalogClock, SecondClock, Date, DayCount; also AirQualityChip,
                              TextBlock, ImageBlock, ShapeBlock (the shape), CountdownCard (the
                              art-above card), CalendarParts (the calendar views' colour bar, dot
                              and legend), WeatherAttribution (Apple's mark)
    Board/  Briefing/  Ambient/   one <Name>Layout.jsx + .css each
    Entry/                    EntryLayout, EntryBackdrop, SpecBoard (draws any spec layout),
                              SpecPanel (one box)
    Clock/                    ClockLayout, FlipClock

A layout calls `useTodayData()` once and hands slices to panels. Because panels
never touch data or hardcode a colour, the same Clock renders on the dark Board
and the cream Briefing; a layout sets its palette by overriding the `--tl-*`
variables on its root element. The one exception is the Flip clock, which
needs no data at all (below).

## Selection

`display.todayLayout` in the settings store, DEVICE scope, default `'framed'`,
so each screen keeps its own choice through the hub's per-device config:
`framed`, `board`, `briefing`, `ambient`, `entry` (Entry board) or `clock`
(Flip clock). Settings > Today screen > Layout, or the dashboard's Today
layout select. `?layout=<id>` in the URL previews one for that page load
without saving it (`lib/kioskMode.js` `REQUESTED_LAYOUT`).

## The data contract

`useTodayData()` returns `{ now, demo, greeting, settings, weather, moon, school,
timer, wear, music, photos, calendar, agendaDays, countdowns, headline,
airQuality, weatherAlerts, schoolCalendar }`; the exact field list is documented at the top
of `useTodayData.js` (calendar through airQuality are the Entry board's,
`entry-board.md`; weatherAlerts feeds the `alertActive` visibility rule).
Since 2026-09-26 `weather` also carries the hub's whole weather feed for the
weather panels (`source`, `hourly` from local midnight, `daily`,
`nextHour`, `alerts`, `sun`, `moon`, `attribution`), and its `current`
gains humidity, dew point, gusts, wind direction, pressure, visibility, UV
and cloud cover (`panels-and-controls.md`, chunk 2). Since 2026-09-27
`calendar` also carries `range`, the dates the hub's answer covers (a
calendar view never calls a day outside it empty), and `schoolCalendar` is
the hub's `/api/schoolcal`, for the day count's school days
(`panels-and-controls.md`, chunks 3 and 4). Three things worth knowing:

- `now` ticks at 1 Hz; every other object is memoised on its real inputs so a
  tick does not churn identities. PhotoPanel is `React.memo` and keeps its
  timers in refs so a parent re-render never restarts a crossfade (the failure
  mode behind the 2026-08-24 frozen slideshow).
- It posts no timer state. Since 2026-09-24 the countdown is shared through
  the hub: screens write only decisions, every screen derives the timer with
  `frameserver/lib/countdown.mjs`, and the hub derives the Apple TV's copy with
  the same code, so no layout can fight over what the TV shows.
- `?demo=1` fakes a Sonos track, a lunch, two activities, an 18-minute
  countdown, calendar events, countdowns, a headline and an air quality
  reading; weather and photos stay live unless the live fetch has nothing
  (the demo weather is a whole hub feed, with rain in the next hour and a
  wind advisory; `?demoWeather=1` shows it over live weather). The layout
  editor's Sample data flips the same switch (`data/demoMode.js`).

## Rules the panels live by

- Size with `clamp()` / `vw` / `vh` / container-query units, never px. Every
  panel body is `container-type: size`, so **a layout must give each panel a
  definite track** (`minmax(0, 1fr)`, fixed `vh`); an `auto` track collapses
  the type to its clamp floor.
- Honest empty states, never invented numbers: "Nothing playing", "No forecast
  yet", "No photos".
- Values carry their age via `FreshnessStamp`; the hooks now expose `fetchedAt`.
- In a spec layout a panel also takes `knobs` (its schema's values,
  `panels/schemas.js`); handed none, as on Briefing and Ambient, it renders
  exactly as it always has.
- The project's lint runs the React Compiler rules: no `Date.now()` /
  `new Date()` / `Math.random()` in render (PhotoPanel's shuffle is seeded for
  exactly this reason), no `ref.current` reads in render, and do not build an
  object literal with a key named `current` and then read from it.

## The compositions

- **Board** (`tl-board`): the dark bento board. Clock 1-4/1-3 (weight 600,
  the greeting as its label), WeatherNow 5-8/1-3 (stacked), Photo 9-12/1-4,
  Forecast 1-4/4-6 (four days), SunMoon 5-8/4-5, WhatToWear 5-8/6, and bottom
  right (9-12/5-6) Now Playing, which gives its box to the live departure
  countdown while one runs. Seven panels is what fits at 1280x800 with these
  minimums; lunch/activities are not on the Board by default. Built as a
  12x6 grid (rows `repeat(5, minmax(0,1fr)) minmax(0,1.3fr)`); since
  2026-09-24 drawn from a layout spec measured from that grid (below).
- **Briefing** (`tl-briefing`): cream paper, Fraunces (the `full` variable cut,
  so `opsz` and `SOFT` engage) for display sizes, Inter for body, no surfaces,
  hairline rules. Left 58%: masthead (house name constant + greeting), clock at
  ~30vh, Now Playing at the foot. Right 42%: weather, forecast, Departure when a
  countdown runs else School, sun and moon. Band colours are re-inked for paper.
- **Ambient** (`tl-ambient`): full-bleed PhotoPanel, caption and counter moved
  to the top corners, HUD along the bottom inside a 3vw/3vh margin: time, date,
  greeting left; weather and the "next thing" (countdown, leave-by, or first
  activity) right; a Now Playing chip centre only while playing or paused.
- **Entry board** (`tl-entry`, 2026-09-24): the front-door board on the Echo
  Show 15: clock, headline, weather, what to wear, air quality, a multi-day
  agenda and countdown tiles (the departure countdown takes their box on a
  school morning) over the photo backdrop. Drawn from a layout spec, with
  day-part variants. Design: `entry-board.md`.
- **Flip clock** (`tl-clock`, 2026-09-24): a split-flap clock and the date,
  nothing else. Below.

## Spec-drawn layouts: the Entry board and the Board

Both are drawn by `Entry/SpecBoard.jsx` from a layout spec (`layoutSpec.js`):
inside the layout editor, the editor's draft; else the screen's own
`config.layouts.entry` or `config.layouts.board` from the hub; else the
built-in `DEFAULT_ENTRY_SPEC` or `DEFAULT_BOARD_SPEC`. Each panel is a box at
a percent position (`Entry/SpecPanel.jsx`, `container-type: size`), so a
board drawn at 1920x1080 lands in the same place at 1280x800. Each functional
panel gets its knobs; `spec.global` sets the display font, accent, text
colour, card opacity and corner radius as variables on the root; cards
stacked flush draw as one card divided by hairlines. The default specs
reproduce the old grids: the Board exactly at 1280x800 (the Echo Show 10),
the Entry board at 1920x1080 (the Echo Show 15), each within a few pixels at
the other size. The departure countdown borrows the countdowns box on a
school morning and the now-playing box while a countdown runs, unless the
layout has a departure panel of its own. The layout component still calls
`useTodayData()` once and hands the result to `SpecBoard`; the Entry board
adds its backdrop (`EntryBackdrop`) as SpecBoard's child. The spec, the knobs
and the editor: `layout-editor.md`.

Beyond the two boards' own panels, a spec layout can take, through the
editor: the weather panels (Hourly forecast, Conditions, Rain chance,
Weather alert) and the single Countdown since 2026-09-26; the calendar
views (`upnext` Up next, `daylist` Day list, `weekgrid` Week grid,
`monthgrid` Month grid) and the clocks and dates (`flipclock` Flip clock,
`analog` Analog clock, `clock2` Second clock, `date` Date, `daycount` Day
count) since 2026-09-27, each at most once per layout; and, besides text
and image blocks, any number of `shape` blocks (Add shape), since
2026-09-27. None is on a default board. Knobs, elements and starting boxes:
`panels-and-controls.md`, chunks 2 to 4.

## Flip clock (built 2026-09-24, full width 2026-09-25)

A split-flap clock as wide as the screen allows, with the date along the
bottom edge, on near-black with a faint warm lift and a vignette. Built for
the office Echo Show 5 (960x480; its Today layout as of 2026-09-25) and good
at 1280x800 and 1920x1080. Drawn after Justin's reference image of 2026-09-24
(`_inbox/clocks/`). On 2026-09-25, at Justin's request, the clock went full
width, the AM/PM tab came off, and the date went a size up onto the bottom
edge with its hairlines dropped.

- `Clock/FlipClock.jsx` + `.css`, reusable. Props: `now` (a Date, the only
  clock it reads), `hour24` (00 to 23 and no AM/PM tab; default off),
  `showMeridiem` (the AM/PM tab on a 12-hour clock; default on; the aria
  label keeps AM/PM either way) and `showDate` (default on). One wide hour
  card, a colon, two minute cards, an AM/PM tab on the hour card's left edge,
  the date underneath. No time shows dashes, never a made-up hour.
- Sizing: every width, radius, font size and offset is a multiple of one
  variable, `--tl-flip-u`, the card height. FlipClock's default,
  `min(46vh, 26vw)`, is a centred clock with its tab: 46vh puts the clock at
  about 55% of the screen height at 16:9 and 2:1; 26vw keeps about 6% of air
  each side at 16:10, where the height alone would run it to the edges. A
  host overrides that one variable (a box would use container units) and
  nothing else changes.
- The Clock layout's size, `min(30vw, 76vh)`: with no tab the card row is
  3.16u wide (about 3.19u with the case's lip), so at 2:1 and 16:9 the width
  runs out long before the height. 30vw puts the row across about 96% of the
  width: on the Echo Show 5 a 288px card (60% of the screen height) and
  numerals about 203px tall, up from about 155px. 76vh caps it on a screen
  wider than about 2.5:1 and still leaves the date its band.
- The flip: each card is two static halves plus, only while it flips, one
  leaf (the old top on its front, the new bottom on its back) that turns down
  about the split line in 600 ms. Only transform and opacity animate and
  nothing changes size, so a flip never touches layout; cards are memoised.
  On mount the cards flip in from blank, left to right, a beat apart.
  `prefers-reduced-motion` cuts the flip to an instant.
- `Clock/ClockLayout.jsx` + `.css`: root `tl-root tl-clock` (its selectors
  are always `.tl-root.tl-clock`, because ClockPanel's root carries
  `tl-clock` too). It runs its own minute timer, waking a hair after each
  minute boundary and again when the page becomes visible, and calls no
  `useTodayData()`: a clock needs none of the data sources, which on an Echo
  Show 5 would be real polling for nothing. No seconds and no drift (the night
  face is a different screen). It passes `showMeridiem={false}`, runs the
  clock the full screen height, centres the cards in the space above the date
  (auto margins) and sets the date at 0.085u (24px on the Echo Show 5, was
  14px), 0.045u off the bottom edge.
- Wired in `registry.js` (`clock`, "Flip clock"), `TodayLayoutSwitch.jsx` (a
  static import), `lib/kioskMode.js` `VALID_LAYOUTS` and the dashboard's Today
  layout select; Settings lists it from the registry.
- Decisions: tabular numerals in Inter 800 (the heaviest cut, one more latin
  face; a rule asking for 800 without it silently renders 700), so the "1"
  has its foot; cards wider than the reference's so Inter's wider digits stay
  as tall (cap height 0.68 of the card); the AM/PM plate flips too, split on
  a hairline; the date line in Fraunces, tracked capitals with lining
  figures; grain on the cards only; no flex `gap`, `inset` or `aspect-ratio`,
  because Silk on the Echo Shows is an older Chromium (the build targets
  Chrome 80). On the Clock layout, no AM/PM and numerals as big as the width
  allows (2026-09-25). Filling the height too would take narrower, condensed
  digits, like the reference's, which means a new font; not taken up.
- Review shots: `_review/layout-editor/clock-*.png` (960, 1280 and 1920 wide,
  mid-flip frames, and the reference's 10:08 for comparison);
  `clock-960-fullwidth.png` and `clock-960-before-after.png` for the
  2026-09-25 change.
- A panel too since 2026-09-27: `flipclock` ("Flip clock",
  `panels/FlipClockPanel.jsx`) puts this component in a box of a spec
  layout, as big as the box allows, `--tl-flip-u` worked out from the box
  (container units, else a measured box), with its own `hour24`,
  `showMeridiem`, `showDate` and `scale` knobs. FlipClock gained
  `data-edit` markers (hour, minutes, tab, date); the Flip clock layout
  draws exactly as before. `panels-and-controls.md`, chunk 4; shots
  `_review/layout-editor/blocks-flipclock-*.png`.

## Adding a layout or a panel

Layout: one folder with `<Name>Layout.jsx` (default export, no props, one
`useTodayData()` call, root `tl-root tl-<name>`) and `.css`; add the id to
`registry.js` and the component to `TodayLayoutSwitch.jsx`, to
`VALID_LAYOUTS` in `lib/kioskMode.js`, and to the dashboard's Today layout
select (`frameserver/admin.html`). Panel: `panels/<Name>Panel.jsx` + `.css`,
props in, `PanelFrame` around it, tokens only.

A spec-drawn layout renders `<SpecBoard d={d} layoutId="<id>" />` (as
`Board/BoardLayout.jsx` does) and needs its default panels and canvas in
`layoutSpec.js` (`LAYOUTS`, `LAYOUT_IDS_SPEC`) and a row in the editor's
`LAYOUTS` (`editor/spec.js`). A new panel type for the spec layouts needs a
row in `layoutSpec.js` `TYPE_TABLE` (label, minimum box, `minPx`, starting
box), its knobs and sub-elements in `panels/schemas.js` (`PANEL_SCHEMAS`,
`PANEL_ELEMENTS`, with `data-edit` on the elements), a case in `SpecBoard`'s
`content()`, and its `minPx` as a container query in `Entry/SpecPanel.css`
(or in its own stylesheet, as the calendar views keep theirs). A new block
type is a `TYPE_TABLE` row of `kind: 'block'`, which puts it in
`BLOCK_TYPES`. The editor learns new types, and which of them are blocks,
from the app's `sd-edit:ready` (since 2026-09-27; `layout-editor.md`, "As
built, chunk 4 and the shape block").

## Verifying without touching the kitchen

Run the dev server and load `http://localhost:5173/?device=dev-mac&layout=board`.
The `?device=` id is remembered per origin and routes all hub writes to a
scratch device record, never the kitchen's. For pixel-exact screenshots at the
panel sizes, puppeteer-core driving the installed Chrome works with no browser
download (the harness used for the review shots is described in
`_review/today-layouts/README.md`). For a pixel diff between two builds,
freeze the clock, seed `Math.random`, serve one fixed photo for every photo
URL, and throw the first shot away: Chrome rasterises a large photo in two
different ways between launches, which otherwise reads as a change.

## Open

- Apple TV port of whichever layout wins (React first was the plan).
- Auto-select by time of day (Framed inside the school window, a layout after),
  reusing the latch in `tvos/Sources/RootView.swift` on the TV and the
  schedule watchers in `AppShell.jsx` on the kitchen. Within one layout, the
  Entry board's day-part variants (morning, evening, weekend) now cover part
  of this, and `display.homeView` lets a screen rest on Today.
- House name as a setting; a Briefing-safe weather icon set; Forecast tile
  spacing; the Board's lunch tile (a School panel can now be added to it in
  the layout editor). Tracked in BACKLOG.
- A next-meeting line with the flip clock. The flip clock itself became a
  panel for the spec layouts on 2026-09-27 (`flipclock`; "Flip clock",
  above).
