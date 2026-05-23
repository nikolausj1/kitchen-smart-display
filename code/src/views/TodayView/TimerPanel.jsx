import { useState } from 'react'
import ScrollPickerColumn from './ScrollPickerColumn.jsx'
import { logEvent } from '../../shell/DebugLog.jsx'
import './TimerPanel.css'

// Wrap an action so the click does not bubble to the AppShell dead-area
// handler, and so we get a debug log entry for each invocation.
function tap(label, fn) {
  return (e) => {
    e.stopPropagation()
    logEvent(`tap: ${label}`)
    fn?.(e)
  }
}

// --- Icons ----------------------------------------------------------------
// Car, shoe, and X close all sourced from the Figma artwork in
// /public/icons/ui/. The X is rendered inline rather than via <img> because
// the Figma close.svg bakes black/0.3 opacity, which is invisible on the
// dark set-timer panel; the inline version uses currentColor instead.

const CAR_SRC = '/icons/ui/car.svg'
const SHOE_SRC = '/icons/ui/shoe.svg'

function CloseIcon() {
  // Inline so it inherits currentColor and works on both colored and dark
  // panels. The Figma close.svg bakes black/0.3 which is invisible on dark.
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}


// --- Active timer --------------------------------------------------------

function ActiveTimer({ minutesLeft, band, kind, travelMode, onCancel, onToggleTravel }) {
  const expired = minutesLeft <= 0
  const showTravelToggle = kind === 'default'

  return (
    <div className={`timer timer--active timer--${band}`}>
      <button
        type="button"
        className="timer__close"
        aria-label="Cancel timer"
        onClick={tap('cancel-timer', onCancel)}
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
          onClick={tap('toggle-travel', onToggleTravel)}
        >
          {travelMode === 'driving' ? (
            <>
              DRIVING <img src={CAR_SRC} alt="" aria-hidden="true" />
            </>
          ) : (
            <>
              Walking <img src={SHOE_SRC} alt="" aria-hidden="true" />
            </>
          )}
        </button>
      )}
    </div>
  )
}

// --- No-timer state ------------------------------------------------------

function NoTimer({ onSet }) {
  return (
    <div className="timer timer--idle">
      <div className="timer__body">
        <div className="timer__no-timer">
          <div>NO</div>
          <div>TIMER</div>
        </div>
      </div>
      <button type="button" className="timer__set" onClick={tap('SET', onSet)}>
        SET
      </button>
    </div>
  )
}

// --- Set-timer picker (native scroll-wheel) -------------------------------

const HOUR_ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const MINUTE_ITEMS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
const AMPM_ITEMS = ['AM', 'PM']

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

function SetTimer({ onConfirm, onCancel }) {
  const [draft, setDraft] = useState(defaultPickerStart)

  return (
    <div className="timer timer--idle">
      {/* X close on set-timer is a UX addition (not in Figma) so the user
        * can back out without committing. */}
      <button
        type="button"
        className="timer__close"
        aria-label="Cancel set timer"
        onClick={tap('cancel-set-timer', onCancel)}
      >
        <CloseIcon />
      </button>

      <div className="timer__body timer__picker-grid">
        <ScrollPickerColumn
          items={HOUR_ITEMS}
          value={draft.hour12}
          onChange={(v) => setDraft((d) => ({ ...d, hour12: v }))}
          ariaLabel="Hour"
        />
        <div className="picker-colon">:</div>
        <ScrollPickerColumn
          items={MINUTE_ITEMS}
          value={draft.minute}
          onChange={(v) => setDraft((d) => ({ ...d, minute: v }))}
          formatItem={(v) => String(v).padStart(2, '0')}
          ariaLabel="Minute"
        />
        <ScrollPickerColumn
          items={AMPM_ITEMS}
          value={draft.ampm}
          onChange={(v) => setDraft((d) => ({ ...d, ampm: v }))}
          ariaLabel="AM/PM"
          variant="ampm"
        />
      </div>

      <button
        type="button"
        className="timer__set"
        onClick={tap('DONE', () =>
          onConfirm(draft.hour12, draft.minute, draft.ampm)
        )}
      >
        DONE
      </button>
    </div>
  )
}

// --- Root dispatcher ----------------------------------------------------

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
