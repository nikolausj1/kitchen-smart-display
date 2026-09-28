---
title: "Panels and controls - more panel types, generic element styles, WeatherKit, calendar views"
created: 2026-09-26
modified: 2026-09-28
version: 1.8
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, layout-editor, panels, weather, weatherkit, attribution, calendar, calendar-views, countdowns, countdown-tiles, blocks, clocks, shape, flip-clock, home-assistant, ha-blocks, repeated-blocks, hourly, agenda, previews, echo-show, frameserver]
---

# Panels and controls

**Status: all five chunks built and deployed. Chunk 1 went to the hub
2026-09-26 at 12:49 (build `2fcca07`; as built in `layout-editor.md`, "As
built, chunk 1 (2026-09-26)") with the hub halves of chunk 2 (the one
weather feed, on Apple WeatherKit) and chunk 5 (Home Assistant, actions
off). Chunk 2's app half (the screens on the feed, four weather panels, the
forecast's Bars style, Apple's mark) and the countdown tiles followed at
15:31 (build `0f13224`). Chunk 3 (the calendar views) and chunk 4 (blocks
and clocks, with the editor's shape support) went to the hub 2026-09-27 at
01:34 (build `88877f9`); as built under each below, and the editor's half
of chunk 4 in `layout-editor.md`, "As built, chunk 4 and the shape block
(2026-09-27)". Chunk 5's screen side (the HA status, HA button, HA chips
and HA picker blocks) went to the hub 2026-09-27 at 10:42 (build
`736683e`), with the layout core (any number of every type, the hourly
forecast's step and Rest of day, the agenda's row layouts, the Add block
menu's thumbnails: "Layout core", after chunk 5) and the editor's blocks
round (`layout-editor.md`, "As built, 2026-09-27: blocks, Delete, the Add
block menu, repeated blocks"). What remains: the first real Home Assistant
action with Justin present and then the dashboard's actions switch (until
then every HA button and picker draws disabled); the camera snapshot and
shopping list blocks; a dashboard row for the Today swipe setting and the
dashboard PIN. The smaller leftovers are at the end of each chunk.** The
plan of record for the layout editor's
next round, decided in conversation with Justin against his DAKboard
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
  list; the design is ready in `BACKLOG.md` and below. (The inputs landed the
  same day; see Chunk 5.)
- **Skipped from DAKboard**: alert tones at event time, week offsets, the
  availability calendar, and auto-scrolling (motion on a glance screen).

## Chunk 1: editor foundations (BUILT, deployed 2026-09-26)

Everything later inherits these, so they went first. **Built and deployed
2026-09-26** (hub 12:49, build `2fcca07`). The as-built record, with every
field, range and mechanism, is `layout-editor.md`, "As built, chunk 1
(2026-09-26)". Where the build differs from the plan below:

- `background` stays the preset (`none | card | solid`); the custom look is
  sibling props, `bg { color, color2, gradient, opacity }`, `border`,
  `shadow` and `blur`, not one object inside `background`.
- `title` is `{ mode: default | custom | none, text }` rather than `{ show,
  text }`, so a panel's own header can be kept, replaced or dropped.
- `valign: top` means the panel as designed: the headline, text blocks and
  the Board's clock are centred by design and stay so. A real top is in
  BACKLOG.
- Rules are `when: { all?, any? }`, lists of conditions, each with its own
  `not`; `timeRange` is `{ from, to }` as `'HH:MM'`; a `daypart` kind joined
  the list; `countdownWithin` takes `days`.
- Shrink to fit writes a text-scale factor (`--tl-el-fit`), not a font size,
  so it composes with the size knobs and the element's own size; it also
  re-fits when the text changes and when web fonts load.
- The defaults stay as designed, pixel for pixel, rather than "shrink for
  single values": text that was cut off with an ellipsis before (a headline
  past its line, a long agenda title) still is, until its element is set to
  Shrink to fit (`_review/layout-editor/found-elements-headline-*.png`).
- Fonts: Roboto and IBM Plex Mono 400, 500 and 700, Barlow Condensed 400 to
  700; the global Display font offers all five families.
- `PANEL_ELEMENTS` grew to cover every visible part, and two keys were
  renamed so that `title` is the header row everywhere: the countdown tile's
  event title is `name`, Now Playing's track title is `track`.
- Reset per element is the Element section's Reset element; per panel, the
  panel menu's Reset element styles.

The plan as written:

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

## Chunk 2: weather on the hub, weather panels, countdown tiles (BUILT, deployed 2026-09-26)

Built and deployed 2026-09-26: the hub half with the hub at 12:49 (build
`2fcca07`), the app half and the countdown tiles at 15:31 (build
`0f13224`). The as-built records are "As built: the hub half (2026-09-26)"
and "As built: the app half and the tiles (2026-09-26)" below, with the
plan kept as written between them; what is left is "What remains of chunk
2", at the end of this section.

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

### As built: the hub half (2026-09-26)

Deployed with the hub 2026-09-26 12:49 (build `2fcca07`); the live hub
reports `source: weatherkit`. `frameserver/lib/weather.mjs` is the feed
(source choice, fallback, cache, merged alerts); `lib/weatherKit.mjs` and
`lib/openMeteoWeather.mjs` are one client each, normalised to one contract.
`lib/hubWeather.mjs` is now an adapter that reshapes the feed into the narrow
forecast the headline rules have always read, so `weatherRules.mjs`,
`headline.mjs` and their tests run unchanged on either source.

- `GET /api/weather`: `{ source, fetchedAt, error, location: { lat, lon,
  timezone }, current, hourly, daily, nextHour, alerts, sun, moon,
  attribution }`. `error` is the preferred source's last error when it is not
  what is being served. `hourly` is 48 entries from the current hour (from
  local midnight since the 15:31 deploy: "The hours from midnight", below),
  each `time` the START of its hour (Open-Meteo's end-of-hour columns moved
  back, as the headline already did); `daily` is 10 days. UV sits in
  `current.uv`, `hourly[].uv` and `daily[].uvMax`, not at the top level.
  `condition` is WeatherKit's own string (`MostlyCloudy`) and null for
  Open-Meteo; `code` is the WMO code both share (WeatherKit's conditions
  mapped by one table, an unknown one logged once and drawn from the cloud
  cover).
  `daily[].windMaxMph` is the day's maximum gust. `nextHour` (WeatherKit
  only, else null) is `{ summary, minutes }`, `summary` being WeatherKit's
  list of segments (start, condition, chance, intensity). `moon` is `{
  phase, name }`, computed locally for Open-Meteo; `attribution` is `{ name:
  'Apple Weather', url }` for WeatherKit, null for Open-Meteo.
- Alerts: the NWS alerts (`lib/nwsAlerts.mjs`) merged on every read with
  WeatherKit's own, deduped by event name and end, the NWS copy kept on a
  clash, ended ones dropped, most severe first; each carries `source: 'nws'
  | 'weatherkit'`. `/api/state.headline` and `/api/state.weatherAlerts` use
  this merged list.
- Source: WeatherKit when configured, Open-Meteo otherwise.
  `WEATHER_SOURCE=auto | weatherkit | open-meteo` (default auto) names the
  preferred source, and the other one is still tried when it fails, pinned
  or not; `source` always says whose data is in the response. Refreshed
  every 15 minutes, retried 5 minutes after a failure, one fetch at a time;
  the disk cache `weather-feed-cache.json` serves the last snapshot at once
  after a restart, and a snapshot more than 3 hours old counts as none.
- Timezone: the registry stores `shared.location.timezone: 'auto'`, and
  WeatherKit needs a real zone (so do the local `time` stamps), so the hub
  asks Open-Meteo once per location and keeps its answer; a real zone in the
  registry wins.
- `/healthz.weather` = `{ source, fetchedAt, error, weatherKit: {
  configured, lastOkAt, lastError }, openMeteo: { lastOkAt, lastError } }`.
  The dashboard's house-wide Weather card shows the source, the age, any
  error and, when the source is Apple, the Apple Weather attribution link.
- Tests: 49 new (`weatherKit` 18, `openMeteoWeather` 15, `weather` 16).
  Fixtures in `frameserver/test/fixtures/weather/`: real WeatherKit and
  Open-Meteo responses for the house, and a hand-written WeatherKit alerts
  payload.

Findings:

- WeatherKit's CDN caches a successful response for 5 minutes by URL, so a
  second request inside that window gets the same body, and a check of a
  change (a new key, say) can pass on a cached answer.
- A wrong key id alone did not fail authentication; a wrong team id did. One
  good answer does not prove every id is right.
- WeatherKit's alert summaries have no `event` field; the name is parsed
  from the description (the text before " issued"). Unverified against a
  live alert (none was active within reach while this was built); the
  parser drops what it cannot read rather than failing.
- Asking for `weatherAlerts` alone answers 400 with an empty body; the full
  list of data sets always works. With no alerts Apple leaves the
  `weatherAlerts` key out rather than sending an empty list.
- `forecastHourly` starts around local midnight (250 hours or more, some
  already past), so the hub windows it to 48 hours from the current hour.
  Since 15:31 the request itself asks for local midnight through just past
  the window (`hourlyStart`, `hourlyEnd`), and the hub keeps midnight on.

What remained after the hub half (the app's weather hooks onto
`/api/weather`, Apple's mark on the screens, the panels below and the
countdown tiles) was built the same afternoon: "As built: the app half and
the tiles (2026-09-26)", below.

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

### As built: the app half and the tiles (2026-09-26)

Deployed with the hub 2026-09-26 15:31 (build `0f13224`: the weather work,
`87e531f`, and the tiles, merged from their own branch); the Echos take it
on their next reload. The kitchen Pi (its own bundle, `812242f`) and the
Apple TV were not redeployed: the kitchen's Framed Today and the
slideshow's time widget fetch Open-Meteo themselves until the next
`./deploy.sh pi`. None of the new panel types is on a default board; they
arrive through the editor's Add panel:

| type | label | starting box (x, y, w x h, %) | minimum (%) | "Too small" under | box |
|---|---|---|---|---|---|
| `hourly` | Hourly forecast | 20, 34, 60 x 30 | 14 x 10 | 220 x 90 px | card |
| `conditions` | Conditions | 34, 30, 32 x 36 | 10 x 8 | 150 x 70 px | card |
| `precip` | Rain chance | 25, 34, 50 x 30 | 14 x 10 | 220 x 90 px | card |
| `alert` | Weather alert | 20, 3, 60 x 9 | 10 x 4 | 160 x 28 px | none (the banner is its own) |
| `countdown` | Countdown | 40, 35, 20 x 30 | 6 x 8 | 120 x 100 px | none (the card is its own) |

`TYPE_TABLE` in `layoutSpec.js` holds those; the knobs and elements are in
`panels/schemas.js`, and the weather panels' pure parts in
`lib/weatherPanels.js`, tested from Node.

#### The screens on the feed

- `hooks/useHubWeather.js` is one store for every weather reader on a
  screen. It polls `GET /api/weather` at once, every 5 minutes (not gated
  on visibility) and whenever the page becomes visible again, and keeps the
  last good feed in localStorage for up to 12 hours, so a reload draws at
  once; a poll that answers with no data keeps the feed it holds.
  `hooks/hubWeatherFeed.js` holds the pure parts: the contract's cleaning,
  the hour lookups, and the old hooks' readings of an Open-Meteo payload for
  the fallback.
- `useWeather` (the Framed Today's slots, the slideshow's time widget, the
  departure-hour lookup) and `useDailyForecast` (the weather card, the
  forecast, the sun arc, what to wear) read the store and keep their output
  shapes, so every existing view draws the same pixels on the same weather:
  0 px in ten scenarios (the Entry board on an afternoon and a school
  morning at 1920x1080 and 1280x800, the Board at both sizes, the two demo
  boards, Briefing and Ambient), software raster, the build before against
  this one fed the same second's Open-Meteo data, and no Open-Meteo request
  from the new build (`_review/layout-editor/wx-diff-results.json`).
- The fallback: each hook still fetches Open-Meteo itself, but only once
  the page's first poll of the hub has settled (a cold start with the hub
  up never asks Open-Meteo) and only while the feed has never answered or
  its data is more than 90 minutes old (`FEED_MAX_AGE_MS`). A stale feed
  keeps showing until the fallback has something newer.
- `useTodayData` hands the panels `d.weather`: what the card, the forecast
  and the sun arc always read, plus the feed's `source`, `hourly`, `daily`,
  `nextHour`, `alerts`, `sun`, `moon` and `attribution` (Apple's mark while
  WeatherKit's data is shown, else null). `current` gains humidity, dew
  point, gusts, wind direction, pressure, visibility, UV and cloud cover.
- `?demo=1` fills a whole fake feed (48 hours, ten days, rain arriving
  within the hour, a wind advisory, the sun and the moon; it claims
  WeatherKit, so a design shot carries the mark), used only while there is
  no live weather; `?demo=1&demoWeather=1` shows it over live weather too.

#### The hours from midnight (hub)

- The feed's `hourly` now runs from today's local midnight to 48 hours past
  the current hour: Open-Meteo is asked for `past_hours=24`, trimmed to
  00:00; WeatherKit gets `hourlyStart` (local midnight) and `hourlyEnd`. At
  15:00 that is 63 entries (a scratch hub on the real key served
  `hourly[0].time` 2026-09-26T00:00 and 63 hours at 15:19). A screen loaded
  in the afternoon finds this morning's slots (8 and 11 am on the Framed
  Today) in the feed. The headline rules still see only the hours not yet
  over (`lib/hubWeather.mjs`).
- Each entry is the hour STARTING at its time. The screens used to read
  Open-Meteo directly, which stamps an hour's weather code, rain chance and
  gusts at the hour's END, so the feed's 8 am code is the old fetch's 9:00
  code. Temperatures agree hour for hour (35 of 35). On a fresh load at
  1:00 pm the Framed Today moved only its 8 am icon (overcast to clear,
  3,523 px; the time widget 1,146 px), and 0 px when fed the same slot
  values (`wx-framed-widget-results.json`, `wx-alignment-midnight.json`).

#### The weather panels

- **Hourly forecast** (`hourly`, `panels/HourlyPanel.jsx`): a column per
  hour from the hour now is in; the first says "Now" and shows the current
  reading, so it agrees with the weather card. Knobs: `hours` 6 to 24
  (12); `columns` Auto, 6, 8 or 12 (hours past the columns wrap to another
  row; Auto fits columns at least 3.4 % of the screen's width, never under
  44 px, in balanced rows: 12 hours that fit 8 wide make two rows of 6);
  `style`, shown as "Temperature line", None (`columns`, the default) or
  Curve (`curve`: a line through the temperatures in a band above the
  numbers, the current hour's dot in the accent); `showRain` on (every
  hour's chance, in the accent from 20 %, muted below); `showFeelsLike` and
  `showWind` off; `size`. Elements: title, hour, icon, curve, temp, feels, `iconSize` 0.5..2.5 (default 1, added 2026-09-27) scales the icons' cap.
  rain, wind, empty ("No hourly forecast yet").
- **Forecast, Bars**: the daily forecast's new `style`, "Side by side"
  (`rows`, the default, as it always was) or "Bars" (`band`): a day per
  line, its icon, then a bar from its low to its high placed on the whole
  period's range (at least 6 % wide), the low and the high at its ends.
  New element `bar` ("High-low bar").
- **Conditions** (`conditions`, `panels/ConditionsPanel.jsx`): the sky's
  icon and word on a line ("Sky now", `showCondition`, on), then a label
  and a value per row, one toggle each, in this order: feels like,
  humidity, wind (speed and compass point; "Calm" at 0), gusts, UV index
  (with its WHO band, "3 Moderate"), pressure (in inHg), visibility (in
  miles), dew point, sunrise, sunset, cloud cover. On by default: feels
  like, humidity, wind, UV, sunrise and sunset; off: gusts, pressure,
  visibility, dew point and cloud cover. `layout` Auto (two columns when
  that gives the rows bigger type, which is when the box is wide), One
  column or Two columns; `size`. A reading the source lacks shows "--".
  Elements: title, icon, condition, label, value, empty ("No conditions
  yet", or "No rows chosen").
- **Rain chance** (`precip`, `panels/PrecipPanel.jsx`): a bar per hour for
  `hours` 12 to 48 (24): full accent from 50 %, dimmed from 20 %, grey
  below, none at 0; a dashed line at 50 %; hour labels every 3 hours, every
  6 past a day, "Now" on the first bar. Above it, when WeatherKit's minutes
  are in the feed and any minute ahead reaches 10 %, a "Next hour" strip:
  each minute's chance and what it adds up to ("Rain likely in 11 min",
  "Rain stopping in 25 min", "Rain for the next hour", "Rain possible
  within the hour"; the word from WeatherKit's summary: rain, drizzle,
  snow, sleet, hail, mixed precipitation). `size`. Elements: title,
  nextHour, bar, label, empty ("No rain forecast yet").
- **Weather alert** (`alert`, `panels/AlertPanel.jsx`): the most severe
  alert in force from the feed's merged NWS and WeatherKit list (then the
  earliest to end; re-checked against the clock, so one that has ended
  goes at once), as a banner: the event in bold and when ("until 6 pm",
  "until midnight", "through Sun 6 am", "from 5 pm" while its onset is
  ahead); red for Severe, Extreme or any Warning, amber otherwise; the
  alert's headline on the lines under it only when the banner is at least
  2.2 first lines tall. With no alert in force SpecBoard drops the box
  entirely, as if a rule hid it; in the editor it shows "No alert right
  now", so it can be placed. `size`. Elements: title, event, until,
  headline.

#### Apple's mark

- `panels/WeatherAttribution.jsx`: "Apple Weather", 12 to 14 px whatever
  the box's text scale, muted (a lighter ink over photos: Ambient, the
  time widget), one line, drawn only while `source === 'weatherkit'`: at
  the foot of the hourly, conditions, rain and forecast panels; in the
  corner of the weather card, what to wear and the sun and moon; at the end
  of the alert banner's first line, on a WeatherKit alert only (an NWS
  alert is the Weather Service's own and carries none); in the Framed
  Today's weather panel (its bottom padding) and past the time widget's
  last slot; on Briefing's weather panels and under Ambient's weather.
- It carries `data-edit="attribution"` so the editor can point at it, but
  the key is deliberately not in `PANEL_ELEMENTS`: the spec normaliser
  drops any element style for it, so it cannot be hidden, shrunk or
  recoloured apart from its panel.
- Settings, Location: "Weather by Apple Weather" with
  `https://weatherkit.apple.com/legal-attribution.html` printed in full
  (the Echo's Silk cannot follow a link). The dashboard's Weather card has
  had the link since the hub half.
- The headline's weather lines are the hub's own words and carry no mark.

#### Countdown tiles: Art above

- `countdowns` `tileStyle: 'artAbove'` ("Art above", drawn by
  `panels/CountdownCard.jsx`): DAKboard's look, the art centred above a
  coloured card and dipping into its top edge; on the card, in white, the
  title, the number and its unit. Its knobs: `artSize` 0.4 to 1.2 of the
  card's width (0.8), at most half the slot's height; `artOverlap` 0 to
  0.8 of the art's own height (0.35; a wide picture dips by its own
  height, not its box's); `tileGradient` Down (the default), Diagonal or
  None (a black veil from clear to 32 % over the colour, in the box v2
  directions); `tileColorFrom` Auto, Marker or Calendar (below). The edge,
  background and image size knobs are the other styles'.
- A tile without art (no picture and no emoji, or a picture that fails to
  load) fills its slot as a plain gradient card, its text level with its
  neighbours'. The Card, Bare and Image only styles draw exactly as before
  (0 px at the defaults).

#### The tile colour

- Auto (the default) takes the event's `color:` marker (the hub's
  `tileColor`), else a colour sampled from its art, else its calendar's
  colour, else the layout's accent. Marker skips the art (the marker, else
  the calendar); Calendar skips both (`lib/tileColor.js`,
  `panels/useTileColor.js`).
- The sample (`artColor`): the art's opaque pixels vote for their 10-degree
  band of hue, weighted by chroma (black outlines, white highlights and
  grey shadows carry none and do not vote); the colour is the
  chroma-weighted average, in linear light, of the pixels within 20
  degrees of the winning band. Grey art (under 3 % colourful pixels)
  yields none. A plain average of every pixel, the brief, turned
  multicoloured art to mud: the balloons came out grey-brown (`#967f6a`)
  where the vote finds their red (`#e03b3e`).
- Only the sampled colour is adjusted: darkened (or lightened) into a band
  where white text reads at contrast 3 or more, the large-text bar, and it
  still reads as a colour. A marker or calendar colour is someone's choice
  and is drawn as chosen.
- The art is read once per URL for the page, off the main thread (the luma
  sampler's decoder), and only while its colour could be used (Auto, no
  marker). Until then the card wears the next colour in line, and it eases
  into the sampled one over 0.4 s.
- The hub's marker (`frameserver/lib/countdowns.mjs`): `color: <value>`
  (also `colour:`) beside `label:` and `image:` in the event's
  description, `#rgb`, `#rrggbb` or a `TILE_COLORS` name in any case;
  anything else is ignored as if absent. Delivered as `tileColor`
  (`'#rrggbb'` or null); the countdown's `color` stays the calendar's (the
  tiles' edge, the dashboard's dot). The names, each a mid-tone white text
  reads on (contrast 3.25 to 4.96): red `#d9453d`, orange `#e06a1b`, yellow
  `#b8860b`, green `#2f9e44`, teal `#0d9488`, blue `#2f7fe8`, indigo
  `#5b61e0`, purple `#8e4ed8`, pink `#db4a8a`, brown `#9a6a45`, gray
  `#6b7280` (grey works too). Also in `entry-board.md`, "Countdown art".

#### The single countdown

- `countdown` ("Countdown", `panels/CountdownPanel.jsx`): one countdown,
  big, always on the art-above card. Knobs: `pick` "The next one" (the
  soonest) or "By title", with `titleMatch` (up to 80 characters, any
  case, part of the title or of its `label:`; nothing matches while it is
  empty); `layout` "Art above" (`stacked`) or "Art left" (`side`: the art
  dips into the card's left edge, and `artSize` and `artOverlap` count
  across the card's height); and the art-above knobs, `tileGradient`,
  `tileColorFrom`, `tileRadius`, `artSize`, `artOverlap`, `titleSize`,
  `numberSize`, `showUnit`, `prefer`. Elements: title, image, name,
  number, unit, empty. It says "No countdown", quietly, when nothing
  matches, in the editor too.
- It can only pick from the hub's list: marked events inside their own
  lead window, the soonest `countdownMax` of them (3 unless the dashboard
  says more).
- `?demo=1`: the birthday countdown is marker purple, the cabin marker
  green.

#### Findings and numbers worth keeping

- WeatherKit against Open-Meteo for the house, fetched eleven minutes apart
  on 2026-09-26 (1:34 and 1:45 pm; `wx-alignment.json`): hourly
  temperatures up to 4 F apart, 1.9 F on average over 35 hours, the
  weather codes agreeing on 28 of them; daily highs and lows up to 3 F
  apart over the first three days and up to 6 F by the seventh; rain
  chances far apart (WeatherKit 91 % against Open-Meteo's 64 % on Sep 29,
  68 % against 45 % on Sep 30, 44 % against 10 % on Oct 1).
- The feed's hour H is the hour starting at H; Open-Meteo stamps that
  hour's code, rain chance and gusts at H+1.
- The Minnesota art has no one colour (sky, fields and forest in bands)
  and samples khaki (`#a39362`): a tile like that is what `color:` is for.
- The backpack PNG carries a faint watermark in its transparent area, which
  shows on the black backdrop (`tiles-artabove-black-1920.png`).
- Tests: the weather half 21 new app tests (`hooks/hubWeatherFeed.test.mjs`
  7, `lib/weatherPanels.test.mjs` 14) and 6 on the hub (the midnight
  window, across the Open-Meteo, WeatherKit and feed suites); the tiles 30
  new app tests (`lib/tileColor.test.mjs` 19,
  `panels/countdownParts.test.mjs` 5, `layoutSpec.test.mjs` 5,
  `specStyles.test.mjs` 1) and 16 on the hub (the `color:` marker,
  `countdowns.test.mjs`). After the merge the hub's suite is 490 and the
  app's 102.
- Shots: `_review/layout-editor/wx-*` and `tiles-*`, indexed in that
  folder's README.

### What remains of chunk 2

- **The hub's travel default reads the old hour.**
  `frameserver/lib/travelDefault.mjs` still fetches Open-Meteo itself and
  reads the weather code stamped at the departure hour, which in
  Open-Meteo's convention describes the hour before it, while the app's own
  fallback travel default (used until the hub answers) now reads the
  feed's hour starting at the departure hour. Move the hub's onto the feed,
  the hour starting at the departure hour, so both read the same hour.
  BACKLOG, "Hub travel default reads the old hour".
- **Two marks on the Entry board's shared card.** The default Entry board
  draws the weather card and what to wear flush, as one card, and each
  carries Apple's mark in its corner, so the card says "Apple Weather"
  twice. One mark per card would do. BACKLOG, "Weather panels follow-ups".
- **Shrink by default for single values.** Decided above ("Text that does
  not fit shrinks or wraps, never truncates"), but chunk 1 kept every
  default as designed, so a headline past its line still ends in an
  ellipsis until its element is set to Shrink to fit. BACKLOG, "Shrink to
  fit by default for single values".
- **A real WeatherKit alert.** None has been in force since the hub half:
  the event name parsed from WeatherKit's description, the dedupe against
  the NWS copy, the headline's line and now the Weather alert banner are
  proven only on fixtures and hand-made feeds. BACKLOG, "WeatherKit alert
  spot-check".
- Smaller, in BACKLOG ("Weather panels follow-ups", "Countdown Art
  follow-ups"): while a screen is on the Open-Meteo fallback the new
  weather panels show their empty states and the alert banner stays away
  even with an alert in force (the fallback fetches only what the old
  hooks drew); the mark can be clicked in the editor, though any
  style on it is dropped; the Minnesota event wants a `color:` line and the
  backpack PNG a clean transparent area.

## Chunk 3: calendar views (BUILT, deployed 2026-09-27)

Built and deployed with the hub 2026-09-27 01:34 (build `88877f9`; chunk 3
is commit `61d3880`). The as-built record is "As built: the calendar views
(2026-09-27)", below the plan. Where the build differs from the plan:

- The Google window reaches back as well as ahead (31 days back, 60
  ahead), so a week from Monday and a month grid have their past days.
- Consolidation is a screen option on each panel, not a hub step. The hub
  already listed an invitation between two listed calendars once; it now
  says which other calendars it was on (`alsoOn`), so a panel that
  consolidates can draw every calendar's colour.

The plan as written:

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

### As built: the calendar views (2026-09-27)

Deployed with the hub 2026-09-27 01:34 (build `88877f9`); the Echos take it
on their next reload (every deploy reloads them, and each then waits for a
tap). The kitchen Pi and the Apple TV were not redeployed. None of the four
views is on a default board; they arrive through the editor's Add panel.

#### The hub's window

- `frameserver/lib/googleCalendar.mjs` fetches one window per calendar,
  from local midnight 31 days back (`PAST_DAYS`) to local midnight 60 days
  ahead (`WINDOW_DAYS`; `fetchWindow`), still every 5 minutes, at startup
  and when the registry's calendar list changes. Before, the window was
  today to 60 days ahead.
- `GET /api/calendar?days=N&past=P` (`calendarQuery`): `days` 1 to 60 ahead
  (it was 1 to 14), default 3; `past` 0 to 31 back, default 0; whole
  numbers, anything else reads as the default. The response gains `past`,
  and `from` and `to`, the local dates its events cover (`to` exclusive).
  Every event gains `alsoOn`, `[{ calendarId, calendarLabel, color }]`: the
  other listed calendars the same invitation was on, `[]` for most. The hub
  lists such an invitation once (same iCalUID and start), from the first
  calendar in the registry's order, as it always has. The shape:
  `entry-board.md`, "`GET /api/calendar?days=N&past=P`".
- Unchanged: the headline, and the countdowns, which still look 60 days
  ahead from today whatever the query. The disk cache
  (`calendar-cache.json`) gains an informational `window` key, and a file
  without it reads as before. `/healthz.calendar.events` now counts the
  whole window: 66 live after the deploy, when `?days=60&past=31` answered
  `from` 2026-08-27 and `to` 2026-11-26.

#### The screens' window

- `hooks/useCalendar.js` asks the hub for the union of what the panels on
  screen want, never less than `days=6` (the agenda's own need), so a
  screen without the new views makes exactly the request it always made. A
  view says what it needs with `wantCalendarWindow({ days, past })`, or the
  `useCalendarWindow` hook, which returns its release; `SpecBoard` wants
  its board's union (`lib/calendarViews.js`, `boardCalendarNeed`): Up next
  the hours it looks ahead, Day list one or two days, Week grid its days
  before and after today, Month grid its 42 days (clamped to the hub's
  caps), and the agenda 14 days when it skips empty days. A wider union
  asks again at once; a narrower one waits for the next poll (every 60 s).
  The pure parts are `hooks/calendarWindow.js`.
- The snapshot gains `range`, `{ from, to }` as the hub answered. A view
  never calls a day outside it empty: such a day is drawn with no events
  and no marks, and "Nothing this week" or "No events this month" shows
  only when the whole week or month is inside the range.

#### The panels

| type | label | starting box (x, y, w x h, %) | minimum (%) | "Too small" under | box |
|---|---|---|---|---|---|
| `upnext` | Up next | 34, 25, 32 x 50 | 12 x 12 | 160 x 100 px | card |
| `daylist` | Day list | 36, 15, 28 x 70 | 10 x 14 | 150 x 110 px | card |
| `weekgrid` | Week grid | 3, 20, 94 x 70 | 30 x 24 | 360 x 180 px | card |
| `monthgrid` | Month grid | 20, 6, 60 x 88 | 20 x 24 | 240 x 200 px | card |

Each draws in `PanelFrame`, sizes its type through `--tl-knob-scale`, marks
its parts with `data-edit` keys, and keeps its "Too small" rule in its own
stylesheet (`panels/UpNextPanel.css` and the others) rather than
`Entry/SpecPanel.css`. The pure parts are `lib/calendarViews.js`; the
colour bar, the dot and the legend are `panels/CalendarParts.jsx`. Each
says "Calendar not connected" when the hub has no calendar, and nothing
while the first answer is out.

- **Up next** (`upnext`, `panels/UpNextPanel.jsx`): the next event large,
  then the events after it grouped under their day ("Tomorrow",
  "Saturday"). The next is the first timed event not yet over (one running
  now included), a long one (24 hours or more: a trip) only when nothing
  else is coming, else the first all-day event. Under its title, how long
  until it starts ("in 40 min", "in 2 hr 5 min", "Tomorrow", "Saturday")
  and its time; while it runs, "Now" and "until 6:15 pm". Knobs: `count` 0
  to 6 (3), the rows after the next; `hoursAhead` 12 to 72 (48, in steps
  of 6); `nextSize`, `rowSize`. Elements: title, updated, next, nextIn,
  nextTime, nextLocation, description, rows, day, row, time, legend, empty
  ("Nothing coming up"); past the rows, "+n more".
- **Day list** (`daylist`, `panels/DayListPanel.jsx`): one day, today or
  tomorrow, under its long date ("Sunday, September 27"): all-day and long
  events first, then the timed ones with their start, and the end under it
  with End time on; an event across days adds "through Mon" or "until Tue
  6:00 pm". Knobs: `day` today or tomorrow; `maxRows` 3 to 14 (8),
  finished events giving up their places first, then "+n more"; `rowSize`,
  `headerSize`. Elements: title, updated, header, allday, rows, row, time,
  location, description, legend, empty ("Nothing today", "Nothing
  tomorrow").
- **Week grid** (`weekgrid`, `panels/WeekGridPanel.jsx`): a column per day
  and a row per hour, each timed event a block placed by its start and
  length, in its calendar's colour. Events that overlap stand side by side,
  three lanes at most, the rest as "+n"; all-day events, and timed ones of
  24 hours or more, are bars in a band across the top (three rows, then
  "+n" under a day); a line marks the time now on today's column. A timed
  event is cut at midnight into a block per day, and a part outside the
  hours is pinned to the grid's edge with its own time on it and a dashed
  edge. The header says "Next 7 days" from today, else "This week". Knobs:
  `startDay` today, monday or sunday; `days` 5 to 7 (7); `startHour` 5 to
  12 (7) and `endHour` 17 to 24 (21); `showAllDay` and `hourLabels` (on);
  `compact` (off; on, shorter rows and an event on one line); `size`.
  Elements: title, updated, dayHeader, hourLabel, allday, block, more,
  nowLine, legend, empty ("Nothing this week").
- **Month grid** (`monthgrid`, `panels/MonthGridPanel.jsx`): the current
  month or the next as six weeks, today marked, each day's events as dots
  in their calendars' colours (four, then "+n") or, where there is room
  (the Echo Show 15), as titles with a short time ("5pm"). Knobs: `month`
  current or next; `weekStart` sunday or monday; `mode` dots or titles;
  `titlesPerDay` 1 to 4 (3), the rest as "+n"; `showOtherMonths` (on: the
  days before and after, dimmed); `size`. Elements: title, monthLabel,
  updated, weekday, day, dayNumber, dot, event, more, legend, empty ("No
  events this month").

#### The shared options

DAKboard's calendar settings, as knobs on each panel they mean something to
(`panels/schemas.js`, `CALENDAR_OPTIONS`). Every default is the agenda's
behaviour before they existed.

| option | label | default | what it does | Agenda | Up next | Day list | Week grid | Month grid |
|---|---|---|---|---|---|---|---|---|
| `showLocation` | Location | off | the place under an event | yes | yes | yes | yes | no |
| `showEndTime` | End time | off | start and end, not only the start | yes | yes | yes | yes | no |
| `showDescription` | Description | off | the first line of the description, countdown marker lines skipped | yes | yes | yes | no | no |
| `legend` | Calendar legend | off | each calendar's colour and name, at the foot | yes | yes | yes | yes | yes |
| `showEmptyDays` | Empty days | on | off: only days with events, looking up to 14 days ahead | yes | no | no | no | no |
| `futureOnly` | Upcoming only | off | leaves out what is over (off, it stays, dimmed with Dim finished) | yes | no | yes | yes | yes |
| `dimPast` | Dim finished | on | steps back what is over | yes (its own since Contract v2) | no | yes | yes | yes |
| `consolidate` | Merge shared events | off | the same event on two calendars once, with both colours | yes | yes | yes | yes | yes |
| `timeFormat` | Time format | auto | auto, 12h or 24h | yes (default 12h) | yes | yes | yes | yes |
| `colorBy` | Colour by | calendar | calendar, or none (neutral bars and dots) | yes | yes | yes | yes | yes |

- `consolidate` merges events from different calendars with the same title
  (any case) that are all day on the same dates or timed with the same
  start and end, and folds in the hub's `alsoOn`; the first copy is kept,
  with every calendar's colour. Its colour bar is then a hard-edged stripe
  per calendar and its dot is split left to right (`splitPaint`). Off, an
  invitation the hub listed once shows its first calendar's colour, as
  before.
- `timeFormat` auto is the screen's own 12 or 24 hour setting when it has
  one, else 12-hour. No screen has one yet, so auto reads 12-hour today;
  the panels already take the setting as `screenHour24`, the hook point.
  The agenda's own `timeFormat` gained Auto and keeps 12h as its default.
- Places are shortened to the place name (`placeOf`): "McGilvra
  Elementary, 1617 38th Ave E, Seattle, WA 98112" reads "McGilvra
  Elementary"; a bare street address keeps its street.
- The agenda gained all of them, with the elements location, description
  and legend. At its defaults it draws the very same DOM (`agendaItems`
  hands back the same objects when no option is on).
- An exception to "never truncates": month titles and short week blocks
  end in an ellipsis, because their cells cannot grow.

#### The month grid at the hub's edges

The month grid is always six weeks, 42 days, and asks for all of them,
clamped to the hub's 60 days ahead and 31 back, which a grid can outrun:

- The next month's grid can need up to 73 days ahead. In the first 4 to 13
  days of a month its last days (the month after, drawn only with Other
  months on) fall past the cap; on the 1st of every month but January and
  February, and on July 2 and December 2, so do the next month's own last
  day or two (61 or 62 days ahead).
- The current month's grid can start up to 36 days back. In the last one
  to five days of some months its first days (the month before, again only
  with Other months on) fall past the 31-day cap; a Monday-start grid on
  January 31, 2026 starts 33 days back.

A day past the caps is drawn as unknown (no marks, and never counted
toward "No events this month"), never as empty. Worked out from
`calendarNeed` over 2026 and 2027. BACKLOG, "Month grid past the hub's
window".

#### The demo

`?demo=1` carries six weeks of events (21 days back to 20 ahead) on two
calendars: a week of regular things by weekday, one-offs, overlaps (four at
5 pm three days out: two side by side and "+2" in the week grid), multi-day
events (grandparents visiting, a nine-day fall break), a trip timed across
three days, and one dinner on both calendars, for Merge shared events.
Today and the next two days keep the original eight events, so the demo
Entry board is unchanged (0 px).

#### Verified

- Pixel diffs against the build before (`4ebcfb5`), nothing set and every
  board at its built-in default, frozen at Sun 2026-09-27 4:05 pm, software
  raster, three loads per build: 0 px in every pair for the Entry board at
  1920x1080 and 1280x800, its demo at 1920x1080, the Board at 1280x800 and
  Briefing at 1920x1080. The demo Board at 1280x800 differs by up to 53 px
  between two loads of either build (the edges of its SVG weather icons),
  with pairs across the builds at 0. Both builds asked `?days=6`
  (`_review/layout-editor/cal-diff-results.json`).
- Tests: 42 new in the app (`lib/calendarViews.test.mjs` 36,
  `hooks/calendarWindow.test.mjs` 6) and 14 on the hub
  (`googleCalendar.test.mjs`); with chunk 4 the app's suite is 190 and the
  hub's 504.
- The editor's Add panel lists the four views and places one at its
  starting box (`cal-editor-weekgrid-added-1600.png`).
- Shots: `_review/layout-editor/cal-*`, indexed in that folder's README.

## Chunk 4: blocks and clocks (BUILT, deployed 2026-09-27)

Built in a worktree (`49ff04f` to `cfbf839`), merged as `ff1beb5` and
deployed with the hub 2026-09-27 01:34 (build `88877f9`). The as-built
record is "As built: blocks and clocks (2026-09-27)", below the plan; the
editor's half (block types from the app, the shape in the editor, types it
does not know kept as stored) is `layout-editor.md`, "As built, chunk 4 and
the shape block (2026-09-27)". Where the build differs from the plan: the
shape is one block with a Rectangle or Line kind rather than two blocks;
the second clock is a panel, so one per layout (any number since the
layout core, 2026-09-27, below); the date and the day count (week number,
day of the year, days left, school days left) are panels.

The plan as written:

Shape and line blocks (fill, gradient, radius, blur), the flip clock as a
panel, an analog clock, a second clock with its own time zone, a date-only
block, week number and day X of Y.

### As built: blocks and clocks (2026-09-27)

Deployed with the hub 2026-09-27 01:34 (build `88877f9`); the kitchen Pi
and the Apple TV were not redeployed. None of the six is on a default
board: the shape arrives through the editor's Add shape, the rest through
Add panel.

| type | label | kind | starting box (x, y, w x h, %) | minimum (%) | "Too small" under | box |
|---|---|---|---|---|---|---|
| `shape` | Shape | block | 40, 44, 20 x 12 | 1 x 1 | never | none (its fill is the shape) |
| `flipclock` | Flip clock | panel | 30, 35, 40 x 30 | 8 x 6 | 110 x 40 px | none (its own case) |
| `analog` | Analog clock | panel | 40, 35, 20 x 30 | 4 x 6 | 48 x 48 px | none (its own face) |
| `clock2` | Second clock | panel | 40, 43, 20 x 14 | 6 x 5 | 90 x 44 px | card |
| `date` | Date | panel | 38, 44, 24 x 12 | 5 x 3 | 60 x 24 px | card |
| `daycount` | Day count | panel | 42, 43, 16 x 14 | 5 x 5 | 70 x 50 px | card, centred |

- **Shape** (`shape`, `panels/ShapeBlock.jsx`): a block like text and
  image (`BLOCK_TYPES` in `layoutSpec.js`: any number per layout, ids
  `shape-<4 hex>`), for a card behind a group of panels, a band of colour
  or a divider. Knobs: `kind` Rectangle (`rect`, the default) or Line;
  `fillPreset` Card (`surface`, the default: the layout's card at its
  opacity, with the card's hairline), Accent, or Custom (the fill colour
  under Fill and border, `bg.color`). A rectangle's look is the box's own
  v2 props: fill, gradient, opacity, border, shadow, blur and radius
  (`Entry/specStyles.js`, `shapeFill` and `boxLook`). A line is a 2 px line
  across the middle of the box in the fill colour, at the fill opacity,
  with the box's shadow; with Card it is drawn in the card's divider ink
  (`--tl-rule`), since a card-coloured line would vanish on the dark
  boards. A shape is never joined into a flush neighbour's card. Its only
  element is its title.
- **Flip clock** (`flipclock`, `panels/FlipClockPanel.jsx`): the Flip clock
  layout's split-flap clock (`Clock/FlipClock.jsx`) in a box, as big as the
  box allows and centred in it. The card height, `--tl-flip-u`, comes from
  the box through container units where the engine has them, else from the
  measured box (a ResizeObserver), both from `lib/clocks.js` `flipFit` and
  within 0.1 px of each other. It keeps its black cards and cream numerals
  whatever the layout's colours. Knobs: `hour24` (off; on, 00 to 23 and no
  tab), `showMeridiem` (the AM / PM tab, on), `showDate` (on), `scale` 0.5
  to 1.5 (1 fills the box; above it the box crops the clock). Elements:
  title, hour, minutes, tab, date (FlipClock gained the markers; the Flip
  clock layout draws the same as before, 0 px).
- **Analog clock** (`analog`, `panels/AnalogClockPanel.jsx`): one SVG face,
  scaled to the box's shorter side and placed by the box's align and
  valign. Knobs: `style` Minimal (hour marks), Classic (the default: minute
  marks too, tapered hands) or Numerals (1 to 12); `showSeconds` (off);
  `handColor` Auto (the text colour, the seconds hand in the accent),
  Accent or Text; `faceOpacity` 0 to 1 (1: the layout's card with its
  hairline; 0, the marks and hands alone). The seconds hand runs its own
  once-a-second timer, a hair past each second so it lands on the second;
  with it off, nothing of its own runs. Elements: title, face, numerals,
  hands.
- **Second clock** (`clock2`, `panels/SecondClockPanel.jsx`): the time
  somewhere else: a label over the time there, then its date and how far
  ahead of or behind the house it is ("Sun, Sep 27" and "+8h"). Knobs:
  `timezone` (an IANA zone, default `Europe/London`, checked with
  `Intl.DateTimeFormat`; one this engine does not know shows the house's
  own time, with a muted "?" after the label and no offset); `label` (up to
  40 characters; empty, the zone's city); `hour24` (off); `showDate` (on);
  `showOffset` (on: "+8h", "+5:30h", a minus sign for behind); `size`.
  Elements: title, label, time, date, offset. A panel, so one per layout
  as built; any number since the layout core ("Layout core", below).
- **Date** (`date`, `panels/DatePanel.jsx`): today's date alone, as large
  as its box allows. Knobs: `format` long ("Saturday, September 26", the
  default), medium ("Sat, Sep 26"), short ("9/26"), dayname ("Saturday")
  or daynumber (a big 26 under a small Sep); `showYear` (off; never with
  the day name alone); `size`; and the universal `align`, declared in its
  schema so the inspector shows it here, centred by default. A long or
  medium date breaks after the weekday's comma, and nowhere else, when two
  lines give bigger type. Elements: title, text, weekday, month, day,
  year, so a part can be styled apart (the day in the accent).
- **Day count** (`daycount`, `panels/DayCountPanel.jsx`): a number and a
  small label under it. Knobs: `show` Week of the year (the default: the
  ISO week, weeks starting Monday), Day of the year ("269" over "Day of
  365"), Days left this year ("96", "Days left in 2026") or School days
  left; `label` (up to 60 characters; empty, the count's own); `size`.
  School days count today while it is one, and the last day itself, by the
  morning countdown's own test for a school day (`isNoSchoolToday`: the
  school's weekdays, the dashboard's no-school dates, the school calendar's
  breaks and session bounds). The last day is `shared.school.lastDay` while
  it is not past, else the school calendar's first last day from today on
  (June 21, 2027 gives 163 on Sat Sep 26). A count that cannot be worked
  out (no last day of school ahead) drops its box on a screen, as the
  alert banner does with no alert; the editor keeps it, with "No last day
  of school yet", so it can be placed. Worked out once a day. Elements:
  title, number, label.
- The clocks read the layout's one `now` (`useTodayData`, once a second);
  the analog seconds hand is the only other timer. `useTodayData` gains
  `schoolCalendar`, the hub's `/api/schoolcal` (`noSchoolRanges`,
  `firstDays`, `lastDays`; null until it answers, live in demo mode). The
  pure parts are `lib/clocks.js` (zones and offsets, the hands' angles, the
  flip clock's fit) and `lib/dates.js` (the date formats, the ISO week, the
  day of the year, the school days left).
- Tests: 37 new in the app (`lib/clocks.test.mjs` 14, `lib/dates.test.mjs`
  9, `blocksAndClocks.test.mjs` 14), green in five machine time zones.
  Pixel diffs with none of the new types on a board: 0 px on the Entry
  board, the Board, the Entry board in edit mode and the Flip clock
  layout.
- The merge with chunk 3: both touched `Entry/SpecBoard.jsx`; a duplicate
  `dateKey` import and a `todayKey` clash (the day count's key is now
  `dayCountKey`) were resolved in `c700150`.
- Shots: `_review/layout-editor/blocks-*` (the app) and `shape-editor-*`
  (the editor), indexed in that folder's README.

### What remains of chunks 3 and 4

- **A screen's own 12 or 24 hour setting.** `timeFormat: 'auto'` on the
  calendar views means the screen's setting, and no screen has one, so
  auto reads 12-hour. A per-screen setting handed to the panels as
  `screenHour24` (they take it already) would give auto a meaning.
  BACKLOG, "Screen 12 or 24 hour setting".
- **The month grid at the hub's edges.** Days past 60 ahead or 31 back
  show as unknown: the next month's trailing days early in a month, the
  next month's own last day or two on the 1st, and a few leading days of
  the current month's grid late in some months ("The month grid at the
  hub's edges", above). BACKLOG, "Month grid past the hub's window".
- **The second clock as a block**: settled without one on 2026-09-27.
  Since the layout core any type repeats, so a board holds a second clock
  per time zone (`clock2`, `clock2-<4 hex>`); the BACKLOG item is closed.
- **A real WeatherKit alert**, still open from chunk 2: BACKLOG,
  "WeatherKit alert spot-check".

## Chunk 5: Home Assistant (BUILT: the hub half 2026-09-26, the screen side 2026-09-27; actions wait on Justin)

Received 2026-09-26: the LAN URL and a long-lived token from the dedicated
local-only user `frameserver`, validated from the Mac and from the hub
(`GET /api/` answers "API running"; the token reads states). Stored at
`~/.config/smart-display/ha-token.txt` and `ha.env`, on the hub at
`secrets/ha-token.txt` with `HA_URL` and `HA_TOKEN_FILE` in `.env`.

Justin's first list, with the entity ids found in HA:

- "Turn Off Downstairs": `light.turn_off` on the group `light.downstairs`
  (no script or scene of that name exists; confirm).
- House modes: `input_boolean.mode_away`, `mode_guest`, `mode_outside`,
  `mode_vacation`, `mode_working_late`, as chips with toggle buttons.
- Day part override picker: `input_select.day_part_override`, options Auto,
  Morning, Day, Afternoon, Evening, Late Evening, Night, Overnight.
- Guest and away: the two modes above, status plus buttons.
- Garage: `cover.garage_door_controller`, indicator and hold-to-confirm
  button. Front door: `lock.front_door_smart_code_with_home_connect_technology`
  (lock by tap, unlock by hold) and `binary_sensor.front_door_contact_open`.
- Basement light: `light.basement_basement` (the room group) or
  `light.basement_light_switch` (the switch's own entity); confirm which.
- Later candidates: `person.justin`, `person.sheena`, the doorbell cameras,
  the Awair sensors, `todo.shopping_list`.

Hub `lib/homeAssistant.mjs` with a long-lived token in `secrets/`, a
dashboard whitelist of entities and actions, a WebSocket subscription folded
into `/api/state`, an action route that logs every call. Panels: indicator
chip, button with hold-to-confirm, toggle, sensor value (the Awair indoor air
sensors), presence chips, camera snapshot, the HA shopping list. Ship with the
dashboard PIN item. Needs: HA's LAN URL, a token from a dedicated non-admin
user, the entity list and the three buttons (garage, lock, leaving); all
received 2026-09-26.

### As built: the hub half (2026-09-26)

Deployed with the hub 2026-09-26 12:49 (build `2fcca07`). At the deploy it
was connected with all 13 entities live (the garage open, the front door
locked, the day part on Auto). No service call has ever been sent to the
real Home Assistant.

- `frameserver/lib/homeAssistant.mjs`: `HA_URL`, and `HA_TOKEN` or
  `HA_TOKEN_FILE` (default `secrets/ha-token.txt`). A WebSocket to
  `<HA_URL>/api/websocket`: auth, `subscribe_events` for `state_changed`, an
  initial `get_states`; reconnect with backoff (5 s doubling to 2 minutes);
  while the socket is down, a REST poll of `/api/states` every 60 s. Only
  whitelisted entities are kept, with a small allowlist of attributes. The
  whitelist is re-read every 5 s, so a dashboard edit reaches memory within
  seconds.
- The whitelist lives in the registry, `shared.ha = { entities: [{ id,
  label, kind }], actions: [{ id, label, entity, service, confirm: tap |
  hold }], actionsEnabled }`, edited on the dashboard. It was seeded once
  from Justin's list above, each entity checked to exist first (all did): 13
  entities (the garage cover, the front door lock and its contact sensor,
  the five modes, the day part select, `light.downstairs`,
  `light.basement_basement`, `person.justin`, `person.sheena`) and 10
  actions:

  | action | service on entity | confirm |
  |---|---|---|
  | Turn off downstairs | `light.turn_off` on `light.downstairs` | tap |
  | Garage | `cover.toggle` on `cover.garage_door_controller` | hold |
  | Close garage | `cover.close_cover` on the garage | hold |
  | Lock front door | `lock.lock` on the front door lock | tap |
  | Unlock front door | `lock.unlock` on the front door lock | hold |
  | Leaving | `input_boolean.turn_on` on `input_boolean.mode_away` | tap |
  | Home | `input_boolean.turn_off` on `input_boolean.mode_away` | tap |
  | Guest mode | `input_boolean.toggle` on `input_boolean.mode_guest` | tap |
  | Basement light | `light.toggle` on `light.basement_basement` | tap |
  | Day part | `input_select.select_option` on `input_select.day_part_override` | tap |

  A stored action carries no data of its own: what a call needs comes with
  the call (`data.option` for the day part, listed in the snapshot as the
  action's `needs`).
- Routes: `GET /api/ha/state` (connection, each whitelisted entity's state,
  label and kind, the actions and whether they are enabled), `POST
  /api/ha/action { actionId, screen, data? }`, `GET /api/ha/entities?q=` (a
  live search for the dashboard's Add entity box, at most 30, with ids in a
  domain that has a kind, such as lights, locks, covers, sensors and people,
  ranked above a device's diagnostics), `GET /api/ha/actions/log`. `/api/state.ha` carries a compact copy (`connected`,
  and per entity its state, a few attributes and when it changed), so a
  screen sees indicators without a second poll. `/healthz.ha` = `{
  configured, connected, actionsEnabled, entities, lastEventAt, error }`.
- Guards on an action, in order: the id must be on the whitelist (else
  404); actions must be switched on (else 403, "actions are disabled on the
  dashboard"); the service must be on its domain's allowlist (lights and
  switches on, off and toggle; covers open, close, stop and toggle; locks
  lock and unlock; input booleans on, off and toggle; `select_option`;
  scenes and scripts on; nothing for the read-only domains), else 400; a
  rate limit of 12 a minute per screen and 60 overall (else 429); only
  allowlisted data keys pass (`option` for `select_option`, `brightness_pct`
  for `light.turn_on`). Every attempt that names an action id, refused or
  not, is logged to `ha-actions.json` (the newest 200). A call Home Assistant
  itself refuses comes back as `{ ok: false }` with the reason.
- **Actions are off by default.** `actionsEnabled` is seeded false, and a
  missing key reads as false. The action route has no authentication beyond
  being on the LAN, so once it is on any device on the Wi-Fi could open the
  garage; the dashboard's "Allow actions from screens" switch stays off until
  a first real press has been watched and the dashboard PIN decided.
- Dashboard: a house-wide "Home Assistant" card with the connection status,
  the entity whitelist with live states and a kind select per row, an Add
  entity search, the action list (label, entity, service, tap or hold), the
  switch, and Recent actions (the newest 20). Review shot:
  `_review/hub/ha-card.png` (taken before the switch was added).
- Tests: 35 new (`frameserver/test/homeAssistant.test.mjs`); with the
  weather feed's the hub suite is 468.

### As built: the screen side (2026-09-27)

Committed as `fb15104` (the button's `showState` default settled in
`736683e`) and deployed with the hub 2026-09-27 10:42 (build `736683e`);
the Echos take it on their next reload, and the kitchen Pi (its own
bundle) and the Apple TV were not redeployed. None of the four is on a
default board: they arrive through Add block's Home group, any number of
each. The dashboard's actions switch is still off, so on a screen every
button and picker draws disabled, and the hub's action log was still empty
at 13:05 that day: nothing has been sent to the house.

| type | label | starting box (x, y, w x h, %) | minimum (%) | "Too small" under | box |
|---|---|---|---|---|---|
| `hastatus` | HA status | 40, 42, 20 x 16 | 6 x 5 | 120 x 44 px | card |
| `habutton` | HA button | 42, 41, 16 x 18 | 5 x 5 | 80 x 48 px | none (the button is its own face) |
| `hachips` | HA chips | 25, 44, 50 x 12 | 8 x 4 | 120 x 30 px | card |
| `hapicker` | HA picker | 15, 42, 70 x 16 | 12 x 6 | 200 x 44 px | card |

`TYPE_TABLE` in `layoutSpec.js` holds those; the knobs and elements are in
`panels/schemas.js`, the pure parts in `panels/haParts.js` (words, tones,
icons, the hold's timing, the refusals, the editor's options), and each
block's "Too small" rule in its own stylesheet (`panels/HaStatusPanel.css`
and the others).

- **HA status** (`hastatus`, `panels/HaStatusPanel.jsx`): one entity as an
  indicator: an icon by its kind, its label (the dashboard's, else Home
  Assistant's friendly name), its state as a word and "since 4:12 pm"
  ("since Sat 9:40 pm" within the week, "since Sep 12" before). Knobs:
  `entity`, `showLabel` and `showSince` (on), `size`, `layout` Side by side
  (`row`, the default) or Stacked. Elements: title, icon, label, state,
  since, empty. Nothing on it is tappable.
- **HA button** (`habutton`, `panels/HaButtonPanel.jsx`): one whitelisted
  action, its entity's icon, its label and a hint line. A tap action fires
  on release, on the button (a finger may stray 12 px); a hold action (the
  whitelist's `confirm: hold`: the garage, unlocking the door) fires once
  the press has lasted 1.2 s, a ring filling round the icon meanwhile, and
  letting go early or sliding off cancels. While the hub answers, the icon
  is a spinner; a press that went through shows a check for 1.5 s; a
  refused one says why for 6 s: "Buttons are off on the dashboard" (403),
  "Try again in a moment" (429), "Not on the whitelist" (404), else "Home
  Assistant unreachable". Knobs: `action`, `size`, `style` Filled or
  Outline, `showState` (the entity's state under the label; off by default
  since `736683e`). Elements: title, icon, label, state, hint. It is a
  `<button>` marked `data-interactive`, so a tap never opens the menu and
  never starts a swipe.
- **HA chips** (`hachips`, `panels/HaChipsPanel.jsx`): several entities as
  small chips in a row that wraps, each its icon, label and state word in
  the status block's tones. Knobs: `entities`, entity ids separated by
  commas (at most 16; the editor has no multi-select), empty for every
  mode on the whitelist; `size`; `showLabels` (on). An id not on the
  whitelist gets a grey chip saying so. Elements: title, chip, label,
  state, empty. Nothing on it is tappable.
- **HA picker** (`hapicker`, `panels/HaPickerPanel.jsx`): an
  `input_select` as a segmented control, the current option lit (the day
  part override: Auto, Morning, Day, Afternoon, Evening, Late Evening,
  Night, Overnight). A tap on another option runs the whitelisted action
  that sets that select and takes an option, sending `data.option`: the one
  the `action` knob names, else (Automatic) the first on the whitelist that
  does (`daypart-set`). A tapped option shows a spinner while the hub
  answers, then an outline until the select's state moves off the old
  option (given up after 30 s). Knobs: `entity`, `action`, `size`, `wrap`
  (on: the options run onto more rows). Elements: title, option, hint.
- The words (`haStateWord`): Closed, Open or "Open 40%" (a cover part
  way), Opening, Closing; Locked, Unlocked, Jammed; Home, Away or the
  zone's name; On, Off; a select's option as written; a sensor's value
  with its unit ("72.4°F"); a binary sensor's by its device class (Open and
  Closed, Detected and Clear); Unavailable, Unknown. The tones (`haTone`):
  calm for the safe states (closed, locked, home, off, and a select's
  option or a sensor's value), amber for open, unlocked, away and on, and
  grey with no state or whenever Home Assistant is not connected, the since
  line then saying "Home Assistant offline" or "Hub unreachable".
- Honest about the rest: "Choose an entity" (a select, an action) with
  nothing chosen, "Not on the whitelist" for an id the dashboard no longer
  lists, "Waiting for Home Assistant" until the first answer. Words that do
  not fit wrap, then shrink (`panels/useHaFit.js`), never truncate.
- **Disabled, and nothing posted**, while the dashboard's actions switch is
  off, the hub or Home Assistant is down, or the action is off the
  whitelist; the hint says which. Should the switch go off inside the
  snapshot's minute, the hub's 403 says so.
- **The store** (`hooks/useHomeAssistant.js`, pure parts in
  `lib/haState.js`): the whitelist's states from the house state
  (`/api/state.ha`, every 10 s on every screen; `lib/houseState.js` now
  carries it, never cached) merged with the hub's snapshot (`GET
  /api/ha/state`: each entity's label, kind and unit, the actions, and
  whether actions are on), each entity reading the fresher of the two. The
  snapshot is fetched only while something needs it: at once and then once
  a minute while a board shows a Home Assistant block (`useHaPolling`) or
  the layout editor's bridge is open, at once after any press, and every 3
  s for 30 s after a press that went through, so the thing pressed updates
  fast. A board without one asks for none. `runHaAction` posts `{
  actionId, screen, data? }` to `/api/ha/action` (the screen's device id)
  and never retries, a 429 least of all. The layout editor's preview
  (`?edit=1`) never posts; `?demo=1` shows a demo whitelist whose presses
  only animate.
- **The editor's live options**: the entity and action knobs are declared
  as text (the spec cannot know the whitelist), and `editBridge.js` sends
  them in its ready as selects of the live whitelist, id to label (hold
  actions marked "(hold)"; a first option None, or Automatic for the
  picker's action), an id the saved layout holds that is off the whitelist
  kept as "<id> (not on the whitelist)". The chips' ids stay text, their
  hint listing the whitelist. The bridge keeps the whitelist polled and
  sends a fresh ready when the options change.
- **Verified** against a mock hub (`_review/layout-editor/ha-proof-report.json`):
  a tap posts 2 ms after release; a hold released at 0.6 s posts nothing;
  held on, one post at 1203 ms; the picker posts `data.option`
  ("Evening"); a 429 is not retried; after an ok, 11 fast polls over 30 s
  and none after; `?edit=1` posts nothing. Pixel diffs against the build
  before, nothing set: 0 px on the Entry board at 1920x1080 and 1280x800;
  the Board's difference at 1280x800 is its weather icons' raster noise, as
  large between two loads of one build; and no default board asked for
  `/api/ha/state` (`ha-diff-results.json`). Tests: 41 new
  (`panels/haParts.test.mjs` 23, `lib/haState.test.mjs` 9,
  `haPanels.test.mjs` 9). Shots: `_review/layout-editor/ha-*.png`, indexed
  in that folder's README.

### What remains of chunk 5

- The first real action, with Justin present, then the dashboard's
  "Allow actions from screens" switch. Until it is on, every HA button and
  picker on a screen draws disabled ("Buttons are off on the dashboard").
- The dashboard PIN, before the switch stays on.
- Justin to confirm two choices in the seed: "Turn off downstairs" as
  `light.turn_off` on the `light.downstairs` group (no script or scene of
  that name exists), and the basement as the room group
  `light.basement_basement` rather than `light.basement_light_switch`.
- The plan's last two blocks: a camera snapshot (a snapshot route on the
  hub; the doorbell cameras on the whitelist) and the shopping list
  (`todo.shopping_list`). The rest of the plan's list is covered: a toggle
  is a button on a toggle action (Guest mode, Basement light), and a
  sensor's value and presence show on the status block and the chips (the
  Awair sensors are not on the whitelist yet).
- Smaller, in BACKLOG: a multi-select field for the chips' entities.

## Layout core (BUILT, deployed 2026-09-27)

Not a chunk of the plan: what the editor's blocks round needed of the app,
and two sets of knobs, built as `736683e` and deployed with the hub
2026-09-27 10:42 (build `736683e`). The editor's half is
`layout-editor.md`, "As built, 2026-09-27: blocks, Delete, the Add block
menu, repeated blocks". At the defaults every board draws as it did.

### Any number of every type

- A layout may hold two weathers or three agendas, each an instance with
  its own box, knobs, element styles and rule; knobs, elements and defaults
  stay per type. Ids (`layoutSpec.js`): a functional type's first instance
  keeps the bare type (`weather`), so every layout saved before reads
  unchanged; further ones are `<type>-<4 hex>` (`weather-3fa9`); text,
  image and shape blocks are suffixed from the first. `typeOfId(id)` is the
  id itself when it is a type, else the part before its first `-`;
  `isInstanceId(type, id)` says whether an id follows the scheme for a
  type.
- `normalizeSpec` keeps every id the scheme allows exactly as saved (never
  renamed), drops a true duplicate (the same id twice: the first wins), and
  gives a panel with no id, or one outside the scheme, the bare type while
  no panel in the list holds it (Contract v1's `{ type: 'clock' }`), else a
  deterministic `<type>-<4 hex>` clear of every id in the list. Ids the
  scheme allows are claimed first, so a made id never takes one a later
  panel carries by right. It is idempotent: a 50-round fuzz test of good,
  duplicated, malformed and missing ids.
- `newPanel(type, overrides, { layoutId, takenIds })` hands out the bare
  type while it is free, else a fresh suffixed id clear of the taken ones.
  The Home Assistant types' own `repeat` flag, from chunk 5's first commit,
  is gone: every type repeats. The type list the editor gets still marks a
  functional type `unique` (its bare id belongs to its first instance), for
  a reader that predates `kind`.
- `Entry/SpecBoard.jsx` works per box wherever it worked per type:
  - The departure countdown still borrows one box (`departureHost`): the
    first countdowns box drawn whose School departure switch is on (off by
    default since 2026-09-28), in the spec's list order, during a school
    morning or a manual timer, else the first now-playing box drawn while a
    countdown runs, whatever their ids or stacking; a layout with a
    departure block of its own, any instance, lends none.
  - An alert box with no alert in force, and a day count that cannot be
    counted, drop alone, each box judged by its own knobs.
  - Each agenda cuts its own days; every calendar block joins the one
    calendar window the board asks for; each photo block keeps its own
    interval and shuffle.
  - Each box is `data-box="<id>"`, so two instances never share a box, a
    card join or a scoped element style, and the bridge reports each by id
    with its elements.

### The hourly forecast: every N hours, or the rest of the day

- `step` "Every" 1, 2, 3 or 4 hours (1): "Now", then the hours on the clock
  the step divides (at 1:20 pm with 3: Now, 3 PM, 6 PM, 9 PM; past
  midnight the count goes on from 12 am).
- `range` "Show": Next hours (`hours`, the default, with `hours` 6 to 24,
  12) or Rest of day (`untilHour`, with `untilHour` "Until" 18 to 24, 6 pm
  to midnight, default 22): from now through that hour, the last column the
  last step hour at or before it, never tomorrow's; late in the evening
  only Now is left. The header then says "Rest of day" instead of
  "Hourly".
- At the defaults the strip is the one it always was (`lib/weatherPanels.js`
  `hourlyColumns`, `hourlyTitle`). The schema marks each range's own field
  with `showIf`, which the inspector does not yet honour on a type's fields,
  so Hours and Until both show (BACKLOG).

### The agenda's rows

- `rowLayout` "Row layout": Time beside (`side`, as it always was), Time
  above (`stacked`: the time in small capitals over the title) or Time
  right (`timeRight`: at the row's end, quieter).
- `titleLines` One or Two (2), then an ellipsis; `dayHeader` Capitals
  (`caps`, as before), Bold (the day in its own words) or Compact (smaller,
  no rule); `rowGap` 0 to 2 (1), a multiplier of the gap between rows.
- Each default is the agenda as it was, pixel for pixel: a knob off its
  default adds a class, so at the defaults the DOM and the styles are
  unchanged. The row size's cap follows the row's shape
  (`panels/agendaDays.js` `agendaRowFit`), so the worst day still fits:
  Time above costs about a quarter of the row size at the same rows per
  day.

### Smaller

- The box schema's words say block: "Top is the block as designed", and
  the block title's first option is "Default", not "Panel". The editor's
  own overrides for those two are now redundant (BACKLOG).
- HA buttons no longer show their entity's state by default
  (`habutton.showState` off).
- The Add block menu's thumbnails: `code/scripts/render-previews.mjs`
  renders a 320 px preview of every type from the demo data into
  `code/public/previews/` (34 PNGs, 0.9 to 29 KB, byte-identical from run
  to run, no family photo, and `index.json`), which the hub serves beside
  the app (`deploy.sh` `HUB_APP_FILES` gained `previews`). How it draws and
  how to run it: `layout-editor.md`, "The previews". Sheet:
  `_review/layout-editor/core-previews-sheet.png`.

### Verified

- Pixel diffs against the build before (`fb15104`), nothing set and every
  board its built-in default, software raster, three loads a build: 0 px in
  all nine pairs for the Entry board at 1920x1080 and 1280x800, its demo at
  1920x1080 and Briefing at 1920x1080. The Board at 1280x800 differs by up
  to 71 px over six loads a build, in the band across its forecast and its
  sun and moon, where its SVG weather icons rasterise a little differently
  from load to load in either build (two loads of this build differ as
  much; 6 of the 36 cross pairs are identical), as seen since chunk 2
  (`_review/layout-editor/core-diff-results.json`).
- Runtime checks on the built app (`core-proofs.json`): with no alert in
  force two alert boxes drop, each on its own, and with one both draw; two
  day counts count their own things, and one that cannot be counted drops
  only its box; two agendas show 3 days and 1; on a school morning the
  first countdowns box in the list borrows the departure, whatever the ids
  or stacking; with a countdown running the first now-playing box borrows
  it and the other plays on; with a departure instance on the layout no box
  borrows; the bridge reports each instance by id; a scoped style reaches
  only its own instance.
- Tests: 19 new (`layoutSpec.test.mjs` 11, `lib/weatherPanels.test.mjs` 4,
  `panels/agendaDays.test.mjs` 4). The app's suite is 265, all passing in
  the house's time zone; two weather tests from chunk 2
  (`lib/weatherPanels.test.mjs`, "hoursFrom" and "rain labels") fail with
  the machine in Pacific/Auckland, because their fixture's hours, built in
  local time, cross New Zealand's clock change at 2 am on 2026-09-27
  (BACKLOG).
- Shots: `_review/layout-editor/core-*.png`, indexed in that folder's
  README.

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
Order: 1, 2, 3, then 4 and 5 as their inputs allow. Chunks 1 and 2 were
done 2026-09-26, and chunks 3 and 4 and chunk 5's screen side on
2026-09-27, with the layout core. What is left of chunk 5 is the first
real Home Assistant action and the switch, and the camera snapshot and
shopping list blocks.
