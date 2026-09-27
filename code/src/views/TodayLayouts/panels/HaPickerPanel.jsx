import { useContext, useEffect, useRef, useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import { HaSpinner } from './HaIcon.jsx'
import { PanelTitleContext } from './panelTitle.js'
import useHaAction from './useHaAction.js'
import useHaFit from './useHaFit.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { HA_TEXT, haBlocked, haEntityFor, haStatusNote, pickerAction } from './haParts.js'
import './HaPickerPanel.css'

// HaPickerPanel - a Home Assistant select (an input_select) as a segmented
// control (docs/designs/panels-and-controls.md, chunk 5): the day part
// override is the case (Auto, Morning, Day, Afternoon, Evening, Late
// Evening, Night, Overnight). The current option is highlighted; a tap on
// another runs the whitelisted action that targets that select and takes an
// option (panels/haParts.js pickerAction: the one the `action` knob names,
// else the first on the whitelist; daypart-set), sending { option }.
//
// A tapped option shows a spinner while the hub answers, then an outline
// until the select's state moves off the old option (the store polls fast
// after a press that went through; given up after 30 s); a refused one says
// why for 6 s (panels/haParts.js haErrorText). Disabled, and the hint says
// why, when there is no such action on the whitelist, actions are switched
// off on the dashboard, or Home Assistant or the hub is down. Honest about
// the rest too: no select chosen, not on the whitelist, still waiting.
//
// The hint sits at the right of the header row (the select's label, or the
// box's custom title), so a refusal never moves the options; with no header
// it goes under them. The options are fitted to the box (useHaFit): how many
// rows they need depends on their words.
//
// run: the store's runHaAction on a screen; data/demo.js's demoHaAction
// under ?demo=1 (it only animates); null in the layout editor, where
// nothing fires. knobs (panels/schemas.js 'hapicker'): entity, action,
// size, wrap (options run onto more rows; off: one row, each option sharing
// it and wrapping its own words). Every option is a <button> with
// data-interactive="true".

// A tapped option that has not landed after this long stops looking pending.
const SENT_MS = 30 * 1000

export default function HaPickerPanel({ ha, knobs, run, demo = false }) {
  const k = panelKnobs('hapicker', knobs) || knobDefaults('hapicker')
  const { entity, message } = haEntityFor(ha, k.entity, HA_TEXT.chooseSelect)
  const options = entity && Array.isArray(entity.options) ? entity.options : []
  const action = entity && ha.actionsKnown ? pickerAction(ha.actions, entity.id, k.action) : null
  const act = useHaAction(run)
  // { option, from }: the option tapped and the state it was tapped over.
  const [sent, setSent] = useState(null)
  const sentTimer = useRef(null)
  const innerRef = useRef(null)
  const override = useContext(PanelTitleContext)

  useEffect(() => () => clearTimeout(sentTimer.current), [])

  const current = entity ? entity.state : null
  const live = typeof run === 'function'
  let blocked = null
  if (entity) {
    if (!ha.actionsKnown) blocked = haBlocked(ha) || HA_TEXT.loading
    else if (!action) blocked = HA_TEXT.noAction
    else blocked = haBlocked(ha)
  }
  const pending = act.phase === 'pending'
  const usable = !!action && !blocked

  function choose(option) {
    if (!live || !usable || pending || option === current) return
    clearTimeout(sentTimer.current)
    setSent({ option, from: current })
    sentTimer.current = setTimeout(() => setSent(null), SENT_MS)
    act.fire(action.id, { option }, option).then((r) => {
      // Refused, or the demo (whose select never moves): nothing is coming.
      if (!r || !r.ok || demo) {
        clearTimeout(sentTimer.current)
        setSent(null)
      }
    })
  }

  // Waiting for the select to move off where it was when tapped.
  const waiting = sent && sent.option !== current && (pending || current === sent.from) ? sent.option : null
  let hint
  if (act.phase === 'error') hint = act.error
  else if (!entity) hint = message
  else if (!options.length) hint = HA_TEXT.noOptions
  else if (blocked) hint = blocked
  else hint = haStatusNote(ha.status)
  const disabled = !entity || !!blocked

  // PanelFrame's rule: is there a header row to carry the hint?
  const title = entity ? entity.label : null
  const mode = override ? override.mode : 'default'
  const headed = mode === 'custom' ? !!override.text : mode !== 'none' && title != null
  const hintEl = hint ? <span className={`tl-hapicker__hint${act.phase === 'error' ? ' is-error' : ''}`}>{hint}</span> : null

  useHaFit(innerRef, JSON.stringify([options, current, waiting, headed ? null : hint, k.wrap, k.size]))

  return (
    <PanelFrame
      title={title}
      aside={headed ? hintEl : null}
      asideEdit="hint"
      asideEditLabel="Hint"
      className={`tl-hapicker tl-knobs${disabled ? ' is-disabled' : ''}${k.wrap ? ' tl-hapicker--wrap' : ''}`}
      bodyClassName="tl-hapicker__body"
      style={{ '--tl-hapicker-size': String(k.size) }}
    >
      <div className="tl-hapicker__inner" ref={innerRef}>
        {options.length > 0 && (
          <div className="tl-hapicker__seg" role="radiogroup" aria-label={entity.label}>
            {options.map((o) => {
              const on = o === current
              const cls = ['tl-hapicker__opt', on ? 'is-current' : '', waiting === o ? 'is-pending' : ''].filter(Boolean).join(' ')
              return (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={disabled || !live ? 'true' : undefined}
                  className={cls}
                  data-interactive="true"
                  data-edit="option"
                  onClick={live ? () => choose(o) : undefined}
                >
                  {waiting === o && pending && (
                    <span className="tl-hapicker__spin">
                      <HaSpinner />
                    </span>
                  )}
                  {o}
                </button>
              )
            })}
          </div>
        )}
        {!headed && hint && (
          <div className="tl-hapicker__message" data-edit="hint">
            {hintEl}
            {!entity && message === HA_TEXT.notListed && <div className="tl-hapicker__id">{k.entity}</div>}
          </div>
        )}
      </div>
    </PanelFrame>
  )
}
