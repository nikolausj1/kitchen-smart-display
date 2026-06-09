---
title: "Kitchen Smart Display - Backlog"
created: 2026-06-08
modified: 2026-06-08
version: 1.0
author: Claude Opus 4.8 (claude-opus-4-8)
tags: [backlog, roadmap, apple-tv, kitchen-display]
---

# Kitchen Smart Display - Backlog

Consolidated list of remaining features and improvements across both surfaces:
the kitchen Raspberry Pi screen (React web app in `code/`) and the Apple TV /
Frame TV app (native SwiftUI in `tvos/`). Pulled together from `Smart Displays.md`,
`Apple-TV-Display-PRD.md`, `RESUME-apple-tv.md`, and a code inventory on
2026-06-08.

Status legend: TODO = not started, DECISION = needs a decision before building,
BLOCKED = waiting on an external dependency, VERIFY = built but not yet confirmed
live, POLISH = minor/cosmetic.

## Kitchen Pi screen (React web app)

The app is largely complete: Today, Photos slideshow, Music / Now Playing with the
Jukebox station picker, full Settings (school + morning timer, Sonos room, slideshow
+ album picker, night-mode brightness, location), Sonos transport control, weather,
Immich photos, and the morning departure timer are all built and shipped. Items
below are what remains.

- **Google Calendar / agenda** (TODO) - the one real feature gap. Direct OAuth
  integration via a `useCalendarEvents` hook, with an agenda on the Today view.
- **Today "what to wear" recommendations** (TODO) - jacket weight, shorts vs.
  pants, derived from weather thresholds.
- **School-schedule awareness** (TODO) - suppress the countdown on no-school days;
  import the school lunch menu; surface special activities (Library day so books
  go in the bag, after-school coding, etc.).
- **Music auto-interrupt** (DECISION) - Sonos playback auto-switches to Now Playing
  (from Photos, not Today). Exact rules are an open question: switch from which
  views, and what happens when music stops. Shared concept with the Apple TV
  "auto-show Now Playing" item below.
- **Doorbell ring to Camera view** (TODO, BLOCKED) - requires Home Assistant.
- **Presence / light-level dimming** (TODO) - via Home Assistant; today brightness
  is time-based only.
- **Security hardening** (TODO) - noted as a future enhancement in the spec.
- **Cleanup** (POLISH) - remove the dead `ComingSoonView`; confirm/add touch-swipe
  photo gestures (programmatic nav exists, gestures unverified).

## Apple TV / Frame TV app

Phase 1 shipped. This session added per-view mats, Framed Now Playing, Today mat,
linear navigation, and a smooth progress bar. Remaining:

- **Cold-threshold (35F) Settings row** (TODO) - currently hard-coded; expose as an
  editable TV-local setting.
- **App icon / Brand Assets** (TODO) - no app icon set exists yet.
- **Merge `feature/apple-tv-display` into main** (TODO) - once proven in daily use.
- **Home Assistant auto-launch** (TODO) - school mornings open Today, guests scene
  opens Now Playing. Currently being pursued in a separate session.
- **Auto-show Now Playing when music starts** (DECISION) - the PRD currently
  forbids mid-session auto-switching, so this needs a decision. Counterpart to the
  kitchen music auto-interrupt item.
- **Multi-room Sonos** (TODO) - transport and volume currently target "Main" only.
- **Live school-morning verification** (VERIFY) - the weather-aware walking/driving
  default plus timer mirroring are unit-tested but not yet confirmed end to end on
  a real morning.
- **Polish** (POLISH) - tune the Framed handwritten metadata size/placement on the
  real screen; gradient-fill alternative to the blurred Framed background; the
  global always-on mat toggle was parked in favor of per-view toggles.

## Shared / infrastructure

- **Automated Immich manifest rebuild** (DECISION, BLOCKED) - nightly rebuild plus a
  kitchen "rebuild" button. Feeds photos to both displays. Blocked on where it runs:
  make the Pi self-sufficient (install Node + Immich creds) or have the Mac rebuild
  and the Pi trigger it via SSH. The Pi currently has no Node or Immich credentials.

## Cross-cutting themes

A few items show up on both surfaces and are worth designing once:

- **Google Calendar** - kitchen agenda first; the TV could mirror later.
- **Multi-room Sonos** - affects both the kitchen controller and the TV.
- **Home Assistant** - auto-launch, doorbell camera, and presence-based dimming all
  depend on bringing HA into the loop.
- **Auto-show Now Playing** - one set of rules should govern both the kitchen and
  the TV.
