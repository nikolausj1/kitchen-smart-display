import { useEffect, useRef, useState } from 'react'
import { DEVICE_ID, plexTextScaleOf, useSettings, updateSettings, resetSettings } from '../../lib/settings.js'
import { HUB, HUB_SOURCE, hubUrl } from '../../lib/hub.js'
import { useView } from '../../shell/ViewContext.jsx'
import { getHomeView, normalizeHomeView } from '../../shell/homeView.js'
import useImmichPhotos from '../../hooks/useImmichPhotos.js'
import { PLEX_OFF, usePlexPlayers } from '../../hooks/usePlexNow.js'
import { LAYOUT_IDS, LAYOUT_LABELS, normalizeLayoutId } from '../TodayLayouts/registry.js'
import { REQUESTED_LAYOUT } from '../../lib/kioskMode.js'
import './SettingsView.css'

// If the Settings screen sees no user activity for this long, auto-bounce
// back to the home view (display.homeView: Photos unless the screen rests on
// Today) so the device returns to its ambient state.
const IDLE_TO_HOME_MS = 60_000

// SettingsView - the four main config groups, all auto-saved to localStorage
// via updateSettings(). Stays full-screen until the user navigates away via
// the menu pill.

const DAY_LABELS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

// Entry board photo wash, as a fraction. Same bounds the layout enforces.
const ENTRY_DIM_MAX = 0.9
function entryDimOf(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0.5
  return Math.max(0, Math.min(ENTRY_DIM_MAX, n))
}

function Row({ label, children, hint }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        {label}
        {hint && <div className="settings-row__hint">{hint}</div>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

function NumberField({ value, onChange, step = 1, min, max, suffix }) {
  return (
    <div className="settings-number">
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = e.target.value === '' ? '' : Number(e.target.value)
          onChange(v)
        }}
        data-interactive="true"
      />
      {suffix && <span className="settings-number__suffix">{suffix}</span>}
    </div>
  )
}

// Touch-friendly +/- stepper. Numeric value with big tap targets.
function Stepper({ value, onChange, min = 1, max = 999, step = 1, suffix }) {
  function clamp(n) {
    return Math.max(min, Math.min(max, n))
  }
  return (
    <div className="settings-stepper">
      <button
        type="button"
        className="settings-stepper__btn"
        onClick={(e) => {
          e.stopPropagation()
          onChange(clamp((Number(value) || 0) - step))
        }}
        aria-label="Decrease"
        data-interactive="true"
      >
        &minus;
      </button>
      <div className="settings-stepper__value">
        {value}
        {suffix && <span className="settings-stepper__suffix">{suffix}</span>}
      </div>
      <button
        type="button"
        className="settings-stepper__btn"
        onClick={(e) => {
          e.stopPropagation()
          onChange(clamp((Number(value) || 0) + step))
        }}
        aria-label="Increase"
        data-interactive="true"
      >
        +
      </button>
    </div>
  )
}

// Touch-friendly slider with live readout.
// Photo-dwell stops: every second from 2-60s, then coarse minute/hour jumps.
// The slider walks this array by index so the long tail doesn't squash the
// everyday 2-60s range into a few pixels.
const DURATION_STEPS = [
  ...Array.from({ length: 59 }, (_, i) => i + 2), // 2..60 s
  120, 180, 300, 600, 900, 1800, 3600,            // 2min..60min
  10800, 21600, 43200, 86400,                     // 3hr..24hr
]

function fmtDuration(secs) {
  if (secs < 120) return [secs, 's']
  if (secs <= 3600) return [Math.round(secs / 60), 'min'] // 60min, per spec
  return [Math.round(secs / 3600), 'hr']
}

// Same look as Slider, but non-linear: the thumb picks an index into
// DURATION_STEPS rather than a raw number.
function DurationSlider({ seconds, onChange }) {
  let idx = 0
  for (let i = 1; i < DURATION_STEPS.length; i++) {
    if (Math.abs(DURATION_STEPS[i] - seconds) < Math.abs(DURATION_STEPS[idx] - seconds)) idx = i
  }
  const [num, unit] = fmtDuration(DURATION_STEPS[idx])
  return (
    <div className="settings-slider">
      <input
        type="range"
        min={0}
        max={DURATION_STEPS.length - 1}
        step={1}
        value={idx}
        onChange={(e) => onChange(DURATION_STEPS[Number(e.target.value)])}
        data-interactive="true"
      />
      <div className="settings-slider__readout">
        {num}
        <span className="settings-slider__suffix">{unit}</span>
      </div>
    </div>
  )
}

function Slider({ value, onChange, min = 1, max = 60, step = 1, suffix }) {
  return (
    <div className="settings-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        data-interactive="true"
      />
      <div className="settings-slider__readout">
        {value}
        {suffix && <span className="settings-slider__suffix">{suffix}</span>}
      </div>
    </div>
  )
}

function TimeOfDay({ hour, minute, onChange }) {
  return (
    <div className="settings-time">
      <Stepper
        value={hour}
        onChange={(v) => onChange({ hour: Math.max(0, Math.min(23, v || 0)), minute })}
        min={0}
        max={23}
      />
      <span className="settings-time__sep">:</span>
      <Stepper
        value={String(minute).padStart(2, '0')}
        onChange={(v) =>
          onChange({ hour, minute: Math.max(0, Math.min(59, Number(v) || 0)) })
        }
        min={0}
        max={59}
      />
    </div>
  )
}

// Short id for kids/activities. crypto.randomUUID is available in secure
// contexts (https and localhost - both apply here); fall back just in case.
function uid() {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  }
}

const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Compact weekday multi-select (0=Sun..6=Sat). Mirrors the School days row.
function WeekdayPicker({ value, onChange }) {
  const set = new Set(value || [])
  return (
    <div className="settings-days settings-days--compact">
      {DAY_ABBR.map((label, i) => {
        const on = set.has(i)
        return (
          <button
            key={i}
            type="button"
            className={'settings-day' + (on ? ' settings-day--on' : '')}
            onClick={(e) => {
              e.stopPropagation()
              const next = new Set(set)
              next.has(i) ? next.delete(i) : next.add(i)
              onChange([...next].sort())
            }}
            data-interactive="true"
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function TextField({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      className="settings-text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      data-interactive="true"
    />
  )
}

function OnOffSelect({ on, onChange }) {
  return (
    <select
      className="settings-select"
      value={on ? 'on' : 'off'}
      onChange={(e) => onChange(e.target.value === 'on')}
      data-interactive="true"
    >
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  )
}

// --- Sonos room dropdown -----------------------------------------------------

function SonosRoomSelect({ apiBase, value, onChange }) {
  const [rooms, setRooms] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/zones`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const names = new Set()
        for (const g of data) {
          for (const m of g.members || []) names.add(m.roomName)
        }
        setRooms([...names].sort())
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [apiBase])

  if (error) {
    return (
      <div className="settings-error">
        Couldn&rsquo;t reach Sonos API ({error}). Using saved value: {value}
      </div>
    )
  }
  if (!rooms) {
    return <div className="settings-note">Loading rooms&hellip;</div>
  }

  return (
    <select
      className="settings-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-interactive="true"
    >
      {!rooms.includes(value) && <option value={value}>{value} (offline?)</option>}
      {rooms.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  )
}

// Trigger + monitor the photo manifest rebuild (Immich -> derivatives).
// POST /api/photos/refresh starts the build on FrameServer (the NUC); the
// status endpoint reflects refresh-status.json, which FrameServer owns. This
// used to run on the Pi via photo-refresh.sh - that path stays installed but
// disabled as the rollback. See docs/designs/photo-refresh-automation.md.
// Both calls go to whatever hub lib/hub.js resolved; '' (same-origin) is what
// the dev server and the rollback path want.

// The status payload, or null when the hub or the endpoint is absent (dev
// server): status stays null and the button still renders.
async function fetchRefreshStatus() {
  try {
    const res = await fetch(hubUrl('/api/photos/refresh/status'), { cache: 'no-store' })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

function PhotoRefreshControl() {
  const [status, setStatus] = useState(null)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState(null)

  // State is set from the fetch's callback, never synchronously in the effect,
  // and not at all once the control has unmounted.
  useEffect(() => {
    let cancelled = false
    fetchRefreshStatus().then((s) => {
      if (!cancelled && s) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Poll only while a run is active, so an open Settings screen costs nothing.
  const running = !!status?.running
  useEffect(() => {
    if (!running) return undefined
    let cancelled = false
    const id = setInterval(() => {
      fetchRefreshStatus().then((s) => {
        if (!cancelled && s) setStatus(s)
      })
    }, 4000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [running])

  async function start(e) {
    e.stopPropagation()
    setPosting(true)
    setPostError(null)
    try {
      const res = await fetch(hubUrl('/api/photos/refresh'), { method: 'POST' })
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      // The wrapper may not have written its status file yet; flip to
      // running optimistically so polling starts immediately.
      setStatus((s) => ({ ...(s || {}), running: true }))
    } catch (err) {
      setPostError(err.message || 'refresh failed')
    } finally {
      setPosting(false)
    }
  }

  function fmtLastRun(iso) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const sameDay = d.toDateString() === new Date().toDateString()
    if (sameDay) return `today ${time}`
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
  }

  let note = null
  if (running) {
    note = <div className="settings-note">Checking Immich for new photos&hellip;</div>
  } else if (postError) {
    note = <div className="settings-error">{postError}</div>
  } else if (status?.error) {
    note = <div className="settings-error">Last run failed: {status.error}</div>
  } else if (status?.lastRun) {
    note = (
      <div className="settings-note">
        Last refreshed {fmtLastRun(status.lastRun)}
        {status.photoCount ? ` · ${status.photoCount} photos` : ''}
      </div>
    )
  }

  return (
    <div className="settings-refresh">
      <button
        type="button"
        className="settings-refresh__btn"
        onClick={start}
        disabled={running || posting}
        data-interactive="true"
      >
        {running || posting ? 'Refreshing…' : 'Refresh now'}
      </button>
      {note}
    </div>
  )
}

// The Plex players the hub has seen (GET /api/plex/players, asked once when
// Settings opens). Two players with one name (two "Apple TV"s) get their
// product to tell them apart; a saved player the hub no longer lists stays
// selectable, so opening Settings never silently changes the setting.
function PlexFollowSelect({ value, onChange }) {
  const { players, loading } = usePlexPlayers()
  const current = typeof value === 'string' && value.trim() && value !== PLEX_OFF ? value : PLEX_OFF
  const known = players.some((p) => p.machineId === current)
  const label = (p) =>
    players.filter((q) => q.name === p.name).length > 1
      ? `${p.name} (${p.product || p.platform || p.machineId.slice(0, 8)})`
      : p.name
  return (
    <select
      className="settings-select"
      value={current}
      onChange={(e) => onChange(e.target.value)}
      data-interactive="true"
    >
      <option value={PLEX_OFF}>Off</option>
      {players.map((p) => (
        <option key={p.machineId} value={p.machineId}>
          {label(p)}
        </option>
      ))}
      {current !== PLEX_OFF && !known && (
        <option value={current}>{loading ? 'Loading…' : `Unknown player (${current.slice(0, 8)})`}</option>
      )}
    </select>
  )
}

// display.plexTextScale as a percent, 80..160 in tens (the dashboard's Plex
// card offers the same). A value saved off the steps stays listed, so opening
// Settings never changes it.
const PLEX_TEXT_STEPS = [80, 90, 100, 110, 120, 130, 140, 150, 160]
function PlexTextSizeSelect({ value, onChange }) {
  const pct = Math.round(plexTextScaleOf(value) * 100)
  const choices = PLEX_TEXT_STEPS.includes(pct) ? PLEX_TEXT_STEPS : [...PLEX_TEXT_STEPS, pct].sort((a, b) => a - b)
  return (
    <select
      className="settings-select"
      value={pct}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      data-interactive="true"
    >
      {choices.map((p) => (
        <option key={p} value={p}>
          {p}%
        </option>
      ))}
    </select>
  )
}

// --- View --------------------------------------------------------------------

export default function SettingsView() {
  const settings = useSettings()
  const { location, school, sonos, slideshow, display } = settings
  const { setView } = useView()
  const { albums: manifestAlbums } = useImmichPhotos()
  // The layout this screen is actually showing: a ?layout= preview wins, as it
  // does in TodayLayoutSwitch, so its own options are here while previewing.
  const shownLayout = normalizeLayoutId(REQUESTED_LAYOUT || display?.todayLayout)
  const entryPhotos = display?.entryBackdrop !== 'black'

  // Album picker. selectedAlbumIds=null means "all albums" - we show every
  // album toggled on. Toggling one switches us to an explicit array.
  const selectedSet = (() => {
    if (!Array.isArray(slideshow?.selectedAlbumIds)) {
      return new Set((manifestAlbums || []).map((a) => a.id))
    }
    return new Set(slideshow.selectedAlbumIds)
  })()
  function toggleAlbum(id) {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    updateSettings({ slideshow: { selectedAlbumIds: [...next] } })
  }

  // Idle-bounce home: any touch, scroll, or input within Settings resets a
  // 60s timer. When it fires, navigate to the home view (read when it fires,
  // so changing Home view here applies to this very bounce). Listeners are
  // attached to the scroll root and use the capture phase so they fire
  // even when a child stops propagation.
  const rootRef = useRef(null)
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const goHome = () => setView(getHomeView())
    let timerId = setTimeout(goHome, IDLE_TO_HOME_MS)
    function bump() {
      clearTimeout(timerId)
      timerId = setTimeout(goHome, IDLE_TO_HOME_MS)
    }
    const events = ['pointerdown', 'touchmove', 'wheel', 'input', 'change', 'keydown']
    events.forEach((e) => node.addEventListener(e, bump, { capture: true, passive: true }))
    return () => {
      clearTimeout(timerId)
      events.forEach((e) => node.removeEventListener(e, bump, { capture: true }))
    }
  }, [setView])

  function toggleDay(d) {
    const set = new Set(school.schoolDays)
    set.has(d) ? set.delete(d) : set.add(d)
    updateSettings({ school: { schoolDays: [...set].sort() } })
  }

  // --- School schedule: kids/activities + no-school overrides ---
  const kids = school.kids || []
  const overrides = school.noSchoolOverrides || []
  const [overrideDate, setOverrideDate] = useState('')

  const updateKids = (next) => updateSettings({ school: { kids: next } })
  const addKid = () => updateKids([...kids, { id: uid(), name: '', activities: [] }])
  const removeKid = (id) => updateKids(kids.filter((k) => k.id !== id))
  const setKidName = (id, name) =>
    updateKids(kids.map((k) => (k.id === id ? { ...k, name } : k)))
  const mapActs = (kidId, fn) =>
    updateKids(kids.map((k) => (k.id === kidId ? { ...k, activities: fn(k.activities || []) } : k)))
  const addActivity = (kidId) =>
    mapActs(kidId, (acts) => [...acts, { id: uid(), label: '', weekdays: [] }])
  const removeActivity = (kidId, actId) =>
    mapActs(kidId, (acts) => acts.filter((a) => a.id !== actId))
  const setActivity = (kidId, actId, patch) =>
    mapActs(kidId, (acts) => acts.map((a) => (a.id === actId ? { ...a, ...patch } : a)))

  function addOverride() {
    const d = overrideDate
    if (!d || overrides.includes(d)) {
      setOverrideDate('')
      return
    }
    updateSettings({ school: { noSchoolOverrides: [...overrides, d].sort() } })
    setOverrideDate('')
  }
  const removeOverride = (d) =>
    updateSettings({ school: { noSchoolOverrides: overrides.filter((x) => x !== d) } })

  function onResetAll() {
    if (confirm('Reset ALL settings to defaults?')) resetSettings()
  }

  return (
    <div className="settings" ref={rootRef}>
      <div className="settings__scroll">
        <h1 className="settings__title">Settings</h1>

        {/* --- School / morning timer --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Today screen</h2>
          <Row
            label="Layout"
            hint="Framed is the original Today screen. Board, Briefing, Ambient and Entry board are the new layouts. Each screen keeps its own choice."
          >
            <select
              className="settings-select"
              value={normalizeLayoutId(display?.todayLayout)}
              onChange={(e) =>
                updateSettings({ display: { todayLayout: normalizeLayoutId(e.target.value) } })
              }
              data-interactive="true"
            >
              {LAYOUT_IDS.map((id) => (
                <option key={id} value={id}>
                  {LAYOUT_LABELS[id]}
                </option>
              ))}
            </select>
          </Row>
          <Row
            label="Home view"
            hint="What this screen rests on: after the school morning, when it starts up outside it, and when Settings or Now Playing sit idle."
          >
            <select
              className="settings-select"
              value={normalizeHomeView(display?.homeView)}
              onChange={(e) =>
                updateSettings({ display: { homeView: normalizeHomeView(e.target.value) } })
              }
              data-interactive="true"
            >
              <option value="photos">Photos</option>
              <option value="today">Today</option>
            </select>
          </Row>
          {shownLayout === 'entry' && (
            <Row
              label="Photos behind the board"
              hint="Entry board: the slideshow, darkened, behind the board. Off is the plain black board."
            >
              <OnOffSelect
                on={entryPhotos}
                onChange={(on) =>
                  updateSettings({ display: { entryBackdrop: on ? 'photos' : 'black' } })
                }
              />
            </Row>
          )}
          {shownLayout === 'entry' && entryPhotos && (
            <Row label="Darken photos" hint="How much the photos behind the board are darkened, so the board reads over any picture.">
              <Slider
                value={Math.round(entryDimOf(display?.entryDim) * 100)}
                min={0}
                max={ENTRY_DIM_MAX * 100}
                step={5}
                suffix="%"
                onChange={(pct) =>
                  updateSettings({ display: { entryDim: entryDimOf(pct / 100) } })
                }
              />
            </Row>
          )}
        </section>

        <section className="settings-section">
          <h2 className="settings-section__title">School &amp; morning timer</h2>
          <Row label="Driving depart" hint="Time to leave when driving.">
            <TimeOfDay
              hour={school.drivingDepart.hour}
              minute={school.drivingDepart.minute}
              onChange={(t) => updateSettings({ school: { drivingDepart: t } })}
            />
          </Row>
          <Row label="Walking depart" hint="Time to leave when walking.">
            <TimeOfDay
              hour={school.walkingDepart.hour}
              minute={school.walkingDepart.minute}
              onChange={(t) => updateSettings({ school: { walkingDepart: t } })}
            />
          </Row>
          <Row label="Auto-show at" hint="Today screen appears at this time on school days.">
            <TimeOfDay
              hour={school.autoShowAt.hour}
              minute={school.autoShowAt.minute}
              onChange={(t) => updateSettings({ school: { autoShowAt: t } })}
            />
          </Row>
          <Row label="Morning ends at" hint="On school days the Today screen hands back to the home view (above) at this time.">
            <TimeOfDay
              hour={school.morningEndsAt?.hour ?? 8}
              minute={school.morningEndsAt?.minute ?? 0}
              onChange={(t) => updateSettings({ school: { morningEndsAt: t } })}
            />
          </Row>
          <Row label="School days">
            <div className="settings-days">
              {DAY_LABELS.map((label, i) => {
                const on = school.schoolDays.includes(i)
                return (
                  <button
                    key={i}
                    type="button"
                    className={'settings-day' + (on ? ' settings-day--on' : '')}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleDay(i)
                    }}
                    data-interactive="true"
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </Row>
        </section>

        {/* --- School schedule (lunch, activities, no-school overrides) --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">School schedule</h2>
          <Row label="Lunch menu" hint="Show today's lunch entree on the Today screen.">
            <OnOffSelect
              on={school.lunch?.enabled !== false}
              onChange={(v) => updateSettings({ school: { lunch: { enabled: v } } })}
            />
          </Row>
          <Row label="School (MealViewer)" hint="School name in the MealViewer URL: schools.mealviewer.com/school/<name>.">
            <TextField
              value={school.lunch?.schoolSlug ?? 'Lawton'}
              placeholder="Lawton"
              onChange={(v) => updateSettings({ school: { lunch: { schoolSlug: v } } })}
            />
          </Row>

          <Row label="Kids &amp; activities" hint="Recurring reminders shown on the Today screen (e.g. Library day).">
            <div className="settings-kids">
              {kids.length === 0 && <div className="settings-note">No kids added yet.</div>}
              {kids.map((kid) => (
                <div className="settings-kid" key={kid.id}>
                  <div className="settings-kid__head">
                    <TextField
                      value={kid.name}
                      placeholder="Name"
                      onChange={(v) => setKidName(kid.id, v)}
                    />
                    <button
                      type="button"
                      className="settings-mini settings-mini--danger"
                      data-interactive="true"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeKid(kid.id)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {(kid.activities || []).map((act) => (
                    <div className="settings-activity" key={act.id}>
                      <TextField
                        value={act.label}
                        placeholder="Activity (e.g. Library)"
                        onChange={(v) => setActivity(kid.id, act.id, { label: v })}
                      />
                      <WeekdayPicker
                        value={act.weekdays}
                        onChange={(wd) => setActivity(kid.id, act.id, { weekdays: wd })}
                      />
                      <button
                        type="button"
                        className="settings-mini settings-mini--danger"
                        data-interactive="true"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeActivity(kid.id, act.id)
                        }}
                        aria-label="Remove activity"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="settings-mini"
                    data-interactive="true"
                    onClick={(e) => {
                      e.stopPropagation()
                      addActivity(kid.id)
                    }}
                  >
                    + Add activity
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="settings-mini"
                data-interactive="true"
                onClick={(e) => {
                  e.stopPropagation()
                  addKid()
                }}
              >
                + Add kid
              </button>
            </div>
          </Row>

          <Row label="No-school dates" hint="Extra closures on top of the district calendar (snow days, etc.).">
            <div className="settings-overrides">
              <div className="settings-overrides__add">
                <input
                  type="date"
                  className="settings-text"
                  value={overrideDate}
                  onChange={(e) => setOverrideDate(e.target.value)}
                  data-interactive="true"
                />
                <button
                  type="button"
                  className="settings-mini"
                  data-interactive="true"
                  onClick={(e) => {
                    e.stopPropagation()
                    addOverride()
                  }}
                >
                  Add
                </button>
              </div>
              <div className="settings-chips">
                {overrides.length === 0 && <span className="settings-note">None.</span>}
                {overrides.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="settings-chip"
                    data-interactive="true"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeOverride(d)
                    }}
                  >
                    {d} &times;
                  </button>
                ))}
              </div>
            </div>
          </Row>
        </section>

        {/* --- Music --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Music (Sonos)</h2>
          <Row label="Room" hint="Which Sonos room the Now Playing view follows.">
            <SonosRoomSelect
              apiBase={sonos.apiBase}
              value={sonos.room}
              onChange={(v) => updateSettings({ sonos: { room: v } })}
            />
          </Row>
        </section>

        {/* --- Plex --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Plex</h2>
          <Row
            label="Follow Plex player"
            hint="When this player has been playing for 10 seconds, this screen shows what is on: the title, the episode, the cast. It goes back a minute after playback stops, once nobody is using it. Players appear here once they have played something."
          >
            <PlexFollowSelect
              value={display?.plexFollow}
              onChange={(v) => updateSettings({ display: { plexFollow: v } })}
            />
          </Row>
          <Row label="Plex text size" hint="Everything on the Plex view: the words, the faces and the posters. 100% shows two rows of the cast.">
            <PlexTextSizeSelect
              value={display?.plexTextScale}
              onChange={(v) => updateSettings({ display: { plexTextScale: v } })}
            />
          </Row>
        </section>

        {/* --- Photos --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Photo slideshow</h2>
          <Row label="Time per photo" hint="How long each photo is displayed before crossfading to the next.">
            <DurationSlider
              seconds={Math.round(slideshow.intervalMs / 1000)}
              onChange={(secs) =>
                updateSettings({
                  slideshow: { intervalMs: Math.max(2000, secs * 1000) },
                })
              }
            />
          </Row>
          <Row label="Sort order" hint="How photos are ordered through the slideshow.">
            <select
              className="settings-select"
              value={slideshow.sortOrder || 'random'}
              onChange={(e) =>
                updateSettings({ slideshow: { sortOrder: e.target.value } })
              }
              data-interactive="true"
            >
              <option value="random">Random</option>
              <option value="date-taken">Date taken (oldest first)</option>
              <option value="date-added">Date added (oldest first)</option>
            </select>
          </Row>
          <Row label="Smart faces" hint="Shift the crop to keep faces in view.">
            <select
              className="settings-select"
              value={slideshow.smartFaces === false ? 'off' : 'on'}
              onChange={(e) =>
                updateSettings({
                  slideshow: { smartFaces: e.target.value === 'on' },
                })
              }
              data-interactive="true"
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Row>
          <Row label="Display" hint="How each photo is sized to the screen.">
            <select
              className="settings-select"
              value={slideshow.displayMode || 'smart'}
              onChange={(e) =>
                updateSettings({ slideshow: { displayMode: e.target.value } })
              }
              data-interactive="true"
            >
              <option value="smart">Smart (fill when it fits, otherwise fit)</option>
              <option value="fill">Fill (crops to fill the screen)</option>
              <option value="fit">Fit (whole photo with a blurred backdrop)</option>
            </select>
          </Row>
          <Row label="Auto-dismiss EXIF" hint="On: location/date caption fades after a delay. Off: stays visible the whole photo.">
            <select
              className="settings-select"
              value={slideshow.autoDismissExif === false ? 'off' : 'on'}
              onChange={(e) =>
                updateSettings({
                  slideshow: { autoDismissExif: e.target.value === 'on' },
                })
              }
              data-interactive="true"
            >
              <option value="on">On (auto-dismiss)</option>
              <option value="off">Off (always visible)</option>
            </select>
          </Row>
          {slideshow.autoDismissExif !== false && (
            <Row label="EXIF visible for" hint="How long the caption stays before fading out.">
              <Slider
                value={Math.max(1, slideshow.exifVisibleSeconds ?? 5)}
                min={1}
                max={30}
                step={1}
                suffix="s"
                onChange={(secs) =>
                  updateSettings({
                    slideshow: { exifVisibleSeconds: Math.max(1, secs) },
                  })
                }
              />
            </Row>
          )}
          {manifestAlbums && manifestAlbums.length > 0 && (
            <Row label="Albums" hint="Which albums feed the slideshow. All on by default.">
              <div className="settings-albums">
                {manifestAlbums.map((a) => {
                  const on = selectedSet.has(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={'settings-album' + (on ? ' settings-album--on' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleAlbum(a.id)
                      }}
                      data-interactive="true"
                    >
                      <span className="settings-album__name">{a.name}</span>
                      <span className="settings-album__count">({a.count})</span>
                    </button>
                  )
                })}
              </div>
            </Row>
          )}
          <Row
            label="Refresh photos"
            hint="Pull new albums and photos from Immich. Also runs automatically every night at 3am."
          >
            <PhotoRefreshControl />
          </Row>
        </section>

        {/* --- Display (night mode schedule) --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Display</h2>
          <Row label="Sleep now" hint="Power the panel down right now. Touch the screen to wake it.">
            <button
              type="button"
              className="settings-reset"
              onClick={(e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('display-sleep-now'))
              }}
              data-interactive="true"
            >
              Sleep now
            </button>
          </Row>
          <Row label="Brightness" hint="How bright the screen looks during the day.">
            <Slider
              value={Math.round((display?.wakeBrightness ?? 0.9) * 100)}
              min={10}
              max={100}
              step={5}
              suffix="%"
              onChange={(pct) =>
                updateSettings({
                  display: { wakeBrightness: Math.max(0.1, Math.min(1, pct / 100)) },
                })
              }
            />
          </Row>
          <Row label="Evening brightness" hint="Brightness during the night.">
            <Slider
              value={Math.round((display?.eveningBrightness ?? 0.4) * 100)}
              min={10}
              max={100}
              step={5}
              suffix="%"
              onChange={(pct) =>
                updateSettings({
                  display: { eveningBrightness: Math.max(0.1, Math.min(1, pct / 100)) },
                })
              }
            />
          </Row>
          <Row
            label="Hardware dimming"
            hint="Dim the real backlight over the HDMI cable. Off falls back to a black overlay."
          >
            <select
              className="settings-select"
              value={display?.hardwareDim === false ? 'off' : 'on'}
              onChange={(e) =>
                updateSettings({
                  display: { hardwareDim: e.target.value === 'on' },
                })
              }
              data-interactive="true"
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Row>
          <Row
            label="Power off panel"
            hint="At the off time, put the panel in standby instead of covering it. Touch still wakes it."
          >
            <select
              className="settings-select"
              value={display?.hardwarePowerOff === false ? 'off' : 'on'}
              onChange={(e) =>
                updateSettings({
                  display: { hardwarePowerOff: e.target.value === 'on' },
                })
              }
              data-interactive="true"
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Row>
          <Row
            label="Pixel shift"
            hint="Nudge the whole picture a pixel or two every few minutes so nothing burns in. Recommended with the Board layout."
          >
            <OnOffSelect
              on={display?.pixelShift === true}
              onChange={(on) => updateSettings({ display: { pixelShift: on } })}
            />
          </Row>
          <Row label="Dim from" hint="Screen dims at this time each evening.">
            <TimeOfDay
              hour={display?.dimAt?.hour ?? 21}
              minute={display?.dimAt?.minute ?? 0}
              onChange={(t) => updateSettings({ display: { dimAt: t } })}
            />
          </Row>
          <Row label="Off from" hint="Screen turns fully off at this time. Touch to wake.">
            <TimeOfDay
              hour={display?.offAt?.hour ?? 0}
              minute={display?.offAt?.minute ?? 0}
              onChange={(t) => updateSettings({ display: { offAt: t } })}
            />
          </Row>
          <Row
            label="Night face"
            hint="What the screen shows in its off window: black, or a faint clock. The Echo Show uses the clock."
          >
            <select
              className="settings-select"
              value={display?.nightFace === 'clock' ? 'clock' : 'black'}
              onChange={(e) =>
                updateSettings({ display: { nightFace: e.target.value } })
              }
              data-interactive="true"
            >
              <option value="black">Black</option>
              <option value="clock">Faint clock</option>
            </select>
          </Row>
          <Row label="Wake at" hint="Screen returns to full brightness in the morning.">
            <TimeOfDay
              hour={display?.wakeAt?.hour ?? 6}
              minute={display?.wakeAt?.minute ?? 0}
              onChange={(t) => updateSettings({ display: { wakeAt: t } })}
            />
          </Row>
        </section>

        {/* --- Location (bottom: rarely changed) --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Location</h2>
          <Row label="Latitude" hint="Decimal degrees. Used for weather.">
            <NumberField
              value={location.lat}
              step={0.0001}
              onChange={(v) =>
                updateSettings({ location: { lat: Number(v) || 0 } })
              }
            />
          </Row>
          <Row label="Longitude">
            <NumberField
              value={location.lon}
              step={0.0001}
              onChange={(v) =>
                updateSettings({ location: { lon: Number(v) || 0 } })
              }
            />
          </Row>
        </section>

        {/* --- Reset --- */}
        <section className="settings-section">
          <button
            type="button"
            className="settings-reset"
            onClick={(e) => {
              e.stopPropagation()
              onResetAll()
            }}
            data-interactive="true"
          >
            Reset all settings to defaults
          </button>
        </section>

        <div className="settings__footer">
          Tap a dead area to open the menu and navigate away.
          <div className="settings__build">Build {__BUILD_STAMP__}</div>
          {/* Which hub this screen resolved, and how (lib/hub.js): the first
            * thing to check when one screen shows different data. */}
          <div className="settings__build">
            {`Hub: ${HUB || 'same origin'} (${HUB_SOURCE}) · Device: ${DEVICE_ID}`}
          </div>
        </div>
      </div>
    </div>
  )
}
