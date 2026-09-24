import useTodayData from '../data/useTodayData.js'
import ClockPanel from '../panels/ClockPanel.jsx'
import WeatherNowPanel from '../panels/WeatherNowPanel.jsx'
import WhatToWearPanel from '../panels/WhatToWearPanel.jsx'
import AirQualityChip from '../panels/AirQualityChip.jsx'
import HeadlinePanel from '../panels/HeadlinePanel.jsx'
import AgendaPanel from '../panels/AgendaPanel.jsx'
import CountdownsPanel from '../panels/CountdownsPanel.jsx'
import DeparturePanel from '../panels/DeparturePanel.jsx'
import PhotoPanel from '../panels/PhotoPanel.jsx'
// Inter 300 for the clock, as in Ambient (see the note there): main.jsx only
// ships 400/600/700, and a light clock over a photograph is the DAKboard look.
import '@fontsource/inter/latin-300.css'
import '../tokens.css'
import './EntryLayout.css'

// EntryLayout - the front-door board (docs/designs/entry-board.md): what the
// family used to glance at on the DAKboard by the door, rebuilt from panels.
//
//   clock + long date          | weather now, what to wear, air quality
//   the headline               |
//   agenda: today, tomorrow,   | countdown tiles (the departure panel
//   the day after              |   instead during a school morning)
//
// Behind it, per screen (display.entryBackdrop): the slideshow darkened by a
// flat black wash at display.entryDim plus Ambient's bottom scrim, or plain
// black. Phase 1 is deliberately that simple; per-photo brightness, blur and
// text-local scrims are phase 1.5.
//
// Like every layout here, the only data access is the one useTodayData() call.

const SLIDESHOW_MIN_MS = 15_000
const SLIDESHOW_MAX_MS = 10 * 60_000
const PHOTO_COUNT = 24

const DIM_MAX = 0.9
const DIM_DEFAULT = 0.5

// Floor of the school-morning window when autoShowAt is unset. Mirrors
// MORNING_START_HOUR in shell/AppShell.jsx and Ambient.
const MORNING_START_HOUR = 5

function entryDim(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DIM_DEFAULT
  return Math.min(DIM_MAX, Math.max(0, n))
}

// The screen's own slideshow cadence, bounded as in Ambient: under 15 s a
// full-bleed crossfade never settles, over ten minutes it reads as frozen.
function slideshowIntervalMs(slideshow) {
  const raw = slideshow?.intervalMs
  return Math.min(
    SLIDESHOW_MAX_MS,
    Math.max(SLIDESHOW_MIN_MS, Number.isFinite(raw) ? raw : SLIDESHOW_MIN_MS)
  )
}

function minutesOf(hm) {
  return hm && typeof hm.hour === 'number' ? hm.hour * 60 + (hm.minute || 0) : null
}

// Is `now` inside [autoShowAt, morningEndsAt)? Minute precision, the same
// window the shell's auto-show and auto-leave watchers use.
function inMorningWindow(now, startsAt, endsAt) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false
  const end = minutesOf(endsAt)
  if (end == null) return false
  const start = minutesOf(startsAt) ?? MORNING_START_HOUR * 60
  const m = now.getHours() * 60 + now.getMinutes()
  return m >= start && m < end
}

// The bottom-right slot: departure on a school morning, countdown tiles the
// rest of the time. A manual timer (someone set "leave at 4:40" on any screen)
// is live whatever the hour, so it takes the slot too. The default timer only
// ever runs inside the morning window; keying on the window rather than on
// "timer active" is also what lets ?demo=1 (whose timer is always active) show
// the tiles outside the morning.
function showDepartureFor(school, timer, now) {
  if (!school || school.noSchool) return false
  if (inMorningWindow(now, school.autoShowAt, school.morningEndsAt)) return true
  return timer?.mode === 'active' && timer?.kind === 'manual'
}

// Until the hub publishes a headline (or when it has not confirmed one today)
// the line is the local greeting, which is what the hub itself says with no
// calendar to read. A greeting is not data, so nothing is being invented.
function fallbackHeadline(greeting) {
  return greeting ? { text: `${greeting}.`, kind: 'daypart', eventId: null, until: null } : null
}

export default function EntryLayout() {
  const d = useTodayData()
  const display = d.settings?.display
  const backdrop = display?.entryBackdrop === 'black' ? 'black' : 'photos'
  const dim = entryDim(display?.entryDim)
  const intervalMs = slideshowIntervalMs(d.settings?.slideshow)
  const headline = d.headline || fallbackHeadline(d.greeting)
  const cal = d.calendar
  const showDeparture = showDepartureFor(d.school, d.timer, d.now)

  return (
    <div className={`tl-root tl-entry tl-entry--${backdrop}`}>
      {backdrop === 'photos' && (
        <>
          {/* d.photos.photos keeps its identity between ticks, which is what
            * lets PhotoPanel's memo hold through the 1 Hz re-render. */}
          <div className="tl-entry__photo">
            <PhotoPanel
              photos={d.photos.photos}
              intervalMs={intervalMs}
              count={PHOTO_COUNT}
              fit="cover"
              showCounter={false}
              showCaption={false}
            />
          </div>
          <div className="tl-entry__dim" style={{ opacity: dim }} aria-hidden="true" />
          <div className="tl-entry__scrim" aria-hidden="true" />
        </>
      )}

      <div className="tl-entry__grid">
        <div className="tl-entry__cell tl-entry__cell--clock">
          <ClockPanel now={d.now} showGreeting={false} dateStyle="long" />
        </div>

        <div className="tl-entry__cell tl-entry__cell--head">
          <HeadlinePanel headline={headline} now={d.now} />
        </div>

        {/* Outside, as one card: the weather, what it means for clothes, and
          * the air. */}
        <div className="tl-entry__cell tl-entry__cell--side">
          <div className="tl-entry__side">
            <div className="tl-entry__slot tl-entry__slot--wx">
              <WeatherNowPanel
                current={d.weather?.current}
                today={d.weather?.today}
                fetchedAt={d.weather?.fetchedAt}
                now={d.now}
                error={d.weather?.error}
              />
            </div>
            <div className="tl-entry__slot tl-entry__slot--wear">
              <WhatToWearPanel wear={d.wear} />
            </div>
            <div className="tl-entry__slot tl-entry__slot--aq">
              <AirQualityChip airQuality={d.airQuality} />
            </div>
          </div>
        </div>

        <div className="tl-entry__cell tl-entry__cell--agenda">
          <AgendaPanel
            days={d.agendaDays}
            now={d.now}
            connected={cal?.connected ?? null}
            fetchedAt={cal?.fetchedAt ?? null}
            error={cal?.error ?? null}
            stale={!!cal?.stale}
          />
        </div>

        <div className="tl-entry__cell tl-entry__cell--next">
          {showDeparture ? (
            <DeparturePanel
              timer={d.timer}
              school={d.school}
              now={d.now}
              onToggleTravel={d.timer?.actions?.toggleTravel}
            />
          ) : (
            <CountdownsPanel countdowns={d.countdowns} />
          )}
        </div>
      </div>
    </div>
  )
}
