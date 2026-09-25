---
title: "Plex second screen - what the living room is watching, on the family-room screen"
created: 2026-09-25
modified: 2026-09-25
version: 1.0
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, plex, tmdb, second-screen, echo-show, family-room, frameserver, web-app]
---

# Plex second screen

**Status: built overnight 2026-09-24/25 (commit `1a4962f`) and deployed to
the hub 2026-09-25 08:24.** The family-room Echo Show 10 (`family-room-echo`)
follows the living-room Apple TV. Transport control is built but untested:
the Apple TV's Plex app is not advertising itself as a player yet. Review
shots: `_review/plex/` (fixture sessions and one live capture).

When the living room plays something in Plex on the Apple TV, the family-room
screen switches to a "what's on" view: the show, season and episode (or the
film and its year), the air date, the runtime, where playback is, the summary
and the cast with their faces. A tap on a face says who that is and what else
of theirs is in the Plex library. When playback stops, the screen goes back
to its home view. Logged on 2026-09-24 as a later phase of the Echo Show work
(BACKLOG) and built the same night.

## Decisions (2026-09-24)

- **Cast from TMDB by id, never by title.** Plex's own `Guid[]` carries
  `tmdb://<id>` for a film, and an episode's show carries its TMDB id, so the
  hub asks TMDB for exactly that item (for an episode, the show's id plus the
  season and episode numbers). No title search anywhere. Without a TMDB key
  the view shows Plex's own cast list.
- **Skipped:** on-screen face matching (who is on screen right now) and song
  detection (what is playing in a scene).
- **Skipped:** trailers and extras, music, and photos. Sessions of type
  `clip`, `track` and `photo` are dropped.

The shape that follows from those: one screen follows one Plex player
(`display.plexFollow`), the hub does all the talking to Plex and TMDB, and
transport buttons appear only for a player that can actually be reached.

## Hub

### Plex (`frameserver/lib/plex.mjs`)

- Plex Media Server runs on the NUC next to FrameServer, so the hub talks to
  it on loopback: `PLEX_URL` (default `http://127.0.0.1:32400`) with the
  server owner's token, `PLEX_TOKEN` from the environment or `.env`, else the
  file `PLEX_TOKEN_FILE` (default `secrets/plex-token.txt`, copied by hand,
  never in git). The token is re-read at most once a minute, so adding or
  rotating it needs no restart; it travels in a header only and is never
  logged or returned.
- **Sessions.** Every 5 s, one request at a time, `GET /status/sessions`
  becomes the snapshot `GET /api/plex/now` serves (the route never waits on
  Plex). Clips, tracks and photos are dropped. Each item's metadata
  (`/library/metadata/<ratingKey>`, and its show's for an episode) is fetched
  once and cached an hour (up to 200 items), so the 5 s poll stays one
  request. Plex down: the last snapshot stays, with `error` set.
- **Players.** Every player seen in a session is kept in `plex-players.json`
  in the service root with the last item it played (`lastSeenAt` written at
  most every 5 minutes). `GET /api/plex/players` lists them, newest first,
  for the follow select. A player appears only once it has played something
  while the hub was running.
- **Who can be controlled.** `GET /clients` every 30 s lists the players that
  advertise themselves; a session is `controllable` when its player is
  listed.
- **Transport.** `POST /api/plex/command { machineId, action }`, action one of
  `play`, `pause`, `stop`, `back`, `forward`, `ccOn`, `ccOff`. The hub checks
  `/clients` first (re-read when the list is older than 5 s); a player that
  is not listed gets `{ ok: false, status: 404, error: 'player not
  advertising' }` and Plex is never called. Otherwise the command goes
  through the server's Companion relay (`GET /player/playback/<cmd>` with
  `commandID`, `type=video` and `X-Plex-Target-Client-Identifier`): `back`
  is a seek to the offset minus 10 s, `forward` plus 30 s, `ccOn` selects the
  first English subtitle stream (else the first one), `ccOff` sets subtitle
  stream 0. A refused command is still HTTP 200 with the reason in the body,
  so a screen reads one shape; malformed input is a 400. A command that went
  through triggers a fresh poll 0.8 s later.
- **Images.** Plex images need the token, so screens load them from
  `GET /api/plex/image?path=&w=&h=`: only Plex `/library/` and `/photo/`
  paths (no scheme, no `..`, no `//`), sizes clamped to 16..2000, fetched
  through Plex's transcoder with `format=jpeg` forced (quality 82; without it
  a PNG poster came back as a PNG, 1.1 MB against 190 kB for 600x900, which
  the Echo would pull on every item), served with a one-day cache (the path
  names the image and its version).
- **People.** `GET /api/plex/person?tmdbId=&name=&exclude=` answers `{ ok,
  name, tmdbId, profile, biography, birthday, deathday, placeOfBirth,
  knownForDepartment, knownFor, inLibrary, tmdb: { configured, found }, error
  }`. `knownFor` is TMDB's (below). `inLibrary` comes from Plex itself:
  `/hubs/search` answers a name with an Actors hub, one entry per library
  section keyed by Plex's own tag id, so each section is read with an exact
  actor filter, best-rated first, up to 8 films and shows, cached 24 h per
  name. `exclude` (rating keys) leaves out the item on screen.
- `GET /healthz` carries `plex: { sessions, error, controllable, clients,
  clientsError, players, fetchedAt, fixture, tmdb }`.

### TMDB (`frameserver/lib/tmdb.mjs`)

- Optional. `TMDB_API_KEY`, else the file `TMDB_API_KEY_FILE` (default
  `secrets/tmdb-key.txt`). Either form works: a v3 API key (sent as the
  `api_key` query parameter) or a v4 read access token (a JWT, sent as a
  Bearer header). Never logged or returned.
- **Credits** by id only: a film's `/movie/{id}/credits` in billing order; an
  episode's `/tv/{id}/season/{n}/episode/{m}/credits`, the cast then the guest
  stars, falling back to the show's regular cast when TMDB does not know the
  episode (its numbering can differ from Plex's for specials and split
  seasons). The top 12 who have a profile picture, each `{ name, role, thumb,
  tmdbPersonId }`, `thumb` a public `image.tmdb.org` URL (w185) the screen
  loads directly. Cached 24 h per item. A newly seen item's credits are
  waited on for up to 2.5 s so the first snapshot usually has them.
- **Person cards**: `/person/{id}?append_to_response=combined_credits`.
  Known for = acting credits by vote count, highest first, deduped by title,
  talk, news and reality TV left out (otherwise every actor's most-voted
  credit is a late-night show), top 10, posters w342. Biography trimmed to
  about 900 characters. Cached 24 h.
- A 404 is cached as "nothing there" for 6 h; a failure (network, 5xx, a
  refused key) is retried after 10 minutes and logged at most every 10.

### The snapshot (`GET /api/plex/now`)

```
{ fetchedAt, error, servedAt, source, tmdb,
  sessions: [{ key,
    player: { name, machineId, product, platform, address, local, state },
    user,
    controllable,
    media: { type, ratingKey, title, show, season, episode, episodeTitle,
             year, airDate, durationMs, offsetMs, offsetAt, contentRating,
             rating, tagline, summary, genres, directors, writers, studio,
             poster, art, cast: [{ name, role, thumb, tmdbPersonId }],
             castSource, subtitles, subtitlesOn, guids } }],
  players: [{ name, machineId, product, platform, lastSeenAt, lastItem }] }
```

- `servedAt` is the hub's clock at the answer, so a screen can age
  `offsetAt` without trusting its own clock; `source` is `plex` or
  `fixture`; `tmdb` says whether a key is configured.
- `state`: `playing`, `paused`, `buffering`, `stopped` or `unknown`. `type`:
  `movie`, `episode` or `other`; `show`, `season`, `episode` and
  `episodeTitle` are set for episodes.
- `offsetAt` is when this `offsetMs` was first seen: Plex updates the offset
  only when the player reports its timeline, so the screen advances it
  locally while the state is `playing`.
- `poster` and `art` are hub image paths; an episode's poster is its show's.
- `cast` holds up to 12 people; `castSource` is `tmdb` or `plex` (Plex's
  cast carries a `plexId` instead of a `tmdbPersonId`). `guids` is `{ tmdb,
  imdb, tvdb }`. `subtitles` lists the streams as `{ id, language,
  languageCode, title, forced, selected }`.
- The code also carries `showRatingKey`, `ratingSource`, `ultraBlur` (Plex's
  four corner colours) and `showGuids` (the show's ids, for an episode's
  TMDB lookup).

## Web app

### The setting

`display.plexFollow`: `off` (the default) or a player's machineIdentifier,
DEVICE scope like the rest of `display.*`. Set from the screen's Settings
(Plex > "Follow Plex player") or the dashboard's Plex card ("Follow Plex
player", listing the players the hub has seen). The dashboard's Show row
gains Plex for web screens, and `?view=plex` opens the view by URL.

### `hooks/usePlexNow.js`

A module store read with `useSyncExternalStore`, like `hooks/useCalendar.js`.
It polls `/api/plex/now` every 5 s only while something active needs it: the
Plex view on screen, or the follow logic on a screen that follows a player. A
screen that follows nobody never polls. A hidden page stops and asks again
the moment it is visible. Each session's offset is aged to the moment it
arrived using the hub's clock (`servedAt - offsetAt`), so a screen whose own
clock is a minute off still draws the right progress. The snapshot carries
`hubError` (this screen cannot reach the hub), `plexError` (the hub cannot
reach Plex, or has no token), `plexDown` (a Plex error with the hub's last
good copy over 15 s old), `stale` (no good answer for 30 s) and `loaded`.
Dev builds only: `?plexTest=<machineId>` follows a player without saving
anything.

### Following (`PlexFollow` in `shell/AppShell.jsx`)

- The followed player playing (or buffering) the same item for 10 continuous
  seconds switches the screen to the Plex view. The count is per item: the
  next episode starts its own.
- On the view, a pause keeps it, with a Paused badge.
- Back to the home view (`display.homeView`) when the session is gone or
  stopped for 30 s, paused for 10 minutes, or when the hub (or Plex behind
  it) has not answered for 2 minutes, so a hub restart mid-film does not
  bounce the screen.
- Leaving the view any other way (the menu, a dashboard nudge, the morning
  auto-show) suppresses re-entry until a different item plays or the session
  ends: nobody wants the screen snatched back 10 s after choosing Photos.
- Never out of Settings (it waits until Settings idles home), never wakes a
  dimmed or off screen (the view changes under the night overlay and a touch
  shows it), never in the layout editor's preview and never on the legacy web
  TV (`?kiosk=tv`).

### The view (`views/Plex/`)

`PlexView`, `PersonCard`, `PlexParts` (icons, poster, faces) and
`plexFormat` (the words and numbers). Designed at 1280x800 (the Echo Show 10)
and checked at 1920x1080:

- The item's art, blurred and darkened, fills the screen; the poster sits
  left; "Playing on Apple TV" and the time top right.
- The right column: the show, season and episode and the episode title (or
  the film's title and year), the air date, the runtime, the content rating,
  the rating, the genres, the tagline and director where there are some, and
  a progress bar with elapsed and time left that advances locally between
  the hub's polls.
- The transport bar (back 10, play or pause, stop, forward 30, captions) only
  when the session is controllable; a tap shows its result at once and holds
  it for up to 6 s until the hub confirms; a refusal shows its reason for
  6 s. Not controllable: the line "Turn on Advertise as Player in the Plex
  app on the Apple TV to control it from here".
- The summary, then six cast headshots with their roles. A tap opens the
  person card: name, picture, who they play here, Known for (TMDB) and In
  your Plex library (Plex), up to 8 posters each. It closes on a tap outside,
  the close button, or after 45 s left alone.
- Honest states: the hub unreachable, Plex unreachable (the hub's error), and
  nothing playing (the player's last item, faded). Opened by hand on a screen
  that follows nobody, the view shows the first session playing and goes
  home after a minute of nothing.

## Testing

- `PLEX_FIXTURE` (hub): a JSON file of sessions, clients and metadata read
  instead of `/status/sessions` and `/clients`, re-read when it changes;
  metadata it lacks is still fetched from Plex, and commands are never sent
  (a 409 "fixture mode"). Never set on the NUC.
- The review shots in `_review/plex/` come from a scratch hub with fixtures
  (an episode playing, paused and with captions on, the person card, nothing
  playing, the hub and Plex unreachable, the fixture-mode refusal) plus one
  live capture of a real film on the Apple TV (no transport, the hint).
- The hub's test suite has no Plex or TMDB tests yet (see Later).

## Secrets

- Plex token: the server owner's token, in the hub's `secrets/plex-token.txt`,
  with a copy in `~/.config/smart-display/` on the Mac.
- TMDB key: landed 2026-09-24 at about 23:00, in
  `~/.config/smart-display/tmdb-key.txt` and the hub's `secrets/`. `/healthz`
  reports `plex.tmdb: true`.
- Neither goes into git or `_inbox/` (which syncs to Dropbox).

## Status (2026-09-25)

- Deployed to the hub 2026-09-25 08:24 (build `7a87bdd - 2026-09-25 08:24`).
  The Echo Shows load the app from the hub, so they have it; the kitchen Pi
  got the same code at 08:41 (build `812242f`), though it follows nobody.
- `family-room-echo` follows the Apple TV (machineId `D974B7E4-...`).
- The Apple TV's Plex app is not advertising: `/clients` lists no players, so
  no screen shows the transport bar and control is untested.
- At 08:31 the hub had seen no Plex session since the deploy, so its player
  list was still empty; the dashboard's select fills once the Apple TV plays
  something.

## Still needs Justin

- Turn on Advertise as Player in the Plex app's settings on the Apple TV.
- Confirm the family-room Echo as the follower: play something on the Apple
  TV and check the Echo switches after about 10 s and goes home about 30 s
  after stopping.

## Later

- Test transport control (play, pause, stop, skips, captions) once the Apple
  TV advertises.
- A Plex button in the menu pill, to open the view by hand.
- A "New on Plex" panel (recently added to the library) for the spec
  layouts.
- Unit tests for `lib/plex.mjs` and `lib/tmdb.mjs` in the hub suite (their
  normalisers and command builders are pure and exported).
