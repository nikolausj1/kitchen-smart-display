import { useRef } from 'react'
import PanelFrame from './PanelFrame.jsx'
import HaIcon from './HaIcon.jsx'
import useHaFit from './useHaFit.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { HA_TEXT, fmtSince, haEntityFor, haStatusNote, haView } from './haParts.js'
import './HaStatusPanel.css'

// HaStatusPanel - one Home Assistant entity, as an indicator
// (docs/designs/panels-and-controls.md, chunk 5): an icon by its kind, its
// label (the dashboard's, else Home Assistant's friendly name), its state as
// a word ("Closed", "Unlocked", "Away", "On", a select's option, a sensor's
// value) and "since 4:12 pm". Calm for the safe states, amber for open,
// unlocked, away and on, grey when the state is unknown or Home Assistant is
// not connected (the since line then says which: "Home Assistant offline",
// "Hub unreachable"). No entity, none yet, or one that is not on the
// whitelist: it says so.
//
// ha: hooks/useHomeAssistant.js's snapshot (useTodayData d.ha; the demo
// fixture under ?demo=1). knobs (panels/schemas.js 'hastatus'): entity,
// showLabel, showSince, size, layout ('row': the icon left of the words;
// 'stacked': above them, centred). Nothing here is tappable. The words are
// fitted to the box (useHaFit): a long state wraps, and the whole shrinks
// only when even that does not fit.

export default function HaStatusPanel({ ha, now, knobs }) {
  const k = panelKnobs('hastatus', knobs) || knobDefaults('hastatus')
  const { entity, message } = haEntityFor(ha, k.entity)
  const layout = k.layout === 'stacked' ? 'stacked' : 'row'
  const view = entity ? haView(entity, ha.status) : null
  // Not connected: say so even with the since line switched off.
  const note = entity ? haStatusNote(ha.status) : null
  const since = note || (entity && k.showSince ? fmtSince(entity.lastChanged, now) : '')
  const mainRef = useRef(null)
  useHaFit(mainRef, view ? JSON.stringify([entity.label, view.word, since, k.showLabel, layout, k.size]) : '')

  return (
    <PanelFrame
      title={null}
      className={`tl-hastatus tl-hastatus--${layout} tl-knobs`}
      bodyClassName="tl-hastatus__body"
      style={{ '--tl-hastatus-size': String(k.size) }}
    >
      {view ? (
        <div className={`tl-hastatus__main tl-ha-tone--${view.tone}`} ref={mainRef}>
          <div className="tl-hastatus__icon" data-edit="icon">
            <HaIcon name={view.icon} />
          </div>
          <div className="tl-hastatus__text">
            {k.showLabel && (
              <div className="tl-hastatus__label" data-edit="label">
                {entity.label}
              </div>
            )}
            <div className="tl-hastatus__state" data-edit="state">
              {view.word}
            </div>
            {since && (
              <div className="tl-hastatus__since" data-edit="since">
                {since}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="tl-hastatus__empty" data-edit="empty">
          {message}
          {message === HA_TEXT.notListed && <div className="tl-hastatus__id">{k.entity}</div>}
        </div>
      )}
    </PanelFrame>
  )
}
