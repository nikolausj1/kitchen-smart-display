import { useRef } from 'react'
import PanelFrame from './PanelFrame.jsx'
import WeatherAttribution from './WeatherAttribution.jsx'
import useBoxSize from './useBoxSize.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { alertTone, alertWhen, pickAlert } from '../lib/weatherPanels.js'
import './AlertPanel.css'

// AlertPanel - the most severe weather alert in force, as a banner
// (docs/designs/panels-and-controls.md, chunk 2, "Alert banner"): the event in
// bold with when it ends ("Wind Advisory until 9 pm"), amber for advisories
// and watches, red for warnings (and anything Severe or Extreme), and the
// alert's headline on a second line when the box is tall enough for it.
//
// alerts: the hub feed's merged NWS and WeatherKit alerts
// (useTodayData d.weather.alerts), re-checked against `now` so one that has
// just ended goes at once. With none in force the panel draws nothing, and
// SpecBoard drops its box (the panel collapses); in the layout editor
// (`editing`) it shows a quiet placeholder instead, so it can be placed.
//
// knobs (panels/schemas.js 'alert'): size.
//
// attribution: the Apple Weather mark while the feed is WeatherKit's, on an
// alert from WeatherKit; an NWS alert is the National Weather Service's own
// and carries none.

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export default function AlertPanel({ alerts, now, knobs, editing = false, attribution = null }) {
  const k = panelKnobs('alert', knobs) || knobDefaults('alert')
  const alert = pickAlert(alerts, now)
  const bannerRef = useRef(null)
  const lineRef = useRef(null)
  const banner = useBoxSize(bannerRef)
  const line = useBoxSize(lineRef)

  // The headline, when the banner is at least 2.2 first lines tall: as many
  // whole lines as fit under the first (its type is 0.62 of the event's,
  // never under 12 px, at a line height of 1.3; AlertPanel.css).
  const lineH = num(line.h)
  const eventPx = lineH / 1.15
  const headPx = Math.min(22, Math.max(12, eventPx * 0.62)) * 1.3
  const tall = lineH > 0 && num(banner.h) >= lineH * 2.2
  const room = num(banner.h) - lineH - eventPx * 0.3
  const headLines = tall && alert && alert.headline ? Math.max(0, Math.min(4, Math.floor(room / headPx))) : 0
  const mark = alert && alert.source !== 'nws' ? attribution : null
  const when = alert ? alertWhen(alert, now) : ''

  return (
    <PanelFrame title={null} className="tl-alert tl-knobs" bodyClassName="tl-alert__body" style={{ '--tl-alert-size': String(k.size) }}>
      {alert ? (
        <div className={`tl-alert__banner tl-alert__banner--${alertTone(alert)}`} ref={bannerRef}>
          <div className="tl-alert__line" ref={lineRef}>
            <span className="tl-alert__event" data-edit="event">
              {alert.event}
            </span>
            {when && (
              <span className="tl-alert__until" data-edit="until">
                {when}
              </span>
            )}
            <WeatherAttribution attribution={mark} />
          </div>
          {headLines > 0 && (
            <div className="tl-alert__headline" data-edit="headline" style={{ WebkitLineClamp: String(headLines) }}>
              {alert.headline}
            </div>
          )}
        </div>
      ) : editing ? (
        <div className="tl-alert__placeholder" data-edit="event" data-edit-label="Event">
          No alert right now
        </div>
      ) : null}
    </PanelFrame>
  )
}
