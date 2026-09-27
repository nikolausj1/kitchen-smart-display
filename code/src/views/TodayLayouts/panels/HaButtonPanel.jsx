import { useEffect, useRef, useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import HaIcon, { HaCheck, HaSpinner } from './HaIcon.jsx'
import useHaAction from './useHaAction.js'
import useHaFit from './useHaFit.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { HA_TEXT, HOLD_MS, PRESS_SLOP_PX, haActionFor, haBlocked, haView, insideRect, releaseOutcome } from './haParts.js'
import './HaButtonPanel.css'

// HaButtonPanel - one whitelisted Home Assistant action as a button
// (docs/designs/panels-and-controls.md, chunk 5): its entity's icon, its
// label, the entity's state under it, and a hint line.
//
// A tap action fires on release, on the button. A hold action (the
// whitelist's confirm: 'hold': the garage, unlocking the door) fires only
// once the press has lasted HOLD_MS (1.2 s), a ring filling round the icon
// meanwhile; letting go early, or sliding off, cancels. While the hub
// answers the icon is a spinner; a press that went through shows a check
// (and the store polls fast, so the state under the label follows); one
// refused says why for 6 s: "Buttons are off on the dashboard" (403), "Try
// again in a moment" (429), "Home Assistant unreachable" (anything else).
//
// Safe while actions are off: with the dashboard's switch off (the
// snapshot's actionsEnabled false), Home Assistant or the hub down, or an
// action that is not on the whitelist, the button is drawn disabled, the
// hint says why, and a press sends nothing. Should the switch go off inside
// the snapshot's minute, the hub refuses (403) and the hint says so.
//
// run: the store's runHaAction on a screen; data/demo.js's demoHaAction
// under ?demo=1 (it only animates); null in the layout editor, where the
// button never fires. ha: hooks/useHomeAssistant.js's snapshot. knobs
// (panels/schemas.js 'habutton'): action, size, style ('filled' |
// 'outline'), showState. The button is a <button> with
// data-interactive="true", so a tap on it never opens the shell's menu. Its
// words are fitted to the face (useHaFit): a long label wraps, and the whole
// shrinks only when even that does not fit.

// The ring round the icon: a circle of this radius in a 100 x 100 box.
const RING_R = 46

// Press times, in performance.now()'s milliseconds (a frozen Date cannot
// stop a hold, and the hold's own timer is a timeout).
function clock() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function isEnterOrSpace(e) {
  return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'
}

export default function HaButtonPanel({ ha, knobs, run }) {
  const k = panelKnobs('habutton', knobs) || knobDefaults('habutton')
  const { action, message } = haActionFor(ha, k.action)
  const entity =
    action && ha && ha.entities && Object.prototype.hasOwnProperty.call(ha.entities, action.entity) ? ha.entities[action.entity] : null
  const blocked = action ? haBlocked(ha) : null
  const act = useHaAction(run)
  const [press, setPress] = useState(null)
  const holdTimer = useRef(null)
  const faceRef = useRef(null)

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  const live = typeof run === 'function'
  const usable = !!action && !blocked
  const pending = act.phase === 'pending'
  const hold = !!action && action.confirm === 'hold'

  function cancel() {
    clearTimeout(holdTimer.current)
    holdTimer.current = null
    setPress(null)
  }

  // A press starts: a hold's own timer fires it once HOLD_MS have passed.
  function begin(id) {
    const p = { confirm: action.confirm, downAt: clock(), fired: false, id }
    setPress(p)
    if (p.confirm === 'hold') {
      const actionId = action.id
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null
        setPress(null)
        act.fire(actionId)
      }, HOLD_MS)
    }
  }

  function end(p, inside) {
    const outcome = releaseOutcome(p, clock(), inside)
    cancel()
    if (outcome === 'fire') act.fire(action.id)
  }

  function onFace(e) {
    const el = faceRef.current
    return insideRect(el ? el.getBoundingClientRect() : null, e.clientX, e.clientY, PRESS_SLOP_PX)
  }

  const handlers = live
    ? {
        onPointerDown: (e) => {
          if (!usable || pending || press) return
          if (e.pointerType === 'mouse' && e.button !== 0) return
          begin(e.pointerId)
        },
        // A touch stays captured by the button, so its release arrives here
        // wherever the finger is: the tap fires only when it is still on it.
        onPointerUp: (e) => {
          if (press && press.id === e.pointerId) end(press, onFace(e))
        },
        onPointerMove: (e) => {
          if (press && press.confirm === 'hold' && press.id === e.pointerId && !onFace(e)) cancel()
        },
        onPointerCancel: () => {
          if (press) cancel()
        },
        onPointerLeave: (e) => {
          if (press && e.pointerType === 'mouse') cancel()
        },
        // A hold from the keyboard: held Enter or Space. A tap from the
        // keyboard is the click that follows (onClick).
        onKeyDown: (e) => {
          if (!isEnterOrSpace(e) || !hold) return
          e.preventDefault()
          if (e.repeat || press || !usable || pending) return
          begin('key')
        },
        onKeyUp: (e) => {
          if (isEnterOrSpace(e) && press && press.id === 'key') end(press, true)
        },
        // A pointer's tap fired on its release; a click with no pointer
        // behind it (detail 0) is the keyboard's.
        onClick: (e) => {
          if (e.detail !== 0 || hold || !usable || pending) return
          act.fire(action.id)
        },
        onContextMenu: (e) => e.preventDefault(),
      }
    : {}

  const view = entity ? haView(entity, ha.status) : null
  const holding = !!press && press.confirm === 'hold'
  const disabled = !action || !!blocked
  let hint = null
  if (act.phase === 'error') hint = act.error
  else if (!action) hint = message
  else if (blocked) hint = blocked
  else if (hold && act.phase === 'idle') hint = HA_TEXT.hold
  // No action: what it is, when an id is set that is not on the whitelist.
  const label = action ? action.label : message === HA_TEXT.notListed ? k.action : 'Home Assistant'
  const style = k.style === 'outline' ? 'outline' : 'filled'
  const cls = [
    'tl-habutton',
    `tl-habutton--${style}`,
    'tl-knobs',
    `is-${act.phase}`,
    disabled ? 'is-disabled' : '',
    press ? 'is-pressed' : '',
    holding ? 'is-holding' : '',
  ]
    .filter(Boolean)
    .join(' ')

  useHaFit(faceRef, JSON.stringify([label, k.showState && view ? view.word : null, hint, style, k.size]), { self: true })

  let icon
  if (act.phase === 'pending') icon = <HaSpinner />
  else if (act.phase === 'ok') icon = <HaCheck />
  else icon = <HaIcon name={view ? view.icon : 'other'} />

  return (
    <PanelFrame
      title={null}
      className={cls}
      bodyClassName="tl-habutton__body"
      style={{ '--tl-habutton-size': String(k.size), '--tl-habutton-hold': `${HOLD_MS}ms` }}
    >
      <button
        type="button"
        ref={faceRef}
        className={`tl-habutton__face tl-ha-tone--${view ? view.tone : 'unknown'}`}
        data-interactive="true"
        aria-disabled={disabled || !live ? 'true' : undefined}
        aria-label={hint ? `${label}. ${hint}` : label}
        {...handlers}
      >
        <span className="tl-habutton__iconwrap" data-edit="icon">
          {hold && (
            <svg className="tl-habutton__ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
              <circle className="tl-habutton__track" cx="50" cy="50" r={RING_R} />
              <circle className="tl-habutton__fill" cx="50" cy="50" r={RING_R} />
            </svg>
          )}
          <span className="tl-habutton__icon">{icon}</span>
        </span>
        <span className="tl-habutton__text">
          <span className="tl-habutton__label" data-edit="label">
            {label}
          </span>
          {k.showState && view && (
            <span className="tl-habutton__state" data-edit="state">
              {view.word}
            </span>
          )}
          {hint && (
            <span className={`tl-habutton__hint${act.phase === 'error' ? ' is-error' : ''}`} data-edit="hint">
              {hint}
            </span>
          )}
        </span>
      </button>
    </PanelFrame>
  )
}
