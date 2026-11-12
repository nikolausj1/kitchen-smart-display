import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettings } from '../../lib/settings.js'

// Sound popover for Now Playing: a speaker button at the end of the transport
// row opens a card with the group volume, one volume row per room in the
// group, and the rooms that can join this screen's room. Every web screen
// plays on Main today, so the joinable rooms are a constant rather than a
// per-screen setting. Outdoor zones and the Basement are deliberately left
// out; any other room that is already grouped (say, from the Sonos app) still
// gets a row so it can be adjusted or removed here.
//
// Volume model: Sonos group volume is the mean of the member volumes. Stepping
// the group (/groupVolume) scales every room in proportion; stepping a room
// (/<room>/volume) moves that room alone. The rows are the truth and the
// group number is derived from them, so the two never disagree.
const JOINABLE_ROOMS = ['Playroom', 'Family Room']

const STEP = 2
// Idle time before the card closes itself: longer once there are rows to read.
const AUTO_CLOSE_MS = 6000
const AUTO_CLOSE_GROUPED_MS = 8000
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

function SpeakerGlyph({ volume, className = 'np__btn-icon snd__glyph' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
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
function StepButton({ dir, label, onStep, className = '' }) {
  const timers = useRef({})
  const stop = useCallback(() => {
    clearTimeout(timers.current.delay)
    clearInterval(timers.current.repeat)
  }, [])
  useEffect(() => stop, [stop])

  return (
    <button
      type="button"
      className={`np__btn snd__step ${className}`}
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

// Optimistic volumes, one slot per key ('group' or a room name). A step shows
// the target at once, sends it absolute and throttled, and keeps winning over
// the poll until OPTIMISTIC_MS after the last tap, so the number never jumps
// back while Sonos catches up. `base` is what the screen shows at tap time;
// repeats while held continue from the slot's own target instead.
function useOptimisticVolumes() {
  const [locals, setLocals] = useState({})
  const slots = useRef({})
  useEffect(
    () => () => {
      for (const s of Object.values(slots.current)) {
        clearTimeout(s.clear)
        clearTimeout(s.timer)
      }
    },
    [],
  )
  const step = useCallback((key, dir, base, send) => {
    const s = (slots.current[key] ||= { v: null, clear: null, last: 0, timer: null, value: 0 })
    const v = clamp((s.v ?? base) + dir * STEP)
    s.v = v
    setLocals((m) => ({ ...m, [key]: v }))
    clearTimeout(s.clear)
    s.clear = setTimeout(() => {
      s.v = null
      setLocals((m) => {
        const next = { ...m }
        delete next[key]
        return next
      })
    }, OPTIMISTIC_MS)

    s.value = v
    const wait = SEND_GAP_MS - (Date.now() - s.last)
    if (wait <= 0) {
      s.last = Date.now()
      send(v)
    } else if (!s.timer) {
      s.timer = setTimeout(() => {
        s.timer = null
        s.last = Date.now()
        send(s.value)
      }, wait)
    }
  }, [])
  return [locals, step]
}

export default function SoundControl({ state, actions }) {
  const { sonos } = useSettings()
  const home = sonos.room
  const [open, setOpen] = useState(false)
  // Bumped on every touch inside the card; restarts the auto-close timer.
  const [activity, setActivity] = useState(0)
  const bump = useCallback(() => setActivity((n) => n + 1), [])

  // --- Rooms ---------------------------------------------------------------
  const members = state.groupMembers || [home]
  const extras = members.filter((r) => r !== home)
  const grouped = extras.length > 0
  // Rows: this room first, the joinable rooms in their fixed order, then
  // anything else that is grouped with us.
  const rows = grouped
    ? [home, ...JOINABLE_ROOMS.filter((r) => members.includes(r)), ...extras.filter((r) => !JOINABLE_ROOMS.includes(r))]
    : []
  const chips = JOINABLE_ROOMS.filter((r) => r !== home && !members.includes(r))

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

  // --- Volumes -------------------------------------------------------------
  const [locals, step] = useOptimisticVolumes()
  const roomShown = (r) => locals[r] ?? state.roomVolumes?.[r] ?? null
  // Grouped: the group number is the mean of what the rows show, so a room
  // step moves it at once. A fresh group step shows its own target instead,
  // and the rows catch up on the next poll.
  const known = rows.map(roomShown).filter((v) => v != null)
  const derivedGroup = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null
  const polledGroup = state.groupVolume ?? state.volume ?? 0
  const groupVolume = locals.group ?? derivedGroup ?? polledGroup

  const onStepGroup = (dir) => {
    bump()
    step('group', dir, groupVolume, actions.setGroupVolume)
  }
  const onStepRoom = (r, dir) => {
    bump()
    step(r, dir, roomShown(r) ?? 0, (v) => actions.setRoomVolume(r, v))
  }

  // --- Open / close --------------------------------------------------------
  const busy = Object.keys(pending).length > 0
  useEffect(() => {
    if (!open || busy) return
    const id = setTimeout(() => setOpen(false), grouped ? AUTO_CLOSE_GROUPED_MS : AUTO_CLOSE_MS)
    return () => clearTimeout(id)
  }, [open, busy, grouped, activity])

  // Point the caret at the speaker button; the card itself spans the column.
  // A card too tall for the space above the transport slides down over it
  // rather than clipping at the top of the screen (four or more rows).
  const btnRef = useRef(null)
  const cardRef = useRef(null)
  const [caretX, setCaretX] = useState(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !cardRef.current) return
    const b = btnRef.current.getBoundingClientRect()
    const card = cardRef.current
    const c = card.getBoundingClientRect()
    setCaretX(b.left + b.width / 2 - c.left)
    const parent = card.offsetParent?.getBoundingClientRect()
    if (parent) {
      const margin = window.innerWidth * 0.02
      const naturalTop = parent.top - window.innerWidth * 0.019 - card.offsetHeight
      setShift(Math.max(0, margin - naturalTop))
    }
  }, [open, rows.length, chips.length])

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
        <SpeakerGlyph volume={groupVolume} />
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
        className={`snd${open ? ' is-open' : ''}${grouped ? ' is-grouped' : ''}${shift > 0 ? ' is-shifted' : ''}`}
        role="dialog"
        aria-label="Sound"
        aria-hidden={!open}
        data-interactive="true"
        style={{
          ...(caretX == null ? null : { '--caret-x': `${caretX}px` }),
          '--snd-shift': `${shift}px`,
        }}
        onPointerDownCapture={bump}
      >
        <div className="snd__head">
          <span className="snd__label">{grouped ? 'Group volume' : 'Volume'}</span>
          <span className="snd__value">{groupVolume}</span>
        </div>
        <div className="snd__vol">
          <StepButton dir={-1} label="Volume down" onStep={onStepGroup} />
          <div className="snd__track" aria-hidden="true">
            <div className="snd__fill" style={{ width: `${groupVolume}%` }} />
          </div>
          <StepButton dir={1} label="Volume up" onStep={onStepGroup} />
        </div>

        <div className="snd__divider" />

        {grouped && (
          <>
            <div className="snd__label">Rooms</div>
            <div className="snd__mix">
              {rows.map((r) => {
                const v = roomShown(r)
                const leaving = !!pending[r]
                return (
                  <div key={r} className={`snd__row${leaving ? ' is-pending' : ''}`}>
                    {r === home ? (
                      <span className="snd__home" aria-hidden="true">
                        <SpeakerGlyph volume={v ?? 1} className="snd__home-glyph" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="snd__leave"
                        aria-label={`Stop playing in ${r}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleRoom(r)
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 12.5l4 4 8-9" />
                        </svg>
                      </button>
                    )}
                    <span className="snd__row-name">{r}</span>
                    <span className="snd__row-num">{v ?? '–'}</span>
                    <StepButton dir={-1} label={`${r} down`} className="snd__row-step" onStep={(d) => onStepRoom(r, d)} />
                    <div className="snd__row-track" aria-hidden="true">
                      <div className="snd__row-fill" style={{ width: `${v ?? 0}%` }} />
                    </div>
                    <StepButton dir={1} label={`${r} up`} className="snd__row-step" onStep={(d) => onStepRoom(r, d)} />
                  </div>
                )
              })}
            </div>
          </>
        )}

        {chips.length > 0 && (
          <div className="snd__join">
            <div className="snd__label">Also play in</div>
            <div className="snd__rooms">
              {chips.map((r) => {
                const p = pending[r]
                const on = p ? p.want : false
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
        )}
      </div>
    </>
  )
}
