---
title: "Layout editor - move, resize and tune the boards from a MacBook"
created: 2026-09-24
modified: 2026-09-25
version: 1.6
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, editor, entry, today, layouts, frameserver, dashboard, echo-show]
---

# Layout editor

**Status: all four steps built. Steps 1 and 2 deployed 2026-09-24; steps 3
and 4 (panel knobs, spec v2, sub-elements, smart guides, day parts, the
Board, history, copy) deployed to the hub 2026-09-24 23:45 (build
`309eb66`).** Open a screen's card on the dashboard and press Edit layout (it
opens the Today layout that screen is on), or go to
`http://nuc.local:8095/editor/?device=echo-show15`. What was built, and where
it differs from the contracts: "As built" under each contract below. Review
shots: `_review/layout-editor/`.

A what-you-see-is-what-you-get editor for the screen layouts, used from a
MacBook Pro, so "move it 10 pixels, make the font smaller, shrink the image"
stops being a conversation and becomes a drag. It edits the Entry board
(`entry-board.md`), its day-part variants (Entry phase 2) and the Board
(`today-layouts.md`).

## Decisions (Justin, 2026-09-24)

- Edited on the MacBook only, never on the Echos or the Pis.
- Reached from the admin page: an "Edit layout" button on each screen's card,
  plus a screen picker inside the editor.
- Positions and sizes in **percent of the canvas**, text in canvas-relative
  units, so a layout drawn on the Echo Show 15 (1920x1080) ports to the 10
  (1280x800) and the 5 (960x480).
- Selecting an element exposes its own properties (text size and the rest),
  not only its container.
- Text and image blocks are in the first usable cut.

## How it works

- `http://nuc.local:8095/editor/?device=<id>`: a second Vite entry in
  `code/` (React), shipped in the same bundle the hub already serves.
- The centre is the real app in an iframe at the screen's exact resolution,
  scaled to fit the window (fit, 50%, 100%). Inside an iframe the layout units
  resolve against the iframe, so the render is the Echo's, pixel for pixel,
  with the same fonts and live data.
- The app gains an edit mode (a URL flag the kiosks never carry): no menu, no
  keep-alive, and a message channel to the editor. The editor sends the draft
  layout; the app re-renders at once and reports the rectangle of every panel
  and every sub-element it marks editable. Handles are drawn from those
  rectangles, so they sit on the real pixels.
- Save writes the layout into that screen's registry entry
  (`config.layouts.<layoutId>`); the screen applies it on its next 10 s poll.
  Nothing is pushed while dragging.

## What is stored

One object per screen per layout, `config.layouts.entry` or
`config.layouts.board` in the device registry: the canvas it was drawn on, a global text scale, and the list of
panels, each with its position and size in percent of the canvas, stacking
order, visibility, lock, and its props (universal ones on every panel; text
and image blocks carry their own). The exact shape is in Contract v1 below,
extended by Contract v2, which is what is stored since 2026-09-24.
The backdrop (photos behind the board, the wash) stays on the existing
per-screen display settings, so the dashboard card and the editor edit the
same thing. The built-in board is the default layout; Reset returns to it,
and a tuned screen keeps its layout when the code's default changes.

## The controls

Stage: click selects a panel, click again selects a sub-element (Clock >
Date); drag to move, eight handles to resize, Shift keeps the aspect; arrows
nudge 1 px, Shift-arrows 10 px, with x, y, w, h readouts in canvas pixels;
snapping to a grid (on by default) and Figma-style smart guides to other
panels' edges and centres with distance labels; right-click for forward,
back, hide, lock, reset panel, duplicate; toggles for grid overlay, safe
margins, "freeze data" and "sample data".

Inspector (for the selection): universal properties on every panel (position,
size, text scale, opacity, padding, background none / translucent card /
solid, corner radius, alignment, visible, locked), then the panel's own knobs
from a schema each panel declares, rendered generically (sliders with typed
fields, steppers, segmented controls, toggles, colour swatches); hovering a
control highlights the affected pixels.

Per-panel knobs: Clock (time size, date size, weight, show date, date style,
seconds, greeting); Weather (temperature size, icon size, horizontal or
stacked, high and low, rain chance, description); What to wear (size, icon,
one or two lines); Air quality (chip or inline, size, PM2.5); Headline (size,
weight, dot, max lines); Agenda (days 1 to 5, rows per day, row size, header
size, time format, all-day label, dim finished, column gap, colour bars);
Countdowns (max tiles, card / bare / image-only, image size, title size,
number size, unit label, gap, art or emoji preference); Departure (number
size, walk or drive toggle); Text block (text, size, weight, colour, align);
Image block (a Countdown Art picture or a URL, fit); Backdrop (photos, wash,
blur, scrims, interval); Global (Inter or Fraunces, accent, text colour,
surface opacity, radius, grid spacing).

Layers: stacking order by drag, eye and lock, add a text or image block.

Top bar: screen picker, layout picker (Entry; Board later), day-part tabs
once Entry phase 2 exists, undo and redo, Save, Revert to saved, Reset to
default, Copy layout to another screen, a history of the last ten saves per
screen. Keyboard: Cmd-Z, Shift-Cmd-Z, Cmd-S, Delete hides, Esc deselects.

## Effort (agent days) and order

1. Layout spec, data-driven Entry renderer, panels reading their knobs, edit
   mode and the message channel: 1.5.
2. The editor page: stage, move, resize, snapping, nudge, universal
   properties, text and image blocks, save, revert, reset, the dashboard
   button: 1.5. Usable from here.
3. Per-panel schemas and the full inspector, sub-element selection, smart
   guides, layers, undo and redo, history: 1.5.
4. Day-part tabs (Entry phase 2), the Board layout, copy to screen,
   verification on the Echo 15, docs: 1.

All four were built between 2026-09-24 and 2026-09-25.

## Not in scope

Rearranging a panel's internals beyond its declared knobs; editing on the
Echos or Pis; any login (the hub is LAN-only, like the dashboard).

## Contract v1 (steps 1 and 2)

Both halves are built against this. Changing it means changing both.

### The spec

Stored in the device registry at `config.layouts.entry` (DEVICE scope; the
app adds `layouts` to `DEVICE_SCOPE` so it rides the normal 10 s poll).
`null` or absent means "use the built-in default". Percent positions, canvas
pixels only for readouts.

```
{
  version: 1,
  canvas: { w: 1920, h: 1080 },       // what it was drawn on (informational)
  global: { textScale: 1 },           // multiplies every panel's text scale
  panels: [
    { id: 'clock', type: 'clock',     // functional panels: id === type
      x: 2.4, y: 3, w: 56, h: 30,     // percent of the canvas, 2 decimals
      z: 1, hidden: false, locked: false,
      props: {                         // universal props, all optional
        textScale: 1,                  // 0.5 .. 2
        opacity: 1,                    // 0.1 .. 1
        padding: 1,                    // 0 .. 3, multiplier of --tl-pad
        background: 'none',            // 'none' | 'card' | 'solid'
        radius: 1,                     // 0 .. 3, multiplier of --tl-radius
        align: 'start',                // 'start' | 'center' | 'end' (text)
      } },
    { id: 'text-7f3a', type: 'text', x, y, w, h, z, hidden, locked,
      props: { text: 'The Nikolaus House', size: 4, weight: 600,
               color: '#f2f2f0', align: 'center', lineHeight: 1.15,
               ...universal } },           // size = percent of canvas height
    { id: 'image-9c21', type: 'image', x, y, w, h, z, hidden, locked,
      props: { src: '/countdown-art/<file>' | 'https://...', fit: 'contain',
               ...universal } },
  ],
}
```

Functional panel types in Entry: `clock`, `weather`, `wear`, `airquality`,
`headline`, `agenda`, `countdowns` (shows the departure countdown inside the
same box during a school morning, as today). Each appears at most once.
Blocks (`text`, `image`) may appear any number of times, ids `text-<4 hex>` /
`image-<4 hex>`. The backdrop stays on the existing per-screen settings
(`display.entryBackdrop`, `display.entryDim`), edited by the dashboard card
and by the editor's Backdrop section alike; the spec never duplicates it.

The default spec (`DEFAULT_ENTRY_SPEC` in
`code/src/views/TodayLayouts/layoutSpec.js`) reproduces the phase 1 board:
the renderer draws the default and a saved spec through the same code path.
`normalizeSpec(raw)` returns a valid spec from anything (unknown types
dropped, numbers clamped, missing universal props filled), and is applied on
read by the app and before save by the editor.

Render rules: each panel is an absolutely positioned wrapper
(`left/top/width/height` in %, `z-index`, `opacity`, padding and radius from
the multipliers, background per the option) with `container-type: size` so
the panels' container units track the box; `--tl-text-scale` on the wrapper =
`global.textScale * props.textScale`, and every panel font size is multiplied
by `var(--tl-text-scale, 1)`. Hidden panels are not rendered. Panels keep a
minimum size below which they show a quiet "too small" instead of overflowing.

### Edit mode in the app

`?edit=1` on the app URL. The editor loads the app in an iframe at
`/?device=<id>&layout=entry&edit=1&view=today` on its own origin. In edit
mode the app:

- never writes: no settings PATCH, no Sonos heal, no countdown POST, no photo
  flag (`READ_ONLY` in settings.js). It still registers (never overwrites)
  and polls, so it shows that screen's real settings and saved spec.
- runs no kiosk behaviour: no EchoMode, no reload-on-deploy, no dim overlay
  (forced awake), no menu pill, no boot Sonos override, view fixed to Today.
- renders the draft spec the editor sends instead of the saved one, once one
  has arrived.
- marks every panel wrapper with `data-panel-id` and `data-panel-type`.

Messages (`window.postMessage`, same origin; editor = parent):

| direction | message |
|---|---|
| app -> editor | `{ type: 'sd-edit:ready', layoutId: 'entry', canvas: { w, h }, savedSpec: <spec or null>, defaultSpec, panelTypes: [...] }` on mount and whenever the saved spec changes on the hub |
| editor -> app | `{ type: 'sd-edit:spec', spec }` render this draft |
| editor -> app | `{ type: 'sd-edit:hover', id \| null }` subtle highlight |
| editor -> app | `{ type: 'sd-edit:sample', on }` demo data on or off (fills empty states so there is something to lay out) |
| editor -> app | `{ type: 'sd-edit:ping' }` reply with `sd-edit:ready` |
| app -> editor | `{ type: 'sd-edit:rects', canvas: { w, h }, panels: [{ id, type, x, y, w, h }] }` in iframe pixels, after every render and resize, throttled to about 100 ms |

`canvas` in these messages is the iframe's own `innerWidth` x `innerHeight`,
which the editor sets to the screen's resolution.

### The editor

- `code/editor.html` + `code/src/editor/` (React), a second Vite entry in the
  same bundle; the hub serves it at `/editor/` (`app/editor.html`, meta
  injected like index.html) and the dashboard's screen card links
  `Edit layout` to `/editor/?device=<id>`.
- Screen size: the hub records each screen's viewport in memory from a
  `?screen=WxH` query on the config poll (like `lastSeenAt`), exposed as
  `screen: { w, h }` on `/api/devices`; the editor uses it, else the saved
  spec's canvas, else a picker (1920x1080, 1280x800, 960x480, custom).
- Writes: `PATCH /api/devices/<id>/config` with `{ layouts: { entry: spec } }`;
  reset with `{ layouts: { entry: null } }`. Nothing writes while dragging.
- Step 2 scope: stage with zoom (fit, 50%, 100%), selection, move, resize
  (eight handles, Shift keeps aspect), grid snapping (toggle; 20 canvas px
  default, adjustable), arrow nudges (1 px, Shift 10 px), x/y/w/h readouts
  and fields, universal properties, text and image blocks (add, edit, remove),
  layers list (order, eye, lock), undo and redo, Save, Revert to saved, Reset
  to default, sample data toggle, screen picker, backdrop section (photos on
  or off, wash), and the dashboard button.

### As built (deviations from the draft contract, 2026-09-24)

- Edit mode **reads** the screen's config; it never registers (registration
  can rename or create) and never writes: no settings PATCH, no Sonos heal,
  no countdown POST, no photo flag, no `layouts` write-back from the app.
- Edit-mode polls carry `?edit=1` and no `screen`; the hub skips the
  last-seen stamp and the viewport record for them, so an open editor cannot
  make a dead screen look alive or overwrite its real size.
- `sd-edit:ready` is sent after the first hub answer (at most 2 s), and again
  only when the saved spec changes; a `sd-edit:ping` always gets an immediate
  reply. Unchanged `sd-edit:rects` are not re-sent (the board re-renders every
  second); they always follow a spec, a ping, a resize or a mount.
- `sd-edit:spec` with `spec: null` drops the draft (back to the saved layout).
- `sd-edit:display` `{ display: { entryBackdrop, entryDim } }` previews the
  backdrop before Save; `null` clears the preview.
- The editor saves only the half that changed (layout, backdrop, or both in
  one PATCH). A draft identical to the built-in board saves as
  `layouts.entry = null`.
- Flush-stacked cards (same left edge and width, one's bottom on the other's
  top, same background) render as one card with a divider, which is how the
  phase 1 weather / what-to-wear / air-quality card is rebuilt from three
  boxes.
- Text scale: `em` sizes follow their parent; art does not scale (weather
  icon, wear glyph, countdown art and emoji, calendar glyph); the air quality
  square scales with its number. A functional panel missing from a saved
  spec is simply not drawn. `align` affects the clock, the headline and text
  blocks for now.
- The default spec (percent): clock 2.4 / 3 / 54.58 / 30.63; headline
  2.4 / 35.59 / 54.58 / 9.91; weather 58.08 / 3 / 39.52 / 20.4; wear
  58.08 / 23.4 / 39.52 / 14.45; air quality 58.08 / 37.85 / 39.52 / 7.65;
  agenda 2.4 / 47.45 / 54.58 / 49.55; countdowns 58.08 / 47.45 / 39.52 /
  49.55. Pixel-identical to phase 1 at 1920x1080 within 0.3% of pixels; at
  1280x800 every edge is within 2 px (the old grid's gaps were in `vw`, so
  no single percentage fits both sizes exactly).
- The hub also serves `/editor/<file>` (the page's relative asset URLs
  resolve under `/editor/`) and `/editor.html`. In dev, `?app=<url>` points
  the editor's iframe at another app origin.
- The editor keeps its own copy of the normaliser for editing-time clamps
  (it must write a valid spec whatever the app build in the iframe is) and
  runs the app's `normalizeSpec` as the final pass before Save, so what is
  saved is exactly what the app renders.
- Also fixed on the way: a screen's self-registration no longer undoes a
  rename made on the dashboard (the hub applies a rename only to a
  `{ id, name }` body).

### Known incident (2026-09-24) and the safety nets

The very first live save from the editor (the Echo Show 15's board, one
clock nudge) stored a layout in which six other panels had moved: the
headline at the bottom, the cards gone, the countdown column narrowed. The
Echo showed it for under a minute before the layout was reset to the default
by hand. Six replays could not reproduce it: a fresh load, single and
repeated nudges, the canvas switching from the picker to the screen's real
size (which arrived from the hub mid-session that first time), clean and
dirty drafts. What is in place now:

- The hub keeps the previous `config.layouts` of a screen on every change,
  ten deep, in `layout-history.json`: `GET /api/devices/<id>/layout-history`
  (newest first); restore with `PATCH /api/devices/<id>/config` and
  `{ "layouts": <entry.layouts> }`, or `{ "layouts": { "entry": null } }` for
  the default. The editor's History menu (step 3) sits on this.
- The editor logs every action that changed the draft to
  `window.__sdEditorLog` (last 200, with each panel's geometry before and
  after) and warns on the console when one action moves more than one
  panel's box, which is the signature of that save. If a board ever looks
  rearranged after a save, open the editor's console before reloading.
- Undo, Revert to saved and Reset to default were already there.

## Contract v2 (steps 3 and 4)

Adds to v1; nothing in v1 changes shape except `version` becoming 2 (the app
and the editor read v1 unchanged and write v2).

### Panel knobs and schemas

Every functional panel declares its knobs in `views/TodayLayouts/panels/schemas.js`
(pure data, no React):

```
export const PANEL_SCHEMAS = {
  clock: { fields: [
    { key: 'timeSize',  label: 'Time size',  type: 'number', min: 0.5, max: 2.5, step: 0.05, default: 1, unit: 'x', element: 'time' },
    { key: 'dateSize',  label: 'Date size',  type: 'number', min: 0.5, max: 2.5, step: 0.05, default: 1, unit: 'x', element: 'date' },
    { key: 'weight',    label: 'Weight',     type: 'select', options: [[300, 'Light'], [400, 'Regular'], [600, 'Semibold'], [700, 'Bold']], default: 300, element: 'time' },
    { key: 'showDate',  label: 'Date',       type: 'toggle', default: true, element: 'date' },
    { key: 'dateStyle', label: 'Date style', type: 'select', options: [['long', 'Thursday, September 24'], ['short', 'Thu, Sep 24']], default: 'long', element: 'date' },
    { key: 'showSeconds', label: 'Seconds',  type: 'toggle', default: false, element: 'time' },
    { key: 'showGreeting', label: 'Greeting', type: 'toggle', default: false, element: 'greeting' },
  ] },
  ...
}
export const GLOBAL_SCHEMA = { fields: [ font, accent, text, surfaceOpacity, radius ] }
```

Field types: `number` (min, max, step, unit; a slider with a typed field),
`select` (options as `[value, label]`; a segmented control up to four options,
else a dropdown), `toggle`, `color` (hex), `text`. `element` names the
sub-element the field belongs to (a `data-edit` key inside the panel), so
selecting that element in the editor scrolls to and highlights its fields.
Knob values live in the panel's `props` next to the universal ones; the
schema's `default` fills a missing value. Knobs per panel:

- clock: as above.
- weather: tempSize, iconSize, layout (horizontal | stacked), showHighLow, showRain, showDescription.
- forecast: days (3..7), size, showHighLow, showIcons.
- sunmoon: size, showMoon.
- wear: size, showIcon, lines (1 | 2).
- airquality: style (chip | inline), size, showPm25.
- headline: size, weight, showDot, maxLines (1..3).
- agenda: days (1..5), startDay (today | tomorrow), rowsPerDay (2..10), rowSize, headerSize, timeFormat (12h | 24h), showAllDayLabel, dimPast, columnGap, showColorBars.
- countdowns: maxTiles (1..4), tileStyle (card | bare | imageOnly), tileBorder (color | none), tileBackground (card | none | solid), tileRadius (0..3), imageSize, titleSize, numberSize, showUnit, gap, prefer (art | emoji).
- departure: numberSize, showToggle.
- nowplaying: size, showArt, showProgress.
- photo: intervalMs (15 s .. 10 min), fit (cover | contain), showCaption, showCounter.
- school: size, showLunch, showActivities.
- text, image: their existing props are their schema.

Global (`spec.global`): `textScale` (v1), plus `font` (inter | fraunces, the
display sizes), `accent` (hex), `text` (hex), `surfaceOpacity` (0.1..1, the
translucent card), `radius` (0..3 multiplier). Applied as CSS variables on the
layout root.

The countdown tiles' border, background and radius are knobs (Justin's
report: they could not be changed in v1); `tileStyle: bare` gives naked
art, title and number.

### Sub-elements

Panels mark their inner elements with `data-edit="<key>"` (optional
`data-edit-label`). The bridge reports them in `sd-edit:rects` as
`elements: [{ panelId, key, label, x, y, w, h }]`. `sd-edit:hover` accepts
`{ id, element }` and the app highlights that element. Sub-elements are not
positionable; selecting one focuses its knobs.

### Panel type registry (every layout)

clock, weather, forecast, sunmoon, wear, airquality, headline, agenda,
countdowns, departure, nowplaying, photo, school, text, image. Functional
types are unique per layout and may be absent; the editor's "Add panel" lists
the missing ones. `countdowns` shows the departure countdown during a school
morning unless the layout has its own `departure` panel; `nowplaying` does
the same (the Board's rule). `photo` is the Board's tile; the Entry board's
full-bleed backdrop stays a backdrop, not a panel.

### Day-part variants (Entry phase 2)

```
layouts.entry = {
  version: 2, canvas, global, panels,           // the base: "Day"
  eveningFrom: 18,                              // hour, per layout
  variants: {                                   // each optional
    morning: { panels, global? },
    evening: { panels, global? },
    weekend: { panels, global? },
  },
}
```

`resolveDaypart({ now, school, noSchoolToday, spec })`, pure, in
`layoutSpec.js`: `weekend` on Saturday and Sunday when that variant exists;
else `morning` inside the school-morning window on a school day when it
exists; else `evening` from `eveningFrom` until midnight when it exists; else
`day`. The app renders the resolved variant's panels (its `global` overriding
the base's when present). A variant is created in the editor as a copy of the
base ("Create Morning from Day") and removed to fall back to the base.
`sd-edit:daypart { daypart: 'day' | 'morning' | 'evening' | 'weekend' | null }`
forces the preview (null follows the clock). `sd-edit:ready` gains `schemas`
(per type), `globalSchema`, `dayparts` (the list) and `layoutId`.

### The Board

`layoutId: 'board'` is spec-rendered by the same machinery with a default
spec measured from its 12x6 grid (clock 1-4/1-3, weather 5-8/1-3, photo
9-12/1-4, forecast 1-4/4-6, sunmoon 5-8/4-5, wear 5-8/6, nowplaying 9-12/5-6),
its root keeping the `tl-board` palette. Stored at `config.layouts.board`.
The editor's layout picker offers Entry board and Board; the iframe carries
`&layout=<id>`; the dashboard's Edit layout button opens whichever Today
layout the screen is on.

### Editor additions

Schema-driven inspector; click-into sub-elements (breadcrumb Clock > Date);
smart guides to other panels' edges and centres with distance labels;
"Add panel" for missing functional types; day-part tabs (Day, Morning,
Evening, Weekend) with create / remove and the preview message; History
(from `GET /api/devices/<id>/layout-history`, load an entry as the draft);
Copy layout to another screen (PATCH that screen's `layouts.<id>`, with a
confirm naming both screens); Global section from `GLOBAL_SCHEMA`.

### As built (steps 3 and 4, 2026-09-24/25)

Built overnight on `feature/echo-hub` (commit `309eb66`, with the flip clock
`adbf1d9` before it) and deployed to the hub 2026-09-24 23:45 (build
`309eb66`). The Entry board's per-panel scrim, a new universal prop, followed
on 2026-09-25 (`entry-board.md`, phase 1.5). Contract v2 above stays the
reference; this is where the build differs from it or adds to it.

**The spec** (`views/TodayLayouts/layoutSpec.js`): `{ version: 2, canvas,
global: { textScale, font, accent, text, surfaceOpacity, radius }, panels,
eveningFrom, variants?: { morning?, evening?, weekend? } }`.

- Positions keep three decimals (`POSITION_PLACES`), not two. Chrome rounds
  a percentage length down to 1/64 px, and two decimals of a percent are
  0.128 px steps across 1280 px, so a Board edge could miss its old grid line
  by up to 4/64 px, enough to move text by a subpixel. Three decimals reach
  every 1/64 px on screens up to 1920 px. The editor's own edits still write
  two (they go through whole canvas pixels first); see Known nits.
- An explicit `null` reads as absent everywhere: a variant, a variant's
  global, a knob. The hub's config PATCH deep-merges, so a key simply left
  out of a save would survive from the stored copy; the editor sends `null`
  for every key the stored copy has and the draft dropped (`withRemovals` in
  `editor/spec.js`), and the hub stores the null.
- `eveningFrom`: a whole hour, 12 to 23, default 18, on every saved spec,
  the Board's included (it has no variants; harmless).
- `normalizeSpec(raw, { layoutId, defaultSpec })` fills from that layout's
  defaults; a v1 spec reads unchanged and is written back as v2. A missing
  prop is filled from the layout's default board, which is how a spec saved
  before `scrim` existed gets the Entry board's soft scrims on the clock and
  the headline.
- Helpers: `resolveDaypart({ now, school, noSchoolToday, spec })`,
  `variantPanels(spec, daypart)` (a variant's `global` merged over the
  base's), `withVariant`, `withoutVariant`, `newPanel(type, overrides, {
  layoutId })` (that layout's default box and props for the type, else the
  type's own starting box above the built-in panels, as a card), `knobsOf`,
  `visiblePanels`, `cardJoins`.

**Knobs** (`views/TodayLayouts/panels/schemas.js`): `PANEL_SCHEMAS` for
clock, weather, forecast, sunmoon, wear, airquality, headline, agenda,
countdowns, departure, nowplaying, photo and school; `PANEL_ELEMENTS` (each
panel's `data-edit` sub-elements and their labels); `GLOBAL_SCHEMA`;
`knobDefaults`; `panelKnobs`. The fields are as listed under "Panel knobs and
schemas", with these differences:

- Clock `dateStyle` has a third option, `day` ("Thursday").
- Countdowns: `tileStyle` card, bare or imageOnly; `tileBorder` color (the
  calendar's colour) or none; `tileBackground` card (translucent), solid or
  none; `tileRadius` 0 to 3; `imageSize` 0.25 to 1 (the art already fills
  what the text leaves, so it can only shrink). This closed Justin's report
  that the tile border and background could not be changed.
- Photo `intervalMs` is a select, not a range: "Screen setting" (0, the
  default: the screen's own slideshow interval, bounded to 15 s..10 min as
  the Board's tile always was), then 15 s to 10 min.
- Global: `font` inter or fraunces (the display sizes), `accent` default
  `#d9a066`, `text` default `#f2f2f0`, `surfaceOpacity` 0.1 to 1 default
  0.5, `radius` 0 to 3 default 1, applied on the layout root as
  `--tl-font-display`, `--tl-accent`, `--tl-fg` (and `--tl-fg-rgb`),
  `--tl-surface-alpha` and `--tl-radius-scale`. Grid spacing is an editor
  preference (10, 20 or 40 canvas px), not part of the spec.
- Every panel takes a `knobs` prop, applied through CSS variables and, for a
  per-element size, a redefinition of `--tl-text-scale` on that element. A
  panel handed no knobs (Briefing, Ambient) renders exactly as before. With
  every knob at its default both boards are pixel-identical to before: 0 of
  2,073,600 px differ at 1920x1080 for the Entry board (afternoon and school
  morning) and the Board (`_review/layout-editor/panels-diff-results.json`).

**The Board is a spec layout.** `config.layouts.board`, with
`DEFAULT_BOARD_SPEC` measured from its 12 x 6 grid at 1280x800 (the Echo
Show 10) and the knobs it sets against the schema defaults: clock weight 600
with the greeting, weather stacked, forecast 4 days. Both boards draw through
`Entry/SpecBoard.jsx`. The Board is pixel-identical at 1280x800; at
1920x1080 every x edge is within 0.02 px and some rows sit up to about 3 px
off (the old grid's gaps were in `vw`, so no one percentage fits both
sizes).

**The departure countdown borrows a box.** A layout with its own `departure`
panel shows it there, always. Without one it takes the `countdowns` box
during a school morning on a school day, or while a manual timer runs at any
hour (the Entry board's rule), else the `nowplaying` box while a countdown
actually runs (the Board's rule). One box at most.

**Data limits handled.** The calendar hook asks the hub for 6 days and the
daily forecast for 7, so the agenda's knobs (1 to 5 days, from today or
tomorrow) and the forecast's (3 to 7 days) have data. Four countdown tiles
also need `countdownMax` 4 on the dashboard's Calendars card (the hub caps
the list; default 3).

**The bridge** (`views/TodayLayouts/editBridge.js`):

| direction | message |
|---|---|
| app -> editor | `sd-edit:ready { layoutId, canvas, savedSpec, defaultSpec, panelTypes, schemas, globalSchema, dayparts, specVersion }` |
| app -> editor | `sd-edit:rects { layoutId, daypart, canvas, panels: [{ id, type, x, y, w, h }], elements: [{ panelId, key, label, x, y, w, h }] }`, sub-elements capped at 60 per panel and 400 in all |
| editor -> app | `sd-edit:spec { spec, layoutId }` (a `layoutId` that is not the layout on screen is ignored) |
| editor -> app | `sd-edit:hover { id, element }`: that box, and inside it every element whose `data-edit` is `element` |
| editor -> app | `sd-edit:daypart { daypart }` (`null` follows the clock again) |

`sd-edit:sample`, `sd-edit:ping` and `sd-edit:display` are as in v1.

**The editor** (`code/src/editor/`):

- The inspector is drawn from the schemas: a select is a segmented control
  when its options fit (up to four short labels), else a dropdown. Hovering a
  field outlines the element it tunes on the stage.
- Click into a panel's sub-elements (breadcrumb "Countdowns > Tile"), with
  hover outlines on the stage; a key that repeats (every tile, every agenda
  row) outlines every instance. Esc goes up one level.
- Smart guides to the other panels' edges and centres and the canvas's, with
  distance labels, within 6 canvas px; a guide wins over the grid. A resize
  snaps only the edges that move.
- Add panel lists the functional types the layout lacks and places them with
  `newPanel`; taking a functional panel off the layout is undone by Add
  panel.
- Day-part tabs (Day, Morning, Evening, Weekend; Entry board only): "Create
  Morning from Day" copies the base, Remove drops the variant, and on a
  variant's tab "Follow Day" drops its own global so it follows Day's again.
- History, from the hub's layout history: the stored copy before each save,
  newest first; loading one makes it the draft (Save puts it back, Undo drops
  it).
- Copy layout to another screen writes that screen's `layouts.<id>` with
  this screen's saved layout (not the draft), after a confirm naming both
  screens; the backdrop stays each screen's own.
- Undo and redo: 100 steps each way per document, not per tab; undoing a
  change made on another tab jumps to that tab. A drag, a slider run or a
  burst of typing is one step. `window.__sdEditorLog` records each action
  once.
- The dashboard's Edit layout opens the Today layout the screen is on
  (`&layout=entry` or `&layout=board`).

**Not built from the design** (and not asked for since): the right-click
menu (forward, back, hide, lock, reset panel, duplicate), the safe-margins
overlay and the "freeze data" toggle. Stacking, hiding and locking live in
the layers list.

**Known nits** (in BACKLOG):

- A centred multi-line headline stays left-aligned inside its block
  (`Entry/SpecPanel.css`).
- Board saves carry `eveningFrom` (harmless).
- The editor rounds positions to two decimals when it loads a spec, so a
  Board saved from the editor loses the default's third decimal on every box
  (edges can move by up to 4/64 px at 1280x800).

Review shots: `_review/layout-editor/editor3-*.png` (the editor),
`panels-*.png` (the knobs), `spec2-*.png` (the v2 renderer, the Board as a
spec layout, day parts) and `clock-*.png` (the flip clock,
`today-layouts.md`). The index is that folder's README.
