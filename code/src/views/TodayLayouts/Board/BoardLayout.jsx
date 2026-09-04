import useTodayData from '../data/useTodayData.js'
import ClockPanel from '../panels/ClockPanel.jsx'
import WeatherNowPanel from '../panels/WeatherNowPanel.jsx'
import PhotoPanel from '../panels/PhotoPanel.jsx'
import ForecastPanel from '../panels/ForecastPanel.jsx'
import SunMoonPanel from '../panels/SunMoonPanel.jsx'
import WhatToWearPanel from '../panels/WhatToWearPanel.jsx'
import DeparturePanel from '../panels/DeparturePanel.jsx'
import NowPlayingPanel from '../panels/NowPlayingPanel.jsx'
import '../tokens.css'
import './BoardLayout.css'

// BoardLayout - the dark bento board. Twelve columns by six rows of tiles, the
// clock anchoring the top left and the photo the single largest element.
//
// This component is the only thing here that touches data: useTodayData() runs
// once and every panel below is a pure display of the slice it is handed. The
// grid arithmetic and the reason for this particular arrangement live in
// BoardLayout.css.

// Slideshow pacing. The stored setting is honoured but bounded: the device
// default (6s) is right for the full-screen slideshow and far too twitchy for
// a tile that sits beside a clock you are trying to read, and anything past ten
// minutes reads as a frozen screen.
const MIN_INTERVAL_MS = 15_000
const MAX_INTERVAL_MS = 600_000
const FALLBACK_INTERVAL_MS = 20_000

// Enough photos that a run does not visibly repeat over a morning, few enough
// that the panel's preloader is not warming a gallery.
const PHOTO_COUNT = 12

function slideshowIntervalMs(slideshow) {
  const raw = Number(slideshow?.intervalMs)
  if (!Number.isFinite(raw) || raw <= 0) return FALLBACK_INTERVAL_MS
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, raw))
}

export default function BoardLayout() {
  const d = useTodayData()
  const intervalMs = slideshowIntervalMs(d.settings?.slideshow)
  // The bottom-right tile is music, except while a departure countdown is
  // actually running: a live countdown is the most important thing on any
  // screen, but outside those minutes the Board is the rest-of-the-day view
  // and the Framed Today is the morning instrument. Lunch and activities
  // stay on the Framed view and the Briefing page (a known gap here).
  const countdownRunning = d.timer?.mode === 'active' && !d.school?.noSchool

  return (
    <div className="tl-root tl-board">
      <div className="tl-board__cell tl-board__cell--clock">
        {/* The greeting rides in as the panel's own label, which is why the
            board needs no header strip of its own. */}
        <ClockPanel now={d.now} greeting={d.greeting} dateStyle="long" />
      </div>

      <div className="tl-board__cell tl-board__cell--weather">
        <WeatherNowPanel
          current={d.weather?.current}
          today={d.weather?.today}
          fetchedAt={d.weather?.fetchedAt}
          now={d.now}
          error={d.weather?.error}
        />
      </div>

      <div className="tl-board__cell tl-board__cell--photo">
        {/* d.photos.photos is already filtered to this screen's albums. */}
        <PhotoPanel
          photos={d.photos?.photos}
          intervalMs={intervalMs}
          count={PHOTO_COUNT}
          fit="cover"
        />
      </div>

      <div className="tl-board__cell tl-board__cell--forecast">
        <ForecastPanel
          days={d.weather?.days}
          fetchedAt={d.weather?.fetchedAt}
          now={d.now}
          count={4}
          error={d.weather?.error}
        />
      </div>

      <div className="tl-board__cell tl-board__cell--sunmoon">
        <SunMoonPanel
          now={d.now}
          sunrise={d.weather?.sunrise}
          sunset={d.weather?.sunset}
          moon={d.moon}
        />
      </div>

      <div className="tl-board__cell tl-board__cell--wear">
        <WhatToWearPanel wear={d.wear} />
      </div>

      <div className="tl-board__cell tl-board__cell--next">
        {countdownRunning ? (
          <DeparturePanel
            timer={d.timer}
            school={d.school}
            now={d.now}
            onToggleTravel={d.timer?.actions?.toggleTravel}
          />
        ) : (
          <NowPlayingPanel music={d.music} now={d.now} />
        )}
      </div>
    </div>
  )
}
