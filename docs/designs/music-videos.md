---
title: "Music Videos - Muted Video Backdrop for the Apple TV"
created: 2026-10-16
modified: 2026-10-16
version: 1.0
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, apple-tv, music, now-playing, music-videos, frameserver, sonos, youtube, nas]
---

# Music Videos - Muted Video Backdrop for the Apple TV

## Purpose

When friends are over and Sonos is playing, the living room TV shows the official
music video for the song that is playing. Sonos stays the audio; the TV is muted and
acts like the screens in a bar: the right video for the right song, no claim of
lip sync. It is a new stop in the Now Playing backdrop cycle, next to Mixtape, so
picking it is the switch. The hub does the matching and keeps the collection, so
the kitchen panel can play the same videos later without rework.

Status: **DESIGN, decided 2026-10-16 in a grill session. Not built. Build waits on
Justin's OK.** Phase 1 is the engine with a plain full-bleed look; phase 2 is the
nostalgic TV skin, explored first with ChatGPT renders (prompt in the appendix).

The same round prunes the backdrop cycle: Still, Lava, Caustics, Ripple and Bars
go; Drift, Smoke, Marble, Mixtape stay and Music Videos joins.

## Decisions (2026-10-16)

| # | Decision |
|---|----------|
| 1 | **Apple TV only** this round. The resolver lives on the hub and is shared; a small video button on the kitchen's Now Playing is the likely next step if this works out. No Echo changes. |
| 2 | **The backdrop picker is the switch.** Music Videos is a stop in the Framed backdrop cycle (center button on Now Playing, or Settings), the same way Mixtape is reached. No house-state flag, no rules engine. |
| 3 | **Stream first, save in the background.** On the first play of a song the TV plays a live stream within a couple of seconds while the hub downloads the file for next time. Second plays come from the collection. |
| 4 | **Collection: 720p with audio, 100 GB cap, least recently played evicted.** The cap is a dashboard setting. The files keep their audio track for the future; nothing in this round plays it. |
| 5 | **Where: the NAS**, `\\MissionControl\Media\Music Videos TV`, a folder Justin created. The hub reads and writes it over SMB (see "Storage"). |
| 6 | **Official video or nothing.** VEVO and artist channels win, the Sonos duration gates the candidates, and lyric, live, cover and fan uploads are never used. A miss is a miss. |
| 7 | **Always muted. Sonos is the audio.** No volume, no grouping, no "TV is the source" mode. |
| 8 | **Start at the Sonos position, then free-run.** One seek on track change or when joining mid-song; no further correction, so no visible jumps. Track change cuts to the next video. |
| 9 | **Video runs short: hold the last frame** (phase 1). Phase 2 replaces the hold with the nostalgic treatment: snow, a scrambled cable channel, a lost station. Fun, clever, novelty is the goal. |
| 10 | **No video, a Pandora ad, or the resolving wait: stay in the TV world.** Snow or a test pattern with the album art and title in it, never a flip to another backdrop. Phase 1 draws a simple snow with the art; phase 2 designs it. |
| 11 | **Prefetch the next track** when Sonos reports one (Spotify queues do; Pandora stations do not). |
| 12 | **Auto-off: revert after an hour of silence, plus a per-station No.** When Sonos has been stopped for 60 minutes the TV steps back to the backdrop it was on before Music Videos. Each Sonos Favorite gets a Videos setting on the dashboard (Yes / No); the morning instrumental station gets No and never matches. |
| 13 | **Control from the Siri Remote and the hub dashboard.** The backdrop already syncs through the device registry; the TV's dashboard card gets a backdrop picker. No kitchen UI this round. |
| 14 | **Wrong video: fix it from the remote or the dashboard.** A long press on the center button marks the playing video wrong; the hub denies it, re-matches to the next candidate and remembers. The dashboard's Videos page lists every match with a thumbnail, Re-match and a paste-a-YouTube-link box. |
| 15 | **Tooling: yt-dlp and ffmpeg binaries on the NUC, self-updating weekly.** FrameServer shells out for search, stream URLs and downloads. The dashboard shows the yt-dlp version and the last successful fetch so a breakage is visible, not silent. |
| 16 | **Pruning: removed backdrops load as Smoke, and Smoke becomes the default** for new screens (Lava was). Stored raw values of the survivors do not move. |
| 17 | **Phasing: engine first, skin second.** The player exposes album art, title, artist, album, station, the extracted palette and the playback state to the view layer, so phase 2 can draw whatever the design calls for. |

Resolved after the grill, while writing this doc:

- **The "wrong video" gesture is a long press on the center button.** A normal
  center press keeps stepping the backdrop (RootView `handleSelect`); nothing on
  Now Playing uses a long press today, so it is free.
- **The one-hour revert also covers a TV that slept with Videos selected.** The
  TV already tracks `lastPlayingAt` in `SonosController`; the check runs on a
  timer and again on app resume, so a morning wake after a party that never hit
  the one-hour mark still reverts before the instrumental station comes up.

Rejected on the way (for the record): the YouTube IFrame player (tvOS has no web
view at all); driving the YouTube app over the Lounge protocol (official
playback, but the app leaves the screen and ads play); Apple Music through
MusicKit (clean, but a subscription plus an unproven spike); the TV as the audio
source (perfect sync, but it stops being Pandora or Spotify driving the night);
a house-state flag with time and group rules (the upgrade path if the picker ever
proves too manual).

## Experience on the TV

Music Videos is the fifth stop in the Framed backdrop cycle, available when the
music mat is Framed, like Mixtape. Selecting it while a song plays cuts to the
video full bleed; there is no mat and no cover. Phase 1 draws a lower-third with
title, artist and station in the Mixtape handwriting, fading in on each track
change and out after a few seconds; phase 2 may replace it entirely.

### States

| State | When | Phase 1 shows | Phase 2 idea |
|---|---|---|---|
| Resolving | A song started and the hub has no answer yet | Snow with the album art faint behind it, title in the corner | Tuning in: snow resolving into the picture |
| Playing | The hub returned a URL | The video, muted, lower-third for a few seconds | The nostalgic TV frame, channel bug, whatever the renders pick |
| Held | The video ended before the song | Last frame, dimmed a little | Lost the station: snow, rolling lines, a scrambled cable channel |
| Miss | No official video, or the song's station is set to No | Test pattern with the album art and title in it | Designed test pattern, "please stand by" |
| Ad | Pandora advertisement (title "Advertisement" or no artist) | Snow | Same as Held or a "we'll be right back" card |
| Stopped | Sonos paused or stopped | Freeze the frame; after 60 min of silence revert to the previous backdrop | Power-off CRT collapse |

Every state has the same inputs available to the view: `track` (title, artist,
album, station, album art URL, duration, elapsed), the palette the other
backdrops already extract, `video` (status, URL, source, video id, channel,
duration) and the player's own state (time, ended, buffering). That is the hook
decision 17 asks for; the phase 2 skin is a view over these inputs and changes
nothing in the engine.

### Timing

- On a track change the TV asks the hub, gets a URL, seeks the player to the
  Sonos elapsed time plus the fetch latency, and plays. No further correction.
- The TV already polls the zone every few seconds for Now Playing; the video
  view piggybacks on that state rather than adding a poll.
- The player is an `AVPlayer` with `isMuted = true`, in an `AVPlayerLayer`
  sized to the screen. Audio session category is ambient so the TV never ducks
  or claims audio focus.

### Remote

| Press | On Now Playing with Music Videos selected |
|---|---|
| Center | Step to the next backdrop (unchanged) |
| Center, long press | Mark this video wrong; the hub re-matches; the screen shows Resolving |
| Play/Pause | Sonos play/pause (unchanged) |
| Left/Right | Previous/next track (unchanged) |

### Auto-off

Stored alongside the backdrop: `tv.framedBackdropBeforeVideos`. When the backdrop
is Music Videos and `lastPlayingAt` is more than 60 minutes ago, the TV restores
that backdrop and clears the key. Checked by the existing settings timer and on
app resume.

## The hub resolver

### Contract

```
GET /api/video/now?room=Main
-> {
     track: { key, artist, title, album, station, durationMs, elapsedMs,
              albumArtUrl, favoriteName, isAd },
     video: { status: "ready" | "resolving" | "none" | "denied",
              url, source: "override" | "cache" | "stream",
              videoId, videoTitle, channel, videoDurationMs, thumbUrl },
     next:  { key, status }            // the prefetch, when Sonos reports one
   }

GET  /api/video/play/<key>             one URL for the TV whatever the source:
                                        serves the override or cache file with
                                        range support, else pipes the live stream
POST /api/video/wrong   { key }         deny the current match, re-match
POST /api/video/pick    { key, url }    hand pick a YouTube link (dashboard)
GET  /api/video/collection              the index, for the dashboard
GET  /api/video/health                  folder reachable, yt-dlp version,
                                        last fetch ok, cache bytes vs cap
PATCH /api/settings/shared  { video: { capBytes, favorites: { name: yes|no } } }
```

The hub reads the zone state itself (it already proxies node-sonos-http-api),
so the TV never has to send metadata. One URL shape for playback means the TV
does not know or care whether a video is a hand-picked file, a cached file or a
live stream.

### Song key and matching

- **Key**: lowercase artist and title, with featured artists, "remastered",
  "radio edit", "single version" and bracketed suffixes stripped, punctuation
  removed. One key per song across Pandora and Spotify.
- **Station gate first**: the current transport URI is matched against the
  Sonos Favorites the same way the kitchen's `useSonosState` does for its source
  labels. A favorite set to No returns `denied` without searching.
- **Ad gate**: Pandora ads (title "Advertisement", empty artist) return `none`.
- **Search**: `yt-dlp "ytsearch8:<artist> <title> official video"` with
  `--flat-playlist --dump-json`, no API key, no quota. Each candidate carries
  id, title, channel, duration and view count.
- **Score**, highest wins, below a floor is a miss:
  - channel contains the artist name, or ends in "VEVO": strong plus
  - title contains "official video" or "official music video": plus
  - duration within 20 percent or 45 seconds of the Sonos duration: required
  - title contains lyric, lyrics, live, cover, karaoke, reaction, audio,
    visualizer, fan, 8D, slowed, sped up, hour: rejected
  - channel ends in " - Topic": rejected (auto-generated art-only uploads)
  - view count: tie-break only
- **Denied candidates** per key are remembered, so "wrong" moves to the next
  one and never comes back to a rejected id.
- **Overrides** win before any search: `overrides\Artist - Title.mp4`, flat or
  inside an artist folder, matched by the same key.

### Stream and download

- **Stream**: resolve a single 720p-or-lower mp4 video-only format URL (muted
  playback needs no audio) and pipe it through `/api/video/play/<key>` with
  range support. Proxying through the hub sidesteps YouTube's IP binding and
  expiry and keeps one URL for the TV. **The first task of phase 1 is a spike
  proving which format `AVPlayer` plays cleanly: a progressive mp4, or the HLS
  manifest some client types return.** This is the most volatile piece of the
  design and the one that proves or disproves "stream first".
- **Download**, in the background after the stream starts:
  `bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]`, merged to mp4 by
  ffmpeg (a copy, no re-encode, a second or two), plus a jpg thumbnail. Written
  to a temp name and renamed into place so a half file is never served.
- **Prefetch**: when `nextTrack` is present in the zone state, resolve it and
  start its download while the current song plays. Spotify handoffs become
  seamless; Pandora first plays show the Resolving state for a few seconds.
- **Concurrency**: one download at a time, one stream resolve at a time, queued
  per key, so a skip-happy guest cannot fan out twenty yt-dlp processes.

### Collection and eviction

- Every play updates `plays` and `lastPlayedAt` in the index.
- When cache bytes exceed the cap, evict least recently played until under.
  Overrides are never counted or evicted.
- The index is `index.json` in the folder (the collection is self-describing if
  it moves) with a local copy under `C:\Services\FrameServer\data\` so a NAS
  hiccup does not take Now Playing down. The local copy is the one the hub reads;
  the NAS copy is written through on every change.

### Dashboard

A Videos page on `/admin`:

- Folder path and whether it is reachable right now; yt-dlp version; last
  successful fetch; cache bytes against the cap, with the cap editable.
- The collection: thumbnail, artist and title, the matched video title and
  channel, plays, last played; per row Re-match, a paste-a-link box, Delete.
- Sonos Favorites with a Videos setting each (Yes / No), default Yes.
- A Clear cache button (overrides untouched).

The TV's device card gains the backdrop picker, so Music Videos can be switched
on from a phone.

## Storage: the NAS folder

```
\\MissionControl\Media\Music Videos TV\
  cache\                      what the resolver fetched; evictable
    Daft Punk\
      Daft Punk - Get Lucky [h5EofwRzit0].mp4
      Daft Punk - Get Lucky [h5EofwRzit0].jpg
  overrides\                  hand-picked files; never evicted, always win
    Fleetwood Mac - Dreams.mp4
  index.json                  every match: key, video id, channel, durations,
                              plays, last played, denied candidates, source
  README.txt                  the naming rule
```

**Setup task before phase 1 can write there.** The photo migration found that UNC
paths do not authenticate from a non-interactive session on the NUC (see
`photo-refresh-automation.md`, "Sharp edges"); the service runs as Local System.
The fix: run `SmartDisplaySonosAPI`'s sibling `SmartDisplayFrameServer` under
Justin's Windows account (`nssm set SmartDisplayFrameServer ObjectName ...`) with
the MissionControl credentials saved in Windows Credential Manager, then point
`MUSIC_VIDEOS_DIR` at the UNC path. The health route reports reachability so a
lost mount shows on the dashboard instead of as silent misses. The NUC's own disk
(237 GB, little headroom) is not an option for a 100 GB collection.

## Tooling on the NUC

- `yt-dlp.exe` and `ffmpeg.exe` in `C:\Services\FrameServer\bin\`, paths in
  environment settings so they can move.
- A weekly scheduled task runs `yt-dlp -U`; the hub records the version and the
  time of the last successful fetch, both on the dashboard.
- When yt-dlp fails three times in a row the dashboard shows a red line; the
  collection keeps serving, so a breakage degrades to "only songs we have".

## Pruning the backdrop cycle

`FramedBackdrop` keeps its raw values for the survivors (Drift 1, Smoke 3,
Marble 7, Mixtape 8) and adds Music Videos as 9. Removed values (Still 0, Lava 2,
Caustics 4, Ripple 5, Bars 6) map to Smoke on load, and Smoke replaces Lava as
the default. The shader code for the removed styles is deleted from
`Backdrop.metal` and `FluidBackdrop.swift`; `LavaBackdrop.swift` goes. The
Settings row and the center-button cycle pick the new list up from `allCases`.

## Phases

**Phase 1, the engine.** The service account and folder setup; the stream spike;
the resolver with search, scoring, stream proxy, background download, index,
eviction, prefetch, overrides, the station gate and the ad gate; the dashboard
Videos page and the backdrop picker on the TV card; the Music Videos backdrop on
the TV with the six states drawn plainly, the lower-third, the long press, and
the one-hour revert; the pruning. Done means: a Spotify evening on the TV with
videos for most songs, no crashes, the collection growing on the NAS and visible
on the dashboard, and the instrumental station never showing a video.

**Phase 2, the skin.** Justin explores the nostalgic TV look with ChatGPT renders
(appendix), picks a direction, and it is built as a view over the phase 1
inputs. Hold, Miss, Ad and Resolving get their fun treatments here.

**Later, not this round.** A video button on the kitchen's Now Playing that plays
the hub's file on the Pi; the family-room Echo; a house-state flag with time and
group rules if the picker proves too manual; a "TV is the source" mode if a Sonos
soundbar ever sits on that TV.

## Risks

- **YouTube's terms.** Fetching outside the official player is against them.
  Private, in-home use; never ship this publicly.
- **Breakage.** yt-dlp breaks every few months as YouTube changes; the weekly
  self-update and the dashboard line make it visible, and the collection keeps
  the evening going. The stream path is the more fragile of the two, which is
  why the download exists.
- **NAS authentication from the service.** Known hazard, planned around with the
  service account change and the health route.
- **Mismatches.** Covers and remasters will sometimes match the wrong upload;
  the long press and the dashboard are the correction path, and the per-key
  deny list makes every fix stick.

## Appendix: the ChatGPT prompt for the phase 2 look

Paste this into ChatGPT (image generation) when ready to explore the skin.

> I am designing a full-screen "Now Playing" view for a living room TV
> (1920 x 1080, 16:9). It shows the official music video for whatever song is
> playing on our Sonos, muted, as a nostalgic, playful visual. The vibe is
> "old TV": CRT sets, cable boxes, VHS, MTV in its early years, rabbit ears,
> test patterns, snow. Fun, clever and novel, not a sterile media player.
>
> Please render 6 distinct directions as separate 1920 x 1080 images, one
> image per direction, each with a one-line rationale. Use this sample data
> everywhere: artist "Daft Punk", title "Get Lucky", album "Random Access
> Memories", station "Discover Weekly" (Spotify). Album art is a black square
> with the two chrome helmets; you may stylize it.
>
> Directions to cover:
> 1. The video playing inside a vintage CRT television that fills most of the
>    frame, set in a warm 70s or 80s room (wood panel, shag, a lamp). The
>    song's metadata appears as something physical in the scene: a cassette on
>    the shelf, a Polaroid taped to the set, a TV Guide page.
> 2. Full-bleed video with an early-MTV style lower-third: artist, title,
>    album, station, in a period typeface, with a small channel bug in the
>    corner.
> 3. The video as a VHS playback: tracking lines at the bottom, a "PLAY"
>    OSD and timecode, slight color bleed, a tape label with the metadata.
> 4. A cable box "scrambled channel" state (the wavy, rolling, color-shifted
>    picture of a channel you did not subscribe to) for the moments between
>    songs or when a video ends early. Show the metadata somehow surviving the
>    scramble.
> 5. A "no signal" state for songs that have no video: a color-bar test
>    pattern or a "Please Stand By" card that incorporates the album art and
>    the song metadata.
> 6. Your own idea in the same spirit: something I have not listed.
>
> Rules: the video content itself should read as a real music video playing
> (use a generic performance frame). Keep text legible from a couch at 3 m.
> No modern flat UI, no glassmorphism, no gradients-and-rounded-cards look.
> Label each image with its direction number.

Follow-ups to ask ChatGPT after the first round: variations on the one or two
directions that land; the same direction in its "tuning in" and "lost the
station" states; a version with the lower-third gone so the video owns the
screen.
