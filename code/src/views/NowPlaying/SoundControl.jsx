import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettings } from '../../lib/settings.js'

// Sound popover for Now Playing: a speaker button at the end of the transport
// row opens a card with group volume and the rooms that can join this
// screen's room. Every web screen plays on Main today, so the joinable rooms
// are a constant rather than a per-screen setting. Outdoor zones and the
// Basement are deliberately left out; any other room that is already grouped
// (say, from the Sonos app) still shows up so it can be removed here.
const JOINABLE_ROOMS = ['Playroom', 'Family Room']

const STEP = 2
const AUTO_CLOSE_MS = 6000
// Hold + or - to keep stepping.
const HOLD_DELAY_MS = 400
const HOLD_REPEAT_MS = 130
// Volume sends are throttled; the screen shows the target right away and
// trusts it over the poll for this long after the last tap.
const SEND_GAP_MS = 250
const OPTIMISTIC_MS = 3000
// A join/leave spinner gives up after this long if Sonos never regroups.
const PENDING_MAX_MS = 8000

const clamp = (v) => Math.max(0, Math.min(100, v))

function SpeakerGlyph({ volume }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="np__btn-icon snd__glyph">
      <path d="M3.5 9.2h3.8L12 5.3v13.4l-4.7-3.9H3.5z" />
      {volume === 0 ? (
        <path className="snd__wave" d="M15.5 9.5l5 5m0-5l-5 5" />
      ) : (
        <>
          <path className="snd__wave" d="M15.2 9.4a3.6 3.6 0 0 1 0 5.2" />
          {volume >= 35 && <path className="snd__wave" d="M17.9 6.8a7.3 7.3 0 0 1 0 10.4" />}
        </>
      )}
    </svg>
  )
}

const STEP_GLYPHS = {
  [-1]: 'M5 11h14v2H5z',
  [1]: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
}

// One step on press, then repeats while held.
function StepButton({ dir, label, onStep }) {
  const timers = useRef({})
  const stop = useCallback(() => {
    clearTimeout(timers.current.delay)
    clearInterval(timers.current.repeat)
  }, [])
  useEffect(() => stop, [stop])

  return (
    <button
      type="button"
      className="np__btn snd__step"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault()
        stop()
        onStep(dir)
        timers.current.delay = setTimeout(() => {
          timers.current.repeat = setInterval(() => onStep(dir), HOLD_REPEAT_MS)
        }, HOLD_DELAY_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="np__btn-icon">
        <path d={STEP_GLYPHS[dir]} />
      </svg>
    </button>
  )
}

export default function SoundControl({ state, actions }) {
  const { sonos } = useSettings()
  const home = sonos.room
  const [open, setOpen] = useState(false)
  // Bumped on every touch inside the card; restarts the auto-close timer.
  const [activity, setActivity] = useState(0)
  const bump = useCallback(() => setActivity((n) => n + 1), [])

  // --- Volume: optimistic target, throttled absolute sends ----------------
  // `local` is the value the screen last stepped to. It wins over the poll
  // until OPTIMISTIC_MS after the last tap, so the number never jumps back
  // while Sonos catches up.
  const polled = state.groupVolume ?? state.volume ?? 0
  const polledRef = useRef(polled)
  useEffect(() => {
    polledRef.current = polled
  }, [polled])
  const [local, setLocal] = useState(null)
  const localRef = useRef({ v: null, timer: null })
  const sendRef = useRef({ last: 0, timer: null, value: 0 })
  const volume = local ?? polled

  const onStep = useCallback(
    (dir) => {
      const l = localRef.current
      const v = clamp((l.v ?? polledRef.current) + dir * STEP)
      l.v = v
      setLocal(v)
      clearTimeout(l.timer)
      l.timer = setTimeout(() => {
        l.v = null
        setLocal(null)
      }, OPTIMISTIC_MS)
      bump()

      const s = sendRef.current
      s.value = v
      const wait = SEND_GAP_MS - (Date.now() - s.last)
      if (wait <= 0) {
        s.last = Date.now()
        actions.setGroupVolume(v)
      } else if (!s.timer) {
        s.timer = setTimeout(() => {
          s.timer = null
          s.last = Date.now()
          actions.setGroupVolume(s.value)
        }, wait)
      }
    },
    [actions, bump],
  )
  useEffect(() => () => clearTimeout(localRef.current.timer), [])

  // --- Rooms ---------------------------------------------------------------
  const members = state.groupMembers || [home]
  const extras = members.filter((r) => r !== home)
  const rooms = [
    ...JOINABLE_ROOMS.filter((r) => r !== home),
    ...extras.filter((r) => !JOINABLE_ROOMS.includes(r)),
  ]
  // { room: { want, id } } for joins/leaves in flight. An entry stops counting
  // as soon as the poll shows the room where we asked for it, and is dropped
  // after PENDING_MAX_MS whatever happened.
  const [requested, setRequested] = useState({})
  const requestSeq = useRef(0)
  const pending = Object.fromEntries(
    Object.entries(requested).filter(([r, { want }]) => members.includes(r) !== want),
  )

  const toggleRoom = (r) => {
    bump()
    if (pending[r]) return
    const want = !members.includes(r)
    const id = ++requestSeq.current
    setRequested((p) => ({ ...p, [r]: { want, id } }))
    setTimeout(() => {
      setRequested((p) => {
        if (p[r]?.id !== id) return p
        const rest = { ...p }
        delete rest[r]
        return rest
      })
    }, PENDING_MAX_MS)
    if (want) actions.joinRoom(r)
    else actions.leaveRoom(r)
  }

  // --- Open / close --------------------------------------------------------
  const busy = Object.keys(pending).length > 0
  useEffect(() => {
    if (!open || busy) return
    const id = setTimeout(() => setOpen(false), AUTO_CLOSE_MS)
    return () => clearTimeout(id)
  }, [open, busy, activity])

  // Point the caret at the speaker button; the card itself spans the column.
  const btnRef = useRef(null)
  const cardRef = useRef(null)
  const [caretX, setCaretX] = useState(null)
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !cardRef.current) return
    const b = btnRef.current.getBoundingClientRect()
    const c = cardRef.current.getBoundingClientRect()
    setCaretX(b.left + b.width / 2 - c.left)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`np__btn snd__spk${open ? ' is-open' : ''}`}
        aria-label="Sound"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
          bump()
        }}
      >
        <SpeakerGlyph volume={volume} />
        {extras.length > 0 && <span className="snd__badge">+{extras.length}</span>}
      </button>

      {open && (
        <div
          className="snd-scrim"
          data-interactive="true"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(false)
          }}
        />
      )}

      <div
        ref={cardRef}
        className={`snd${open ? ' is-open' : ''}`}
        role="dialog"
        aria-label="Sound"
        aria-hidden={!open}
        data-interactive="true"
        style={caretX == null ? undefined : { '--caret-x': `${caretX}px` }}
        onPointerDownCapture={bump}
      >
        <div className="snd__head">
          <span className="snd__label">{extras.length ? 'Group volume' : 'Volume'}</span>
          <span className="snd__value">{volume}</span>
        </div>
        <div className="snd__vol">
          <StepButton dir={-1} label="Volume down" onStep={onStep} />
          <div className="snd__track" aria-hidden="true">
            <div className="snd__fill" style={{ width: `${volume}%` }} />
          </div>
          <StepButton dir={1} label="Volume up" onStep={onStep} />
        </div>

        <div className="snd__divider" />

        <div className="snd__label">Also play in</div>
        <div className="snd__rooms">
          {rooms.map((r) => {
            const p = pending[r]
            const on = p ? p.want : members.includes(r)
            const elsewhere = !on && state.elsewhere?.[r]
            return (
              <button
                key={r}
                type="button"
                className={`snd__room${on ? ' is-on' : ''}${p ? ' is-pending' : ''}`}
                aria-pressed={on}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleRoom(r)
                }}
              >
                <span className="snd__ring" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M6 12.5l4 4 8-9" />
                  </svg>
                </span>
                <span className="snd__room-text">
                  <span className="snd__room-name">{r}</span>
                  {elsewhere && <span className="snd__room-sub">Playing {elsewhere}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
