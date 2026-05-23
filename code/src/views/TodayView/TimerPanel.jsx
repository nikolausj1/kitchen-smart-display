import { useState } from 'react'
import './TimerPanel.css'

// --- Inline icons ----------------------------------------------------------

function CarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" aria-hidden="true">
      <path
        d="M4 14l1.6-4.8A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.2L20 14M3 14h18v4H3zM6 18v1.5M18 18v1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="16" r="1.2" fill="currentColor" />
      <circle cx="16.5" cy="16" r="1.2" fill="currentColor" />
    </svg>
  )
}

function ShoeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" aria-hidden="true">
      <path
        d="M3 16c0-2 1-3 3-4l3-1 2-4 3 1 1 2 5 2c1.5.5 2 1.5 2 3v2H3v-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

// --- Active timer ---------------------------------------------------------

function ActiveTimer({ minutesLeft, band, kind, travelMode, onCancel, onToggleTravel }) {
  const expired = minutesLeft <= 0
  const showTravelToggle = kind === 'default'

  return (
    <div className={`timer timer--active timer--${band}`}>
      <button
        type="button"
        className="timer__close"
        aria-label="Cancel timer"
        onClick={onCancel}
      >
        <CloseIcon />
      </button>

      <div className="timer__body">
        {expired ? (
          <>
            <div className="timer__leave-in">LEAVE</div>
            <div className="timer__big timer__big--now">NOW</div>
          </>
        ) : (
          <>
            <div className="timer__leave-in">LEAVE IN</div>
            <div className="timer__big">{minutesLeft}</div>
            <div className="timer__unit">MIN</div>
          </>
        )}
      </div>

      {showTravelToggle && (
        <button
          type="button"
          className="timer__travel"
          onClick={onToggleTravel}
        >
          {travelMode === 'driving' ? (
            <>
              DRIVING <CarIcon />
            </>
          ) : (
            <>
              Walking <ShoeIcon />
            </>
          )}
        </button>
      )}
    </div>
  )
}

// --- No-timer state -------------------------------------------------------

function NoTimer({ onSet }) {
  return (
    <div className="timer timer--idle">
      <div className="timer__body">
        <div className="timer__no-timer">
          <div>NO</div>
          <div>TIMER</div>
        </div>
      </div>
      <button type="button" className="timer__set" onClick={onSet}>
        SET
      </button>
    </div>
  )
}

// --- Set-timer picker -----------------------------------------------------
//
// Phase 1 picker is tap-driven rather than a true inertial scroll wheel.
// Each column shows the value above, the selected value (bold/white), and
// the value below. Tap above or below to step the value. Visually matches
// the Figma reference; a touch scroll wheel can replace this later.

function mod(n, m) {
  return ((n % m) + m) % m
}

function defaultPickerStart() {
  // Round up to the next 5 minutes so the picker starts at a useful value.
  const now = new Date()
  const minutes = now.getMinutes()
  const rounded = Math.ceil((minutes + 1) / 5) * 5
  const carry = Math.floor(rounded / 60)
  const hour24 = (now.getHours() + carry) % 24
  return {
    hour12: hour24 % 12 || 12,
    minute: rounded % 60,
    ampm: hour24 >= 12 ? 'PM' : 'AM',
  }
}

function PickerColumn({ label, above, current, below, onUp, onDown, isAmPm = false }) {
  const formatVal = (v) => {
    if (v == null) return ''
    if (isAmPm) return v
    if (label === 'minute') return String(v).padStart(2, '0')
    return String(v)
  }
  return (
    <div className="picker-col">
      <button
        type="button"
        className="picker-cell picker-cell--faded"
        onClick={onUp}
        aria-label={`${label} up`}
      >
        {formatVal(above)}
      </button>
      <div className="picker-cell picker-cell--selected">{formatVal(current)}</div>
      <button
        type="button"
        className="picker-cell picker-cell--faded"
        onClick={onDown}
        aria-label={`${label} down`}
      >
        {formatVal(below)}
      </button>
    </div>
  )
}

function SetTimer({ onConfirm, onCancel }) {
  const [draft, setDraft] = useState(defaultPickerStart)

  const stepHour = (delta) =>
    setDraft((d) => ({ ...d, hour12: mod(d.hour12 - 1 + delta, 12) + 1 }))
  const stepMinute = (delta) =>
    setDraft((d) => ({ ...d, minute: mod(d.minute + delta, 60) }))
  const stepAmPm = () =>
    setDraft((d) => ({ ...d, ampm: d.ampm === 'AM' ? 'PM' : 'AM' }))

  return (
    <div className="timer timer--idle">
      <button
        type="button"
        className="timer__close"
        aria-label="Cancel set timer"
        onClick={onCancel}
      >
        <CloseIcon />
      </button>

      <div className="timer__body timer__picker-grid">
        <PickerColumn
          label="hour"
          above={mod(draft.hour12 - 2, 12) + 1}
          current={draft.hour12}
          below={mod(draft.hour12, 12) + 1}
          onUp={() => stepHour(-1)}
          onDown={() => stepHour(1)}
        />
        <div className="picker-colon">:</div>
        <PickerColumn
          label="minute"
          above={mod(draft.minute - 5, 60)}
          current={draft.minute}
          below={mod(draft.minute + 5, 60)}
          onUp={() => stepMinute(-5)}
          onDown={() => stepMinute(5)}
        />
        <PickerColumn
          label="ampm"
          above={draft.ampm === 'AM' ? 'PM' : 'AM'}
          current={draft.ampm}
          below={draft.ampm === 'AM' ? 'PM' : 'AM'}
          onUp={stepAmPm}
          onDown={stepAmPm}
          isAmPm
        />
      </div>

      <button
        type="button"
        className="timer__set"
        onClick={() => onConfirm(draft.hour12, draft.minute, draft.ampm)}
      >
        DONE
      </button>
    </div>
  )
}

// --- Root dispatcher ------------------------------------------------------

export default function TimerPanel(props) {
  const { mode, minutesLeft, band, kind, travelMode, actions } = props

  if (mode === 'no-timer') {
    return <NoTimer onSet={actions.enterSetTimer} />
  }
  if (mode === 'set-timer') {
    return (
      <SetTimer
        onConfirm={actions.confirmManualTimer}
        onCancel={actions.exitSetTimer}
      />
    )
  }
  return (
    <ActiveTimer
      minutesLeft={minutesLeft}
      band={band}
      kind={kind}
      travelMode={travelMode}
      onCancel={actions.cancel}
      onToggleTravel={actions.toggleTravel}
    />
  )
}
