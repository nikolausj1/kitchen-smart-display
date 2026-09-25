---
title: "Layout editor - move, resize and tune the boards from a MacBook"
created: 2026-09-24
modified: 2026-09-24
version: 1.0
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, editor, entry, today, layouts, frameserver, dashboard, echo-show]
---

# Layout editor

**Status: designed 2026-09-24, not built.** Waiting on Justin's go.

A what-you-see-is-what-you-get editor for the screen layouts, used from a
MacBook Pro, so "move it 10 pixels, make the font smaller, shrink the image"
stops being a conversation and becomes a drag. Starts with the Entry board
(`entry-board.md`); the same mechanism later covers Board and the day-part
layouts of Entry phase 2.

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

One object per screen per layout:

```
layouts: {
  entry: {
    version: 1,
    canvas: { w: 1920, h: 1080 },          // what it was drawn on
    backdrop: { photos, wash, blur, scrimTop, scrimBottom, intervalMs },
    global:   { font, accent, text, surfaceOpacity, radius, grid },
    panels: [
      { id: 'clock', x, y, w, h,           // percent of the canvas
        z, hidden, locked,
        props: { textScale, opacity, padding, background, radius, align,
                 ...panel-specific knobs } },
      { id: 'text-1', kind: 'text', ..., props: { text, size, weight, color, align } },
      { id: 'image-1', kind: 'image', ..., props: { src, fit } },
    ],
  },
}
```

The built-in board is the default layout; Reset returns to it, and a tuned
screen keeps its layout when the code's default changes.

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

## Not in scope

Rearranging a panel's internals beyond its declared knobs; editing on the
Echos or Pis; any login (the hub is LAN-only, like the dashboard).
