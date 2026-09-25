import { useCallback, useEffect, useState } from 'react'
import usePlexNow, {
  PLEX_OFF,
  currentOffsetMs,
  effectivePlexFollow,
  pickSession,
  plexImageUrl,
  postPlexCommand,
} from '../../hooks/usePlexNow.js'
import { HUB } from '../../lib/hub.js'
import { useSettings } from '../../lib/settings.js'
import { useView } from '../../shell/ViewContext.jsx'
import { getHomeView } from '../../shell/homeView.js'
import PersonCard from './PersonCard.jsx'
import { Face, PlexIcon, Poster } from './PlexParts.jsx'
import {
  cleanShowTitle,
  episodeCode,
  fmtAgo,
  fmtAudience,
  fmtClock,
  fmtDate,
  fmtLeft,
  fmtRuntime,
  fmtTimecode,
  joinNames,
} from './plexFormat.js'
import './PlexView.css'

// PlexView - what the living room is watching, for the family-room screen.
//
// Designed at 1280x800 (the family-room Echo Show 10), checked at 1920x1080.
// The item's art, blurred and darkened, fills the screen; the poster sits left;
// the right column carries the show and episode (or the film), the air date,
// the runtime and a progress bar that advances locally between the hub's
// 5 s polls, the transport bar when the player advertises itself to Plex,
// the summary and six of the cast. A tap on a headshot opens a person card.
//
// The shell brings this view up when the followed player plays for 10 s and
// takes it down when the session ends (AppShell PlexFollow, display.plexFollow).
// Opened by hand (the dashboard's Show, ?view=plex) on a screen that follows
// nobody, it shows the first session playing and goes home after a minute of
// nothing.
//
// Honest states: the hub unreachable, Plex unreachable (the hub's error), and
// nothing playing (the player's last item, faded).

const IDLE_TO_HOME_MS = 60 * 1000
// A tap on play / pause shows its result at once and holds it this long, or
// until the hub confirms it.
const PENDING_MS = 6 * 1000
const COMMAND_ERROR_MS = 6 * 1000
const CAST_SHOWN = 6

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

function Separated({ items, className }) {
  const shown = items.filter(Boolean)
  if (!shown.length) return null
  return (
    <div className={className}>
      {shown.map((it, i) => (
        <span className="pv__mi" key={i}>
          {i > 0 && (
            <span className="pv__sep" aria-hidden="true">
              ·
            </span>
          )}
          {it}
        </span>
      ))}
    </div>
  )
}

function Backdrop({ media }) {
  const blur = media?.ultraBlur
  // Plex's four-corner colours first, so the page has its colour before the
  // art arrives (and keeps it if the art never does).
  const style = blur
    ? {
        background: [
          `radial-gradient(ellipse at 0% 0%, ${blur.topLeft} 0%, transparent 65%)`,
          `radial-gradient(ellipse at 100% 0%, ${blur.topRight} 0%, transparent 65%)`,
          `radial-gradient(ellipse at 100% 100%, ${blur.bottomRight} 0%, transparent 65%)`,
          `radial-gradient(ellipse at 0% 100%, ${blur.bottomLeft} 0%, transparent 65%)`,
          '#07080a',
        ].join(', '),
      }
    : undefined
  // The art is blurred to nothing, so a small copy does: less for Silk to
  // decode and upscale.
  const art = plexImageUrl(media?.art, 640, 360)
  return (
    <div className="pv__bg" aria-hidden="true">
      <div className="pv__tint" style={style} />
      {art && <img className="pv__art" src={art} alt="" draggable="false" />}
      <div className="pv__shade" />
    </div>
  )
}

function TransportButton({ icon, label, onClick, main = false, on = false, disabled = false }) {
  return (
    <button
      type="button"
      className={`pv__btn${main ? ' pv__btn--main' : ''}${on ? ' pv__btn--on' : ''}`}
      aria-label={label}
      aria-pressed={icon === 'cc' ? on : undefined}
      aria-disabled={disabled || undefined}
      data-interactive="true"
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onClick()
      }}
    >
      <PlexIcon name={icon} on={on} />
    </button>
  )
}

// A message in place of the details, over the last poster (faded).
function StateScreen({ now, poster, posterTitle, title, lines }) {
  return (
    <div className="pv pv--state">
      <Backdrop media={null} />
      <header className="pv__top">
        <span className="pv__clock">{fmtClock(now)}</span>
      </header>
      <main className="pv__main">
        <div className="pv__poster-wrap">
          <Poster src={plexImageUrl(poster)} title={posterTitle || 'Plex'} className="pv__poster pv__poster--faded" />
        </div>
        <section className="pv__details">
          <h1 className="pv__state-title">{title}</h1>
          {lines.filter(Boolean).map((l, i) => (
            <p className="pv__state-line" key={i}>
              {l}
            </p>
          ))}
        </section>
      </main>
    </div>
  )
}

function lastPlayedLine(item) {
  if (!item) return null
  if (item.type === 'episode') {
    return [cleanShowTitle(item.show), episodeCode(item.season, item.episode), item.title].filter(Boolean).join(' · ')
  }
  return item.year ? `${item.title} (${item.year})` : item.title
}

export default function PlexView() {
  const snap = usePlexNow()
  const settings = useSettings()
  const follow = effectivePlexFollow(settings.display?.plexFollow)
  const { setView } = useView()
  const now = useNow()
  const [personFor, setPersonFor] = useState(null)
  const [pending, setPending] = useState(null) // { key, state, until, offset }
  const [pendingCc, setPendingCc] = useState(null) // { key, on, until }
  const [cmdError, setCmdError] = useState(null)

  const session = pickSession(snap, follow)
  const followed = follow !== PLEX_OFF ? snap.players.find((p) => p.machineId === follow) || null : null
  const player = session?.player || followed || snap.players[0] || null
  const hubDown = !!snap.hubError && (snap.stale || !snap.loaded)
  const plexDown = !hubDown && snap.plexDown
  const hasSession = !hubDown && !plexDown && !!session

  // Following nobody, opened by hand: nothing playing for a minute -> home.
  // (Following a player, the shell's follow logic owns the way out.)
  useEffect(() => {
    if (follow !== PLEX_OFF || hasSession) return undefined
    const id = setTimeout(() => setView(getHomeView()), IDLE_TO_HOME_MS)
    return () => clearTimeout(id)
  }, [follow, hasSession, setView])

  useEffect(() => {
    if (!cmdError) return undefined
    const id = setTimeout(() => setCmdError(null), COMMAND_ERROR_MS)
    return () => clearTimeout(id)
  }, [cmdError])

  const closePerson = useCallback(() => setPersonFor(null), [setPersonFor])

  if (!snap.loaded && !snap.hubError) {
    return <StateScreen now={now} title="Looking for Plex…" lines={[]} />
  }
  if (hubDown) {
    return (
      <StateScreen
        now={now}
        poster={player?.lastItem?.poster}
        posterTitle={player?.lastItem?.title}
        title="Can't reach the hub"
        lines={[`FrameServer${HUB ? ` at ${HUB}` : ''} is not answering (${snap.hubError}).`, 'Trying again every few seconds.']}
      />
    )
  }
  if (plexDown) {
    return (
      <StateScreen
        now={now}
        poster={player?.lastItem?.poster}
        posterTitle={player?.lastItem?.title}
        title="Plex isn't answering"
        lines={[snap.plexError, 'The hub keeps asking every 5 seconds.']}
      />
    )
  }
  if (!session) {
    const item = player?.lastItem
    const ago = item ? fmtAgo(item.at, now.getTime()) : null
    return (
      <StateScreen
        now={now}
        poster={item?.poster}
        posterTitle={item?.title}
        title={`Nothing playing on ${player?.name || 'Plex'}`}
        lines={[item ? `Last played: ${lastPlayedLine(item)}` : null, ago ? `Stopped ${ago}.` : null]}
      />
    )
  }

  const media = session.media
  const isEpisode = media.type === 'episode'
  const realState = session.player.state
  const nowMs = now.getTime()
  const pend = pending && pending.key === session.key && nowMs < pending.until && pending.state !== realState ? pending : null
  const state = pend ? pend.state : realState
  const paused = state === 'paused'
  const ccReal = !!media.subtitlesOn
  const pendC = pendingCc && pendingCc.key === session.key && nowMs < pendingCc.until && pendingCc.on !== ccReal ? pendingCc : null
  const ccOn = pendC ? pendC.on : ccReal
  const hasSubs = media.subtitles.length > 0

  // While a play / pause is pending the bar holds where it was tapped.
  const offset = pend ? pend.offset : currentOffsetMs(session, nowMs)
  const duration = Number(media.durationMs) || 0
  const pct = duration > 0 ? Math.min(100, Math.max(0, (offset / duration) * 100)) : 0

  async function send(action) {
    // The render's clock (at most a second old) is precise enough here.
    const at = nowMs
    if (action === 'play' || action === 'pause') {
      setPending({
        key: session.key,
        state: action === 'pause' ? 'paused' : 'playing',
        until: at + PENDING_MS,
        offset: currentOffsetMs(session, at),
      })
    }
    if (action === 'ccOn' || action === 'ccOff') {
      setPendingCc({ key: session.key, on: action === 'ccOn', until: at + PENDING_MS })
    }
    const r = await postPlexCommand(session.player.machineId, action)
    if (!r.ok) {
      setPending(null)
      setPendingCc(null)
      setCmdError(r.error || 'the command did not go through')
    }
  }

  const where = `${state === 'paused' ? 'Paused' : state === 'buffering' ? 'Loading' : 'Playing'} on ${session.player.name}`
  const hint =
    session.player.platform === 'tvOS'
      ? 'Turn on Advertise as Player in the Plex app on the Apple TV to control it from here'
      : `Turn on Advertise as Player in the Plex app on ${session.player.name} to control it from here`

  const meta = isEpisode
    ? [
        media.airDate ? `Aired ${fmtDate(media.airDate)}` : media.year,
        fmtRuntime(duration),
        media.contentRating && <span className="pv__chip">{media.contentRating}</span>,
        media.genres.slice(0, 3).join(', ') || null,
      ]
    : [
        media.year,
        fmtRuntime(duration),
        media.contentRating && <span className="pv__chip">{media.contentRating}</span>,
        fmtAudience(media.rating, media.ratingSource),
      ]

  return (
    <div className={`pv${paused ? ' pv--paused' : ''}`}>
      <Backdrop media={media} />

      <header className="pv__top">
        <span className="pv__where">{where}</span>
        <span className="pv__clock">{fmtClock(now)}</span>
      </header>

      <main className="pv__main">
        <div className="pv__poster-wrap">
          <Poster
            src={plexImageUrl(media.poster)}
            title={isEpisode ? cleanShowTitle(media.show) : media.title}
            className="pv__poster"
          />
          {paused && <span className="pv__badge">Paused</span>}
        </div>

        <section className="pv__details">
          {isEpisode ? (
            <>
              <div className="pv__eyebrow">{cleanShowTitle(media.show)}</div>
              {media.season != null && media.episode != null && (
                <div className="pv__sub">
                  Season {media.season} · Episode {media.episode}
                </div>
              )}
            </>
          ) : (
            media.genres.length > 0 && <div className="pv__eyebrow">{media.genres.slice(0, 3).join(' · ')}</div>
          )}
          <h1 className="pv__title">{media.title}</h1>
          <Separated items={meta} className="pv__meta" />
          {!isEpisode && media.tagline && <div className="pv__tagline">{media.tagline}</div>}
          {!isEpisode && media.directors.length > 0 && (
            <div className="pv__credit">Directed by {joinNames(media.directors)}</div>
          )}

          <div className="pv__progress">
            <div className="pv__bar">
              <div className="pv__fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="pv__times">
              <span>{fmtTimecode(offset)}</span>
              <span>{duration > 0 ? fmtLeft(duration - offset) : ''}</span>
            </div>
          </div>

          {session.controllable ? (
            <div className="pv__transport">
              <TransportButton icon="back" label="Back 10 seconds" onClick={() => send('back')} />
              <TransportButton
                icon={paused ? 'play' : 'pause'}
                label={paused ? 'Play' : 'Pause'}
                main
                onClick={() => send(paused ? 'play' : 'pause')}
              />
              <TransportButton icon="stop" label="Stop" onClick={() => send('stop')} />
              <TransportButton icon="forward" label="Forward 30 seconds" onClick={() => send('forward')} />
              <TransportButton
                icon="cc"
                label={ccOn ? 'Captions off' : 'Captions on'}
                on={ccOn}
                disabled={!hasSubs}
                onClick={() => send(ccOn ? 'ccOff' : 'ccOn')}
              />
            </div>
          ) : (
            <div className="pv__hint">{hint}</div>
          )}
          {cmdError && <div className="pv__cmd-error">Could not send that: {cmdError}</div>}

          {media.summary && <p className="pv__summary">{media.summary}</p>}

          {media.cast.length > 0 && (
            <div className="pv__cast">
              {media.cast.slice(0, CAST_SHOWN).map((c) => (
                <button
                  type="button"
                  className="pv__person"
                  key={`${c.name}:${c.role || ''}`}
                  data-interactive="true"
                  aria-label={c.role ? `${c.name}, ${c.role}` : c.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPersonFor(c)
                  }}
                >
                  <Face src={plexImageUrl(c.thumb)} name={c.name} className="pv__face" />
                  <span className="pv__person-name">{c.name}</span>
                  {c.role && <span className="pv__person-role">{c.role}</span>}
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      {personFor && <PersonCard key={personFor.name} person={personFor} media={media} onClose={closePerson} />}
    </div>
  )
}
