---
title: "Panels and controls - more panel types, generic element styles, WeatherKit, calendar views"
created: 2026-09-26
modified: 2026-09-26
version: 1.1
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, layout-editor, panels, weather, weatherkit, calendar, countdowns, home-assistant, echo-show, frameserver]
---

# Panels and controls

**Status: planned 2026-09-26, not built.** The plan of record for the layout
editor's next round, decided in conversation with Justin against his DAKboard
screens (calendar, time, weather and countdown settings). Builds on
`layout-editor.md` (Contract v2, panel schemas, day-part variants) and
`entry-board.md`. Delivered in reviewable chunks, each its own deploy; not
necessarily an overnight pass.

## Decisions (Justin, 2026-09-26)

- **Apple WeatherKit joins Open-Meteo** as a weather source on the hub. He has
  the developer account from the tvOS app. Open-Meteo stays the default and the
  fallback; WeatherKit is used when its key is present.
- **Element styles are generic** and apply to every panel's labelled elements,
  not to a chosen few. Agenda and countdown tiles get the first hand-check.
- **Text that does not fit shrinks or wraps, never truncates.** Wrap is the
  default for multi-line text, shrink for single values.
- **Countdown tiles get the DAKboard look**: the art above the tile,
  overlapping its top edge, on a gradient card.
- **A few more fonts**, not many: each family costs bundle weight.
- **Calendar views**: Up next, Day list, Week grid and Month grid, the wide
  ones aimed at the Echo Show 15.
- **Home Assistant panels wait** for the LAN URL, the token and the entity
  list; the design is ready in `BACKLOG.md` and below.
- **Skipped from DAKboard**: alert tones at event time, week offsets, the
  availability calendar, and auto-scrolling (motion on a glance screen).

## Chunk 1: editor foundations

Everything later inherits these, so they go first.

### Element styles

Every panel already labels its parts with `data-edit` keys (`PANEL_ELEMENTS`
in `panels/schemas.js`). A per-panel `elements` map in the spec styles any of
them without panel code:

```
panels[i].props.elements = {
  <key>: { hidden, size, weight, color, spaceAbove, spaceBelow, tracking,
           caps, fit: 'wrap' | 'shrink' | 'clip' }
}
```

- Applied by `SpecPanel` as a scoped stylesheet targeting
  `[data-edit="<key>"]` inside that box: `display: none`, a font-size
  multiplier through the element's own `--tl-text-scale`, weight, colour,
  margins, letter spacing, `text-transform`, and the fit mode.
- `fit: 'shrink'` is a small ResizeObserver fitter that steps the font size
  down until the element fits its line or box; `wrap` is CSS; `clip` exists
  for the rare case, never as a default.
- Keys that mark several elements (agenda rows, tiles) style all of them.
- Editor: click into an element and the inspector shows this set above the
  panel's own knobs for that element; an Elements tree under each layer with
  eye icons; Reset per element and per panel.
- Defaults are pixel-identical: an empty map changes nothing.

### Box background v2

`background` grows from `none | card | solid` to a preset plus a custom
object: `{ color, color2, gradient: 'none' | 'down' | 'right' | 'diagonal',
border: { width, color }, shadow: 'none' | 'soft' | 'strong', blur }`. Blur
degrades to a tint where `backdrop-filter` is unsupported (the Echo's Silk).
Existing presets keep their exact rendering.

### Typography

Per-panel `font` and `color` overrides above the global ones. New families,
latin subsets, two or three weights each: Roboto (the DAKboard look), Barlow
Condensed (tall numerals, the flip clock reference), IBM Plex Mono. Inter and
Fraunces stay. The global font list and the per-panel field share one
registry.

### Other box controls

- `valign: top | middle | bottom` beside `align`.
- `title: { show, text }`, a block title like DAKboard's.
- **Visibility rules** per panel, `when`: `schoolMorning`, `musicPlaying`,
  `plexPlaying`, `alertActive`, `countdownWithin: N`, `weekend`, `weekday`,
  `timeRange: [from, to]`, any-of or all-of. Evaluated by `SpecBoard` from the
  same inputs as `resolveDaypart` plus live state. Day-part variants remain
  the tool for whole layouts; rules handle single panels.
- Layers: copy and paste styles between panels, multi-select with align and
  distribute.

## Chunk 2: weather on the hub, weather panels, countdown tiles

### One weather feed

`GET /api/weather` from the hub: `{ source: 'open-meteo' | 'weatherkit',
fetchedAt, current, hourly (48 h), daily (10 d), sun, moon, uv, alerts,
nextHour (WeatherKit only) }`, refreshed every 15 minutes, disk cached. The
app's weather hooks read it with the direct Open-Meteo fetch kept as a
fallback; the headline rules read the same snapshot; the Apple TV can later.

**WeatherKit** (`lib/weatherKit.mjs`): `.env` keys `WEATHERKIT_KEY_FILE`
(default `secrets/weatherkit.p8`), `WEATHERKIT_TEAM_ID`, `WEATHERKIT_KEY_ID`,
`WEATHERKIT_SERVICE_ID`. A JWT signed ES256 with `node:crypto` (header `kid`
and `id = <team>.<service>`, claims `iss`, `iat`, `exp`, `sub = <service>`),
minted per fetch. Endpoint
`https://weatherkit.apple.com/api/v1/weather/en/<lat>/<lon>?dataSets=currentWeather,forecastHourly,forecastDaily,forecastNextHour,weatherAlerts&countryCode=US&timezone=<tz>`.
Attribution is a licence requirement: the Apple Weather mark and a link to
`https://weatherkit.apple.com/legal-attribution.html` in Settings and on the
dashboard's weather card, and a small mark inside weather panels while the
source is Apple. A missing or failing key falls back to Open-Meteo and says so
in `/healthz`.

### Panels

- **Hourly strip**: the next 6 to 24 hours, icon, temperature, rain chance,
  optional wind; knobs for hours, columns, what to show.
- **Forecast band style** on the existing daily panel: a high-low temperature
  bar per day.
- **Conditions detail**: feels like, humidity, wind, UV, pressure, visibility,
  sunrise and sunset as pick-and-choose rows.
- **Precipitation chart**: rain chance bars for the day, minute precipitation
  for the next hour when WeatherKit is the source.
- **Alert banner**: the active NWS or WeatherKit alert, hidden when none.

### Countdown tiles

- `tileStyle: 'artAbove'`: the art sits above the card and overlaps its top
  edge, DAKboard's arrangement, with art size and overlap knobs.
- Tile colour: a `color:` marker in the event description beside `label:` and
  `image:`, else a colour picked from the art, else the calendar colour;
  drawn as a gradient with the box background v2 machinery.
- **Single countdown** panel: one chosen event, big, with its art.

## Chunk 3: calendar views

Hub: the `days` cap on `GET /api/calendar` rises from 14 to 60 (the Google
window is already 60 days); consolidation of the same event across two
calendars (same title, start and end) on the hub; `location` already comes
through.

Panels, all sharing the agenda's options: **Up next** (one large next event
with time-to-start, then a short list), **Day list** (today, vertical, with
end times), **Week grid** (seven columns, hour rows, all-day band on top),
**Month grid** (dots on small screens, titles on the Echo 15). Options as
knobs: location, end time, description, calendar legend, show empty days,
future events only, consolidate, 12 or 24 hour, dim past, colour by calendar.

## Chunk 4: blocks and clocks

Shape and line blocks (fill, gradient, radius, blur), the flip clock as a
panel, an analog clock, a second clock with its own time zone, a date-only
block, week number and day X of Y.

## Chunk 5: Home Assistant (when the inputs land)

Hub `lib/homeAssistant.mjs` with a long-lived token in `secrets/`, a
dashboard whitelist of entities and actions, a WebSocket subscription folded
into `/api/state`, an action route that logs every call. Panels: indicator
chip, button with hold-to-confirm, toggle, sensor value (the Awair indoor air
sensors), presence chips, camera snapshot, the HA shopping list. Ship with the
dashboard PIN item. Needs: HA's LAN URL, a token from a dedicated non-admin
user, the entity list and the three buttons (garage, lock, leaving).

## Justin's part for WeatherKit (done 2026-09-26)

Done: the key is at `~/.config/smart-display/weatherkit.p8` with its ids in
`weatherkit.env` beside it, and on the hub at `secrets/weatherkit.p8` with the
three ids in the hub's `.env`. Validated against Apple for the house location:
availability lists all five data sets, current weather and next-hour minutes
returned, attribution URL present.

1. developer.apple.com, Certificates, Identifiers & Profiles, Identifiers:
   register an App ID (any description, an explicit bundle id such as
   `com.justinnikolaus.smartdisplay`) and enable **WeatherKit** under App
   Services.
2. Identifiers again: register a **Services ID** such as
   `com.justinnikolaus.smartdisplay.weather`. Its identifier is the
   `WEATHERKIT_SERVICE_ID`.
3. Keys: create a key with **WeatherKit** enabled, download the `.p8` once,
   note the **Key ID**. The **Team ID** is in the membership page.
4. Drop the `.p8` and a text file with the three ids in `_inbox/`. I move the
   key to `~/.config/smart-display/` and the hub's `secrets/` and delete the
   inbox copy, as with the other keys.

## Sizes

Chunk 1 L; chunk 2 M plus S per panel; chunk 3 L; chunk 4 S each; chunk 5 M.
Order: 1, 2, 3, then 4 and 5 as their inputs allow.
