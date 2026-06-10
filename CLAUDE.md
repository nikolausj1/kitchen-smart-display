---
title: "Kitchen Smart Display - Project Instructions"
created: 2026-04-13
modified: 2026-06-09
version: 2.6
author: Claude Opus 4.6 (claude-opus-4-6)
tags:
---

# Kitchen Smart Display Project

## Project Context

This folder contains the Kitchen Smart Display project: a wall-mounted 15.6" touchscreen powered by a Raspberry Pi 5, serving as a photo frame, daily briefing, and Sonos music controller.

**Always read `PRD - Smart Displays.md` first.** It is the source of truth for all project decisions, architecture, and scope. The "Decisions Made" section captures what has been locked in. The "Open Questions" section lists what is still undecided.

## Architecture Summary

- Raspberry Pi 5 running Chromium in kiosk mode
- Frontend: React + Vite (static build served locally)
- Four direct API integrations, no Home Assistant:
  - Google Photos Ambient API (photos)
  - Google Calendar API (calendar)
  - Open-Meteo API (weather forecasts, free, no API key)
  - node-sonos-http-api (music, running locally on the Pi)

## Folder Structure

- `PRD - Smart Displays.md` - Main project spec (source of truth)
- `BACKLOG.md` - The single running tracker: active design topics, backlog, Decisions Log, Recently Shipped, Housekeeping. Check here for open work and recent decisions.
- `CLAUDE.md` - This file
- `docs/` - Living reference docs
  - `Apple-TV-Display-PRD.md` - PRD for the Apple TV / Frame TV app
  - `designs/` - Per-topic design / "how it works" references (e.g. `location-resolution-strategy.md`). New deep designs land here.
- `archive/` - Point-in-time records that are done or superseded (handoffs, run logs, executed plans). Not maintained; kept for history.
- `_inbox/` - Drop zone, you to Claude. Currently holds `figma-exports/` (Figma PNG snapshots; the Figma file itself is the live source). Transient; gitignored except its README.
- `_review/` - Claude to you: things to look at and react to (incl. verification screenshots). Currently holds `mockups/` (HTML design prototypes, e.g. `jukebox-grid-mockup.html`, `today-school-data-mockup.html`) and `settings-tweaker.html`. Transient; gitignored except its README.
- `code/` - The React + Vite kitchen app (source of truth for kitchen UI)
- `pi/` - Raspberry Pi kiosk server + restart scripts (`kiosk-server.py`)
- `tvos/` - Native SwiftUI Apple TV app
- `samplePhotos/` - Stub photos for the manifest's sample mode (binaries gitignored)
- `custom-places.json` - Geocoding overrides for photo captions (real coords; gitignored). `custom-places.example.json` is the sanitized committed sample. Must stay at project root - the build reads it there.
- `frame mat.psd` - Photoshop design source for the physical frame (large; gitignored)

## Doc & Folder Conventions

How docs are organized (decided 2026-06-09). When in doubt, follow this:

- **`BACKLOG.md` is the single tracker.** All open work, the Decisions Log, the
  Recently Shipped log, and Housekeeping live here. Don't scatter TODOs into other
  docs - add them to BACKLOG.
- **`PRD - Smart Displays.md` is the master spec** (the "what/why" and locked "Decisions
  Made"). `docs/Apple-TV-Display-PRD.md` is the TV spec. Specs link to BACKLOG for
  open work rather than duplicating it.
- **Design / "how it works" references go in `docs/designs/`** - one file per
  subsystem or topic (e.g. `location-resolution-strategy.md`). These are living and
  detailed; specs and BACKLOG link into them.
- **Point-in-time docs go to `archive/`** (handoffs, run logs, executed plans) -
  but only *after* sweeping any still-open items into BACKLOG so nothing is lost.
  Archive is history, not maintained.
- **`_inbox/`** = you to Claude drop zone; **`_review/`** = Claude to you
  artifacts. Both gitignored except their README.
- **Markdown frontmatter** on every doc: title / created / modified / version /
  author / tags. Bump `modified` + `version` on any edit. No em dashes.

Lifecycle of a topic: discuss, log the decision in BACKLOG, write
`docs/designs/<topic>.md` if it's meaty, build it, then move it to Recently
Shipped; archive any one-off plan or run log after sweeping leftovers into BACKLOG.

## Working Style

- When generating code, follow the React + Vite structure outlined in PRD - Smart Displays.md (views as components, APIs as custom hooks)
- Check the "Decisions Made" and "Open Questions" sections of PRD - Smart Displays.md before making architectural suggestions
- Mockups (HTML design prototypes) currently sit in `_review/mockups/` and are transient reference, not committed designs unless noted in PRD - Smart Displays.md
- Justin is designing the interface in Figma. A Figma MCP is available - use it to pull design context, screenshots, and metadata directly from the Figma file before generating components. Figma PNG exports may sit in `_inbox/figma-exports/` as transient snapshots; the Figma file is the live source for design details.

## User Preferences

Follow the global user preferences for Markdown file formatting (YAML front matter with title/created/modified/version/author/tags, update modified date and version on any edit, no em dashes).

## Notes on the Move

This folder was created on 2026-04-13 to give the Kitchen Smart Display project a dedicated workspace separate from the broader Home Assistant notes. The original files remain in the parent Home Assistant folder.

One image referenced in PRD - Smart Displays.md under "Frame Links" (`Pasted image 20260313114503.png`) could not be located and was not copied over. The embed will appear broken in Obsidian until the image is re-added or the reference is removed.
