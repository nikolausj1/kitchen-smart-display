import useTodayData from '../data/useTodayData.js'
import PhotoPanel from '../panels/PhotoPanel.jsx'
import NowPlayingPanel from '../panels/NowPlayingPanel.jsx'
import WeatherAttribution from '../panels/WeatherAttribution.jsx'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import { fmtDateLong, fmtTime } from '../lib/format.js'
import { skyFor } from '../data/wmo.js'
// Inter 300, latin subset only. main.jsx loads 400/600/700, so a rule asking for
// a lighter weight silently renders at 400 - and a hairline clock is the whole
// point of this layout. Inter is already a dependency: this is one more face of
// a font we ship, not a new one, and the latin subset is all a clock and an
// English date line can use. Same weight the existing slideshow HUD asks for
// (views/PhotoSlideshow/overlays/TimeWidget.css). Delete this line and the clock
// falls back to 400; nothing else in the layout changes.
import '@fontsource/inter/latin-300.css'
import '../tokens.css'
import './AmbientLayout.css'

// AmbientLayout - the photo-forward Today.
//
// One full-bleed slideshow with a quiet heads-up display over it: time, date
// and greeting bottom-left, weather and the next thing bottom-right, a Now
// Playing chip that fades in bottom-centre while the Sonos is on. Everything
// the Board shows in panels is deliberately absent here; this screen is meant
// to be looked past, not read.
//
// The clock is composed from lib/format.js rather than reused from ClockPanel:
// ClockPanel sizes its numerals in container-query units against a panel body,
// and this HUD block has no panel box to measure against (it is sized by its
// own content). Six lines of markup buys exact control of a hairline 11vh time.
//
// The photo's own caption is moved to the top-left in AmbientLayout.css so it
// cannot land under the clock - see the note there.

const SLIDESHOW_MIN_MS = 15_000
const SLIDESHOW_MAX_MS = 10 * 60_000
const PHOTO_COUNT = 24

// Floor of the "school morning" window the Leave-by line lives in. Mirrors
// MORNING_START_HOUR in shell/AppShell.jsx so the HUD and the boot-view
// heuristic agree on when a school morning starts (and so the line does not
// offer travel advice at 2am).
const MORNING_START_HOUR = 5

// '7:42' from a { hour, minute } setting. Pure string work on purpose: the
// React Compiler purity rule bans new Date() in render, and a depart time needs
// no date at all - only the meridiem would, and the HUD does not show one.
function fmtHm(hm) {
  if (!hm || typeof hm.hour !== 'number') return null
  const hour12 = hm.hour % 12 || 12
  return `${hour12}:${String(hm.minute || 0).padStart(2, '0')}`
}

// Is `now` inside the school morning that ends at `endsAt`? Minute precision,
// matching the auto-leave watcher in shell/AppShell.jsx.
function inMorningWindow(now, endsAt) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false
  if (!endsAt || typeof endsAt.hour !== 'number') return false
  const hour = now.getHours()
  if (hour < MORNING_START_HOUR) return false
  return hour * 60 + now.getMinutes() < endsAt.hour * 60 + (endsAt.minute || 0)
}

// The one line under the weather: what is next, in the order the HUD cares
// about. A school morning outranks everything (the countdown when the timer is
// armed, otherwise the departure it will arm with); after that, the first thing
// on today's activity list; otherwise nothing at all, and the corner stays
// empty rather than inventing filler.
function decideNext(school, timer, now) {
  if (!school?.noSchool && inMorningWindow(now, school?.morningEndsAt)) {
    const travel = timer?.travelMode === 'walking' ? 'walking' : 'driving'
    if (timer?.mode === 'active' && Number.isFinite(timer.minutesLeft)) {
      const left = timer.minutesLeft
      return {
        lead: left <= 0 ? 'Leave now' : `Leave in ${left} min`,
        trail: travel,
        band: timer.band || null,
      }
    }
    const depart = fmtHm(school?.departTimes?.[travel])
    if (depart) return { lead: `Leave by ${depart}`, trail: travel, band: null }
  }

  const activity = Array.isArray(school?.activities) ? school.activities[0] : null
  if (activity?.name) return { lead: activity.name, trail: activity.label || '', band: null }
  return null
}

export default function AmbientLayout() {
  const d = useTodayData()

  const { hm, ampm } = fmtTime(d.now)
  const date = fmtDateLong(d.now)

  // Cadence is the screen's own slideshow setting, clamped: under 15s a
  // full-bleed 1.2s crossfade never gets to settle, over 10 minutes the frame
  // reads as frozen.
  const rawInterval = d.settings?.slideshow?.intervalMs
  const intervalMs = Math.min(
    SLIDESHOW_MAX_MS,
    Math.max(SLIDESHOW_MIN_MS, Number.isFinite(rawInterval) ? rawInterval : SLIDESHOW_MIN_MS)
  )

  const current = d.weather?.current || null
  const tempF = Number.isFinite(current?.tempF) ? Math.round(current.tempF) : null
  // After dark a clear or partly cloudy sky draws the moon at tonight's phase:
  // the reading's own isDay and moonPhase, else worked out for now.
  const sky = current ? skyFor(current, d.now, d.weather) : null
  const next = decideNext(d.school, d.timer, d.now)

  // The chip is always mounted so it can fade both ways with opacity and never
  // shift the HUD; only this class decides whether it is visible.
  const chipOn = !!(d.music?.playing || d.music?.paused)

  return (
    <div className="tl-root tl-ambient">
      {/* Background layer. d.photos.photos is already album-filtered and keeps
        * its identity between ticks, which is what lets PhotoPanel's memo hold
        * through the 1 Hz re-render. */}
      <div className="tl-ambient__photo">
        <PhotoPanel
          photos={d.photos.photos}
          intervalMs={intervalMs}
          count={PHOTO_COUNT}
          fit="cover"
          showCounter
          showCaption
        />
      </div>

      {/* One scrim across the lower third so the HUD reads over a bright sky. */}
      <div className="tl-ambient__scrim" aria-hidden="true" />

      <div className="tl-ambient__hud">
        <div className="tl-ambient__clock">
          <div className="tl-ambient__time">
            <span className="tl-num tl-ambient__hm">{hm}</span>
            {ampm && <span className="tl-ambient__ampm">{ampm}</span>}
          </div>
          {date && <div className="tl-ambient__date">{date}</div>}
          {d.greeting && <div className="tl-ambient__greeting">{d.greeting}</div>}
        </div>

        <div className={`tl-ambient__chip${chipOn ? ' tl-ambient__chip--on' : ''}`}>
          <NowPlayingPanel music={d.music} now={d.now} />
        </div>

        <div className="tl-ambient__right">
          {/* No weather yet is an empty corner, not a row of dashes: the clock
            * over the photo still looks like a finished screen. */}
          {current && (
            <div className="tl-ambient__wx">
              <span className="tl-ambient__wx-icon">
                <WeatherIcon name={current.iconName} isDay={sky?.isDay} moonPhase={sky?.moonPhase} />
              </span>
              <span className="tl-num tl-ambient__wx-temp">
                {tempF == null ? '--' : tempF}&deg;
              </span>
              {current.description && (
                <span className="tl-ambient__wx-word">{current.description}</span>
              )}
            </div>
          )}
          {/* Apple's mark while its data is the reading above. */}
          {current && <WeatherAttribution attribution={d.weather?.attribution} />}

          {next && (
            <div
              className={`tl-ambient__next${next.band ? ` tl-ambient__next--${next.band}` : ''}`}
            >
              {next.band && <span className="tl-ambient__dot" aria-hidden="true" />}
              <span>{next.lead}</span>
              {next.trail && (
                <>
                  <span className="tl-ambient__sep" aria-hidden="true">
                    &middot;
                  </span>
                  <span className="tl-ambient__trail">{next.trail}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
