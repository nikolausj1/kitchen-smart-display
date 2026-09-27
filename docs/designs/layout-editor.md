---
title: "Layout editor - move, resize and tune the boards from a MacBook"
created: 2026-09-24
modified: 2026-09-27
version: 1.8
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, editor, entry, today, layouts, frameserver, dashboard, echo-show, element-styles, fonts, visibility-rules, block-types, shape]
---

# Layout editor

**Status: all four steps built. Steps 1 and 2 deployed 2026-09-24; steps 3
and 4 (panel knobs, spec v2, sub-elements, smart guides, day parts, the
Board, history, copy) deployed to the hub 2026-09-24 23:45 (build
`309eb66`). The next round's editor foundations (`panels-and-controls.md`,
chunk 1: element styles, box v2, fonts, visibility rules, multi-select, copy
and paste style) deployed to the hub 2026-09-26 12:49 (build `2fcca07`).
Its chunk 4 half (block types from the app, the shape block, panels of
types the app does not know kept as stored) deployed to the hub 2026-09-27
01:34 (build `88877f9`).** Open a screen's card on the dashboard and press
Edit layout (it opens the Today layout that screen is on), or go to
`http://nuc.local:8095/editor/?device=echo-show15`. What was built, and where
it differs from the contracts: "As built" under each contract below, then
"As built, chunk 1 (2026-09-26)" and "As built, chunk 4 and the shape block
(2026-09-27)" at the end. Review shots: `_review/layout-editor/`.

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
  (edges can move by up to 4/64 px at 1280x800). Since 2026-09-26 only on
  the boxes a save changes, and on every box of the first save over the
  built-in default: an untouched panel goes back exactly as stored ("As
  built, chunk 1", The editor).

Review shots: `_review/layout-editor/editor3-*.png` (the editor),
`panels-*.png` (the knobs), `spec2-*.png` (the v2 renderer, the Board as a
spec layout, day parts) and `clock-*.png` (the flip clock,
`today-layouts.md`). The index is that folder's README.

## As built, chunk 1 (2026-09-26)

The editor foundations from `panels-and-controls.md` ("Chunk 1: editor
foundations"), built on `feature/echo-hub` (commit `2fcca07`) and deployed to
the hub 2026-09-26 12:49 (build `2fcca07`). The Echos load the app from the
hub and take it on their next reload (Echo mode checks the build stamp every
5 minutes). The kitchen Pi serves its own bundle (`812242f`), which predates
this, and shows Framed Today, so nothing changes there until its next deploy.
Contract v2 stays the reference; everything below is optional and adds to it.

**Nothing at the defaults.** Each new prop, each field inside one, and a
panel's `when` are absent unless set: `normalizeSpec` fills none of them,
drops every field at its default and reads an explicit `null` as absent. A
spec that never used them normalises byte for byte as it did before, and a
panel nobody styled carries none of these keys.

### The spec additions

- `props.elements = { <key>: { hidden, size, weight, color, spaceAbove,
  spaceBelow, tracking, caps, fit } }`, keyed by `PANEL_ELEMENTS[type]`
  (`panels/schemas.js`); a key the type does not mark is dropped.
  `ELEMENT_STYLE_SCHEMA` (`layoutSpec.js`): `size` 0.5 to 2.5 (x), `weight`
  Auto or 300 to 800, `color` a hex or none, `spaceAbove` and `spaceBelow` 0
  to 3 (multiples of `--tl-pad`), `tracking` -0.05 to 0.2 em, `caps`, `fit`
  wrap (the default: as designed), shrink or clip.
- Box v2, universal props beside `background`, which stays the preset
  (`BOX_SCHEMA`): `bg { color, color2, gradient: none | down | right |
  diagonal, opacity 0..1 }`, `border { width 0..4 (px at 1920 wide, scaling
  with the screen), color }`, `shadow: none | soft | strong`, `blur` 0 to 20,
  `font: 'inherit' | <font id>`, `color` (the box's text colour; not on text
  blocks, whose own `color` prop is their colour), `valign: top | middle |
  bottom`, `title { mode: default | custom | none, text }` (up to 120
  characters).
- `panels[i].when = { all?: Cond[], any?: Cond[] }`, `Cond = { kind, not?,
  daypart?, from?, to?, days? }`, at most 20 read per list (`RULE_KINDS`,
  `normalizeWhen`). A condition that is not one (an unknown kind, a malformed
  time or day part) is dropped by the normaliser.

### How element styles draw

- One `<style>` per box (`Entry/specStyles.js`, `elementStylesCss`, applied by
  `SpecPanel`), scoped `[data-box="<id>"] [data-edit="<key>"]`, so a key that
  marks several elements (every agenda column, every countdown tile) styles
  them all. Declarations are `!important` where a panel sets the same
  property inline or more specifically (the clock's weight knob is an inline
  `font-weight`). Weight, colour, letter spacing and capitals are written for
  the element's children too. `PANEL_ELEMENTS` lists an outer key before the
  keys it holds (a tile before its number), so the inner key's own style
  wins.
- **Size composes; it never writes a font size.** A marked element's text
  scale is `--tl-text-scale = --tl-knob-scale x --tl-el-size x --tl-el-fit`:
  `--tl-knob-scale` is the box's scale times the panel's own size knob for
  that element (`tokens.css`, "Panel knobs"), `--tl-el-size` the style's size
  and `--tl-el-fit` the shrink factor. Every font size in the panels already
  multiplies by `--tl-text-scale`, so an element's size, its knob and the
  fitter multiply whichever holds the other, and at the defaults the product
  is the knob's alone. Art (icons, countdown pictures) keeps its size.
- `fit: 'shrink'` is `lib/fitText.js` with `Entry/useFitText.js`, one fitter
  per box that has a shrinking element. It writes `--tl-el-fit` (1 or less)
  inline on the element: measure the overflow at 1, jump to the linear
  estimate, probe just above it, bisect. Typically four forced layouts per
  fit, never more than eight, never below 0.3x (past that the element
  overflows as it would have). It runs at start and on a spec change (a
  layout effect, before paint), when the box resizes, when the element's
  text changes and after web fonts load; an element whose text and room are
  unchanged is skipped (the clock re-renders every second). No timer and no
  work between passes, so nothing runs during the photo crossfade. Measured:
  a median of 0.4 ms at 1x CPU and 2.6 ms at 6x throttle.
  `window.__sdFitStats` keeps the counts.
- `clip` hides the overflow, for the rare case, never as a default.

### The box v2 look

- The fill is a layer under the content (`.tl-spec__fill`), so its opacity
  fades the fill alone. A colour replaces the preset's fill; without one a
  gradient or an opacity works on the preset's own card. `color2` is where a
  gradient ends (none fades out).
- The border and the preset card's hairline are drawn in a frame above the
  fill; the box's own shadow is then the drop shadow alone, in `--tl-pad`
  units so it scales with the screen. A box with any v2 surface (a fill, a
  border, a shadow or a blur) is never joined to a flush neighbour
  (`cardJoins`): it is its own card.
- Blur is a `backdrop-filter` (px at 1920 wide, drawn in `vw`). Where it is
  unsupported, and always on the Echo (`body[data-kiosk='echo']`, whose Silk
  draws `backdrop-filter` unreliably), the box gets a tint of matching
  strength instead (alpha 0.15 plus 0.02 per px, at most 0.55).
- `font` sets every word in the box, the display sizes and the body text
  alike. `color` sets the box's text colour and derives its two quieter inks
  (`--tl-fg-2`, `--tl-fg-3`).
- **`valign: 'top'` means "as designed", not "pinned to the top".** A few
  panels are centred in their box by design (the headline, text blocks, the
  Board's clock) and stay centred at `top`; `middle` and `bottom` move the
  content within the box. A real top is a backlog item.
- `title`: `default` is the panel's own header ("Weather", or none),
  `custom` puts the text in the header row of any panel or block, `none`
  drops the header. Panels read it through `PanelTitleContext` in
  `PanelFrame`; text and image blocks, which have no `PanelFrame`, get the
  header row from `SpecPanel`. The header row is the `title` element, so it
  takes an element style like any other.

### Fonts

- `lib/fonts.js` `FONTS` is one registry for the global Display font
  (`GLOBAL_SCHEMA`, which now offers all five) and a box's `font`: `inter`,
  `fraunces`, `roboto`, `barlow` (Barlow Condensed), `plexmono` (IBM Plex
  Mono). Latin subsets bundled in `Entry/SpecBoard.jsx`: Roboto and IBM Plex
  Mono 400, 500 and 700, Barlow Condensed 400 to 700, beside Inter 300
  (there) and 400, 600 and 700 (`main.jsx`), and Fraunces variable. A
  browser downloads a face only when a page uses it.
- A weight a family lacks falls to its nearest face. Inter has no 500, so
  Medium renders Regular (its 800 is in the bundle, from the flip clock).
  Roboto and IBM Plex Mono: Light renders Regular, Semibold and Extra bold
  render Bold. Barlow Condensed: Light renders Regular, Extra bold renders
  Bold. So the Entry clock's Light (300) draws at 400 in the three new
  families, and the Board's Semibold clock at 700 in Roboto or IBM Plex
  Mono.

### Visibility rules

- `SpecBoard` judges each panel's `when` on every render
  (`layoutSpec.js`, `ruleMatches`); the board ticks every second, so a rule
  follows its condition within a second. The panel shows when every `all`
  condition holds and, when `any` has conditions, at least one of those does;
  `not` inverts one condition. A condition that cannot be judged (an unknown
  kind, a malformed parameter, no data) is skipped, so a broken rule never
  hides a panel.
- The kinds and what they read: `schoolMorning` (inside the school-morning
  window on a school day, the Morning variant's test); `weekend` and
  `weekday` (Saturday and Sunday, or not); `daypart` (the day part the clock
  says, whatever variants the spec has: weekend, morning, evening from
  `eveningFrom`, else day); `timeRange` (`'HH:MM'` from and to, from
  inclusive, to exclusive, wrapping past midnight; the same time twice is all
  day); `musicPlaying` (the screen's Sonos room is playing); `plexPlaying`
  (the player the screen follows, `display.plexFollow`, else any player;
  the rule keeps the 5 s Plex poll running only while a panel on screen
  carries it, and a screen that follows Plex polls anyway); `alertActive` (the hub's `weatherAlerts` is not empty, else the
  headline is an alert); `countdownWithin` (`days` 0 to 365, default 7: a
  countdown with 0 to N days left).
- `lib/houseState.js` now carries `weatherAlerts` from `/api/state` (up to
  three, `{ event, severity, until, headline }`), which `useTodayData` hands
  on (null in demo mode), so `alertActive` sees the alerts themselves.
- Never applied in the layout editor: every panel is drawn, and one with a
  rule carries `data-rule="1"`, which the editor marks on the stage with a
  rule badge. Day-part variants remain the tool for whole layouts; rules are
  for single panels.

### `PANEL_ELEMENTS`, grown and renamed

Every visible part of a panel now carries a key, so the element styles reach
all of it.

- Every type gains `title` (the header row, or the custom title); panels
  with an empty state gain `empty`.
- New keys: weather `updated`; forecast `updated`, `day`, `icon`, `temps`,
  `rain` (it had none); sunmoon `arc`, `labels`, `times`, `moon`, `phase`
  (none before); airquality `detail`; agenda `message`; countdowns `name`,
  `unit`; departure `meta`, `status`; nowplaying `room`, `track`, `artist`,
  `album`, `meta`, `progress`; photo `image`, `counter`; school `rows` (none
  before).
- **Renamed:** the countdown tile's event title was `title` and is now
  `name` ("Event name"); Now Playing's track title was `title` and is now
  `track`. `title` is the header row on every type. The knobs point at the
  new keys (`titleSize` tunes `name`, `showUnit` tunes `unit`, Now Playing's
  `size` tunes `track`), and several knobs that named no element now do. No
  stored spec used the old keys (element styles are new, and the keys were
  only the editor's hover and focus), so nothing saved breaks.

### The bridge

`sd-edit:ready` gains `elementStyleSchema`, `boxSchema`, `fonts` and
`ruleKinds`, the four contract objects above. Nothing else in the bridge
changed.

### The editor

- **Element section.** Selecting a sub-element (on the stage or in the
  layers) puts an Element section at the top of the inspector: a breadcrumb
  from the panel through the elements it sits in ("Countdowns > Tile > Event
  name", each part clickable), the `ELEMENT_STYLE_SCHEMA` fields and Reset
  element. The panel's own knobs for that element stay below, one click
  away.
- **Elements tree.** A chevron on each layer opens its elements
  (`PANEL_ELEMENTS`): click one to select it on the stage; its eye hides that
  element alone (`hidden`); a badge on the panel's row counts its styled
  elements.
- **Appearance** gains three sections drawn from `BOX_SCHEMA`: Fill and
  border (fill colour, opacity, gradient, and the second colour only once
  there is a gradient; border width and colour; shadow; backdrop blur, with
  the hint "Shows as a tint on the Echo"), Type (font, text colour, vertical
  align) and Block title (Panel, Custom or None, and the text for Custom).
- **Show when.** Always (no rule), Add condition from `RULE_KINDS`, each
  condition with its parameters and a Not, and All or Any once there are
  two. The layer row says when the panel shows ("shows: school morning") and
  the stage draws a rule badge on the box.
- **Multi-select.** Shift-click on the stage or in the layers adds a panel or
  takes it out. Several panels move together and can be aligned (left,
  centre, right, top, middle, bottom, to the selection's bounds),
  distributed (three or more, equal gaps) and matched in width or height (to
  the first selected); locked panels stay put, and each operation is one undo
  step.
- **Copy style and Paste style** (the panel's header menu, option-command-C
  and option-command-V; Paste style onto all with several selected): the
  universal props, the box v2 props, the element styles and the rule; the
  knobs only onto a panel of the same type; never the position, size,
  stacking, id, hidden, locked or content (a text block's text, an image's
  picture). The same menu has Reset element styles for the whole panel.
- **Saves match stored panels by id.** At Save the editor reads the stored
  copy fresh from the hub. A panel the save does not change goes back
  exactly as stored; an edited one is the new panel plus a `null` for each
  key it dropped (`when: null`, `elements: { <key>: null }`), because the
  hub's PATCH deep-merges. So a newer normaliser never rewrites a panel
  nobody touched. The two copies are compared normalised, so an untouched
  panel also keeps what the editor would round or fill (a Board's third
  decimal, a missing `scrim`). Copy layout to another screen merges by the
  same rule against the target's stored copy.
- **Contract fallbacks.** `editor/appSpec.js` imports the app's
  `layoutSpec.js` as a namespace and keeps fallback copies of the four
  contract objects, plus a `carryOver` in `readSpec` for an app normaliser
  that predates them, from when the two halves were built in parallel.
  Inert now that the app exports all four; removing them is a backlog item.

### Verified

- Pixel diffs against the previous build (`6cbc0f7`), every new prop at its
  default: 0 px differ in all 14 scenarios (the Entry board afternoon and
  school morning at 1920x1080 and 1280x800, the Board at 1280x800, Briefing
  at 1920x1080, the Entry board in edit mode at 1920x1080; each with
  replayed live data and with demo data), and 0 between two loads of the
  same build. Taken with software raster: GPU raster showed up to 42 px of
  one-level noise between two loads of one build, in blurred shadows. Method
  and numbers: `_review/layout-editor/found-diff-results.json`.
- Tests: 36 new in the app (`layoutSpec.test.mjs` 21, `specStyles.test.mjs`
  10, `fitText.test.mjs` 3, `fonts.test.mjs` 2), 51 with the backdrop luma
  tests: `node --test 'code/src/**/*.test.mjs'` from the project root.
- The editor, against a mock app and against the live hub with the real app
  and sample data: element styles set and reset, the tree's eyes, the box
  fields, rules, multi-select, paste onto the same type and across types,
  untouched panels kept byte for byte, copy to another screen
  (`found-editor-report.json`, `found-editor-live-report.json`).
- Review shots: `_review/layout-editor/found-*.png` (the app) and
  `found-editor-*.png` (the editor); the index is that folder's README.

### Left for later (in BACKLOG)

- A real "top" vertical alignment.
- The missing faces: Inter 500, the 300 faces of Roboto, Barlow Condensed
  and IBM Plex Mono, and 600 for Roboto and IBM Plex Mono.
- Removing the editor's contract fallbacks.

## As built, chunk 4 and the shape block (2026-09-27)

The editor's half of `panels-and-controls.md`, chunk 4 ("Blocks and
clocks"), built on `feature/echo-hub` (commit `88877f9`, over the chunk 3
and 4 app work) and deployed to the hub 2026-09-27 01:34 (build
`88877f9`). With chunks 1 to 4 built, this is the editor's as-built record
for chunk 4; the six new types themselves are in `panels-and-controls.md`,
"As built: blocks and clocks (2026-09-27)". Chunk 3 needed nothing of the
editor: Add panel lists whatever functional types the app sends, and it
offered the four calendar views as it was
(`_review/layout-editor/cal-editor-weekgrid-added-1600.png`). Contract v2
and chunk 1 stay the reference; nothing stored changed shape.

### Block types come from the app

- The type registry (`editor/schema.js`) no longer takes text and image as
  the only blocks. Which types the app knows, and which of them are blocks
  (any number per layout, ids `<type>-<4 hex>`), come first from the app's
  `sd-edit:ready`: its `panelTypes`, each carrying its `kind` (`panel` or
  `block`), or a `blockTypes` list when a ready sends one (none does yet; a
  ready naming only its blocks keeps the types known so far). Then the
  app's `layoutSpec.js` as bundled with the editor (`PANEL_TYPE_LIST` and
  the new `BLOCK_TYPES`, registered by `appSpec.js` at load), then the
  built-in Contract v1 and v2 types, with text and image the blocks. The
  app's labels name the types ("Shape", "Flip clock"). Every other type the
  app knows is a functional panel, at most once per layout. The bridge did
  not change: `panelTypes` already carried `kind`.
- Adding blocks: Add text and Add image put their block in the middle of
  the canvas, in front, at their own sizes, as before. Every other block
  type the app has gets its own button, a small menu (Add shape):
  - "Add shape behind selection": sized to the selection's area (the union
    of the selected boxes, in percent) and placed in the list just before
    the rearmost selected panel, with that panel's z, so nothing else
    moves: the card behind a group. With nothing selected it goes to the
    back of the layout. The status line says what it went behind.
  - "Add shape in front": the app's own starting box (`newBlock`: 40, 44,
    20 x 12 %), above everything (z one over the highest).
- The shape's inspector: Position and size, Appearance, Fill and border,
  Block title, Show when, State and "Shape settings" (Shape, Fill), with
  Delete where a panel has Hide. The Type section (font, text colour,
  vertical align) is left out for any type whose only element is its title
  (the shape); that title still takes an element style, and it is all the
  shape's elements tree holds.
- Align, distribute, match, copy and paste style, Delete (the key and the
  button) and undo cover shapes as any block. Paste style onto a shape
  carries the box look (the universal and box v2 props, the rule, the
  title's element style), never another type's knobs: its Shape and Fill
  come only from another shape.

### Types the app does not know are kept as stored

- A panel of a type the app in the preview does not know (a shape saved by
  a newer app and opened against an older build; any type, not only
  shapes) is kept byte-identical and in its place in the list:
  `normalizePanel` copies it as stored (`keepAsStored`, `editor/spec.js`)
  rather than dropping it, and no edit touches it, so no save drops it.
- The layers list it dimmed, "Shape (not supported by this app)", with no
  eye, lock or restacking, and a restack of the others leaves its z alone;
  the stage draws no box or handles for it. Selected, the inspector says
  what it is, that it stays exactly as saved and that a build that knows
  the type shows it again, and where it was saved, with Remove (Delete
  removes it too: hiding it would change it).

### Verified

- Tests: 9 new in the editor (`editor/blockTypes.test.mjs`): the bundled
  blocks, a new shape from the app clear of taken ids, a stored shape and
  an unknown type saved byte-identical, an app without shapes, a block
  only the ready knows, a ready naming its blocks outright or only its
  blocks, behind the selection, and paste style onto a shape.
- Against a mock hub, the PATCH bodies of five saves: add (the shape just
  before the weather group with its z, over the group's area), style (a
  custom fill, a diagonal gradient, a border, a blur; every other panel
  byte-identical), an untouched round trip after a reload (the shape
  byte-identical, only the nudged clock changed), remove (the list
  otherwise as stored), and a save from an app build without shapes (the
  shape byte-identical, in its place). With them: align, distribute and
  paste style on a shape, each undone; Add shape in front at the starting
  box; behind with nothing selected, at the back; the Line kind; Delete and
  undo. All 36 checks passed.
- Shots: `_review/layout-editor/shape-editor-*.png`, indexed in that
  folder's README.
