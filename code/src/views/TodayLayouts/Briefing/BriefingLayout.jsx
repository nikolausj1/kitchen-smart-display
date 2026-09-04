// Fraunces: the `full` files carry every axis (opsz, wght, SOFT, WONK). The
// package's bare entry point is the wght-only cut, where the opsz and SOFT
// settings this page depends on would silently do nothing, and where an italic
// dateline would be a browser-synthesised slant rather than a real italic.
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/fraunces/full-italic.css'

import useTodayData from '../data/useTodayData.js'
import ClockPanel from '../panels/ClockPanel.jsx'
import WeatherNowPanel from '../panels/WeatherNowPanel.jsx'
import ForecastPanel from '../panels/ForecastPanel.jsx'
import SchoolPanel from '../panels/SchoolPanel.jsx'
import DeparturePanel from '../panels/DeparturePanel.jsx'
import SunMoonPanel from '../panels/SunMoonPanel.jsx'
import NowPlayingPanel from '../panels/NowPlayingPanel.jsx'
import '../tokens.css'
import './BriefingLayout.css'

// BriefingLayout - the light page. A printed morning briefing on cream paper:
// serif display type, generous margins, hairline rules instead of boxes, no
// photograph. It exists to prove a light Today still reads across a kitchen.
//
// The page is two columns of fixed-height regions, never auto ones: every panel
// body is a `container-type: size` element, which has no intrinsic height, so a
// region that sized itself to its content would collapse the type to nothing.
// The row tracks are spelled out in BriefingLayout.css and sum to the viewport
// at both 1920x1080 and 1280x800.

// The masthead name. A const for now; it becomes a per-screen setting
// (display.houseName) as soon as Settings grows a text field for it.
const HOUSE_NAME = 'Nikolaus House'

export default function BriefingLayout() {
  const d = useTodayData()

  // The third right-hand region is the day's agenda, except on a school
  // morning with the countdown already running: then the only thing worth that
  // much of the page is when to leave.
  const showDeparture = !d.school?.noSchool && d.timer?.mode === 'active'

  return (
    <div className="tl-root tl-briefing">
      <div className="tl-briefing__col tl-briefing__col--left">
        <header className="tl-briefing__masthead">
          <span className="tl-briefing__house">{HOUSE_NAME}</span>
          <span className="tl-briefing__greeting">{d.greeting}</span>
        </header>

        {/* The greeting lives in the masthead, so the clock runs headerless. */}
        <div className="tl-briefing__block tl-briefing__block--clock">
          <ClockPanel now={d.now} showGreeting={false} dateStyle="long" />
        </div>

        {/* The held-back air that makes the page a page and not a dashboard. */}
        <div className="tl-briefing__air" />

        <div className="tl-briefing__block">
          <NowPlayingPanel music={d.music} now={d.now} compact />
        </div>
      </div>

      <div className="tl-briefing__col tl-briefing__col--right">
        {/* Blank track so this column's first rule lands on the same line as
          * the left column's, under the masthead. */}
        <div className="tl-briefing__col-top" />

        <div className="tl-briefing__block">
          <WeatherNowPanel
            current={d.weather.current}
            today={d.weather.today}
            fetchedAt={d.weather.fetchedAt}
            now={d.now}
            error={d.weather.error}
          />
        </div>

        <div className="tl-briefing__block">
          <ForecastPanel
            days={d.weather.days}
            fetchedAt={d.weather.fetchedAt}
            now={d.now}
            count={4}
            error={d.weather.error}
          />
        </div>

        <div className="tl-briefing__block">
          {showDeparture ? (
            <DeparturePanel
              timer={d.timer}
              school={d.school}
              now={d.now}
              onToggleTravel={d.timer?.actions?.toggleTravel}
            />
          ) : (
            <SchoolPanel school={d.school} />
          )}
        </div>

        <div className="tl-briefing__block">
          <SunMoonPanel
            now={d.now}
            sunrise={d.weather.sunrise}
            sunset={d.weather.sunset}
            moon={d.moon}
          />
        </div>
      </div>
    </div>
  )
}
