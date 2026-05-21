---
title: "Kitchen Smart Display - Project Instructions"
created: 2026-04-13
modified: 2026-05-20
version: 2.1
author: Claude Opus 4.6 (claude-opus-4-6)
tags:
---

# Kitchen Smart Display Project

## Project Context

This folder contains the Kitchen Smart Display project: a wall-mounted 15.6" touchscreen powered by a Raspberry Pi 5, serving as a photo frame, daily briefing, and Sonos music controller.

**Always read `Smart Displays.md` first.** It is the source of truth for all project decisions, architecture, and scope. The "Decisions Made" section captures what has been locked in. The "Open Questions" section lists what is still undecided.

## Architecture Summary

- Raspberry Pi 5 running Chromium in kiosk mode
- Frontend: React + Vite (static build served locally)
- Four direct API integrations, no Home Assistant:
  - Google Photos Ambient API (photos)
  - Google Calendar API (calendar)
  - Open-Meteo API (weather forecasts, free, no API key)
  - node-sonos-http-api (music, running locally on the Pi)

## Folder Structure

- `Smart Displays.md` - Main project spec (source of truth)
- `CLAUDE.md` - This file
- `mockups/` - HTML prototypes for design reference
  - `jukebox-grid-mockup.html` - 5 Jukebox grid style variants. Commercial Jukebox style is the chosen direction.
  - `vinyl-spin-mockup.html` - Skeuomorphic vinyl spin concept. NOT a committed feature, just an exploration.
  - `nav-bar-mockup.html` - Early nav pill concept.
- `figma-exports/` - Figma design exports (PNGs)
  - `Today-green.png`, `Today-yellow.png`, `Today-orange.png`, `Today-red.png` - Today view countdown color states
  - `Today-noTimer.png` - Today view with no active timer
  - `Today-setTimer.png` - Today view timer picker (scroll to set departure time)
  - `menu-onToday.png` - Menu pill overlay on the Today view
  - `music-nowPlaying.png` - Now Playing view with transport controls + album art
  - `music-stationPicker.png` - Station/playlist picker (Jukebox) as a centered panel overlay on top of Now Playing (Now Playing dims behind it). Currently playing station is indicated by a small animated equalizer inside its cell.
  - `music-phase1.png` - Earlier Now Playing iteration (reference)
  - `Photo-time.png`, `Photo-timeMusic.png`, `Photo-timeMusicExif.png` - Photo Slideshow variants showing time widget, album art widget, and EXIF metadata overlay
- `code/` - Reserved for the React + Vite project

## Working Style

- When generating code, follow the React + Vite structure outlined in Smart Displays.md (views as components, APIs as custom hooks)
- Check the "Decisions Made" and "Open Questions" sections of Smart Displays.md before making architectural suggestions
- Mockups in the `mockups/` folder are reference material, not committed designs unless noted in Smart Displays.md
- Justin is designing the interface in Figma. A Figma MCP is available - use it to pull design context, screenshots, and metadata directly from the Figma file before generating components. Figma exports in `figma-exports/` are reference snapshots; the Figma file is the live source for design details.

## User Preferences

Follow the global user preferences for Markdown file formatting (YAML front matter with title/created/modified/version/author/tags, update modified date and version on any edit, no em dashes).

## Notes on the Move

This folder was created on 2026-04-13 to give the Kitchen Smart Display project a dedicated workspace separate from the broader Home Assistant notes. The original files remain in the parent Home Assistant folder.

One image referenced in Smart Displays.md under "Frame Links" (`Pasted image 20260313114503.png`) could not be located and was not copied over. The embed will appear broken in Obsidian until the image is re-added or the reference is removed.
