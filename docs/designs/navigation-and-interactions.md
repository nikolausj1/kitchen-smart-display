---
title: "Smart Screen - Navigation and Interactions"
created: 2026-08-24
modified: 2026-08-24
version: 1.0
author: Claude Opus 5 (claude-opus-5)
tags: [design, navigation, interactions, apple-tv, kitchen-display, touch, in-discussion]
---

# Smart Screen (Today view)

Transcribed from Justin's tablet notes (photographed 2026-08-24). This is an
in-progress design note, not a settled spec: several entries are deliberately
incomplete in the source and are preserved that way below. See
[Transcription notes](#transcription-notes) at the bottom for what was
illegible, truncated, or left unfinished.

## Navigation paradigm (across all device types?)

- Up / down = navigate features (photos, today, music, settings)
- Left / right = inter feature navigation
- (third bullet present but empty in the source)

## Features

- Top level feature navigation
- Inter-feature navigation
- Feature modes / views
- Popup Menu (Nav, Feature Action, )
- Marking photos or data for correction

### Photos

- Next / Prev photo
- Display mode (fit, fill, )
- Frame on / off
- Pause?
- Mark data / photo issue

### Music

- Next / Prev song
- Pause
- New station

### Today

- Next / Prev layout (Today, Second Screen, Info)
- Set / change / stop timer
- Change walk/drive

## Interactions

### Input equivalence

| Touch Screen | TV |
| --- | --- |
| Swipe up / down | Dpad up / down |
| Swipe left / right | Dpad left / right |
| Tap | Select |
| Long press Tap | Select long press |

### Action mapping by surface

| | Touch Screen | TV | NonTouch Screen |
| --- | --- | --- | --- |
| Top level Nav | Swipe up / down | Dpad up / down | remote admin |
| Inter feature Nav | Swipe left / right | Dpad left / right | remote admin |
| (unlabeled row) | Tap dead space | Select non selected | |
| Marking photos | Long press Tap | Select long press | n/a |

**PHOTOS**

| | Touch Screen | TV | NonTouch Screen |
| --- | --- | --- | --- |
| Next / Prev | Swipe left / right | Dpad left / right | |
| Display Mode | Settings | Select | |
| Frame on/off | N/A | Settings | |
| Pause | N/A | Pause [highlighted] | |
| Mark data | Long press | Select long press [highlighted] | |

**MUSIC**

| | Touch Screen | TV | NonTouch Screen |
| --- | --- | --- | --- |
| Next / Prev | Button | N/A | |
| Pause | Button | Pause [highlighted] | |
| New Station | Button | N/A | |
| Visualization Mode | N/A | Select | |

**DASHBOARD**

| | Touch Screen | TV | NonTouch Screen |
| --- | --- | --- | --- |
| Next / Prev | N/A (Swipe left / right) | N/A (Dpad left / right) | remote admin |
| Set / Change Timer | Button | consume global setting | consume global setting |
| Change walk/drive | Button | consume global setting | consume global setting |

## Trailing note in the source

A quoted passage sits below the tables, cut off at the bottom edge of the
photo:

> "The framework proposes a solution (targeted for 2027+) that introduces four
> access levels for data - Open, Family, Personal, and Secure - each requiring
> progressively higher levels of identity recognition or authentication."

The final line runs off the photo, so the closing words are inferred from the
partially visible text. Its relationship to the rest of the note is not stated.

## Transcription notes

Preserved exactly as written in the source, rather than tidied:

- "Popup Menu (Nav, Feature Action, )" and "Display mode (fit, fill, )" both
  end on a trailing comma. The lists were left unfinished.
- The Navigation paradigm list has an empty third bullet.
- The action-mapping table has one unlabeled row ("Tap dead space" /
  "Select non selected") between Inter feature Nav and Marking photos.
- Several NonTouch Screen cells are blank rather than "n/a". Blank and "n/a"
  appear to be used distinctly in the source, so they are not normalized here.
- DASHBOARD Next / Prev reads "N/A" with a parenthesized alternative beneath
  it in both the Touch Screen and TV columns, which reads as an option under
  consideration rather than a decision.

Corrected in transcription:

- The source heading reads "Navigation Paridigm"; spelled "paradigm" here.

Highlighted in the source (yellow), reproduced above as [highlighted]:

- PHOTOS / Pause / TV
- PHOTOS / Mark data / TV
- MUSIC / Pause / TV

All three are TV-column cells, and two of them are "Pause". What the
highlighting was meant to flag is not recorded in the note.
