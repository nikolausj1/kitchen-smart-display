---
title: "Claude Code Handoff - Kitchen Smart Display"
created: 2026-05-21
modified: 2026-05-21
version: 1.1
author: Claude Opus 4.7 (claude-opus-4-7)
tags:
---

# Handoff to Claude Code

You are picking up the Kitchen Smart Display project mid-flight. This document gets you oriented in five minutes. Read it fully before doing anything.

## Read these first, in this order

1. `CLAUDE.md` (project root) - how to work in this codebase, file conventions, user preferences
2. `Smart Displays.md` (project root) - the project spec, source of truth for what to build
3. This document - state of the world right now, your first job, what is out of scope

## State of the world as of 2026-05-21

### What is done (Phase 0, steps 1 through 4)

- Hardware purchased and inventoried (Raspberry Pi 5 8GB, EVICIV 15.6" touchscreen, active cooler, 27W PSU, SD card, peripherals)
- Raspberry Pi OS flashed to the SD card via Raspberry Pi Imager with custom config (hostname, user, Wi-Fi credentials, SSH key pre-authorized)
- Pi first-booted on the home network and is reachable as `smartdisplay.local`
- SSH key authentication verified end-to-end from Justin's Mac to the Pi

### What is not done

- The kiosk app itself (React + Vite). Does not exist yet. The `code/` folder is empty.
- Chromium kiosk-mode setup on the Pi (autostart, kiosk flags, screensaver suppression, etc.)
- Touchscreen wiring. The touchscreen and cables are still in their box. Do not ask Justin to plug them in until you tell him you are ready.
- Immich on the home network. See "Out of scope" below.

### Hardware state right now

- Pi 5 is sitting on Justin's desk, plugged into power, on Wi-Fi, headless (no display, no keyboard, no mouse)
- Touchscreen is NOT yet connected
- Pi is reachable at `smartdisplay.local` via SSH using the key on Justin's Mac

### Pi specs (confirmed at first boot)

- OS: Raspberry Pi OS (Debian Bookworm)
- Kernel: `6.12.75+rpt-rpi-2712`, `aarch64`
- OS build date: 2026-03-11
- Chip: BCM2712 (this is a Pi 5)

## Your first job: handshake verification

Before doing anything else, prove you can drive the Pi. Run one SSH command, capture the output, report back to Justin. Do not start scaffolding the app or modifying the Pi until Justin gives the go-ahead.

Suggested command:

```bash
ssh pi@smartdisplay.local "uname -a && uptime && df -h / && free -h && which node npm git chromium-browser"
```

What success looks like: you see kernel/uptime/disk/memory info plus the install paths (or empty results) for node, npm, git, and chromium-browser. Report all of that to Justin in chat.

If it fails:

- "Permission denied (publickey)" - your shell environment does not have access to the SSH key the Mac uses. Check `~/.ssh/config`, `~/.ssh/id_ed25519`, `~/.ssh/id_rsa`. If you cannot resolve this in two steps, tell Justin.
- "Connection refused" or "No route to host" - Pi is offline or not on the same network. Have Justin check the Pi.
- "Could not resolve hostname" - mDNS is not resolving. Try `ping smartdisplay.local`; if that fails too, Justin can find the Pi's IP in his router admin and we use the IP instead.

## STOP after the handshake

Once the handshake succeeds, stop and wait for Justin's go-ahead before proceeding. He wants to review the Pi's state and decide the next move with you, not return to a half-scaffolded project.

## Out of scope (do not touch yet)

- **Immich is on a separate track.** Photos for v1 will eventually come from Immich on the home network (Synology NAS or NUC). During development, the photo source should be stubbed (a folder of test JPEGs on the Pi). Architect the photo hook (`useImmichPhotos`) to make the swap trivial later.
- **Google Calendar OAuth is a future-phase feature.** Do not create a Google Cloud project, OAuth credentials, or any Google APIs. The original Phase 0 step 5 was deleted on 2026-05-21. See Smart Displays.md v14.0 for the decision context (short version: the Google Photos Ambient API turned out to be partner-program gated, so the whole Google OAuth subsystem became unnecessary).
- **Detailed Settings page flows can wait.** Start with the views and the data layer. Settings page is built after the core experience works.
- **Hardware additions** (touchscreen, USB SSD, etc.) should not be requested of Justin until you actually need them and have a clean reason.

## Build approach (per Smart Displays.md)

- React + Vite. Static build. `vite build` produces files, copy to Pi, Chromium serves them locally.
- Views as components: `PhotoSlideshow`, `NowPlaying`, `TodayView`, `JukeboxGrid`, `Settings` (later)
- API integrations as custom hooks: `useImmichPhotos` (stubbed initially), `useSonosState`, `useWeather`. Later: `useCalendarEvents`.
- `node-sonos-http-api` is the only persistent Node process on the Pi at runtime. The kiosk app itself is static files.
- See the "Frontend: React + Vite" and "Why this stack" sections of Smart Displays.md for full reasoning.

## After the handshake, your suggested first task list (subject to Justin's approval)

1. Confirm Pi software state: what is installed (Node, npm, Git, Chromium), partition layout, free disk, current `~/` contents
2. Scaffold the `code/` folder with `npm create vite@latest` (React + JS, not TS unless Justin says otherwise)
3. Set up a one-command deploy script (rsync `dist/` to a folder on the Pi) so iteration is fast
4. Stub the photo source with a folder of test JPEGs on the Pi
5. Build the Photo Slideshow view as the first thing to render (it is the default idle state per the spec)
6. Get Chromium running in kiosk mode pointed at the static build (initially over HTTP from the laptop, then served locally on the Pi)

Do not start this list until Justin approves it. He may reorder.

## How to interact with Justin

- Updates should be concise. He prefers a short status line plus a question over a long explanation. He will ask for depth if he wants it.
- He is designing the UI in Figma in parallel. A Figma MCP is available. Use it to pull design context before generating components, do not invent visual decisions.
- All Markdown file edits must follow the project frontmatter convention. See `CLAUDE.md`.
- No em dashes in writing. Use hyphens or rephrase.
- When a task involves five or more distinct steps, set up a task list so Justin can see progress.

## Where the Cowork chat left off

The Cowork chat tab in the Claude desktop app has the full design conversation, including the 2026-05-21 architecture pivot from the Google Photos Ambient API to Immich (full reasoning written into Smart Displays.md v14.0). You do not need that conversation history. The spec is the source of truth.

## Pending items from the Cowork chat task list

- Decide Immich host: Synology vs NUC. Depends on Synology DSM version and RAM. Not blocking your work.
- Finish Phase 0: handoff doc (this document) plus handshake verification (your first job).

Good luck. Do not rush past the handshake.
