---
title: "Panels and controls - more panel types, generic element styles, WeatherKit, calendar views"
created: 2026-09-26
modified: 2026-09-26
version: 1.4
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, layout-editor, panels, weather, weatherkit, attribution, calendar, countdowns, countdown-tiles, home-assistant, echo-show, frameserver]
---

# Panels and controls

**Status: chunks 1 and 2 built and deployed 2026-09-26. Chunk 1 went to the
hub at 12:49 (build `2fcca07`; as built in `layout-editor.md`, "As built,
chunk 1 (2026-09-26)") with the hub halves of chunk 2 (the one weather
feed, on Apple WeatherKit) and chunk 5 (Home Assistant, actions off).
Chunk 2's app half (the screens on the feed, four weather panels, the
forecast's Bars style, Apple's mark) and the countdown tiles followed at
15:31 (build `0f13224`). Not built: chunk 3 (the calendar views, next),
chunk 4 and chunk 5's panels.** The plan of record for the layout editor's
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
  `showWind` off; `size`. Elements: title, hour, icon, curve, temp, feels,
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

## Chunk 5: Home Assistant (hub half BUILT 2026-09-26; panels not built)

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

### What remains of chunk 5

- The panels: indicator chip, button with hold-to-confirm, toggle, sensor
  value, presence chips, camera snapshot, the shopping list.
- The first real action, with Justin present, then the switch.
- The dashboard PIN, before the switch stays on.
- Justin to confirm two choices in the seed: "Turn off downstairs" as
  `light.turn_off` on the `light.downstairs` group (no script or scene of
  that name exists), and the basement as the room group
  `light.basement_basement` rather than `light.basement_light_switch`.

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
Order: 1, 2, 3, then 4 and 5 as their inputs allow. Chunks 1 and 2 are done
(2026-09-26); chunk 3 is next.
