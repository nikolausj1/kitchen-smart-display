---
title: "Entry board - the front-door Today layout, calendar, countdowns, headline"
created: 2026-09-24
modified: 2026-09-24
version: 1.2
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, entry, echo-show, today, layouts, calendar, google-calendar, countdowns, headline, weather, nws, frameserver]
---

# Entry board

**Status: phase 1 built and deployed 2026-09-24**, live on the Echo Show 15 as
its home view. Justin's calendar is connected; Sheena's waits on her sharing
it. **Headline weather rules (phase 1.5) built 2026-09-24, not yet deployed**
(see "Headline rules" below). Review shots: `_review/entry/`.

The Echo Show 15 by the front door replaces the DAKboard screen the family
used to glance at: time, weather, agenda, countdowns, a message line. Rebuilt
as a Today layout on the hub-only architecture (`echo-show-and-hub.md`), so
the same screen can later run on the kitchen or a ROADOM.

## Decisions (Justin, 2026-09-24)

- Google Calendar through a **service account** (his and Sheena's calendars
  shared to it, read-only). No OAuth consent flow, no token expiry.
- **Countdowns are marked by hand** in an event's description, never picked
  automatically: `countdown` (30 days by default), `countdown 14`,
  `countdown = 14 days`, `countdown: 2 weeks`; optional `label: ...` and
  `image: <name>`; an emoji in the title is a fallback icon.
- **Countdown art is an Immich album, "Countdown Art"**: PNGs with
  transparent backgrounds (backpacks, cakes, cabins, planes, state shapes,
  faces). The hub syncs the originals hourly; keywords come from the file name
  and the asset's description in Immich; explicit `image:` wins.
- **Headline**: one dynamic line, rules over live data, phase 1 = next timed
  event today, else an all-day event today, else (evenings) tomorrow's first
  thing, else a day-part greeting. Phase 1.5 (built 2026-09-24) adds the
  weather: National Weather Service warnings above everything, advisories and
  forecast lines (rain, frost, wind, heat, cold) above everything but an event
  that is running or inside the hour. See "Headline rules" below.
- **Photos behind the board**, with a per-screen toggle and a darkness
  slider. Phase 1 is a flat wash; 1.5 adds scrims, cards and per-photo
  brightness.
- **Phase 1** = the DAKboard equivalent plus the departure countdown and
  what-to-wear during the school-morning window. **Phase 2** = the layout
  adapts to the day part (evening shows tomorrow, weekends widen the agenda,
  night hands over to the clock).
- Agenda: three day columns (today, tomorrow, the day after).
- The Echo 15 rests on this view all day: a per-screen home view.

## Hub

### Secrets and config

`server.mjs` reads `.env` in the service root at startup (a tiny parser; the
build script already uses it via `--env-file`). Keys used: `IMMICH_URL`,
`IMMICH_API_KEY` (existing), `GOOGLE_CALENDAR_KEY_FILE` (default
`secrets/google-calendar.json`, the service account JSON), and for tests
`GOOGLE_CALENDAR_FIXTURE` (a JSON file of normalized events served instead of
calling Google). `secrets/` is created on deploy and never committed. The
weather needs no key (Open-Meteo, the NWS); `NWS_ALERTS_FIXTURE` (a saved
alerts response, relative to the service root) replaces the NWS for tests and
scratch previews and is never set on the NUC.

Registry, house-wide (`shared.calendar`, editable on the dashboard):

```
calendar: {
  calendars: [ { id: 'justin@...', label: 'Justin', color: '#e0457b' },
               { id: 'sheena@...', label: 'Sheena', color: '#4a90e2' } ],
  countdownLeadDays: 30,
  countdownMax: 3,
}
```

### `GET /api/calendar?days=3`

```
{
  connected: bool,           // key file present and the last fetch succeeded
  error: string | null,
  fetchedAt: ISO | null,
  days: 3,
  serviceAccount: 'frameserver@...iam.gserviceaccount.com' | null,   // the address to share with
  calendars: [{ id, label, color, ok, error, events }],               // per-calendar health
  events: [ { id, calendarId, calendarLabel, color, title, description, location,
              allDay, start, end, startDate, endDate, status } ],
  countdowns: [ { id, title, date: 'YYYY-MM-DD', daysLeft, leadDays,
                  image: '/countdown-art/<file>' | null, emoji: string | null,
                  calendarLabel, color } ]
}
```

- `events` covers today through today + days - 1 (local), sorted by start;
  all-day events with `startDate` / `endDate` (exclusive, Google's convention)
  and `start` / `end` null; timed events with ISO `start` / `end` and
  `startDate` = the local date of `start`. Recurring events arrive already
  expanded (`singleEvents=true`). Cancelled instances are dropped.
- `countdowns` scans a wider window (60 days) for events whose description
  carries the marker, keeps those with `0 <= daysLeft <= leadDays`, sorts by
  date, caps at `countdownMax`. Multi-day events count to the start.
- Google is fetched at most every 5 minutes (per process cache, plus a disk
  cache `calendar-cache.json` so a restart serves the last copy at once).
  Authentication: a JWT signed RS256 with Node's `crypto` (no dependency),
  scope `https://www.googleapis.com/auth/calendar.readonly`, exchanged at
  `https://oauth2.googleapis.com/token`, the access token cached until it
  expires.

### Countdown art

`lib/countdownArt.mjs`: hourly (and on `POST /api/countdown-art/refresh`),
find the Immich album named "Countdown Art" (case-insensitive), download each
asset's original into `countdown-art/` as `<assetId>.<ext>`, write
`countdown-art/index.json`:

```
[ { id, file, name: 'airplane', keywords: ['airplane', 'flight', 'fly', 'airport'], updatedAt } ]
```

`name` is the original file name's stem, lowercased, without extension;
`keywords` = the stem plus the words of the asset's Immich description
(`exifInfo.description`), split on commas and whitespace, lowercased, deduped.
Assets removed from the album are removed from the folder. `GET
/api/countdown-art` returns the index; `GET /countdown-art/<file>` serves the
file (long cache, the id is immutable).

Matching, in `lib/countdowns.mjs` (pure): `image: <name>` in the description
matches a `name` (case-insensitive, extension optional); otherwise the first
art entry, longest matching keyword first, whose keyword appears as a whole
word in the lowercased event title; otherwise null (the tile shows the
emoji, or a calendar glyph).

### Headline, weather alerts and air quality in `/api/state`

- `headline: { text, kind, eventId, until }` from `lib/headline.mjs` over the
  cached events, the hub's own forecast and the NWS alerts (below). Every
  screen shows the hub's line. `kind` is `alert` (an NWS alert, either tier),
  `now`, `soon`, `weather` (a forecast rule), `next`, `today`, `tomorrow` or
  `daypart`; `eventId` is the calendar event's id (null for weather and
  day-part lines); `until` is when the line may change on its own.
- `weatherAlerts: [ { event, severity, until, headline } ]`: the NWS alerts
  in force for `shared.location`, most severe first, then the earliest
  ending, one per event name, at most 3. `until` is the alert's end as the
  NWS sent it (`ends`, else `expires`, with its offset), null when it has
  neither. Empty outside the NWS area.
- `airQuality: { pm25, aqi, label, fetchedAt } | null`, Open-Meteo air
  quality (`https://air-quality-api.open-meteo.com/v1/air-quality` with
  `current=pm2_5,us_aqi`), refreshed hourly for `shared.location`. Labels by
  US AQI: 0-50 Good, 51-100 Moderate, 101-150 Unhealthy for sensitive groups,
  151-200 Unhealthy, 201-300 Very unhealthy, 301+ Hazardous.

`GET /healthz` carries `weather: { fetchedAt, error }` and `alerts: { count,
fetchedAt, error }` beside the air quality label.

### Headline rules

Highest priority first:

1. **Tier A weather**: an NWS alert that is Extreme or Severe, or any Warning
   ("Winter Storm Warning through Sat 6 am"). Several: the most severe, then
   the earliest ending.
2. A timed event running now: "Vinny soccer now".
3. The next timed event today, inside the hour: "Vinny soccer in 40 min".
4. **Tier B weather**: any other NWS alert (advisories, watches,
   statements), then the forecast rules in the order of the table below.
5. The next timed event today, later: "Vinny soccer at 5:00 pm".
6. An all-day event today: "Today: PJ and Stuffy day".
7. After 6 pm, tomorrow's first event: "Tomorrow: Sheena Chicago".
8. A day-part greeting ("Good morning, everybody.", ... "You're up late. Go
   to bed.").

With no forecast and no alerts (or nothing to say about them) the line is
exactly phase 1's; `frameserver/test/headline.test.mjs` pins it.

The weather rules (`lib/weatherRules.mjs`, pure; the thresholds are exported
constants and `frameserver/test/weatherRules.test.mjs` pins every boundary:
49 / 50 %, 34 / 35 F, 29 / 30 mph, 9 pm, 9 am, day boundaries):

| rule | runs | fires when | says | until |
|---|---|---|---|---|
| alert (A) | always | Extreme or Severe, or the event is a Warning | "Wind Advisory until 6 pm" (ends today), "... until midnight", "... through Sat 6 am" (a later day), "... from Fri 4 am" (onset still ahead), the event alone (no end) | the end; the onset while it is ahead |
| alert (B) | always | every other alert in force | the same words | the same |
| rain | before 9 pm; the hours from now to 9 pm | raining now: a precipitation code this hour, or >= 70 %. Else the first hour at >= 50 % or with a precipitation code | "Raining now, clearing by 5 pm" (the wet run ends before midnight), "Rain most of the day" (it does not); "Rain within the hour" (<= 60 min away); "Rain from 3 pm" | the clearing hour; 9 pm; the rain's start; an hour before it |
| frost | noon to midnight | the lowest hourly temperature from now until 9 am tomorrow <= 34 F (<= 20 F) | "Frost tonight" ("Hard freeze tonight") | 9 am tomorrow |
| wind | always | gusts >= 30 mph in the next 12 hours | "Windy morning" (peak 5 am to noon), "Windy afternoon" (noon to 6 pm), "Windy tonight" (6 pm to 5 am), "Windy tomorrow morning" when it is; "Very windy ..." at >= 45 mph | the end of the last gusty hour |
| heat | before 2 pm | today's high >= 90 F | "Hot one today, high of 94" | 2 pm |
| cold | before 10 am | this hour's feels-like <= 15 F | "Bitter cold this morning, feels like 3" | 10 am |

- Snow codes say Snow ("Snow from 3 pm", "Snowing now, clearing by 5 pm"),
  freezing drizzle and freezing rain say Freezing rain; a bare probability
  (no precipitation code) says Snow at 32 F or below.
- Whole degrees, rounded before any comparison (34.4 F frosts, 34.5 F does
  not); times in the house style, "3 pm", "6:30 am".
- A tier B line's `until` also comes forward to the moment the next event
  enters its hour, since the event takes the line back then.
- Units: the app has no units setting (it asks Open-Meteo for Fahrenheit and
  mph), so the hub asks for the same. `headlineFor` takes `units: 'metric'`
  for the day one exists; it changes only the quoted degrees.

Where the weather comes from (the hub, beside the air quality, for the same
`shared.location`, refetched within a minute of a location change):

- `lib/hubWeather.mjs`: Open-Meteo `/v1/forecast` in Fahrenheit, mph and
  inches, `timezone=auto`; 48 hourly entries from the current hour
  (`temperature_2m, apparent_temperature, precipitation_probability,
  precipitation, weather_code, wind_gusts_10m, wind_speed_10m`) and 3 days
  (`temperature_2m_max, temperature_2m_min, precipitation_probability_max,
  weather_code, sunrise, sunset`). Every 30 minutes (5 after a failure), one
  fetch at a time, cached in `weather-cache.json` in the service root so a
  restart serves the last copy. A forecast older than 12 hours, or for
  another location, is not used. Open-Meteo stamps the precipitation
  probability, the precipitation, the weather code's rain and the gusts at
  the END of their hour ("preceding hour"); the hub moves them to the hour's
  start, so Open-Meteo's 15:00 at 60 % is rain between 2 and 3 pm and the
  board says "Rain from 2 pm". (The screens' own hourly strips still label
  that entry 3 PM.)
- `lib/nwsAlerts.mjs`: `https://api.weather.gov/alerts/active?point=<lat>,<lon>`
  (four decimals) with `User-Agent: kitchen-smart-display-hub` and `Accept:
  application/geo+json`, every 10 minutes (3 after a failure), one fetch at
  a time. Normalised to `{ id, event, severity, urgency, certainty,
  headline, description (first 300 characters), onset, ends (ends, else
  expires), messageType, senderName }`; Cancel messages, anything whose
  status is not Actual, and anything already ended are dropped, and ended
  alerts are dropped again on every read. A failed fetch keeps the last list
  for up to 12 hours and sets `error`; a point outside the NWS area (its 400
  "out of bounds") or a 404 is an empty list with no error.

## Web app

Settings (DEVICE scope, `display.*`): `homeView: 'photos' | 'today'` (default
`photos`), `entryBackdrop: 'photos' | 'black'` (default `photos`), `entryDim:
0..0.9` (default `0.5`). Layout id `entry`, label "Entry board", in
`registry.js`, `kioskMode.js` VALID_LAYOUTS and `TodayLayoutSwitch.jsx`.

- `hooks/useCalendar.js`: a module store polling `hubUrl('/api/calendar?days=3')`
  every 60 s, localStorage cache, exposes `{ events, countdowns, calendars,
  connected, fetchedAt, error, stale }`.
- `lib/houseState.js` accepts `headline` and `airQuality` from `/api/state`.
- `useTodayData()` adds `calendar` (the store above), `headline`, `airQuality`,
  with `?demo=1` fixtures (a few events across three days, two countdowns,
  a headline, an air quality reading).
- Panels (pure, tokens only, `PanelFrame`): `AgendaPanel({ days, now })` with
  `days = [{ dateKey, label, events }]`, all-day items first, a coloured bar
  per calendar; `CountdownsPanel({ countdowns })` tiles: art (or emoji or
  glyph), title, the number, "DAYS" / "DAY" / "TODAY"; `HeadlinePanel({
  headline, now })`; `AirQualityChip({ airQuality })`.
- `HeadlinePanel` by kind: an `alert` line has its dot and its words in
  `--tl-alert` (the palette's amber, `--tl-band-orange`, so a layout that
  re-inks the bands re-inks it); a `weather` line has a cool blue-grey dot,
  `--tl-weather` (`#8fa4ba`; no token carries a cool colour). Both, like
  `now` and `soon`, step back to grey once `until` is 2 minutes past with no
  newer line (the hub stopped answering). A bundle from before phase 1.5
  shows the new kinds as plain lines with no dot, so the hub can deploy
  first. `?demo=1&demoHeadline=alert` (or `=weather`) swaps the demo
  headline for one of each (`data/demo.js`).
- `Entry/EntryLayout.jsx` + css, root `tl-root tl-entry`, DAKboard's
  arrangement at 1920x1080 and 1280x800: clock top-left; weather now, what to
  wear and the air quality chip top-right; the headline across the middle
  left; the agenda's three columns bottom-left; the countdown tiles
  bottom-right. During the school-morning window on a school day the
  countdown slot shows `DeparturePanel` instead. `entryBackdrop === 'photos'`
  puts a full-bleed `PhotoPanel` under everything with a black layer at
  `entryDim` opacity and the Ambient scrims; `black` is the DAKboard look.
- `AppShell.jsx`: every "return to Photos" (boot outside the school morning,
  the morning-end watcher, any idle return) goes to `display.homeView`.

## Dashboard

- Today layout select gains "Entry board".
- Per web screen, an "Entry board" card: Photos behind the board (toggle),
  Darken photos (0 to 90%), Home view (Photos / Today).
- House-wide: a "Calendars and countdowns" card: the calendar list (id,
  label, colour; add and remove), countdown lead days, max tiles; a status
  line from `/api/calendar` (connected, last fetch, event count, error);
  "Headline now" from `/api/state`.
- A "Countdown art" card: the library from `/api/countdown-art` with each
  image and its keywords, a Refresh button, and the current countdowns with
  the art each one matched.

## Rollout

1. Hub deploy (routes work without the key: `connected: false`, empty agenda,
   headline from day parts only).
2. Justin's Google steps; the key lands in `_inbox/`, is moved to the hub's
   `secrets/` by hand (never through git), and `/api/calendar` is proven with
   real events. Calendar ids and labels entered on the dashboard.
3. The "Countdown Art" album in Immich; first sync; one marked event.
4. The Echo 15: Today layout = Entry board, home view = Today, Show Today.

## Phase 1.5 and 2 (not built)

- Backdrop legibility: gradient scrims where the text sits, translucent
  cards, per-photo brightness sampling, optional blur.
- A "suggested countdowns" list on the dashboard.
- Day-part adaptive slots (evening: tomorrow; weekend: wider agenda; night:
  the clock).
