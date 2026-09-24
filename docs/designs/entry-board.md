---
title: "Entry board - the front-door Today layout, calendar, countdowns, headline"
created: 2026-09-24
modified: 2026-09-24
version: 1.1
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, entry, echo-show, today, layouts, calendar, google-calendar, countdowns, headline, frameserver]
---

# Entry board

**Status: phase 1 built and deployed 2026-09-24**, live on the Echo Show 15 as
its home view. Justin's calendar is connected; Sheena's waits on her sharing
it. Review shots: `_review/entry/`.

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
  thing, else a day-part greeting. Weather interjections are phase 1.5.
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
calling Google). `secrets/` is created on deploy and never committed.

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

### Headline and air quality in `/api/state`

- `headline: { text, kind, eventId, until }` from `lib/headline.mjs` over the
  cached events. Every screen shows the hub's line.
- `airQuality: { pm25, aqi, label, fetchedAt } | null`, Open-Meteo air
  quality (`https://air-quality-api.open-meteo.com/v1/air-quality` with
  `current=pm2_5,us_aqi`), refreshed hourly for `shared.location`. Labels by
  US AQI: 0-50 Good, 51-100 Moderate, 101-150 Unhealthy for sensitive groups,
  151-200 Unhealthy, 201-300 Very unhealthy, 301+ Hazardous.

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
- Headline weather rules; "suggested countdowns" list on the dashboard.
- Day-part adaptive slots (evening: tomorrow; weekend: wider agenda; night:
  the clock).
