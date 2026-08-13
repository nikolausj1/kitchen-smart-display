---
title: "Hardware Backlight Dimming via DDC/CI"
created: 2026-06-22
modified: 2026-06-22
version: 1.0
author: Claude Opus 4.8 (claude-opus-4-8)
tags: [design, kitchen-display, raspberry-pi, brightness, ddc, hardware]
---

# Hardware Backlight Dimming via DDC/CI

How the kitchen display dims its **actual backlight** at night instead of only
painting a black CSS overlay over a full-brightness panel. The panel's backlight
is commanded over the HDMI cable using DDC/CI (the same control as the monitor's
physical brightness buttons), driven by `ddcutil` on the Pi.

## Context

Today's dimming is a full-screen black `<div>` at increasing opacity
(`code/src/shell/DimOverlay.jsx`), because the original assumption was that this
HDMI panel had no backlight control. That overlay leaves the backlight at 100%:
in a dark kitchen at night it still glows, blacks turn gray, and it draws full
power. A true hardware dim fixes all three.

The other obvious path - real DPMS off via the Pi's `wlr-randr` endpoint - was
rejected earlier because wlroots cuts input events to clients when the output is
disabled, which breaks touch-to-wake (see `code/src/shell/useDisplaySchedule.js`).
DDC/CI does **not** disable the output; it only lowers the backlight, so
touch-to-wake keeps working. That is the whole reason this approach is safe where
DPMS-off was not.

## Feasibility - confirmed on the hardware (2026-06-22)

Tested directly on `smartdisplay.local` (EVICIV 15.6" Touchscreen, B0CYLTZSWD):

- `ddcutil detect` - panel responds. Realtek controller (`RTK`), DRM connector
  `card1-HDMI-A-1`, **VCP version 2.2**, on I2C bus `/dev/i2c-13`.
- `ddcutil getvcp 10` - reads brightness cleanly (was 91/100).
- `ddcutil setvcp 10 30` then `setvcp 10 91` - backlight changes both directions,
  read-back matches exactly. **No verification failure, no slam-to-zero** - the
  known Pi 5 `setvcp` bug (ddcutil issue #356) does not affect this panel.
- `setvcp` works **without `sudo`** - the `pi` user has I2C access, so the kiosk
  server (runs as `pi`) needs no new privileges.

Prereq: `ddcutil` apt package (installed 2026-06-22). `i2c-dev` is already loaded.
The HDMI I2C bus is `/dev/i2c-13` here, not the `i2c-11` the docs mention - never
hardcode it; detect it.

## Design principle

**DDC is the primary dimmer; the CSS overlay becomes the fallback + the
guaranteed-black layer for "off."** If any `ddcutil` call fails - or we are on the
Apple TV / in dev where there is no Pi server - behavior degrades to *exactly
today's overlay-only experience*, never to a broken or stuck-dark screen.

## Mode -> output mapping

| Mode    | DDC backlight (`setvcp 10`)      | CSS overlay |
| ------- | -------------------------------- | ----------- |
| `awake` | `wakeBrightness x 100` (e.g. 90) | 0 |
| `dim`   | `eveningBrightness x 100` (e.g. 40) | 0 - DDC does the dimming (fallback formula only if DDC failed) |
| `off`   | minimum (~1)                     | opacity 1 - guaranteed black, as today; touch still wakes |

The overlay's `1 - brightness` opacity formula only re-engages when DDC reports
failure, so we never double-dim.

## Implementation

### Pi server - `pi/kiosk-server.py`

Mirrors the existing `wlr-randr` display endpoints (`set_display`,
`get_display_state`).

- `_ddc_bus` cache + `detect_ddc_bus()`: run `ddcutil detect` once, parse the
  `/dev/i2c-NN` bus, cache it. Re-detect on failure (handles bus-number drift).
- `set_brightness(value)`: `ddcutil --bus <N> setvcp 10 <value>` with `timeout=8`,
  no `sudo`, value clamped 0-100. Returns `(ok, info)` like `set_display`.
- Routes:
  - `POST /api/display/brightness` `{value: 0-100}` -> `set_brightness`
  - `GET  /api/display/brightness` -> `getvcp 10` current value (diagnostics)
- Update the module docstring to document the new endpoint.

### Schedule hook - `code/src/shell/useDisplaySchedule.js`

- On each mode transition and on brightness-setting change, POST the target
  backlight to `/api/display/brightness` (relative URL - the kitchen app is served
  from the Pi origin, same pattern as `code/src/lib/settings.js`). Wrap in
  `.catch(() => {})`; skip when `KIOSK_TV`.
- Track whether the last POST succeeded; return a `hardwareDim` boolean alongside
  `actualMode`.
- Remove the now-stale comment block saying the Pi endpoint is "no longer called."

### Overlay - `code/src/shell/DimOverlay.jsx`

- Accept `hardwareDim`. When true and mode is `dim`, render opacity 0 (DDC handled
  it). When false, keep today's `1 - brightness` formula as fallback. `off` stays
  opacity 1 regardless.

### Settings - `code/src/lib/settings.js` + `SettingsView.jsx`

- Add `display.hardwareDim: true` default, plus a **"Hardware dimming" toggle** in
  Settings as a one-tap escape hatch back to overlay-only if the panel misbehaves.
- Rewrite the `settings.js` comment that currently says "we have no hardware
  backlight control" to reflect that brightness now drives the real backlight.

## Guardrails (from the risk review)

- **Subprocess timeout** on every `ddcutil` call so a flaky DDC bus cannot hang
  the server.
- **Never drive to 0 via DDC alone** for off - floor it; overlay guarantees black.
- **Overlay stays as fallback** - any DDC failure = today's behavior.
- **No new privileges** - runs as `pi`, no `sudo`.
- **Re-detect bus on failure** - no hardcoded `i2c-13`.

Worst realistic failure is a temporarily dark screen, recoverable by the panel's
physical OSD button or a power cycle (Realtek controllers reset to OSD default on
power loss). No hardware-damage path exists - `setvcp 10` is the panel's own
supported control.

## Verification (after `npm run deploy`)

1. `curl -X POST localhost:8080/api/display/brightness -d '{"value":30}'` on the
   Pi -> backlight visibly dims; `GET` reads back 30.
2. Set `dimAt` a minute ahead in Settings -> watch the **backlight** (not just an
   overlay) drop at the transition.
3. Touch the screen during dim/off -> backlight restores to wake level (proves
   touch-wake survives).
4. Flip **Hardware dimming** off -> confirm clean fallback to the overlay.
5. Reboot the Pi mid-dim -> confirm it returns at wake brightness (no stuck-dark).

## Open choices (defaults chosen, easily changed)

- **Backlight steps rather than fades** on transitions (DDC has no smooth ramp,
  and ramping means many I2C writes). Can mask with a brief overlay crossfade if a
  fade is wanted.
- **"off" keeps the full black overlay** rather than trusting backlight-0 to be
  truly black - belt and suspenders.
