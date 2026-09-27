import { useRef } from 'react'
import PanelFrame from './PanelFrame.jsx'
import HaIcon from './HaIcon.jsx'
import useHaFit from './useHaFit.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { HA_TEXT, chipIds, haStatusNote, haView } from './haParts.js'
import './HaChipsPanel.css'

// HaChipsPanel - several Home Assistant entities as small chips in a row
// that wraps (docs/designs/panels-and-controls.md, chunk 5): the house modes
// first of all. Each chip: its icon, its label, its state word, in the
// status panel's words and tones (panels/haParts.js): calm, amber, grey when
// unknown or when Home Assistant is not connected (a note under the row then
// says which). An id that is not on the whitelist gets a grey chip saying so.
//
// ha: hooks/useHomeAssistant.js's snapshot (useTodayData d.ha). knobs
// (panels/schemas.js 'hachips'): entities (entity ids, comma-separated; empty
// is every mode on the whitelist), size, showLabels. Nothing here is
// tappable. The chips are fitted to the box (useHaFit): they wrap onto more
// rows, and shrink only when those do not fit.

export default function HaChipsPanel({ ha, knobs }) {
  const k = panelKnobs('hachips', knobs) || knobDefaults('hachips')
  const loaded = !!(ha && ha.loaded)
  const ids = loaded ? chipIds(k.entities, ha) : []
  let message = null
  if (!loaded) message = ha && ha.status === 'hub' ? HA_TEXT.hub : HA_TEXT.loading
  else if (!ids.length) message = HA_TEXT.noEntities
  const note = loaded ? haStatusNote(ha.status) : null
  const innerRef = useRef(null)
  const words = ids.map((id) => {
    const e = ha.entities[id]
    return e ? [id, e.label, haView(e, ha.status).word] : [id]
  })
  useHaFit(innerRef, JSON.stringify([words, note, message, k.showLabels, k.size]))

  return (
    <PanelFrame
      title={null}
      className="tl-hachips tl-knobs"
      bodyClassName="tl-hachips__body"
      style={{ '--tl-hachips-size': String(k.size) }}
    >
      <div className="tl-hachips__inner" ref={innerRef}>
        {ids.length ? (
          <div className="tl-hachips__row">
            {ids.map((id) => {
              const e = ha.entities[id]
              if (!e) {
                return (
                  <div key={id} className="tl-hachips__chip tl-ha-tone--unknown" data-edit="chip">
                    <span className="tl-hachips__label" data-edit="label">
                      {id}
                    </span>
                    <span className="tl-hachips__state" data-edit="state">
                      {HA_TEXT.notListed}
                    </span>
                  </div>
                )
              }
              const v = haView(e, ha.status)
              return (
                <div key={id} className={`tl-hachips__chip tl-ha-tone--${v.tone}`} data-edit="chip">
                  <span className="tl-hachips__icon">
                    <HaIcon name={v.icon} />
                  </span>
                  {k.showLabels && (
                    <span className="tl-hachips__label" data-edit="label">
                      {e.label}
                    </span>
                  )}
                  <span className="tl-hachips__state" data-edit="state">
                    {v.word}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="tl-hachips__empty" data-edit="empty">
            {message}
          </div>
        )}
        {note && ids.length > 0 && (
          <div className="tl-hachips__note" data-edit="empty">
            {note}
          </div>
        )}
      </div>
    </PanelFrame>
  )
}
