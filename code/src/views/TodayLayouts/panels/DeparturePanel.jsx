import PanelFrame from './PanelFrame.jsx'
import { panelKnobs } from './schemas.js'
import { fmtClock } from '../lib/format.js'
import './DeparturePanel.css'

// DeparturePanel - the school-run countdown, read-only.
//
// The Framed Today view (views/TodayView/TimerPanel.jsx) still owns the full
// timer UI (set, cancel, the picker); this is its quiet sibling for the Board,
// Briefing and Ambient layouts. Band colours come from the same tokens as
// TimerPanel so "green means go" reads identically on every screen.
//
// knobs (a spec layout, panels/schemas.js 'departure'): numberSize (the
// minutes and their unit, or the two depart times), showToggle.

const TRAVEL_LABEL = { driving: 'Driving', walking: 'Walking' }

// A {hour, minute} pair as a Date on `now`'s day. Built from the `now` prop
// rather than the clock so render stays pure.
function atTime(hm, now) {
  if (!hm || typeof hm.hour !== 'number') return null
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null
  const d = new Date(now)
  d.setHours(hm.hour, hm.minute || 0, 0, 0)
  return d
}

function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes()
}

// One of the two depart options in the no-timer state. `chosen` is the mode the
// timer would arm with (the weather-picked default); `past` dims a time that has
// already gone by so a stale 7:32 does not read as advice.
function DepartOption({ label, time, chosen, past }) {
  const cls = [
    'tl-depart__option',
    chosen ? 'tl-depart__option--chosen' : '',
    past ? 'tl-depart__option--past' : '',
  ].join(' ').trim()
  return (
    <div className={cls}>
      <div className="tl-depart__option-label">{label}</div>
      <div className="tl-num tl-depart__option-time">{time || '--'}</div>
    </div>
  )
}

export default function DeparturePanel({ timer, school, now, onToggleTravel, knobs }) {
  const k = panelKnobs('departure', knobs)
  const noSchool = !!school?.noSchool
  const mode = timer?.mode || 'no-timer'
  const travelMode = timer?.travelMode === 'walking' ? 'walking' : 'driving'
  const band = timer?.band || null
  const minutesLeft = Number.isFinite(timer?.minutesLeft) ? timer.minutesLeft : null
  const isActive = mode === 'active' && !noSchool

  // The toggle is the only control in any Today-layout panel. <button> already
  // exempts it from the shell's "tap the background opens the menu" rule;
  // data-interactive is the documented belt and braces.
  const showToggle = typeof onToggleTravel === 'function' && !noSchool && (k ? !!k.showToggle : true)

  const driving = atTime(school?.departTimes?.driving, now)
  const walking = atTime(school?.departTimes?.walking, now)
  const nowMins =
    now instanceof Date && !Number.isNaN(now.getTime()) ? minutesOfDay(now) : null

  let body
  if (noSchool) {
    body = (
      <div className="tl-depart__headline" data-edit="status">
        No school today
      </div>
    )
  } else if (mode === 'set-timer') {
    // The Framed view owns the picker; here we only acknowledge the state.
    body = (
      <div className="tl-depart__headline tl-depart__headline--quiet" data-edit="status">
        Setting timer...
      </div>
    )
  } else if (isActive) {
    const expired = minutesLeft != null && minutesLeft <= 0
    const target = timer?.target instanceof Date ? fmtClock(timer.target) : null
    body = (
      <div className="tl-depart__count-wrap">
        <div className="tl-depart__count" data-edit="number" data-edit-label="Countdown">
          {expired ? (
            <span className="tl-depart__now">Now</span>
          ) : (
            <>
              <span className="tl-num tl-depart__minutes">
                {minutesLeft == null ? '--' : minutesLeft}
              </span>
              <span className="tl-depart__unit">min</span>
            </>
          )}
        </div>
        <div className="tl-depart__meta" data-edit="meta" data-edit-label="Details">
          <span className="tl-depart__dot" aria-hidden="true" />
          <span>{TRAVEL_LABEL[travelMode]}</span>
          {target && (
            <>
              <span className="tl-depart__sep" aria-hidden="true">&middot;</span>
              <span className="tl-num">{target}</span>
            </>
          )}
        </div>
      </div>
    )
  } else {
    body = (
      <div className="tl-depart__options" data-edit="number" data-edit-label="Depart times">
        <DepartOption
          label="Driving"
          time={driving ? fmtClock(driving) : null}
          chosen={travelMode === 'driving'}
          past={!!driving && nowMins != null && nowMins > minutesOfDay(driving)}
        />
        <DepartOption
          label="Walking"
          time={walking ? fmtClock(walking) : null}
          chosen={travelMode === 'walking'}
          past={!!walking && nowMins != null && nowMins > minutesOfDay(walking)}
        />
      </div>
    )
  }

  return (
    <PanelFrame
      title={noSchool ? 'No school' : 'Leave by'}
      className={`tl-depart tl-depart--band-${band || 'none'}${k ? ' tl-knobs' : ''}`}
      bodyClassName="tl-depart__body"
      style={k ? { '--tl-depart-num': String(k.numberSize) } : undefined}
    >
      {/* Band edge: a colour stripe rather than a whole coloured panel, so the
        * board stays calm while the urgency still reads from across the room. */}
      {isActive && <div className="tl-depart__edge" aria-hidden="true" />}
      {body}
      {showToggle && (
        <button
          type="button"
          className="tl-depart__toggle"
          data-interactive="true"
          data-edit="toggle"
          data-edit-label="Walk or drive"
          onClick={() => onToggleTravel()}
        >
          {travelMode === 'driving' ? 'Walk instead' : 'Drive instead'}
        </button>
      )}
    </PanelFrame>
  )
}
