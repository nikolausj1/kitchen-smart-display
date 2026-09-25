import { useCallback, useEffect, useRef, useState } from 'react'
import usePlexNow, {
  PLEX_OFF,
  currentOffsetMs,
  effectivePlexFollow,
  getPlexActivityAt,
  notePlexActivity,
  pickSession,
  plexImageUrl,
  postPlexCommand,
} from '../../hooks/usePlexNow.js'
import { HUB } from '../../lib/hub.js'
import { plexTextScaleOf, useSettings } from '../../lib/settings.js'
import { useView } from '../../shell/ViewContext.jsx'
import { getHomeView } from '../../shell/homeView.js'
import CastBoard from './CastBoard.jsx'
import PersonCard from './PersonCard.jsx'
import { PlexIcon, Poster } from './PlexParts.jsx'
import { cleanShowTitle, episodeCode, episodeLine, fmtAgo, fmtClock, fmtRuntime } from './plexFormat.js'
import './PlexView.css'

// PlexView - who is in what the living room is watching, for the family-room
// screen (the Echo Show 10, 1280x800).
//
// Its job is "who is that, and what else are they in". A strip across the top
// says what is on: a small poster, the show and "S1 · E2 · The Oner" (or the
// film, its year and runtime), whether it is playing, the clock, the transport
// buttons when the player advertises itself to Plex (else a hint), and a thin
// progress bar along its bottom edge that advances locally between the hub's
// 5 s polls. The rest of the screen is the cast (CastBoard): everyone
// credited, big portrait cards with the character under the actor, scrolled
// by touch. A tap on a card opens that person full screen (PersonCard).
//
// Sizes are CSS pixels at 1280x800 times --pv-scale, which is the screen's
// display.plexTextScale (Settings > Plex > Plex text size, or the dashboard's
// Plex card), so one knob scales the whole view.
//
// The shell brings this view up when the followed player plays for 10 s and
// takes it down a minute after the session ends, once nobody has touched the
// view for a minute (AppShell PlexFollow, display.plexFollow). Until then the
// last item's cast stays, marked Stopped. Opened by hand (the dashboard's
// Show, ?view=plex) on a screen that follows nobody, it shows the first
// session playing and goes home after a minute with nothing playing and
// nobody touching it.
//
// Honest states: the hub unreachable, Plex unreachable (the hub's error), and
// nothing playing (the player's last item, faded).

const IDLE_TO_HOME_MS = 60 * 1000
// A tap on play / pause shows its result at once and holds it this long, or
// until the hub confirms it.
const PENDING_MS = 6 * 1000
const COMMAND_ERROR_MS = 6 * 1000

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
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

// A message in place of the cast, over the last poster (faded).
function StateScreen({ now, scale, poster, posterTitle, title, lines }) {
  return (
    <div className="pv pv--state" style={{ '--pv-scale': scale }} onPointerDown={notePlexActivity}>
      <Backdrop media={null} />
      <header className="pv__corner">
        <span className="pv__clock">{fmtClock(now)}</span>
      </header>
      <main className="pv__state">
        <Poster
          src={plexImageUrl(poster, 400, 600)}
          title={posterTitle || 'Plex'}
          className="pv__state-poster pv__poster--faded"
        />
        <section className="pv__state-text">
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

const STATE_WORD = { playing: 'Playing', paused: 'Paused', buffering: 'Loading', stopped: 'Stopped' }

export default function PlexView() {
  const snap = usePlexNow()
  const settings = useSettings()
  const follow = effectivePlexFollow(settings.display?.plexFollow)
  const scale = plexTextScaleOf(settings.display?.plexTextScale)
  const { setView } = useView()
  const now = useNow()
  const [personFor, setPersonFor] = useState(null) // { person, media }
  const [pending, setPending] = useState(null) // { key, state, until, offset }
  const [pendingCc, setPendingCc] = useState(null) // { key, on, until }
  const [cmdError, setCmdError] = useState(null)
  // The last session shown, kept on screen after it ends (as Stopped) so
  // someone reading the cast is not left with nothing: { follow, session }.
  const [kept, setKept] = useState(null)

  const live = pickSession(snap, follow)
  const followed = follow !== PLEX_OFF ? snap.players.find((p) => p.machineId === follow) || null : null
  const hubDown = !!snap.hubError && (snap.stale || !snap.loaded)
  const plexDown = !hubDown && snap.plexDown
  const hasSession = !hubDown && !plexDown && !!live
  if (hasSession && (kept?.session !== live || kept?.follow !== follow)) setKept({ follow, session: live })
  const keptSession = !hubDown && !plexDown && kept?.follow === follow ? kept.session : null
  const session = hasSession ? live : keptSession
  const player = session?.player || followed || snap.players[0] || null

  // Following nobody, opened by hand: a minute with nothing playing and
  // nobody touching the view -> home. (Following a player, the shell's
  // follow logic owns the way out.)
  useEffect(() => {
    if (follow !== PLEX_OFF || hasSession) return undefined
    const since = Date.now()
    const id = setInterval(() => {
      if (Date.now() - Math.max(since, getPlexActivityAt()) >= IDLE_TO_HOME_MS) setView(getHomeView())
    }, 1000)
    return () => clearInterval(id)
  }, [follow, hasSession, setView])

  useEffect(() => {
    if (!cmdError) return undefined
    const id = setTimeout(() => setCmdError(null), COMMAND_ERROR_MS)
    return () => clearTimeout(id)
  }, [cmdError])

  // Both stable: the card's close timer is keyed on closePerson, and the
  // memoised cast board would re-render every second for a new openPerson.
  // The media goes with the person, so the card still says "in <this>" if the
  // next episode starts while it is open.
  const mediaRef = useRef(null)
  useEffect(() => {
    mediaRef.current = session ? session.media : null
  })
  const openPerson = useCallback(
    (person) => {
      notePlexActivity()
      if (mediaRef.current) setPersonFor({ person, media: mediaRef.current })
    },
    [setPersonFor]
  )
  const closePerson = useCallback(() => {
    notePlexActivity()
    setPersonFor(null)
  }, [setPersonFor])

  if (!snap.loaded && !snap.hubError) {
    return <StateScreen now={now} scale={scale} title="Looking for Plex…" lines={[]} />
  }
  if (hubDown) {
    return (
      <StateScreen
        now={now}
        scale={scale}
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
        scale={scale}
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
        scale={scale}
        poster={item?.poster}
        posterTitle={item?.title}
        title={`Nothing playing on ${player?.name || 'Plex'}`}
        lines={[item ? `Last played: ${lastPlayedLine(item)}` : null, ago ? `Stopped ${ago}.` : null]}
      />
    )
  }

  const media = session.media
  const isEpisode = media.type === 'episode'
  const ended = !hasSession || session.player.state === 'stopped'
  const realState = ended ? 'stopped' : session.player.state
  const nowMs = now.getTime()
  const pend =
    !ended && pending && pending.key === session.key && nowMs < pending.until && pending.state !== realState
      ? pending
      : null
  const state = pend ? pend.state : realState
  const paused = state === 'paused'
  const ccReal = !!media.subtitlesOn
  const pendC =
    pendingCc && pendingCc.key === session.key && nowMs < pendingCc.until && pendingCc.on !== ccReal ? pendingCc : null
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

  const where = `${STATE_WORD[state] || 'Playing'} on ${session.player.name}`
  const hint =
    session.player.platform === 'tvOS'
      ? 'Turn on Advertise as Player in the Plex app on the Apple TV to control it from here'
      : `Turn on Advertise as Player in the Plex app on ${session.player.name} to control it from here`
  const title = isEpisode ? cleanShowTitle(media.show) || media.title : media.title
  const sub = isEpisode
    ? episodeLine(media.season, media.episode, media.title)
    : [media.year, fmtRuntime(duration)].filter(Boolean).join(' · ')
  const controls = !ended && session.controllable
  const castKey = `${session.key}:${media.ratingKey || media.title}`

  return (
    <div
      className={`pv${paused ? ' pv--paused' : ''}${ended ? ' pv--ended' : ''}`}
      style={{ '--pv-scale': scale }}
      onPointerDown={notePlexActivity}
    >
      <Backdrop media={media} />

      <header className="pv__strip">
        <Poster
          src={plexImageUrl(media.poster, 240, 360)}
          title={isEpisode ? cleanShowTitle(media.show) : media.title}
          className="pv__poster"
        />
        <div className="pv__heading">
          <h1 className="pv__title">{title}</h1>
          {sub && <div className={`pv__sub${isEpisode ? ' pv__sub--episode' : ''}`}>{sub}</div>}
          {cmdError ? (
            <div className="pv__cmd-error">Could not send that: {cmdError}</div>
          ) : (
            !ended && !session.controllable && <div className="pv__hint">{hint}</div>
          )}
        </div>
        {controls && (
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
        )}
        <div className="pv__status">
          <span className="pv__clock">{fmtClock(now)}</span>
          <span className="pv__where">{where}</span>
        </div>
        {!ended && (
          <div className="pv__bar" aria-hidden="true">
            <div className="pv__fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </header>

      {media.cast.length > 0 ? (
        <CastBoard key={castKey} cast={media.cast} castTotal={media.castTotal} onOpen={openPerson} />
      ) : (
        <div className="pv__no-cast">No cast listed for this one.</div>
      )}

      {personFor && (
        <PersonCard
          key={personFor.person.name}
          person={personFor.person}
          media={personFor.media}
          nowMs={nowMs}
          onClose={closePerson}
        />
      )}
    </div>
  )
}
